import {readFileSync} from 'node:fs';
import {isAbsolute, resolve} from 'node:path';
import {AgentQError} from '../core/errors';

let currentEvalPackDir: string | undefined;

export function setEvalPackDir(packDir: string | undefined): void {
  currentEvalPackDir = packDir;
}

export function readJsonFixture<T>(path: string): T {
  if (!currentEvalPackDir) {
    throw new AgentQError(
      'readJsonFixture() can only be used while loading an eval pack.',
    );
  }

  const fixturePath = isAbsolute(path)
    ? path
    : resolve(currentEvalPackDir, path);

  return JSON.parse(readFileSync(fixturePath, 'utf8')) as T;
}
