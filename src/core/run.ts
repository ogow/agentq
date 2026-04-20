import {createRunPaths, resolveAgent, resolveContextFile} from './paths';
import {buildEffectiveRunConfig, renderAgentPrompt} from './agent';
import {loadAgentQConfig} from './config';
import {buildStartedMetadata, writeMetadata} from './metadata';
import {summarizeTokenUsage} from './events';
import type {AgentProvider} from '../providers/provider';
import {CodexProvider} from '../providers/codex';
import type {
  ProcessMetadata,
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
  const prompt = renderAgentPrompt(
    agent,
    request.task,
    paths.artifactsDirPath,
    config.resultMode,
  );

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
  let metadata = buildStartedMetadata(
    prepared,
    startedAt,
    request.runtimeParent,
  );
  await writeMetadata(prepared.paths.runJsonPath, metadata);

  try {
    const providerResult = await provider.run(prepared, {
      agentId: prepared.agent.id,
      color: request.color,
      format: request.format,
      logLevel: request.logLevel,
      onEvent: request.onEvent,
      onSpawn: async process => {
        metadata = {
          ...metadata,
          process,
        };
        await writeMetadata(prepared.paths.runJsonPath, metadata);
      },
      processRegistry: request.processRegistry,
      progress: request.progress,
      runtimeParent: request.runtimeParent,
      verbosity: request.verbosity,
      verbose: request.verbose,
    });
    const completedAt = new Date();
    const status = statusFromProviderResult(
      providerResult.exitCode,
      providerResult.interrupted === true,
      providerResult.timedOut,
    );

    metadata = {
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
      process: completeProcessMetadata(
        metadata.process,
        completedAt,
        providerResult.timedOut
          ? 'timeout'
          : providerResult.interrupted
            ? 'interrupted'
            : 'exit',
      ),
    };
    await writeMetadata(prepared.paths.runJsonPath, metadata);

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
    metadata = {
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
      process: completeProcessMetadata(metadata.process, completedAt, 'error'),
    };
    await writeMetadata(prepared.paths.runJsonPath, metadata);

    throw error;
  }
}

function statusFromProviderResult(
  exitCode: number | null,
  interrupted: boolean,
  timedOut: boolean,
): RunStatus {
  if (interrupted) {
    return 'interrupted';
  }
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
  if (status === 'interrupted') {
    return {
      exitCode: providerResult.exitCode,
      kind: 'provider_exit',
      message: 'Run was interrupted and the provider process tree was stopped.',
      stderrTail: tail(providerResult.stderr),
      timedOut: false,
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

function completeProcessMetadata(
  process: ProcessMetadata | undefined,
  completedAt: Date,
  stopReason: string,
): ProcessMetadata | undefined {
  if (!process) {
    return undefined;
  }

  return {
    ...process,
    stoppedAt: completedAt.toISOString(),
    stopReason,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
