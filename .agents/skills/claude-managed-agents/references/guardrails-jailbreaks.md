# Guardrails For Jailbreaks

Claude's jailbreak guidance is layered rather than magical.

## Recommended Layers

- screen inputs for harmful or abusive patterns
- use clear policy prompts for legal, safety, or privacy boundaries
- refuse disallowed actions consistently
- monitor repeated abuse patterns
- combine screening and response-time safeguards for sensitive use cases

For stricter cases, Claude recommends a separate screening step with structured output rather than trusting one large prompt to do everything.

## Practical Guardrail Shape

Useful layers include:

- lightweight classifier or screening step
- explicit policy language in the main prompt
- refusal language for disallowed requests
- output review or monitoring for repeated failures

## Tradeoffs

- stronger guardrails can add latency and complexity
- overbuilt policy prompts can degrade normal-task quality
- one giant monolithic prompt is usually weaker than a small layered system

## How To Apply In Aiman

In `aiman`, jailbreak mitigation should usually belong in the harness, not the agent frontmatter.

- Keep agent bodies focused on their job and task boundaries.
- Put reusable safety rules in shared repo context when they are stable and repo-wide.
- For risky domains, add a separate pre-screen or policy-check step in the calling harness.
- Avoid turning the core runtime into a universal moderation layer unless the product truly requires it.
