# Guardrails For Hallucinations

Claude's main hallucination guidance is to reduce guessing and increase grounding.

## Recommended Techniques

- Explicitly allow the model to say it does not know.
- Ask for direct quotes before analysis when working from long documents.
- Require claims to be supported by quotes or citations.
- Restrict the model to the supplied materials when external knowledge would be risky.
- Use verification passes when the task is high stakes.

## Strong Patterns

High-signal grounding patterns include:

- quote extraction first, analysis second
- claim generation followed by support verification
- retract unsupported claims instead of leaving them in the answer
- compare multiple runs only when inconsistency itself is a useful warning signal

## Tradeoffs

- more grounding steps usually increase latency
- forcing verification on every task can be excessive
- quote-first workflows are most useful when source fidelity matters more than speed

## How To Apply In Aiman

For `aiman`, hallucination control should mostly live in the authored prompt and harness.

- Tell analysis agents to return `blocked` when evidence is missing.
- For repo-grounded work, instruct the agent to inspect files before concluding.
- For document-review or policy tasks, require direct quotes or evidence references in the output.
- Do not add a generic runtime “anti-hallucination” system. Keep the runtime thin and make high-stakes grounding opt-in per agent or harness.
