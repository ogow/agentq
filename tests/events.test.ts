import {describe, expect, test} from 'bun:test';
import {
  normalizeCodexJsonLine,
  summarizeChangedFiles,
  summarizeToolUsage,
} from '../src/core/events';

describe('Codex event normalization', () => {
  test('normalizes task lifecycle and token usage events', () => {
    const started = normalizeCodexJsonLine(
      JSON.stringify({
        timestamp: '2026-04-13T12:00:00.000Z',
        type: 'event_msg',
        payload: {type: 'task_started'},
      }),
    );
    const tokens = normalizeCodexJsonLine(
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: {
              input_tokens: 10,
              output_tokens: 5,
              total_tokens: 15,
            },
          },
        },
      }),
    );

    expect(started?.kind).toBe('run_started');
    expect(tokens?.kind).toBe('token_usage');
    expect(tokens?.tokenUsage?.totalTokens).toBe(15);
  });

  test('summarizes apply_patch changed files and tool usage', () => {
    const started = normalizeCodexJsonLine(
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          call_id: 'call_1',
          name: 'apply_patch',
          input: [
            '*** Begin Patch',
            '*** Add File: src/new.ts',
            '+export const value = 1;',
            '*** Update File: src/existing.ts',
            '@@',
            '-old',
            '+new',
            '*** End Patch',
          ].join('\n'),
        },
      }),
    );
    const finished = normalizeCodexJsonLine(
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'custom_tool_call_output',
          call_id: 'call_1',
          output: JSON.stringify({metadata: {exit_code: 0}}),
        },
      }),
    );

    const events = [started, finished].flatMap(event => (event ? [event] : []));

    expect(summarizeChangedFiles(events)).toEqual([
      {operation: 'update', path: 'src/existing.ts', source: 'apply_patch'},
      {operation: 'add', path: 'src/new.ts', source: 'apply_patch'},
    ]);
    expect(summarizeToolUsage(events)).toEqual([
      {calls: 1, failures: 0, name: 'apply_patch', successes: 1},
    ]);
  });
});
