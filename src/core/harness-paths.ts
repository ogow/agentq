import {existsSync} from 'node:fs';
import {isAbsolute, join} from 'node:path';
import {AgentQError} from './errors';
import {agentqHome} from './home';

export function resolveHarnessRunDir(runIdOrPath: string): string {
  if (isAbsolute(runIdOrPath)) {
    if (existsSync(runIdOrPath)) {
      return runIdOrPath;
    }

    throw new AgentQError(`Harness run not found: ${runIdOrPath}`);
  }

  const homeRunDir = join(agentqHome(), 'harness-runs', runIdOrPath);
  if (existsSync(homeRunDir)) {
    return homeRunDir;
  }

  throw new AgentQError(`Harness run not found: ${runIdOrPath}`);
}
