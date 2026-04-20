import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {RunMetadata} from './metadata';
import type {RunTokenUsageSummary} from './types';

export type HarnessTokenUsageSummary = RunTokenUsageSummary;

export interface HarnessTokenUsageEntry {
  agent?: string;
  agentRunDir: string;
  stepId: string;
  tokenUsage?: HarnessTokenUsageSummary;
}

export interface HarnessTokenUsageSource {
  agent?: string;
  agentRunDir?: string;
  stepId: string;
}

export async function readHarnessTokenUsageSummaryFromSources(
  sources: HarnessTokenUsageSource[],
): Promise<{
  stepTokenUsage: HarnessTokenUsageEntry[];
  tokenUsage?: HarnessTokenUsageSummary;
}> {
  const stepTokenUsage: HarnessTokenUsageEntry[] = [];
  const byRunDir = new Map<string, HarnessTokenUsageEntry>();
  const usageByRunDir = new Map<string, HarnessTokenUsageSummary | undefined>();

  for (const source of sources) {
    if (!source.agentRunDir) {
      continue;
    }

    let entry = byRunDir.get(source.agentRunDir);
    if (!entry) {
      entry = {
        agent: source.agent,
        agentRunDir: source.agentRunDir,
        stepId: source.stepId,
      };
      byRunDir.set(source.agentRunDir, entry);
      stepTokenUsage.push(entry);
    } else {
      if (!entry.agent && source.agent) {
        entry.agent = source.agent;
      }
      if (entry.stepId.length === 0 && source.stepId.length > 0) {
        entry.stepId = source.stepId;
      }
    }
  }

  for (const entry of stepTokenUsage) {
    const cached = usageByRunDir.get(entry.agentRunDir);
    if (cached !== undefined || usageByRunDir.has(entry.agentRunDir)) {
      entry.tokenUsage = cached;
      continue;
    }

    const tokenUsage = await readHarnessTokenUsageFromRunDir(entry.agentRunDir);
    usageByRunDir.set(entry.agentRunDir, tokenUsage);
    entry.tokenUsage = tokenUsage;
  }

  return {
    stepTokenUsage,
    tokenUsage: summarizeHarnessTokenUsage(
      stepTokenUsage.map(entry => entry.tokenUsage),
    ),
  };
}

export async function readHarnessTokenUsageFromRunDir(
  runDir: string,
): Promise<HarnessTokenUsageSummary | undefined> {
  const runJsonPath = join(runDir, 'run.json');
  if (!existsSync(runJsonPath)) {
    return undefined;
  }

  let value: unknown;
  try {
    value = JSON.parse(await readFile(runJsonPath, 'utf8')) as unknown;
  } catch {
    return undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const metadata = value as {tokenUsage?: RunMetadata['tokenUsage']};
  return normalizeTokenUsage(metadata.tokenUsage);
}

export function summarizeHarnessTokenUsage(
  usages: Array<HarnessTokenUsageSummary | undefined>,
): HarnessTokenUsageSummary | undefined {
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let cachedInputTokens: number | undefined;
  let reasoningOutputTokens: number | undefined;
  let totalTokens: number | undefined;

  for (const usage of usages) {
    if (!usage) {
      continue;
    }

    inputTokens = sumField(inputTokens, usage.inputTokens);
    outputTokens = sumField(outputTokens, usage.outputTokens);
    cachedInputTokens = sumField(cachedInputTokens, usage.cachedInputTokens);
    reasoningOutputTokens = sumField(
      reasoningOutputTokens,
      usage.reasoningOutputTokens,
    );
    totalTokens = sumField(totalTokens, usage.totalTokens);
  }

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    cachedInputTokens === undefined &&
    reasoningOutputTokens === undefined &&
    totalTokens === undefined
  ) {
    return undefined;
  }

  return {
    cachedInputTokens,
    inputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens,
  };
}

function normalizeTokenUsage(
  usage: RunMetadata['tokenUsage'],
): HarnessTokenUsageSummary | undefined {
  if (!usage) {
    return undefined;
  }

  const normalized: HarnessTokenUsageSummary = {
    cachedInputTokens: readNumber(usage.cachedInputTokens),
    inputTokens: readNumber(usage.inputTokens),
    outputTokens: readNumber(usage.outputTokens),
    reasoningOutputTokens: readNumber(usage.reasoningOutputTokens),
    totalTokens: readNumber(usage.totalTokens),
  };

  return Object.values(normalized).some(value => value !== undefined)
    ? normalized
    : undefined;
}

function sumField(
  total: number | undefined,
  value: number | undefined,
): number | undefined {
  if (value === undefined) {
    return total;
  }

  return (total ?? 0) + value;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
