import {AgentQError} from './errors';

const DURATIONS_IN_MS: Record<string, number> = {
  h: 60 * 60 * 1000,
  m: 60 * 1000,
  ms: 1,
  s: 1000,
};

export function parseDurationMs(value: string): number {
  const match = /^(\d+)(ms|s|m|h)$/.exec(value.trim());

  if (!match) {
    throw new AgentQError(
      `Invalid timeout "${value}". Use a duration like 100ms, 1m, or 1h.`,
    );
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const ms = amount * DURATIONS_IN_MS[unit];

  if (!Number.isSafeInteger(ms) || ms <= 0) {
    throw new AgentQError(
      `Invalid timeout "${value}". Timeout must be greater than zero.`,
    );
  }

  return ms;
}
