import {describe, expect, test} from 'bun:test';
import {mkdtempSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {buildCli} from '../src/cli';
import type {RunMetadata} from '../src/core/metadata';

describe('cli routing', () => {
  test('bare invocation requires a command instead of opening a workbench', async () => {
    await expect((async () => buildCli([]).parseAsync())()).rejects.toThrow(
      /Choose a command/,
    );
  });

  test('rejects removed TUI harness view command', async () => {
    await expect(
      (async () => buildCli(['harness', 'view', 'work-a1b2c3']).parseAsync())(),
    ).rejects.toThrow(/Unknown argument|view/);
  });

  test('accepts status command flags', async () => {
    const restoreHome = useHome(mkdtempSync(join(tmpdir(), 'agentq-cli-')));
    try {
      await expect(
        buildCli(['status', '--all', '--json']).parseAsync(),
      ).resolves.toBeDefined();
    } finally {
      restoreHome();
    }
  });

  test('routes runs list without requiring an inspect target', async () => {
    const restoreHome = useHome(mkdtempSync(join(tmpdir(), 'agentq-cli-')));
    const {chunks, restoreStdout} = captureStdout();

    try {
      await expect(
        buildCli([
          'runs',
          'list',
          '--since',
          '1h',
          '--limit',
          '5',
        ]).parseAsync(),
      ).resolves.toBeDefined();
    } finally {
      restoreStdout();
      restoreHome();
    }

    expect(chunks.join('')).toContain('No runs found');
  });

  test('routes runs inspect and prints run details', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-cli-'));
    const homeDir = join(root, '.agentq');
    const restoreHome = useHome(root);
    const runDir = join(homeDir, 'runs', 'reviewer-abc123');
    await writeInspectionRun(runDir, inspectionMetadata(runDir));
    const {chunks, restoreStdout} = captureStdout();

    try {
      await expect(
        buildCli([
          'runs',
          'inspect',
          'reviewer-abc123',
          '--no-color',
        ]).parseAsync(),
      ).resolves.toBeDefined();
    } finally {
      restoreStdout();
      restoreHome();
    }

    const output = chunks.join('');
    expect(output).toContain('Run Inspection');
    expect(output).toContain('agent id');
    expect(output).toContain('reviewer');
    expect(output).toContain('approval');
    expect(output).toContain('on-request');
    expect(output).toContain('tools');
    expect(output).toContain('edits');
    expect(output).toContain('Failure');
    expect(output).toContain('provider_exit');
    expect(output).toContain('Final answer.');
  });

  test('routes harness jsonl output to stdout without human summary', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-cli-'));
    const restoreHome = useHome(root);
    const projectCwd = join(root, 'project');
    await writeHarness(
      projectCwd,
      'work',
      `name: work
steps:
  - id: build
    command: ["bun", "-e", "console.log('ok')"]
`,
    );
    const restoreCwd = useCwd(projectCwd);
    const stdoutCapture = captureStdout();
    const stderrCapture = captureStderr();

    try {
      process.exitCode = 0;
      await expect(
        buildCli([
          'harness',
          'run',
          'work',
          '--jsonl',
          '--no-color',
        ]).parseAsync(),
      ).resolves.toBeDefined();

      const stdout = stdoutCapture.chunks.join('');
      const stderr = stderrCapture.chunks.join('');
      const lines = stdout
        .trim()
        .split('\n')
        .filter(line => line.length > 0)
        .map(
          line =>
            JSON.parse(line) as {
              durationMs?: number;
              status?: string;
              type: string;
            },
        );

      expect(stderr).toBe('');
      expect(stdout).not.toContain('Harness work:');
      expect(lines.map(line => line.type)).toEqual([
        'harness.started',
        'task.started',
        'task.finished',
        'harness.finished',
      ]);
      expect(lines.at(-1)).toMatchObject({
        durationMs: expect.any(Number),
        status: 'success',
        type: 'harness.finished',
      });
    } finally {
      stderrCapture.restoreStderr();
      stdoutCapture.restoreStdout();
      process.exitCode = 0;
      restoreCwd();
      restoreHome();
    }
  });

  test('routes harness -v output to verbose stderr lines', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-cli-'));
    const restoreHome = useHome(root);
    const projectCwd = join(root, 'project');
    await writeHarness(
      projectCwd,
      'work',
      `name: work
steps:
  - id: build
    command: ["bun", "-e", "console.log('ok')"]
`,
    );
    const restoreCwd = useCwd(projectCwd);
    const stdoutCapture = captureStdout();
    const stderrCapture = captureStderr();

    try {
      process.exitCode = 0;
      await expect(
        buildCli(['harness', 'run', 'work', '-v', '--no-color']).parseAsync(),
      ).resolves.toBeDefined();

      const stdout = stdoutCapture.chunks.join('');
      const stderr = stderrCapture.chunks.join('');
      const lines = stderr
        .trim()
        .split('\n')
        .filter(line => line.length > 0);

      expect(stdout).toContain('work: success');
      expect(lines[0]).toMatch(/^[^\s]+$/);
      expect(stderr).toContain('▸ task 1/1  retry 1/1  work');
      expect(stderr).toContain('▸ build');
      expect(stderr).toContain('✓ build');
      expect(stderr).toContain('Check build passed.');
    } finally {
      stderrCapture.restoreStderr();
      stdoutCapture.restoreStdout();
      process.exitCode = 0;
      restoreCwd();
      restoreHome();
    }
  });

  test('routes harness -vv output to verbose stderr diagnostics', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-cli-'));
    const restoreHome = useHome(root);
    const projectCwd = join(root, 'project');
    await writeHarness(
      projectCwd,
      'work',
      `name: work
steps:
  - id: build
    command: ["bun", "-e", "console.log('noise'); console.error('boom'); process.exit(1)"]
`,
    );
    const restoreCwd = useCwd(projectCwd);
    const stdoutCapture = captureStdout();
    const stderrCapture = captureStderr();

    try {
      process.exitCode = 0;
      await expect(
        buildCli(['harness', 'run', 'work', '-vv', '--no-color']).parseAsync(),
      ).resolves.toBeDefined();

      const stdout = stdoutCapture.chunks.join('');
      const stderr = stderrCapture.chunks.join('');

      expect(process.exitCode ?? 0).toBe(1);
      expect(stdout).toContain('work: failed');
      expect(stderr).toContain('▸ task 1/1  retry 1/1  work');
      expect(stderr).toContain(
        "command: bun -e console.log('noise'); console.error('boom'); process.exit(1)",
      );
      expect(stderr).toContain('stderr: boom');
      expect(stderr).toContain('stdout: noise');
      expect(stderr).not.toContain('agent work --:-- message');
    } finally {
      stderrCapture.restoreStderr();
      stdoutCapture.restoreStdout();
      process.exitCode = 0;
      restoreCwd();
      restoreHome();
    }
  });

  test('routes harness --jsonl -vv output with debug diagnostics', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-cli-'));
    const restoreHome = useHome(root);
    const projectCwd = join(root, 'project');
    await writeHarness(
      projectCwd,
      'work',
      `name: work
steps:
  - id: build
    command: ["bun", "-e", "console.log('noise'); console.error('boom'); process.exit(1)"]
`,
    );
    const restoreCwd = useCwd(projectCwd);
    const stdoutCapture = captureStdout();
    const stderrCapture = captureStderr();

    try {
      process.exitCode = 0;
      await expect(
        buildCli([
          'harness',
          'run',
          'work',
          '--jsonl',
          '-vv',
          '--no-color',
        ]).parseAsync(),
      ).resolves.toBeDefined();

      const stdout = stdoutCapture.chunks.join('');
      const stderr = stderrCapture.chunks.join('');
      const lines = stdout
        .trim()
        .split('\n')
        .filter(line => line.length > 0)
        .map(
          line =>
            JSON.parse(line) as {
              agentRunDir?: string;
              command?: string;
              exitCode?: number;
              stderrTail?: string;
              stdoutTail?: string;
              type: string;
            },
        );

      expect(stderr).toBe('');
      expect(stdout).not.toContain('Harness work:');
      expect(lines.map(line => line.type)).toEqual([
        'harness.started',
        'task.started',
        'step.started',
        'step.finished',
        'task.finished',
        'harness.finished',
      ]);
      expect(lines.find(line => line.type === 'step.finished')).toMatchObject({
        command:
          "bun -e console.log('noise'); console.error('boom'); process.exit(1)",
        exitCode: 1,
        stderrTail: 'boom',
        stdoutTail: 'noise',
        type: 'step.finished',
      });
    } finally {
      stderrCapture.restoreStderr();
      stdoutCapture.restoreStdout();
      process.exitCode = 0;
      restoreCwd();
      restoreHome();
    }
  });

  test('routes eval run and inspect', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-cli-'));
    const restoreHome = useHome(root);
    const projectCwd = join(root, 'project');
    await writeEvalPack(
      projectCwd,
      'smoke',
      `import {defineEval, graders} from 'agentq/eval';

export default defineEval({
  name: 'smoke',
  cases: [
    {
      id: 'smoke-command',
      type: 'command',
      command: ['bun', '-e', 'console.log("Eval smoke");'],
      graders: [
        graders.exitCode(0),
        graders.stdoutContains('Eval smoke'),
      ],
    },
  ],
});
`,
    );
    const restoreCwd = useCwd(projectCwd);
    let restoreRunStdout: () => void = () => undefined;
    let restoreInspectStdout: () => void = () => undefined;

    try {
      process.exitCode = 0;
      const runCapture = captureStdout();
      restoreRunStdout = runCapture.restoreStdout;
      const runChunks = runCapture.chunks;
      await expect(
        buildCli(['eval', 'run', 'smoke']).parseAsync(),
      ).resolves.toBeDefined();
      expect(process.exitCode).toBe(0);

      const runOutput = runChunks.join('');
      const runLine = runOutput
        .split('\n')
        .find(line => line.startsWith('run: '));
      expect(runOutput).toContain('Eval smoke: success');
      expect(runLine).toBeTruthy();

      const runDir = runLine!.slice('run: '.length).trim();
      process.exitCode = 0;
      const inspectCapture = captureStdout();
      restoreInspectStdout = inspectCapture.restoreStdout;
      const inspectChunks = inspectCapture.chunks;
      await expect(
        buildCli(['eval', 'inspect', runDir, '--no-color']).parseAsync(),
      ).resolves.toBeDefined();

      const inspectOutput = inspectChunks.join('');
      expect(inspectOutput).toContain('Eval smoke: success');
      expect(inspectOutput).toContain('Run');
      expect(inspectOutput).toContain(runDir);
    } finally {
      restoreInspectStdout();
      restoreRunStdout();
      process.exitCode = 0;
      restoreCwd();
      restoreHome();
    }
  });

  test('successful eval exits zero and failed eval exits non-zero', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-cli-'));
    const restoreHome = useHome(root);
    const projectCwd = join(root, 'project');
    await writeEvalPack(
      projectCwd,
      'success',
      `import {defineEval, graders} from 'agentq/eval';

export default defineEval({
  name: 'success',
  cases: [
    {
      id: 'success-command',
      type: 'command',
      command: ['bun', '-e', 'console.log("ok");'],
      graders: [graders.exitCode(0)],
    },
  ],
});
`,
    );
    await writeEvalPack(
      projectCwd,
      'failure',
      `import {defineEval, graders} from 'agentq/eval';

export default defineEval({
  name: 'failure',
  cases: [
    {
      id: 'failure-command',
      type: 'command',
      command: ['bun', '-e', 'process.exit(1);'],
      graders: [graders.exitCode(0)],
    },
  ],
});
`,
    );
    const restoreCwd = useCwd(projectCwd);

    try {
      process.exitCode = 0;
      await expect(
        buildCli(['eval', 'run', 'success']).parseAsync(),
      ).resolves.toBeDefined();
      expect(process.exitCode).toBe(0);

      process.exitCode = 0;
      await expect(
        buildCli(['eval', 'run', 'failure']).parseAsync(),
      ).resolves.toBeDefined();
      expect(process.exitCode ?? 0).toBe(1);
    } finally {
      process.exitCode = 0;
      restoreCwd();
      restoreHome();
    }
  });

  test('eval pack load errors surface in run and inspect output', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-cli-'));
    const restoreHome = useHome(root);
    const projectCwd = join(root, 'project');
    await writeEvalPack(
      projectCwd,
      'broken',
      `export default {
  name: 'broken',
  cases: [],
};
`,
    );
    const restoreCwd = useCwd(projectCwd);
    const runCapture = captureStdout();
    let runDir = '';

    try {
      process.exitCode = 0;
      await expect(
        buildCli(['eval', 'run', 'broken']).parseAsync(),
      ).resolves.toBeDefined();
      expect(process.exitCode ?? 0).toBe(1);

      const runOutput = runCapture.chunks.join('');
      const runLine = runOutput
        .split('\n')
        .find(line => line.startsWith('run: '));
      expect(runOutput).toContain('error:');
      expect(runOutput).toContain('defineEval');
      expect(runLine).toBeTruthy();
      runDir = runLine!.slice('run: '.length).trim();

      const inspectCapture = captureStdout();
      try {
        process.exitCode = 0;
        await expect(
          buildCli(['eval', 'inspect', runDir, '--no-color']).parseAsync(),
        ).resolves.toBeDefined();
      } finally {
        inspectCapture.restoreStdout();
      }

      const inspectOutput = inspectCapture.chunks.join('');
      expect(inspectOutput).toContain('error:');
      expect(inspectOutput).toContain('defineEval');
      expect(inspectOutput).toContain(runDir);
    } finally {
      runCapture.restoreStdout();
      process.exitCode = 0;
      restoreCwd();
      restoreHome();
    }
  });

  test('eval inspect exits non-zero for failed eval records', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-cli-'));
    const restoreHome = useHome(root);
    const projectCwd = join(root, 'project');
    await writeEvalPack(
      projectCwd,
      'failure',
      `import {defineEval, graders} from 'agentq/eval';

export default defineEval({
  name: 'failure',
  cases: [
    {
      id: 'failure-command',
      type: 'command',
      command: ['bun', '-e', 'process.exit(1);'],
      graders: [graders.exitCode(0)],
    },
  ],
});
`,
    );
    const restoreCwd = useCwd(projectCwd);
    const runCapture = captureStdout();
    let runDir = '';

    try {
      process.exitCode = 0;
      await expect(
        buildCli(['eval', 'run', 'failure']).parseAsync(),
      ).resolves.toBeDefined();
      expect(process.exitCode ?? 0).toBe(1);

      const runOutput = runCapture.chunks.join('');
      runDir =
        runOutput
          .split('\n')
          .find(line => line.startsWith('run: '))
          ?.slice('run: '.length)
          .trim() ?? '';
      expect(runDir).toBeTruthy();

      const inspectCapture = captureStdout();
      try {
        process.exitCode = 0;
        await expect(
          buildCli(['eval', 'inspect', runDir, '--no-color']).parseAsync(),
        ).resolves.toBeDefined();
      } finally {
        inspectCapture.restoreStdout();
      }

      expect(process.exitCode ?? 0).toBe(1);
      expect(inspectCapture.chunks.join('')).toContain('failed case:');
    } finally {
      runCapture.restoreStdout();
      process.exitCode = 0;
      restoreCwd();
      restoreHome();
    }
  });
});

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

function useCwd(cwd: string): () => void {
  const originalCwd = process.cwd();
  process.chdir(cwd);
  return () => {
    process.chdir(originalCwd);
  };
}

function captureStdout(): {chunks: string[]; restoreStdout: () => void} {
  const stdout = process.stdout as typeof process.stdout & {
    write: typeof process.stdout.write;
  };
  const originalWrite = stdout.write.bind(process.stdout);
  const chunks: string[] = [];

  Object.defineProperty(stdout, 'write', {
    configurable: true,
    value: ((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write,
  });

  return {
    chunks,
    restoreStdout: () => {
      Object.defineProperty(stdout, 'write', {
        configurable: true,
        value: originalWrite,
      });
    },
  };
}

function captureStderr(): {chunks: string[]; restoreStderr: () => void} {
  const stderr = process.stderr as typeof process.stderr & {
    write: typeof process.stderr.write;
  };
  const originalWrite = stderr.write.bind(process.stderr);
  const chunks: string[] = [];

  Object.defineProperty(stderr, 'write', {
    configurable: true,
    value: ((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stderr.write,
  });

  return {
    chunks,
    restoreStderr: () => {
      Object.defineProperty(stderr, 'write', {
        configurable: true,
        value: originalWrite,
      });
    },
  };
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

async function writeInspectionRun(
  runDir: string,
  runMetadata: RunMetadata,
  output = 'Final answer.\n',
): Promise<void> {
  await mkdir(runDir, {recursive: true});
  await writeFile(
    join(runDir, 'run.json'),
    `${JSON.stringify(runMetadata, null, 2)}\n`,
    'utf8',
  );
  await writeFile(join(runDir, 'output.md'), output, 'utf8');
}

async function writeEvalPack(
  projectCwd: string,
  name: string,
  source: string,
): Promise<void> {
  const evalsDir = join(projectCwd, '.agentq', 'evals');
  await mkdir(evalsDir, {recursive: true});
  await writeFile(join(evalsDir, `${name}.ts`), source, 'utf8');
}

function inspectionMetadata(runDir: string): RunMetadata {
  return {
    agent: {
      description: 'Reviews code.',
      filePath: '/repo/.agentq/agents/reviewer.md',
      id: 'reviewer',
      scope: 'project',
    },
    changedFiles: [
      {operation: 'update', path: 'src/core/render.ts', source: 'apply_patch'},
    ],
    completedAt: '2026-04-13T12:00:03.000Z',
    config: {
      approval: 'on-request',
      envKeys: [],
      model: 'gpt-5.4-mini',
      provider: 'codex',
      reasoning: 'low',
      resultMode: 'plain',
      sandbox: 'workspace-write',
      timeout: '1m',
      timeoutMs: 60000,
    },
    durationMs: 3123,
    eventCount: 4,
    exitCode: 1,
    failure: {
      exitCode: 1,
      kind: 'provider_exit',
      message: 'Codex exited with code 1.',
      stderrTail: 'boom',
      timedOut: false,
    },
    paths: {
      artifacts: `${runDir}/artifacts`,
      output: `${runDir}/output.md`,
      runDir,
      stderr: `${runDir}/stderr.log`,
      stdout: `${runDir}/stdout.jsonl`,
    },
    projectCwd: '/repo',
    startedAt: '2026-04-13T12:00:00.000Z',
    status: 'failed',
    task: 'review this',
    timedOut: false,
    toolUsage: [{calls: 2, failures: 0, name: 'exec_command', successes: 2}],
  };
}
