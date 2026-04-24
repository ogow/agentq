import {describe, expect, test} from 'bun:test';
import {chmod, mkdir, readFile, writeFile} from 'node:fs/promises';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runAgent} from '../src/core/run';
import {CodexProvider} from '../src/providers/codex';
import type {AgentProvider} from '../src/providers/provider';
import type {
  PreparedRun,
  ProviderRunResult,
  ResultMode,
} from '../src/core/types';

const VALID_AGENT = `---
id: timeout-agent
description: Test agent used for run timeout metadata.
model: gpt-5.4
provider: codex
reasoning: none
result_mode: plain
sandbox: workspace-write
timeout: 100ms
---

<instructions>
Be useful.
</instructions>

<task>
{{task}}
</task>

<artifacts>
Write output.md under {{artifacts}}.
</artifacts>
`;

describe('run contract', () => {
  test('runs plain and json agents with rendered task and artifact placeholders', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-run-'));
    const restoreHome = useHome(root);
    const projectCwd = join(root, 'project');
    await writeAgent(projectCwd, {agentId: 'plain-agent', resultMode: 'plain'});
    await writeAgent(projectCwd, {agentId: 'json-agent', resultMode: 'json'});

    const preparedRuns: PreparedRun[] = [];
    const provider: AgentProvider = {
      run: async prepared => {
        preparedRuns.push(prepared);
        return {
          changedFiles: [],
          events: [{kind: 'run_started', provider: 'codex'}],
          exitCode: 0,
          stderr: '',
          timedOut: false,
          toolUsage: [],
        };
      },
    };

    try {
      const plain = await runAgent(
        {
          agentId: 'plain-agent',
          projectCwd,
          task: 'write a plain result',
        },
        provider,
      );
      const json = await runAgent(
        {
          agentId: 'json-agent',
          projectCwd,
          task: 'write a json result',
        },
        provider,
      );
      const overridden = await runAgent(
        {
          agentId: 'plain-agent',
          overrides: {resultMode: 'json'},
          projectCwd,
          task: 'override to json',
        },
        provider,
      );
      const plainMetadata = JSON.parse(
        await readFile(plain.paths.runJsonPath, 'utf8'),
      ) as {config: {resultMode: string}};
      const jsonMetadata = JSON.parse(
        await readFile(json.paths.runJsonPath, 'utf8'),
      ) as {config: {resultMode: string}};
      const overriddenMetadata = JSON.parse(
        await readFile(overridden.paths.runJsonPath, 'utf8'),
      ) as {config: {resultMode: string}};

      expect(preparedRuns).toHaveLength(3);
      expect(preparedRuns[0].config.resultMode).toBe('plain');
      expect(preparedRuns[0].prompt).toContain(
        '<task>\nwrite a plain result\n</task>',
      );
      expect(preparedRuns[0].prompt).toContain(
        `Write output.md under ${preparedRuns[0].paths.artifactsDirPath}.`,
      );
      expect(preparedRuns[0].prompt).not.toContain('{{task}}');
      expect(preparedRuns[0].prompt).not.toContain('{{artifacts}}');
      expect(plainMetadata.config.resultMode).toBe('plain');

      expect(preparedRuns[1].config.resultMode).toBe('json');
      expect(preparedRuns[1].prompt).toContain(
        '<task>\nwrite a json result\n</task>',
      );
      expect(preparedRuns[1].prompt).toContain(
        `Write output.md under ${preparedRuns[1].paths.artifactsDirPath}.`,
      );
      expect(preparedRuns[1].prompt).not.toContain('{{task}}');
      expect(preparedRuns[1].prompt).not.toContain('{{artifacts}}');
      expect(jsonMetadata.config.resultMode).toBe('json');

      expect(preparedRuns[2].config.resultMode).toBe('json');
      expect(preparedRuns[2].prompt).toContain(
        '<task>\noverride to json\n</task>',
      );
      expect(preparedRuns[2].prompt).toContain('AgentQ result mode:\njson');
      expect(preparedRuns[2].prompt).toContain(
        'Final output must be valid JSON only',
      );
      expect(overriddenMetadata.config.resultMode).toBe('json');
    } finally {
      restoreHome();
    }
  });

  test('persists parent links for nested agent runs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-run-'));
    const restoreHome = useHome(root);
    const projectCwd = join(root, 'project');
    await writeAgent(projectCwd);

    const provider: AgentProvider = {
      run: async () => {
        return {
          changedFiles: [],
          events: [{kind: 'run_started', provider: 'codex'}],
          exitCode: 0,
          stderr: '',
          timedOut: false,
          toolUsage: [],
        };
      },
    };

    try {
      const result = await runAgent(
        {
          agentId: 'timeout-agent',
          projectCwd,
          runtimeParent: {
            kind: 'harness',
            runId: 'work-a1b2c3',
            stepId: 'build',
          },
          task: 'run nested work',
        },
        provider,
      );
      const metadata = JSON.parse(
        await readFile(result.paths.runJsonPath, 'utf8'),
      ) as {
        parent?: {kind: string; runId: string; stepId?: string};
      };

      expect(result.status).toBe('succeeded');
      expect(metadata.parent).toEqual({
        kind: 'harness',
        runId: 'work-a1b2c3',
        stepId: 'build',
      });
    } finally {
      restoreHome();
    }
  });

  test('records provider process metadata when the provider reports a spawn', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-run-'));
    const restoreHome = useHome(root);
    const projectCwd = join(root, 'project');
    await writeAgent(projectCwd);

    const provider: AgentProvider = {
      run: async (_prepared, options) => {
        await options.onSpawn?.({
          command: 'codex exec',
          host: 'local',
          pid: 12345,
          startedAt: '2026-04-18T10:00:00.000Z',
        });
        return {
          changedFiles: [],
          events: [{kind: 'run_started', provider: 'codex'}],
          exitCode: 0,
          stderr: '',
          timedOut: false,
          toolUsage: [],
        };
      },
    };

    try {
      const result = await runAgent(
        {
          agentId: 'timeout-agent',
          projectCwd,
          task: 'record pid',
        },
        provider,
      );
      const metadata = JSON.parse(
        await readFile(result.paths.runJsonPath, 'utf8'),
      ) as {
        process?: {pid: number; stoppedAt?: string; stopReason?: string};
      };

      expect(metadata.process?.pid).toBe(12345);
      expect(metadata.process?.stoppedAt).toBeTruthy();
      expect(metadata.process?.stopReason).toBe('exit');
    } finally {
      restoreHome();
    }
  });

  test('records interrupted metadata when the provider is stopped', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-run-'));
    const restoreHome = useHome(root);
    const projectCwd = join(root, 'project');
    await writeAgent(projectCwd);

    const provider: AgentProvider = {
      run: async (_prepared, options) => {
        await options.onSpawn?.({
          command: 'codex exec',
          host: 'local',
          pid: 12345,
          startedAt: '2026-04-18T10:00:00.000Z',
        });
        return {
          changedFiles: [],
          events: [{kind: 'run_started', provider: 'codex'}],
          exitCode: null,
          interrupted: true,
          stderr: '',
          timedOut: false,
          toolUsage: [],
        };
      },
    };

    try {
      const result = await runAgent(
        {
          agentId: 'timeout-agent',
          projectCwd,
          task: 'stop the run',
        },
        provider,
      );
      const metadata = JSON.parse(
        await readFile(result.paths.runJsonPath, 'utf8'),
      ) as {
        process?: {stoppedAt?: string; stopReason?: string};
        status: string;
      };

      expect(result.status).toBe('interrupted');
      expect(metadata.status).toBe('interrupted');
      expect(metadata.process?.stoppedAt).toBeTruthy();
      expect(metadata.process?.stopReason).toBe('interrupted');
    } finally {
      restoreHome();
    }
  });

  test('records timeout metadata when the provider times out', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-run-'));
    const restoreHome = useHome(root);
    const projectCwd = join(root, 'project');
    await writeAgent(projectCwd);

    const provider = providerResult({
      changedFiles: [],
      events: [{kind: 'run_started', provider: 'codex'}],
      exitCode: null,
      stderr: 'provider stderr',
      timedOut: true,
      toolUsage: [],
    });

    try {
      const result = await runAgent(
        {
          agentId: 'timeout-agent',
          projectCwd,
          task: 'do slow work',
        },
        provider,
      );
      const metadata = JSON.parse(
        await readFile(result.paths.runJsonPath, 'utf8'),
      ) as {
        eventCount: number;
        failure?: {kind: string; stderrTail?: string; timedOut: boolean};
        status: string;
        timedOut: boolean;
      };

      expect(result.status).toBe('timed_out');
      expect(metadata.status).toBe('timed_out');
      expect(metadata.timedOut).toBe(true);
      expect(metadata.eventCount).toBe(1);
      expect(metadata.failure?.kind).toBe('timeout');
      expect(metadata.failure?.stderrTail).toBe('provider stderr');
      expect(metadata.failure?.timedOut).toBe(true);
    } finally {
      restoreHome();
    }
  });

  test('treats timeout as terminal even when exit code is zero', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-run-'));
    const restoreHome = useHome(root);
    const projectCwd = join(root, 'project');
    await writeAgent(projectCwd);

    const provider = providerResult({
      changedFiles: [],
      events: [],
      exitCode: 0,
      stderr: '',
      timedOut: true,
      toolUsage: [],
    });

    try {
      const result = await runAgent(
        {
          agentId: 'timeout-agent',
          projectCwd,
          task: 'do slow work',
        },
        provider,
      );

      expect(result.status).toBe('timed_out');
      expect(result.exitCode).toBe(0);
      expect(result.timedOut).toBe(true);
    } finally {
      restoreHome();
    }
  });

  test('treats Codex task completion as terminal when the provider process lingers', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-provider-'));
    const binDir = join(root, 'bin');
    const projectCwd = join(root, 'project');
    const runDir = join(root, 'run');
    await mkdir(binDir, {recursive: true});
    await mkdir(projectCwd, {recursive: true});
    await mkdir(runDir, {recursive: true});
    await writeFile(
      join(binDir, 'codex'),
      `#!/usr/bin/env bun
console.log(JSON.stringify({
  type: 'event_msg',
  payload: {
    type: 'task_complete',
    last_agent_message: 'final answer',
  },
}));
await new Promise(() => undefined);
`,
      'utf8',
    );
    await chmod(join(binDir, 'codex'), 0o755);

    const codexPath = join(binDir, 'codex');
    const provider = new CodexProvider(binary =>
      binary === 'codex' ? codexPath : Bun.which(binary),
    );

    const startedAt = Date.now();
    const result = await provider.run(preparedCodexRun(projectCwd, runDir), {
      agentId: 'linger-agent',
      progress: false,
    });
    const output = await readFile(join(runDir, 'output.md'), 'utf8');

    expect(Date.now() - startedAt).toBeLessThan(1500);
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.events.map(event => event.kind)).toContain('run_completed');
    expect(output.trim()).toBe('final answer');
  });
});

function providerResult(result: ProviderRunResult): AgentProvider {
  return {
    run: async () => result,
  };
}

function preparedCodexRun(projectCwd: string, runDir: string): PreparedRun {
  return {
    agent: {
      body: '',
      filePath: join(projectCwd, '.agentq', 'agents', 'linger-agent.md'),
      frontmatter: {
        description: 'Test lingering provider completion.',
        id: 'linger-agent',
        model: 'gpt-5.4',
        provider: 'codex',
        reasoning: 'none',
        resultMode: 'plain',
        sandbox: 'workspace-write',
        timeout: '2s',
      },
      id: 'linger-agent',
      scope: 'project',
    },
    config: {
      agentId: 'linger-agent',
      env: {},
      model: 'gpt-5.4',
      provider: 'codex',
      reasoning: 'none',
      resultMode: 'plain',
      sandbox: 'workspace-write',
      timeout: '2s',
      timeoutMs: 2000,
    },
    paths: {
      artifactsDirPath: join(runDir, 'artifacts'),
      outputPath: join(runDir, 'output.md'),
      runDir,
      runJsonPath: join(runDir, 'run.json'),
      stderrPath: join(runDir, 'stderr.log'),
      stdoutPath: join(runDir, 'stdout.jsonl'),
    },
    projectCwd,
    prompt: 'finish cleanly',
    task: 'finish cleanly',
  };
}

async function writeAgent(
  projectCwd: string,
  options: {agentId?: string; resultMode?: ResultMode} = {},
): Promise<void> {
  const agentId = options.agentId ?? 'timeout-agent';
  const resultMode = options.resultMode ?? 'plain';
  const agentsDir = join(projectCwd, '.agentq', 'agents');
  await mkdir(agentsDir, {recursive: true});
  await writeFile(
    join(agentsDir, `${agentId}.md`),
    VALID_AGENT.replace('id: timeout-agent', `id: ${agentId}`).replace(
      'result_mode: plain',
      `result_mode: ${resultMode}`,
    ),
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
