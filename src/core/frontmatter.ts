import frontMatter from 'front-matter';
import {AgentQError, assertAgentQ} from './errors';

export interface ParsedMarkdownFrontmatter {
  body: string;
  data: Record<string, unknown>;
}

export function parseMarkdownFrontmatter(
  markdown: string,
): ParsedMarkdownFrontmatter {
  if (!frontMatter.test(markdown)) {
    throw new AgentQError(
      'Agent file must start with YAML frontmatter delimited by ---.',
    );
  }

  const parsed = frontMatter<Record<string, unknown>>(markdown);
  assertAgentQ(
    parsed.attributes &&
      typeof parsed.attributes === 'object' &&
      !Array.isArray(parsed.attributes),
    'Agent frontmatter must be a YAML object.',
  );

  return {
    body: parsed.body,
    data: parsed.attributes,
  };
}
