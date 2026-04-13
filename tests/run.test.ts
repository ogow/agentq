import {describe, expect, test} from 'bun:test';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runAgent} from '../src/core/run';
import type {AgentProvider} from '../src/providers/provider';
import type {ProviderRunResult} from '../src/core/types';

const VALID_AGENT = `---
id: timeout-agent
description: Test agent used for run timeout metadata.
model: gpt-5.4
provider: codex
reasoning: none
sandbox: workspace-write
timeout: 100ms
---

<instructions>
Be useful.
</instructions>

<task>
</task>

<artifacts>
Write output.md.
</artifacts>
`;

describe('run contract', () => {
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

async function writeAgent(projectCwd: string): Promise<void> {
  const agentsDir = join(projectCwd, '.agentq', 'agents');
  await mkdir(agentsDir, {recursive: true});
  await writeFile(join(agentsDir, 'timeout-agent.md'), VALID_AGENT, 'utf8');
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
