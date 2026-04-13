import {describe, expect, test} from 'bun:test';
import {parseDurationMs} from '../src/core/durations';

describe('parseDurationMs', () => {
  test('parses supported duration units', () => {
    expect(parseDurationMs('100ms')).toBe(100);
    expect(parseDurationMs('1s')).toBe(1000);
    expect(parseDurationMs('2m')).toBe(120000);
    expect(parseDurationMs('1h')).toBe(3600000);
  });

  test('rejects invalid durations', () => {
    expect(() => parseDurationMs('1d')).toThrow();
    expect(() => parseDurationMs('0m')).toThrow();
    expect(() => parseDurationMs('soon')).toThrow();
  });
});
