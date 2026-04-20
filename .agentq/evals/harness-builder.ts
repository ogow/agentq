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
  ],
});
