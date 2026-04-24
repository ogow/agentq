# Robust Agents And Harnesses

AgentQ works best when agents stay small, harnesses own orchestration, and
specialized knowledge lives in skills or focused reference docs instead of one
massive prompt.

The goal is not to make agents clever. The goal is to make agent work
repeatable, inspectable, and repairable from local files.

This repo's `.agentq/` directory is intended to be the project-local example of
that approach.

## Design Principle

Keep each layer boring:

| Layer | Owns | Should Not Own |
| --- | --- | --- |
| Agent | One role, evidence gathering, final result. | Routing, retries, workflow policy. |
| Harness | Step order, checks, feedback, retry budget, run records. | Domain expertise, broad prompt knowledge. |
| Skill | Reusable workflow knowledge, APIs, examples, reference material. | Per-run decisions or hidden state. |
| Eval | Durable behavior checks from real failures. | General quality vibes. |

If an agent prompt keeps growing, do not just add more text. Decide whether the
new material belongs in a narrower agent, a harness step, a skill, or an eval.

## Start Small

Use the smallest shape that can do the job:

| Need | Use |
| --- | --- |
| One focused task, one final answer. | `agentq run <agent>` |
| One worker plus command checks. | Simple harness with `agent` and `checks`. |
| Planning/setup once, then repair attempts. | Structured harness with `steps` and one `loop`. |
| Repeated prompt failures. | Tighten agent contract, then add eval cases. |
| Reusable domain knowledge. | Skill or focused reference doc, not a larger agent. |

Do not add a harness just to look organized. Add one when the workflow needs
checks, feedback, retries, durable task state, or repeated steps.

## Agent Shape

A robust agent has one job and one output contract.

Required design decisions:

| Decision | Good Answer |
| --- | --- |
| Job | "Implement one assigned task" or "Review one attempt", not both unless it is truly one role. |
| Inputs | The task, prior feedback, relevant step results, and known artifact paths. |
| Evidence | Files, commands, run records, or docs the agent must inspect before claiming success. |
| Permissions | `read-only` for reviewers/planners, `workspace-write` for builders. |
| Stop condition | Return `blocked` when required evidence or permission is missing. |
| Output | Plain text for humans, `AgentOutput` JSON for harness steps. |

Avoid these patterns:

- A giant prompt that explains every possible workflow.
- An agent that decides the next agent, retry policy, or route.
- An agent that silently ignores missing evidence.
- A JSON contract so complex that normal model variation breaks it.
- Broad "improve everything" instructions without concrete evidence.

## Harness Shape

Harnesses should own the workflow.

Good harness responsibilities:

- Run setup steps once.
- Run repairable work inside a bounded loop.
- Run command checks.
- Pass concise feedback into the next attempt.
- Stop on `blocked` or non-repairable plan failure.
- Store local evidence in `tasks.json` and `log.jsonl`.

Good structured shape:

```yaml
name: work

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

The YAML field is `retries` because it configures the number of extra attempts
after the first try. Human output should describe the current attempt as
`try N/M`.

## AgentOutput Contract

Harnessed agents should return `AgentOutput` JSON:

```json
{
  "status": "success",
  "summary": "Implemented the focused change and ran checks.",
  "failureKind": "implementation",
  "result": {
    "changedFiles": ["src/example.ts"],
    "verification": ["bun test tests/example.test.ts"]
  },
  "feedback": null,
  "artifacts": []
}
```

Field guidance:

| Field | Rule |
| --- | --- |
| `status` | `success`, `failed`, or `blocked`. |
| `summary` | One short human-readable sentence. |
| `failureKind` | Use `implementation`, `check`, `review`, `plan`, `blocked`, or `environment`. |
| `result` | Include useful machine-readable facts such as changed files and verification. |
| `feedback` | Use when another attempt needs a repair instruction. |
| `artifacts` | Point to agent-created files under the run artifact directory. |

Do not include `nextTask`, `nextAgent`, routing, or retry policy. The harness
owns those decisions.

## Output Contracts

Make output requirements explicit when later steps or humans need specific
fields or artifacts.

Today, the most reliable way is to state the expected `AgentOutput` fields in
the agent prompt, then verify them with command checks, reviewer agents, or eval
packs. If harness-level `requires` validation is added, keep it to stable,
minimal evidence rather than turning it into a full schema language.

The first useful contracts are usually:

- `result.changedFiles: array`
- `result.verification: array`
- required artifact files for long reports or generated patches

## When To Use Skills

Use a skill when the agent needs reusable knowledge that would otherwise make
the prompt large or brittle.

Good skill candidates:

| Situation | Why A Skill Helps |
| --- | --- |
| A repeated workflow has many rules. | The agent can stay focused and load only relevant instructions. |
| The agent needs API/library details. | The skill can hold references and examples. |
| Multiple agents need the same guidance. | One skill avoids prompt drift. |
| The guidance changes independently from the agent role. | Update the skill without rewriting every agent. |
| The agent would need long templates or examples. | Keep examples in skill references, not the main prompt. |

Do not create a skill for one-off task details, temporary project context, or
information that belongs in `AGENTS.md`, `README.md`, `ARCHITECTURE.md`, or a
normal focused doc.

Good rule of thumb:

```text
If the prompt is growing because the role is unclear, split the agent.
If the prompt is growing because the workflow has steps, use a harness.
If the prompt is growing because reusable knowledge is long, use a skill.
If the prompt is growing because failures repeat, add eval coverage.
```

## Skill-Aware Agents

An agent should not paste an entire skill into its own prompt. Instead, tell it
when to use the skill.

Example:

```md
<instructions>
You are a focused harness builder.

Use the AgentQ skill references when changing agents, harnesses, evals, or run
records. Load only the reference needed for the current task.

Do not duplicate long skill guidance in this prompt.
</instructions>
```

This keeps the agent small while preserving access to deeper knowledge when the
task actually needs it.

## Robust Harness Patterns

Prefer these patterns:

| Pattern | Use When |
| --- | --- |
| `split -> loop(build, check, review)` | A task may contain separable implementation items. |
| `build -> check` | One implementation role plus deterministic verification is enough. |
| `analyze -> propose -> review` | The default should be proposal-only, such as improving prompts from failed runs. |
| `docs -> review` | Documentation changes need grounding in code but not a full build loop. |

Avoid these patterns:

- Nested loops.
- Agents that decide routing.
- Re-running planning on every implementation failure.
- Large harnesses with many optional branches before the simple path is proven.
- Long-running hidden services for local orchestration.

## Reliability Loop

Harden agents from evidence:

1. Run the smallest useful agent or harness.
2. Inspect `output.md`, `run.json`, `tasks.json`, and `log.jsonl`.
3. Classify the failure: task, prompt, harness, check, runtime, or project code.
4. Tighten the smallest contract that would have caught it.
5. Add an eval only after the behavior is worth preserving.
6. Re-run the same task or eval pack.

Do not optimize prompts from one vague failure. Require concrete evidence before
changing durable instructions.

## Review Checklist

Before adding or changing an agent/harness, check:

| Question | Good Sign |
| --- | --- |
| Is the agent's job one sentence? | Yes. |
| Is the output contract clear? | Yes, plain text or `AgentOutput`, not both. |
| Does the harness own retries? | Yes. |
| Are checks deterministic where possible? | Yes. |
| Does feedback include a concrete repair hint? | Yes. |
| Could long guidance be a skill instead? | Considered. |
| Are artifacts under `{{artifacts}}`? | Yes. |
| Is there an eval for repeated/high-risk behavior? | Yes, when justified. |

Lean and reliable beats broad and magical.
