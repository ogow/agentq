# AgentQ Implementation Phases

## Phase 1: Executable Thin Slice

Build a small but real CLI that can resolve an agent, validate it, create a run directory, invoke `codex exec --json`, and save artifacts.

Delivered:

- Bun and TypeScript project scaffold.
- `agentq run <agent> --task <task>` as the primary command.
- `agentq agents list` for discovery.
- Provider-neutral core types.
- Codex provider adapter.
- Markdown + YAML frontmatter parser.
- Explicit required runtime fields: `provider`, `model`, and `reasoning`.
- Tool-level context-file config outside agent definitions.
- Required anchors for `<task>` and `<artifacts>`.
- Run directories in `~/.agentq/runs`.
- Captured `run.json`, `stdout.jsonl`, `stderr.log`, and `output.md`.
- Optional task artifacts can be written under the run's `artifacts/` directory.
- Finished runs print the final response plus relevant run locations.

## Phase 2: Stronger Run Contract

Delivered:

- Normalize Codex JSONL events into typed AgentQ events.
- Record changed files and tool usage summaries.
- Improve terminal progress rendering.
- Add richer failure metadata.
- Add focused tests around timeout behavior.
- Add Chalk-rendered live progress, verbose event timelines, and final run cards.

## Phase 3: Configuration Layers

- Add project defaults.
- Add global defaults.
- Preserve the precedence order from `docs/starting.md`.
- Add validation messages that explain which layer supplied each setting.

## Phase 4: Harness and Test Primitives

- Add reusable harness package APIs.
- Add prompt hardening utilities.
- Add agent test fixtures and golden output helpers.

## Phase 5: Orchestration

- Add multi-agent run primitives.
- Add handoff artifacts.
- Add run comparison and pruning tools.
