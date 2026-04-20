# Plan 02b: Harness Live Row LLM Trace Patch

## Status

Planned.

This is a focused follow-up patch after Plan 02a. Do not reopen the broader
harness live-output design or the task/attempt row structure. This patch only
refines what appears in the default live row's activity segment and how the row
is colored.

## Goal

Default harness TTY output should show a compact LLM trace/activity preview,
not raw shell commands.

The current row shape is correct:

```text
<spinner> <run-id> task <current>/<total> attempt <current>/<max>  <agent>  <activity>
```

But the activity segment is currently allowed to show command text such as:

```text
/bin/zsh -lc "sed -n '1,220p' src/core/processes.ts && rg ..."
```

That is too low-level for default mode. Default mode should help a human see
what the LLM is doing, not expose tool execution details.

## Desired Default TTY Row

Good:

```text
⠏ devloop-10bd80 task 1/1 attempt 2/9  harness-reviewer  checking the renderer ownership boundary
```

Good:

```text
⠇ devloop-10bd80 task 1/1 attempt 2/9  harness-builder  updating the live row activity rules
```

Bad:

```text
⠏ devloop-10bd80 task 1/1 attempt 2/9  harness-reviewer  /bin/zsh -lc "sed -n '1,220p' src/core/processes.ts && rg ..."
```

Bad:

```text
⠏ devloop-10bd80 task 1/1 attempt 2/9  harness-reviewer  bun test tests/render.test.ts
```

Raw commands belong in `-vv`, not default mode.

## Activity Source Rules

Default mode activity should prefer LLM-originated trace text:

1. Latest assistant message or reasoning/trace preview, compacted.
2. Retry status, if the task is retrying.
3. Human-readable step fallback, such as `reviewing patch` or `checking files`.
4. Generic fallback, such as `working` or `waiting for model`.

Default mode should not use raw command strings as activity text.

Tool events should affect liveness and state, but not expose commands:

- `tool_started`: keep the previous LLM activity, or use a generic fallback
  like `checking files`.
- `tool_finished` success: keep the previous LLM activity.
- retryable `tool_finished` failure: use a concise retry status, not the raw
  command.
- terminal failure: put concise details in the durable failure block, not the
  live activity segment.

## Assistant Message Rules

Assistant messages may update the default live row activity segment.

Rules:

- compact to a short single-line preview
- remove newlines and excessive whitespace
- do not include a `msg:` prefix
- do not persist as durable rows in default mode
- do not print full paragraphs
- style as dim/greyish text

Example:

```text
⠦ devloop-10bd80 task 1/1 attempt 2/9  harness-builder  fixing final summary counts
```

## Color Contract

Human default output should use color to separate structure from activity.

Use this direction:

| Segment | Style |
| --- | --- |
| spinner | cyan |
| run id | bright or bold foreground |
| `task 1/4` and `attempt 2/9` | dim |
| agent id | normal foreground or subtle accent |
| LLM activity/message preview | dim grey |
| success glyph/status | green |
| failed glyph/status | red |
| blocked glyph/status | yellow |

The important part: the LLM activity text should read as secondary, grey-ish
context. It should not compete visually with the run id, task, attempt, or
terminal status.

## Verbosity Boundary

Keep commands and execution detail out of default mode.

`-v` may show more LLM/step structure, but should still avoid becoming a raw
command transcript unless that is already established by Plan 02 behavior.

`-vv` is the correct place for:

- raw command strings
- shell argv
- exit codes
- stdout/stderr tails
- provider raw event names
- file paths for detailed diagnostics

## Non-TTY Behavior

Non-TTY default output should remain bounded.

It should not print:

- assistant message previews
- raw commands
- spinner frames
- live activity updates

It should print only terminal task lines, failure blocks, and the final summary.

## Implementation Notes

The renderer should track separate concepts:

- `llmActivity`: compact assistant/reasoning trace text
- `toolState`: internal liveness state, not raw display text
- `retryActivity`: concise retry status
- `fallbackActivity`: human-readable step fallback

Default live row should render the best available human activity string from
those fields, without falling back to `event.command`.

Do not solve this by changing harness logs or copying nested agent events into
the harness run directory. This is presentation logic.

## Tests

Add or update focused tests for:

- default TTY live row does not include raw command strings from `tool_started`
- default TTY live row does not include raw command strings from failed
  `tool_finished`
- assistant messages update the activity segment in default TTY mode
- assistant message activity is compacted to one line
- default mode does not emit durable assistant-message rows
- activity text is styled dim/greyish when color is enabled
- `-vv` still includes command diagnostics
- non-TTY default output still omits live activity updates
- `bun run check` passes

## Acceptance Criteria

- Default live row never shows raw shell commands.
- Default live row shows compact LLM trace/activity when available.
- Assistant-message activity has no `msg:` prefix.
- Activity/message text is dim or greyish in human output.
- Raw commands remain available in `-vv`.
- Non-TTY default output remains bounded.
- Plan 02 and Plan 02a storage/output ownership rules remain unchanged.

## Non-goals

- No new output mode.
- No quiet mode.
- No TUI.
- No JSONL redesign.
- No harness storage change.
- No copying nested agent logs into harness logs.
- No full assistant transcript in default mode.

## Suggested Harness Command

```sh
bun run agentq harness run devloop --input-file plans/02b-harness-live-row-llm-trace-patch.md
```
