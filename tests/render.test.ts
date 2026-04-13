import {describe, expect, test} from 'bun:test';
import {
  formatRunHistoryTable,
  formatRunSummary,
  formatTimelineEvent,
} from '../src/core/render';
import type {RunMetadata} from '../src/core/metadata';

const METADATA: RunMetadata = {
  agent: {
    description: 'Reviews code.',
    filePath: '/repo/.agentq/agents/reviewer.md',
    id: 'reviewer',
    scope: 'project',
  },
  changedFiles: [
    {operation: 'update', path: 'src/core/render.ts', source: 'apply_patch'},
  ],
  completedAt: '2026-04-13T12:00:03.000Z',
  config: {
    envKeys: [],
    model: 'gpt-5.4-mini',
    provider: 'codex',
    reasoning: 'low',
    sandbox: 'workspace-write',
    timeout: '1m',
    timeoutMs: 60000,
  },
  durationMs: 3123,
  eventCount: 4,
  exitCode: 0,
  paths: {
    artifacts: '/home/me/.agentq/runs/reviewer-abc/artifacts',
    output: '/home/me/.agentq/runs/reviewer-abc/output.md',
    runDir: '/home/me/.agentq/runs/reviewer-abc',
    stderr: '/home/me/.agentq/runs/reviewer-abc/stderr.log',
    stdout: '/home/me/.agentq/runs/reviewer-abc/stdout.jsonl',
  },
  projectCwd: '/repo',
  startedAt: '2026-04-13T12:00:00.000Z',
  status: 'succeeded',
  task: 'review this',
  timedOut: false,
  tokenUsage: {totalTokens: 12345},
  toolUsage: [{calls: 2, failures: 0, name: 'exec_command', successes: 2}],
};

describe('rendering', () => {
  test('formats a compact run summary by default', () => {
    const summary = formatRunSummary(METADATA, 'Looks good.', {color: false});

    expect(summary).toContain('AgentQ reviewer succeeded in 3.1s');
    expect(summary).toContain('run: /home/me/.agentq/runs/reviewer-abc');
    expect(summary).toContain('tools: 2 calls, 0 failures');
    expect(summary).toContain('edits: 1 file changed');
    expect(summary).not.toContain('AgentQ Run Complete');
    expect(summary).not.toContain('events');
    expect(summary).not.toContain('stderr');
    expect(summary).toContain('src/core/render.ts');
    expect(summary).toContain('Final output');
    expect(summary).toContain('Looks good.');
  });

  test('formats a detailed run summary when requested', () => {
    const summary = formatRunSummary(METADATA, 'Looks good.', {
      color: false,
      details: true,
    });

    expect(summary).toContain('AgentQ Run Complete');
    expect(summary).toContain('reviewer');
    expect(summary).toContain('2 calls, 0 failures');
    expect(summary).toContain('12,345');
    expect(summary).toContain('src/core/render.ts');
    expect(summary).toContain('Final output');
    expect(summary).toContain('Looks good.');
  });

  test('formats concise timeline events', () => {
    const line = formatTimelineEvent(
      {
        command: 'rg -n "TODO" src',
        kind: 'tool_started',
        provider: 'codex',
        timestamp: '2026-04-13T12:00:01.000Z',
        toolName: 'exec_command',
      },
      {color: false},
    );

    expect(line).toBe('12:00:01  tool  exec_command: rg -n "TODO" src');
  });

  test('formats run history as a table', () => {
    const table = formatRunHistoryTable([METADATA], {
      color: false,
      limit: 20,
      since: '7d',
    });

    expect(table).toContain('AgentQ Runs');
    expect(table).toContain('| Started          | Status');
    expect(table).toContain('reviewer');
    expect(table).toContain('gpt-5.4-mini / low');
    expect(table).toContain('review this');
    expect(table).toContain('reviewer-abc');
    expect(table).toContain('since: 7d');
  });
});
