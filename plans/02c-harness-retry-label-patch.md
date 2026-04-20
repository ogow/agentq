# Plan 02c: Harness Retry Label Patch

## Status

Planned.

This is a focused follow-up patch after Plan 02a and Plan 02b. Do not reopen the
broader live-output design. This patch only changes the user-facing retry label
and retry budget semantics shown in harness output.

## Goal

Make default harness progress use the word `retry` instead of `attempt`, and
make the denominator match the configured harness `retries` value directly.

If the harness config says:

```yaml
retries: 8
```

the live row should say:

```text
retry 1/8
```

not:

```text
attempt 1/9
```

## User Problem

The current output can show:

```text
devloop-a0d2b5 task 1/1 attempt 1/9  harness-builder  command_execution failed
```

This is confusing for two reasons:

- the YAML says `retries: 8`, but the UI shows `/9`
- the UI says `attempt`, while the harness config says `retries`

The live output should use the same word the user sees in the harness config,
and the count should be easy to understand at a glance.

## Desired Default TTY Row

Use this shape:

```text
<spinner> <run-id> task <current>/<total> retry <current>/<max>  <agent>  <activity>
```

Example:

```text
⠦ devloop-a0d2b5 task 1/1 retry 1/8  harness-builder  checking the renderer
```

On the last retry:

```text
⠦ devloop-a0d2b5 task 1/1 retry 8/8  harness-builder  applying reviewer feedback
```

## Durable Task Lines

Success:

```text
✓ task 1/1 success retry 2/8  Refine default live-row activity rendering
```

Failure:

```text
✗ task 1/1 failed retry 8/8  Refine default live-row activity rendering

Failure
  agent: harness-reviewer
  retry: 8/8
  reason: JSONL output still prints raw command activity
  run: ~/.agentq/harness-runs/devloop-a0d2b5
```

## Retry Budget Semantics

For user-facing harness output, the denominator should be the configured
`retries` value.

Examples:

| YAML | First row | Last row |
| --- | --- | --- |
| `retries: 1` | `retry 1/1` | `retry 1/1` |
| `retries: 3` | `retry 1/3` | `retry 3/3` |
| `retries: 8` | `retry 1/8` | `retry 8/8` |

The UI should not expose `retries + 1` math.

If the current implementation runs `retries + 1` times, change the loop budget
so `retries` is the total number of task loop tries. This is a behavior change,
so update tests and docs clearly.

## Internal Naming

Internal code may keep `attempt` in record names, state fields, or historical
run records if changing that would create unnecessary churn.

But default human output should not show `attempt`.

Prefer user-facing fields and render text named around retry:

- `retry 1/8` in live rows
- `retry 2/8` in durable task lines
- `retry: 8/8` in failure blocks

`-vv` debug output may expose internal attempt ids if needed for diagnostics,
but default and `-v` should use retry language.

## JSONL

Keep JSONL stable unless a small addition is needed.

If JSONL currently emits attempt state, prefer adding retry fields while keeping
old fields temporarily if compatibility matters:

```json
{
  "retryIndex": 1,
  "retryTotal": 8
}
```

Do not redesign JSONL in this patch.

## Docs

Update README or focused harness docs to state:

```text
In AgentQ loop harnesses, `retries` is the total retry budget shown in harness
output. A loop with `retries: 8` displays retry positions from `retry 1/8`
through `retry 8/8`.
```

If the implementation changes execution semantics from `retries + 1` to
`retries`, call that out in the docs.

## Tests

Add or update focused tests for:

- a loop with `retries: 8` renders `retry 1/8`, not `attempt 1/9`
- durable task success lines render `retry current/max`
- terminal failure blocks render `retry: current/max`
- the harness runs at most `retries` task loop tries, not `retries + 1`
- existing retry boundary behavior still stops after success, blocked, or
  non-retryable plan failure
- JSONL output includes retry state if task/attempt state is emitted there
- README/docs examples use retry language
- `bun run check` passes

## Acceptance Criteria

- Default human output uses `retry`, not `attempt`.
- `retries: 8` displays `retry 1/8` through `retry 8/8`.
- The UI never shows `attempt 1/9` for `retries: 8`.
- Durable task lines include retry progress.
- Failure blocks include retry progress.
- Loop execution budget matches the user-facing retry budget.
- Existing harness retry boundary behavior remains correct.
- Plan 02 and Plan 02b storage/output ownership rules remain unchanged.

## Non-goals

- No new output mode.
- No quiet mode.
- No TUI.
- No JSONL redesign.
- No harness storage layout change.
- No renaming historical run directories or old `attempt-*` step ids unless
  required for correctness.

## Suggested Harness Command

```sh
bun run agentq harness run devloop --input-file plans/02c-harness-retry-label-patch.md
```
