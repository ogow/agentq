# AgentQ CLI

## Main Commands

Run an agent:

```sh
agentq run <agent> --task "describe the exact task"
```

List available agents:

```sh
agentq agents list
```

List previous runs:

```sh
agentq runs list --since 7d --limit 20
```

## Run Flags

Common `agentq run` flags:

- `--task`: required task text.
- `--provider`: provider override, currently `codex`.
- `--model`: model override.
- `--reasoning`: `none`, `minimal`, `low`, `medium`, `high`, or `xhigh`.
- `--result-mode`: `plain` for human-readable output or `json` for harness/orchestrator parsing.
- `--timeout`: duration such as `100ms`, `1m`, or `1h`.
- `--sandbox`: `read-only`, `workspace-write`, or `danger-full-access`.
- `--approval`: approval policy when supported.
- `--context-file`: project instruction/context file for Codex discovery.
- `--details`: print detailed metadata and artifact paths.
- `--verbose`: stream live event activity and print detailed final output.
- `--no-color`: plain terminal output.

## Run Output

Default output is compact:

- status and duration
- run directory
- tool/edit counts
- changed files
- failure summary when relevant
- final agent output

Use `--details` when a human needs metadata. Use `--verbose` when debugging behavior during execution.

## Run Artifacts

Each run is stored under:

```text
~/.agentq/runs/<agent-id>-<short-id>/
```

Expected files:

- `run.json`: structured metadata, config, status, timestamps, paths, tool usage, changed files, failure details.
- `stdout.jsonl`: raw provider JSONL/event stream.
- `stderr.log`: provider stderr.
- `output.md`: final agent message.
- `artifacts/`: optional extra files created by the agent, exposed in prompts through `{{artifacts}}`.

Use `output.md` for the final answer. Use `run.json` for stable inspection. Use `stdout.jsonl` when debugging tool use, progress, or agent behavior.

## Finding Previous Results

Start with:

```sh
agentq runs list --since 7d --limit 20
```

Then inspect the run directory shown in the table:

```sh
cat ~/.agentq/runs/<run>/output.md
cat ~/.agentq/runs/<run>/run.json
```

Prefer the run history command over guessing directory names.

## Config And Resolution

Project-local agents:

```text
.agentq/agents/<id>.md
```

Global agents:

```text
~/.agentq/agents/<id>.md
```

Project-local agents override global agents with the same `id`.

Project config can set the context file:

```json
{
  "context_file": "AGENTS.md"
}
```

Precedence:

1. CLI flags
2. agent frontmatter for runtime fields
3. project `.agentq/config.json`
4. global `~/.agentq/config.json`
5. provider defaults
