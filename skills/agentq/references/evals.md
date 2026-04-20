# Eval Packs

AgentQ eval packs are local TypeScript files that run commands, agents, or harnesses against deterministic graders. Use them once a behavior is important enough to protect from regressions.

The local model is intentionally simple:

```text
.agentq/evals/<pack>.ts -> agentq eval run <pack> -> ~/.agentq/eval-runs/<run-id>/
```

Each eval run writes:

```text
~/.agentq/eval-runs/<run-id>/
  results.json
  log.jsonl
```

Nested agent and harness runs keep their full records under `~/.agentq/runs/<agent-run-id>/` and `~/.agentq/harness-runs/<harness-run-id>/`. The eval record stores pointers instead of copying large outputs.

## Run Evals

Run by pack name:

```sh
agentq eval run inspectability
```

Run by path:

```sh
agentq eval run .agentq/evals/inspectability.ts
```

Inspect a saved run:

```sh
agentq eval inspect <eval-run-id-or-path>
cat ~/.agentq/eval-runs/<run-id>/results.json
cat ~/.agentq/eval-runs/<run-id>/log.jsonl
```

The CLI exits zero only when every case passes. Failed or blocked evals exit non-zero, so the command is suitable for CI once the cases are stable.

## Pack Shape

Create `.agentq/evals/<pack>.ts` and export `defineEval(...)`:

```ts
import {defineEval, graders, readJsonFixture} from 'agentq/eval';

const cases = readJsonFixture<Array<{id: string; task: string}>>(
  './inspectability-cases.json',
);

export default defineEval({
  name: 'inspectability',
  cases: cases.map(evalCase => ({
    id: evalCase.id,
    type: 'agent',
    agent: 'task-splitter',
    task: evalCase.task,
    graders: [
      graders.runStatus('succeeded'),
      graders.outputJsonPathEquals('$.status', 'success'),
      graders.outputJsonPathEquals('$.result.tasks[0].title', 'Inspect runs'),
    ],
  })),
});
```

Use `readJsonFixture()` for small JSON fixtures next to the pack. Keep fixtures human-readable and specific enough that reviewers can understand what each case proves.

When a grader checks exact text, make that expectation explicit in the task or fixture. Otherwise prefer status, JSON shape, required facts, or artifact checks over incidental model wording.

## Case Types

| Type | Use For | Required Fields |
|---|---|---|
| `command` | Fast deterministic smoke checks, CLI contracts, file side effects. | `id`, `command`, `graders` |
| `agent` | A single reusable agent prompt and its final output contract. | `id`, `agent`, `task`, `graders` |
| `harness` | End-to-end workflow behavior, retry boundaries, and state records. | `id`, `harness`, one of `inputText`, `inputFile`, or `inputs`, `graders` |

Command cases may set `cwd` and `timeout`. Agent cases may set `overrides` for model, reasoning, sandbox, approval, result mode, context file, provider, or timeout.

## Graders

Prefer deterministic graders first:

| Grader | Best For |
|---|---|
| `graders.exitCode(0)` | Command success and failure contracts. |
| `graders.stdoutContains("text")` / `graders.stderrContains("text")` | CLI human output and useful error messages. |
| `graders.runStatus("succeeded")` | Agent run terminal status. |
| `graders.harnessStatus("success")` | Harness run terminal status. |
| `graders.outputContains("text")` | Plain final output requirements. |
| `graders.outputJsonPathEquals("$.status", "success")` | JSON output contracts and structured fields. |
| `graders.changedFilesContains("path")` | Agent edits touched an expected file. |
| `graders.fileExists("path")` | Command or agent created an expected project file. |

Use more than one grader when a pass needs multiple facts. Keep each grader narrow: one expected behavior, one failure message, one clear reason to fix.

## High-Quality Eval Design

Start with the behavior, not the tool. Define the objective in plain language, collect examples that represent the behavior, choose metrics or pass criteria, run comparisons, and keep growing the eval set as new misses appear. This mirrors OpenAI's recommended loop of objective, dataset, metrics, run/compare, and continuous evaluation.

Put evals where nondeterminism enters the system. For AgentQ, that usually means agent final outputs, harness retry behavior, routing decisions, command output contracts, and file artifacts. For workflows, evaluate important steps in isolation before relying only on an end-to-end harness case.

Use a balanced case set:

| Case Kind | Purpose |
|---|---|
| Typical | Proves the main workflow still works. |
| Edge | Covers small, malformed, missing, or unusual inputs. |
| Adversarial | Checks prompt conflicts, distracting user text, ambiguous instructions, and unsafe shortcuts. |
| Regression | Locks in a fix after a real failure. |

Keep one task family per pack so failures are easy to interpret. A pack named `harness-retries` should not also test unrelated CLI formatting.

Make expected behavior observable. Prefer JSON output contracts for agents and harnessed agents, then grade exact fields with JSON paths. If the behavior cannot be observed through status, output, files, or run records, improve the agent or harness contract before adding a weak eval.

Keep graders aligned with human intent. For subjective behavior, first collect expert annotations or written critiques outside AgentQ, convert the stable parts into deterministic checks, and reserve human review for the parts that cannot be made objective yet. OpenAI's dataset guidance emphasizes that expert annotations and detailed feedback make later optimization more useful.

Do not overfit to one golden sentence. Grade required facts, statuses, structured fields, and artifacts. Use substring checks for stable CLI phrases or mandatory content, not for incidental wording.

Separate fast gates from deeper suites. A small smoke pack can run on every change; larger or model-expensive agent and harness packs can run before releases or when changing prompts.

When using OpenAI dashboard datasets or the prompt optimizer alongside AgentQ, use datasets for rapid prompt iteration and annotation, then copy durable cases into local AgentQ eval packs. The prompt optimizer works best with annotated rows, grader results, and detailed critiques, but optimized prompts still need manual review and local eval comparison before production use.

Useful OpenAI references:

- [Getting started with datasets](https://developers.openai.com/api/docs/guides/evaluation-getting-started)
- [Working with evals](https://developers.openai.com/api/docs/guides/evals)
- [Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices)
- [Prompt optimizer](https://developers.openai.com/api/docs/guides/prompt-optimizer)
- [Graders](https://developers.openai.com/api/docs/guides/graders)

## Authoring Checklist

| Check | Question |
|---|---|
| Objective | What behavior should never regress? |
| Scope | Is this pack about one task family? |
| Cases | Does it include typical, edge, adversarial, and regression examples where useful? |
| Observability | Can failures be debugged from `results.json`, `log.jsonl`, and nested run dirs? |
| Graders | Are pass criteria deterministic and narrow? |
| Fixtures | Are inputs inspectable as plain JSON or text files? |
| Cost | Should this run on every change, only before release, or only during prompt work? |
| Review | Has a human checked that passing the eval actually means the behavior is good? |
