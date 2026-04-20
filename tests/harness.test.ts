import {describe, expect, test} from 'bun:test';
import {existsSync, mkdtempSync} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {
  formatHarnessSummary,
  inspectHarnessRun,
  readHarnessLogEvents,
  runHarness,
} from '../src/core/harness';
import type {AgentProvider} from '../src/providers/provider';
import type {ProviderRunResult} from '../src/core/types';

const AGENT = `---
id: builder
description: Test harness builder.
model: gpt-5.4
provider: codex
reasoning: none
result_mode: json
sandbox: workspace-write
timeout: 1m
---

<instructions>Return JSON.</instructions>
<task>{{task}}</task>
<artifacts>{{artifacts}}</artifacts>
`;

describe('harness', () => {
  test('runs one agent and writes only tasks.json plus log.jsonl', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-harness-'));
    const restoreHome = useHome(root);
    const projectCwd = join(root, 'project');
    await writeAgent(projectCwd);
    await writeHarness(
      projectCwd,
      'work',
      `name: work
agent: builder
inputs:
  task: string
`,
    );

    const provider = outputProvider([
      agentOutput('success', 'Built the thing.'),
    ]);

    try {
      const result = await runHarness({
        inputText: 'build it',
        name: 'work',
        projectCwd,
        provider,
      });
      const state = JSON.parse(
        await readFile(join(result.runDir, 'tasks.json'), 'utf8'),
      ) as {
        activeStep?: unknown;
        attempts: unknown[];
        definitionPath?: unknown;
        inputs: {task: string};
        result?: unknown;
        status: string;
      };
      const events = await readHarnessLogEvents({run: result.runDir});

      expect(result.status).toBe('success');
      expect(formatHarnessSummary(result)).toContain('Harness work: success');
      expect(state.status).toBe('success');
      expect(state.inputs.task).toBe('build it');
      expect(state.attempts).toHaveLength(1);
      expect(state.activeStep).toBeUndefined();
      expect(state.definitionPath).toBeUndefined();
      expect(state.result).toBeUndefined();
      expect(events.map(event => event.kind)).toContain('agent_run_finished');
      expect(existsSync(join(result.runDir, 'tasks.json'))).toBe(true);
      expect(existsSync(join(result.runDir, 'log.jsonl'))).toBe(true);
      expect(existsSync(join(result.runDir, 'harness.json'))).toBe(false);
      expect(existsSync(join(result.runDir, 'input.json'))).toBe(false);
      expect(existsSync(join(result.runDir, 'output.json'))).toBe(false);
      expect(existsSync(join(result.runDir, 'attempts.jsonl'))).toBe(false);
    } finally {
      restoreHome();
    }
  });

  test('retries the same agent after a failed provider run', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-harness-'));
    const restoreHome = useHome(root);
    const projectCwd = join(root, 'project');
    await writeAgent(projectCwd);
    await writeHarness(
      projectCwd,
      'work',
      `name: work
agent: builder
retries: 1
inputs:
  task: string
`,
    );

    const provider = outputProvider([
      providerResult({exitCode: 1}),
      agentOutput('success', 'Recovered.'),
    ]);

    try {
      const result = await runHarness({
        inputText: 'recover',
        name: 'work',
        projectCwd,
        provider,
      });
      const state = JSON.parse(
        await readFile(join(result.runDir, 'tasks.json'), 'utf8'),
      ) as {attempts: Array<{status: string}>};

      expect(result.status).toBe('success');
      expect(state.attempts.map(attempt => attempt.status)).toEqual([
        'failed',
        'success',
      ]);
    } finally {
      restoreHome();
    }
  });

  test('runs pre-loop steps once and retries only the loop body', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-harness-'));
    const restoreHome = useHome(root);
    const projectCwd = join(root, 'project');
    await writeAgent(projectCwd, 'splitter');
    await writeAgent(projectCwd, 'builder');
    await writeHarness(
      projectCwd,
      'planned',
      `name: planned
inputs:
  task: string
steps:
  - id: split
    agent: splitter
  - id: implement
    loop:
      over: "{{split.tasks}}"
      retries: 1
      steps:
        - id: build
          agent: builder
`,
    );

    const calls: Array<{agent: string; task: string}> = [];
    const provider = recordingProvider(
      [
        agentOutput('success', 'Split.', {tasks: [{title: 'first'}]}),
        agentOutput('failed', 'Build failed.'),
        agentOutput('success', 'Build recovered.'),
      ],
      calls,
    );

    try {
      const result = await runHarness({
        inputText: 'plan then build',
        name: 'planned',
        projectCwd,
        provider,
      });
      const state = JSON.parse(
        await readFile(join(result.runDir, 'tasks.json'), 'utf8'),
      ) as {
        attempts: Array<{status: string}>;
        stepResults: Record<string, unknown>;
      };
      const secondBuildTask = JSON.parse(calls[2].task) as {
        feedback?: {problem?: string};
        loopItem?: {title?: string};
      };

      expect(result.status).toBe('success');
      expect(calls.map(call => call.agent)).toEqual([
        'splitter',
        'builder',
        'builder',
      ]);
      expect(state.attempts.map(attempt => attempt.status)).toEqual([
        'failed',
        'success',
      ]);
      expect(Object.keys(state.stepResults)).toContain('split');
      expect(secondBuildTask.loopItem?.title).toBe('first');
      expect(secondBuildTask.feedback?.problem).toBe('Build failed.');
    } finally {
      restoreHome();
    }
  });

  test('runs loop body once for each item from a splitter result', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-harness-'));
    const restoreHome = useHome(root);
    const projectCwd = join(root, 'project');
    await writeAgent(projectCwd, 'splitter');
    await writeAgent(projectCwd, 'builder');
    await writeHarness(
      projectCwd,
      'planned',
      `name: planned
steps:
  - id: split
    agent: splitter
  - id: implement
    loop:
      over: "{{split.tasks}}"
      retries: 0
      steps:
        - id: build
          agent: builder
`,
    );

    const calls: Array<{agent: string; task: string}> = [];
    const provider = recordingProvider(
      [
        agentOutput('success', 'Split.', {
          tasks: [{title: 'first'}, {title: 'second'}],
        }),
        agentOutput('success', 'Built first.'),
        agentOutput('success', 'Built second.'),
      ],
      calls,
    );

    try {
      const result = await runHarness({
        inputText: 'build both',
        name: 'planned',
        projectCwd,
        provider,
      });
      const loopItems = calls
        .filter(call => call.agent === 'builder')
        .map(
          call =>
            (JSON.parse(call.task) as {loopItem: {title: string}}).loopItem
              .title,
        );

      expect(result.status).toBe('success');
      expect(loopItems).toEqual(['first', 'second']);
      expect(result.attempts).toHaveLength(2);
    } finally {
      restoreHome();
    }
  });

  test('does not retry the loop when an agent reports a plan failure', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-harness-'));
    const restoreHome = useHome(root);
    const projectCwd = join(root, 'project');
    await writeAgent(projectCwd, 'splitter');
    await writeAgent(projectCwd, 'builder');
    await writeHarness(
      projectCwd,
      'planned',
      `name: planned
steps:
  - id: split
    agent: splitter
  - id: implement
    loop:
      over: "{{split.tasks}}"
      retries: 2
      steps:
        - id: build
          agent: builder
`,
    );

    const calls: Array<{agent: string; task: string}> = [];
    const provider = recordingProvider(
      [
        agentOutput('success', 'Split.', {tasks: [{title: 'first'}]}),
        agentOutput('failed', 'The plan is invalid.', null, 'plan'),
        agentOutput('success', 'Should not run.'),
      ],
      calls,
    );

    try {
      const result = await runHarness({
        inputText: 'bad plan',
        name: 'planned',
        projectCwd,
        provider,
      });

      expect(result.status).toBe('failed');
      expect(calls.map(call => call.agent)).toEqual(['splitter', 'builder']);
      expect(result.attempts).toHaveLength(1);
      expect(result.attempts[0].failureKind).toBe('plan');
    } finally {
      restoreHome();
    }
  });

  test('marks the harness failed when a check fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-harness-'));
    const restoreHome = useHome(root);
    const projectCwd = join(root, 'project');
    await writeAgent(projectCwd);
    await writeHarness(
      projectCwd,
      'work',
      `name: work
agent: builder
checks:
  - id: unit
    command: ["bun", "-e", "process.exit(7)"]
`,
    );

    const provider = outputProvider([
      agentOutput('success', 'Ready for checks.'),
    ]);

    try {
      const result = await runHarness({
        inputText: 'check it',
        name: 'work',
        projectCwd,
        provider,
      });
      const inspected = await inspectHarnessRun(result.runDir);

      expect(result.status).toBe('failed');
      expect(result.feedback?.problem).toBe('Check unit failed.');
      expect(inspected.status).toBe('failed');
    } finally {
      restoreHome();
    }
  });

  test('inspect preserves running harness status', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-harness-'));
    const restoreHome = useHome(root);
    const runDir = join(root, '.agentq', 'harness-runs', 'work-running');
    await mkdir(runDir, {recursive: true});
    await writeFile(
      join(runDir, 'tasks.json'),
      `${JSON.stringify(
        {
          attempts: [],
          harnessName: 'work',
          inputs: {task: 'build it'},
          process: {
            command: 'agentq harness run',
            host: 'test-host',
            pid: 12345,
            startedAt: '2026-04-18T10:00:00.000Z',
          },
          projectCwd: join(root, 'project'),
          runDir,
          startedAt: '2026-04-18T10:00:00.000Z',
          status: 'running',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    try {
      const inspected = await inspectHarnessRun('work-running');

      expect(inspected.status).toBe('running');
      expect(inspected.failedStep).toBeUndefined();
      expect(formatHarnessSummary(inspected)).toContain(
        'Harness work: running',
      );
    } finally {
      restoreHome();
    }
  });

  test('marks the harness interrupted when the active agent is stopped', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-harness-'));
    const restoreHome = useHome(root);
    const projectCwd = join(root, 'project');
    await writeAgent(projectCwd);
    await writeHarness(
      projectCwd,
      'work',
      `name: work
agent: builder
inputs:
  task: string
`,
    );

    const provider = outputProvider([
      providerResult({exitCode: null, interrupted: true}),
    ]);

    try {
      const result = await runHarness({
        inputText: 'stop it',
        name: 'work',
        projectCwd,
        provider,
      });
      const state = JSON.parse(
        await readFile(join(result.runDir, 'tasks.json'), 'utf8'),
      ) as {
        attempts: Array<{status: string}>;
        process: {stopReason?: string};
        status: string;
      };
      const inspected = await inspectHarnessRun(result.runDir);
      const events = await readHarnessLogEvents({run: result.runDir});

      expect(result.status).toBe('interrupted');
      expect(result.summary).toContain('interrupted');
      expect(inspected.status).toBe('interrupted');
      expect(state.status).toBe('interrupted');
      expect(state.process.stopReason).toBe('interrupted');
      expect(state.attempts[0]).toMatchObject({status: 'failed'});
      expect(events.at(-1)).toMatchObject({
        kind: 'harness_finished',
        status: 'interrupted',
      });
    } finally {
      restoreHome();
    }
  });
});

function outputProvider(
  results: Array<ProviderRunResult | string>,
): AgentProvider {
  let index = 0;
  return {
    run: async prepared => {
      const result = results[index++] ?? agentOutput('success', 'ok');
      if (typeof result === 'string') {
        await writeFile(prepared.paths.outputPath, result, 'utf8');
        return providerResult();
      }
      return result;
    },
  };
}

function recordingProvider(
  results: Array<ProviderRunResult | string>,
  calls: Array<{agent: string; task: string}>,
): AgentProvider {
  const provider = outputProvider(results);
  return {
    run: async (prepared, options) => {
      calls.push({agent: prepared.agent.id, task: prepared.task});
      return provider.run(prepared, options);
    },
  };
}

function agentOutput(
  status: string,
  summary: string,
  result: unknown = null,
  failureKind?: string,
): string {
  return `${JSON.stringify({
    artifacts: [],
    failureKind,
    feedback: status === 'success' ? null : {problem: summary},
    result,
    status,
    summary,
  })}\n`;
}

function providerResult(
  overrides: Partial<ProviderRunResult> = {},
): ProviderRunResult {
  return {
    changedFiles: [],
    events: [{kind: 'run_started', provider: 'codex'}],
    exitCode: 0,
    stderr: '',
    timedOut: false,
    toolUsage: [],
    ...overrides,
  };
}

async function writeAgent(
  projectCwd: string,
  agentId = 'builder',
): Promise<void> {
  const agentsDir = join(projectCwd, '.agentq', 'agents');
  await mkdir(agentsDir, {recursive: true});
  await writeFile(
    join(agentsDir, `${agentId}.md`),
    AGENT.replace('id: builder', `id: ${agentId}`),
    'utf8',
  );
}

async function writeHarness(
  projectCwd: string,
  name: string,
  yaml: string,
): Promise<void> {
  const harnessDir = join(projectCwd, '.agentq', 'harnesses');
  await mkdir(harnessDir, {recursive: true});
  await writeFile(join(harnessDir, `${name}.yaml`), yaml, 'utf8');
}

function useHome(homePath: string): () => void {
  const originalHome = process.env.HOME;
  process.env.HOME = homePath;
  return () => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  };
}
