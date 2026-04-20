# Architecture

AgentQ is split into a reusable core, a Codex provider adapter, and a thin `yargs` CLI.

## Core

The core package under `src/core` owns:

- Agent file parsing and validation.
- Required prompt anchors.
- Run configuration merging.
- Project and global config loading.
- Agent, harness, and context-file resolution.
- Harness resolution from project and global files.
- Run directory creation under `~/.agentq/runs`.
- Harness run directory creation under `~/.agentq/harness-runs`.
- Codex JSONL normalization into typed AgentQ events.
- Changed-file, token, tool-usage, event-count, process, and failure metadata summaries.
- Pid-backed status and stop helpers.
- Chalk-backed rendering for live progress, run summaries, run history tables, and harness logs.

The core exposes importable APIs through `src/core/index.ts`.

## Providers

Provider adapters live under `src/providers`.

The Codex provider resolves the Codex executable before spawning, invokes `codex exec --json` with argv arrays, allows non-git working directories, captures stdout JSONL and stderr logs, normalizes the JSONL stream into AgentQ events, and asks Codex to write the final message to `output.md`.

When Codex is spawned, the provider reports the root pid to `runAgent`, which stores it in `run.json`. On timeout, interrupt, provider error, or harness shutdown, AgentQ kills the full process tree and waits briefly before escalating.

Provider-neutral types live in `src/core/types.ts`; future providers should satisfy the same prepared-run and provider-result contract.

## CLI

The CLI in `src/cli.ts` remains thin:

- Parse command-line arguments.
- Apply CLI overrides.
- Call reusable core APIs.
- Print run summaries, status, history, and harness logs.

There is no TUI in v1. Bare `agentq` prints help and requires a command.

## Status And Stop

AgentQ is foreground-only by default. It does not intentionally launch background Codex work.

Run files store process metadata so later commands can discover candidate work:

- Agent runs store pid metadata in `~/.agentq/runs/<run-id>/run.json`.
- Harness runs store pid metadata in `~/.agentq/harness-runs/<run-id>/tasks.json`.

`agentq status` checks recorded pids against the OS process table. It reports liveness as `running` or `stopped`; the recorded file status is shown separately as the result. A run file with `status: running` is only live when the pid is alive on the current host.

`agentq stop <run>` resolves an agent or harness run, kills the recorded process tree when possible, and marks the run interrupted.

## Harness Layer

`agentq harness` sits above `runAgent` and keeps orchestration intentionally small. The legacy harness shape runs one agent, then optional command checks. Failed agent runs or failed checks retry the same agent while retries remain.

The structured harness shape adds explicit steps and a retryable loop. Steps before the loop run once and establish stable context, such as a task split. Steps inside the loop form one repairable attempt and retry together. Agent feedback informs the next loop attempt, but the harness owns routing, retry limits, and terminal status.

Harness definitions resolve only from `./.agentq/harnesses/<name>.yaml` before `~/.agentq/harnesses/<name>.yaml`.

Agent definitions resolve only from `./.agentq/agents/<id>.md` before `~/.agentq/agents/<id>.md`. AgentQ does not embed agents or harnesses; every runnable prompt and workflow should be inspectable as a project-local or home-local file.

Supported harness shape:

```yaml
name: work
agent: harness-builder
retries: 1

inputs:
  task: string

checks:
  - id: check
    command: ["bun", "run", "check"]
```

Structured harnesses use `steps`:

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
        - id: review
          agent: harness-reviewer
```

`over` resolves an array from a previous step result with `{{step.path}}` syntax. For each item, the harness runs the loop body until it succeeds, blocks, reports a non-retryable plan failure, or exhausts retries. `failureKind: "plan"` stops the loop because retrying the same implementation task unchanged is unlikely to help.

Harness runs accept `--input-text` for literal input and `--input-file` for files or stdin. JSON objects become structured inputs; other content becomes `inputs.task`.

Harnessed agent attempts call `runAgent`, override the effective result mode to `json`, and parse the final output as `AgentOutput`: `status`, `summary`, optional `result`, optional `feedback`, and optional `artifacts`.

Harness run directories keep only two harness-owned files:

```text
tasks.json
log.jsonl
```

`tasks.json` is the current state snapshot: inputs, status, process metadata, attempts, step results, timestamps, and summary. `log.jsonl` is the append-only event stream for harness starts, attempt starts/finishes, check results, and nested agent run directory pointers.

Agent stdout, stderr, raw JSONL, final answers, and agent-created artifacts stay in the agent run folders under `~/.agentq/runs/<agent-run-id>/`.

## Quality Gate

`bun run check` runs tests, TypeScript typechecking, and Google TypeScript Style linting.
