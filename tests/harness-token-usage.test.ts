import {describe, expect, test} from 'bun:test';
import {mkdir, writeFile} from 'node:fs/promises';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  readHarnessTokenUsageSummaryFromSources,
  summarizeHarnessTokenUsage,
} from '../src/core/harness-token-usage';

describe('harness token usage', () => {
  test('aggregates nested run metadata and keeps missing runs unknown', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-token-usage-'));
    const builderRunDir = join(root, '.agentq', 'runs', 'builder-abc123');
    const reviewerRunDir = join(root, '.agentq', 'runs', 'reviewer-def456');
    const missingRunDir = join(root, '.agentq', 'runs', 'missing-ghi789');

    await writeRunMetadata(builderRunDir, {
      tokenUsage: {
        cachedInputTokens: 12,
        inputTokens: 100,
        outputTokens: 20,
        reasoningOutputTokens: 5,
        totalTokens: 137,
      },
    });
    await writeRunMetadata(reviewerRunDir, {
      tokenUsage: {
        inputTokens: 50,
        outputTokens: 10,
        totalTokens: 60,
      },
    });

    const summary = await readHarnessTokenUsageSummaryFromSources([
      {agent: 'builder', agentRunDir: builderRunDir, stepId: 'build'},
      {agent: 'reviewer', agentRunDir: reviewerRunDir, stepId: 'review'},
      {agent: 'ghost', agentRunDir: missingRunDir, stepId: 'missing'},
    ]);

    expect(summary.stepTokenUsage).toHaveLength(3);
    expect(summary.stepTokenUsage[0]).toMatchObject({
      agent: 'builder',
      agentRunDir: builderRunDir,
      stepId: 'build',
      tokenUsage: {
        cachedInputTokens: 12,
        inputTokens: 100,
        outputTokens: 20,
        reasoningOutputTokens: 5,
        totalTokens: 137,
      },
    });
    expect(summary.stepTokenUsage[1]).toMatchObject({
      agent: 'reviewer',
      agentRunDir: reviewerRunDir,
      stepId: 'review',
      tokenUsage: {
        inputTokens: 50,
        outputTokens: 10,
        totalTokens: 60,
      },
    });
    expect(summary.stepTokenUsage[2]).toMatchObject({
      agent: 'ghost',
      agentRunDir: missingRunDir,
      stepId: 'missing',
      tokenUsage: undefined,
    });
    expect(summary.tokenUsage).toEqual({
      cachedInputTokens: 12,
      inputTokens: 150,
      outputTokens: 30,
      reasoningOutputTokens: 5,
      totalTokens: 197,
    });
  });

  test('sums explicit token summaries while leaving missing fields undefined', () => {
    expect(
      summarizeHarnessTokenUsage([
        {inputTokens: 10},
        {outputTokens: 5, totalTokens: 15},
        undefined,
      ]),
    ).toEqual({
      cachedInputTokens: undefined,
      inputTokens: 10,
      outputTokens: 5,
      reasoningOutputTokens: undefined,
      totalTokens: 15,
    });
  });
});

async function writeRunMetadata(
  runDir: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await mkdir(runDir, {recursive: true});
  await writeFile(
    join(runDir, 'run.json'),
    `${JSON.stringify(
      {
        agent: {
          description: 'Nested run.',
          filePath: '/repo/.agentq/agents/builder.md',
          id: 'builder',
          scope: 'project',
        },
        changedFiles: [],
        config: {
          envKeys: [],
          model: 'gpt-5.4',
          provider: 'codex',
          reasoning: 'none',
          resultMode: 'json',
          sandbox: 'workspace-write',
          timeout: '1m',
          timeoutMs: 60000,
        },
        eventCount: 0,
        paths: {
          artifacts: join(runDir, 'artifacts'),
          output: join(runDir, 'output.md'),
          runDir,
          stderr: join(runDir, 'stderr.log'),
          stdout: join(runDir, 'stdout.jsonl'),
        },
        projectCwd: '/repo',
        startedAt: '2026-04-15T09:00:00.000Z',
        status: 'succeeded',
        task: 'nested',
        timedOut: false,
        toolUsage: [],
        ...patch,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}
