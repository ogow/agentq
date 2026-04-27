# Plan 09: Output Format Contract Tests

## Status

Planned.

## Goal

Make agent and harness output contracts visibly testable so future prompt,
renderer, or harness changes cannot quietly break the formats that humans and
LLMs consume.

This is primarily a test plan. Only change implementation code if a new test
reveals a real contract bug.

## Problem

AgentQ now has several output surfaces:

- agent final output in `output.md`
- agent progress output in human or JSONL mode
- harness default human output
- harness `-v` and `-vv` human output
- harness `--jsonl`, `--jsonl -v`, and `--jsonl -vv`
- harness final summary
- durable run records in `tasks.json`, `log.jsonl`, and nested agent run dirs

Some of these are already covered, but the coverage is spread across renderer,
CLI, harness, and agent tests. The missing value is a small contract-focused
suite that makes the intended behavior obvious.

## Desired Contract

### Agent Output

Project agents that declare `result_mode: json` must be prompted to return valid
JSON only, with no Markdown fences or prose.

Harness-owned agents should return an `AgentOutput` object:

```json
{
  "status": "success",
  "summary": "Short summary.",
  "failureKind": null,
  "result": {},
  "feedback": null,
  "artifacts": []
}
```

Invalid agent JSON should fail the harness step with a concise reason that names
the agent and does not dump a long raw transcript.

### Harness Human Output

Default human output should stay bounded:

```text
✓ task 1/1 success retry 1/1  work
work: success
tasks: 1 succeeded
tries: 1 total
duration: 1.2s
run: ~/.agentq/harness-runs/work-abc123
```

Default mode should not include assistant trace lines, raw final JSON, command
strings, token summaries, stdout/stderr dumps, or repeated spinner rows.

Verbose mode should show structure:

```text
work-abc123
▸ task 1/1  retry 1/1  work
  ▸ build  builder
    trace  mapping the current files
  ✓ build  builder  Built the thing · tokens: input 100 · output 20 · total 120
```

Debug mode should add bounded diagnostics for failures:

```text
command: bun -e process.exit(1)
exit: 1
stderr: boom
stdout: noise
```

### Harness JSONL Output

Every JSONL line must be valid JSON.

Default JSONL should include only important state transitions:

```jsonl
{"type":"harness.started", "...": "..."}
{"type":"task.started", "...": "..."}
{"type":"task.finished", "...": "..."}
{"type":"harness.finished", "...": "..."}
```

`--jsonl -v` should additionally include step, assistant message, and token
usage events.

`--jsonl -vv` should additionally include tool diagnostics and bounded failure
details.

Human final summaries must not be mixed into JSONL output.

## Implementation Tasks

### Task 1: Add Project Agent Contract Tests

Add focused tests that load every project-local agent in `.agentq/agents` and
assert:

- frontmatter parses successfully
- `provider`, `model`, `reasoning`, `result_mode`, `sandbox`, and `timeout` are
  explicit
- JSON agents render the `Final output must be valid JSON only` instruction
- harness-owned agents document the expected top-level `AgentOutput` fields
- proposal-only agents are not accidentally wired as edit/build agents

Suggested files:

- `tests/agent.test.ts`
- `.agentq/agents/*.md`

### Task 2: Add Harness AgentOutput Failure Tests

Add harness tests with fake providers for:

- agent returns invalid JSON
- agent returns JSON that is not an object
- agent returns an object missing `status` or `summary`
- agent returns `status: "failed"` with a supported `failureKind`

Assert the harness:

- marks the step/task failed or blocked correctly
- includes a concise reason such as `Agent "builder" returned invalid JSON.`
- preserves nested agent run pointers
- does not copy nested stdout/stderr into the harness run directory
- still writes only `tasks.json` and `log.jsonl`

Suggested file:

- `tests/harness.test.ts`

### Task 3: Add CLI Output Separation Tests

Add CLI tests that exercise a tiny fake harness through `buildCli` and assert:

- human harness progress goes to stderr
- human final summary goes to stdout
- `--jsonl` writes only JSONL to stdout
- `--jsonl` writes no human final summary
- `-v` writes structured lines without raw `AgentOutput` JSON
- `-vv` includes bounded diagnostics for a failing command

Some of this exists today. Keep existing tests and add only missing assertions
that make the stdout/stderr and JSONL contracts explicit.

Suggested file:

- `tests/cli-routing.test.ts`

### Task 4: Add Renderer Snapshot-Like Contract Tests

Add compact renderer tests that compare exact line arrays for:

- default non-TTY success output
- default non-TTY failure output
- verbose non-TTY structured output
- JSONL default event type sequence
- JSONL verbose event type sequence
- JSONL debug diagnostic fields

Use explicit arrays instead of broad substring checks where practical. Keep the
tests small enough that intentional UX changes are easy to review.

Suggested file:

- `tests/render.test.ts`

### Task 5: Document How To See The Change

Update README or the AgentQ skill reference with a short "output contract smoke
test" section:

```sh
bun test tests/agent.test.ts tests/harness.test.ts tests/cli-routing.test.ts tests/render.test.ts
bun run check
```

Include one human command and one JSONL command:

```sh
bun run agentq harness run dev --input-text "No-op output contract smoke test" -v
bun run agentq harness run dev --input-text "No-op output contract smoke test" --jsonl | jq .
```

## Acceptance Criteria

- Project-local agent files are covered by contract tests.
- Invalid harness agent output fails with concise, useful feedback.
- Human harness output stays separated between stderr progress and stdout final
  summary.
- JSONL output is parseable line-by-line and contains no human summary text.
- `-v` shows structured trace output without raw final JSON dumps.
- `-vv` shows bounded command diagnostics.
- Harness run storage remains `tasks.json` and `log.jsonl` plus nested run
  pointers.
- `bun test tests/agent.test.ts tests/harness.test.ts tests/cli-routing.test.ts tests/render.test.ts` passes.
- `bun run check` passes.

## Non-goals

- No new output mode.
- No renderer redesign.
- No self-improvement harness.
- No snapshot files unless the existing test style clearly benefits.
- No extra harness run files.
- No copying nested agent logs into harness run directories.

## Suggested Harness Command

```sh
bun run agentq harness run devloop --input-file plans/09-output-format-contract-tests.md -v
```
