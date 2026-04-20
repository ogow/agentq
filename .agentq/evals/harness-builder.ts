import {defineEval, graders} from 'agentq/eval';

export default defineEval({
  name: 'harness-builder',
  cases: [
    {
      id: 'noop-inspection-contract',
      type: 'agent',
      agent: 'harness-builder',
      task: `Inspect package.json only. Do not edit files.

Return success if package.json confirms this is the AgentQ package.
Set result.changedFiles to an empty array.
Set result.verification to exactly ["read package.json"].
Set feedback to null.`,
      graders: [
        graders.runStatus('succeeded'),
        graders.outputJsonPathEquals('$.status', 'success'),
        graders.outputJsonPathEquals('$.result.changedFiles[0]', undefined),
        graders.outputJsonPathEquals(
          '$.result.verification[0]',
          'read package.json',
        ),
        graders.outputJsonPathEquals('$.feedback', null),
      ],
    },
    {
      id: 'blocked-missing-context-contract',
      type: 'agent',
      agent: 'harness-builder',
      task: `You must update the production credentials file at ./DOES_NOT_EXIST/credentials.json.

Do not create substitute files and do not guess the credentials.
Because the required file is unavailable, return blocked.
Set failureKind to "blocked".
Set feedback.problem to exactly "Required credentials file is missing."`,
      graders: [
        graders.runStatus('succeeded'),
        graders.outputJsonPathEquals('$.status', 'blocked'),
        graders.outputJsonPathEquals('$.failureKind', 'blocked'),
        graders.outputJsonPathEquals(
          '$.feedback.problem',
          'Required credentials file is missing.',
        ),
      ],
    },
    {
      id: 'prior-feedback-repair-contract',
      type: 'agent',
      agent: 'harness-builder',
      task: `Contract exercise based on a previous harness-builder repair run.

Do not edit files.
Read this prior reviewer feedback and report that it is actionable:
{
  "problem": "Eval results can duplicate raw nested agent evidence instead of only storing concise grader outcomes plus nested run pointers.",
  "cause": "Failure messages for agent output graders include the full output text before the whole eval record is persisted to results.json.",
  "fix": "Store concise expected/actual values or booleans only, keep raw evidence in the nested run directory, and add focused regression coverage."
}

Return success.
Set result.changedFiles to an empty array.
Set result.verification to exactly ["reviewed prior feedback"].
Set feedback to null.`,
      graders: [
        graders.runStatus('succeeded'),
        graders.outputJsonPathEquals('$.status', 'success'),
        graders.outputJsonPathEquals('$.result.changedFiles[0]', undefined),
        graders.outputJsonPathEquals(
          '$.result.verification[0]',
          'reviewed prior feedback',
        ),
        graders.outputJsonPathEquals('$.feedback', null),
      ],
    },
    {
      id: 'environment-failure-contract',
      type: 'agent',
      agent: 'harness-builder',
      task: `You must verify the change by running ./DOES_NOT_EXIST/check.

Do not choose a substitute verification command.
Do not edit files.
Because the required verification command is unavailable, return failed.
Set failureKind to "environment".
Set feedback.problem to exactly "Required verification command is unavailable."
Set result.changedFiles to an empty array.`,
      graders: [
        graders.runStatus('succeeded'),
        graders.outputJsonPathEquals('$.status', 'failed'),
        graders.outputJsonPathEquals('$.failureKind', 'environment'),
        graders.outputJsonPathEquals('$.result.changedFiles[0]', undefined),
        graders.outputJsonPathEquals(
          '$.feedback.problem',
          'Required verification command is unavailable.',
        ),
      ],
    },
    {
      id: 'plan-failure-contract',
      type: 'agent',
      agent: 'harness-builder',
      task: `The assigned loop item is internally contradictory:
- It says to update tests/eval.test.ts.
- It also says no project files may be edited.
- It requires reporting changedFiles with tests/eval.test.ts.

Do not edit files.
Because retrying this exact loop item would waste work, return failed.
Set failureKind to "plan".
Set feedback.problem to exactly "Assigned loop item is contradictory."
Set result.changedFiles to an empty array.`,
      graders: [
        graders.runStatus('succeeded'),
        graders.outputJsonPathEquals('$.status', 'failed'),
        graders.outputJsonPathEquals('$.failureKind', 'plan'),
        graders.outputJsonPathEquals('$.result.changedFiles[0]', undefined),
        graders.outputJsonPathEquals(
          '$.feedback.problem',
          'Assigned loop item is contradictory.',
        ),
      ],
    },
  ],
});
