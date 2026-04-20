# Plan 02d: Harness Verbose Output Patch

## Status

Planned.

This is a focused follow-up patch after Plan 02, Plan 02a, Plan 02b, and Plan
02c. Do not redesign the default live row, retry label semantics, JSONL, or
harness storage. This patch only fixes human `-v` output so it is readable and
removes startup whitespace.

## Goal

Make `agentq harness run ... -v` a useful structured view, not a raw transcript.

Verbose mode should show task and step structure, concise LLM trace lines, token
summaries, and terminal step/task outcomes. It should not dump full JSON
assistant payloads or raw command transcripts.

## User Problem

Current `-v` output can look like this:

```text
▸  split  task-splitter
agent task-splitter  --:--  message  { "status": "success", "summary": "Split into one implementation task ...", "result": { "tasks": [ ... huge JSON ... ] } }
✓  split  task-splitter  Split into one implementation task ... · tokens: ...
harness  task 1/1  retry 1/8  Add the first local eval runner
▸  build  harness-builder
agent harness-builder  --:--  message  I’m mapping the existing CLI...
...
agent harness-builder  --:--  message  {"status":"success","summary":"Verified the local eval runner end to end", ...}
```

Problems:

- The splitter's final JSON output is printed as one giant assistant message.
- The builder's final `AgentOutput` JSON is printed as one giant assistant
  message.
- The `agent ... --:-- message` prefix is noisy and not the structured view we
  discussed.
- `-v` is too close to a transcript, while it should be a readable task/step
  timeline.
- Starting the command can print visible blank/whitespace lines before useful
  output.

## Desired `-v` Shape

Verbose output should be task/step oriented:

```text
devloop-a0d2b5

▸ split  task-splitter
  trace  Split into one implementation task for the first eval runner slice.
✓ split  task-splitter  1 task · tokens: input 19k · output 785 · cached 13k · total 20k

▸ task 1/1 retry 1/8  Add the first local eval runner
  ▸ build  harness-builder
    trace  mapping the existing CLI and run storage
    trace  checking current tests and eval modules
  ✓ build  harness-builder  Verified the local eval runner end to end · tokens: input 345k · output 9k · cached 299k · total 355k
  ✓ typecheck  passed
  ✓ lint       passed
  ✓ tests      passed
  ▸ review  harness-reviewer
```

The exact columns do not need to match this perfectly, but the output should be
obviously structured and compact.

## Verbose Rules

`-v` should show:

- harness run id once near the top
- task starts
- step starts
- compact assistant/reasoning trace lines
- step completion summaries
- token summaries
- check pass/fail summaries
- concise failure context

`-v` should not show:

- full `AgentOutput` JSON as an assistant message
- raw command strings unless they are short, human-helpful check names
- stdout/stderr dumps
- provider raw event names
- every spinner/live-row update
- large blank/whitespace regions before the first useful line

Raw commands, raw-ish event names, stdout/stderr tails, and full diagnostics
belong in `-vv`.

## AgentOutput JSON Handling

When a nested agent returns final `AgentOutput` JSON, verbose mode should render
the parsed summary/result, not the raw JSON message.

Examples:

Bad:

```text
agent harness-builder --:-- message {"status":"success","summary":"Verified...","result":{"changedFiles":[]}}
```

Good:

```text
✓ build  harness-builder  Verified the local eval runner end to end
```

For splitter results, prefer a compact derived summary:

```text
✓ split  task-splitter  1 task: Add the first local eval runner
```

If parsing is not available at render time, suppress JSON-looking assistant
messages in `-v` and rely on the step completion summary.

## Trace Lines

Assistant messages in `-v` should be rendered as compact trace lines:

```text
trace  mapping the existing CLI and run storage
```

Rules:

- compact to a single line
- cap length to a readable width
- do not prefix with `agent <id> --:-- message`
- do not render final JSON payloads
- indentation should show the trace belongs to the current step
- preserve `-vv` for detailed raw event timelines

## Startup Whitespace

Running a verbose harness should not print visible blank/whitespace lines before
the first useful output.

Investigate and fix any renderer behavior that writes empty padded rows,
newline-only startup spacing, or clear-line artifacts before the first verbose
line.

The first useful line should appear immediately after Bun's command echo, for
example:

```text
$ bun src/cli.ts harness run devloop --input-file "plans/03-local-eval-packs.md" -v
devloop-a0d2b5
▸ split  task-splitter
```

## Color Contract

Human `-v` output should use color subtly:

| Segment | Style |
| --- | --- |
| run id | bold or bright foreground |
| step/task start marker | cyan or dim |
| success glyph/status | green |
| failure glyph/status | red |
| blocked status | yellow |
| trace text | dim grey |
| token summary | dim |

Avoid loud coloring for every token. The structure should be readable with
`--no-color` too.

## Non-TTY Behavior

`-v` non-TTY output should remain structured and bounded. It may print the same
verbose structure, but it should not include terminal control sequences,
spinners, or blank clear-line padding.

## Tests

Add or update focused tests for:

- `-v` does not render final `AgentOutput` JSON as an assistant message
- splitter final JSON is summarized as task count/title, not dumped
- builder final JSON is summarized from step completion, not dumped
- assistant trace lines are compact and indented under the current step
- `-v` does not use the noisy `agent <id> --:-- message` prefix
- `-v` output has no leading blank/whitespace-only lines
- `-vv` still includes raw command diagnostics
- `--no-color -v` remains readable
- `bun run check` passes

## Acceptance Criteria

- `agentq harness run ... -v` prints a compact structured task/step timeline.
- `-v` does not dump full JSON assistant payloads.
- `-v` trace lines are compact, readable, and associated with the current step.
- Startup output has no leading whitespace-only block.
- Raw diagnostics remain available in `-vv`.
- Plan 02 storage and JSONL rules remain unchanged.

## Non-goals

- No new output mode.
- No quiet mode.
- No TUI.
- No JSONL redesign.
- No harness storage layout change.
- No full transcript in `-v`.

## Suggested Harness Command

```sh
bun run agentq harness run devloop --input-file plans/02d-harness-verbose-output-patch.md
```
