# Prompt Engineering Bridge

Use this file as the short entrypoint for Claude prompt work.

## Read These Modules

- `prompting-overview.md` for workflow and when prompt work is the right lever.
- `prompting-best-practices.md` for actual authoring patterns.
- `prompting-tools.md` for Claude Console drafting and refinement tools.

## Fast Guidance

For `aiman`, prompt robustness should usually come from:

- a narrow agent role
- explicit constraints
- explicit stop conditions
- concrete expected output guidance
- repeatable smoke tasks and evals

Not from:

- bloated runtime policy layers
- heavy per-agent frontmatter
- prompt hacks that are harder to maintain than the problem they solve

## Aiman Mapping

- Put task behavior in the authored agent body.
- Put stable repo-wide rules in shared repo context.
- Put eval loops and safety wrappers in harnesses.
- Use the runtime for minimal validation and persistence, not as the main prompt-engineering surface.
