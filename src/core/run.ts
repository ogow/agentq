import {createRunPaths, resolveAgent, resolveContextFile} from './paths';
import {buildEffectiveRunConfig, renderAgentPrompt} from './agent';
import {loadAgentQConfig} from './config';
import {buildStartedMetadata, writeMetadata} from './metadata';
import {summarizeTokenUsage} from './events';
import type {AgentProvider} from '../providers/provider';
import {CodexProvider} from '../providers/codex';
import type {
  PreparedRun,
  ProviderRunResult,
  RunFailureMetadata,
  RunRequest,
  RunResult,
  RunStatus,
} from './types';

export async function prepareRun(request: RunRequest): Promise<PreparedRun> {
  const agent = await resolveAgent(request.projectCwd, request.agentId);
  const agentqConfig = await loadAgentQConfig(request.projectCwd);
  const config = buildEffectiveRunConfig(
    agent,
    request.overrides,
    agentqConfig,
  );
  const contextFilePath = config.contextFile
    ? resolveContextFile(request.projectCwd, config.contextFile)
    : undefined;
  const paths = await createRunPaths(agent.id);
  const prompt = renderAgentPrompt(agent, request.task, paths.artifactsDirPath);

  return {
    agent,
    config,
    contextFilePath,
    paths,
    projectCwd: request.projectCwd,
    prompt,
    task: request.task,
  };
}

export async function runAgent(
  request: RunRequest,
  provider: AgentProvider = new CodexProvider(),
): Promise<RunResult> {
  const prepared = await prepareRun(request);
  const startedAt = new Date();
  const metadata = buildStartedMetadata(prepared, startedAt);
  await writeMetadata(prepared.paths.runJsonPath, metadata);

  try {
    const providerResult = await provider.run(prepared, {
      agentId: prepared.agent.id,
      color: request.color,
      verbose: request.verbose,
    });
    const completedAt = new Date();
    const status = statusFromProviderResult(
      providerResult.exitCode,
      providerResult.timedOut,
    );

    await writeMetadata(prepared.paths.runJsonPath, {
      ...metadata,
      changedFiles: providerResult.changedFiles,
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      eventCount: providerResult.events.length,
      exitCode: providerResult.exitCode,
      failure: buildFailureMetadata(status, providerResult),
      status,
      timedOut: providerResult.timedOut,
      tokenUsage: summarizeTokenUsage(providerResult.events),
      toolUsage: providerResult.toolUsage,
    });

    return {
      agentId: prepared.agent.id,
      exitCode: providerResult.exitCode,
      paths: prepared.paths,
      runDir: prepared.paths.runDir,
      status,
      timedOut: providerResult.timedOut,
    };
  } catch (error) {
    const completedAt = new Date();
    await writeMetadata(prepared.paths.runJsonPath, {
      ...metadata,
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      exitCode: null,
      failure: {
        kind: 'provider_error',
        message: errorMessage(error),
        timedOut: false,
      },
      status: 'failed',
      timedOut: false,
    });

    throw error;
  }
}

function statusFromProviderResult(
  exitCode: number | null,
  timedOut: boolean,
): RunStatus {
  if (timedOut) {
    return 'timed_out';
  }

  return exitCode === 0 ? 'succeeded' : 'failed';
}

function buildFailureMetadata(
  status: RunStatus,
  providerResult: ProviderRunResult,
): RunFailureMetadata | undefined {
  if (status === 'succeeded') {
    return undefined;
  }

  if (providerResult.timedOut) {
    return {
      exitCode: providerResult.exitCode,
      kind: 'timeout',
      message: 'Run exceeded the configured timeout.',
      stderrTail: tail(providerResult.stderr),
      timedOut: true,
    };
  }

  return {
    exitCode: providerResult.exitCode,
    kind: 'provider_exit',
    message: `Provider exited with code ${providerResult.exitCode ?? 'unknown'}.`,
    stderrTail: tail(providerResult.stderr),
    timedOut: false,
  };
}

function tail(value: string, maxLength = 4000): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  return trimmed.slice(-maxLength);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
