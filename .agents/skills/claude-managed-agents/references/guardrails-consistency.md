# Guardrails For Consistency

Claude's consistency guidance separates two cases:

- general consistency in tone and structure
- guaranteed schema conformance

For strict schema conformance, Claude recommends structured outputs instead of prompt-only tricks.

## Techniques That Improve Consistency

- specify the desired output format precisely
- use examples that demonstrate the format clearly
- use reusable templates
- break complex work into smaller subtasks when one prompt is too inconsistent
- keep the model in a clear role

Older prefill techniques appear in some Claude material, but newer models rely more on explicit instructions and structured outputs than assistant-prefill hacks.

## When To Use Hard Structure

Use hard structure when:

- another system must parse the result
- invalid formatting is expensive
- downstream automation depends on specific fields

Use softer prompt guidance when:

- the result is primarily for a human
- some wording flexibility is helpful
- schema rigidity would make the agent harder to use than necessary

## How To Apply In Aiman

Map this directly to `resultMode`.

- Use `text` by default for human-facing agents.
- Use `schema` only when another tool, harness, or agent truly needs machine-readable output.
- Keep schema-mode contracts small: stable `outcome` values, well-named `result` fields, and optional `next` only when needed.
- Improve consistency first through examples, `Expected Output`, and tighter task boundaries before adding more runtime enforcement.
