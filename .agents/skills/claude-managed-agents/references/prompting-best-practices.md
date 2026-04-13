# Prompting Best Practices

Claude's prompt guidance is mostly about reducing ambiguity and making the task easy to parse.

## Core Techniques

- Be clear and direct. State the task, constraints, and expected output explicitly.
- Add context when the reason behind a rule helps the model generalize correctly.
- Use examples when format, tone, or decision boundaries matter.
- Structure complex prompts with XML tags or other strongly separated sections.
- Give the model a role when you want a stable stance, tone, or decision standard.

## Long-Context And Grounding Patterns

For large inputs, Claude recommends:

- put long documents near the top of the prompt
- keep the actual question near the end
- structure documents with clear tags and metadata
- ask for relevant quotes before analysis when factual grounding matters

These patterns reduce confusion and help the model ground its answer in the supplied materials instead of improvising.

## Output Control

Claude's guidance for formatting is practical:

- tell the model what to do, not just what to avoid
- match the prompt style to the desired output style
- be explicit about prose vs lists vs tagged output
- use schema-constrained output when you truly need hard structure

For newer Claude models, older prefill tricks are less important. Prefer explicit instructions and structured outputs over prefill-style hacks.

## Thinking And Agentic Use

Claude recommends deeper reasoning only when the task needs it.

- use medium effort for general work
- use higher effort for genuinely complex coding or research
- avoid forcing elaborate reasoning for simple tasks
- for investigative work, tell the model to inspect evidence before answering

## Failure Modes To Watch

- vague instructions produce vague outputs
- too many unrelated goals make the agent wander
- hidden assumptions force the model to guess
- long prompts without clear sections increase format drift
- overbuilt prompts can hurt latency and sometimes reliability

## How To Apply In Aiman

Use this as the default authoring pattern for `aiman` agents:

- Keep every agent narrow.
- Use the standard body sections: `Role`, `Task Input`, `Instructions`, `Constraints`, `Stop Conditions`, `Expected Output`.
- Use `Stop Conditions` to tell the agent when to return `blocked` or admit uncertainty.
- For factual or repo-grounded tasks, tell the agent to inspect files first and to cite or quote evidence when needed.
- Prefer `resultMode: "text"` unless another tool or agent really needs machine-readable output.
- For `schema` agents, keep the runtime envelope small and describe only the task-specific `result` fields and `outcome` values in the prompt.
