# AgentQ Reliability Layer Plans

This folder breaks the reliability roadmap into separate, harness-ready plans.

The rule for using these plans is simple: run one plan at a time. Each plan has
its own scope, non-goals, acceptance criteria, and verification. Do not bundle
multiple plans into one harness run unless a later plan explicitly says it is a
small follow-up to an earlier one.

## Current Foundation

AgentQ already has the core execution layer:

- project and global agents
- project and global harnesses
- `agentq run`
- `agentq harness run`
- loop harnesses with splitter, builder, checks, and reviewer
- `agentq harness inspect`
- `agentq harness logs`
- `agentq runs list`
- `agentq runs inspect`
- run records under `~/.agentq/runs/<agent-run-id>/`
- harness records under `~/.agentq/harness-runs/<harness-run-id>/`

The next layer should make AgentQ more inspectable, repeatable, and improvable
without adding a hosted service, background daemon, or heavy framework.

## Plan Order

| Order | Plan | Purpose | Status |
| --- | --- | --- | --- |
| 01 | [Agent Run Inspection](01-agent-run-inspection.md) | Inspect saved agent runs directly. | Implemented |
| 02 | [Run Comparison](02-run-comparison.md) | Compare two saved agent runs for debugging. | Optional DX helper |
| 03 | [Local Eval Packs](03-local-eval-packs.md) | Run small deterministic eval suites from local files. | Next core plan |
| 04 | [Output Contracts](04-output-contracts.md) | Enforce required outputs/artifacts in harnesses and evals. | Core after eval packs |
| 05 | [Workflow Packs](05-workflow-packs.md) | Provide curated example agents/harnesses for common workflows. | Useful after contracts |
| 06 | [Agent Improvement Harness](06-agent-improvement-harness.md) | Turn failed run evidence into prompt/harness improvement proposals. | Later |
| 07 | [MCP Adapter](07-mcp-adapter.md) | Expose stable AgentQ records and commands to agent hosts. | Deferred |

If the goal is reliability rather than developer convenience, skip Plan 02 and
run Plan 03 next. `runs diff` is helpful, but eval packs and output contracts
are the core reliability path.

## Design Principles

Keep AgentQ local-first and Unix-shaped:

- no service dependency
- no hidden background workers
- no extra files unless they earn their keep
- readable Markdown/YAML inputs
- plain run directories a human can inspect
- small commands that do one job well
- useful exit codes for scripts and harnesses
- human-readable defaults with explicit `--json` or `--ndjson` when needed
- stable local records that work with `cat`, `jq`, `tail`, and `rg`

Feature design checklist:

| Question | Preferred answer |
| --- | --- |
| Can this be a plain file? | Yes, unless there is a strong reason. |
| Can this be a small command? | Yes, keep orchestration explicit. |
| Can another tool consume it? | Yes, with exit codes and optional JSON. |
| Can a human inspect the state? | Yes, with standard shell tools. |
| Does it preserve run storage? | Yes, avoid new record layouts unless needed. |

Keep the harness model stable:

```text
~/.agentq/harness-runs/<run-id>/
  log.jsonl
  tasks.json
```

Keep nested agent records under:

```text
~/.agentq/runs/<agent-run-id>/
  run.json
  stdout.jsonl
  stderr.log
  output.md
  artifacts/
```

Treat saved AgentQ runs as local traces. Mine real failures into eval cases.
Prefer deterministic graders first; add model graders only when deterministic
checks cannot capture the quality dimension.

MCP is not part of the core runtime plan. Treat it as a later adapter over the
same files and commands, useful only when another agent host needs structured
access to AgentQ.

## External Guidance Mapped To AgentQ

The eval direction is intentionally small and local.

- OpenAI eval guidance maps to local eval cases plus graders.
- OpenAI agent-eval guidance maps to AgentQ run and harness records as traces.
- Anthropic agent-eval guidance supports starting with 20-50 real tasks and
  deterministic code/test graders before heavier model judging.
- The local `claude-managed-agents` skill recommends defining success criteria
  first, keeping stable eval sets, and keeping pass/fail logic in harnesses or
  eval scripts rather than the thin runtime.

For AgentQ, that means:

- eval cases live in project files
- eval runs produce local records
- deterministic checks are the first grader type
- model graders are a later optional feature
- workflow examples stay as templates until repeated use proves they should be
  promoted
- MCP, if added, exposes existing records and commands instead of owning state

## Suggested Harness Use

Use the local dev loop on one plan at a time:

```sh
bun run agentq harness run devloop --input-file plans/03-local-eval-packs.md
```

After each run:

```sh
bun run agentq harness inspect <run-id>
bun run agentq runs list --since 2h --limit 10
bun run check
```
