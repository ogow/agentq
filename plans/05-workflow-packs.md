# Plan 05: Workflow Packs

## Goal

Provide curated example agents and harnesses for common AgentQ workflows.

This should make AgentQ easier to adopt without turning the CLI into a magical
workflow engine.

Workflow packs should stay Unix-shaped: copyable files, explicit commands, and
plain records. They should not require a registry, daemon, wizard, or server.

## Depends On

Best after:

- Plan 01: run inspection
- Plan 03: local eval packs
- Plan 04: output contracts, if available

Workflow packs should benefit from contracts and eval smoke tests, but the first
version can still be examples-only.

## First Harness Run Scope

Create examples/templates only.

Do not add a new install command, template generator, or built-in workflow
registry in the first pass.

## User Problem

AgentQ has primitives, but a new user still has to decide:

- which agents to write
- which harness shape to copy
- where retries belong
- which checks to run
- how to structure final JSON
- how to inspect the result

Good examples shorten that path and make best practices concrete.

## Pack Location

Prefer examples under:

```text
skills/agentq/examples/
```

Possible structure:

```text
skills/agentq/examples/workflow-packs/
  bugfix-loop/
    agents/
      bugfix-builder.md
      bugfix-reviewer.md
    harnesses/
      bugfix-loop.yaml
    README.md

  feature-build/
    agents/
      feature-builder.md
      feature-reviewer.md
    harnesses/
      feature-build.yaml
    README.md

  docs-refresh/
    agents/
      docs-builder.md
      docs-reviewer.md
    harnesses/
      docs-refresh.yaml
    README.md
```

If this is too much for one harness run, start with two packs:

1. `bugfix-loop`
2. `feature-build`

## Initial Packs

### Bugfix Loop

Purpose:

- reproduce or understand a failure
- patch focused code
- run focused checks
- run full `bun run check` when appropriate
- review for regressions

Harness shape:

- optional splitter
- loop around build/check/review
- retries: 1 or 2

Key prompt behaviors:

- inspect failing evidence first
- keep edits scoped
- return `AgentOutput`
- use feedback object on failure

### Feature Build

Purpose:

- implement a bounded feature plan
- update tests/docs
- verify behavior
- review result

Harness shape:

- splitter before loop
- build/check/review inside loop
- retry boundary is one implementation task

Key prompt behaviors:

- do not re-plan unless assigned task is invalid
- prefer repo patterns
- run relevant tests
- return changed files and verification

### Docs Refresh

Purpose:

- update README/architecture/docs after behavior changes
- keep docs grounded in code
- avoid generated marketing copy

Harness shape:

- one builder plus optional reviewer
- lower retry count

Key prompt behaviors:

- inspect code before editing docs
- update durable docs only
- do not create memory files

### Agent Improvement

Purpose:

- inspect failed runs
- identify prompt/harness gaps
- propose or patch prompt changes

This may wait for Plan 06 if it needs richer run evidence.

### Eval Suite Smoke Test

Purpose:

- provide a tiny `.agentq/evals` example pack
- show deterministic graders

This should wait until Plan 03 exists.

## README Requirements

Each pack README should include:

- when to use it
- files included
- how to copy into `.agentq`
- how to run it
- how to inspect results
- what not to use it for

Example command:

```sh
bun run agentq harness run bugfix-loop --input-text "Fix the failing auth test."
```

## Tests

Examples should not rot.

Add tests near `tests/examples.test.ts`:

- example agent files parse
- example harness files parse
- example harnesses reference existing example agents
- examples do not resolve as embedded project harnesses unless explicitly copied
- example docs mention run and inspect commands

If output contracts exist:

- example harnesses should use at least one `requires` block where helpful

If eval packs exist:

- example eval pack should parse

## Acceptance Criteria

- At least two workflow packs exist as examples/templates.
- Each pack has agents, harnesses, and a README.
- Tests protect parsing and references.
- Main README points users to workflow-pack examples.
- No new CLI install/template command is added.
- `bun run check` passes.

## Non-goals

- No built-in workflow registry.
- No `agentq init workflow` command.
- No automatic copying into projects.
- No new runtime behavior unless examples expose a missing validation bug.
- No broad prompt refactor of existing project-local agents unless required by
  example consistency.
- No MCP dependency.

## Risks

| Risk | Mitigation |
| --- | --- |
| Examples become stale | Add parse/reference tests. |
| Too many packs dilute quality | Start with two high-value packs. |
| Users confuse examples with built-ins | Document copy/run steps clearly. |
| Pack prompts diverge from repo conventions | Reuse existing local harness agent patterns. |

## Suggested Harness Command

```sh
bun run agentq harness run devloop --input-file plans/05-workflow-packs.md
```
