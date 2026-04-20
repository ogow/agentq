import {describe, expect, test} from 'bun:test';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runAgent} from '../src/core/run';
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
});

function providerResult(result: ProviderRunResult): AgentProvider {
  return {
    run: async () => result,
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
