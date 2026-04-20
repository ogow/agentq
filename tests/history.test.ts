import {describe, expect, test} from 'bun:test';
import {mkdtempSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  inspectRunHistory,
  listRunHistory,
  parseRunLookbackMs,
} from '../src/core/history';
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

  test('inspects a run by explicit directory path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-history-'));
    const runDir = join(root, 'custom-run');
    const runMetadata = metadata('reviewer', '2026-04-13T12:00:00.000Z');
    runMetadata.config.approval = 'on-request';
    runMetadata.changedFiles = [
      {operation: 'update', path: 'src/core/render.ts', source: 'apply_patch'},
    ];
    runMetadata.toolUsage = [
      {calls: 2, failures: 0, name: 'exec_command', successes: 2},
    ];
    await writeInspectionRun(runDir, runMetadata, 'Final answer.\nLine two.');

    const inspection = await inspectRunHistory(runDir);

    expect(inspection.runDir).toBe(runDir);
    expect(inspection.runId).toBe('custom-run');
    expect(inspection.metadata.agent.id).toBe('reviewer');
    expect(inspection.metadata.config.approval).toBe('on-request');
    expect(inspection.output).toContain('Final answer.');
    expect(inspection.output).toContain('Line two.');
  });

  test('inspects a run by id under the AgentQ runs directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-history-'));
    const homeDir = join(root, '.agentq');
    const runDir = join(homeDir, 'runs', 'reviewer-abc123');
    const runMetadata = metadata('reviewer', '2026-04-13T12:00:00.000Z');
    await writeInspectionRun(runDir, runMetadata, 'Saved output.');

    const inspection = await inspectRunHistory('reviewer-abc123', {homeDir});

    expect(inspection.runDir).toBe(runDir);
    expect(inspection.runId).toBe('reviewer-abc123');
    expect(inspection.metadata.agent.id).toBe('reviewer');
    expect(inspection.output).toBe('Saved output.');
  });

  test('throws a useful error when the run record is missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-history-'));
    const homeDir = join(root, '.agentq');

    await expect(inspectRunHistory('missing-run', {homeDir})).rejects.toThrow(
      'Agent run not found: missing-run',
    );
  });

  test('throws a useful error when the run record is invalid JSON', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-history-'));
    const homeDir = join(root, '.agentq');
    const runDir = join(homeDir, 'runs', 'broken-json');
    await mkdir(runDir, {recursive: true});
    await writeFile(join(runDir, 'run.json'), '{not valid json', 'utf8');

    await expect(inspectRunHistory('broken-json', {homeDir})).rejects.toThrow(
      `Invalid run record: ${join(runDir, 'run.json')}`,
    );
  });

  test('throws a useful error when the run record has invalid nested fields', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-history-'));
    const homeDir = join(root, '.agentq');
    const runDir = join(homeDir, 'runs', 'broken-shape');
    await mkdir(runDir, {recursive: true});
    await writeFile(
      join(runDir, 'run.json'),
      JSON.stringify(
        {
          agent: null,
          changedFiles: [],
          config: null,
          startedAt: '2026-04-13T12:00:00.000Z',
          status: 'succeeded',
          toolUsage: [],
        },
        null,
        2,
      ),
      'utf8',
    );

    await expect(inspectRunHistory('broken-shape', {homeDir})).rejects.toThrow(
      `Invalid run record: ${join(runDir, 'run.json')}`,
    );
  });

  test('returns an empty output string when output.md is missing or empty', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-history-'));
    const homeDir = join(root, '.agentq');

    const missingOutputRunDir = join(homeDir, 'runs', 'missing-output');
    await writeInspectionRun(
      missingOutputRunDir,
      metadata('missing-output', '2026-04-13T12:00:00.000Z'),
    );

    const emptyOutputRunDir = join(homeDir, 'runs', 'empty-output');
    await writeInspectionRun(
      emptyOutputRunDir,
      metadata('empty-output', '2026-04-13T12:00:00.000Z'),
      '   ',
    );

    const missingOutput = await inspectRunHistory('missing-output', {homeDir});
    const emptyOutput = await inspectRunHistory('empty-output', {homeDir});

    expect(missingOutput.output).toBe('');
    expect(emptyOutput.output).toBe('');
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

async function writeInspectionRun(
  runDir: string,
  runMetadata: RunMetadata,
  output?: string,
): Promise<void> {
  await mkdir(runDir, {recursive: true});
  await writeFile(
    join(runDir, 'run.json'),
    `${JSON.stringify(runMetadata, null, 2)}\n`,
    'utf8',
  );
  if (output !== undefined) {
    await writeFile(join(runDir, 'output.md'), `${output}\n`, 'utf8');
  }
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
