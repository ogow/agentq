# Testing And Evals

Claude's guidance treats evals as part of prompt engineering, not an optional afterthought.

## Start With Success Criteria

Define success before tuning the prompt.

Good success criteria are:

- specific
- measurable
- achievable
- relevant

Common dimensions include:

- task fidelity
- consistency
- relevance and coherence
- tone and style
- privacy or safety behavior
- context use
- latency
- cost

## Eval Design

Useful eval sets should:

- mirror real task distribution
- include edge cases
- separate common cases from rare but important failures
- compare prompt versions against the same test set

Claude's evaluation-tool guidance also emphasizes prompt templates with variables so you can vary inputs cleanly across cases.

## Evaluation Tool Takeaways

The Claude Console evaluation tooling is built around:

- prompt templates with variables
- generated or imported test cases
- side-by-side comparison
- versioned prompt iteration

The product itself is Console-specific, but the method generalizes well:

- keep one stable prompt
- vary the inputs
- record outputs systematically
- compare versions instead of relying on memory

## Latency Guidance

Claude's latency advice is intentionally downstream of quality.

- first make the prompt work
- then optimize latency

Main levers:

- choose the right model
- reduce prompt and output length
- constrain unnecessary verbosity
- stream outputs when responsiveness matters

## How To Apply In Aiman

For `aiman`, evals belong in harnesses and repeatable scripts, not in the core runtime.

- Create tiny smoke tasks for authored-agent debugging.
- Build small fixed eval sets for important agents.
- Measure quality first, then measure latency on the prompts that already meet the quality bar.
- Keep one task family per eval suite so regressions are obvious.
- Treat `run.json` as the inspection record, but keep scoring and pass/fail logic in the harness or eval script.
