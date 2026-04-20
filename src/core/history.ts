import {existsSync} from 'node:fs';
import {readFile, readdir} from 'node:fs/promises';
import {basename, join} from 'node:path';
import {AgentQError} from './errors';
import type {RunMetadata} from './metadata';
import {agentqHome, resolveRunDir} from './paths';

const LOOKBACK_UNITS_IN_MS: Record<string, number> = {
  d: 24 * 60 * 60 * 1000,
  h: 60 * 60 * 1000,
  m: 60 * 1000,
  ms: 1,
  s: 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

export interface RunHistoryEntry {
  metadata: RunMetadata;
  startedAtMs: number;
}

export interface RunHistoryOptions {
  limit?: number;
  now?: Date;
  runsDir?: string;
  sinceMs?: number;
}

export interface RunInspection {
  metadata: RunMetadata;
  output: string;
  runDir: string;
  runId: string;
}

export interface RunInspectionOptions {
  homeDir?: string;
}

export async function listRunHistory({
  limit = 20,
  now = new Date(),
  runsDir = join(agentqHome(), 'runs'),
  sinceMs,
}: RunHistoryOptions = {}): Promise<RunHistoryEntry[]> {
  if (!existsSync(runsDir)) {
    return [];
  }

  const cutoffMs = sinceMs === undefined ? undefined : now.getTime() - sinceMs;
  const entries = await readdir(runsDir, {withFileTypes: true});
  const runs: RunHistoryEntry[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const metadata = await readRunMetadata(
      join(runsDir, entry.name, 'run.json'),
    );
    if (!metadata) {
      continue;
    }

    const startedAtMs = Date.parse(metadata.startedAt);
    if (Number.isNaN(startedAtMs)) {
      continue;
    }

    if (cutoffMs !== undefined && startedAtMs < cutoffMs) {
      continue;
    }

    runs.push({metadata, startedAtMs});
  }

  return runs
    .sort((left, right) => right.startedAtMs - left.startedAtMs)
    .slice(0, limit);
}

export async function inspectRunHistory(
  runIdOrPath: string,
  options: RunInspectionOptions = {},
): Promise<RunInspection> {
  const runDir = resolveRunDir(runIdOrPath, options.homeDir);
  const metadata = await readRunMetadataStrict(join(runDir, 'run.json'));
  const output = await readRunOutput(join(runDir, 'output.md'));

  return {
    metadata,
    output,
    runDir,
    runId: basename(runDir),
  };
}

export function parseRunLookbackMs(value: string): number {
  const match = /^(\d+)(ms|s|m|h|d|w)$/.exec(value.trim());

  if (!match) {
    throw new AgentQError(
      `Invalid lookback "${value}". Use a duration like 1h, 7d, or 2w.`,
    );
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const ms = amount * LOOKBACK_UNITS_IN_MS[unit];

  if (!Number.isSafeInteger(ms) || ms <= 0) {
    throw new AgentQError(
      `Invalid lookback "${value}". Lookback must be greater than zero.`,
    );
  }

  return ms;
}

async function readRunMetadata(path: string): Promise<RunMetadata | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as RunMetadata;
  } catch {
    return undefined;
  }
}

async function readRunMetadataStrict(path: string): Promise<RunMetadata> {
  let raw: string;

  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new AgentQError(`Run record not found: ${path}`);
    }
    throw new AgentQError(`Invalid run record: ${path}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new AgentQError(`Invalid run record: ${path}`);
  }

  if (
    !isRunMetadataRecord(parsed) ||
    !isString(parsed.agent.id) ||
    !isString(parsed.status) ||
    !isString(parsed.startedAt) ||
    !isString(parsed.config.model) ||
    !isString(parsed.config.reasoning) ||
    !isString(parsed.config.sandbox) ||
    !Array.isArray(parsed.changedFiles) ||
    !Array.isArray(parsed.toolUsage)
  ) {
    throw new AgentQError(`Invalid run record: ${path}`);
  }

  return parsed as RunMetadata;
}

async function readRunOutput(path: string): Promise<string> {
  try {
    return (await readFile(path, 'utf8')).trim();
  } catch {
    return '';
  }
}

function isRunMetadataRecord(value: unknown): value is RunMetadata {
  return (
    typeof value === 'object' &&
    value !== null &&
    'agent' in value &&
    'config' in value &&
    isRecord((value as Record<string, unknown>).agent) &&
    isRecord((value as Record<string, unknown>).config)
  );
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as {code?: unknown}).code === 'ENOENT'
  );
}
