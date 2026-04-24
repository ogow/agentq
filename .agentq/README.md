# AgentQ Project Agent Setup

This directory is the reference local AgentQ setup for this repo. Keep it lean:
small agents, explicit harnesses, local records, and evals for behavior that
should not regress.

## Agents

| Agent | Role | Sandbox | Output |
| --- | --- | --- | --- |
| `task-splitter` | Split a broad request into stable loop items. | `read-only` | `AgentOutput` with `result.tasks`. |
| `harness-builder` | Implement or repair exactly one assigned task. | `workspace-write` | `AgentOutput` with `changedFiles` and `verification`. |
| `harness-reviewer` | Review one implementation attempt for blocking issues. | `read-only` | `AgentOutput` with findings and feedback. |
| `agent-improver` | Inspect failed run evidence and propose prompt/harness/eval improvements. | `read-only` | Proposal-only `AgentOutput`. |

Do not create a catch-all agent. If an agent prompt starts growing because it
needs reusable workflow or API knowledge, move that knowledge into a skill or a
focused reference doc.

Write-heavy verification belongs in harness command steps or the builder's
`workspace-write` run. The reviewer stays read-only and uses prior check
evidence; if it cannot rerun a temp-writing command such as `bun test`, it should
record that as a verification gap instead of requiring `danger-full-access`.

## Harnesses

Use `devloop` for real implementation work:

```sh
bun run agentq harness run devloop --input-file plans/example.md
```

`devloop` uses this shape:

```text
split once -> loop(build, typecheck, lint, tests, review)
```

Use `dev` for smaller one-agent tasks where splitting and review are not worth
the extra loop structure.

## Reliability Loop

1. Run the smallest useful agent or harness.
2. Inspect `tasks.json`, `log.jsonl`, nested `run.json`, and `output.md`.
3. Improve prompts or harnesses only from concrete evidence.
4. Add eval coverage when a failure mode is stable and worth preserving.

The main guide is:

```text
docs/robust-agents-and-harnesses.md
```
