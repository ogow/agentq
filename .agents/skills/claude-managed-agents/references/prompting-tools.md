# Prompting Tools

Claude's Console includes tooling for drafting and refining prompts. These tools are useful accelerators, not substitutes for grounded testing.

## Main Tools

### Prompt Generator

Useful for getting past the blank page problem.

- creates a first prompt draft
- helps identify reusable variables
- usually produces a more structured starting point than an ad hoc first attempt

### Prompt Templates And Variables

Claude recommends separating:

- fixed prompt content
- variable inputs

This makes prompts easier to:

- reuse
- version
- evaluate
- compare across test cases

### Prompt Improver

Useful when a prompt already exists but still fails on quality or consistency.

It tends to add:

- clearer sections
- XML structure
- stronger reasoning steps
- more explicit formatting guidance

That often improves quality, but can increase verbosity and latency.

## Tradeoffs

- generator output is a starting point, not a final contract
- improver output can become heavier than needed
- templates help evaluation and reuse, but only if your variables are well chosen
- prompt-tool suggestions should still be tested against real tasks and edge cases

## How To Apply In Aiman

Use these ideas as workflow guidance, not runtime features.

- Draft authored agents like prompt templates: stable instructions plus `{{task}}` and other runtime placeholders.
- Treat generated or improved prompts as scaffolds that still need `aiman agent check` and smoke runs.
- Keep the final authored agent simpler than the full Console-improver style when speed and clarity matter more than maximum thoroughness.
- Use template-style thinking for harnesses and eval scripts: vary inputs cleanly while keeping the core prompt stable.
