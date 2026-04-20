import {describe, expect, test} from 'bun:test';
import {mkdtempSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runHarness} from '../src/core/harness';
import type {AgentProvider} from '../src/providers/provider';

describe('harness examples', () => {
  test('project work harness uses real harness and agent files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-example-'));
    const restoreHome = useHome(root);
    const projectCwd = join(root, 'project');
    await writeAgent(projectCwd);
    await writeHarness(projectCwd);
    const provider: AgentProvider = {
      run: async prepared => {
        await writeFile(
          prepared.paths.outputPath,
          JSON.stringify({
            artifacts: [],
            feedback: null,
            result: null,
            status: 'success',
            summary: 'Done.',
          }),
          'utf8',
        );
        return {
          changedFiles: [],
          events: [],
          exitCode: 0,
          stderr: '',
          timedOut: false,
          toolUsage: [],
        };
      },
    };

    try {
      const {result} = await runHarnessWithOutput({
        inputText: 'do it',
        name: 'work',
        projectCwd,
        provider,
      });

      expect(result.status).toBe('success');
      expect(result.attempts).toHaveLength(1);
    } finally {
      restoreHome();
    }
  });

  test('does not resolve embedded harnesses', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-example-'));
    const restoreHome = useHome(root);
    const projectCwd = join(root, 'project');
    await writeAgent(projectCwd);
    const provider: AgentProvider = {
      run: async () => {
        throw new Error('provider should not run');
      },
    };

    try {
      await expect(
        runHarnessWithOutput({
          inputText: 'do it',
          name: 'work',
          projectCwd,
          provider,
        }),
      ).rejects.toThrow(
        'Could not find harness "work" in .agentq/harnesses or',
      );
    } finally {
      restoreHome();
    }
  });
});

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

async function writeAgent(projectCwd: string): Promise<void> {
  const agentsDir = join(projectCwd, '.agentq', 'agents');
  await mkdir(agentsDir, {recursive: true});
  await writeFile(
    join(agentsDir, 'harness-builder.md'),
    `---
id: harness-builder
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
`,
    'utf8',
  );
}

async function writeHarness(projectCwd: string): Promise<void> {
  const harnessDir = join(projectCwd, '.agentq', 'harnesses');
  await mkdir(harnessDir, {recursive: true});
  await writeFile(
    join(harnessDir, 'work.yaml'),
    `name: work
agent: harness-builder
retries: 1

inputs:
  task: string
`,
    'utf8',
  );
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
