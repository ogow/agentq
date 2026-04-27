# AgentQ CLI

## Quick Setup

Create project-local agents in `.agentq/agents/` when they are specific to the current repo. Create reusable agents in `~/.agentq/agents/`. Create harnesses in `.agentq/harnesses/` or `~/.agentq/harnesses/` using the same project-first resolution rule.

The usual human path is:

```sh
agentq agents list
agentq run <agent> --task "describe the exact task"
agentq harness run work --input-text "fix this test fsaf"
agentq harness run work --input-file plan.md
agentq harness inspect <harness-run-id-or-path>
```

`work` is a conventional harness name. Create
`.agentq/harnesses/work.yaml` plus the referenced agent files before running it.
Create a custom harness when you need different one-time steps or different
repeated worker/check roles.

## Planning With Agents

When an LLM is still planning, use `agentq run` for focused research agents.
Use the harness only when it is time to implement the plan.

The common loop is:

```text
main LLM conversation -> focused research agents -> plan.md -> harness
```

Example research runs:

```sh
agentq run specops-e2e-explorer --task "Explore the SSO admin flow in the test app. Return the pages visited, user actions, important selectors, observed validation behavior, and risks for E2E coverage." --timeout 30m --details

agentq run specops-test-inventory --task "Inspect the existing SSO E2E tests. Return what coverage already exists, likely files to update, and gaps the plan should cover." --sandbox read-only --details
```

After each research run, read the saved output before planning:

```sh
agentq runs list --since 1h --limit 10
cat ~/.agentq/runs/<run>/output.md
cat ~/.agentq/runs/<run>/run.json
```

Then write or synthesize the implementation plan and hand it to the harness:

```sh
agentq harness run work --input-file plan.md
```

For research agents, prefer a strong output contract: findings, evidence,
paths/URLs inspected, uncertainty, and recommended plan items. They should not
edit project files unless their job explicitly requires it.

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

Run a harness:

```sh
agentq harness run <name> --input-text "describe the task"
agentq harness run <name> --input-file plan.md
agentq harness run <name> --input-file input.json
agentq harness run <name> --input-file -
```

`--input-text` and `--input-file` both produce harness inputs. Raw text becomes
`inputs.task`; JSON objects become structured inputs. Use `--input-file -` to
read the same content from stdin.

Inspect a harness run:

```sh
agentq harness inspect <harness-run-id-or-path>
```

Run and inspect an eval pack:

```sh
agentq eval run <pack-name-or-path>
agentq eval inspect <eval-run-id-or-path>
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
- `--verbose` / `-v`: print a structured task/step timeline for harness runs.
- `-vv`: include detailed diagnostics such as tool and command activity.
- `--no-color`: plain terminal output.

## Run Output

Default output is compact:

- status and duration
- run directory
- tool/edit counts
- changed files
- failure summary when relevant
- final agent output

Use `--details` when a human needs agent-run metadata.

Harness output modes are:

| Mode | Use |
| --- | --- |
| default | One live TTY row plus compact task completions and final summary. |
| `-v` | Structured task/step timeline with concise trace lines. |
| `-vv` | Detailed diagnostics, including tool and command activity. |
| `--jsonl` | Machine-readable events for scripts and `jq`. |

Final harness summaries are line-oriented and may include aggregate token usage
when nested agent runs report tokens:

```text
devloop-a0d2b5  success
tasks      2 succeeded
tries      3 total
duration   3m 18s
tokens     input 102k · output 6k · cached 80k · reasoning 1k · total 108k
run        ~/.agentq/harness-runs/devloop-a0d2b5
```

`loop.retries` is still the YAML field for the retry budget. Human output may
describe the current attempt as `retry N/M`.

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

## Harness Runs

Harness definitions live at:

```text
.agentq/harnesses/<name>.yaml
~/.agentq/harnesses/<name>.yaml
```

Project-local harnesses override global harnesses.

Harness runs are stored under:

```text
~/.agentq/harness-runs/<harness-run-id>/
```

Start with:

- `log.jsonl`: append-only harness events and pointers to nested agent run directories.
- `tasks.json`: current harness state, inputs, final result, questions, answers, and task ledger.

Individual agent runs still keep their own detailed run records under `~/.agentq/runs/`; harness files reference those run directories instead of copying their contents.

Loop harnesses declare one-time splitter/setup steps before the repeated loop:

```yaml
steps:
  - id: split
    agent: task-splitter

  - id: implement
    loop:
      over: "{{split.tasks}}"
      retries: 2
      steps:
        - id: build
          agent: harness-builder
```

`loop.retries: 2` means one first attempt plus up to two feedback-driven repairs. The splitter step is not retried unless the harness explicitly runs a new harness attempt.

Runnable example agents and harnesses live in the installable skill's `examples/` folder.

## Eval Packs

Eval packs live at:

```text
.agentq/evals/<pack>.ts
```

Run records live at:

```text
~/.agentq/eval-runs/<eval-run-id>/
  results.json
  log.jsonl
```

Pack files import from `agentq/eval`:

```ts
import {defineEval, graders} from 'agentq/eval';

export default defineEval({
  name: 'smoke',
  cases: [
    {
      id: 'cli-smoke',
      type: 'command',
      command: ['bun', '-e', 'console.log("ok")'],
      graders: [graders.exitCode(0), graders.stdoutContains('ok')],
    },
  ],
});
```

Use `command` cases for fast CLI/file checks, `agent` cases for a single agent's output contract, and `harness` cases for end-to-end workflow behavior. For detailed design guidance, read `references/evals.md`.

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
