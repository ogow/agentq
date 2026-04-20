import {randomBytes} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir, readdir, stat} from 'node:fs/promises';
import {basename, isAbsolute, join, relative, resolve} from 'node:path';
import {AgentQError} from './errors';
import {readAgentFile} from './agent';
import {agentqHome} from './home';
import type {AgentListEntry, ResolvedAgent, RunPaths} from './types';

export {agentqHome} from './home';

export function projectAgentPath(projectCwd: string, agentId: string): string {
  return join(projectCwd, '.agentq', 'agents', `${agentId}.md`);
}

export function globalAgentPath(agentId: string): string {
  return join(agentqHome(), 'agents', `${agentId}.md`);
}

export async function resolveAgent(
  projectCwd: string,
  agentId: string,
): Promise<ResolvedAgent> {
  const projectPath = projectAgentPath(projectCwd, agentId);
  if (existsSync(projectPath)) {
    const agent = await readAgentFile(projectPath, 'project');
    ensureResolvedIdMatches(agent, agentId);
    return agent;
  }

  const globalPath = globalAgentPath(agentId);
  if (existsSync(globalPath)) {
    const agent = await readAgentFile(globalPath, 'global');
    ensureResolvedIdMatches(agent, agentId);
    return agent;
  }

  throw new AgentQError(
    `Could not find agent "${agentId}" in .agentq/agents or ${join(agentqHome(), 'agents')}.`,
  );
}

export async function listAgents(
  projectCwd: string,
): Promise<AgentListEntry[]> {
  const globalAgents = await listAgentsInDirectory(
    join(agentqHome(), 'agents'),
    'global',
  );
  const projectAgents = await listAgentsInDirectory(
    join(projectCwd, '.agentq', 'agents'),
    'project',
  );
  const byId = new Map<string, AgentListEntry>();

  for (const agent of globalAgents) {
    byId.set(agent.id, agent);
  }
  for (const agent of projectAgents) {
    byId.set(agent.id, agent);
  }

  return [...byId.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}

export function resolveContextFile(
  projectCwd: string,
  contextFile: string,
): string {
  const contextPath = isAbsolute(contextFile)
    ? contextFile
    : resolve(projectCwd, contextFile);

  if (!existsSync(contextPath)) {
    throw new AgentQError(`Context file does not exist: ${contextPath}`);
  }

  return contextPath;
}

export function resolveRunDir(
  runIdOrPath: string,
  homeDir = agentqHome(),
): string {
  if (isAbsolute(runIdOrPath) || isPathLike(runIdOrPath)) {
    const runDir = isAbsolute(runIdOrPath) ? runIdOrPath : resolve(runIdOrPath);

    if (existsSync(runDir)) {
      return runDir;
    }

    throw new AgentQError(`Agent run not found: ${runIdOrPath}`);
  }

  const homeRunDir = join(homeDir, 'runs', runIdOrPath);
  if (existsSync(homeRunDir)) {
    return homeRunDir;
  }

  throw new AgentQError(`Agent run not found: ${runIdOrPath}`);
}

export async function createRunPaths(agentId: string): Promise<RunPaths> {
  const runDir = join(
    agentqHome(),
    'runs',
    `${sanitizePathPart(agentId)}-${shortId()}`,
  );
  await mkdir(runDir, {recursive: true});

  return {
    artifactsDirPath: join(runDir, 'artifacts'),
    outputPath: join(runDir, 'output.md'),
    runJsonPath: join(runDir, 'run.json'),
    runDir,
    stderrPath: join(runDir, 'stderr.log'),
    stdoutPath: join(runDir, 'stdout.jsonl'),
  };
}

export {resolveHarnessRunDir} from './harness-paths';

export function contextFallbackName(
  projectCwd: string,
  contextPath: string,
): string {
  const relativePath = relativeToProject(projectCwd, contextPath);
  return relativePath ?? basename(contextPath);
}

function relativeToProject(
  projectCwd: string,
  filePath: string,
): string | undefined {
  const relativePath = relative(resolve(projectCwd), resolve(filePath));

  if (
    relativePath.length > 0 &&
    !relativePath.startsWith('..') &&
    !isAbsolute(relativePath)
  ) {
    return relativePath;
  }

  return undefined;
}

async function listAgentsInDirectory(
  directory: string,
  scope: AgentListEntry['scope'],
): Promise<AgentListEntry[]> {
  if (!existsSync(directory)) {
    return [];
  }

  const entries = await readdir(directory);
  const agents: AgentListEntry[] = [];

  for (const entry of entries) {
    if (!entry.endsWith('.md')) {
      continue;
    }

    const filePath = join(directory, entry);
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      continue;
    }

    agents.push({
      description: (await readAgentFile(filePath, scope)).frontmatter
        .description,
      filePath,
      id: entry.slice(0, -'.md'.length),
      scope,
    });
  }

  return agents;
}

function ensureResolvedIdMatches(
  agent: ResolvedAgent,
  requestedId: string,
): void {
  if (agent.id !== requestedId) {
    throw new AgentQError(
      `Agent file ${agent.filePath} declares id "${agent.id}", but was resolved as "${requestedId}".`,
    );
  }
}

function sanitizePathPart(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'agent'
  );
}

function isPathLike(value: string): boolean {
  return value.includes('/') || value.includes('\\') || value.startsWith('.');
}

function shortId(): string {
  return randomBytes(4).toString('base64url').toLowerCase();
}
