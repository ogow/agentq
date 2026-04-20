import {describe, expect, test} from 'bun:test';
import {mkdtempSync} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {currentHost} from '../src/core/processes';
import {formatWorkStatus, listWorkStatus, stopWork} from '../src/core/status';

describe('status', () => {
  test('reports running work by checking the recorded pid', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-status-'));
    const runsDir = join(root, '.agentq', 'runs');
    const runDir = join(runsDir, 'builder-abc123');
    await mkdir(runDir, {recursive: true});
    await writeJson(join(runDir, 'run.json'), {
      agent: {id: 'builder'},
      process: {
        command: 'codex exec',
        host: currentHost(),
        pid: process.pid,
        startedAt: new Date().toISOString(),
      },
      projectCwd: root,
      startedAt: new Date().toISOString(),
      status: 'running',
      task: 'build',
    });

    const items = await listWorkStatus({homeDir: join(root, '.agentq')});

    expect(items).toMatchObject([
      {
        agentId: 'builder',
        kind: 'agent',
        runId: 'builder-abc123',
        result: 'running',
        state: 'running',
      },
    ]);
    expect(formatWorkStatus(items)).toContain('pid=');
  });

  test('treats a missing recorded pid as stopped', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-status-'));
    const runDir = join(root, '.agentq', 'runs', 'builder-def456');
    await mkdir(runDir, {recursive: true});
    await writeJson(join(runDir, 'run.json'), {
      agent: {id: 'builder'},
      process: {
        command: 'codex exec',
        host: currentHost(),
        pid: 9_999_999,
        startedAt: new Date().toISOString(),
      },
      startedAt: new Date().toISOString(),
      status: 'running',
      task: 'build',
    });

    const active = await listWorkStatus({homeDir: join(root, '.agentq')});
    const all = await listWorkStatus({
      all: true,
      homeDir: join(root, '.agentq'),
    });

    expect(active).toEqual([]);
    expect(all[0]).toMatchObject({
      result: 'running',
      state: 'stopped',
    });
  });

  test('treats terminal agent records as stopped before checking pid liveness', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-status-'));
    const homeDir = join(root, '.agentq');
    const runDir = join(homeDir, 'runs', 'builder-done');
    await mkdir(runDir, {recursive: true});
    await writeJson(join(runDir, 'run.json'), {
      agent: {id: 'builder'},
      completedAt: '2026-04-18T10:01:00.000Z',
      process: {
        command: 'codex exec',
        host: currentHost(),
        pid: process.pid,
        startedAt: '2026-04-18T10:00:00.000Z',
      },
      startedAt: '2026-04-18T10:00:00.000Z',
      status: 'succeeded',
      task: 'build',
      timedOut: false,
    });

    const active = await listWorkStatus({homeDir});
    const all = await listWorkStatus({all: true, homeDir});
    const stopped = await stopWork('builder-done', {homeDir});
    const metadata = JSON.parse(
      await readFile(join(runDir, 'run.json'), 'utf8'),
    ) as {status: string};

    expect(active).toEqual([]);
    expect(all[0]).toMatchObject({
      result: 'succeeded',
      state: 'stopped',
    });
    expect(stopped).toMatchObject({
      result: 'succeeded',
      state: 'stopped',
    });
    expect(metadata.status).toBe('succeeded');
  });

  test('treats terminal harness records as stopped before checking pid liveness', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-status-'));
    const homeDir = join(root, '.agentq');
    const runDir = join(homeDir, 'harness-runs', 'work-done');
    await mkdir(runDir, {recursive: true});
    await writeJson(join(runDir, 'tasks.json'), {
      attempts: [],
      finishedAt: '2026-04-18T10:01:00.000Z',
      harnessName: 'work',
      process: {
        command: 'agentq harness run',
        host: currentHost(),
        pid: process.pid,
        startedAt: '2026-04-18T10:00:00.000Z',
      },
      startedAt: '2026-04-18T10:00:00.000Z',
      status: 'success',
    });

    const active = await listWorkStatus({homeDir});
    const all = await listWorkStatus({all: true, homeDir});

    expect(active).toEqual([]);
    expect(all[0]).toMatchObject({
      harnessName: 'work',
      result: 'success',
      state: 'stopped',
    });
  });

  test('stop marks a run interrupted when no live process remains', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-status-'));
    const homeDir = join(root, '.agentq');
    const runDir = join(homeDir, 'runs', 'builder-stop');
    await mkdir(runDir, {recursive: true});
    await writeJson(join(runDir, 'run.json'), {
      agent: {id: 'builder'},
      process: {
        command: 'codex exec',
        host: currentHost(),
        pid: 9_999_999,
        startedAt: new Date().toISOString(),
      },
      startedAt: new Date().toISOString(),
      status: 'running',
      task: 'build',
      timedOut: false,
    });

    const item = await stopWork('builder-stop', {homeDir});
    const metadata = JSON.parse(
      await readFile(join(runDir, 'run.json'), 'utf8'),
    ) as {status: string};

    expect(item.state).toBe('stopped');
    expect(item.result).toBe('interrupted');
    expect(metadata.status).toBe('interrupted');
  });
});

function writeJson(path: string, value: unknown): Promise<void> {
  return writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
