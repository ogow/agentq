# Harness CLI Plan

## Purpose

AgentQ should grow a harness layer for repeatable multi-step work without making individual agents aware of the whole workflow.

The harness should answer questions like:

| Question                                | Owner               |
| --------------------------------------- | ------------------- |
| Which agent runs first?                 | Harness definition  |
| Which CLI tools run between agents?     | Harness definition  |
| Which output is passed to another step? | Harness definition  |
| How many repair attempts are allowed?   | Harness definition  |
| What did an agent produce?              | Agent JSON output   |
| Why did an agent fail?                  | Agent JSON feedback |

The main design boundary is simple: agents produce outcomes, and the harness decides what to do with those outcomes.

## Design Principles

Keep AgentQ local-first and inspectable. A harness run should create durable run records for the harness itself and for every agent or command step inside it.

Keep the AgentQ runtime thin. The harness should call the same underlying agent run primitives as `agentq run`, not become a new model runtime.

Keep agents focused. An agent should not decide which agent receives its result, whether a retry happens, or how the harness continues.

Use JSON for machine communication. Markdown and XML-like tags can still be useful inside authored prompts, but harnessed agent outputs should be valid JSON.

Prefer explicit passing. Later steps should receive only the result, feedback, and artifacts that the harness declares.

## Harness Locations

Harness definitions should live in one of two locations:

| Scope   | Path                              |
| ------- | --------------------------------- |
| Project | `./.agentq/harnesses/<name>.yaml` |
| Global  | `~/.agentq/harnesses/<name>.yaml` |

Project-local harnesses should override global harnesses with the same name, matching the agent resolution model.

## Non-Goals For The First Version

The first version should not implement a full workflow engine, distributed queue, UI, or large eval framework.

It should also avoid open-ended agent chat. The harness should pass structured values through named steps instead of letting agents message each other directly.

## Agent Output Contract

Harnessed agents should use `result_mode: json` and return exactly one JSON object.

```ts
type AgentOutput = {
  status: 'success' | 'failed' | 'blocked';
  summary: string;
  result?: AgentResult | null;
  feedback?: string | AgentFeedback | null;
  artifacts?: Array<string | ArtifactRef>;
};

type AgentResult = {
  changedFiles?: string[];
  verification?: string[];
};

type AgentFeedback = {
  problem: string;
  cause?: string;
  evidence?: string[];
  fix?: string;
};

type ArtifactRef = {
  name: string;
  kind: 'file' | 'directory' | 'log' | 'patch' | 'json' | 'text';
  path: string;
  description?: string;
};
```

The contract has three outcomes:

| Status    | Meaning                                                                                                             | Harness behavior                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `success` | The agent completed the task.                                                                                       | Continue to dependent steps.                                        |
| `failed`  | The task or validation failed, but a repair attempt may help.                                                       | Retry only if the harness allows it and attempts remain.            |
| `blocked` | The agent cannot make meaningful progress without new context, permission, files, credentials, or a human decision. | Stop the loop unless the harness explicitly handles blocked output. |

Agents must not include `nextTask`, `nextAgent`, or routing instructions. Feedback should describe what failed and what would help repair it. Prefer one general build agent for implementation and repair; the harness supplies previous feedback when another attempt is needed.

## Success Example

```json
{
  "status": "success",
  "summary": "Implemented session expiry validation and added a regression test.",
  "result": {
    "changedFiles": [
      "src/auth/session.ts",
      "tests/auth.expired-session.test.ts"
    ],
    "verification": ["bun test tests/auth.expired-session.test.ts"]
  },
  "feedback": null,
  "artifacts": ["artifacts/test-output.log"]
}
```

## Failure Example

```json
{
  "status": "failed",
  "summary": "The implementation still accepts expired sessions.",
  "result": null,
  "feedback": "Expired sessions return 200 instead of 401. Reject expired access sessions before refresh-token fallback unless refresh is explicitly requested.",
  "artifacts": ["artifacts/failed-test-output.log"]
}
```

## Harness Definition Shape

The first harness format should be YAML. YAML is easier to read for orchestration than JSON, while step inputs and outputs remain JSON.

```yaml
name: build-with-review

inputs:
  task: string

steps:
  build:
    agent: harness-builder

  lint:
    command: bun run lint

  review:
    agent: harness-reviewer
```

Agent steps should receive the original task, declared inputs, current step id,
and previous step results by default. Use `input:` only when a step needs a
custom payload.

The harness should resolve each step into a normalized step result:

```ts
type StepResult = AgentOutput & {
  stepId: string;
  kind: 'agent' | 'command';
  startedAt: string;
  finishedAt: string;
  runDir?: string;
  command?: string;
  exitCode?: number;
};
```

Command steps should be normalized into the same `success`, `failed`, or `blocked` shape. A non-zero exit code usually becomes `failed` with a log artifact.

## Loop Harnesses

Loop harnesses make the planning phase explicit in the YAML. The planner is not hidden runtime magic; it is a one-time step outside `steps.loop`.

```yaml
name: implement-loop

steps:
  planner:
    agent: task-planner

  loop:
    worker:
      agent: harness-builder

    verify:
      command: bun test

    reviewer:
      agent: harness-reviewer
```

The planner does one job outside the loop: convert the task and available context into a ready plan, focused questions, or a blocked decision. It should not implement, route to workers, or decide retry policy. The `steps.loop` block names the worker and required checks that repeat for each planned task.

```ts
type PlannerDecision = {
  status: 'ready' | 'needs_info' | 'blocked';
  summary: string;
  tasks: PlannedTask[];
  questions: PlannerQuestion[];
  feedback: AgentFeedback | null;
};
```

When the planner returns `ready`, the harness updates `tasks.json` and starts the worker/check loop. When it returns `needs_info`, the harness stores questions in `tasks.json`, stops as blocked, and can later resume with answers stored in the same state file. When it returns `blocked`, the harness stops with the planner feedback.

## Retry Model

Retries should be fixed and boring. Do not add a general loop DSL until real harnesses need it. Agents receive the task, concise feedback about what went wrong last time, and selected artifact paths when they are useful.

```yaml
name: build-until-clean

inputs:
  task: string

steps:
  build:
    agent: harness-builder

  lint:
    command: bun run lint

  review:
    agent: harness-reviewer
```

The retry rules are built in:

| Stop reason      | Meaning                                                              |
| ---------------- | -------------------------------------------------------------------- |
| `success`        | Worker and configured checks succeeded.                              |
| `blocked`        | Worker or check returned `blocked`.                                  |
| `failed`         | The built-in retry did not repair the task.                          |
| `invalid_output` | A harnessed agent returned invalid JSON or failed schema validation. |
| `runtime_error`  | AgentQ or a command step failed outside the normal step contract.    |

Every iteration should be saved. The final harness summary should show the iteration count, final status, failed step if any, and the most useful feedback.

## Artifact Handling

Artifacts should be references, not large inline payloads.

The harness should keep artifacts simple. Agent output may use path strings. Command output is saved automatically. Later steps should receive only the small set of paths the harness knows are useful.

Recommended harness run layout:

```text
~/.agentq/harness-runs/<harness-run-id>/
  log.jsonl         # append-only harness events and agent run pointers
  tasks.json        # current harness state, result, questions, answers, tasks
```

Agent-created artifacts should still live under the agent run's artifact directory during the agent run. The harness should reference the useful paths and avoid copying everything by default.

## CLI Surface

Start with a small command surface:

```sh
agentq harness run <name> --input-file input.json
agentq harness run <name> --input-file plan.md
agentq harness run <name> --input-file -
agentq harness run <name> --input-text "Fix the failing auth test"
agentq harness inspect <harness-run-id>
```

`--input-file` and `--input-text` should use the same parser. A JSON object becomes structured harness inputs. Any other content is stored as `inputs.task`; `--input-file -` reads that value from stdin.

The command should print a compact live status while running and save full detail to disk.

The saved event stream should be inspectable through the CLI:

```sh
agentq harness logs <harness-run-id>
agentq harness logs <harness-run-id> --step task-001
agentq harness logs <harness-run-id> --failed
agentq harness logs <harness-run-id> --follow
```

Default final output should include:

| Field          | Purpose                                        |
| -------------- | ---------------------------------------------- |
| Harness status | `success`, `failed`, or `blocked`.             |
| Iterations     | How many attempts ran.                         |
| Final summary  | Human-readable result.                         |
| Failed step    | Present only when the harness did not succeed. |
| Feedback       | The most useful failure or blocked feedback.   |
| Run directory  | Where to inspect all artifacts.                |

## Implementation Phases

### Phase 1: Minimal One-Pass Harness

Add harness file loading from `./.agentq/harnesses/<name>.yaml` and `~/.agentq/harnesses/<name>.yaml`, validation, simple variable interpolation, agent steps, command steps, `needs` ordering, and harness run directories.

This phase should support only acyclic one-pass harnesses. No loops yet.

### Phase 2: Harness JSON Contract

Add schema validation for agent JSON output. Normalize command results into the same contract. Fail fast on invalid JSON with a clear `invalid_output` step result.

This phase should introduce shared TypeScript types for `AgentOutput`, `AgentFeedback`, `ArtifactRef`, and `StepResult`.

### Phase 3: Simple Artifact References

Accept artifact path strings from agents and preserve them as references. Harness logs should point to agent run directories instead of copying nested agent logs.

### Phase 4: Bounded Repair Attempts

Add fixed loop task retries. A failed worker/check attempt retries the same build agent with feedback while the explicit top-level `iterations` budget remains. A blocked attempt stops.

### Phase 5: Inspection And Hardening

Add `agentq harness inspect`, readable summaries, and fixtures for repeated harness runs. Convert repeated real failures into focused tests after the manual loop proves the contracts.

## Open Questions

Should harness definitions eventually support nested reusable harnesses, or should composition stay at the step level for longer?

What real repeated workflow would justify adding a condition evaluator instead of keeping retries fixed?
