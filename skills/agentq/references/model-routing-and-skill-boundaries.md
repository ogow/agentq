# Model Routing And Skill Boundaries

Use this reference when choosing model tiers, deciding whether an agent should
stay simple, or moving reusable knowledge into a skill.

## Model Routing

Use the cheapest model and reasoning effort that reliably handles the role.
Spend stronger models at decision points, not on every token.

| Work | Default | Escalate When |
| --- | --- | --- |
| Simple extraction, formatting, summaries | `gpt-5.4-mini` / `none` or `minimal` | Accuracy depends on subtle source interpretation. |
| Task splitting for obvious requests | `gpt-5.4-mini` / `medium` | The request is ambiguous, cross-cutting, or already failed once. |
| Bounded implementation | `gpt-5.4-mini` / `medium` | The builder must make architectural choices while editing. |
| Review | `gpt-5.4-mini` / `low` | Use `gpt-5.5` when correctness, integration risk, or subtle failure modes matter. |
| Failure diagnosis and agent improvement | `gpt-5.5` / `high` | Use when run evidence must be classified into prompt, harness, eval, runtime, or project-code fixes. |

For AgentQ harnesses, a strong default shape is:

```text
planner/splitter -> mini builder loop -> command checks -> stronger review when needed
```

For bounded coding tasks, prefer a detailed plan plus `gpt-5.4-mini` builders.
Use `gpt-5.5` to produce or repair the plan when the boundaries are unclear.

## Keep Agents Small

A good agent has one role, one output contract, and enough instructions to know
when to stop. It should not contain every reusable API note, workflow rule, or
example the model might ever need.

Use XML anchors inside agent prompts so boundaries are stable:

```md
<instructions>
<role>
You are a focused build agent.
</role>

<goal>
Complete exactly the assigned task.
</goal>

<evidence>
Inspect relevant files before making claims or edits.
</evidence>

<constraints>
Do not decide routing, retry policy, or the next agent. The harness owns those
decisions.
</constraints>
</instructions>
```

Use Markdown headings in skill/reference prose. Use XML anchors in agent
templates.

## When To Prefer A Skill

Prefer a skill when reusable knowledge is the heavy part.

| Keep A Simple Agent When | Move Knowledge To A Skill When |
| --- | --- |
| The role is one sentence. | The workflow has many reusable rules. |
| The prompt fits on one screen. | Examples, schemas, or API notes are long. |
| Only one agent needs the knowledge. | Several agents need the same guidance. |
| The task changes per run. | The guidance changes independently of tasks. |

Good skill candidates:

| Situation | Why A Skill Helps |
| --- | --- |
| A repeated workflow has many rules. | The agent can load focused instructions only when needed. |
| An API/library has details and examples. | The skill can hold references without bloating every agent. |
| Multiple agents need the same domain guidance. | One source avoids prompt drift. |
| The guidance changes independently from the agent role. | Update the skill without rewriting agents. |

Avoid creating a skill for one-off task details, temporary project context, or
information that belongs in `AGENTS.md`, `README.md`, `ARCHITECTURE.md`, or a
focused project doc.

## Specific Data Agent Pattern

Specific agents are useful when the task is narrow and repeated. For example, a
stock data agent can fetch and normalize public Yahoo Finance data without
turning every coding agent into a finance expert.

```md
---
id: yahoo-stock-snapshot
description: Collects a normalized public Yahoo Finance stock snapshot.
provider: codex
model: gpt-5.4-mini
reasoning: low
result_mode: json
sandbox: workspace-write
timeout: 10m
---

<instructions>
<role>
You collect public market data for one ticker.
</role>

<data_source>
Use Yahoo Finance endpoints available in the current environment.
</data_source>

<goal>
Return a normalized snapshot with the source URL, retrieval time, ticker,
currency, market price, previous close, market cap, trailing PE, forward PE,
dividend yield when available, and any missing fields.
</goal>

<constraints>
Do not provide investment advice. If network access, the ticker, or the endpoint
is unavailable, return blocked or failed with clear feedback.
</constraints>

<artifact_rules>
Write the full raw response and the normalized snapshot under {{artifacts}}.
</artifact_rules>
</instructions>

<task>
{{task}}
</task>

<artifacts>
<output_contract>
Final answer must be valid JSON only:

{
  "status": "success | failed | blocked",
  "summary": "Short result for the requested ticker.",
  "failureKind": "implementation | environment | blocked",
  "result": {
    "ticker": "",
    "sourceUrls": [],
    "snapshotPath": "",
    "rawResponsePath": "",
    "missingFields": []
  },
  "feedback": null,
  "artifacts": []
}
</output_contract>
</artifacts>
```

This should usually be a standalone agent or a data-gathering step inside a
larger research harness. If the workflow grows to include multiple providers,
field definitions, rate-limit handling, valuation methodology, retry policies,
or multiple output schemas, move that knowledge into a skill and keep the agent
prompt small.
