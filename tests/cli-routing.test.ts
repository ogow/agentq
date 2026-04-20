import {describe, expect, test} from 'bun:test';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {buildCli} from '../src/cli';

describe('cli routing', () => {
  test('bare invocation requires a command instead of opening a workbench', async () => {
    await expect((async () => buildCli([]).parseAsync())()).rejects.toThrow(
      /Choose a command/,
    );
  });

  test('rejects removed TUI harness view command', async () => {
    await expect(
      (async () => buildCli(['harness', 'view', 'work-a1b2c3']).parseAsync())(),
    ).rejects.toThrow(/Unknown argument|view/);
  });

  test('accepts status command flags', async () => {
    const restoreHome = useHome(mkdtempSync(join(tmpdir(), 'agentq-cli-')));
    try {
      await expect(
        buildCli(['status', '--all', '--json']).parseAsync(),
      ).resolves.toBeDefined();
    } finally {
      restoreHome();
    }
  });
});

function useHome(homePath: string): () => void {
  const originalHome = process.env.HOME;
  process.env.HOME = homePath;
  return () => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  };
}
