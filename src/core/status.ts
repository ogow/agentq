import {existsSync} from 'node:fs';
import {readdir, readFile, writeFile} from 'node:fs/promises';
import {basename, join} from 'node:path';
import {AgentQError} from './errors';
import {agentqHome} from './home';
import {
  currentHost,
  isPidAlive,
  isSameHost,
  killProcessTreeByPid,
} from './processes';
import type {ProcessMetadata, RunStatus, WorkKind} from './types';

export type WorkState = 'running' | 'stopped';

export interface WorkStatusItem {
  agentId?: string;
  harnessName?: string;
  kind: WorkKind;
  process?: ProcessMetadata;
  projectCwd?: string;
  result: string;
  runDir: string;
  runId: string;
  state: WorkState;
  summary?: string;
}

export interface ListWorkStatusOptions {
  all?: boolean;
  homeDir?: string;
}

export async function listWorkStatus(
  options: ListWorkStatusOptions = {},
): Promise<WorkStatusItem[]> {
  const homeDir = options.homeDir ?? agentqHome();
  const items = [
    ...(await listAgentStatuses(join(homeDir, 'runs'))),
    ...(await listHarnessStatuses(join(homeDir, 'harness-runs'))),
  ];

  const filtered = options.all
    ? items
    : items.filter(item => item.state === 'running');
  return filtered.sort((left, right) => right.runId.localeCompare(left.runId));
}

export async function stopWork(
  runIdOrPath: string,
  options: {homeDir?: string; now?: Date} = {},
): Promise<WorkStatusItem> {
  const homeDir = options.homeDir ?? agentqHome();
  const candidate =
    findRunDirectory(runIdOrPath, join(homeDir, 'runs')) ??
    findRunDirectory(runIdOrPath, join(homeDir, 'harness-runs'));
  if (!candidate) {
    throw new AgentQError(`Run not found: ${runIdOrPath}`);
  }

  const item =
    candidate.kind === 'agent'
      ? await readAgentStatus(candidate.runDir)
      : await readHarnessStatus(candidate.runDir);
  if (!item) {
    throw new AgentQError(`Run status not found: ${runIdOrPath}`);
  }

  if (isTerminalResult(item.result)) {
    return item;
  }
  if (!item.process) {
    return await markInterrupted(item, options.now ?? new Date());
  }
  if (!isSameHost(item.process.host)) {
    throw new AgentQError(
      `Run ${item.runId} was started on ${item.process.host}, not ${currentHost()}.`,
    );
  }
  if (item.state !== 'running') {
    return await markInterrupted(item, options.now ?? new Date());
  }
  if (isPidAlive(item.process.pid)) {
    await killProcessTreeByPid(item.process.pid);
  }

  return await markInterrupted(item, options.now ?? new Date());
}

export function formatWorkStatus(items: WorkStatusItem[]): string {
  if (items.length === 0) {
    return 'No active AgentQ work found.';
  }

  return items.map(formatWorkStatusItem).join('\n');
}

async function listAgentStatuses(runsDir: string): Promise<WorkStatusItem[]> {
  if (!existsSync(runsDir)) {
    return [];
  }

  const entries = await readdir(runsDir, {withFileTypes: true});
  const items: WorkStatusItem[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const item = await readAgentStatus(join(runsDir, entry.name));
    if (item) {
      items.push(item);
    }
  }
  return items;
}

async function listHarnessStatuses(runsDir: string): Promise<WorkStatusItem[]> {
  if (!existsSync(runsDir)) {
    return [];
  }

  const entries = await readdir(runsDir, {withFileTypes: true});
  const items: WorkStatusItem[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const item = await readHarnessStatus(join(runsDir, entry.name));
    if (item) {
      items.push(item);
    }
  }
  return items;
}

async function readAgentStatus(
  runDir: string,
): Promise<WorkStatusItem | undefined> {
  const metadata = await readJsonObject(join(runDir, 'run.json'));
  if (!metadata) {
    return undefined;
  }

  const process = processField(metadata.process);
  const result = normalizeResult(metadata.status);
  return {
    agentId: stringField(recordField(metadata.agent)?.id),
    kind: 'agent',
    process,
    projectCwd: stringField(metadata.projectCwd),
    result,
    runDir,
    runId: basename(runDir),
    state: liveState({
      finishedAt: stringField(metadata.completedAt),
      process,
      result,
    }),
    summary: stringField(metadata.task),
  };
}

async function readHarnessStatus(
  runDir: string,
): Promise<WorkStatusItem | undefined> {
  const state = await readJsonObject(join(runDir, 'tasks.json'));
  if (!state) {
    return undefined;
  }

  const process = processField(state.process);
  const result = normalizeResult(state.status);
  return {
    harnessName: stringField(state.harnessName) ?? basename(runDir),
    kind: 'harness',
    process,
    projectCwd: stringField(state.projectCwd),
    result,
    runDir,
    runId: basename(runDir),
    state: liveState({
      finishedAt: stringField(state.finishedAt),
      process,
      result,
    }),
    summary: stringField(state.summary),
  };
}

function liveState(options: {
  finishedAt?: string;
  process?: ProcessMetadata;
  result: string;
}): WorkState {
  if (
    isTerminalResult(options.result) ||
    options.finishedAt ||
    options.process?.stoppedAt
  ) {
    return 'stopped';
  }

  const process = options.process;
  return process && processIsAlive(process) ? 'running' : 'stopped';
}

function normalizeResult(status: unknown): string {
  return typeof status === 'string' && status.trim().length > 0
    ? status
    : 'unknown';
}

function isTerminalResult(result: string): boolean {
  return result !== 'running' && result !== 'unknown';
}

async function markInterrupted(
  item: WorkStatusItem,
  now: Date,
): Promise<WorkStatusItem> {
  const stoppedAt = now.toISOString();
  if (item.kind === 'agent') {
    const path = join(item.runDir, 'run.json');
    const metadata = await readJsonObject(path);
    if (metadata) {
      metadata.status = 'interrupted' satisfies RunStatus;
      metadata.completedAt = stoppedAt;
      metadata.timedOut = false;
      metadata.process = stoppedProcess(metadata.process, stoppedAt);
      await writeJson(path, metadata);
    }
  } else {
    const path = join(item.runDir, 'tasks.json');
    const state = await readJsonObject(path);
    if (state) {
      state.status = 'interrupted';
      state.finishedAt = stoppedAt;
      state.process = stoppedProcess(state.process, stoppedAt);
      await writeJson(path, state);
    }
  }

  return {
    ...item,
    process: item.process
      ? {...item.process, stoppedAt, stopReason: 'stop'}
      : undefined,
    result: 'interrupted',
    state: 'stopped',
  };
}

function stoppedProcess(value: unknown, stoppedAt: string): unknown {
  const process = processField(value);
  if (!process) {
    return value;
  }

  return {
    ...process,
    stoppedAt,
    stopReason: 'stop',
  };
}

function processIsAlive(process: ProcessMetadata): boolean {
  return isSameHost(process.host) && isPidAlive(process.pid);
}

function formatWorkStatusItem(item: WorkStatusItem): string {
  const name = item.agentId ?? item.harnessName ?? item.runId;
  const pid =
    item.state === 'running' && item.process ? ` pid=${item.process.pid}` : '';
  const result = item.state === 'stopped' ? ` result=${item.result}` : '';
  const summary = item.summary ? ` ${item.summary}` : '';
  return `${item.state}\t${item.kind}\t${name}\t${item.runId}${pid}${result}${summary}`;
}

function findRunDirectory(
  runIdOrPath: string,
  runsDir: string,
): {kind: WorkKind; runDir: string} | undefined {
  if (existsSync(runIdOrPath)) {
    return {
      kind: existsSync(join(runIdOrPath, 'tasks.json')) ? 'harness' : 'agent',
      runDir: runIdOrPath,
    };
  }

  const runDir = join(runsDir, runIdOrPath);
  if (!existsSync(runDir)) {
    return undefined;
  }

  return {
    kind: runsDir.endsWith('harness-runs') ? 'harness' : 'agent',
    runDir,
  };
}

async function readJsonObject(
  path: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function writeJson(path: string, value: unknown): Promise<void> {
  return writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function processField(value: unknown): ProcessMetadata | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const command = stringField(value.command);
  const host = stringField(value.host);
  const pid = value.pid;
  const startedAt = stringField(value.startedAt);
  if (!command || !host || typeof pid !== 'number' || !startedAt) {
    return undefined;
  }

  return {
    command,
    host,
    pid,
    startedAt,
    stoppedAt: stringField(value.stoppedAt),
    stopReason: stringField(value.stopReason),
  };
}

function recordField(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
