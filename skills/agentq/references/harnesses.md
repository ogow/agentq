# Harnesses

Use harnesses when AgentQ should own orchestration, durable state, command checks, retries, or feedback between attempts. Keep the harness boring: agents provide results and feedback; the harness owns step order, retry limits, and terminal status.

For broader design guidance on keeping agents, harnesses, skills, and evals
small and reliable, read `docs/robust-agents-and-harnesses.md`.

The mental model is:

```text
one-time setup -> retryable loop -> command/review evidence -> harness decides
```

For implementation, prefer one general build agent that can both add features and repair failed attempts. Add command checks and reviewer agents when they produce useful evidence.

## Which Harness To Use

Use the simple harness shape when one agent plus optional checks is enough:

```yaml
name: work
agent: harness-builder
retries: 1

inputs:
  task: string

checks:
  - id: check
    command: ["bun", "run", "check"]
```

The harness and referenced agent must exist as files in `.agentq` or `~/.agentq`. AgentQ does not embed harnesses or agent prompts.

Use `steps` when setup should run once before a retryable loop. The loop is the retry boundary: steps before the loop are stable context and are not retried, while the body under `loop.steps` retries together.

```yaml
name: planned-work

inputs:
  task: string

steps:
  - id: split
    agent: task-splitter

  - id: implement
    loop:
      over: "{{split.tasks}}"
      retries: 1
      steps:
        - id: build
          agent: harness-builder
        - id: check
          command: ["bun", "run", "check"]
        - id: review
          agent: harness-reviewer
```

`over` reads an array from a previous step result using `{{step.path}}` syntax. For `{{split.tasks}}`, the splitter step must return an `AgentOutput` object whose `result` contains a `tasks` array.

## Step Rules

Top-level `steps` is an ordered list. Each step defines exactly one action:

```yaml
steps:
  - id: build
    agent: harness-builder

  - id: test
    command: ["bun", "test"]

  - id: review
    agent: harness-reviewer
```

Rules:

- Steps run in the order written.
- A non-success step stops the harness.
- Agent steps run through `runAgent` with `result_mode: json`.
- Command steps can use a shell string or an argv array. Prefer argv arrays for commands with arguments.
- Step results are stored in `tasks.json` and summarized in `log.jsonl`.
- Nested agent stdout, stderr, raw JSONL, final answers, and artifacts remain under `~/.agentq/runs/<agent-run-id>/`.

## Loop Rules

A loop step has an id and a `loop` object:

```yaml
steps:
  - id: split
    agent: task-splitter

  - id: implement
    loop:
      over: "{{split.tasks}}"
      retries: 2
      steps:
        - id: build
          agent: harness-builder
        - id: test
          command: ["bun", "test"]
```

For each loop item, AgentQ runs the body once, then retries the same body up to `loop.retries` times if a repairable failure occurs. `retries: 2` means one first attempt plus two feedback-driven repairs.

Loop agents receive:

- original harness inputs
- prior step results
- current loop item
- attempt number
- previous feedback

Failures are interpreted by status and optional `failureKind`:

| Result | Harness Behavior |
|---|---|
| `status: "success"` | Continue to the next step or item. |
| `status: "failed"` | Retry the loop if retries remain. |
| `status: "failed", failureKind: "plan"` | Stop without retrying the same implementation task. |
| `status: "blocked"` | Stop as blocked. |

Use `failureKind: "plan"` only when the assigned task or plan is wrong and another implementation attempt would waste work.

When a later step or human needs specific evidence, make the expectation part of
the agent prompt and verify it with a command, reviewer, or eval. Keep required
result fields small and stable, usually `result.changedFiles` and
`result.verification` for builder agents.

## Splitter Contract

Splitter/planner agents that feed a loop return the normal `AgentOutput` JSON contract. Put generated tasks under `result.tasks`:

```json
{
  "status": "success",
  "summary": "Split the request into one implementation task.",
  "result": {
    "tasks": [
      {
        "title": "Update SSO tests",
        "description": "Inspect the existing SSO tests, update relevant coverage, and run focused checks.",
        "filesHint": ["tests"],
        "risk": "medium",
        "verification": ["Run the relevant SSO tests."]
      }
    ]
  },
  "feedback": null,
  "artifacts": []
}
```

Splitter rules:

- Do not implement work.
- Do not decide retry policy.
- Return one task when one task is enough.
- Return multiple tasks only when the request genuinely spans separable work.
- Return `blocked` only when work cannot safely start.

## Harnessed Agent Contract

Worker, reviewer, and splitter agents return `AgentOutput`:

```json
{
  "status": "success",
  "summary": "Implemented the focused change and ran the relevant tests.",
  "failureKind": "implementation",
  "result": {
    "changedFiles": ["src/example.ts", "tests/example.test.ts"],
    "verification": ["bun test tests/example.test.ts"]
  },
  "feedback": null,
  "artifacts": []
}
```

Only `status` and `summary` are required. Use `result.changedFiles` and `result.verification` for useful build output. Use `feedback` when another attempt should know what went wrong. Do not include `nextTask`, `nextAgent`, routing choices, or retry policy.

## Run Records

Harness runs are stored under:

```text
~/.agentq/harness-runs/<harness-run-id>/
  log.jsonl
  tasks.json
```

`tasks.json` is the current state: inputs, status, process metadata, attempts, step results, timestamps, and summary. `log.jsonl` is the append-only event stream with pointers to nested agent run directories.

Inspect a run with:

```sh
agentq harness inspect <harness-run-id-or-path>
agentq harness logs <harness-run-id-or-path>
```

## Setup Checklist

| Step | Decision |
|---|---|
| 1 | Decide which setup steps run once and which steps belong inside the retryable loop. |
| 2 | Define `inputs`, usually just `task: string`. |
| 3 | Set `loop.retries` if the harness has a loop. |
| 4 | Use a general build agent for repairable work. |
| 5 | Add command checks and reviewer steps only when they prove completion. |
| 6 | Make harnessed agents return `AgentOutput`. |
| 7 | Run once on a small realistic task, then inspect `log.jsonl` and `tasks.json`. |

For runnable starting points, copy from the skill's `examples/agents/` and `examples/harnesses/` folders.
