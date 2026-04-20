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

  test('normalizes current Codex turn, message, and command events', () => {
    const started = normalizeCodexJsonLine(
      JSON.stringify({type: 'turn.started'}),
    );
    const message = normalizeCodexJsonLine(
      JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'item_1',
          text: 'I am inspecting the harness files.',
          type: 'agent_message',
        },
      }),
    );
    const commandStarted = normalizeCodexJsonLine(
      JSON.stringify({
        type: 'item.started',
        item: {
          command: 'rg "harness" src',
          id: 'item_2',
          type: 'command_execution',
        },
      }),
    );
    const commandFinished = normalizeCodexJsonLine(
      JSON.stringify({
        type: 'item.completed',
        item: {
          aggregated_output: 'src/core/harness.ts',
          command: 'rg "harness" src',
          exit_code: 0,
          id: 'item_2',
          status: 'completed',
          type: 'command_execution',
        },
      }),
    );
    const tokens = normalizeCodexJsonLine(
      JSON.stringify({
        type: 'turn.completed',
        usage: {
          cached_input_tokens: 3,
          input_tokens: 10,
          output_tokens: 5,
        },
      }),
    );

    const events = [
      started,
      message,
      commandStarted,
      commandFinished,
      tokens,
    ].flatMap(event => (event ? [event] : []));

    expect(started?.kind).toBe('run_started');
    expect(message).toMatchObject({
      kind: 'assistant_message',
      message: 'I am inspecting the harness files.',
    });
    expect(commandStarted).toMatchObject({
      command: 'rg "harness" src',
      kind: 'tool_started',
      toolName: 'command_execution',
    });
    expect(commandFinished).toMatchObject({
      exitCode: 0,
      kind: 'tool_finished',
      message: 'src/core/harness.ts',
      status: 'completed',
    });
    expect(tokens?.tokenUsage?.totalTokens).toBe(15);
    expect(summarizeToolUsage(events)).toEqual([
      {calls: 1, failures: 0, name: 'command_execution', successes: 1},
    ]);
  });

  test('normalizes exposed reasoning summaries as phased assistant messages', () => {
    const reasoning = normalizeCodexJsonLine(
      JSON.stringify({
        timestamp: '2026-04-13T12:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'reasoning_summary',
          summary: 'Considering the smallest safe logging change.',
        },
      }),
    );

    expect(reasoning).toMatchObject({
      kind: 'assistant_message',
      message: 'Considering the smallest safe logging change.',
      phase: 'reasoning',
    });
  });
});
