# AgentQ Examples

This folder contains runnable examples for setting up AgentQ agents and harnesses.

## Agents

The example agents live in this installable skill at `examples/agents/`:

- `task-splitter.md`: read-only splitter for loops that need generated task items.
- `harness-builder.md`: workspace-writing build agent for implementation and repair.
- `harness-reviewer.md`: read-only reviewer that returns `AgentOutput` JSON.

Copy them into a project-local agent folder before running the harness examples:

```text
.agentq/agents/task-splitter.md
.agentq/agents/harness-builder.md
.agentq/agents/harness-reviewer.md
```

## Harnesses

The example harnesses live in this installable skill at `examples/harnesses/`:

- `work.yaml`: accepts a short request or a plan, splits only when useful, runs build/retry/review per task.
- `loop-implementation.yaml`: plans a broad task, writes a task ledger, then runs build, verify, and review per task.
- `one-pass-build-review.yaml`: runs a known one-pass build, verify, review sequence.

Copy them into:

```text
.agentq/harnesses/work.yaml
.agentq/harnesses/loop-implementation.yaml
.agentq/harnesses/one-pass-build-review.yaml
```

Run them with:

```sh
agentq harness run work --input-text "Fix the failing auth test"
agentq harness run work --input-file ./plans/sso-admin.md
```

Harness runs are saved under `~/.agentq/harness-runs/<run-id>/` and can be inspected with:

```sh
agentq harness inspect <run-id-or-path>
```

These examples are covered by automated tests in `tests/examples.test.ts`.
