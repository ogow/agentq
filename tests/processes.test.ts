import {describe, expect, test} from 'bun:test';
import {ProcessRegistry} from '../src/core/processes';
import type {ManagedProcess} from '../src/core/processes';

describe('process cleanup', () => {
  test('kills every tracked process when the registry is drained', async () => {
    const killed: unknown[] = [];
    const registry = new ProcessRegistry();
    const process: ManagedProcess = {
      exited: new Promise(() => undefined),
      kill: signal => {
        killed.push(signal);
      },
    };

    registry.track(process);
    await registry.killAll();

    expect(killed).toHaveLength(1);
  });

  test('untracked processes are not killed by later cleanup', async () => {
    const killed: unknown[] = [];
    const registry = new ProcessRegistry();
    const process: ManagedProcess = {
      exited: new Promise(() => undefined),
      kill: signal => {
        killed.push(signal);
      },
    };

    const untrack = registry.track(process);
    untrack();
    await registry.killAll();

    expect(killed).toEqual([]);
  });
});
