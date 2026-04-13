import {readFile} from 'node:fs/promises';
import {requireAgentAnchors, replaceTagContent} from './anchors';
import {parseDurationMs} from './durations';
import {AgentQError, assertAgentQ} from './errors';
import {parseMarkdownFrontmatter} from './frontmatter';
import type {
  AgentQConfig,
  AgentFrontmatter,
  EffectiveRunConfig,
  ResolvedAgent,
  RunOverrides,
} from './types';

const SANDBOXES = [
  'read-only',
  'workspace-write',
  'danger-full-access',
] as const;
const APPROVAL_POLICIES = [
  'untrusted',
  'on-failure',
  'on-request',
  'never',
] as const;
const PROVIDERS = ['codex'] as const;
const REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const;

export async function readAgentFile(
  filePath: string,
  scope: 'project' | 'global',
): Promise<ResolvedAgent> {
  const markdown = await readFile(filePath, 'utf8');
  const parsed = parseMarkdownFrontmatter(markdown);
  const frontmatter = normalizeAgentFrontmatter(parsed.data, filePath);

  requireAgentAnchors(parsed.body);

  return {
    body: parsed.body,
    filePath,
    frontmatter,
    id: frontmatter.id,
    scope,
  };
}

export function renderAgentPrompt(
  agent: ResolvedAgent,
  task: string,
  artifactsDirPath?: string,
): string {
  const trimmedTask = task.trim();
  assertAgentQ(trimmedTask.length > 0, 'Task must not be empty.');

  const withTask = replaceTagContent(agent.body, 'task', trimmedTask);

  if (!artifactsDirPath) {
    return withTask;
  }

  const artifactInstructions = [
    extractAgentArtifacts(withTask),
    '',
    'AgentQ artifact directory:',
    artifactsDirPath,
    '',
    'If you create additional files for this run, write them under the AgentQ artifact directory. Do not create files there unless the task or artifact instructions call for them.',
  ].join('\n');

  return replaceTagContent(withTask, 'artifacts', artifactInstructions);
}

function extractAgentArtifacts(body: string): string {
  const pattern = /<artifacts>\s*([\s\S]*?)\s*<\/artifacts>/i;
  const match = pattern.exec(body);

  assertAgentQ(
    match,
    'Agent body must include a <artifacts>...</artifacts> anchor.',
  );

  return match[1].trim();
}

export function buildEffectiveRunConfig(
  agent: ResolvedAgent,
  overrides: RunOverrides = {},
  config: AgentQConfig = {},
): EffectiveRunConfig {
  const timeout = overrides.timeout ?? agent.frontmatter.timeout;
  const sandbox = overrides.sandbox ?? agent.frontmatter.sandbox;
  const approval = overrides.approval ?? agent.frontmatter.approval;
  const contextFile = overrides.contextFile ?? config.contextFile;
  const provider = overrides.provider ?? agent.frontmatter.provider;
  const reasoning = overrides.reasoning ?? agent.frontmatter.reasoning;

  validateSandbox(sandbox, 'sandbox');
  validateProvider(provider, 'provider');
  validateReasoning(reasoning, 'reasoning');
  if (approval !== undefined) {
    validateApproval(approval, 'approval');
  }

  return {
    agentId: agent.id,
    approval,
    contextFile,
    env: agent.frontmatter.env ?? {},
    model: overrides.model ?? agent.frontmatter.model,
    provider,
    reasoning,
    sandbox,
    timeout,
    timeoutMs: parseDurationMs(timeout),
  };
}

function normalizeAgentFrontmatter(
  data: Record<string, unknown>,
  filePath: string,
): AgentFrontmatter {
  const description = readRequiredString(data, 'description', filePath);
  const id = readRequiredString(data, 'id', filePath);
  const model = readRequiredString(data, 'model', filePath);
  const provider = readRequiredString(data, 'provider', filePath);
  const reasoning = readRequiredString(data, 'reasoning', filePath);
  const sandbox = readRequiredString(data, 'sandbox', filePath);
  const timeout = readRequiredString(data, 'timeout', filePath);
  const approval = readOptionalString(data, 'approval');
  const env = readOptionalStringRecord(data, 'env');

  validateProvider(provider, 'provider');
  validateReasoning(reasoning, 'reasoning');
  validateSandbox(sandbox, 'sandbox');
  if (approval !== undefined) {
    validateApproval(approval, 'approval');
  }

  return {
    approval,
    description,
    env,
    id,
    model,
    provider,
    reasoning,
    sandbox,
    timeout,
  };
}

function readRequiredString(
  data: Record<string, unknown>,
  key: string,
  filePath: string,
): string {
  const value = data[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AgentQError(
      `Agent ${filePath} must define frontmatter field "${key}".`,
    );
  }

  return value;
}

function readOptionalString(
  data: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = data[key];
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AgentQError(
      `Agent frontmatter field "${key}" must be a non-empty string.`,
    );
  }

  return value;
}

function readOptionalStringRecord(
  data: Record<string, unknown>,
  key: string,
): Record<string, string> | undefined {
  const value = data[key];
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentQError(
      `Agent frontmatter field "${key}" must be an object of string values.`,
    );
  }

  const env: Record<string, string> = {};
  for (const [envKey, envValue] of Object.entries(value)) {
    if (typeof envValue !== 'string') {
      throw new AgentQError(`Agent env value "${envKey}" must be a string.`);
    }
    env[envKey] = envValue;
  }

  return env;
}

function validateSandbox(
  value: string,
  key: string,
): asserts value is AgentFrontmatter['sandbox'] {
  if (!SANDBOXES.includes(value as AgentFrontmatter['sandbox'])) {
    throw new AgentQError(
      `Invalid ${key} "${value}". Use one of: ${SANDBOXES.join(', ')}.`,
    );
  }
}

function validateProvider(
  value: string,
  key: string,
): asserts value is AgentFrontmatter['provider'] {
  if (!PROVIDERS.includes(value as AgentFrontmatter['provider'])) {
    throw new AgentQError(
      `Invalid ${key} "${value}". Use one of: ${PROVIDERS.join(', ')}.`,
    );
  }
}

function validateReasoning(
  value: string,
  key: string,
): asserts value is AgentFrontmatter['reasoning'] {
  if (!REASONING_EFFORTS.includes(value as AgentFrontmatter['reasoning'])) {
    throw new AgentQError(
      `Invalid ${key} "${value}". Use one of: ${REASONING_EFFORTS.join(', ')}.`,
    );
  }
}

function validateApproval(
  value: string,
  key: string,
): asserts value is NonNullable<AgentFrontmatter['approval']> {
  if (
    !APPROVAL_POLICIES.includes(
      value as NonNullable<AgentFrontmatter['approval']>,
    )
  ) {
    throw new AgentQError(
      `Invalid ${key} "${value}". Use one of: ${APPROVAL_POLICIES.join(', ')}.`,
    );
  }
}
