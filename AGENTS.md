# AgentQ Repo Instructions

Keep information easy to digest. Prefer short paragraphs and compact tables over long dotted lists.

This repo is a Bun and TypeScript CLI project. The main local quality command is:

```sh
bun run check
```

AgentQ should follow Unix methodology. Prefer small composable commands, plain text or JSON/JSONL records, useful exit codes, and file-system state that a human can inspect with tools like `cat`, `jq`, `tail`, and `rg`. Avoid hidden services, background daemons, databases, dashboards, or broad frameworks unless a simple CLI/file design has clearly stopped being enough.

Design features as thin layers over stable local records. A CLI command should do one job well and produce output that another command or script can consume. When machine-readable output is useful, prefer explicit `--json` or `--ndjson` flags over changing human-readable defaults.

MCP should be treated as an optional adapter over AgentQ's existing commands and files, not as the core architecture. Do not introduce an MCP server, socket, or long-running process for basic local behavior. Consider MCP only after the CLI and file contracts are stable and another agent host needs structured access to AgentQ runs, harnesses, evals, or commands.

Harness-related work should preserve the current simple run model:

```text
~/.agentq/harness-runs/<run-id>/
  log.jsonl
  tasks.json
```

The harness log should contain harness events and pointers to nested agent run directories. Agent stdout, stderr, raw JSONL, final answers, and agent-created artifacts belong under `~/.agentq/runs/<agent-run-id>/`.

When changing harness behavior, update focused tests in `tests/harness.test.ts`, CLI behavior in `src/cli.ts` when needed, and durable docs or memory when the behavior changes.

Do not add extra harness files unless there is a clear reason. Prefer `tasks.json` for current state and `log.jsonl` for what happened.

For structured harnesses, treat a `loop` as the retry boundary. Steps before the loop run once to produce stable context; steps inside the loop retry together with feedback. Do not re-run planning/splitting unless a step reports a plan failure or the harness explicitly supports replanning.

Do not maintain separate memory files in this repo. Durable guidance belongs in `AGENTS.md`, `ARCHITECTURE.md`, `README.md`, or focused docs; run history belongs in AgentQ run records.
