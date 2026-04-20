---
name: agentq
description: AgentQ agent and harness authoring and operation. Use when creating or improving AgentQ Markdown agents, setting up one-pass or looping harnesses, choosing model/reasoning/result-mode/sandbox settings, running agents with the agentq CLI, inspecting previous runs and artifacts, debugging failed or low-quality runs, or designing orchestration.
---

# AgentQ

Use AgentQ as a local-first toolkit for creating reliable agents and harnesses that are easy for humans to set up, run, and inspect.

The basic purpose is simple: put reusable agent prompts in `.agentq/agents`, put repeatable workflows in `.agentq/harnesses`, run them with `agentq`, and use saved artifacts to improve the next run from evidence.

## Workflow

Start with the smallest useful shape:

```text
agent file -> agentq run
harness file + agent files -> agentq harness run
saved run records -> inspect -> improve
stable failure modes -> eval pack -> compare -> improve
```

Create a single focused agent when one role can do the job. Create a harness when the workflow should own planning, verification, retries, feedback, or durable run records.

During planning, use focused `agentq run` calls as research tools. A main LLM can run browser explorers, test inventory agents, or code mappers, inspect their `output.md` files, and synthesize a plan. Use `agentq harness run work --input-file plan.md` when the plan is ready to implement.

For implementation work, prefer one general build agent that can both add features and repair issues. Let the harness decide when to call it again with feedback from the previous attempt.

Use eval packs after manual runs reveal a behavior worth preserving or improving. Keep evals local-first: write TypeScript packs in `.agentq/evals`, run them with `agentq eval run`, inspect `results.json` and `log.jsonl`, and use nested run pointers to debug the exact agent or harness attempt.

## Read References As Needed

- For creating well-structured agents, model/reasoning choices, and templates, read [references/agent-authoring.md](references/agent-authoring.md).
- For exact artifact delivery contracts and highly reliable prompt patterns, read [references/reliability-and-artifacts.md](references/reliability-and-artifacts.md).
- For complete examples of well-structured plain-text and JSON/harness agents, read [references/examples.md](references/examples.md).
- For CLI commands, run outputs, artifact locations, and previous-run lookup, read [references/cli.md](references/cli.md).
- For setting up one-pass steps, loop harnesses, planner decisions, harness input, and run records, read [references/harnesses.md](references/harnesses.md).
- For local eval packs, deterministic graders, run records, and high-quality eval design, read [references/evals.md](references/evals.md).
- For debugging agents and deciding between manual orchestration and `agentq harness`, read [references/debugging-and-orchestration.md](references/debugging-and-orchestration.md).

## Defaults

- Prefer project-local agents in `.agentq/agents/<id>.md` for project-specific work.
- Prefer global agents in `~/.agentq/agents/<id>.md` for reusable workflows.
- AgentQ does not embed agent prompts or harness definitions. Copy example agents and harnesses into the repo or home before running them.
- Prefer project-local harnesses in `.agentq/harnesses/<name>.yaml` and global harnesses in `~/.agentq/harnesses/<name>.yaml`.
- Use `{{task}}` inside `<task>` and `{{artifacts}}` inside `<artifacts>` when authoring templates.
- Keep final answers concise and useful: what happened, what changed, what was verified, and what remains uncertain.
- Do not build eval infrastructure before manual runs reveal stable failure modes.
- Prefer one behavior family per eval pack. Add typical, edge, and adversarial cases, then use narrow deterministic graders for the properties that matter.
- Treat eval cases as durable product evidence: clear ids, explicit pass criteria, inspectable fixtures, and no dependence on hidden services.
- Store extra agent-created files only under the provided `{{artifacts}}` directory. Project files should change only when the agent's job is to edit the workspace.
- Use `agentq harness` when the workflow should own routing, planning, feedback, task state, command steps, or repeated work.
- Keep repair loops minimal: pass the failed status, concise feedback, and relevant artifact paths back to the same build agent.
- For loops, put one-time planning/setup before the loop step, then put repeated repairable agent/command steps under `loop.steps`. Use `loop.retries` as the retry budget and `loop.over: "{{split.tasks}}"` when a splitter step returns task items.
