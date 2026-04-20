import {existsSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {basename, isAbsolute, join, resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {agentqHome} from '../core/home';
import {AgentQError} from '../core/errors';

export function resolveEvalPackPath(
  projectCwd: string,
  packRef: string,
): string {
  if (isAbsolute(packRef) || isPathLike(packRef)) {
    const filePath = isAbsolute(packRef)
      ? packRef
      : resolve(projectCwd, packRef);
    if (existsSync(filePath)) {
      return filePath;
    }
    throw new AgentQError(`Eval pack not found: ${packRef}`);
  }

  const fileName = packRef.endsWith('.ts')
    ? packRef.slice(0, -'.ts'.length)
    : packRef;
  const filePath = join(projectCwd, '.agentq', 'evals', `${fileName}.ts`);
  if (existsSync(filePath)) {
    return filePath;
  }

  throw new AgentQError(
    `Could not find eval pack "${packRef}" in .agentq/evals.`,
  );
}

export async function createEvalRunPaths(name: string): Promise<{
  logPath: string;
  resultsPath: string;
  runDir: string;
}> {
  const runDir = join(
    agentqHome(),
    'eval-runs',
    `${sanitizePathPart(name)}-${shortId()}`,
  );
  await mkdir(runDir, {recursive: true});

  return {
    logPath: join(runDir, 'log.jsonl'),
    resultsPath: join(runDir, 'results.json'),
    runDir,
  };
}

export function resolveEvalRunDir(runIdOrPath: string): string {
  if (isAbsolute(runIdOrPath) || isPathLike(runIdOrPath)) {
    const runDir = isAbsolute(runIdOrPath) ? runIdOrPath : resolve(runIdOrPath);
    if (existsSync(runDir)) {
      return runDir;
    }
    throw new AgentQError(`Eval run not found: ${runIdOrPath}`);
  }

  const homeRunDir = join(agentqHome(), 'eval-runs', runIdOrPath);
  if (existsSync(homeRunDir)) {
    return homeRunDir;
  }

  throw new AgentQError(`Eval run not found: ${runIdOrPath}`);
}

function sanitizePathPart(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'eval'
  );
}

function shortId(): string {
  return randomBytes(4).toString('base64url').toLowerCase();
}

function isPathLike(value: string): boolean {
  return value.includes('/') || value.includes('\\') || value.startsWith('.');
}

export function evalPackNameFromPath(filePath: string): string {
  return basename(filePath).replace(/\.ts$/, '');
}
