import {describe, expect, test} from 'bun:test';
import {existsSync, mkdtempSync} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {
  formatHarnessSummary,
  formatHarnessLogEvent,
  inspectHarnessRun,
  readHarnessLogEvents,
  runHarness,
} from '../src/core/harness';
import type {AgentProvider} from '../src/providers/provider';
import type {AgentQEvent, ProviderRunResult} from '../src/core/types';

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

    const provider = outputProvider(
      [agentOutput('success', 'Built the thing.')],
      [
        {
          kind: 'run_started',
          provider: 'codex',
        },
        {
          kind: 'assistant_message',
          message: 'I am checking the harness configuration before editing.',
          provider: 'codex',
        },
        {
          kind: 'token_usage',
          provider: 'codex',
          tokenUsage: {
            inputTokens: 100,
            outputTokens: 20,
            totalTokens: 120,
          },
        },
        {
          kind: 'run_completed',
          message: 'Done.',
          provider: 'codex',
        },
      ],
    );

    try {
      const {result, stderr, stdout} = await runHarnessWithOutput({
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
      expect(result.completedItems).toBe(1);
      expect(formatHarnessSummary(result)).toMatch(/^[^:\n]+: success/m);
      expect(formatHarnessSummary(result)).toContain('tasks: 1 succeeded');
      expect(formatHarnessSummary(result)).toContain('tries: 1 total');
      expect(formatHarnessSummary(result)).toContain('duration:');
      expect(
        formatHarnessSummary({...result, tokenUsage: undefined}),
      ).not.toContain('tokens:');
      expect(
        formatHarnessSummary({
          ...result,
          tokenUsage: {
            inputTokens: 100,
            outputTokens: 20,
            totalTokens: 120,
          },
        }),
      ).toContain('tokens: input 100 · output 20 · total 120');
      expect(stdout).toBe('');
      expect(stderr.trim().split('\n')).toEqual([
        '✓ task 1/1 success retry 1/1  work',
      ]);
      expect(stderr).not.toContain(
        'I am checking the harness configuration before editing.',
      );
      expect(stderr).not.toContain('tokens: input 100 · output 20 · total 120');
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

  test('renders structured verbose output without raw assistant JSON', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-harness-'));
    const restoreHome = useHome(root);
    const projectCwd = join(root, 'project');
    await writeAgent(projectCwd, 'builder');
    await writeHarness(
      projectCwd,
      'work',
      `name: work
steps:
  - id: build
    agent: builder
inputs:
  task: string
`,
    );

    const provider = outputProvider(
      [
        agentOutput('success', 'Verified the local eval runner end to end', {
          changedFiles: [],
        }),
      ],
      [
        {
          kind: 'assistant_message',
          message: 'mapping the current CLI and run storage',
          provider: 'codex',
        },
        {
          kind: 'assistant_message',
          message:
            '{"status":"success","summary":"Verified the local eval runner end to end","result":{"changedFiles":[]}}',
          provider: 'codex',
        },
      ],
    );

    try {
      const {stderr} = await runHarnessWithOutput({
        inputText: 'build it',
        name: 'work',
        projectCwd,
        provider,
        verbose: true,
      });

      const lines = stderr
        .trim()
        .split('\n')
        .filter(line => line.length > 0);
      const firstLine = stderr.split('\n')[0] ?? '';

      expect(lines[0]).toMatch(/^[^\s]+$/);
      expect(stderr).toContain('▸ task 1/1  retry 1/1  work');
      expect(stderr).toContain('▸ build  builder');
      expect(stderr).toContain(
        'trace  mapping the current CLI and run storage',
      );
      expect(stderr).toContain(
        '✓ build  builder  Verified the local eval runner end to end',
      );
      expect(stderr).not.toContain('agent builder --:-- message');
      expect(stderr).not.toContain(
        '{"status":"success","summary":"Verified the local eval runner end to end","result":{"changedFiles":[]}}',
      );
      expect(firstLine.length).toBeGreaterThan(0);
      expect(firstLine.trim()).toBe(firstLine);
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
retries: 2
inputs:
  task: string
`,
    );

    const provider = outputProvider([
      providerResult({exitCode: 1}),
      agentOutput('success', 'Recovered.'),
    ]);

    try {
      const {result, stderr} = await runHarnessWithOutput({
        inputText: 'recover',
        name: 'work',
        projectCwd,
        provider,
      });
      const state = JSON.parse(
        await readFile(join(result.runDir, 'tasks.json'), 'utf8'),
      ) as {attempts: Array<{status: string}>};

      expect(result.status).toBe('success');
      expect(result.completedItems).toBe(1);
      expect(state.attempts.map(attempt => attempt.status)).toEqual([
        'failed',
        'success',
      ]);
      expect(stderr.trim().split('\n')).toEqual([
        '✓ task 1/1 success retry 2/3  work',
      ]);
      expect(formatHarnessSummary(result)).toContain('tasks: 1 succeeded');
      expect(formatHarnessSummary(result)).not.toContain('tasks: 2 succeeded');
    } finally {
      restoreHome();
    }
  });

  test('keeps failed agent context in non-tty failure blocks', async () => {
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
      agentOutput('failed', 'Build failed.'),
      agentOutput('failed', 'Build failed.'),
    ]);

    try {
      const {result, stderr} = await runHarnessWithOutput({
        inputText: 'break it',
        name: 'work',
        projectCwd,
        provider,
      });

      expect(result.status).toBe('failed');
      expect(stderr).toContain('✗ task 1/1 failed retry 1/1  work');
      expect(stderr).toContain(
        'Failure\n  agent: builder\n  retry: 1/1\n  reason: Build failed.',
      );
      expect(stderr).not.toContain('task:');
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
        agentOutput('failed', 'Build failed.'),
        agentOutput('success', 'Build recovered.'),
      ],
      calls,
    );

    try {
      const {result} = await runHarnessWithOutput({
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
      expect(result.completedItems).toBe(1);
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
      retries: 1
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
      const {result} = await runHarnessWithOutput({
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
      expect(result.completedItems).toBe(2);
      expect(formatHarnessSummary(result)).toContain('tasks: 2 succeeded');
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
        agentOutput('failed', 'The plan is invalid.', null, 'plan'),
        agentOutput('success', 'Should not run.'),
      ],
      calls,
    );

    try {
      const {result} = await runHarnessWithOutput({
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
      const {result} = await runHarnessWithOutput({
        inputText: 'check it',
        name: 'work',
        projectCwd,
        provider,
      });
      const inspected = await inspectHarnessRun(result.runDir);

      expect(result.status).toBe('failed');
      expect(result.failedStep).toBe('attempt-1.check.unit');
      expect(result.feedback?.problem).toBe('Check unit failed.');
      expect(inspected.status).toBe('failed');
      expect(formatHarnessSummary(result)).toContain(
        'reason: Check unit failed.',
      );
      expect(formatHarnessSummary(result)).toContain(
        'failed_step: attempt-1.check.unit',
      );
      const checkEvents = await readHarnessLogEvents({
        run: result.runDir,
        step: 'check',
      });
      expect(checkEvents.length).toBeGreaterThan(0);
      const renderedCheckEvents = checkEvents.map(event =>
        formatHarnessLogEvent(event),
      );
      expect(renderedCheckEvents.some(line => line.includes('attempt-1'))).toBe(
        false,
      );
      expect(renderedCheckEvents.join('\n')).toContain('check.unit');
    } finally {
      restoreHome();
    }
  });

  test('times out a legacy harness check that does not exit', async () => {
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
    command: ["bun", "-e", "setInterval(() => undefined, 1000)"]
    timeout: 50ms
`,
    );

    const provider = outputProvider([
      agentOutput('success', 'Ready for checks.'),
    ]);

    try {
      const {result} = await runHarnessWithOutput({
        inputText: 'check it',
        name: 'work',
        projectCwd,
        provider,
      });
      const state = JSON.parse(
        await readFile(join(result.runDir, 'tasks.json'), 'utf8'),
      ) as {attempts: Array<{checks: Array<{timedOut?: boolean}>}>};

      expect(result.status).toBe('failed');
      expect(result.summary).toBe('Check unit timed out after 50ms.');
      expect(result.feedback?.problem).toBe('Check unit timed out after 50ms.');
      expect(state.attempts[0].checks[0].timedOut).toBe(true);
    } finally {
      restoreHome();
    }
  });

  test('times out a structured command step that does not exit', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-harness-'));
    const restoreHome = useHome(root);
    const projectCwd = join(root, 'project');
    await writeHarness(
      projectCwd,
      'work',
      `name: work
steps:
  - id: check
    command: ["bun", "-e", "setInterval(() => undefined, 1000)"]
    timeout: 50ms
`,
    );

    try {
      const {result} = await runHarnessWithOutput({
        name: 'work',
        projectCwd,
      });
      const state = JSON.parse(
        await readFile(join(result.runDir, 'tasks.json'), 'utf8'),
      ) as {
        stepResults: Record<
          string,
          {result: {timedOut?: boolean}; summary: string}
        >;
      };

      expect(result.status).toBe('failed');
      expect(result.summary).toBe('Check check timed out after 50ms.');
      expect(state.stepResults.check.summary).toBe(
        'Check check timed out after 50ms.',
      );
      expect(state.stepResults.check.result.timedOut).toBe(true);
    } finally {
      restoreHome();
    }
  });

  test('limits loop retries to the configured retry budget', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-harness-'));
    const restoreHome = useHome(root);
    const projectCwd = join(root, 'project');
    await writeAgent(projectCwd, 'splitter');
    await writeAgent(projectCwd, 'builder');
    await writeHarness(
      projectCwd,
      'work',
      `name: work
inputs:
  task: string
steps:
  - id: split
    agent: splitter
  - id: implement
    loop:
      over: "{{split.tasks}}"
      retries: 8
      steps:
        - id: build
          agent: builder
`,
    );

    const calls: Array<{agent: string; task: string}> = [];
    const provider = recordingProvider(
      [
        agentOutput('success', 'Split.', {tasks: [{title: 'first'}]}),
        ...Array.from({length: 8}, () =>
          agentOutput('failed', 'Build failed.'),
        ),
        agentOutput('success', 'Built on the last retry.'),
      ],
      calls,
    );

    try {
      const {result, stderr} = await runHarnessWithOutput({
        inputText: 'keep trying',
        name: 'work',
        projectCwd,
        provider,
      });

      expect(result.status).toBe('success');
      expect(result.completedItems).toBe(1);
      expect(result.attempts).toHaveLength(9);
      expect(calls.map(call => call.agent)).toEqual([
        'splitter',
        'builder',
        'builder',
        'builder',
        'builder',
        'builder',
        'builder',
        'builder',
        'builder',
        'builder',
      ]);
      expect(stderr).toContain('retry 9/9');
      expect(stderr).not.toContain('attempt 1/10');
      expect(formatHarnessSummary(result)).toContain('tasks: 1 succeeded');
    } finally {
      restoreHome();
    }
  });

  test('stops retrying a loop when the body is blocked', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-harness-'));
    const restoreHome = useHome(root);
    const projectCwd = join(root, 'project');
    await writeAgent(projectCwd, 'splitter');
    await writeAgent(projectCwd, 'builder');
    await writeHarness(
      projectCwd,
      'work',
      `name: work
inputs:
  task: string
steps:
  - id: split
    agent: splitter
  - id: implement
    loop:
      over: "{{split.tasks}}"
      retries: 8
      steps:
        - id: build
          agent: builder
`,
    );

    const calls: Array<{agent: string; task: string}> = [];
    const provider = recordingProvider(
      [
        agentOutput('success', 'Split.', {tasks: [{title: 'first'}]}),
        agentOutput('blocked', 'Needs a product decision.', null, 'blocked'),
        agentOutput('success', 'Should not run.'),
      ],
      calls,
    );

    try {
      const {result, stderr} = await runHarnessWithOutput({
        inputText: 'decide first',
        name: 'work',
        projectCwd,
        provider,
      });

      expect(result.status).toBe('blocked');
      expect(result.attempts).toHaveLength(1);
      expect(calls.map(call => call.agent)).toEqual(['splitter', 'builder']);
      expect(stderr).toContain('retry 1/9');
      expect(stderr).not.toContain('retry 2/9');
      expect(stderr).toContain('retry: 1/9');
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
      expect(formatHarnessSummary(inspected)).toContain(': running');
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
      const {result} = await runHarnessWithOutput({
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
  events: AgentQEvent[] = [],
): AgentProvider {
  let index = 0;
  return {
    run: async (prepared, options) => {
      for (const event of events) {
        options.onEvent?.(event);
      }
      const result = results[index++] ?? agentOutput('success', 'ok');
      if (typeof result === 'string') {
        await writeFile(prepared.paths.outputPath, result, 'utf8');
        return providerResult();
      }
      return result;
    },
  };
}

async function runHarnessWithOutput(
  request: Parameters<typeof runHarness>[0],
): Promise<{
  result: Awaited<ReturnType<typeof runHarness>>;
  stderr: string;
  stdout: string;
}> {
  const capture = captureOutput();
  try {
    const result = await runHarness(request);
    return {
      result,
      stderr: capture.stderrChunks.join(''),
      stdout: capture.stdoutChunks.join(''),
    };
  } finally {
    capture.restore();
  }
}

function captureOutput(): {
  restore: () => void;
  stderrChunks: string[];
  stdoutChunks: string[];
} {
  const stdout = process.stdout as typeof process.stdout & {
    write: typeof process.stdout.write;
  };
  const stderr = process.stderr as typeof process.stderr & {
    write: typeof process.stderr.write;
  };
  const originalStdoutWrite = stdout.write.bind(process.stdout);
  const originalStderrWrite = stderr.write.bind(process.stderr);
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  Object.defineProperty(stdout, 'write', {
    configurable: true,
    value: ((chunk: unknown) => {
      stdoutChunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write,
  });

  Object.defineProperty(stderr, 'write', {
    configurable: true,
    value: ((chunk: unknown) => {
      stderrChunks.push(String(chunk));
      return true;
    }) as typeof process.stderr.write,
  });

  return {
    restore: () => {
      Object.defineProperty(stdout, 'write', {
        configurable: true,
        value: originalStdoutWrite,
      });
      Object.defineProperty(stderr, 'write', {
        configurable: true,
        value: originalStderrWrite,
      });
    },
    stderrChunks,
    stdoutChunks,
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
