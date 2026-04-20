# Plan 01: Agent Run Inspection

## Status

Implemented.

This plan is kept as a durable reference because later plans should reuse the
same run-resolution and inspection behavior.

## Goal

Let a human inspect one saved agent run directly by id or path without opening
`run.json` and `output.md` by hand.

## User Problem

`agentq runs list` tells a human that runs exist, but the next step used to be
manual file inspection:

```sh
cat ~/.agentq/runs/<run-id>/run.json
cat ~/.agentq/runs/<run-id>/output.md
```

That is fine for implementation debugging, but too raw for everyday use.

## Desired CLI

```sh
agentq runs inspect <run>
```

`<run>` accepts:

- a full run directory path
- a relative run directory path
- a run id / directory name under `~/.agentq/runs`

## Output

The command prints a concise human-readable summary:

- agent id
- status
- duration
- model
- reasoning
- sandbox
- approval policy when present
- run directory
- changed files
- tool/edit counts when present in metadata
- failure details when present
- final output from `output.md`, previewed rather than dumped in full

## Storage Rules

Do not change the agent run directory layout:

```text
~/.agentq/runs/<agent-run-id>/
  run.json
  stdout.jsonl
  stderr.log
  output.md
  artifacts/
```

## Implementation Notes

Core behavior belongs in run-history / path helpers:

- resolve run id or path
- read and validate `run.json`
- read `output.md` if present
- return typed inspection data
- throw `AgentQError` for missing or invalid records

Rendering belongs in the existing render module. CLI wiring belongs under the
`runs` command group.

## Tests

Focused tests should cover:

- inspecting by explicit run directory path
- inspecting by run id
- missing run record gives a useful error
- malformed `run.json` gives a useful invalid-record error
- invalid nested metadata shape gives a useful invalid-record error
- output includes final answer text from `output.md`
- missing or empty `output.md` is handled cleanly
- `runs list` and `runs inspect` both route correctly

## Acceptance Criteria

- `agentq runs inspect <run>` works by id and path.
- `agentq runs list` still works after adding `runs inspect`.
- No new run files are created.
- README documents the workflow.
- `bun run check` passes.

## Non-goals

- No eval infrastructure.
- No run diffing.
- No JSON CLI output.
- No harness storage changes.
