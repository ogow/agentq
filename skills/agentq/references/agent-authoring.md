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
<role>
You are a focused code reviewer.
</role>

<goal>
Find correctness bugs, missing verification, and risky behavior changes.
Do not comment on style unless it affects correctness.
</goal>
</instructions>

<task>
{{task}}
</task>

<artifacts>
<output_contract>
Write the final answer to the normal AgentQ output.
If you create extra files, write them under {{artifacts}}.
</output_contract>
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

Use XML anchors sparingly and consistently. Use Markdown headings in skill and
reference prose; use XML anchors inside agent prompts.

- `<instructions>`: durable behavior and role.
- `<role>`: the agent's identity and perspective.
- `<goal>`: the single job to complete.
- `<evidence>`: files, commands, records, or context to inspect before claims.
- `<constraints>`: permissions, non-goals, and stop conditions.
- `<verification>`: commands, checks, or evidence expected before claiming success.
- `<task>`: include `{{task}}` as the human-visible placeholder; AgentQ replaces the tag contents with the run task.
- `<artifacts>`: final answer and file output contract. Use `{{artifacts}}` as the run artifact directory placeholder.
- `<artifact_rules>`: where extra files may be written.
- `<output_contract>`: exact final answer shape.
- `<context>`: optional local notes that are part of the agent, not the project context file.
- `<handoff>`: optional format for an orchestrator or later human.

Good agents are narrow, but avoid splitting roles just because task history changes. A build agent can handle both new implementation and repair when the harness provides clear feedback. Use specialist agents for genuinely different jobs such as review, summarization, test writing, release notes, or migration planning.

When a prompt grows because it is carrying reusable workflow or library
knowledge, prefer moving that knowledge into a skill or focused reference doc.
Keep the agent responsible for the role and output contract, not every detail it
might ever need. See `docs/robust-agents-and-harnesses.md` for the design
checklist.

## Model And Reasoning Choice

Use the cheapest model/reasoning pair that reliably does the job. Prefer local project defaults when they exist.

| Agent work | Model tier | Reasoning |
| --- | --- | --- |
| Formatting, summarizing, listing, simple extraction | smaller/mini | `none` or `minimal` |
| Focused review, simple code edits, docs updates | smaller/mini | `low` |
| Bounded implementation from a clear plan | smaller/mini | `medium` |
| Ambiguous planning, multi-file design, subtle review | frontier | `medium` or `high` |
| Failure diagnosis and agent improvement from run evidence | strongest available frontier | `high` |

Practical defaults:

- Use `gpt-5.4-mini` with `reasoning: low` or `medium` for most fast project agents and bounded implementation tasks.
- Use `gpt-5.5` for difficult planning, high-value review, and failure diagnosis where better judgment can reduce bad retries.
- Use `reasoning: none` only when the agent mostly transforms or summarizes information and does not need planning.
- Avoid `high`/`xhigh` until manual runs prove the agent needs it.
- For a fuller routing policy, read [model-routing-and-skill-boundaries.md](model-routing-and-skill-boundaries.md).

## Sandbox And Timeout Choice

- `read-only`: reviewers, summarizers, planners, auditors.
- `workspace-write`: builders, test writers, docs writers.
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

Recommended JSON envelope for non-harness scripts or custom orchestrators:

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

For harnessed worker, reviewer, and validation agents, use the shared `AgentOutput` contract:

- `status`: `success`, `failed`, or `blocked`.
- `summary`: short human-readable result.
- `failureKind`: optional failure category such as `implementation`, `check`, `review`, `plan`, `blocked`, or `environment`.
- `result`: optional machine-readable task result, usually `{changedFiles: [], verification: []}` for build agents.
- `feedback`: `null` or a problem object when failed or blocked.
- `artifacts`: optional stable artifact objects.

Agents running inside a harness must not include `nextTask`, `nextAgent`, retry policy, or routing instructions. The harness owns those decisions.

For splitter agents that feed loop items, return the same `AgentOutput` contract and put loop items under `result.tasks`, as documented in [harnesses.md](harnesses.md).
