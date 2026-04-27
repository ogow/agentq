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

function visibleLength(value: string): number {
  let length = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '\r' || char === '\n') {
      continue;
    }
    if (char === '\u001b' && value[index + 1] === '[') {
      index += 1;
      while (index < value.length && value[index] !== 'm') {
        index += 1;
      }
      continue;
    }
    length += 1;
  }
  return length;
}

describe('rendering', () => {
  test('formats a compact run summary by default', () => {
    const summary = formatRunSummary(METADATA, 'Looks good.', {color: false});

    expect(summary).toContain('reviewer: succeeded');
    expect(summary).toContain('duration: 3.1s');
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
      tty: true,
    });

    expect(summary).toContain('AgentQ Run Complete');
    expect(summary).toMatch(/agent\s+reviewer/);
    expect(summary).toMatch(/result\s+succeeded/);
    expect(summary).toMatch(/tools\s+2 calls, 0 failures/);
    expect(summary).toMatch(/output\s+plain/);
    expect(summary).toMatch(
      /tokens\s+input 102,312 · output 31,523 · cached 12,000 · reasoning 4,210 · total 133,835/,
    );
    expect(summary).toMatch(/run\s+\/home\/me\/\.agentq\/runs\/reviewer-abc/);
    expect(summary).not.toContain('+--');
    expect(summary).not.toContain('| agent');
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

  test('renders agent messages in progress and verbose modes', () => {
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
    progress.onEvent({
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
    progress.stop();

    expect(progressChunks.join('')).not.toContain(
      'I am inspecting the current render behavior',
    );
    expect(progressChunks.join('')).not.toContain(
      'tokens: input 100 · output 20 · cached 12 · reasoning 5 · total 137',
    );
    expect(progressChunks.join('')).toContain('AgentQ builder');

    const messageChunks: string[] = [];
    const messages = createProgressRenderer({
      agentId: 'builder',
      color: false,
      verbosity: 1,
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

    const task = {
      attempt: 1,
      detail: 'build',
      index: 1,
      label: 'item',
      maxAttempts: 1,
      summary: 'Built the change.',
      total: 1,
    };
    const step = {detail: 'build', label: 'builder'};
    renderer.startTask(task);
    renderer.startStep(step);
    renderer.finishStep(step, {
      status: 'success',
      summary: 'Built the change.',
    });
    renderer.finishTask(task, {
      status: 'success',
      summary: 'Built the change.',
    });
    renderer.stop();

    const output = chunks.join('');
    expect(output).toContain('\r');
    expect(output).toContain('✓ task 1/1 success retry 1/1  Built the change.');
  });

  test('renders exact default non-tty success lines', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: false,
      stream: {
        write: chunk => chunks.push(String(chunk)),
      },
    });

    const task = {
      attempt: 1,
      detail: 'build',
      index: 1,
      label: 'item',
      maxAttempts: 1,
      summary: 'work',
      total: 1,
    };
    renderer.startTask(task);
    renderer.finishTask(task, {
      status: 'success',
      summary: 'Built the thing.',
    });

    expect(chunks.join('').trim().split('\n')).toEqual([
      '✓ task 1/1 success retry 1/1  work',
    ]);
  });

  test('renders exact default non-tty failure lines', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: false,
      runDir: '/home/me/.agentq/harness-runs/work-abc123',
      runId: 'work-abc123',
      stream: {
        write: chunk => chunks.push(String(chunk)),
      },
    });

    const task = {
      attempt: 1,
      detail: 'build',
      index: 1,
      label: 'item',
      maxAttempts: 1,
      summary: 'work',
      total: 1,
    };
    const step = {detail: 'build', label: 'builder'};
    renderer.startTask(task);
    renderer.startStep(step);
    renderer.finishTask(task, {
      status: 'failed',
      summary: 'Agent "builder" returned invalid JSON.',
      step,
    });

    expect(chunks.join('').trim().split('\n')).toEqual([
      '✗ task 1/1 failed retry 1/1  work',
      'Failure',
      '  agent: builder',
      '  retry: 1/1',
      '  reason: Agent "builder" returned invalid JSON.',
      '  run: /home/me/.agentq/harness-runs/work-abc123',
    ]);
  });

  test('keeps default tty task activity on one mutable live row', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: false,
      runId: 'devloop-e50232',
      stream: {
        isTTY: true,
        write: chunk => chunks.push(String(chunk)),
      },
    });

    const task = {
      attempt: 1,
      detail: 'task-001.attempt-001.worker',
      index: 1,
      label: 'item',
      maxAttempts: 4,
      summary: 'Fix item count vs retry count',
      total: 4,
    };
    const step = {
      detail: 'task-001.attempt-001.worker',
      label: 'harness-builder',
    };
    renderer.startTask(task);
    renderer.startStep(step);
    renderer.onEvent({
      kind: 'assistant_message',
      message: 'reading harness summary code\nand checking the mutation path',
      provider: 'codex',
    });
    renderer.onEvent({
      command: 'bun test tests/harness.test.ts',
      kind: 'tool_started',
      provider: 'codex',
      toolName: 'exec_command',
    });
    renderer.onEvent({
      command: 'bun test tests/harness.test.ts',
      exitCode: 1,
      kind: 'tool_finished',
      provider: 'codex',
      status: 'failed',
      toolName: 'exec_command',
    });
    renderer.finishStep(step, {
      durable: false,
      status: 'failed',
      summary: 'Check failed.',
    });
    task.attempt = 2;
    renderer.startStep(step);
    renderer.onEvent({
      kind: 'assistant_message',
      message: 'applying feedback',
      provider: 'codex',
    });
    renderer.finishStep(step, {
      status: 'success',
      summary: 'Recovered.',
    });
    renderer.finishTask(task, {
      status: 'success',
      summary: 'Recovered.',
    });
    renderer.stop();

    const output = chunks.join('');
    expect(output.split('\r\x1b[2K').length - 1).toBeGreaterThan(3);
    expect(output).toContain(
      'harness-builder  reading harness summary code and checking the mutation path',
    );
    expect(output).not.toContain(
      'reading harness summary code\nand checking the mutation path',
    );
    expect(output).not.toContain('bun test tests/harness.test.ts');
    expect(output).toContain('harness-builder  retrying');
    expect(output).toContain('harness-builder  applying feedback');
    const completionLine =
      '✓ task 1/4 success retry 2/4  Fix item count vs retry count';
    expect(output.split(completionLine).length - 1).toBe(1);
    expect((output.match(/\n/g) ?? []).length).toBe(1);
    expect(output).toContain(
      '\r\x1b[2K✓ task 1/4 success retry 2/4  Fix item count vs retry count\n',
    );
  });

  test('truncates narrow default tty live rows before the terminal width', () => {
    const chunks: string[] = [];
    const columns = 48;
    const renderer = createHarnessProgressRenderer({
      color: false,
      runId: 'devloop-90ec65',
      stream: {
        columns,
        isTTY: true,
        write: chunk => chunks.push(String(chunk)),
      },
    });

    const task = {
      attempt: 1,
      detail: 'task-001.attempt-001.worker',
      index: 1,
      label: 'item',
      maxAttempts: 1,
      summary: 'Done.',
      total: 1,
    };
    const step = {
      detail: 'task-001.attempt-001.worker',
      label: 'harness-builder',
    };
    renderer.startTask(task);
    renderer.startStep(step);
    renderer.onEvent({
      kind: 'assistant_message',
      message:
        'I need one more piece before editing: the next path is long enough to wrap if the renderer does not truncate it carefully.',
      provider: 'codex',
    });
    renderer.finishStep(step, {
      status: 'success',
      summary: 'Done.',
    });
    renderer.finishTask(task, {
      status: 'success',
      summary: 'Done.',
    });
    renderer.stop();

    const liveRows = chunks
      .filter(chunk => chunk.startsWith('\r\x1b[2K'))
      .map(chunk => chunk.replace('\r\x1b[2K', ''));
    expect(liveRows.length).toBeGreaterThan(0);
    for (const row of liveRows) {
      expect(visibleLength(row)).toBeLessThanOrEqual(columns);
    }
    expect(chunks.join('')).not.toContain(
      'the renderer does not truncate it carefully',
    );
  });

  test('truncates narrow colored default tty live rows without splitting ansi styling', () => {
    const chunks: string[] = [];
    const columns = 24;
    const renderer = createHarnessProgressRenderer({
      color: true,
      runId: 'devloop-90ec65',
      stream: {
        columns,
        isTTY: true,
        write: chunk => chunks.push(String(chunk)),
      },
    });

    const task = {
      attempt: 1,
      detail: 'task-001.attempt-001.worker',
      index: 1,
      label: 'item',
      maxAttempts: 1,
      summary: 'Done.',
      total: 1,
    };
    const step = {
      detail: 'task-001.attempt-001.worker',
      label: 'harness-builder',
    };
    renderer.startTask(task);
    renderer.startStep(step);
    renderer.onEvent({
      kind: 'assistant_message',
      message:
        'I need one more piece before editing: the next path is long enough to wrap if the renderer does not truncate it carefully.',
      provider: 'codex',
    });
    renderer.finishStep(step, {
      status: 'success',
      summary: 'Done.',
    });
    renderer.finishTask(task, {
      status: 'success',
      summary: 'Done.',
    });
    renderer.stop();

    const liveRows = chunks
      .filter(chunk => chunk.startsWith('\r\x1b[2K'))
      .map(chunk => chunk.replace('\r\x1b[2K', ''));
    expect(liveRows.length).toBeGreaterThan(0);
    for (const row of liveRows) {
      expect(visibleLength(row)).toBeLessThanOrEqual(columns);
      if (row.includes('\u001b[1m')) {
        expect(row).toContain('\u001b[22m');
      }
    }
  });

  test('keeps raw command text out of the default live row', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: false,
      runId: 'devloop-e50232',
      stream: {
        isTTY: true,
        write: chunk => chunks.push(String(chunk)),
      },
    });

    const task = {
      attempt: 1,
      detail: 'task-001.attempt-001.check',
      index: 1,
      label: 'item',
      maxAttempts: 1,
      summary: 'Running checks.',
      total: 1,
    };
    const step = {
      detail: 'task-001.attempt-001.check',
      label: 'check',
    };
    renderer.startTask(task);
    renderer.startStep(step);
    renderer.onEvent({
      command: 'bun run check',
      kind: 'tool_started',
      provider: 'codex',
      toolName: 'exec_command',
    });
    renderer.onEvent({
      command: 'bun run check',
      exitCode: 1,
      kind: 'tool_finished',
      provider: 'codex',
      status: 'failed',
      toolName: 'exec_command',
    });
    renderer.finishStep(step, {
      status: 'success',
      summary: 'Running checks.',
    });
    renderer.finishTask(task, {
      status: 'success',
      summary: 'Running checks.',
    });
    renderer.stop();

    const output = chunks.join('');
    expect(output).toContain('check  working');
    expect(output).toContain('retrying');
    expect(output).not.toContain('bun run check');
    expect(output.split('Running checks.').length - 1).toBe(1);
    expect(output).toContain('✓ task 1/1 success retry 1/1  Running checks.');
  });

  test('renders tty verbose command steps as threaded rows', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: false,
      stream: {
        isTTY: true,
        write: chunk => chunks.push(String(chunk)),
      },
      verbosity: 1,
    });

    const task = {
      attempt: 1,
      detail: 'task-001.attempt-001.check',
      index: 1,
      label: 'item',
      maxAttempts: 1,
      summary: 'Checks passed.',
      total: 1,
    };
    const step = {
      activity: 'bun run check',
      detail: 'task-001.attempt-001.check',
      label: 'typecheck',
    };
    renderer.startTask(task);
    renderer.startStep(step);
    renderer.finishStep(step, {
      status: 'success',
      summary: 'Check typecheck passed.',
    });
    renderer.finishTask(task, {
      status: 'success',
      summary: 'Checks passed.',
    });
    renderer.stop();

    const output = chunks.join('');
    expect(output).toContain('  ● check  command');
    expect(output).toContain('  ✓ check  passed');
    expect(output).not.toContain('\r\x1b[2K▸');
    expect(output.match(/✓ check\s+passed/g)).toHaveLength(1);
  });

  test('styles the default live activity as dim when color is enabled', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: true,
      runId: 'devloop-e50232',
      stream: {
        isTTY: true,
        write: chunk => chunks.push(String(chunk)),
      },
    });

    const task = {
      attempt: 1,
      detail: 'task-001.attempt-001.worker',
      index: 1,
      label: 'item',
      maxAttempts: 1,
      summary: 'Done.',
      total: 1,
    };
    const step = {
      detail: 'task-001.attempt-001.worker',
      label: 'builder',
    };
    renderer.startTask(task);
    renderer.startStep(step);
    renderer.onEvent({
      kind: 'assistant_message',
      message: 'checking the renderer ownership boundary',
      provider: 'codex',
    });
    renderer.finishStep(step, {
      status: 'success',
      summary: 'Done.',
    });
    renderer.finishTask(task, {
      status: 'success',
      summary: 'Done.',
    });
    renderer.stop();

    const output = chunks.join('');
    expect(output).toContain(
      '\u001b[2mchecking the renderer ownership boundary\u001b[22m',
    );
    expect(output).toContain('\u001b[1mdevloop-e50232\u001b[22m');
  });

  test('keeps split token usage out of the default durable tty history', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: false,
      stream: {
        isTTY: true,
        write: chunk => chunks.push(String(chunk)),
      },
    });

    const task = {
      attempt: 1,
      detail: 'build',
      index: 1,
      label: 'item',
      maxAttempts: 1,
      summary: 'Built the change.',
      total: 1,
    };
    const step = {detail: 'build', label: 'builder'};
    renderer.startTask(task);
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
    renderer.finishTask(task, {
      status: 'success',
      summary: 'Built the change.',
    });
    renderer.stop();

    const output = chunks.join('');
    expect(output).toContain('✓ task 1/1 success retry 1/1  Built the change.');
    expect(output).not.toContain(
      'tokens: input 100 · output 20 · cached 12 · reasoning 5 · total 137',
    );
  });

  test('writes bounded history lines for default non-tty harness output', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: false,
      stream: {
        write: chunk => chunks.push(String(chunk)),
      },
    });

    const task = {
      detail: 'build',
      index: 1,
      label: 'item',
      summary: 'Built the change.',
      total: 1,
    };
    const step = {detail: 'build', label: 'builder'};
    renderer.startTask(task);
    renderer.startStep(step);
    renderer.onEvent({
      kind: 'assistant_message',
      message: 'building the current patch',
      provider: 'codex',
    });
    renderer.onEvent({
      command: 'bun run check',
      kind: 'tool_started',
      provider: 'codex',
      toolName: 'exec_command',
    });
    renderer.finishStep(step, {
      status: 'success',
      summary: 'Built the change.',
    });
    renderer.finishTask(task, {
      status: 'success',
      summary: 'Built the change.',
    });

    const output = chunks.join('').trim().split('\n').filter(Boolean);
    expect(output).toEqual(['✓ task 1/1 success retry 1/1  Built the change.']);
    expect(chunks.join('')).not.toContain('\r');
  });

  test('updates the live row with assistant messages and keeps token usage out of durable output', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: false,
      stream: {
        isTTY: true,
        write: chunk => chunks.push(String(chunk)),
      },
    });

    const task = {
      attempt: 1,
      detail: 'task-001.attempt-001.worker',
      index: 1,
      label: 'item',
      maxAttempts: 1,
      summary: 'Done.',
      total: 1,
    };
    const step = {
      detail: 'task-001.attempt-001.worker',
      label: 'builder',
    };
    renderer.startTask(task);
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
    renderer.finishTask(task, {
      status: 'success',
      summary: 'Done.',
    });

    const output = chunks.join('');
    expect(output).toContain(
      'I am checking the harness configuration before editing.',
    );
    expect(output).not.toContain(
      'tokens: input 100 · output 20 · cached 12 · reasoning 5 · total 137',
    );
    expect((output.match(/\n/g) ?? []).length).toBe(1);
    expect(output).toContain('✓ task 1/1 success retry 1/1  Done.');
  });

  test('does not persist failed tool finishes in non-verbose harness output', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: false,
      stream: {
        isTTY: true,
        write: chunk => chunks.push(String(chunk)),
      },
    });

    const task = {
      attempt: 1,
      detail: 'task-001.attempt-001.worker',
      index: 1,
      label: 'item',
      maxAttempts: 1,
      summary: 'Command failed.',
      total: 1,
    };
    const step = {detail: 'task-001.attempt-001.worker', label: 'builder'};
    renderer.startTask(task);
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
    renderer.finishTask(task, {
      status: 'failed',
      summary: 'Command failed.',
    });

    const output = chunks.join('');
    expect(output).not.toContain('agent task 1/1  fail  exec_command failed');
    expect(output).toContain('✗ task 1/1 failed retry 1/1  Command failed.');
  });

  test('renders terminal task failures as one durable line and a concise failure block', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: false,
      runDir: '/home/me/.agentq/harness-runs/devloop-e50232',
      runId: 'devloop-e50232',
      stream: {
        isTTY: true,
        write: chunk => chunks.push(String(chunk)),
      },
    });

    const task = {
      attempt: 1,
      detail: 'task-001.attempt-001.worker',
      index: 1,
      label: 'item',
      maxAttempts: 1,
      summary: 'Command failed.',
      total: 1,
    };
    const step = {
      detail: 'task-001.attempt-001.worker',
      label: 'harness-reviewer',
    };
    renderer.startTask(task);
    renderer.startStep(step);
    renderer.finishStep(step, {
      durable: false,
      status: 'failed',
      summary: 'Command failed.',
    });
    renderer.finishTask(task, {
      status: 'failed',
      step,
      summary: 'Command failed.',
    });
    renderer.stop();

    const output = chunks.join('');
    const failureLine = '✗ task 1/1 failed retry 1/1  Command failed.';
    const failureCount = output.split(failureLine).length - 1;
    expect(failureCount).toBe(1);
    expect(output).toContain(
      '\r\x1b[2K✗ task 1/1 failed retry 1/1  Command failed.\n',
    );
    expect(output).toContain(
      'Failure\n  agent: harness-reviewer\n  retry: 1/1\n  reason: Command failed.\n  run: /home/me/.agentq/harness-runs/devloop-e50232',
    );
    expect(output).not.toContain('command: bun -e process.exit(1)');
    expect(output).not.toContain('exit: 1');
    expect(output).not.toContain('stderr: boom');
    expect(output).not.toContain('stdout: noise');
  });

  test('keeps default non-tty failure blocks concise', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: false,
      runDir: '/home/me/.agentq/harness-runs/devloop-e50232',
      runId: 'devloop-e50232',
      stream: {
        write: chunk => chunks.push(String(chunk)),
      },
    });

    const task = {
      attempt: 1,
      detail: 'task-001.attempt-001.worker',
      index: 1,
      label: 'item',
      maxAttempts: 1,
      summary: 'Command failed.',
      total: 1,
    };
    const step = {
      detail: 'task-001.attempt-001.worker',
      label: 'harness-reviewer',
    };
    renderer.startTask(task);
    renderer.startStep(step);
    renderer.finishTask(task, {
      command: 'bun -e process.exit(1)',
      exitCode: 1,
      stderrTail: 'boom',
      status: 'failed',
      stdoutTail: 'noise',
      step,
      summary: 'Command failed.',
    });

    const output = chunks.join('');
    expect(output).toContain('✗ task 1/1 failed retry 1/1  Command failed.');
    expect(output).toContain(
      'Failure\n  agent: harness-reviewer\n  retry: 1/1\n  reason: Command failed.\n  run: /home/me/.agentq/harness-runs/devloop-e50232',
    );
    expect(output).not.toContain('command: bun -e process.exit(1)');
    expect(output).not.toContain('exit: 1');
    expect(output).not.toContain('stderr: boom');
    expect(output).not.toContain('stdout: noise');
  });

  test('shows command diagnostics as threaded verbose rows', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: false,
      runDir: '/home/me/.agentq/harness-runs/devloop-e50232',
      runId: 'devloop-e50232',
      stream: {
        isTTY: true,
        write: chunk => chunks.push(String(chunk)),
      },
      verbosity: 2,
    });

    const task = {
      attempt: 1,
      detail: 'task-001.attempt-001.worker',
      index: 1,
      label: 'item',
      maxAttempts: 1,
      summary: 'Command failed.',
      total: 1,
    };
    const step = {
      detail: 'task-001.attempt-001.worker',
      label: 'harness-reviewer',
    };
    renderer.startTask(task);
    renderer.startStep(step);
    renderer.finishTask(task, {
      command: 'bun -e process.exit(1)',
      exitCode: 1,
      stderrTail: 'boom',
      status: 'failed',
      stdoutTail: 'noise',
      step,
      summary: 'Command failed.',
    });

    const output = chunks.join('');
    expect(output).toContain('    tool  exec: bun -e process.exit(1)');
    expect(output).toContain('    fail  exit 1 · stderr: boom · stdout: noise');
    expect(output).toContain('✗ task 1/1  retry 1/1  failed: Command failed.');
  });

  test('keeps retryable verbose step diagnostics visible after a failed attempt', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: false,
      runId: 'devloop-a0d2b5',
      stream: {
        isTTY: true,
        write: chunk => chunks.push(String(chunk)),
      },
      verbosity: 2,
    });

    const task = {
      attempt: 1,
      detail: 'task-001.attempt-001.worker',
      index: 1,
      label: 'item',
      maxAttempts: 2,
      summary: 'Working.',
      total: 1,
    };
    const step = {
      detail: 'task-001.attempt-001.worker',
      label: 'harness-builder',
    };

    renderer.startTask(task);
    renderer.startStep(step);
    renderer.finishStep(step, {
      command: 'bun -e process.exit(1)',
      durable: false,
      exitCode: 1,
      stderrTail: 'boom',
      status: 'failed',
      stdoutTail: 'noise',
      summary: 'Build failed.',
    });
    task.attempt = 2;
    renderer.startStep(step);
    renderer.finishStep(step, {
      status: 'success',
      summary: 'Recovered.',
    });
    renderer.finishTask(task, {
      status: 'success',
      summary: 'Recovered.',
    });

    const output = chunks.join('');
    expect(output).toContain('    tool  exec: bun -e process.exit(1)');
    expect(output).toContain('    fail  exit 1 · stderr: boom · stdout: noise');
    expect(output).toContain(
      '↻ task 1/1  retry 2/2  retrying with previous feedback',
    );
    expect(output).toContain('  ✗ worker  failed: Build failed.');
    expect(output).toContain('✓ task 1/1  retry 2/2  Working.');
  });

  test('keeps retryable harness step failures out of the durable tty history', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: false,
      stream: {
        isTTY: true,
        write: chunk => chunks.push(String(chunk)),
      },
    });

    const task = {
      attempt: 1,
      detail: 'task-001.attempt-001.worker',
      index: 1,
      label: 'item',
      maxAttempts: 1,
      summary: 'Recovered.',
      total: 1,
    };
    const step = {detail: 'task-001.attempt-001.worker', label: 'builder'};
    renderer.startTask(task);
    renderer.startStep(step);
    renderer.finishStep(step, {
      durable: false,
      status: 'failed',
      summary: 'Build failed.',
    });
    renderer.startStep(step);
    renderer.finishStep(step, {
      status: 'success',
      summary: 'Recovered.',
    });
    renderer.finishTask(task, {
      status: 'success',
      summary: 'Recovered.',
    });

    const output = chunks.join('');
    expect(output).not.toContain('✗ task 1/1 failed retry 1/1  Build failed.');
    expect(output).not.toContain('Build failed.');
    expect(output).not.toMatch(/ {20,}/);
    expect(output).toContain('✓ task 1/1 success retry 1/1  Recovered.');
  });

  test('renders standalone failure blocks for step failures without a task', () => {
    const ttyChunks: string[] = [];
    const ttyRenderer = createHarnessProgressRenderer({
      color: false,
      stream: {
        isTTY: true,
        write: chunk => ttyChunks.push(String(chunk)),
      },
    });

    const step = {detail: 'split', label: 'splitter'};
    ttyRenderer.startStep(step);
    ttyRenderer.finishStep(step, {
      durable: false,
      status: 'failed',
      summary: 'The plan is invalid.',
    });
    ttyRenderer.stop();

    const ttyOutput = ttyChunks.join('');
    expect(ttyOutput).toContain('Failure');
    expect(ttyOutput).toContain('step: split');
    expect(ttyOutput).toContain('reason: The plan is invalid.');
    expect(ttyOutput).not.toContain('task:');

    const plainChunks: string[] = [];
    const plainRenderer = createHarnessProgressRenderer({
      color: false,
      stream: {
        write: chunk => plainChunks.push(String(chunk)),
      },
    });

    plainRenderer.startStep(step);
    plainRenderer.finishStep(step, {
      durable: false,
      status: 'failed',
      summary: 'The plan is invalid.',
    });

    const plainOutput = plainChunks.join('');
    expect(plainOutput).toContain('Failure');
    expect(plainOutput).toContain('step: split');
    expect(plainOutput).toContain('reason: The plan is invalid.');
    expect(plainOutput).not.toContain('task:');
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

    const task = {
      attempt: 1,
      detail: 'planner',
      index: 1,
      label: 'item',
      maxAttempts: 1,
      summary: 'Needs a product decision.',
      total: 1,
    };
    const step = {detail: 'planner', label: 'task-planner'};
    renderer.startTask(task);
    renderer.startStep(step);
    renderer.finishStep(step, {
      status: 'blocked',
      summary: 'Needs a product decision.',
    });
    renderer.finishTask(task, {
      status: 'blocked',
      summary: 'Needs a product decision.',
    });

    expect(chunks.join('')).toContain('  ● planner  task-planner');
    expect(chunks.join('')).toContain(
      '! task 1/1  retry 1/1  blocked: Needs a product decision.',
    );
  });

  test('renders structured verbose harness output without raw assistant JSON', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: false,
      runId: 'devloop-a0d2b5',
      stream: {
        write: chunk => chunks.push(String(chunk)),
      },
      verbose: true,
    });

    const task = {
      attempt: 1,
      detail: 'split',
      index: 1,
      label: 'item',
      maxAttempts: 1,
      summary: 'Add the first local eval runner',
      total: 1,
    };
    const splitStep = {detail: 'split', label: 'task-splitter'};
    const buildStep = {detail: 'build', label: 'harness-builder'};
    renderer.startTask(task);
    renderer.startStep(splitStep);
    renderer.onEvent({
      kind: 'assistant_message',
      message: 'mapping the existing CLI and run storage',
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
    renderer.onEvent({
      kind: 'assistant_message',
      message:
        '{"status":"success","summary":"Split into one implementation task for the first eval runner slice.","result":{"tasks":[{"title":"Add the first local eval runner"}]}}',
      provider: 'codex',
    });
    renderer.finishStep(splitStep, {
      result: {
        tasks: [{title: 'Add the first local eval runner'}],
      },
      status: 'success',
      summary:
        'Split into one implementation task for the first eval runner slice.',
    });
    renderer.startStep(buildStep);
    renderer.onEvent({
      kind: 'assistant_message',
      message: 'checking the current tests and eval modules',
      provider: 'codex',
    });
    renderer.onEvent({
      kind: 'assistant_message',
      message:
        '{"status":"success","summary":"Verified the local eval runner end to end","result":{"changedFiles":[]}}',
      provider: 'codex',
    });
    renderer.finishStep(buildStep, {
      result: {changedFiles: []},
      status: 'success',
      summary: 'Verified the local eval runner end to end',
    });
    renderer.finishTask(task, {
      status: 'success',
      summary: 'Add the first local eval runner',
    });

    const output = chunks.join('');
    expect(output.split('\n')[0]).toBe('devloop-a0d2b5');
    expect(output).toContain(
      '▶ task 1/1  retry 1/1  Add the first local eval runner',
    );
    expect(output).toContain('  ● split  task-splitter');
    expect(output).toContain('    … mapping the existing CLI and run storage');
    expect(output).toContain(
      '  ✓ split  1 task: Add the first local eval runner · tokens 137',
    );
    expect(output).toContain('  ● build  harness-builder');
    expect(output).toContain(
      '    … checking the current tests and eval modules',
    );
    expect(output).toContain(
      '  ✓ build  Verified the local eval runner end to end',
    );
    expect(output).not.toContain('agent task-splitter --:-- message');
    expect(output).not.toContain('agent harness-builder --:-- message');
    expect(output).not.toContain(
      '{"status":"success","summary":"Split into one implementation task for the first eval runner slice.',
    );
    expect(output).not.toContain(
      '{"status":"success","summary":"Verified the local eval runner end to end',
    );
    expect(output.startsWith('\n')).toBe(false);
  });

  test('renders exact verbose non-tty structure lines', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: false,
      runId: 'work-abc123',
      stream: {
        write: chunk => chunks.push(String(chunk)),
      },
      verbose: true,
    });

    const task = {
      attempt: 1,
      detail: 'build',
      index: 1,
      label: 'item',
      maxAttempts: 1,
      summary: 'work',
      total: 1,
    };
    const step = {detail: 'build', label: 'builder'};
    renderer.startTask(task);
    renderer.startStep(step);
    renderer.onEvent({
      kind: 'assistant_message',
      message: 'mapping the current files',
      provider: 'codex',
    });
    renderer.onEvent({
      kind: 'token_usage',
      provider: 'codex',
      tokenUsage: {
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
      },
    });
    renderer.finishStep(step, {
      status: 'success',
      summary: 'Built the thing.',
    });
    renderer.finishTask(task, {
      status: 'success',
      summary: 'work',
    });

    expect(chunks.join('').trim().split('\n')).toEqual([
      'work-abc123',
      '▶ task 1/1  retry 1/1  work',
      '  ● build  builder',
      '    … mapping the current files',
      '  ✓ build  Built the thing. · tokens 120',
      '✓ task 1/1  retry 1/1  work',
    ]);
  });

  test('wraps verbose trace rows with a hanging indent', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: false,
      stream: {
        columns: 96,
        write: chunk => chunks.push(String(chunk)),
      },
      verbose: true,
    });

    const task = {
      attempt: 1,
      detail: 'build',
      index: 1,
      label: 'item',
      maxAttempts: 1,
      summary: 'work',
      total: 1,
    };
    const step = {detail: 'build', label: 'go-builder'};
    renderer.startTask(task);
    renderer.startStep(step);
    renderer.onEvent({
      kind: 'assistant_message',
      message:
        "I'm checking the resolver package and fake DNS server paths first so I can make\n the truncation and TCP fallback change naturally.",
      provider: 'codex',
    });

    expect(chunks.join('').trim().split('\n')).toEqual([
      '▶ task 1/1  retry 1/1  work',
      '  ● build  go-builder',
      "    … I'm checking the resolver package and fake DNS server paths first so I can make",
      '      the truncation and TCP fallback change naturally.',
    ]);
  });

  test('caps wide verbose rows so terminal wrapping keeps the rail', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: false,
      stream: {
        columns: 180,
        write: chunk => chunks.push(String(chunk)),
      },
      verbose: true,
    });

    const task = {
      attempt: 1,
      detail: 'build',
      index: 1,
      label: 'item',
      maxAttempts: 1,
      summary: 'work',
      total: 1,
    };
    const step = {detail: 'build', label: 'go-builder'};
    renderer.startTask(task);
    renderer.startStep(step);
    renderer.onEvent({
      kind: 'assistant_message',
      message:
        'I will inspect the scanner module shape and relevant prior art APIs so the task split can be concrete without inventing repository details.',
      provider: 'codex',
    });

    const lines = chunks.join('').trim().split('\n');
    expect(lines.every(line => line.length <= 104)).toBe(true);
    expect(lines).toContain(
      '    … I will inspect the scanner module shape and relevant prior art APIs so the task split can be',
    );
    expect(lines).toContain(
      '      concrete without inventing repository details.',
    );
  });

  test('shrinks verbose metadata columns on compact screens', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: false,
      stream: {
        columns: 72,
        write: chunk => chunks.push(String(chunk)),
      },
      verbose: true,
    });

    const task = {
      attempt: 1,
      detail: 'build',
      index: 1,
      label: 'item',
      maxAttempts: 1,
      summary: 'work',
      total: 1,
    };
    const step = {detail: 'build', label: 'go-builder'};
    renderer.startTask(task);
    renderer.startStep(step);
    renderer.onEvent({
      kind: 'assistant_message',
      message:
        'I found the focused failure in the raw DNS metadata path and will patch the narrow evidence conversion gap.',
      provider: 'codex',
    });

    const lines = chunks.join('').trim().split('\n');
    expect(lines.every(line => line.length <= 72)).toBe(true);
    expect(lines).toContain('  ● build  go-builder');
    expect(lines).toContain(
      '    … I found the focused failure in the raw DNS metadata path and will',
    );
    expect(lines).toContain('      patch the narrow evidence conversion gap.');
  });

  test('dims verbose message text so structure stays scannable', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: true,
      stream: {
        columns: 120,
        write: chunk => chunks.push(String(chunk)),
      },
      verbose: true,
    });

    const task = {
      attempt: 1,
      detail: 'build',
      index: 1,
      label: 'item',
      maxAttempts: 1,
      summary: 'work',
      total: 1,
    };
    const step = {detail: 'build', label: 'go-builder'};
    renderer.startTask(task);
    renderer.startStep(step);
    renderer.onEvent({
      kind: 'assistant_message',
      message: 'checking the resolver evidence path',
      provider: 'codex',
    });
    renderer.finishStep(step, {
      status: 'success',
      summary: 'Built the thing.',
    });

    const output = chunks.join('');
    expect(output).toContain(
      '\u001b[2mchecking the resolver evidence path\u001b[22m',
    );
    expect(output).toContain('\u001b[36m●\u001b[39m');
    expect(output).toContain('\u001b[32m✓\u001b[39m');
  });

  test('wraps verbose success summaries and keeps compact token totals', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: false,
      stream: {
        columns: 98,
        write: chunk => chunks.push(String(chunk)),
      },
      verbose: true,
    });

    const task = {
      attempt: 1,
      detail: 'build',
      index: 1,
      label: 'item',
      maxAttempts: 1,
      summary: 'work',
      total: 1,
    };
    const step = {detail: 'build', label: 'go-builder'};
    renderer.startTask(task);
    renderer.startStep(step);
    renderer.onEvent({
      kind: 'token_usage',
      provider: 'codex',
      tokenUsage: {
        inputTokens: 777001,
        outputTokens: 5231,
        cachedInputTokens: 713004,
        reasoningOutputTokens: 2011,
        totalTokens: 782012,
      },
    });
    renderer.finishStep(step, {
      status: 'success',
      summary:
        'Completed the trusted resolver evidence repair by preserving the final TCP fallback rcode when truncated UDP metadata is retained.',
    });

    expect(chunks.join('').trim().split('\n')).toEqual([
      '▶ task 1/1  retry 1/1  work',
      '  ● build  go-builder',
      '  ✓ build  Completed the trusted resolver evidence repair by preserving the final TCP fallback',
      '           rcode when truncated UDP metadata is retained. · tokens 782k',
    ]);
  });

  test('keeps long command step names aligned in verbose output', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: false,
      stream: {
        write: chunk => chunks.push(String(chunk)),
      },
      verbose: true,
    });

    const task = {
      attempt: 1,
      detail: 'checks',
      index: 1,
      label: 'item',
      maxAttempts: 1,
      summary: 'Checks passed.',
      total: 1,
    };
    const step = {
      activity: 'git diff --stat',
      detail: 'review_diff_stat',
      label: 'review_diff_stat',
    };
    renderer.startTask(task);
    renderer.startStep(step);
    renderer.finishStep(step, {
      status: 'success',
      summary: 'Review diff stat passed.',
    });

    expect(chunks.join('').trim().split('\n')).toEqual([
      '▶ task 1/1  retry 1/1  Checks passed.',
      '  ● review_diff_stat  command',
      '  ✓ review_diff_stat  passed',
    ]);
  });

  test('middle-truncates overlong verbose scopes without shifting columns', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: false,
      stream: {
        write: chunk => chunks.push(String(chunk)),
      },
      verbose: true,
    });

    const task = {
      attempt: 1,
      detail: 'checks',
      index: 1,
      label: 'item',
      maxAttempts: 1,
      summary: 'Checks passed.',
      total: 1,
    };
    const step = {
      activity: 'bun run review:trusted-resolver-evidence-contract',
      detail: 'review_trusted_resolver_evidence_contract',
      label: 'review_trusted_resolver_evidence_contract',
    };
    renderer.startTask(task);
    renderer.startStep(step);
    renderer.finishStep(step, {
      status: 'success',
      summary: 'Review contract passed.',
    });

    expect(chunks.join('').trim().split('\n')).toEqual([
      '▶ task 1/1  retry 1/1  Checks passed.',
      '  ● review_trusted_...dence_contract  command',
      '  ✓ review_trusted_...dence_contract  passed',
    ]);
  });

  test('renders harness event timelines in verbose TTY mode', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: false,
      stream: {
        isTTY: true,
        write: chunk => chunks.push(String(chunk)),
      },
      verbosity: 2,
    });

    const task = {
      attempt: 1,
      detail: 'planner',
      index: 1,
      label: 'item',
      maxAttempts: 1,
      summary: 'Ready to run.',
      total: 1,
    };
    const step = {detail: 'planner', label: 'task-planner'};
    renderer.startTask(task);
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
    renderer.finishTask(task, {
      status: 'success',
      summary: 'Ready to run.',
    });
    renderer.stop();

    const output = chunks.join('');
    expect(output).toContain('  ● planner  task-planner');
    expect(output).toContain('    tool  exec: rg "specops-e2e" .agentq');
    expect(output).toContain('✓ task 1/1  retry 1/1  Ready to run.');
  });

  test('renders harness agent messages in verbose mode', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: false,
      stream: {
        write: chunk => chunks.push(String(chunk)),
      },
      verbosity: 1,
    });

    const task = {
      attempt: 1,
      detail: 'task-001.attempt-001.worker',
      index: 1,
      label: 'item',
      maxAttempts: 1,
      summary: 'Done.',
      total: 1,
    };
    const step = {detail: 'task-001.attempt-001.worker', label: 'builder'};
    renderer.startTask(task);
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
    renderer.finishTask(task, {
      status: 'success',
      summary: 'Done.',
    });

    expect(chunks.join('')).toContain(
      '    … I am checking the harness configuration before editing.',
    );
    expect(chunks.join('')).toContain('  ● worker  builder');
    expect(chunks.join('')).toContain('  ✓ worker  Done.');
    expect(chunks.join('')).not.toContain('agent builder --:-- message');
  });

  test('renders retry 1/8 through retry 8/8 without an off-by-one budget', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: false,
      runId: 'devloop-a0d2b5',
      stream: {
        isTTY: true,
        write: chunk => chunks.push(String(chunk)),
      },
    });

    const task = {
      attempt: 1,
      detail: 'task-001.attempt-001.worker',
      index: 1,
      label: 'item',
      maxAttempts: 8,
      summary: 'Refine default live-row activity rendering',
      total: 1,
    };
    const step = {
      detail: 'task-001.attempt-001.worker',
      label: 'harness-builder',
    };
    renderer.startTask(task);
    renderer.startStep(step);
    renderer.onEvent({
      kind: 'assistant_message',
      message: 'checking the renderer',
      provider: 'codex',
    });
    task.attempt = 8;
    renderer.onEvent({
      kind: 'assistant_message',
      message: 'applying reviewer feedback',
      provider: 'codex',
    });
    renderer.stop();

    const output = chunks.join('');
    expect(output).toContain('harness-builder  checking the renderer');
    expect(output).toMatch(/harness-builder {2}applying reviewer feedback/);
    expect(output).not.toContain('attempt 1/9');
  });

  test('renders token summaries once in verbose harness output', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: false,
      stream: {
        write: chunk => chunks.push(String(chunk)),
      },
      verbosity: 1,
    });

    const task = {
      attempt: 1,
      detail: 'task-001.attempt-001.worker',
      index: 1,
      label: 'item',
      maxAttempts: 1,
      summary: 'Done.',
      total: 1,
    };
    const step = {detail: 'task-001.attempt-001.worker', label: 'builder'};
    renderer.startTask(task);
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
      summary: 'Done.',
    });
    renderer.finishTask(task, {
      status: 'success',
      summary: 'Done.',
    });

    const output = chunks.join('');
    expect(output).toContain('tokens 137');
    expect(output).not.toContain(
      'tokens: input 100 · output 20 · cached 12 · reasoning 5 · total 137',
    );
    const matches = output.match(/tokens 137/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  test('default harness jsonl omits nested agent lifecycle events', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: false,
      format: 'jsonl',
      stream: {
        write: chunk => chunks.push(String(chunk)),
      },
    });

    const task = {
      attempt: 1,
      detail: 'task-001.attempt-001.worker',
      index: 1,
      label: 'item',
      maxAttempts: 1,
      summary: 'Done.',
      total: 1,
    };
    const step = {detail: 'task-001.attempt-001.worker', label: 'builder'};
    renderer.startTask(task);
    renderer.startStep(step);
    renderer.onEvent({
      kind: 'run_started',
      provider: 'codex',
    });
    renderer.onEvent({
      kind: 'assistant_message',
      message: 'I am checking the harness configuration before editing.',
      provider: 'codex',
    });
    renderer.onEvent({
      kind: 'run_completed',
      message: 'Done.',
      provider: 'codex',
    });
    renderer.finishStep(step, {
      status: 'success',
      summary: 'Done.',
    });
    renderer.finishTask(task, {
      status: 'success',
      summary: 'Done.',
    });
    renderer.stop({
      durationMs: 123,
      status: 'success',
      summary: 'Harness work completed successfully.',
    });

    const events = chunks
      .join('')
      .trim()
      .split('\n')
      .filter(line => line.length > 0)
      .map(line => JSON.parse(line) as {type: string});

    expect(events.map(event => event.type)).toEqual([
      'harness.started',
      'task.started',
      'task.finished',
      'harness.finished',
    ]);
  });

  test('default harness jsonl keeps successful task summaries on the item title', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: false,
      format: 'jsonl',
      stream: {
        write: chunk => chunks.push(String(chunk)),
      },
    });

    const task = {
      detail: 'task-001.attempt-001.worker',
      index: 3,
      label: 'item',
      summary: 'Fix renderer duplication',
      total: 8,
    };
    const step = {detail: 'task-001.attempt-001.worker', label: 'build'};
    renderer.startTask(task);
    renderer.startStep(step);
    renderer.finishStep(step, {
      status: 'success',
      summary: 'Loop devloop completed successfully.',
    });
    renderer.finishTask(task, {
      status: 'success',
      summary: 'Loop devloop completed successfully.',
    });
    renderer.stop({
      durationMs: 123,
      status: 'success',
      summary: 'Harness work completed successfully.',
    });

    const events = chunks
      .join('')
      .trim()
      .split('\n')
      .filter(line => line.length > 0)
      .map(line => JSON.parse(line) as {summary?: string; type: string});

    expect(events.find(event => event.type === 'task.finished')).toMatchObject({
      summary: 'Fix renderer duplication',
      type: 'task.finished',
    });
  });

  test('default harness jsonl reports standalone step failures', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: false,
      format: 'jsonl',
      stream: {
        write: chunk => chunks.push(String(chunk)),
      },
    });

    const step = {detail: 'split', label: 'splitter'};
    renderer.startStep(step);
    renderer.finishStep(step, {
      command: 'bun -e process.exit(1)',
      durable: false,
      exitCode: 1,
      stderrTail: 'boom',
      status: 'failed',
      stdoutTail: 'noise',
      summary: 'The plan is invalid.',
    });
    renderer.stop({
      durationMs: 123,
      status: 'failed',
      summary: 'Harness work failed.',
    });

    const events = chunks
      .join('')
      .trim()
      .split('\n')
      .filter(line => line.length > 0)
      .map(
        line =>
          JSON.parse(line) as {
            command?: string;
            exitCode?: number;
            stderrTail?: string;
            stdoutTail?: string;
            type: string;
          },
      );

    expect(events.map(event => event.type)).toEqual([
      'harness.started',
      'step.finished',
      'harness.finished',
    ]);
    const stepFinished = events.find(event => event.type === 'step.finished');
    expect(stepFinished).toMatchObject({
      status: 'failed',
      summary: 'The plan is invalid.',
      type: 'step.finished',
    });
    expect(stepFinished).not.toMatchObject({
      command: 'bun -e process.exit(1)',
      exitCode: 1,
      stderrTail: 'boom',
      stdoutTail: 'noise',
    });
  });

  test('renders verbose harness jsonl step and assistant events once', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: false,
      format: 'jsonl',
      stream: {
        write: chunk => chunks.push(String(chunk)),
      },
      verbosity: 1,
    });

    const task = {
      attempt: 1,
      detail: 'task-001.attempt-001.worker',
      index: 1,
      label: 'item',
      maxAttempts: 1,
      summary: 'Done.',
      total: 1,
    };
    const step = {detail: 'task-001.attempt-001.worker', label: 'builder'};
    renderer.startTask(task);
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
    renderer.finishTask(task, {
      status: 'success',
      summary: 'Done.',
    });
    renderer.stop({
      durationMs: 123,
      status: 'success',
      summary: 'Harness work completed successfully.',
    });

    const events = chunks
      .join('')
      .trim()
      .split('\n')
      .filter(line => line.length > 0)
      .map(line => JSON.parse(line) as {type: string});

    expect(events.map(event => event.type)).toEqual([
      'harness.started',
      'task.started',
      'step.started',
      'assistant_message',
      'token_usage',
      'step.finished',
      'task.finished',
      'harness.finished',
    ]);
    expect(events.find(event => event.type === 'task.started')).toMatchObject({
      task: {
        attempt: 1,
        maxAttempts: 1,
        retryIndex: 1,
        retryTotal: 1,
      },
    });
    expect(events.find(event => event.type === 'task.finished')).toMatchObject({
      task: {
        attempt: 1,
        maxAttempts: 1,
        retryIndex: 1,
        retryTotal: 1,
      },
    });
    expect(events.at(-1)).toMatchObject({
      durationMs: 123,
      status: 'success',
      type: 'harness.finished',
    });
  });

  test('renders verbose harness jsonl diagnostics at debug level', () => {
    const chunks: string[] = [];
    const renderer = createHarnessProgressRenderer({
      color: false,
      format: 'jsonl',
      stream: {
        write: chunk => chunks.push(String(chunk)),
      },
      verbosity: 2,
    });

    const task = {
      detail: 'task-001.attempt-001.worker',
      index: 1,
      label: 'item',
      summary: 'Build failed.',
      total: 1,
    };
    const step = {detail: 'task-001.attempt-001.worker', label: 'builder'};
    renderer.startTask(task);
    renderer.startStep(step);
    renderer.onEvent({
      command: 'bun -e process.exit(1)',
      kind: 'tool_started',
      provider: 'codex',
      rawType: 'item.started',
      toolName: 'exec_command',
    });
    renderer.onEvent({
      command: 'bun -e process.exit(1)',
      exitCode: 1,
      kind: 'tool_finished',
      provider: 'codex',
      rawType: 'item.completed',
      status: 'failed',
      toolName: 'exec_command',
    });
    renderer.finishStep(step, {
      agentRunDir: '/home/me/.agentq/runs/builder-abc123',
      command: 'bun -e process.exit(1)',
      exitCode: 1,
      stderrTail: 'boom',
      status: 'failed',
      stdoutTail: 'noise',
      summary: 'Build failed.',
    });
    renderer.finishTask(task, {
      agentRunDir: '/home/me/.agentq/runs/builder-abc123',
      command: 'bun -e process.exit(1)',
      exitCode: 1,
      stderrTail: 'boom',
      status: 'failed',
      stdoutTail: 'noise',
      summary: 'Build failed.',
    });
    renderer.stop({
      durationMs: 123,
      status: 'failed',
      summary: 'Harness work failed.',
    });

    const events = chunks
      .join('')
      .trim()
      .split('\n')
      .filter(line => line.length > 0)
      .map(
        line =>
          JSON.parse(line) as {
            command?: string;
            exitCode?: number;
            rawType?: string;
            stderrTail?: string;
            stdoutTail?: string;
            type: string;
          },
      );

    expect(events.find(event => event.type === 'step.finished')).toMatchObject({
      agentRunDir: '/home/me/.agentq/runs/builder-abc123',
      command: 'bun -e process.exit(1)',
      exitCode: 1,
      stderrTail: 'boom',
      stdoutTail: 'noise',
      type: 'step.finished',
    });
    expect(
      events.find(event => event.rawType === 'item.completed'),
    ).toMatchObject({
      command: 'bun -e process.exit(1)',
      exitCode: 1,
      rawType: 'item.completed',
      type: 'tool_finished',
    });
  });
});
