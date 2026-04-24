# Plan 08: Harness Output Rendering

## Goal

Make harness terminal output easier to read during real work:

1. Prevent the default TTY live row from wrapping in narrow terminal windows.
2. Rethink `agentq harness run ... -v` so it is a compact structured timeline,
   not a noisy transcript.
3. Preserve `-vv` and `--jsonl` as the places for deeper diagnostics and machine
   consumption.
4. Make the final human summary prettier while keeping it easy for LLMs and
   scripts to understand.

This is a rendering-only plan. Do not change harness orchestration, run record
layout, JSONL event contracts, retry semantics, storage paths, or provider
behavior.

## User Problems

### Narrow Terminal Live Row

When the terminal is narrow, the mutable harness row can exceed the terminal
width. Some terminals wrap the row, so spinner updates appear as repeated
durable-looking lines:

```text
⠏ devloop-90ec65 task 1/2 retry 1/9  harness-builder  I need one more piece before editing: the n
⠋ devloop-90ec65 task 1/2 retry 1/9  harness-builder  I need one more piece before editing: the n
⠙ devloop-90ec65 task 1/2 retry 1/9  harness-builder  I need one more piece before editing: the n
```

The default live row should stay one mutable line and should truncate activity
text before the terminal wraps it.

### Verbose Output

`-v` should help a human understand what the harness is doing. It should not
feel like raw provider logs.

Current risks:

- assistant trace lines can be too frequent or too long
- final `AgentOutput` JSON must not appear as raw assistant-message text
- task and step hierarchy can be hard to scan
- token summaries are useful, but should not dominate
- checks need concise pass/fail lines
- raw commands and stdout/stderr belong in `-vv`, not normal `-v`

## Output Mode Contract

Keep the mode split simple:

| Mode | Purpose |
| --- | --- |
| default TTY | One mutable live row plus durable task completions/failures. |
| default non-TTY | Bounded durable task completions/failures, no spinner frames. |
| `-v` | Human-readable structured task/step timeline with compact trace lines. |
| `-vv` | Detailed diagnostics: tool events, commands, raw-ish timeline details. |
| `--jsonl` | Stable machine-readable event stream. |

Do not add a new output mode.

## Task 1: Width-Aware Default TTY Live Row

Fix the default TTY live row in `createHarnessProgressRenderer`.

Expected behavior:

- Use the output stream's `columns` when available.
- Keep one mutable row by truncating before writing.
- Account for fixed segments first: spinner, run id, task label, retry label,
  and agent label.
- Give the activity segment the remaining width.
- If the remaining width is too small for meaningful activity text, show a
  short fallback such as `working`, or omit activity if even that cannot fit.
- Avoid clipped partial words like `the n` when possible.
- Do not print extra durable lines for spinner or activity updates.
- Keep non-TTY default output unchanged.

Implementation notes:

- Likely file: `src/core/render.ts`.
- `formatHarnessActiveLine` may need a width/options parameter.
- Avoid measuring ANSI escape codes as visible width. If color is enabled, strip
  or account for styling when truncating.
- `plainLength` currently returns string length. If needed, improve it enough
  for current ANSI-colored harness strings.
- Prefer ASCII truncation such as `...` unless the existing file already uses a
  different convention.

Tests in `tests/render.test.ts`:

- A narrow TTY stream with `columns` does not write live rows longer than the
  terminal width.
- Long assistant messages are truncated by AgentQ before writing.
- Spinner updates still reuse the same mutable row and do not add newlines.
- Completion lines still print as durable lines.
- Existing default live-row tests continue to pass.

## Task 2: Redesign Human `-v` Output

Make `agentq harness run ... -v` a compact structured timeline.

Desired shape:

```text
devloop-a0d2b5
▸ split  task-splitter
  trace  Split into one implementation task.
✓ split  task-splitter  1 task

▸ task 1/2 retry 1/9  Add harness output contracts
  ▸ build  harness-builder
    trace  inspecting harness parser and tests
  ✓ build  harness-builder  Implemented requires parsing · tokens: input 42k · output 2k · total 44k
  ✓ typecheck  passed
  ✓ lint       passed
  ✓ tests      passed
  ▸ review  harness-reviewer
```

The exact spacing does not need to match this sample, but the output should be
visibly task/step oriented and compact.

`-v` should show:

- run id once near the top
- task starts
- step starts
- compact assistant trace lines, indented under the current step
- step completion summaries
- command/check pass/fail summaries as one final row, not separate start and
  success rows, when running on a TTY
- token summaries once per agent step when available
- concise failure context
- a final summary that includes aggregate token usage when available

`-v` should not show:

- full `AgentOutput` JSON as an assistant message
- raw shell commands unless the command is the step itself and concise
- stdout/stderr dumps
- raw provider event names
- every spinner/live-row update
- large blank or whitespace-only regions before the first useful line

## Task 3: Preserve `-vv` Diagnostics

Keep `-vv` as the detailed human diagnostic mode.

`-vv` may include:

- tool started/finished events
- command strings
- exit codes
- stdout/stderr tails in failure blocks
- more exact step ids
- raw-ish timeline details

Do not make `-v` and `-vv` identical.

## Task 4: Collapse Command Rows In TTY `-v`

In TTY `-v`, command/check steps should animate or update in place and leave one
durable final row.

Avoid this durable output:

```text
  ▸ typecheck  command
  ✓ typecheck  command         passed
```

Prefer one row that transitions in place while running and remains as:

```text
  ✓ typecheck  command         passed
```

Rules:

- This applies to command/check steps such as `typecheck`, `lint`, and `tests`.
- While the command is running, a TTY may show a mutable row with `▸` or a
  spinner.
- When the command passes, replace that mutable row with one durable `✓` row.
- When the command fails, replace it with one durable `✗` row plus the normal
  concise failure block.
- Do not duplicate command start and completion rows in TTY `-v`.
- Non-TTY `-v` cannot safely update in place; it may either print only the final
  row or keep the existing bounded durable behavior, but it must not emit
  spinner frames or terminal control sequences.
- `-vv` may still print both command start and finish diagnostics.

## Task 5: Improve Final Summary With Tokens

Improve the final harness summary for human modes.

The summary should be pleasant to scan, but remain line-oriented and easy for
LLMs to parse. Use an aligned key-value report for TTY human output. Avoid
box-drawing tables.

TTY shape:

```text
devloop-a0d2b5  success
tasks      2 succeeded
tries      3 total
duration   3m 18s
tokens     input 102k · output 6k · cached 80k · reasoning 1k · total 108k
run        ~/.agentq/harness-runs/devloop-a0d2b5
```

For failures:

```text
devloop-a0d2b5  failed
tasks        1 succeeded, 1 failed
tries        9 total
duration     6m 04s
tokens       input 340k · output 18k · cached 290k · reasoning 4k · total 362k
failed_step  build
reason       Missing result.verification
run          ~/.agentq/harness-runs/devloop-a0d2b5
```

Rules:

- Include aggregate token usage when nested agent run metadata has tokens.
- Keep one fact per line with stable lowercase labels.
- In TTY human output, align labels with padding instead of rendering a
  box-drawing table.
- In non-TTY human output, prefer stable `key: value` lines so pipes and logs
  remain easy to parse.
- Keep labels easy to parse: `tasks:`, `tries:`, `duration:`, `tokens:`,
  `failed_step:`, `reason:`, `run:`.
- Avoid box-drawing tables for the final summary.
- Do not duplicate large failure blocks in the final summary; use concise labels
  and point to the run directory.
- Preserve existing final summary compatibility where possible.
- If token usage is unavailable, omit the `tokens:` line rather than printing
  noisy placeholders.

Implementation notes:

- There is already harness token usage support in `src/core/harness-token-usage.ts`.
- Reuse existing token formatting from `src/core/render.ts` if practical.
- The summary should work in default human mode and verbose human mode.
- `--jsonl` final events should remain machine-readable JSONL and not inherit
  this human summary formatting.

## AgentOutput JSON Handling

When a nested agent emits final `AgentOutput` JSON as an assistant message,
normal `-v` should suppress it and rely on the parsed step result summary.

Bad in `-v`:

```text
agent harness-builder --:-- message {"status":"success","summary":"..."}
```

Good in `-v`:

```text
✓ build  harness-builder  Implemented requires validation
```

For splitter output, prefer a compact derived summary if available:

```text
✓ split  task-splitter  2 tasks
```

If deriving a summary is awkward, suppressing raw JSON and showing the step
summary is enough for the first pass.

## Tests

Add or update focused tests in `tests/render.test.ts`:

- Default narrow TTY live rows do not exceed stream columns.
- Default narrow TTY live updates do not add newlines until completion.
- `-v` does not render final `AgentOutput` JSON as an assistant message.
- `-v` assistant trace lines are compact and indented under the current step.
- `-v` does not use the noisy `agent <id> --:-- message` prefix.
- TTY `-v` command/check steps resolve to one durable final row instead of
  separate start and success rows.
- Final human harness summaries include aggregate token usage when available.
- TTY final summaries use aligned key-value rows.
- Non-TTY final summaries remain stable `key: value` rows for LLM and script
  readability.
- `-v` output has no leading blank or whitespace-only lines.
- `-v` token summaries appear once per agent step when available.
- `-v` command/check lines are concise.
- `-vv` still includes command/tool diagnostics.
- `--no-color -v` remains readable.

If current tests already cover some of these behaviors, update them instead of
duplicating coverage.

## Docs

Update README or `skills/agentq/references/cli.md` only if behavior changes need
user-facing clarification.

Suggested docs should be brief:

- default mode is for live progress
- `-v` is a structured task/step timeline
- `-vv` is for diagnostics
- `--jsonl` is for scripts

## Acceptance Criteria

- Default TTY live rows are width-aware and do not wrap into repeated spinner
  lines on narrow terminals.
- `agentq harness run ... -v` prints a compact structured timeline.
- `-v` suppresses raw final JSON payloads from nested agents.
- `-v` trace lines are readable and associated with the current step.
- `-vv` still exposes detailed diagnostics.
- Non-TTY and `--jsonl` behavior remain compatible.
- No harness storage or event schema changes.
- `bun run typecheck` passes.
- `bun run lint` passes.
- `bun test` passes.
- `bun run check` passes if practical.

## Non-Goals

- No new output mode.
- No quiet mode.
- No TUI.
- No JSONL redesign.
- No harness storage layout change.
- No raw transcript in `-v`.
- No changes to agent prompts or harness execution semantics.

## Suggested Command

```sh
bun run agentq harness run devloop --input-file plans/08-harness-output-rendering.md
```

For a smaller single-agent pass:

```sh
bun run agentq harness run dev --input-file plans/08-harness-output-rendering.md
```
