# Wrapped Pretty Verbose Harness Logs

## Goal

Improve `agentq harness run ... -v` so verbose harness logs are attractive,
easy to scan, and complete enough to preserve meaning.

The threaded layout is directionally right, but the current output still has
two UX problems:

- Trace and result messages are truncated, so important meaning is lost.
- Columns drift when step names or actors have different widths, making the log
  look uneven and harder to scan.

## Current Problem Example

```text
● split  go-task-splitter    started
│ trace  go-task-splitter    I’ll inspect the scanner module and the referenced gorecloud resolver prior art so the task split can point workers a...
✓ split  go-task-splitter    5 tasks: Complete trusted resolver evidence contract  · tokens: input 375k · output 4k · cached 317k · reasoning 830 · total 380k
● task 1/5  retry 1/4           Complete trusted resolver evidence contract
├─ review_diff_stat  command             started
✓ review_diff_stat  command             passed
```

The information is useful, but the presentation feels jagged:

- `task 1/5 retry 1/4` does not align with step rows.
- Long step names push actor and message columns around.
- Token summaries make success rows visually heavy.
- Truncated messages often stop before the useful part.

## Proposed Output

Use fixed semantic columns and wrap long messages with a hanging indent.

```text
devloop-5328ef
● split             go-task-splitter  started
│ trace             go-task-splitter  I’ll inspect the scanner module and the referenced gorecloud resolver prior art
│                                     so the task split can point workers at the real resolver and test surfaces.
│ trace             go-task-splitter  The scanner module already has pkg/dnsresolve, cmd/dnsresolve, and
│                                     internal/testdns in a dirty worktree, so the split should stay focused.
✓ split             go-task-splitter  5 tasks: Complete trusted resolver evidence contract · tokens 380k
● task 1/5          retry 1/4         Complete trusted resolver evidence contract
├─ build            go-builder        started
│  trace            go-builder        I found the focused failure: truncated UDP metadata was preserved, but the final
│                                     TCP fallback rcode was not copied into the trusted resolver evidence.
✓ build             go-builder        Completed the trusted resolver evidence repair by preserving the final TCP
│                                     fallback rcode when truncated UDP metadata is retained. · tokens 782k
├─ gofmt            command           passed
├─ vet              command           passed
├─ test             command           passed
├─ review_status   command           passed
├─ review_diff_stat command           passed
├─ review           go-reviewer       started
│  trace            go-reviewer       I’ll review the actual changed file first, then read the surrounding resolver
│                                     tests and data model so any finding is grounded in the patch.
```

## Row Contract

Each row has four visual zones:

```text
rail/status  scope              actor/retry       message
```

Suggested plain widths:

| Column | Width | Notes |
| --- | ---: | --- |
| rail/status | 2-3 | `●`, `✓`, `✗`, `↻`, `│`, `├─` |
| scope | 17 | step name, `trace`, `task 1/5` |
| actor/retry | 16 | agent id, `command`, or `retry 1/4` |
| message | remaining | wrapped, never truncated in `-v` |

The exact widths can be tuned, but they should be constants so all rows share
the same rhythm.

## Wrapping Rules

- Do not truncate assistant trace messages in `-v`.
- Do not truncate step result summaries in `-v` unless the terminal is too
  narrow to produce usable wrapping.
- Wrap message text to terminal width for TTY output.
- Use a stable fallback width for non-TTY output, such as `120`.
- Use a hanging indent for continuation lines.
- Do not repeat the actor on continuation lines.
- Preserve explicit newlines from the original message by wrapping each
  paragraph separately.
- Normalize incidental whitespace inside normal single-paragraph traces.

Example:

```text
│  trace            go-builder        I’m checking the resolver package and fake DNS server paths first so I can make
│                                     the truncation/TCP fallback change naturally, then I’ll verify it with tests.
```

## Token Summary Rules

Verbose output should keep token usage visible but not visually dominant.

Preferred compact form:

```text
✓ build             go-builder        Built truncation evidence fix · tokens 782k
```

Avoid this in `-v`:

```text
tokens: input 777k · output 5k · cached 713k · reasoning 2k · total 782k
```

Keep the full token breakdown for `-vv`, summaries, or JSONL.

## Command Step Rules

Command rows should use the same columns as agent rows:

```text
├─ gofmt            command           started
✓ gofmt             command           passed
├─ review_diff_stat command           started
✓ review_diff_stat  command           passed
```

If a command name exceeds the scope width, prefer widening the scope column
slightly over truncating common harness step names. If truncation is necessary,
middle-truncate long machine ids rather than chopping off meaningful suffixes.

## Retry Rules

Retries should be explicit transition rows, not only updated task headers.

```text
✗ task 1/5          retry 1/4         failed: review requested changes
↻ task 1/5          retry 2/4         retrying with previous feedback
```

This makes it easy to follow why a repeated build or review appears.

## `-vv` Extension

`-vv` should keep the same layout and add machinery rows:

```text
│  tool             go-builder        exec: bun test tests/harness.test.ts
│  fail             go-builder        exit 1 · stderr: expected "success" but received "failed"
```

The user should not have to learn a different visual grammar when moving from
`-v` to `-vv`.

## Implementation Plan

1. Add formatter tests for wrapped trace rows with hanging indentation.
2. Add formatter tests for wrapped successful step summaries.
3. Add formatter tests for long command step names like `review_diff_stat`.
4. Add formatter tests for compact token summaries in `-v`.
5. Add retry transition tests for failed attempt followed by retry.
6. Implement shared row-formatting helpers in `src/core/render.ts`.
7. Keep JSONL, harness files, and default non-verbose output unchanged.
8. Update README examples once the renderer contract is stable.

## Verification

Run focused render tests:

```sh
bun test tests/render.test.ts
```

Then run the full project check:

```sh
bun run check
```

Finally, run a real harness with enough trace output to verify wrapping and
alignment in an actual terminal:

```sh
bun run agentq harness run work --input-file plans/11-wrapped-pretty-verbose-harness-logs.md -v
```
