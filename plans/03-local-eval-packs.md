# Plan 03: Local Eval Packs

## Goal

Add a small local eval runner so AgentQ can re-run known tasks and catch
regressions from real failures.

This is the first reliability feature that turns saved run evidence into a
repeatable feedback loop.

This plan should follow Unix methodology: project-local files as inputs, local
records as outputs, deterministic exit codes, and no service dependency.

## First Harness Run Scope

Implement the smallest useful version:

```sh
agentq eval run <pack>
agentq eval inspect <eval-run-id>
```

Support project-local eval packs under:

```text
.agentq/evals/<pack>.ts
```

Support only deterministic graders in the first version.

## User Problem

AgentQ can run agents and harnesses, and it can inspect individual runs. But it
does not yet answer:

- Did this agent still handle known tasks after I changed the prompt?
- Did a harness change regress an old failure?
- Can I prove this workflow works before I run it on real work?
- Can I compare versions using the same task set instead of memory?

Manual reruns are too easy to skip and too hard to compare.

## Product Direction

Follow an eval-driven development style:

- start from manual checks and real failures
- make tasks unambiguous
- prefer deterministic graders first
- keep eval sets small early
- treat saved AgentQ runs as local traces
- add model-graded rubrics only after deterministic checks stop being enough
- keep eval execution scriptable from the shell
- make eval output inspectable with standard tools
- define eval behavior in TypeScript so cases and graders can share helpers
- keep prompt lists or fixtures in plain JSON only when that keeps data easier
  to edit

Early suites should be tiny. A useful initial pack can have 5-20 cases. Larger
20-50 case packs can grow from real AgentQ failures.

## Desired CLI

Run a pack:

```sh
agentq eval run <pack>
```

Inspect a saved eval run:

```sh
agentq eval inspect <eval-run-id-or-path>
```

Future commands such as `agentq eval list` or `agentq eval logs` are out of
scope for the first version unless they fall out naturally and remain tiny.

## Eval Pack Format

Use TypeScript as the eval pack format:

```ts
import {defineEval} from 'agentq/eval';

export default defineEval({
  name: 'inspectability',
  cases: [
    {
      id: 'runs-list-smoke',
      type: 'command',
      command: ['bun', 'run', 'agentq', 'runs', 'list', '--limit', '5'],
      graders: [
        {type: 'exit_code', expected: 0},
        {type: 'stdout_contains', value: 'AgentQ Runs'},
      ],
    },
    {
      id: 'splitter-json-contract',
      type: 'agent',
      agent: 'task-splitter',
      task: 'Split this into one implementation task: update README wording.',
      overrides: {
        sandbox: 'read-only',
        resultMode: 'json',
      },
      graders: [
        {type: 'run_status', expected: 'succeeded'},
        {
          type: 'output_json_path_equals',
          path: '$.status',
          expected: 'success',
        },
      ],
    },
    {
      id: 'devloop-doc-smoke',
      type: 'harness',
      harness: 'dev',
      inputText: 'Make a tiny README-only wording change and run checks.',
      graders: [{type: 'harness_status', expected: 'success'}],
    },
  ],
});
```

Keep the pack shape boring. Prefer explicit fields over clever inference.

TypeScript is preferred over YAML because:

- this repo is already a Bun and TypeScript CLI
- eval cases and graders can be typechecked
- common grader helpers can be imported instead of encoded as YAML strings
- prompt sets can still be generated from JSON fixtures when that is simpler
- the eval runner can stay close to normal test code without becoming a second
  harness language

Do not make eval packs arbitrary long-running programs. They should export data
and small helper functions, then let AgentQ own execution, result storage, exit
codes, and inspection.

## Optional Fixture Files

Use plain data files for large prompt lists:

```text
.agentq/evals/skill-trigger.prompts.json
.agentq/evals/fixtures/expected-files.json
```

The TypeScript eval can import or read those fixtures:

```ts
import {defineEval, readJsonFixture} from 'agentq/eval';

const prompts = readJsonFixture<
  Array<{id: string; shouldTrigger: boolean; prompt: string}>
>('./skill-trigger.prompts.json');

export default defineEval({
  name: 'skill-trigger',
  cases: prompts.map(promptCase => ({
    id: promptCase.id,
    type: 'agent',
    agent: 'task-splitter',
    task: promptCase.prompt,
    graders: [
      {type: 'run_status', expected: 'succeeded'},
      {
        type: 'output_contains',
        value: promptCase.shouldTrigger ? 'success' : 'blocked',
      },
    ],
  })),
});
```

Keep fixture parsing deterministic and local. Do not fetch remote fixtures during
eval runs.

Do not support CSV fixtures in the first version. JSON keeps fixture loading
simple, typed, and aligned with the rest of AgentQ's saved records.

## Supported Case Types

### `command`

Runs an argv command in the current project cwd.

Fields:

- `id`
- `type: command`
- `command: string[]`
- optional `cwd`
- optional `timeout`
- `graders`

### `agent`

Runs `runAgent`.

Fields:

- `id`
- `type: agent`
- `agent`
- `task`
- optional `overrides`
- `graders`

### `harness`

Runs `runHarness`.

Fields:

- `id`
- `type: harness`
- `harness`
- `inputText` or `inputFile` or structured `inputs`
- `graders`

If implementing all three case types in one pass becomes too large, prioritize:

1. `command`
2. `agent`
3. `harness`

The splitter may split this plan into multiple loop items if needed.

## First Grader Types

Use deterministic graders only. These can be plain objects or helper functions
that return the same object shape:

| Grader | Applies To | Meaning |
| --- | --- | --- |
| `exit_code` | command | command exit code equals expected |
| `stdout_contains` | command | stdout contains literal text |
| `stderr_contains` | command | stderr contains literal text |
| `run_status` | agent | saved run metadata status equals expected |
| `harness_status` | harness | harness run status equals expected |
| `output_contains` | agent | `output.md` contains literal text |
| `output_json_path_equals` | agent | parsed final output JSON path equals expected |
| `changed_files_contains` | agent | metadata changed files include path |
| `file_exists` | command/agent/harness | path exists after case finishes |

JSON path support should be deliberately small. A simple `$.a.b[0].c` subset is
enough. Do not add a dependency unless the repo already has one that fits.

Example helper API:

```ts
import {graders} from 'agentq/eval';

graders.exitCode(0);
graders.stdoutContains('AgentQ Runs');
graders.outputJsonPathEquals('$.status', 'success');
```

The helper API is optional sugar over serializable grader definitions. Keep the
stored result explicit enough that a human can inspect `results.json` without
executing eval code.

## Eval Run Storage

Create eval run records under:

```text
~/.agentq/eval-runs/<eval-run-id>/
  results.json
  log.jsonl
```

Do not put agent stdout/stderr/raw JSONL in eval directories. Agent case runs
must still write their normal nested records under:

```text
~/.agentq/runs/<agent-run-id>/
```

Harness case runs must still write under:

```text
~/.agentq/harness-runs/<harness-run-id>/
```

The eval result should store pointers to those nested run directories.

## Result Shape

`results.json` should include:

- eval pack name
- project cwd
- started/finished timestamps
- overall status: `success | failed | blocked`
- case results
- grader results per case
- nested run pointers
- summary counts

Case status rules:

- all graders pass -> case success
- any grader fails -> case failed
- command/agent/harness cannot run due to missing config or invalid eval pack ->
  blocked or failed based on existing AgentQ conventions

## CLI Output

`agentq eval run <pack>` should print:

```text
Eval inspectability: failed
cases: 2 passed, 1 failed
failed case: splitter-json-contract
run: /Users/me/.agentq/eval-runs/inspectability-abc123
```

`agentq eval inspect <eval-run>` should print:

```text
Eval inspectability: failed
cases: 2 passed, 1 failed

Failures
  splitter-json-contract
    output_json_path_equals $.status expected success, got failed
    nested run: ~/.agentq/runs/task-splitter-abc123

Run
  ~/.agentq/eval-runs/inspectability-abc123
```

Keep it compact. Detailed raw evidence lives in nested records.

Exit code rules:

- success when all cases pass
- non-zero when any case fails, the pack is invalid, or execution is blocked
- no background execution in the first version

## Tests

Core tests:

- loads project TypeScript eval pack by name
- rejects invalid eval module shape with useful error
- supports a default export through `defineEval`
- runs a command case
- applies `exit_code`
- applies `stdout_contains`
- applies `file_exists`
- writes `results.json` and `log.jsonl`
- stores nested run pointers when relevant

Agent/harness case tests:

- use fake providers where possible
- do not invoke real Codex in unit tests
- verify run/harness status graders against saved metadata or fake results

CLI tests:

- `eval run <pack>` routes
- `eval inspect <run>` routes
- failed eval exits non-zero
- successful eval exits zero

## README

Add a short section:

```sh
bun run agentq eval run inspectability
bun run agentq eval inspect <eval-run-id>
```

Explain:

- eval packs live in `.agentq/evals/<pack>.ts`
- eval fixtures may live next to the pack as JSON
- eval run records live in `~/.agentq/eval-runs`
- nested agent and harness runs stay in their normal locations
- first graders are deterministic

## Acceptance Criteria

- A project-local eval pack can run from the CLI.
- Results are saved under `~/.agentq/eval-runs/<eval-run-id>/`.
- Agent and harness case records stay in their existing directories.
- At least command cases and deterministic graders work.
- Tests cover loading, running, grading, and inspecting.
- README documents the workflow.
- `bun run check` passes.

## Non-goals

- No hosted OpenAI Evals API dependency.
- No model grader.
- No prompt optimizer.
- No eval dashboard.
- No large benchmark registry.
- No new agent/harness storage model.
- No background eval execution.
- No MCP dependency.
- No remote eval fixtures.
- No arbitrary eval-pack side effects outside declared cases and result records.

## Risks

| Risk | Mitigation |
| --- | --- |
| Eval runner grows into a second harness engine | Reuse existing `runAgent` and `runHarness`; keep eval logic focused on cases and graders. |
| TypeScript evals become arbitrary programs | Require a `defineEval` default export and keep AgentQ in charge of execution. |
| Grader format becomes too clever | Start with explicit deterministic graders and optional typed helper wrappers. |
| Eval records duplicate nested run artifacts | Store pointers only. |
| Tests accidentally run real agents | Use fake providers and command cases in unit tests. |
| Fixtures become hidden dependencies | Keep fixtures local and referenced from the eval pack. |

## Suggested Harness Command

```sh
bun run agentq harness run devloop --input-file plans/03-local-eval-packs.md
```
