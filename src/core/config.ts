import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {AgentQError} from './errors';
import {agentqHome} from './paths';
import type {AgentQConfig} from './types';

export async function loadAgentQConfig(
  projectCwd: string,
): Promise<AgentQConfig> {
  const globalConfig = await readConfigFile(join(agentqHome(), 'config.json'));
  const projectConfig = await readConfigFile(
    join(projectCwd, '.agentq', 'config.json'),
  );

  return {
    ...globalConfig,
    ...projectConfig,
  };
}

async function readConfigFile(path: string): Promise<AgentQConfig> {
  if (!existsSync(path)) {
    return {};
  }

  let data: unknown;
  try {
    data = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new AgentQError(`Could not read AgentQ config ${path}: ${reason}`);
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new AgentQError(`AgentQ config ${path} must be a JSON object.`);
  }

  const contextFile = (data as Record<string, unknown>).context_file;
  if (contextFile === undefined) {
    return {};
  }

  if (typeof contextFile !== 'string' || contextFile.trim().length === 0) {
    throw new AgentQError(
      `AgentQ config ${path} field "context_file" must be a non-empty string.`,
    );
  }

  return {
    contextFile,
  };
}
