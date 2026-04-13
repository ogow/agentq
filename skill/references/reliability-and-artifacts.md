# Reliability And Artifacts

## Artifact Delivery Contract

Every AgentQ agent should distinguish between the final answer and durable files.

- Final answer: the agent's last message, saved by AgentQ as `output.md`.
- Extra artifacts: files the agent creates under the active run's `artifacts/` directory.
- Run metadata: `run.json`, `stdout.jsonl`, and `stderr.log` are harness-owned and should not be edited by the agent.

Use an explicit `<artifacts>` contract whenever the agent may create files.

```md
<artifacts>
Final answer:
- Start with `Outcome: succeeded`, `Outcome: partial`, or `Outcome: blocked`.
- Summarize the result in 3-8 bullets.
- Include verification performed.
- Include every created artifact path.

Durable files:
- Write additional files only when this task asks for them.
- Write all additional files under {{artifacts}}.
- Create exactly these files:
  - `plan.md`: short implementation or investigation plan.
  - `findings.json`: machine-readable findings when findings exist.
- Do not write generated files elsewhere.

When blocked:
- Do not fabricate missing evidence.
- Explain what evidence or permission is missing.
- Do not create partial artifacts unless they are useful to the user.
</artifacts>
```

For tasks that do not need files, say so:

```md
<artifacts>
Write only the final answer. Do not create additional files unless the task explicitly asks for them.
Artifact directory, if explicitly needed by the task: {{artifacts}}
</artifacts>
```

## Artifact Rules For Agent Authors

- Name files explicitly when another tool, human, or orchestrator will consume them.
- Specify the format for each file: Markdown, JSON, patch, plain text, CSV.
- Specify whether a file is always created or only created under a condition.
- Specify whether existing files may be modified or whether only new files may be written.
- Specify what the final answer must say about created artifacts.
- Keep generated artifacts under the run artifact directory; project edits belong in the workspace only when the agent's job is to edit the project.

## Reliable Prompt Checklist

Before saving an agent, check that the prompt answers these questions:

1. What is the agent's single job?
2. What inputs should it trust?
3. What evidence must it inspect before concluding?
4. What is it allowed to change?
5. What must it never change?
6. What command or evidence verifies success?
7. When should it return `blocked` instead of guessing?
8. What exact final answer shape should it use?
9. What durable artifacts should it create, if any?
10. Which model, reasoning effort, sandbox, and timeout match the job's risk?

If any answer is unclear, tighten the agent before increasing model power.

## High-Reliability Prompt Pattern

Use this pattern for agents that review, edit, debug, or produce reusable outputs:

```md
<instructions>
You are a focused [role].

Goal:
- [One job only.]

Evidence:
- Inspect [files/commands/context] before making claims.
- Prefer repository evidence over assumptions.
- If evidence is missing, return `Outcome: blocked`.

Constraints:
- You may [allowed actions].
- You must not [forbidden actions].
- Keep changes scoped to [paths or behavior].

Verification:
- Run or explain [specific command/check].
- If verification cannot run, state why.

Output:
- Follow the artifact contract exactly.
- Do not include unsupported claims.
</instructions>

<task>
{{task}}
</task>

<artifacts>
[Exact final answer and file contract. Use {{artifacts}} for additional files.]
</artifacts>
```

## Reliability Patterns

Use grounding for source-sensitive work:

- Require file inspection before conclusions.
- Require file paths, command names, or short quotes when factual accuracy matters.
- Tell the agent to retract unsupported claims instead of softening them.

Use stop conditions:

- Return `Outcome: blocked` when required files, permissions, tools, or context are missing.
- Return `Outcome: partial` when useful work was completed but verification or scope is incomplete.
- Return `Outcome: succeeded` only after the expected work and verification are complete.

Use examples when output shape matters:

```md
Expected final answer example:

Outcome: succeeded
- Changed `src/foo.ts` to validate empty input.
- Added `tests/foo.test.ts` for the regression case.
- Verification: `bun test tests/foo.test.ts`
- Artifacts: none
```

Use schema-like output only when another tool must parse it. For human-facing agents, prefer structured text with stable headings.

## Harness Feedback Pattern

When an agent will run inside a harness, design the JSON result so the harness can decide whether to pass, fail, retry, or ask for human help.

Minimum harness fields:

```json
{
  "outcome": "succeeded",
  "summary": "Short summary.",
  "artifacts": [],
  "verification": {
    "status": "passed",
    "commands": []
  },
  "blocked_reason": null,
  "next": null
}
```

Harness interpretation:

- `outcome: "succeeded"` means the agent believes the task and verification are complete.
- `outcome: "partial"` means useful work exists but the harness should not treat the run as fully passing.
- `outcome: "blocked"` means the harness should provide missing context, permission, files, or a narrower task.
- `verification.status: "failed"` means the harness should feed back the failure output if retrying.
- `next` should be a concrete retry instruction, not a vague suggestion.

Prefer harness feedback as a new explicit task, for example:

```text
The previous run returned `Outcome: partial`.
Verification failed with:
[paste concise failure]

Fix only the failing behavior and update the final JSON result.
```

## Manual Hardening Loop

Do not start with a large eval framework. Harden agents from real runs:

1. Run the agent on 3-5 realistic tasks.
2. Inspect `output.md`, `run.json`, and changed files.
3. Note repeated failure modes.
4. Tighten instructions, stop conditions, artifacts, or verification.
5. Re-run the same task after each meaningful prompt change.
6. Save repeated or high-risk failures as future eval cases.

Reliability comes from clear task boundaries, evidence requirements, explicit artifact contracts, and repeatable inspection, not from longer prompts.
