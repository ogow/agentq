import {describe, expect, test} from 'bun:test';
import {mkdtempSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {listRunHistory, parseRunLookbackMs} from '../src/core/history';
import type {RunMetadata} from '../src/core/metadata';

describe('run history', () => {
  test('lists previous runs newest first with lookback and limit filters', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-history-'));
    const runsDir = join(root, 'runs');

    await writeRun(
      runsDir,
      'old',
      metadata('old-agent', '2026-04-10T12:00:00.000Z'),
    );
    await writeRun(
      runsDir,
      'new',
      metadata('new-agent', '2026-04-13T12:00:00.000Z'),
    );
    await writeRun(
      runsDir,
      'middle',
      metadata('middle-agent', '2026-04-12T12:00:00.000Z'),
    );

    const runs = await listRunHistory({
      limit: 2,
      now: new Date('2026-04-13T13:00:00.000Z'),
      runsDir,
      sinceMs: parseRunLookbackMs('2d'),
    });

    expect(runs.map(run => run.metadata.agent.id)).toEqual([
      'new-agent',
      'middle-agent',
    ]);
  });

  test('parses run history lookback durations', () => {
    expect(parseRunLookbackMs('1h')).toBe(3600000);
    expect(parseRunLookbackMs('7d')).toBe(604800000);
    expect(parseRunLookbackMs('2w')).toBe(1209600000);
    expect(() => parseRunLookbackMs('0d')).toThrow();
    expect(() => parseRunLookbackMs('soon')).toThrow();
  });
});

async function writeRun(
  runsDir: string,
  name: string,
  runMetadata: RunMetadata,
): Promise<void> {
  const runDir = join(runsDir, name);
  await mkdir(runDir, {recursive: true});
  await writeFile(
    join(runDir, 'run.json'),
    `${JSON.stringify(runMetadata, null, 2)}\n`,
    'utf8',
  );
}

function metadata(agentId: string, startedAt: string): RunMetadata {
  const runDir = `/home/me/.agentq/runs/${agentId}-abc`;
  return {
    agent: {
      description: 'Test agent.',
      filePath: `/repo/.agentq/agents/${agentId}.md`,
      id: agentId,
      scope: 'project',
    },
    changedFiles: [],
    completedAt: startedAt,
    config: {
      envKeys: [],
      model: 'gpt-5.4-mini',
      provider: 'codex',
      reasoning: 'low',
      resultMode: 'plain',
      sandbox: 'workspace-write',
      timeout: '1m',
      timeoutMs: 60000,
    },
    durationMs: 1000,
    eventCount: 1,
    exitCode: 0,
    paths: {
      artifacts: `${runDir}/artifacts`,
      output: `${runDir}/output.md`,
      runDir,
      stderr: `${runDir}/stderr.log`,
      stdout: `${runDir}/stdout.jsonl`,
    },
    projectCwd: '/repo',
    startedAt,
    status: 'succeeded',
    task: `run ${agentId}`,
    timedOut: false,
    toolUsage: [],
  };
}
