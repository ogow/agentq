# Agent Authoring

## Purpose

Create AgentQ agents as readable Markdown documents with YAML frontmatter for runtime settings and XML-like anchors for important prompt boundaries.

## Required Shape

```md
---
id: reviewer
description: Reviews code changes for correctness issues.
provider: codex
model: gpt-5.4-mini
reasoning: low
result_mode: plain
sandbox: read-only
timeout: 5m
---

<instructions>
You are a focused code reviewer.

Find correctness bugs, missing verification, and risky behavior changes.
Do not comment on style unless it affects correctness.
</instructions>

<task>
{{task}}
</task>

<artifacts>
Write the final answer to the normal AgentQ output.
If you create extra files, write them under {{artifacts}}.
</artifacts>
```

Required frontmatter fields:

- `id`: short stable id used by `agentq run <id>`.
- `description`: human-readable purpose for lists and reports.
- `provider`: currently `codex`.
- `model`: model name for the provider.
- `reasoning`: `none`, `minimal`, `low`, `medium`, `high`, or `xhigh`.
- `result_mode`: `plain` for human-readable output or `json` for harness/orchestrator parsing.
- `sandbox`: `read-only`, `workspace-write`, or `danger-full-access`.
- `timeout`: duration such as `100ms`, `1m`, or `1h`.

Useful optional fields:

- `approval`: provider approval policy when supported.
- `env`: string map of environment variables needed by the run.

## Prompt Structure

Use anchors sparingly and consistently:

- `<instructions>`: durable behavior and role.
- `<task>`: include `{{task}}` as the human-visible placeholder; AgentQ replaces the tag contents with the run task.
- `<artifacts>`: final answer and file output contract. Use `{{artifacts}}` as the run artifact directory placeholder.
- `<context>`: optional local notes that are part of the agent, not the project context file.
- `<verification>`: commands, checks, or evidence expected before claiming success.
- `<handoff>`: optional format for an orchestrator or later human.

Good agents are narrow. Prefer one job per agent: reviewer, fixer, summarizer, test-writer, release-note drafter, migration planner.

## Model And Reasoning Choice

Use the cheapest model/reasoning pair that reliably does the job. Prefer local project defaults when they exist.

| Agent work | Model tier | Reasoning |
| --- | --- | --- |
| Formatting, summarizing, listing, simple extraction | smaller/mini | `none` or `minimal` |
| Focused review, simple code edits, docs updates | smaller/mini or default frontier | `low` |
| Multi-file code changes, debugging, migration planning | frontier | `medium` |
| Complex architecture, ambiguous failures, security-sensitive review | frontier | `high` |
| Rare deep investigation where cost/latency is acceptable | strongest frontier | `xhigh` |

Practical defaults:

- Use `gpt-5.4-mini` with `reasoning: low` for most fast project agents.
- Use `gpt-5.4` with `reasoning: medium` for agents that edit code across files or need stronger judgment.
- Use `reasoning: none` only when the agent mostly transforms or summarizes information and does not need planning.
- Avoid `high`/`xhigh` until manual runs prove the agent needs it.

## Sandbox And Timeout Choice

- `read-only`: reviewers, summarizers, planners, auditors.
- `workspace-write`: builders, fixers, test writers, docs writers.
- `danger-full-access`: only for agents that truly need access outside the workspace; explain why in the agent or run task.

Timeout guidance:

- `1m`: tiny smoke agents.
- `5m`: normal review or documentation agents.
- `10m` to `30m`: code-changing or debugging agents.
- Longer: only when the task is intentionally long-running.

## Final Answer Contract

Tell agents to end with practical output:

```md
Final answer should include:
- Outcome: succeeded, blocked, or partial.
- What changed or what was found.
- Verification performed.
- Important run artifacts or files created.
- Remaining uncertainty or next action.
```

For human-facing agents, prefer text output. Use strict schema-like output only when another tool or orchestrator will parse the result.

## Plain Text Versus JSON

Choose output format from the consumer:

- Use plain structured text when the user will read the result directly.
- Use JSON when a harness, orchestrator, script, or later agent must parse the result.
- Do not use JSON just because it feels rigorous; invalid or over-complex JSON is worse than a clear human answer.
- If JSON is required, make the final answer valid JSON only, with no surrounding prose or Markdown fences.
- Set `result_mode: plain` for plain structured text.
- Set `result_mode: json` for valid JSON-only output.
- AgentQ injects the selected result mode into the rendered `<artifacts>` contract, including CLI overrides.

Recommended plain sections:

```text
Outcome: succeeded | partial | blocked
Summary:
Verification:
Artifacts:
Next:
```

Recommended JSON envelope:

```json
{
  "outcome": "succeeded",
  "summary": "One short sentence.",
  "findings": [],
  "changed_files": [],
  "artifacts": [],
  "verification": {
    "status": "passed",
    "commands": []
  },
  "blocked_reason": null,
  "next": null
}
```

For harnessed agents, include enough fields for feedback and retry:

- `outcome`: `succeeded`, `partial`, or `blocked`.
- `summary`: short human-readable result.
- `artifacts`: paths under the run artifact directory from `{{artifacts}}`.
- `verification`: commands or checks performed, plus status.
- `blocked_reason`: why the harness should not treat the run as successful.
- `next`: concrete retry or follow-up instruction when useful.
