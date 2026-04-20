# Plan 04: Output Contracts

## Goal

Let harnesses and evals enforce required outputs before they advance.

This plan makes AgentQ more reliable by catching malformed or incomplete agent
outputs with clear feedback.

Keep this as a small validation layer over existing harness/eval records. Do
not introduce a schema service, database, or broad framework.

## Depends On

This should come after:

- Plan 01: `runs inspect`
- Plan 03: local eval packs, or at least enough eval-run structure to benefit
  from shared contract validation

It can be done before workflow packs.

## First Harness Run Scope

Implement contract validation for harness agent steps first.

Eval integration can be a follow-up if the splitter decides this plan is too
large.

## User Problem

Harness agents return `AgentOutput` JSON, but a run can be practically useless
even if it returns valid JSON:

- required artifact missing
- `result.changedFiles` missing when implementation changed files
- status says success but result shape is incomplete
- final JSON is malformed and feedback is vague
- downstream loop continues even though the previous step did not deliver what
  the harness needed

The harness should fail early with concise repair feedback.

## Desired Harness YAML

Add optional `requires` to agent steps:

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

Keep the first schema small. Do not implement full JSON Schema in the first
version unless the repo already has a suitable dependency.

## Contract Model

Support:

- required top-level fields
- required `result` fields by name
- primitive expected kinds:
  - `string`
  - `number`
  - `boolean`
  - `array`
  - `object`
- required artifacts by relative path

Optional later kinds:

- `nonempty_string`
- `nonempty_array`
- enum values
- JSON Schema files

Do not include the optional later kinds unless they are easy and tested.

## Validation Timing

Validate after an agent step returns and before the harness advances.

If validation fails inside a retryable loop:

- mark the step failed
- set `failureKind: "implementation"` or `"check"` based on existing
  conventions
- pass concise feedback to the next attempt

If validation fails outside a loop:

- fail the harness with a clear summary

## Feedback Shape

Feedback should match the existing feedback schema:

```json
{
  "problem": "Agent output did not satisfy required contract.",
  "cause": "Missing result.verification.",
  "evidence": "Step build returned status success with result keys: changedFiles.",
  "fix": "Return result.verification as an array of commands or evidence checked."
}
```

Do not return arrays of findings unless the existing contract supports them.

## Artifact Rules

Artifact requirements refer to the agent artifact directory exposed through
`{{artifacts}}`.

Rules:

- artifact paths must be relative
- reject absolute artifact requirements in harness validation
- resolve against the nested agent run artifact directory
- do not copy artifacts into the harness directory
- record missing artifacts in harness step result feedback

## Tests

Harness definition tests:

- parses `requires` on agent steps
- rejects invalid `requires` shape
- rejects absolute artifact paths

Harness execution tests:

- passes when required `result` fields exist with expected kinds
- fails and retries loop when a required `result` field is missing
- fails and retries loop when a required field has the wrong kind
- passes when a required artifact exists
- fails and retries when a required artifact is missing
- stores clear feedback in `tasks.json`
- writes useful harness events to `log.jsonl`

Regression tests:

- existing harnesses without `requires` behave unchanged
- simple one-agent harness shape still works
- loop retry boundary remains unchanged

## Docs

Update README or focused harness docs with:

- a minimal `requires` example
- explanation that contracts are harness-owned
- reminder that nested agent artifacts stay under `~/.agentq/runs`

## Acceptance Criteria

- Harness agent steps can declare simple output requirements.
- Missing/wrong result fields fail with useful feedback.
- Missing required artifacts fail with useful feedback.
- Retryable loops can repair contract failures.
- Existing harnesses remain compatible.
- Tests cover parsing and execution.
- `bun run check` passes.

## Non-goals

- No full JSON Schema implementation in the first pass.
- No model grading.
- No eval-specific contract syntax unless eval packs already exist and reuse is
  small.
- No copying artifacts into harness directories.
- No separate memory files.
- No MCP dependency.

## Risks

| Risk | Mitigation |
| --- | --- |
| Contract syntax becomes a new programming language | Keep first version to required fields and simple kinds. |
| Breaks existing harness definitions | Make `requires` optional and add compatibility tests. |
| Feedback is too vague for repair | Include exact missing path/kind in feedback. |
| Artifact validation violates storage model | Resolve only against nested agent artifacts and store pointers. |

## Suggested Harness Command

```sh
bun run agentq harness run devloop --input-file plans/04-output-contracts.md
```
