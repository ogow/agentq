# Threaded Verbose Harness Logs

## Goal

Make `agentq harness run ... -v` easy to scan during multi-agent harness runs.
The output should make agent ownership, task boundaries, and retries obvious
without adding empty spacer rows or switching to a dashboard-style interface.

## Proposed Shape

Use a compact threaded timeline with stable columns:

```text
devloop-df222d
● split          go-task-splitter  started
│ trace          go-task-splitter  Inspecting scanner module and gorecloud prior art...
│ trace          go-task-splitter  Found pkg/dnsresolve, cmd/dnsresolve, internal/testdns...
✓ split          go-task-splitter  5 tasks: Harden Truncation Transport Evidence · tokens 318k
● task 1/5       retry 1/4         Harden Truncation Transport Evidence
├─ build         go-builder        started
│  trace         go-builder        Checking resolver package and fake DNS server paths...
│  trace         go-builder        Confirmed zDNS lookup API...
✗ task 1/5       retry 1/4         failed: check failed
↻ task 1/5       retry 2/4         retrying with previous feedback
├─ build         go-builder        started
│  trace         go-builder        Applying feedback from failed check...
✓ build          go-builder        Built truncation evidence fix · tokens 94k
✓ task 1/5       retry 2/4         Harden Truncation Transport Evidence
```

## Row Contract

Each row should answer four questions in one line:

```text
status/rail  scope          actor/retry       message
```

| Row | Meaning |
| --- | --- |
| `● split` | A one-off setup step started. |
| `● task 1/5` | A task attempt started. |
| `├─ build` | A child step inside the current task started. |
| `│ trace` | A concise assistant trace from a named agent. |
| `✓ build` | A child step finished successfully. |
| `✗ task 1/5` | A task attempt failed. |
| `↻ task 1/5` | The harness is starting the next retry. |

## UX Rules

- Do not print empty spacer rows.
- Keep `-v` as a readable story, not a diagnostics dump.
- Put the agent name on every trace row.
- Keep retry transitions explicit with `↻` rows.
- Put token usage on completed step rows when available.
- Use fixed-width padding for scope and actor columns.
- Keep raw tool, command, stdout, and stderr diagnostics in `-vv`.
- Keep default output, `--jsonl`, harness files, and the event model unchanged.

## `-vv` Extension

`-vv` should keep the same layout and add machinery rows under the active
agent or command step:

```text
│  tool          go-builder        exec: bun test tests/harness.test.ts
│  fail          go-builder        exit 1 · stderr: expected true, got false
```

This keeps the mental model stable:

| Flag | Purpose |
| --- | --- |
| default | Bounded live status and final outcomes. |
| `-v` | Human-readable story of tasks, agents, traces, and retries. |
| `-vv` | Same story plus tool and command diagnostics. |
| `--jsonl` | Machine-readable event stream. |

## Implementation Plan

1. Add exact renderer tests in `tests/render.test.ts`.
2. Cover split traces, task start, child step traces, retryable failure,
   retry transition, and successful retry.
3. Change only human verbose harness rendering in `src/core/render.ts`.
4. Preserve JSONL output and default non-verbose rendering.
5. Align `-vv` diagnostics with the same threaded row model.
6. Update README examples after the renderer behavior is implemented.

## Verification

Run focused render tests first:

```sh
bun test tests/render.test.ts
```

Then run the full project check:

```sh
bun run check
```

Finally, do one real harness smoke run with `-v` and one with `-vv` to confirm
the output feels readable in an actual terminal.
