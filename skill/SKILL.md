---
name: agentq
description: AgentQ agent authoring and operation. Use when creating or improving AgentQ Markdown agents, choosing model/reasoning/sandbox settings, running agents with the agentq CLI, inspecting previous runs and artifacts, debugging failed or low-quality agent runs, or designing a main/orchestrator agent that delegates work to AgentQ agents.
---

# AgentQ

Use AgentQ as a local-first harness for authored agents. Keep the runtime thin: write clear agent files, run them through `agentq`, inspect saved artifacts, and improve the agent or task boundary from evidence.

## Workflow

1. Clarify the agent's job, risk level, expected inputs, and desired output.
2. Author or update a Markdown agent with YAML frontmatter plus stable anchors.
3. Choose model, reasoning, sandbox, timeout, and approval from the work the agent must do.
4. Run the agent with `agentq run <agent> --task "..."`.
5. Inspect the compact result first, then use run artifacts or `--verbose`/`--details` when debugging.
6. Convert repeated failures into better instructions, stronger artifact contracts, or later eval cases.

## Read References As Needed

- For creating well-structured agents, model/reasoning choices, and templates, read [references/agent-authoring.md](references/agent-authoring.md).
- For exact artifact delivery contracts and highly reliable prompt patterns, read [references/reliability-and-artifacts.md](references/reliability-and-artifacts.md).
- For complete examples of well-structured plain-text and JSON/harness agents, read [references/examples.md](references/examples.md).
- For CLI commands, run outputs, artifact locations, and previous-run lookup, read [references/cli.md](references/cli.md).
- For debugging agents and designing a main/orchestrator agent that delegates to AgentQ agents, read [references/debugging-and-orchestration.md](references/debugging-and-orchestration.md).

## Defaults

- Prefer project-local agents in `.agentq/agents/<id>.md` for project-specific work.
- Prefer global agents in `~/.agentq/agents/<id>.md` for reusable workflows.
- Keep final answers concise and useful: what happened, what changed, what was verified, and what remains uncertain.
- Do not build eval infrastructure before manual runs reveal stable failure modes.
