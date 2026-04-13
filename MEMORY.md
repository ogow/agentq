# Memory

- AgentQ is CLI-first and currently targets Bun + TypeScript.
- The primary command is `agentq run <agent> --task <task>`.
- Agent files are Markdown with YAML frontmatter and required `<task>` plus `<artifacts>` anchors; authored templates use `{{task}}` inside `<task>` and `{{artifacts}}` inside `<artifacts>` as placeholders that AgentQ replaces at run time.
- Agent frontmatter includes a required `description` field for discovery and reports.
- Agent runtime frontmatter must explicitly set `provider`, `model`, `reasoning`, and `result_mode`; use `reasoning: none` when the model does not support reasoning, and choose `result_mode: plain` for human-facing output or `result_mode: json` for harness/orchestrator parsing.
- AgentQ injects the effective result mode into the rendered `<artifacts>` prompt block so CLI overrides affect provider instructions, not only metadata.
- Context file selection belongs to AgentQ config or the `--context-file` run override, not agent frontmatter.
- Project-local agents in `.agentq/agents/<id>.md` override global agents in `~/.agentq/agents/<id>.md`.
- Run history belongs under `~/.agentq/runs`, not inside the project repository, and is inspected with `agentq runs list`.
- The installable AgentQ skill lives at root `skill/` with skill name `agentq`; it documents reusable agent authoring, exact artifact delivery, plain-vs-JSON output contracts, example agents, reliability patterns, CLI usage, debugging, and orchestration guidance rather than project-only instructions.
- Terminal output is rendered from normalized AgentQ events with Chalk; default run summaries are compact, while `--details`/`--verbose` expose richer inspection output and durable logs remain JSONL plus `run.json`.
- Codex execution stays behind a provider adapter; core agent/run logic should remain importable without the CLI.
- Codex JSONL is normalized into typed AgentQ events; `run.json` records event count, changed files, tool usage, and failure metadata.
- Code quality is enforced with Google TypeScript Style (`gts`) through `bun run check`; use `bun run fix` for safe formatting and lint fixes.
