# Plan 07: Harness Contracts And Agent Improver Cleanup

## Goal

Make AgentQ more reliable by closing the two current gaps:

1. Keep `.agentq/agents/agent-improver.md` compatible with the existing
   `AgentOutput.failureKind` enum.
2. Add first-pass harness output contracts so agent steps cannot report
   `success` while omitting required result fields or artifacts.

Keep the work local-first and CLI-shaped. Do not add a service, database,
dashboard, MCP server, broad workflow engine, or hidden state.

## Current Context

AgentQ already has:

- `agentq run`
- structured `agentq harness run`
- `agentq runs inspect`
- `agentq harness logs`
- local eval packs via `agentq eval run` and `agentq eval inspect`
- project-local `agent-improver` for proposal-only run evidence analysis

The missing piece is enforcement at the harness boundary. Today an agent step
can return valid JSON with `status: "success"` but still omit fields the next
step or human needs, such as `result.changedFiles`, `result.verification`, or a
required artifact.

## Scope

### Task 1: Fix `agent-improver` Failure Kind Contract

Update `.agentq/agents/agent-improver.md` so its final JSON contract only uses
existing AgentQ failure kinds:

- `implementation`
- `check`
- `review`
- `plan`
- `blocked`
- `environment`

Do not add new runtime enum values for this agent.

For more specific reasons, add a field under `result`, for example:

```json
{
  "failureKind": "blocked",
  "result": {
    "reasonCode": "insufficient_evidence"
  }
}
```

Expected reason codes:

- `insufficient_evidence`
- `unsupported_request`
- `missing_records`
- `environment`

Rules:

- Use `status: "success"` when the agent can provide a grounded diagnosis and
  proposal.
- Use `status: "failed"` with `failureKind: "blocked"` and
  `result.reasonCode: "insufficient_evidence"` when evidence does not justify a
  specific change.
- Use `status: "failed"` with `failureKind: "blocked"` and
  `result.reasonCode: "unsupported_request"` when asked to patch files or run
  runtime work.
- Use `status: "blocked"` with `failureKind: "environment"` when required
  records, credentials, permissions, or files are unavailable.

### Task 2: Add Harness Agent Step `requires`

Implement optional `requires` on harness agent steps.

Supported YAML:

```yaml
steps:
  - id: build
    agent: harness-builder
    requires:
      result:
        changedFiles: array
        verification: array
      artifacts:
        - path: "summary.md"
```

Loop body example:

```yaml
steps:
  - id: implement
    loop:
      over: "{{split.tasks}}"
      retries: 1
      steps:
        - id: build
          agent: harness-builder
          requires:
            result:
              changedFiles: array
              verification: array
        - id: check
          command: ["bun", "run", "check"]
```

Support only these required result kinds in the first pass:

- `string`
- `number`
- `boolean`
- `array`
- `object`

Support required artifacts by relative path only. Artifact requirements resolve
against the nested agent run's `artifacts/` directory, not the harness run
directory.

Do not implement full JSON Schema, model grading, or eval-specific contract
syntax in this pass.

## Implementation Notes

Likely files:

- `.agentq/agents/agent-improver.md`
- `src/core/harness.ts`
- `src/core/types.ts`
- `tests/harness.test.ts`
- `README.md`
- `skills/agentq/references/harnesses.md`

Harness parser changes:

- Extend `HarnessAgentStepDefinition` with optional `requires`.
- Parse `requires.result` as a record of field name to expected kind.
- Parse `requires.artifacts` as an array of `{path: string}` objects.
- Reject invalid expected kinds.
- Reject absolute artifact paths.
- Keep harnesses without `requires` fully compatible.

Execution changes:

- Validate after an agent step returns and before the harness advances.
- For missing or wrong result fields, mark the step failed.
- For missing required artifacts, mark the step failed.
- Use `failureKind: "implementation"` for agent contract failures.
- Store concise repair feedback in the step result and `tasks.json`.
- Let loop retries repair the failure when retries remain.

Feedback shape:

```json
{
  "problem": "Agent output did not satisfy required contract.",
  "cause": "Missing result.verification.",
  "evidence": ["Step build returned status success with result keys: changedFiles."],
  "fix": "Return result.verification as an array of commands or evidence checked."
}
```

## Tests

Add or update focused tests in `tests/harness.test.ts`:

- Parses `requires` on top-level agent steps.
- Parses `requires` on loop agent steps.
- Rejects invalid `requires.result` kinds.
- Rejects absolute artifact paths.
- Existing harnesses without `requires` behave unchanged.
- A required result field with the expected kind passes.
- A missing required result field fails the step with useful feedback.
- A wrong result field kind fails the step with useful feedback.
- A required artifact file under the nested agent artifact directory passes.
- A missing required artifact fails the step with useful feedback.
- A loop retries after a contract failure when retries remain.

Add or update an example/documentation test only if an existing example is
changed.

## Docs

Update README or `skills/agentq/references/harnesses.md` with:

- a minimal `requires` example
- the supported first-pass kinds
- the rule that artifacts are checked under the nested agent run artifacts
  directory
- the reminder that contracts are harness-owned and do not copy artifacts into
  the harness run directory

## Acceptance Criteria

- `.agentq/agents/agent-improver.md` uses only supported `failureKind` values.
- Harness agent steps can declare optional `requires`.
- Missing or wrong required result fields fail with clear feedback.
- Missing required artifacts fail with clear feedback.
- Existing harness behavior remains compatible when `requires` is absent.
- Retryable loops can retry contract failures.
- Documentation explains the feature briefly.
- `bun run typecheck` passes.
- `bun run lint` passes.
- `bun test` passes.
- `bun run check` passes if practical.

## Non-Goals

- No full JSON Schema implementation.
- No model-graded contracts.
- No eval-specific contract syntax.
- No automatic workflow-pack generation.
- No MCP adapter.
- No dashboard, daemon, or database.
- No changes to the harness record layout beyond existing `tasks.json` and
  `log.jsonl`.

## Suggested Command

```sh
bun run agentq harness run devloop --input-file plans/07-harness-contracts-and-agent-improver.md
```

If you want the smaller non-splitting harness:

```sh
bun run agentq harness run dev --input-file plans/07-harness-contracts-and-agent-improver.md
```
