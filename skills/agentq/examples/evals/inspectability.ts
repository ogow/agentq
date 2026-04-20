import {defineEval, graders} from 'agentq/eval';

export default defineEval({
  name: 'inspectability',
  cases: [
    {
      id: 'agent-json-contract',
      type: 'agent',
      agent: 'task-splitter',
      task: 'Return one task with title exactly "Inspect runs": inspect run records and summarize the evidence.',
      graders: [
        graders.runStatus('succeeded'),
        graders.outputJsonPathEquals('$.status', 'success'),
        graders.outputJsonPathEquals('$.result.tasks[0].title', 'Inspect runs'),
      ],
    },
    {
      id: 'work-harness-status',
      type: 'harness',
      harness: 'work',
      inputText: 'Inspect the latest run records and summarize the evidence.',
      graders: [graders.harnessStatus('success')],
    },
  ],
});
