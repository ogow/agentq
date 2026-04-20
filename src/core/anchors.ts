import {AgentQError} from './errors';

const ANCHOR_NAMES = ['task', 'artifacts'] as const;

export type RequiredAnchor = (typeof ANCHOR_NAMES)[number];

export function requireAgentAnchors(body: string): void {
  for (const anchor of ANCHOR_NAMES) {
    extractTagContent(body, anchor);
  }
}

export function extractTagContent(body: string, tagName: string): string {
  const pattern = new RegExp(
    `<${tagName}>\\s*([\\s\\S]*?)\\s*</${tagName}>`,
    'i',
  );
  const match = pattern.exec(body);

  if (!match) {
    throw new AgentQError(
      `Agent body must include a <${tagName}>...</${tagName}> anchor.`,
    );
  }

  return match[1];
}

export function replaceTagContent(
  body: string,
  tagName: string,
  content: string,
): string {
  const pattern = new RegExp(`(<${tagName}>)([\\s\\S]*?)(</${tagName}>)`, 'i');

  if (!pattern.test(body)) {
    throw new AgentQError(
      `Agent body must include a <${tagName}>...</${tagName}> anchor.`,
    );
  }

  return body.replace(pattern, `$1\n${content.trim()}\n$3`);
}
