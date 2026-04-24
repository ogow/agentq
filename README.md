# AgentQ

AgentQ is a CLI-first wrapper for running local Codex agents and simple harnesses.

The v1 direction is deliberately small: AgentQ resolves readable agent files, runs `codex exec --json`, records the evidence, and makes it clear whether a process is still alive. Codex owns execution; AgentQ owns repeatable prompts, process cleanup, status, checks, and run records.

## How It Fits Together

```text
.agentq/agents/<id>.md          reusable agent prompt and runtime settings
.agentq/harnesses/<name>.yaml   one-agent harness with optional checks
~/.agentq/runs/                 individual agent run records
~/.agentq/harness-runs/         harness state and attempt timeline
```

Use `agentq run` when one agent can do the work. Use `agentq harness run` when the same agent should run with optional command checks and a bounded retry.

AgentQ v1 is foreground-only. It does not intentionally leave Codex running in the background. `agentq status` and `agentq stop` use recorded process ids to check the OS process table; run files are discovery records, not proof that a process is alive.

## Implemented

- `agentq run <agent> --task <task>` using `yargs`.
- `agentq harness run`, `agentq harness inspect`, and `agentq harness logs`.
- `agentq status` and `agentq stop <run>` for pid-backed liveness checks and stop control.
- `agentq agents list`, `agentq runs list`, and `agentq runs inspect`.
- Markdown agent parsing with YAML frontmatter.
- Required agent fields: `id`, `description`, `provider`, `model`, `reasoning`, `result_mode`, `sandbox`, and `timeout`.
- Project-local agent resolution before global resolution.
- Project-local harness resolution before global resolution.
- Codex execution through argv arrays with JSONL capture.
- Run metadata for process pid, changed files, tool usage, event count, and failure details.
- Agent run artifacts under `~/.agentq/runs/<agent-id>-<short-id>/`.
- Harness records under `~/.agentq/harness-runs/<harness-id>-<short-id>/`.

## Usage

Install AgentQ globally from this checkout when you want the `agentq` command available outside the repo:

```sh
npm install -g .
```

Verify the install:

```sh
agentq --help
```

AgentQ is currently a Bun-native CLI, so Bun must be available on `PATH`. Agent runs also expect the Codex CLI to be installed and available.

Configure project context in `.agentq/config.json` when you want a non-default instruction file:

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

Use `--details` for full artifact paths and metadata. Use `-v` for step/task structure, repeat `-v` as `-vv` for execution diagnostics, and add `--jsonl` when you want the same event stream as machine-readable lines. The same verbosity rules apply to both agent runs and harness runs.

Examples:

```sh
bun run agentq harness run work -v
bun run agentq harness run work -vv
bun run agentq harness run work --jsonl
bun run agentq harness run work --jsonl -vv | jq -r 'select(.type == "task.finished")'
bun run agentq harness run work --jsonl | jq -r 'select(.type == "harness.finished") | .status'
```

`--no-color` keeps output plain when you want to pipe or diff it.

Check active work:

```sh
bun run agentq status
bun run agentq status --all
bun run agentq status --json
```

List recent runs and inspect one directly:

```sh
bun run agentq runs list --since 7d --limit 20
bun run agentq runs inspect <run-id>
```

`runs inspect` reads the saved `run.json` and `output.md` files from `~/.agentq/runs/<agent-run-id>/`.

Stop a recorded run:

```sh
bun run agentq stop <run-id>
```

`agentq status` shows only currently running work by default. `--all` includes stopped runs and their recorded result. `agentq stop` kills the recorded process tree when the pid is still alive on the current host and marks the run interrupted.

## Harnesses

Run a harness from inline text or a file:

```sh
bun run agentq harness run work --input-text "fix this test"
bun run agentq harness run work --input-file ./plans/sso-admin.md
```

Both commands give the harness the same `task` input. A `work` harness is just a normal `.agentq/harnesses/work.yaml` or `~/.agentq/harnesses/work.yaml` file.

Project or global harnesses can use the simple one-agent shape:

```yaml
name: work
agent: harness-builder
retries: 1

inputs:
  task: string

checks:
  - id: check
    command: ["bun", "run", "check"]
    timeout: 10m
```

Use `steps` when setup should run once before a retryable loop. In this shape, the loop is the retry boundary: pre-loop steps are not retried, while agent and command steps inside the loop are retried together.

```yaml
name: planned

steps:
  - id: split
    agent: task-splitter

  - id: implement
    loop:
      over: "{{split.tasks}}"
      retries: 1
      steps:
        - id: build
          agent: harness-builder
        - id: check
          command: ["bun", "run", "check"]
          timeout: 10m
        - id: review
          agent: harness-reviewer
```

Loop agents receive the original inputs, prior step results, the current loop item, the attempt number, and previous feedback. A step failure with `failureKind: "plan"` stops the loop instead of retrying the same task.
Harness command and check steps default to a `10m` timeout; set `timeout` on the step for longer-running checks.

Each new harness run keeps only the harness-owned records:

```text
log.jsonl
tasks.json
```

`log.jsonl` records harness starts, retries, check results, and pointers to nested agent run directories. Agent stdout, stderr, raw JSONL, final answers, and agent-created artifacts stay in the agent run folders under `~/.agentq/runs`. `tasks.json` is the current harness state.

Default harness output stays bounded: on a TTY it keeps a live status row for the active task, and on non-TTY output it prints a compact history of completed tasks plus concise failure context. Use `-v` to see step structure and assistant messages once, `-vv` to include tool calls and diagnostics, and `--jsonl` to stream the same event model as machine-readable lines.

For example, this prints the JSONL status records and filters them with `jq`:

```sh
bun run agentq harness run work --jsonl | jq -r '
  select(.type == "task.finished" or .type == "harness.finished") |
  [.type, .status, .summary] | @tsv
'
```

Inspect the combined timeline without opening files:

```sh
bun run agentq harness logs <run-id>
bun run agentq harness logs <run-id> --step check
bun run agentq harness logs <run-id> --failed
bun run agentq harness logs <run-id> --follow
```

The `--step` filter matches the user-facing step label, so `--step check`
shows check events without exposing internal `attempt-*` ids.

## Eval Packs

Run a local eval pack:

```sh
bun run agentq eval run inspectability
```

Inspect a saved eval run:

```sh
bun run agentq eval inspect <eval-run-id>
```

Eval packs live in `.agentq/evals/<pack>.ts`. Small JSON fixture files can live next to the pack and be loaded locally from TypeScript. Eval run records live in `~/.agentq/eval-runs`, while any nested agent or harness runs stay in their normal `~/.agentq/runs` and `~/.agentq/harness-runs` locations. The first grader set is deterministic: exit codes, output substrings, file existence, run status, and JSON-path checks.

Check code quality:

```sh
bun run check
```
