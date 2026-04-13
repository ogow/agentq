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

## Main Agent Orchestration

A main agent can orchestrate AgentQ agents by treating `agentq run` as a delegation tool. This is useful when the user wants a high-level agent to coordinate specialized local agents while keeping each run inspectable.

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
