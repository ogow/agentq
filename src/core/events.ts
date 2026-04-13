import type {
  AgentQEvent,
  ChangedFileSummary,
  ToolUsageSummary,
  TokenUsageSummary,
} from './types';

interface CodexJsonEvent {
  payload?: unknown;
  timestamp?: unknown;
  type?: unknown;
}

interface CodexPayload {
  arguments?: unknown;
  call_id?: unknown;
  content?: unknown;
  info?: unknown;
  input?: unknown;
  last_agent_message?: unknown;
  message?: unknown;
  name?: unknown;
  output?: unknown;
  phase?: unknown;
  status?: unknown;
  type?: unknown;
}

export function normalizeCodexJsonLine(line: string): AgentQEvent | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  let event: CodexJsonEvent;
  try {
    event = JSON.parse(trimmed) as CodexJsonEvent;
  } catch {
    return {
      kind: 'unknown',
      message: trimmed,
      provider: 'codex',
    };
  }

  return normalizeCodexEvent(event);
}

export function normalizeCodexEvent(event: CodexJsonEvent): AgentQEvent {
  const rawType = readString(event.type);
  const timestamp = readString(event.timestamp);
  const payload = readObject(event.payload);
  const payloadType = readString(payload?.type);

  if (rawType === 'event_msg') {
    return normalizeCodexEventMessage(payload, payloadType, rawType, timestamp);
  }

  if (rawType === 'response_item') {
    return normalizeCodexResponseItem(payload, payloadType, rawType, timestamp);
  }

  return {
    kind: 'unknown',
    provider: 'codex',
    rawType,
    timestamp,
  };
}

export function summarizeChangedFiles(
  events: AgentQEvent[],
): ChangedFileSummary[] {
  const byKey = new Map<string, ChangedFileSummary>();

  for (const event of events) {
    for (const file of event.files ?? []) {
      byKey.set(`${file.operation}:${file.path}:${file.source}`, file);
    }
  }

  return [...byKey.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

export function summarizeToolUsage(events: AgentQEvent[]): ToolUsageSummary[] {
  const byName = new Map<string, ToolUsageSummary>();
  const toolNameByCallId = new Map<string, string>();

  for (const event of events) {
    const toolName =
      event.toolName ??
      (event.callId ? toolNameByCallId.get(event.callId) : undefined);

    if (!toolName) {
      continue;
    }

    if (event.callId) {
      toolNameByCallId.set(event.callId, toolName);
    }

    const summary = byName.get(toolName) ?? {
      calls: 0,
      failures: 0,
      name: toolName,
      successes: 0,
    };

    if (event.kind === 'tool_started') {
      summary.calls += 1;
    } else if (event.kind === 'tool_finished') {
      if (event.status === 'failed') {
        summary.failures += 1;
      } else {
        summary.successes += 1;
      }
    }

    byName.set(summary.name, summary);
  }

  return [...byName.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export function summarizeTokenUsage(
  events: AgentQEvent[],
): TokenUsageSummary | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const usage = events[index].tokenUsage;
    if (usage) {
      return usage;
    }
  }

  return undefined;
}

function normalizeCodexEventMessage(
  payload: CodexPayload | undefined,
  payloadType: string | undefined,
  rawType: string | undefined,
  timestamp: string | undefined,
): AgentQEvent {
  if (payloadType === 'task_started') {
    return {
      kind: 'run_started',
      provider: 'codex',
      rawType,
      timestamp,
    };
  }

  if (payloadType === 'task_complete') {
    return {
      kind: 'run_completed',
      message: readString(payload?.last_agent_message),
      provider: 'codex',
      rawType,
      timestamp,
    };
  }

  if (payloadType === 'agent_message') {
    return {
      kind: 'assistant_message',
      message: readString(payload?.message),
      phase: readString(payload?.phase),
      provider: 'codex',
      rawType,
      timestamp,
    };
  }

  if (payloadType === 'token_count') {
    return {
      kind: 'token_usage',
      provider: 'codex',
      rawType,
      timestamp,
      tokenUsage: readTokenUsage(payload?.info),
    };
  }

  return {
    kind: 'unknown',
    provider: 'codex',
    rawType,
    timestamp,
  };
}

function normalizeCodexResponseItem(
  payload: CodexPayload | undefined,
  payloadType: string | undefined,
  rawType: string | undefined,
  timestamp: string | undefined,
): AgentQEvent {
  if (payloadType === 'function_call' || payloadType === 'custom_tool_call') {
    const toolName = readString(payload?.name) ?? 'unknown';
    const input = readString(payload?.arguments) ?? readString(payload?.input);

    return {
      callId: readString(payload?.call_id),
      command: readCommand(toolName, input),
      files: extractChangedFiles(toolName, input),
      kind: 'tool_started',
      provider: 'codex',
      rawType,
      status: 'running',
      timestamp,
      toolName,
    };
  }

  if (
    payloadType === 'function_call_output' ||
    payloadType === 'custom_tool_call_output'
  ) {
    const output = readString(payload?.output) ?? '';
    const toolName = readString(payload?.name);
    const exitCode = readExitCode(output);
    const failed = exitCode !== undefined && exitCode !== 0;

    return {
      callId: readString(payload?.call_id),
      exitCode: exitCode ?? null,
      kind: 'tool_finished',
      message: output.trim().slice(0, 500) || undefined,
      provider: 'codex',
      rawType,
      status: failed ? 'failed' : 'completed',
      timestamp,
      toolName,
    };
  }

  if (payloadType === 'message') {
    return {
      kind: 'assistant_message',
      message: readMessageContent(payload?.content),
      phase: readString(payload?.phase),
      provider: 'codex',
      rawType,
      timestamp,
    };
  }

  return {
    kind: 'unknown',
    provider: 'codex',
    rawType,
    timestamp,
  };
}

function readTokenUsage(value: unknown): TokenUsageSummary | undefined {
  const info = readObject(value);
  const usage = readObject(info?.total_token_usage);

  if (!usage) {
    return undefined;
  }

  return {
    cachedInputTokens: readNumber(usage.cached_input_tokens),
    inputTokens: readNumber(usage.input_tokens),
    outputTokens: readNumber(usage.output_tokens),
    reasoningOutputTokens: readNumber(usage.reasoning_output_tokens),
    totalTokens: readNumber(usage.total_tokens),
  };
}

function readCommand(
  toolName: string,
  input: string | undefined,
): string | undefined {
  if (!input) {
    return undefined;
  }

  if (toolName === 'exec_command') {
    const args = readJsonObject(input);
    return readString(args?.cmd);
  }

  return input.trim().split(/\r?\n/, 1)[0];
}

function extractChangedFiles(
  toolName: string,
  input: string | undefined,
): ChangedFileSummary[] | undefined {
  if (toolName !== 'apply_patch' || !input) {
    return undefined;
  }

  const files: ChangedFileSummary[] = [];
  for (const line of input.split(/\r?\n/)) {
    const add = /^\*\*\* Add File: (.+)$/.exec(line);
    if (add) {
      files.push({operation: 'add', path: add[1], source: toolName});
      continue;
    }

    const update = /^\*\*\* Update File: (.+)$/.exec(line);
    if (update) {
      files.push({operation: 'update', path: update[1], source: toolName});
      continue;
    }

    const del = /^\*\*\* Delete File: (.+)$/.exec(line);
    if (del) {
      files.push({operation: 'delete', path: del[1], source: toolName});
      continue;
    }

    const move = /^\*\*\* Move to: (.+)$/.exec(line);
    if (move) {
      files.push({operation: 'move', path: move[1], source: toolName});
    }
  }

  return files.length > 0 ? files : undefined;
}

function readExitCode(output: string): number | undefined {
  const structured = readJsonObject(output);
  const metadata = readObject(structured?.metadata);
  const metadataExitCode = readNumber(metadata?.exit_code);
  if (metadataExitCode !== undefined) {
    return metadataExitCode;
  }

  const match = /Process exited with code (-?\d+)/.exec(output);
  return match ? Number(match[1]) : undefined;
}

function readMessageContent(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const parts: string[] = [];
  for (const item of value) {
    const object = readObject(item);
    const text = readString(object?.text);
    if (text) {
      parts.push(text);
    }
  }

  return parts.length > 0 ? parts.join('\n') : undefined;
}

function readJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    return readObject(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
