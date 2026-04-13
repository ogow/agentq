# Guardrails For Prompt Leak

Claude's guidance on prompt leak is deliberately cautious: leak resistance adds complexity and can hurt normal task quality.

## Recommended Approach

- only add leak-resistant prompt techniques when truly necessary
- prefer monitoring and post-processing first
- avoid including sensitive material that the model does not actually need
- audit prompts and outputs regularly

## Techniques

- separate sensitive context from user queries as cleanly as possible
- restate key non-disclosure rules explicitly
- use post-processing or screening to catch leaked material
- minimize proprietary details in the prompt itself

## Tradeoffs

- stronger leak-prevention instructions can make the overall prompt harder to follow
- extra defensive complexity can reduce performance on the primary task
- the safest secret is the one never placed in the prompt at all

## How To Apply In Aiman

For `aiman`, prompt-leak defense should stay conservative.

- Do not put unnecessary secrets or sensitive internal instructions in authored agents.
- Keep shared repo context lean and limited to information the provider actually needs.
- Prefer external secret handling and runtime environment isolation over clever prompt tricks.
- If leak risk is real, add post-run screening or harness-level checks before expanding the prompt contract.
