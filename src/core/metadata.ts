import {writeFile} from 'node:fs/promises';
import type {
  ChangedFileSummary,
  ProcessMetadata,
  PreparedRun,
  RunFailureMetadata,
  RunParentLink,
  RunStatus,
  RunTokenUsageSummary,
  ToolUsageSummary,
} from './types';

export interface RunMetadata {
  agent: {
    description: string;
    filePath: string;
    id: string;
    scope: string;
  };
  completedAt?: string;
  config: {
    approval?: string;
    contextFile?: string;
    envKeys: string[];
    model: string;
    provider: string;
    reasoning: string;
    resultMode: string;
    sandbox: string;
    timeout: string;
    timeoutMs: number;
  };
  contextFilePath?: string;
  eventCount: number;
  failure?: RunFailureMetadata;
  durationMs?: number;
  exitCode?: number | null;
  changedFiles: ChangedFileSummary[];
  paths: {
    artifacts: string;
    output: string;
    runDir: string;
    stderr: string;
    stdout: string;
  };
  parent?: RunParentLink;
  process?: ProcessMetadata;
  projectCwd: string;
  startedAt: string;
  status: RunStatus;
  task: string;
  timedOut: boolean;
  tokenUsage?: RunTokenUsageSummary;
  toolUsage: ToolUsageSummary[];
}

export function buildStartedMetadata(
  prepared: PreparedRun,
  startedAt: Date,
  parent?: RunParentLink,
): RunMetadata {
  return {
    agent: {
      description: prepared.agent.frontmatter.description,
      filePath: prepared.agent.filePath,
      id: prepared.agent.id,
      scope: prepared.agent.scope,
    },
    config: {
      approval: prepared.config.approval,
      contextFile: prepared.config.contextFile,
      envKeys: Object.keys(prepared.config.env).sort(),
      model: prepared.config.model,
      provider: prepared.config.provider,
      reasoning: prepared.config.reasoning,
      resultMode: prepared.config.resultMode,
      sandbox: prepared.config.sandbox,
      timeout: prepared.config.timeout,
      timeoutMs: prepared.config.timeoutMs,
    },
    contextFilePath: prepared.contextFilePath,
    changedFiles: [],
    eventCount: 0,
    parent,
    paths: {
      artifacts: prepared.paths.artifactsDirPath,
      output: prepared.paths.outputPath,
      runDir: prepared.paths.runDir,
      stderr: prepared.paths.stderrPath,
      stdout: prepared.paths.stdoutPath,
    },
    projectCwd: prepared.projectCwd,
    startedAt: startedAt.toISOString(),
    status: 'running',
    task: prepared.task,
    timedOut: false,
    toolUsage: [],
  };
}

export async function writeMetadata(
  path: string,
  metadata: RunMetadata,
): Promise<void> {
  await writeFile(path, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
}
