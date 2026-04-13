# AgentQ

AgentQ is a CLI-first toolkit for authoring, running, and inspecting local agents.

The v1 direction is a thin wrapper around `codex exec --json`: AgentQ owns repeatable agent definitions, run setup, validation, and artifacts while Codex owns execution.

## Implemented

Implemented in this repo:

- Bun + TypeScript project scaffold.
- `agentq run <agent> --task <task>` using `yargs`.
- `agentq agents list` for project-local and global agents.
- Markdown agent parsing with YAML frontmatter.
- Required agent fields: `id`, `description`, `provider`, `model`, `reasoning`, `result_mode`, `sandbox`, and `timeout`.
- Optional AgentQ config in `.agentq/config.json`, including `context_file`.
- Required body anchors: `<task>` and `<artifacts>`.
- Project-local agent resolution before global resolution.
- Run artifacts under `~/.agentq/runs/<agent-id>-<short-id>/`.
- `agentq runs list` for recent run history, sorted latest first.
- Codex execution through argv arrays with JSONL capture.
- Typed AgentQ event normalization for Codex JSONL.
- Run metadata for changed files, tool usage, event count, and failure details.
- Chalk-rendered live progress, compact run summaries, and detailed inspection output.
- Timeout behavior covered by focused run-contract tests.

## Usage

Configure AgentQ project context in `.agentq/config.json` when you want a non-default project instruction file:

```json
{
  "context_file": "AGENTS.md"
}
```

Create an agent at `.agentq/agents/example.md`:

```md
---
id: example
description: Summarizes a task with concise practical output.
provider: codex
model: gpt-5.4
reasoning: none
result_mode: plain
sandbox: workspace-write
timeout: 5m
---

<instructions>
You are concise and practical.
</instructions>

<task>
{{task}}
</task>

<artifacts>
Write a short final answer. Any durable run files belong under {{artifacts}}.
</artifacts>
```

Run it:

```sh
bun run agentq run example --task "summarize this repo"
```

When the run finishes, AgentQ prints a compact summary with status, duration, tool usage, changed files, the run directory, and the final response.

Use `--details` for full artifact paths and metadata. Use `--verbose` for a live event timeline plus the detailed final summary. Use `--no-color` when plain terminal output is preferred.

Use `--result-mode plain` for human-facing output or `--result-mode json` when a harness or orchestrator will parse the final answer. AgentQ injects the selected result mode into the run prompt.

List agents:

```sh
bun run agentq agents list
```

List previous runs:

```sh
bun run agentq runs list --since 7d --limit 20
```

Run history is sorted latest first and rendered as a chalk-colored table. Use
`--since` with durations such as `1h`, `7d`, or `2w` to choose how far back to
look.

Check code quality:

```sh
bun run check
```

Apply safe formatting and lint fixes:

```sh
bun run fix
```
