# Plan 06: Agent Improvement Harness

## Goal

Create a harness that inspects failed AgentQ run evidence and proposes focused
agent or harness improvements.

This is the evidence-based improvement loop:

```text
failed runs -> summarize failure modes -> propose prompt/harness patch -> verify -> review
```

## Depends On

Best after:

- Plan 01: run inspection
- Plan 02: run comparison, helpful but not required
- Plan 03: local eval packs

This plan should not be the first reliability feature. It depends on having good
run records and at least a small eval habit.

Keep this as normal AgentQ files and commands. The improvement loop should read
local records and produce proposal artifacts; it should not require MCP,
background workers, or a service.

## First Harness Run Scope

Create an example improvement harness and supporting agents.

Default behavior should propose changes, not edit files automatically.

Automatic edits may be allowed only when the input explicitly requests patching.

## User Problem

After several failed runs, a human can inspect them, but converting evidence
into better prompts or harnesses is still manual:

- identify repeated failure mode
- decide whether prompt, harness, or runtime is responsible
- patch the right file
- run a small regression check
- avoid overfitting to one bad run

AgentQ should help with that loop while keeping the human in control.

## Proposed Workflow

Input:

```text
Improve the harness-builder agent from these failed runs:
- harness-builder-abc123
- harness-builder-def456

Default to proposal only.
```

Harness:

```yaml
name: improve-agent

inputs:
  task: string

steps:
  - id: analyze
    agent: run-failure-analyzer

  - id: propose
    agent: agent-improvement-proposer

  - id: review
    agent: improvement-reviewer
```

Optional patching variant:

```yaml
name: improve-agent-patch

inputs:
  task: string

steps:
  - id: analyze
    agent: run-failure-analyzer

  - id: patch
    loop:
      retries: 1
      steps:
        - id: build
          agent: agent-improvement-builder
        - id: check
          command: ["bun", "run", "check"]
        - id: review
          agent: improvement-reviewer
```

The first version should implement the proposal harness only unless patching is
small and clearly separated.

## Agent Roles

### `run-failure-analyzer`

Responsibilities:

- inspect listed run ids/paths
- read `run.json`, `output.md`, and useful stderr/stdout tails
- inspect harness records when harness run ids are provided
- classify failure modes
- identify evidence
- recommend likely layer:
  - task ambiguity
  - agent prompt
  - harness retry/contract
  - command/check
  - runtime/provider/environment

Must not edit files.

Output:

```json
{
  "status": "success",
  "summary": "Found two repeated prompt-contract failures.",
  "result": {
    "failureModes": [
      {
        "kind": "output_contract",
        "evidence": ["..."],
        "likelyLayer": "agent_prompt",
        "affectedFiles": [".agentq/agents/harness-builder.md"]
      }
    ]
  },
  "feedback": null,
  "artifacts": []
}
```

### `agent-improvement-proposer`

Responsibilities:

- read analyzer output
- inspect affected prompt/harness files
- propose focused edits
- avoid broad rewrites
- explain expected impact
- include verification plan

Must not edit files in proposal mode.

Output may include a patch-style artifact under `{{artifacts}}`, but should not
modify project files.

### `improvement-reviewer`

Responsibilities:

- check whether proposal is grounded in evidence
- reject overfitting
- reject changes not tied to inspected failures
- verify that proposed edits preserve AgentQ contracts
- recommend whether to patch now, gather more examples, or add eval coverage

Must not edit files.

## Evidence Rules

The harness should prefer concrete evidence:

- run ids and paths
- agent output excerpts
- failure summaries
- tool usage
- changed files
- stderr tails
- harness feedback
- eval failures when available

It should avoid:

- guessing from one vague failure
- changing runtime code for prompt problems
- broad prompt rewrites without repeated evidence
- adding memory files

## Integration With Eval Packs

If Plan 03 exists, the proposer should recommend eval cases for the failure
mode:

```yaml
cases:
  - id: builder-returns-verification
    type: agent
    agent: harness-builder
    task: "..."
    graders:
      - type: output_json_path_equals
        path: "$.status"
        expected: "success"
```

The first version does not need to write eval packs automatically.

## Tests

Example tests near `tests/examples.test.ts`:

- improvement agents parse
- improvement harness parses
- harness references existing agents
- proposal-mode agents use read-only sandbox
- builder/patch variant, if added, uses write sandbox and checks

Core behavior tests only if new runtime support is added. Prefer no runtime
changes in the first version.

## Docs

Add example docs explaining:

- proposal mode
- patch mode, if implemented
- how to provide run ids
- why one failure may not be enough
- how to turn repeated failures into eval cases

## Acceptance Criteria

- There is an example improvement harness.
- It can inspect failed run evidence through agents.
- Default mode proposes changes without editing project files.
- It produces a grounded recommendation and verification plan.
- Tests protect example parsing and references.
- `bun run check` passes.

## Non-goals

- No autonomous self-modification by default.
- No automatic prompt optimizer.
- No model-graded eval generation.
- No runtime changes unless absolutely necessary.
- No broad rewrite of existing project agents.
- No MCP dependency.

## Risks

| Risk | Mitigation |
| --- | --- |
| Overfits one failure | Require evidence and reviewer gate. |
| Edits wrong layer | Analyzer must classify likely layer before proposing. |
| Becomes too magical | Default to proposal-only. |
| Produces untestable prompt changes | Require verification plan and recommend eval cases. |

## Suggested Harness Command

```sh
bun run agentq harness run devloop --input-file plans/06-agent-improvement-harness.md
```
