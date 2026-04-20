import {homedir} from 'node:os';
import {join} from 'node:path';

export function userHome(): string {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

export function agentqHome(): string {
  return join(userHome(), '.agentq');
}
