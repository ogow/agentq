import {describe, expect, test} from 'bun:test';
import {
  createProgressRenderer,
  createHarnessProgressRenderer,
  formatRunHistoryTable,
  formatRunSummary,
  formatStructuredLogEvent,
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
    resultMode: 'plain',
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
  tokenUsage: {
    cachedInputTokens: 12000,
    inputTokens: 102312,
    outputTokens: 31523,
    reasoningOutputTokens: 4210,
    totalTokens: 133835,
  },
  toolUsage: [{calls: 2, failures: 0, name: 'exec_command', successes: 2}],
};

describe('rendering', () => {
  test('formats a compact run summary by default', () => {
    const summary = formatRunSummary(METADATA, 'Looks good.', {color: false});

    expect(summary).toContain('AgentQ reviewer succeeded in 3.1s');
    expect(summary).toContain('run: /home/me/.agentq/runs/reviewer-abc');
    expect(summary).toContain('tools: 2 calls, 0 failures');
    expect(summary).toContain('edits: 1 file changed');
    expect(summary).toContain(
      'tokens: input 102k · output 32k · cached 12k · reasoning 4k · total 134k',
    );
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
    expect(summary).toContain('plain');
    expect(summary).toContain(
      'tokens    input 102,312 · output 31,523 · cached 12,000 · reasoning 4,210 · total 133,835',
    );
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

  test('formats token usage events with split totals', () => {
    const line = formatTimelineEvent(
      {
        kind: 'token_usage',
        provider: 'codex',
        timestamp: '2026-04-13T12:00:02.000Z',
        tokenUsage: {
          cachedInputTokens: 12,
          inputTokens: 100,
          outputTokens: 20,
          reasoningOutputTokens: 5,
          totalTokens: 137,
        },
      },
      {color: false},
    );

    expect(line).toBe(
      '12:00:02  tokens  tokens: input 100 · output 20 · cached 12 · reasoning 5 · total 137',
    );
  });

  test('includes assistant phase in human timeline events', () => {
    const line = formatTimelineEvent(
      {
        kind: 'assistant_message',
        message: 'Thinking through the next edit.',
        phase: 'reasoning',
        provider: 'codex',
        timestamp: '2026-04-13T12:00:02.000Z',
      },
      {color: false},
    );

    expect(line).toBe(
      '12:00:02  message  [reasoning] Thinking through the next edit.',
    );
  });

  test('formats structured log events as ndjson payloads', () => {
    const payload = JSON.parse(
      formatStructuredLogEvent(
        {
          kind: 'assistant_message',
          message: 'I am checking the harness configuration.',
          phase: 'reasoning',
          provider: 'codex',
          timestamp: '2026-04-13T12:00:02.000Z',
        },
        {agentId: 'builder', source: 'agent'},
      ),
    ) as {
      agentId: string;
      kind: string;
      message: string;
      phase: string;
      source: string;
    };

    expect(payload).toMatchObject({
      agentId: 'builder',
      kind: 'assistant_message',
      message: 'I am checking the harness configuration.',
      phase: 'reasoning',
      source: 'agent',
    });
  });

  test('renders agent messages in progress and messages modes', () => {
    const progressChunks: string[] = [];
    const progress = createProgressRenderer({
      agentId: 'builder',
      color: false,
      stream: {
        isTTY: true,
        write: chunk => progressChunks.push(String(chunk)),
      },
    });
    progress.onEvent({
      kind: 'assistant_message',
      message: 'I am inspecting the current render behavior.',
      phase: 'reasoning',
      provider: 'codex',
    });
    progress.stop();

    expect(progressChunks.join('')).toContain(
      'agent builder  message  [reasoning] I am inspecting the current render behavior.',
    );

    const messageChunks: string[] = [];
    const messages = createProgressRenderer({
      agentId: 'builder',
      color: false,
      logLevel: 'messages',
      stream: {
        write: chunk => messageChunks.push(String(chunk)),
      },
    });
    messages.onEvent({
      kind: 'assistant_message',
      message: 'I am inspecting the current render behavior.',
      provider: 'codex',
    });
    messages.onEvent({
      kind: 'tool_started',
      provider: 'codex',
      toolName: 'exec_command',
    });

    expect(messageChunks.join('')).toContain(
      'agent  --:--  message  I am inspecting the current render behavior.',
    );
    expect(messageChunks.join('')).not.toContain('exec_command');
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

  test('renders persistent harness step results after spinner lines', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: false,
      stream: {
        isTTY: true,
        write: chunk => chunks.push(String(chunk)),
      },
    });

    const step = {detail: 'build', label: 'builder'};
    renderer.startStep(step);
    renderer.finishStep(step, {
      status: 'success',
      summary: 'Built the change.',
    });
    renderer.stop();

    expect(chunks.join('')).toContain('✓ builder build - Built the change.');
  });

  test('keeps split token usage visible when a harness step completes', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: false,
      stream: {
        isTTY: true,
        write: chunk => chunks.push(String(chunk)),
      },
    });

    const step = {detail: 'build', label: 'builder'};
    renderer.startStep(step);
    renderer.onEvent({
      kind: 'token_usage',
      provider: 'codex',
      tokenUsage: {
        cachedInputTokens: 12,
        inputTokens: 100,
        outputTokens: 20,
        reasoningOutputTokens: 5,
        totalTokens: 137,
      },
    });
    renderer.finishStep(step, {
      status: 'success',
      summary: 'Built the change.',
    });
    renderer.stop();

    expect(chunks.join('')).toContain(
      '✓ builder build - Built the change. · tokens: input 100 · output 20 · cached 12 · reasoning 5 · total 137',
    );
  });

  test('persists assistant messages in non-verbose harness output', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: false,
      stream: {
        isTTY: true,
        write: chunk => chunks.push(String(chunk)),
      },
    });

    const step = {detail: 'task-001.attempt-001.worker', label: 'builder'};
    renderer.startStep(step);
    renderer.onEvent({
      kind: 'assistant_message',
      message: 'I am checking the harness configuration before editing.',
      provider: 'codex',
    });
    renderer.onEvent({
      kind: 'token_usage',
      provider: 'codex',
      tokenUsage: {
        cachedInputTokens: 12,
        inputTokens: 100,
        outputTokens: 20,
        reasoningOutputTokens: 5,
        totalTokens: 137,
      },
    });
    renderer.finishStep(step, {
      status: 'success',
      summary: 'Done.',
    });

    const output = chunks.join('');
    expect(output).toContain(
      'agent builder task-001.attempt-001.worker  message  I am checking the harness configuration before editing.',
    );
    expect(output).toContain(
      '✓ builder task-001.attempt-001.worker - Done. · tokens: input 100 · output 20 · cached 12 · reasoning 5 · total 137',
    );
  });

  test('persists failed tool finishes in non-verbose harness output', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: false,
      stream: {
        isTTY: true,
        write: chunk => chunks.push(String(chunk)),
      },
    });

    const step = {detail: 'task-001.attempt-001.worker', label: 'builder'};
    renderer.startStep(step);
    renderer.onEvent({
      kind: 'tool_finished',
      provider: 'codex',
      status: 'failed',
      toolName: 'exec_command',
    });
    renderer.finishStep(step, {
      status: 'failed',
      summary: 'Command failed.',
    });

    expect(chunks.join('')).toContain(
      'agent builder task-001.attempt-001.worker  fail  exec_command failed',
    );
    expect(chunks.join('')).toContain(
      '✗ builder task-001.attempt-001.worker - Command failed.',
    );
  });

  test('renders harness step starts in verbose mode without a TTY', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: false,
      stream: {
        write: chunk => chunks.push(String(chunk)),
      },
      verbose: true,
    });

    const step = {detail: 'planner', label: 'task-planner'};
    renderer.startStep(step);
    renderer.finishStep(step, {
      status: 'blocked',
      summary: 'Needs a product decision.',
    });

    expect(chunks.join('')).toContain('harness start task-planner planner');
    expect(chunks.join('')).toContain(
      'harness blocked task-planner planner - Needs a product decision.',
    );
  });

  test('renders harness event timelines in verbose TTY mode', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: false,
      stream: {
        isTTY: true,
        write: chunk => chunks.push(String(chunk)),
      },
      verbose: true,
    });

    const step = {detail: 'planner', label: 'task-planner'};
    renderer.startStep(step);
    renderer.onEvent({
      command: 'rg "specops-e2e" .agentq',
      kind: 'tool_started',
      provider: 'codex',
      toolName: 'exec_command',
    });
    renderer.finishStep(step, {
      status: 'success',
      summary: 'Ready to run.',
    });
    renderer.stop();

    const output = chunks.join('');
    expect(output).toContain('task-planner planner');
    expect(output).toContain(
      'agent task-planner planner --:--  tool  exec_command: rg "specops-e2e"',
    );
    expect(output).toContain(
      'harness done task-planner planner - Ready to run.',
    );
  });

  test('renders harness agent messages in verbose mode', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: false,
      stream: {
        write: chunk => chunks.push(String(chunk)),
      },
      verbose: true,
    });

    const step = {detail: 'task-001.attempt-001.worker', label: 'builder'};
    renderer.startStep(step);
    renderer.onEvent({
      kind: 'assistant_message',
      message: 'I am checking the harness configuration before editing.',
      provider: 'codex',
    });
    renderer.finishStep(step, {
      status: 'success',
      summary: 'Done.',
    });

    expect(chunks.join('')).toContain(
      'agent builder task-001.attempt-001.worker --:--  message  I am checking the harness configuration before editing.',
    );
  });
});
