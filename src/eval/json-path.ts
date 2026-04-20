import {AgentQError} from '../core/errors';

export function getJsonPathValue(path: string, value: unknown): unknown {
  const tokens = parseJsonPath(path);
  let current: unknown = value;

  for (const token of tokens) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[String(token)];
  }

  return current;
}

function parseJsonPath(path: string): Array<string | number> {
  const trimmed = path.trim();
  if (!trimmed.startsWith('$.')) {
    throw new AgentQError(
      `Unsupported JSON path "${path}". Use a path like $.a.b[0].c.`,
    );
  }

  const tokens: Array<string | number> = [];
  let index = 2;
  while (index < trimmed.length) {
    const char = trimmed[index];
    if (char === '.') {
      index += 1;
      continue;
    }

    if (char === '[') {
      const closeIndex = trimmed.indexOf(']', index);
      if (closeIndex === -1) {
        throw new AgentQError(
          `Unsupported JSON path "${path}". Missing closing ].`,
        );
      }

      const token = trimmed.slice(index + 1, closeIndex);
      if (!/^\d+$/.test(token)) {
        throw new AgentQError(
          `Unsupported JSON path "${path}". Array indexes must be numeric.`,
        );
      }
      tokens.push(Number(token));
      index = closeIndex + 1;
      continue;
    }

    const match = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(trimmed.slice(index));
    if (!match) {
      throw new AgentQError(`Unsupported JSON path "${path}".`);
    }

    tokens.push(match[0]);
    index += match[0].length;
  }

  return tokens;
}
