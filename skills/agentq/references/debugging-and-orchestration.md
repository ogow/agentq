# Debugging And Orchestration

## Debugging Workflow

Use evidence from the run before changing the prompt.

1. Re-run once with `--details` or `--verbose` if the default output is insufficient.
2. Inspect `output.md` to see what the agent claimed.
3. Inspect `run.json` for status, timeout, model, reasoning, sandbox, context file, changed files, tool usage, and failure metadata.
4. Inspect `stderr.log` for provider/runtime errors.
5. Inspect `stdout.jsonl` when the question is about event flow, tool calls, or what the agent observed.
6. Decide whether the fix belongs in the agent prompt, task wording, sandbox/timeout/model settings, project context file, or AgentQ runtime.

## Common Symptoms

Agent did nothing useful:

- Check whether the task was too vague.
- Add concrete expected output under `<artifacts>`.
- Add a `<verification>` section when evidence is required.

Agent guessed or hallucinated:

- Require file inspection before conclusions.
- Tell the agent to return `blocked` when evidence is missing.
- Require file references, quotes, or commands used for source-grounded tasks.

Agent failed to write files:

- Check sandbox mode.
- Check whether the task or `<artifacts>` allowed extra files.
- Check the active run's `artifacts/` path for generated files.

Agent timed out:

- Increase timeout only if the work is legitimately long.
- Otherwise narrow the task, lower output requirements, or split the agent.

Agent output is hard to use:

- Tighten the final answer contract.
- Prefer short sections: Outcome, Changes/Findings, Verification, Artifacts, Next.
- Use schema-like output only when another tool or orchestrator must parse it.

## Harness Versus Manual Orchestration

Prefer `agentq harness` when the workflow itself should be inspectable and repeatable. Harnesses own planning, explicit step ordering, command steps, step results, feedback, and durable run records.

Use manual orchestration from a main agent only when the workflow is exploratory or not yet stable enough to encode as a harness.

For implementation workflows, start with one general build agent. Use check steps and reviewer steps to produce feedback, then let the harness send that feedback and any useful artifact paths back to the same build agent for a bounded retry.

For splitter-led loops:

- Require a visible one-time splitter step, normally `task-splitter`, before the loop step.
- Put repairable build/check/review work under `loop.steps`.
- Use `loop.retries` as the retry budget.
- Inspect the splitter step result in `tasks.json` before changing the splitter prompt.

## Main Agent Orchestration

A main agent can orchestrate AgentQ agents by treating `agentq run` as a delegation tool. This is useful when the user wants a high-level agent to coordinate specialized local agents while keeping each run inspectable.

For planning work, use `agentq run` before `agentq harness`. The main LLM can
delegate exploratory research to focused agents, read their saved outputs, and
then produce a plan file for the harness to implement.

Planning flow:

```text
talk with user -> run research agents -> read output.md/run.json -> write plan.md -> agentq harness run work --input-file plan.md
```

Good planning research agents have narrow jobs:

| Agent            | Purpose                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| Browser explorer | Navigate the test app and report pages, actions, selectors, validation behavior, and uncertainties. |
| Test inventory   | Inspect existing tests and report current coverage, gaps, and likely files.                         |
| Code mapper      | Inspect implementation code and report relevant modules, contracts, and risks.                      |

Keep research output evidence-based. Ask agents to include what they inspected,
what they found, what remains uncertain, and recommended plan items. Do not use
the harness for exploratory research; use it after the plan is ready.

Use this pattern:

1. Decompose the user request into narrow subtasks.
2. Choose the matching AgentQ agent for each subtask.
3. Run agents with explicit tasks and appropriate overrides.
4. Read each `output.md` and, when needed, `run.json`.
5. Synthesize the final answer from agent outputs and cite run directories.

Example:

```sh
agentq run reviewer --task "Review the current changes for correctness issues only." --sandbox read-only
agentq run test-writer --task "Add focused tests for the uncovered behavior." --sandbox workspace-write
agentq runs list --since 1h --limit 10
```

## Orchestrator Agent Prompt Pattern

```md
<instructions>
You are an orchestrator for AgentQ agents.

Before delegating, decide whether the task needs a specialist agent.
Use one AgentQ run per clear subtask.
Do not hide failures from delegated runs.
After each run, inspect the final output and run metadata before continuing.
Return a concise synthesis with run directories for traceability.
</instructions>

<task>
{{task}}
</task>

<artifacts>
Final answer must include:
- Delegated runs used.
- Result from each delegated run.
- Any blocked or failed work.
- Final recommendation or next action.
</artifacts>
```

## When Not To Orchestrate

Do not use a main agent when one focused `agentq run` is enough. Orchestration adds latency and complexity. Use it when tasks are naturally separable, require different sandbox/model settings, or benefit from specialist prompts.

Do not split implementation into separate "new feature" and "fix previous issue" agents by default. Split only when the work truly needs different permissions, tools, or review standards.
