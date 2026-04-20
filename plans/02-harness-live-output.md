# Plan 02: Harness Live Output

## Status

Implemented.

Implementation note: final harness summaries count completed durable items,
nested Codex progress is explicitly disabled when harnesses set
`progress: false`, and the harness tests capture stdout/stderr around direct
harness runs so default renderer output stays bounded unless a test explicitly
asserts it.

This plan should be implemented before the later reliability and output-contract
plans. It defines how harness runs communicate live progress, where logging
ownership belongs, and how JSONL output maps to the same event model.

## Goal

Make harness output calm, inspectable, and easy to reason about while a run is
active.

Default output should answer only:

- what harness is running
- which task/item is active
- whether the run is still moving
- which tasks/items have completed
- what failed, if attention is needed
- where the durable run record lives

More detail should come from increased verbosity, not many configuration modes.

## User Problem

Current harness progress can become noisy because live agent activity and
harness orchestration are rendered in the same flat stream. In particular,
assistant messages can leak into spinner state and get repeated by terminal
redraws or host capture.

The deeper issue is ownership:

- provider logs are raw execution evidence
- agent events describe one nested agent run
- harness events describe orchestration, retries, steps, tasks, and checks
- renderer output is presentation only

If these layers are blurred, fixes become small hacks around symptoms instead
of a clean output model.

## Product Direction

Use one human default and let the user increase verbosity:

```sh
agentq harness run devloop
agentq harness run devloop -v
agentq harness run devloop -vv
agentq harness run devloop --jsonl
agentq harness run devloop --jsonl -v
agentq harness run devloop --jsonl -vv
```

There should be no `quiet` mode. There should be no long list of log levels.

Treat the axes separately:

| Axis | Values | Purpose |
| --- | --- | --- |
| Format | human, jsonl | How events are encoded. |
| Verbosity | 0, 1, 2 | How much detail is emitted. |

`--jsonl` means JSON Lines streamed as events happen. It is a format flag, not a
request to dump every possible event.

## Logging Ownership

Keep durable records layered:

| Layer | Owns | Durable Files | Live Rendering |
| --- | --- | --- | --- |
| Provider | raw provider JSONL and stderr | nested agent run files | no |
| Agent run | normalized agent events and final output | `~/.agentq/runs/<agent-run-id>/` | no direct formatting |
| Harness | orchestration events and nested run pointers | `tasks.json`, `log.jsonl` | no direct formatting |
| Renderer | human or JSONL presentation | none | yes |

The harness log should not copy full nested agent event streams. It should keep
harness events and pointers to nested agent run directories.

During a live run, the harness may observe nested agent events and pass them to
the renderer with harness context. That live presentation stream is not the
source of truth.

## Default Human Output

Default mode should be a live status row plus completed task history.

It should not print every internal step in a task. It should not print agent
messages unless a failure needs focused context.

Example while running:

```text
devloop k82af3  item 3/8  build  harness-builder  01:42
```

The active row should update in place when the output stream is a TTY.

Completed loop items should become one durable history line each:

```text
✓ item 1/8  success  Fix renderer duplication
✓ item 2/8  success  Add jsonl flag
devloop k82af3  item 3/8  build  harness-builder  01:42
```

When item 3 finishes:

```text
✓ item 1/8  success  Fix renderer duplication
✓ item 2/8  success  Add jsonl flag
✓ item 3/8  success  Simplify harness output modes
devloop k82af3  item 4/8  build  harness-builder  00:03
```

For non-loop harnesses, default output may use top-level step history instead of
task history.

Final success summary:

```text
devloop: success
items: 8 succeeded
duration: 4m 12s
run: ~/.agentq/harness-runs/devloop-k82af3
```

## Failure Output

Default mode should stay quiet until attention is needed. On failure, expand
only the failed task or step:

```text
✓ item 1/8  success  Fix renderer duplication
✗ item 2/8  failed   Add jsonl flag

Failure
  task: item 2/8 Add jsonl flag
  step: check
  reason: bun run check exited with code 2
  run: ~/.agentq/harness-runs/devloop-k82af3
  agent: ~/.agentq/runs/harness-builder-p91ad2
```

Include stderr/stdout tails only when useful for the failure. Do not dump full
logs inline; point to files for complete evidence.

## Verbose Human Output

`-v` should show the internal structure of each task:

```text
devloop k82af3

✓ item 1/8 Fix renderer duplication
  ✓ build   harness-builder   Renderer fixed
  ✓ review  harness-reviewer  Approved

▸ item 2/8 Add jsonl flag
  ⠙ build   harness-builder   01:42
```

`-v` may include assistant messages and token summaries. It should not include
successful tool spam unless the tool result is important to understanding the
step.

## Debug Human Output

`-vv` should show execution detail:

```text
▸ item 2/8 Add jsonl flag
  ▸ build harness-builder
    message  I am updating CLI parsing.
    tool     apply_patch done
    tool     bun test tests/render.test.ts done
    tokens   input 18k · output 1.2k · total 19.2k
```

On failed commands, include command snippets, exit codes, stderr tails, stdout
tails when useful, and nested run paths.

## JSONL Output

`--jsonl` should mirror the selected verbosity in a machine-readable event
stream.

Default JSONL should emit important state transitions, not every nested event:

```jsonl
{"type":"harness.started","runId":"devloop-k82af3","harness":"devloop","runDir":"~/.agentq/harness-runs/devloop-k82af3"}
{"type":"task.finished","itemIndex":1,"itemTotal":8,"status":"success","summary":"Fix renderer duplication"}
{"type":"task.started","itemIndex":2,"itemTotal":8,"step":"build","agent":"harness-builder"}
{"type":"task.finished","itemIndex":2,"itemTotal":8,"status":"success","summary":"Add jsonl flag"}
{"type":"harness.finished","status":"success","durationMs":252000}
```

`--jsonl -v` can include step starts, step finishes, assistant messages, and
token summaries.

`--jsonl -vv` can include tool starts, tool finishes, command snippets, exit
codes, tails, raw event names where useful, and artifact pointers.

Even in `--jsonl -vv`, avoid unlimited stdout/stderr payloads. Emit tails and
paths to full files.

## Implementation Notes

Replace the current log-level concept with a smaller output model:

```ts
type OutputFormat = 'human' | 'jsonl';
type Verbosity = 0 | 1 | 2;
```

CLI flags:

- `-v`, `--verbose`: repeatable, maps to verbosity 1 and 2
- `--jsonl`: stream JSON Lines

Compatibility can keep old `--log-level` temporarily if needed, but the new
design should not grow around it.

Renderer responsibilities:

- own all terminal redraw behavior
- keep spinner/status state separate from durable event lines
- render default mode from harness task/item state
- render `-v` from task/step structure
- render `-vv` from agent execution events
- render JSONL with the same verbosity filtering rules

Harness responsibilities:

- emit harness orchestration events
- track task/item completion state
- expose current active task/step to the renderer
- pass nested agent events to the renderer only as live context
- store nested agent run pointers, not copied agent logs

Agent responsibilities:

- continue writing raw provider output, stderr, final answer, metadata, and
  artifacts under the nested agent run directory
- expose normalized events to live observers

## Tests

Renderer tests:

- default TTY output updates the active row in place
- default mode writes one durable line per completed loop item
- default mode does not persist assistant messages for successful tasks
- failure expands only the failed task/step
- spinner/status text does not repeat assistant messages
- non-TTY default output remains readable and bounded

Verbose tests:

- `-v` shows task internals and step summaries
- `-v` includes assistant messages once
- `-v` includes token summaries without duplicating default lines

Debug tests:

- `-vv` shows tool calls and failed command diagnostics
- failed command tails are bounded
- nested run paths are included for diagnosis

JSONL tests:

- `--jsonl` emits one valid JSON object per line
- default JSONL omits successful tool chatter and assistant messages unless
  they are important state
- `--jsonl -v` includes step and assistant-message events
- `--jsonl -vv` includes tool events and bounded diagnostics
- JSONL output does not include human final summaries

Harness tests:

- harness logs still contain harness events and nested run pointers
- agent stdout/stderr/raw JSONL remain under nested agent run directories
- existing simple one-agent harness behavior remains compatible
- structured loop retry boundaries are unchanged

## Docs

Update README with:

- default live output philosophy
- `-v`, `-vv`, and `--jsonl` examples
- explanation that full records live in local files
- examples for `jq` consumption of JSONL

## Acceptance Criteria

- Default harness output is bounded by task/item history, not agent chatter.
- Active status updates in place on TTYs.
- Completed loop items produce one durable line each in default mode.
- Failures expand the relevant task/step with concise evidence.
- `-v` and `-vv` increase detail without introducing many log-level modes.
- `--jsonl` streams valid JSON Lines and respects verbosity.
- Durable storage stays simple: `tasks.json`, `log.jsonl`, and nested agent run
  directories.
- Existing harness retry behavior remains unchanged.
- `bun run check` passes.

## Non-goals

- No TUI or dashboard.
- No background daemon.
- No database.
- No MCP server.
- No copying nested agent logs into harness run directories.
- No quiet mode.
- No raw full stdout/stderr dumps in live output.

## Risks

| Risk | Mitigation |
| --- | --- |
| Default hides useful agent context | Expand failures and make `-v` the obvious next step. |
| Renderer becomes the source of truth | Keep renderer stateless with respect to durable records; derive from harness/agent events. |
| JSONL schema changes too often | Keep event names boring and version only if a real consumer needs it. |
| Non-TTY output loses the live-row UX | Print bounded status transitions instead of carriage-return updates. |
| Old `--log-level` users break | Keep a short compatibility path or clear migration error. |

## Suggested Harness Command

```sh
bun run agentq harness run devloop --input-file plans/02-harness-live-output.md
```
