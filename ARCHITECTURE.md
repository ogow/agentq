# Architecture

AgentQ is split into a reusable core, provider adapters, and a thin CLI.

## Core

The core package under `src/core` owns:

- Agent file parsing and validation.
- Required prompt anchors.
- Run configuration merging.
- Explicit runtime selection for `provider`, `model`, and `reasoning`.
- Tool-level config loading from `.agentq/config.json` and `~/.agentq/config.json`.
- Agent and context-file resolution.
- Run directory creation.
- Run history discovery from `~/.agentq/runs`, sorted by `run.json` timestamps.
- Artifact directory path injection for agents that need to save extra files.
- Codex JSONL normalization into typed AgentQ events.
- Changed-file, tool-usage, event-count, and failure metadata summaries.
- Chalk-backed rendering for live progress, event timelines, run summaries, and run history tables.
- Metadata shape and writing.

The core exposes importable APIs through `src/core/index.ts`.

## Providers

Provider adapters live under `src/providers`.

The first provider is Codex. It invokes `codex exec --json` with argv arrays, allows non-git working directories, captures stdout JSONL and stderr logs, normalizes the JSONL stream into AgentQ events, and asks Codex to write the final message to `output.md`.

Provider-neutral types live in `src/core/types.ts`; future providers should satisfy the same prepared-run and provider-result contract.

## CLI

The CLI in `src/cli.ts` uses `yargs` and should remain thin:

- Parse command-line arguments.
- Apply CLI overrides.
- Call reusable core APIs.
- Print run summaries and run history tables.

## Quality Gate

`bun run check` runs tests, TypeScript typechecking, and Google TypeScript Style (`gts`) linting.
