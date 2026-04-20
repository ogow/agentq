import frontMatter from 'front-matter';
import {randomBytes} from 'node:crypto';
import {existsSync} from 'node:fs';
import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import {platform} from 'node:os';
import {basename, isAbsolute, join, resolve} from 'node:path';
import {AgentQError, assertAgentQ} from './errors';
import {agentqHome} from './home';
import {resolveHarnessRunDir} from './harness-paths';
import {currentHost, ProcessRegistry} from './processes';
import {
  createHarnessProgressRenderer,
  type HarnessProgressRenderer,
} from './render';
import {runAgent} from './run';
import type {AgentProvider} from '../providers/provider';
import type {
  AgentFeedback,
  AgentOutput,
  ArtifactRef,
  FailureKind,
  HarnessStepStatus,
  LogLevel,
  ProcessMetadata,
  StepResult,
} from './types';

type HarnessCommand = string | string[];
type HarnessInputType = 'string' | 'number' | 'boolean';
type HarnessRunStatus =
  | 'running'
  | 'success'
  | 'failed'
  | 'blocked'
  | 'timed_out'
  | 'interrupted';

interface HarnessDefinition {
  agent?: string;
  checks: HarnessCheckDefinition[];
  filePath: string;
  inputs: Record<string, HarnessInputType>;
  name: string;
  retries: number;
  steps?: HarnessStepDefinition[];
}

interface HarnessCheckDefinition {
  command: HarnessCommand;
  id: string;
}

type HarnessStepDefinition =
  | HarnessAgentStepDefinition
  | HarnessCommandStepDefinition
  | HarnessLoopStepDefinition;

type HarnessLoopBodyStepDefinition =
  | HarnessAgentStepDefinition
  | HarnessCommandStepDefinition;

interface HarnessAgentStepDefinition {
  agent: string;
  id: string;
  kind: 'agent';
}

interface HarnessCommandStepDefinition {
  command: HarnessCommand;
  id: string;
  kind: 'command';
}

interface HarnessLoopStepDefinition {
  id: string;
  kind: 'loop';
  over?: string;
  retries: number;
  steps: HarnessLoopBodyStepDefinition[];
}

interface CommandExecutionResult extends StepResult {
  command: string;
  exitCode: number | null;
  stderr: string;
  stdout: string;
}

export interface HarnessListEntry {
  filePath: string;
  id: string;
  scope: 'global' | 'project';
}

export interface HarnessRunRequest {
  color?: boolean;
  inputFile?: string;
  inputText?: string;
  inputs?: Record<string, unknown>;
  logLevel?: LogLevel;
  name: string;
  projectCwd: string;
  provider?: AgentProvider;
  verbose?: boolean;
}

export interface HarnessRunResult {
  attempts: HarnessAttemptRecord[];
  durationMs: number;
  failedStep?: string;
  feedback?: AgentFeedback | null;
  finishedAt: string;
  harnessName: string;
  iterations: number;
  runDir: string;
  startedAt: string;
  status: HarnessRunStatus;
  steps: StepResult[];
  summary: string;
}

export interface HarnessAttemptRecord {
  agentRunDir?: string;
  attempt: number;
  checks: HarnessCheckResult[];
  failureKind?: FailureKind;
  feedback?: AgentFeedback | null;
  finishedAt?: string;
  loopId?: string;
  startedAt: string;
  status: HarnessStepStatus;
  summary: string;
}

export interface HarnessCheckResult {
  command: string;
  exitCode: number | null;
  finishedAt: string;
  id: string;
  startedAt: string;
  status: HarnessStepStatus;
  stderr: string;
  stdout: string;
}

interface HarnessRunPaths {
  logPath: string;
  runDir: string;
  tasksPath: string;
}

interface HarnessState {
  attempts: HarnessAttemptRecord[];
  finishedAt?: string;
  harnessName: string;
  inputs: Record<string, unknown>;
  process: ProcessMetadata;
  projectCwd: string;
  runDir: string;
  startedAt: string;
  status: HarnessRunStatus;
  stepResults?: Record<string, StepResult>;
  summary?: string;
}

export type HarnessLogEventKind =
  | 'agent_run_finished'
  | 'check_finished'
  | 'check_started'
  | 'harness_finished'
  | 'harness_started'
  | 'step_finished'
  | 'step_started';

export interface HarnessLogEvent {
  agent?: string;
  agentRunDir?: string;
  command?: string;
  exitCode?: number | null;
  harnessName: string;
  kind: HarnessLogEventKind;
  message?: string;
  status?: HarnessStepStatus | HarnessRunStatus;
  stepId: string;
  summary?: string;
  timestamp: string;
}

export interface HarnessLogsRequest {
  failed?: boolean;
  follow?: boolean;
  run: string;
  step?: string;
}

export interface FormatHarnessLogEventOptions {
  verbose?: boolean;
}

export async function runHarness(
  request: HarnessRunRequest,
): Promise<HarnessRunResult> {
  const definition = await resolveHarness(request.projectCwd, request.name);
  const inputs = await loadHarnessInputs(request);
  validateHarnessInputs(definition, inputs);

  const paths = await createHarnessRunPaths(definition.name);
  const startedAt = new Date();
  const process: ProcessMetadata = {
    command: 'agentq harness run',
    host: currentHost(),
    pid: globalThis.process.pid,
    startedAt: startedAt.toISOString(),
  };
  const state: HarnessState = {
    attempts: [],
    harnessName: definition.name,
    inputs,
    process,
    projectCwd: request.projectCwd,
    runDir: paths.runDir,
    startedAt: startedAt.toISOString(),
    status: 'running',
  };
  await writeHarnessState(paths, state);
  await appendHarnessLogEvent(paths, state, {
    kind: 'harness_started',
    status: 'running',
    stepId: definition.name,
    summary: `Harness ${definition.name} started.`,
  });

  const progress = createHarnessProgressRenderer({
    color: request.color,
    logLevel: request.logLevel,
    verbose: request.verbose,
  });
  const processRegistry = new ProcessRegistry();
  const interruptState = {interrupted: false};
  const interrupt = () => {
    interruptState.interrupted = true;
    void processRegistry.killAll();
  };
  globalThis.process.on('SIGINT', interrupt);
  globalThis.process.on('SIGTERM', interrupt);

  try {
    if (definition.steps) {
      return await runHarnessSteps({
        definition,
        interruptState,
        paths,
        processRegistry,
        progress,
        provider: request.provider,
        request,
        startedAt,
        state,
      });
    }
    return await runHarnessAttempts({
      definition,
      interruptState,
      paths,
      processRegistry,
      progress,
      provider: request.provider,
      request,
      startedAt,
      state,
    });
  } finally {
    globalThis.process.off('SIGINT', interrupt);
    globalThis.process.off('SIGTERM', interrupt);
    await processRegistry.killAll();
    progress.stop();
  }
}

export async function inspectHarnessRun(
  runIdOrPath: string,
): Promise<HarnessRunResult> {
  const runDir = resolveHarnessRunDir(runIdOrPath);
  const state = await readHarnessState(harnessRunPathsFromDir(runDir));

  return {
    attempts: state.attempts,
    durationMs: durationMs(state.startedAt, state.finishedAt),
    failedStep:
      state.status === 'success' || state.status === 'running'
        ? undefined
        : latestAttemptStep(state),
    feedback: state.attempts.at(-1)?.feedback ?? null,
    finishedAt: state.finishedAt ?? new Date().toISOString(),
    harnessName: state.harnessName,
    iterations: state.attempts.length,
    runDir: state.runDir,
    startedAt: state.startedAt,
    status: state.status,
    steps: [],
    summary: state.summary ?? 'Harness run has not completed.',
  };
}

export function formatHarnessSummary(result: HarnessRunResult): string {
  const lines = [
    `Harness ${result.harnessName}: ${result.status}`,
    `attempts: ${result.iterations}`,
    `summary: ${result.summary}`,
  ];
  if (result.failedStep) {
    lines.push(`failed step: ${result.failedStep}`);
  }
  if (result.feedback) {
    lines.push(`feedback: ${formatFeedback(result.feedback)}`);
  }
  lines.push(`run: ${result.runDir}`);
  return lines.join('\n');
}

export async function readHarnessLogEvents(
  request: HarnessLogsRequest,
): Promise<HarnessLogEvent[]> {
  const runDir = resolveHarnessRunDir(request.run);
  const paths = harnessRunPathsFromDir(runDir);
  if (!existsSync(paths.logPath)) {
    return [];
  }

  return (await readFile(paths.logPath, 'utf8'))
    .split(/\r?\n/)
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as HarnessLogEvent)
    .filter(event => matchesHarnessLogRequest(event, request));
}

export function formatHarnessLogEvent(
  event: HarnessLogEvent,
  options: FormatHarnessLogEventOptions = {},
): string {
  if (options.verbose) {
    return [
      event.timestamp,
      event.kind,
      event.stepId,
      event.status ?? '',
      event.summary ?? event.message ?? '',
    ]
      .filter(Boolean)
      .join('  ');
  }

  const timestamp = timestampLabel(event.timestamp);
  const status = event.status ?? '';
  const actor = event.agent ?? event.stepId;
  const summary = event.summary ?? event.message ?? '';
  return [timestamp, actor, status, summary].filter(Boolean).join('  ');
}

export async function followHarnessLogEvents(
  request: HarnessLogsRequest,
  onEvent: (event: HarnessLogEvent) => void,
): Promise<void> {
  const runDir = resolveHarnessRunDir(request.run);
  const paths = harnessRunPathsFromDir(runDir);
  let offset = existsSync(paths.logPath) ? (await stat(paths.logPath)).size : 0;

  while (await isHarnessRunActive(paths)) {
    if (existsSync(paths.logPath)) {
      const content = await readFile(paths.logPath, 'utf8');
      const next = content.slice(offset);
      offset = content.length;
      for (const line of next.split(/\r?\n/)) {
        if (line.trim().length === 0) {
          continue;
        }
        const event = JSON.parse(line) as HarnessLogEvent;
        if (matchesHarnessLogRequest(event, request)) {
          onEvent(event);
        }
      }
    }
    await delay(500);
  }
}

export async function listHarnesses(
  projectCwd: string,
): Promise<HarnessListEntry[]> {
  const harnesses = [
    ...(await listHarnessesInDirectory(
      join(agentqHome(), 'harnesses'),
      'global',
    )),
    ...(await listHarnessesInDirectory(
      join(projectCwd, '.agentq', 'harnesses'),
      'project',
    )),
  ];
  const byId = new Map<string, HarnessListEntry>();
  for (const harness of harnesses) {
    byId.set(harness.id, harness);
  }
  return [...byId.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}

async function runHarnessSteps(options: {
  definition: HarnessDefinition;
  interruptState: {interrupted: boolean};
  paths: HarnessRunPaths;
  processRegistry: ProcessRegistry;
  progress: HarnessProgressRenderer;
  provider?: AgentProvider;
  request: HarnessRunRequest;
  startedAt: Date;
  state: HarnessState;
}): Promise<HarnessRunResult> {
  const stepResults = options.state.stepResults ?? {};
  options.state.stepResults = stepResults;
  let terminalStatus: Exclude<HarnessRunStatus, 'running'> = 'success';
  let failedStep: string | undefined;
  let feedback: AgentFeedback | null = null;
  let summary = `Harness ${options.definition.name} completed successfully.`;

  try {
    for (const step of options.definition.steps ?? []) {
      if (options.interruptState.interrupted) {
        terminalStatus = 'interrupted';
        failedStep = step.id;
        summary = `Harness ${options.definition.name} was interrupted and active processes were stopped.`;
        break;
      }

      const result =
        step.kind === 'loop'
          ? await runLoopStep({
              definition: options.definition,
              interruptState: options.interruptState,
              loop: step,
              paths: options.paths,
              processRegistry: options.processRegistry,
              progress: options.progress,
              provider: options.provider,
              request: options.request,
              state: options.state,
            })
          : await runDefinedStep({
              attempt: 1,
              definition: options.definition,
              feedback: null,
              interruptState: options.interruptState,
              loopItem: undefined,
              paths: options.paths,
              processRegistry: options.processRegistry,
              progress: options.progress,
              provider: options.provider,
              request: options.request,
              state: options.state,
              step,
              stepId: step.id,
            });

      options.state.stepResults = {
        ...(options.state.stepResults ?? stepResults),
        [step.id]: result,
      };
      await writeHarnessState(options.paths, options.state);

      if (options.interruptState.interrupted) {
        terminalStatus = 'interrupted';
        failedStep = step.id;
        summary = `Harness ${options.definition.name} was interrupted and active processes were stopped.`;
        break;
      }
      if (result.status !== 'success') {
        terminalStatus = result.status;
        failedStep = step.id;
        feedback = result.feedback;
        summary = result.summary;
        break;
      }
    }
  } catch (error) {
    terminalStatus = options.interruptState.interrupted
      ? 'interrupted'
      : 'failed';
    summary = options.interruptState.interrupted
      ? `Harness ${options.definition.name} was interrupted and active processes were stopped.`
      : `Harness failed: ${errorMessage(error)}`;
    feedback = {problem: summary};
  }

  return finishHarnessRun({
    definition: options.definition,
    failedStep,
    feedback,
    paths: options.paths,
    startedAt: options.startedAt,
    state: options.state,
    status: terminalStatus,
    summary,
  });
}

async function runLoopStep(options: {
  definition: HarnessDefinition;
  interruptState: {interrupted: boolean};
  loop: HarnessLoopStepDefinition;
  paths: HarnessRunPaths;
  processRegistry: ProcessRegistry;
  progress: HarnessProgressRenderer;
  provider?: AgentProvider;
  request: HarnessRunRequest;
  state: HarnessState;
}): Promise<StepResult> {
  const startedAt = new Date();
  const items = resolveLoopItems(options.loop, options.state);
  let feedback: AgentFeedback | null = null;
  let summary = `Loop ${options.loop.id} completed successfully.`;
  let status: HarnessStepStatus = 'success';
  const artifacts: ArtifactRef[] = [];
  let result: unknown = null;

  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const loopItem = items[itemIndex];
    const maxAttempts = options.loop.retries + 1;
    let itemSucceeded = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (options.interruptState.interrupted) {
        status = 'failed';
        summary = `Loop ${options.loop.id} was interrupted and stopped.`;
        feedback = {problem: summary};
        break;
      }

      const attemptStartedAt = new Date();
      const attemptRecord: HarnessAttemptRecord = {
        attempt,
        checks: [],
        loopId: options.loop.id,
        startedAt: attemptStartedAt.toISOString(),
        status: 'failed',
        summary: '',
      };
      let attemptStatus: HarnessStepStatus = 'success';
      let attemptSummary = '';
      let attemptFeedback: AgentFeedback | null = feedback;
      let attemptFailureKind: FailureKind | undefined;
      let lastAgentRunDir: string | undefined;
      let retryable = true;

      for (const step of options.loop.steps) {
        const stepId = loopStepId(options.loop.id, itemIndex, attempt, step.id);
        const stepResult = await runDefinedStep({
          attempt,
          definition: options.definition,
          feedback: attemptFeedback,
          interruptState: options.interruptState,
          loopItem,
          paths: options.paths,
          processRegistry: options.processRegistry,
          progress: options.progress,
          provider: options.provider,
          request: options.request,
          state: options.state,
          step,
          stepId,
        });
        options.state.stepResults = {
          ...(options.state.stepResults ?? {}),
          [stepId]: stepResult,
        };
        await writeHarnessState(options.paths, options.state);

        attemptSummary = stepResult.summary;
        attemptFeedback = stepResult.feedback;
        attemptFailureKind = stepResult.failureKind;
        artifacts.push(...stepResult.artifacts);
        if (stepResult.runDir) {
          lastAgentRunDir = stepResult.runDir;
        }
        if (stepResult.kind === 'command') {
          const commandResult = stepResult as CommandExecutionResult;
          attemptRecord.checks.push({
            command: commandResult.command,
            exitCode: commandResult.exitCode,
            finishedAt: commandResult.finishedAt,
            id: step.id,
            startedAt: commandResult.startedAt,
            status: commandResult.status,
            stderr: commandResult.stderr,
            stdout: commandResult.stdout,
          });
        }

        if (options.interruptState.interrupted) {
          attemptStatus = 'failed';
          attemptSummary = `Loop ${options.loop.id} was interrupted and stopped.`;
          attemptFeedback = {problem: attemptSummary};
          break;
        }
        if (stepResult.status !== 'success') {
          attemptStatus = stepResult.status;
          retryable = isRetryableFailure(stepResult);
          break;
        }
      }

      attemptRecord.agentRunDir = lastAgentRunDir;
      attemptRecord.failureKind = attemptFailureKind;
      attemptRecord.feedback = attemptFeedback;
      attemptRecord.finishedAt = new Date().toISOString();
      attemptRecord.status = attemptStatus;
      attemptRecord.summary = attemptSummary;
      options.state.attempts.push(attemptRecord);
      await writeHarnessState(options.paths, options.state);

      if (attemptStatus === 'success') {
        itemSucceeded = true;
        status = 'success';
        summary = `Loop ${options.loop.id} completed successfully.`;
        feedback = null;
        break;
      }
      status = attemptStatus;
      summary = attemptSummary;
      feedback = attemptFeedback;
      if (attemptStatus === 'blocked' || !retryable) {
        break;
      }
    }

    if (!itemSucceeded) {
      if (options.interruptState.interrupted) {
        status = 'failed';
        summary = `Loop ${options.loop.id} was interrupted and stopped.`;
        feedback = {problem: summary};
      }
      break;
    }
  }

  result = {items: items.length};
  return {
    artifacts,
    feedback,
    finishedAt: new Date().toISOString(),
    kind: 'loop',
    result,
    startedAt: startedAt.toISOString(),
    status,
    stepId: options.loop.id,
    summary,
  };
}

async function runDefinedStep(options: {
  attempt: number;
  definition: HarnessDefinition;
  feedback: AgentFeedback | null;
  interruptState: {interrupted: boolean};
  loopItem: unknown;
  paths: HarnessRunPaths;
  processRegistry: ProcessRegistry;
  progress: HarnessProgressRenderer;
  provider?: AgentProvider;
  request: HarnessRunRequest;
  state: HarnessState;
  step: HarnessLoopBodyStepDefinition;
  stepId: string;
}): Promise<StepResult> {
  return options.step.kind === 'agent'
    ? runAgentStep({
        agent: options.step.agent,
        attempt: options.attempt,
        feedback: options.feedback,
        interruptState: options.interruptState,
        loopItem: options.loopItem,
        paths: options.paths,
        processRegistry: options.processRegistry,
        progress: options.progress,
        provider: options.provider,
        request: options.request,
        state: options.state,
        stepId: options.stepId,
      })
    : runCommandStep({
        command: options.step.command,
        id: options.step.id,
        interruptState: options.interruptState,
        paths: options.paths,
        processRegistry: options.processRegistry,
        progress: options.progress,
        projectCwd: options.request.projectCwd,
        state: options.state,
        stepId: options.stepId,
      });
}

async function runAgentStep(options: {
  agent: string;
  attempt: number;
  feedback: AgentFeedback | null;
  interruptState: {interrupted: boolean};
  loopItem: unknown;
  paths: HarnessRunPaths;
  processRegistry: ProcessRegistry;
  progress: HarnessProgressRenderer;
  provider?: AgentProvider;
  request: HarnessRunRequest;
  state: HarnessState;
  stepId: string;
}): Promise<StepResult> {
  const startedAt = new Date();
  await writeHarnessState(options.paths, options.state);
  options.progress.startStep({detail: options.stepId, label: options.agent});
  await appendHarnessLogEvent(options.paths, options.state, {
    agent: options.agent,
    kind: 'step_started',
    status: 'running',
    stepId: options.stepId,
    summary: `Running ${options.agent}.`,
  });

  let agentOutput: AgentOutput | undefined;
  let agentRunDir: string | undefined;
  let status: HarnessStepStatus = 'failed';
  let summary = '';
  let feedback: AgentFeedback | null = null;
  try {
    const runResult = await runAgent(
      {
        agentId: options.agent,
        color: options.request.color,
        onEvent: event => options.progress.onEvent(event),
        overrides: {resultMode: 'json'},
        processRegistry: options.processRegistry,
        progress: false,
        projectCwd: options.request.projectCwd,
        runtimeParent: {
          kind: 'harness',
          runId: basename(options.paths.runDir),
          stepId: options.stepId,
        },
        task: taskFromStepContext({
          attempt: options.attempt,
          feedback: options.feedback,
          inputs: options.state.inputs,
          loopItem: options.loopItem,
          stepResults: options.state.stepResults ?? {},
        }),
        logLevel: options.request.logLevel,
        verbose: options.request.verbose,
      },
      options.provider,
    );
    agentRunDir = runResult.runDir;
    if (runResult.status === 'interrupted') {
      options.interruptState.interrupted = true;
    }
    await appendHarnessLogEvent(options.paths, options.state, {
      agent: options.agent,
      agentRunDir,
      exitCode: runResult.exitCode,
      kind: 'agent_run_finished',
      status: agentStatusFromRun(runResult.status),
      stepId: options.stepId,
      summary: `Agent run: ${agentRunDir}`,
    });

    if (runResult.status === 'interrupted') {
      status = 'failed';
      summary = 'Agent run was interrupted and stopped.';
      feedback = {problem: summary};
    } else if (runResult.status !== 'succeeded') {
      status = 'failed';
      summary = `Agent exited with status ${runResult.status}.`;
      feedback = {problem: summary};
    } else {
      agentOutput = parseAgentOutput(
        await readFile(runResult.paths.outputPath, 'utf8'),
        options.agent,
      );
      status = agentOutput.status;
      summary = agentOutput.summary;
      feedback = agentOutput.feedback;
    }
  } catch (error) {
    status = 'failed';
    if (options.interruptState.interrupted) {
      summary = 'Agent run was interrupted and stopped.';
    } else {
      summary = `Agent failed: ${errorMessage(error)}`;
    }
    feedback = {problem: summary};
  }

  const result: StepResult = {
    artifacts: agentOutput?.artifacts ?? [],
    failureKind: agentOutput?.failureKind,
    feedback,
    finishedAt: new Date().toISOString(),
    kind: 'agent',
    result: agentOutput?.result ?? null,
    runDir: agentRunDir,
    startedAt: startedAt.toISOString(),
    status,
    stepId: options.stepId,
    summary,
  };
  options.progress.finishStep(
    {detail: options.stepId, label: options.agent},
    result,
  );
  await appendHarnessLogEvent(options.paths, options.state, {
    agent: options.agent,
    agentRunDir,
    kind: 'step_finished',
    status,
    stepId: options.stepId,
    summary,
  });
  return result;
}

async function runCommandStep(options: {
  command: HarnessCommand;
  id: string;
  interruptState: {interrupted: boolean};
  paths: HarnessRunPaths;
  processRegistry: ProcessRegistry;
  progress: HarnessProgressRenderer;
  projectCwd: string;
  state: HarnessState;
  stepId: string;
}): Promise<CommandExecutionResult> {
  const startedAt = new Date();
  const command = commandArgv(options.command);
  await writeHarnessState(options.paths, options.state);
  options.progress.startStep({detail: options.stepId, label: options.id});
  await appendHarnessLogEvent(options.paths, options.state, {
    command: command.join(' '),
    kind: 'check_started',
    status: 'running',
    stepId: options.stepId,
    summary: `Running check ${options.id}.`,
  });

  const proc = Bun.spawn(command, {
    cwd: options.projectCwd,
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const untrack = options.processRegistry.track(proc);
  let exitCode: number | null;
  let stdout: string;
  let stderr: string;
  try {
    [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
  } finally {
    untrack();
  }

  const interrupted = options.interruptState.interrupted;
  const status: HarnessStepStatus =
    !interrupted && exitCode === 0 ? 'success' : 'failed';
  const summary = interrupted
    ? `Check ${options.id} was interrupted.`
    : status === 'success'
      ? `Check ${options.id} passed.`
      : `Check ${options.id} failed.`;
  const result: CommandExecutionResult = {
    artifacts: [],
    command: command.join(' '),
    exitCode,
    failureKind: status === 'success' ? undefined : 'check',
    feedback:
      status === 'success'
        ? null
        : {
            problem: `Check ${options.id} failed.`,
            evidence: [stderr, stdout].filter(value => value.trim().length > 0),
          },
    finishedAt: new Date().toISOString(),
    kind: 'command',
    result: {stderr, stdout},
    startedAt: startedAt.toISOString(),
    status,
    stderr,
    stdout,
    stepId: options.stepId,
    summary,
  };
  options.progress.finishStep(
    {detail: options.stepId, label: options.id},
    result,
  );
  await appendHarnessLogEvent(options.paths, options.state, {
    command: result.command,
    exitCode,
    kind: 'check_finished',
    status,
    stepId: options.stepId,
    summary,
  });
  return result;
}

async function finishHarnessRun(options: {
  definition: HarnessDefinition;
  failedStep?: string;
  feedback: AgentFeedback | null;
  paths: HarnessRunPaths;
  startedAt: Date;
  state: HarnessState;
  status: Exclude<HarnessRunStatus, 'running'>;
  summary: string;
}): Promise<HarnessRunResult> {
  const finishedAt = new Date();
  const result: HarnessRunResult = {
    attempts: options.state.attempts,
    durationMs: finishedAt.getTime() - options.startedAt.getTime(),
    failedStep: options.failedStep,
    feedback: options.feedback,
    finishedAt: finishedAt.toISOString(),
    harnessName: options.definition.name,
    iterations: options.state.attempts.length,
    runDir: options.paths.runDir,
    startedAt: options.startedAt.toISOString(),
    status: options.status,
    steps: Object.values(options.state.stepResults ?? {}),
    summary: options.summary,
  };

  options.state.finishedAt = finishedAt.toISOString();
  options.state.process = {
    ...options.state.process,
    stoppedAt: finishedAt.toISOString(),
    stopReason: options.status === 'interrupted' ? 'interrupted' : 'exit',
  };
  options.state.status = options.status;
  options.state.summary = options.summary;
  await writeHarnessState(options.paths, options.state);
  await appendHarnessLogEvent(options.paths, options.state, {
    kind: 'harness_finished',
    status: options.status,
    stepId: options.definition.name,
    summary: options.summary,
  });

  return result;
}

async function runHarnessAttempts(options: {
  definition: HarnessDefinition;
  interruptState: {interrupted: boolean};
  paths: HarnessRunPaths;
  processRegistry: ProcessRegistry;
  progress: HarnessProgressRenderer;
  provider?: AgentProvider;
  request: HarnessRunRequest;
  startedAt: Date;
  state: HarnessState;
}): Promise<HarnessRunResult> {
  const agent = requireHarnessAgent(options.definition);
  const maxAttempts = options.definition.retries + 1;
  let terminalAttempt: HarnessAttemptRecord | undefined;
  let terminalStatus: Exclude<HarnessRunStatus, 'running'> = 'failed';
  let failedStep: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options.interruptState.interrupted) {
      terminalStatus = 'interrupted';
      failedStep = `attempt-${attempt}`;
      break;
    }

    const attemptRecord = await runHarnessAttempt({
      agent,
      attempt,
      definition: options.definition,
      interruptState: options.interruptState,
      paths: options.paths,
      processRegistry: options.processRegistry,
      progress: options.progress,
      provider: options.provider,
      request: options.request,
      state: options.state,
    });
    terminalAttempt = attemptRecord;
    options.state.attempts.push(attemptRecord);
    await writeHarnessState(options.paths, options.state);

    if (options.interruptState.interrupted) {
      terminalStatus = 'interrupted';
      failedStep = `attempt-${attempt}`;
      break;
    }
    if (attemptRecord.status === 'success') {
      terminalStatus = 'success';
      break;
    }
    if (attemptRecord.status === 'blocked') {
      terminalStatus = 'blocked';
      failedStep = `attempt-${attempt}`;
      break;
    }
    failedStep = `attempt-${attempt}`;
  }

  const finishedAt = new Date();
  const summary =
    terminalStatus === 'success'
      ? `Harness ${options.definition.name} completed successfully.`
      : terminalStatus === 'interrupted'
        ? `Harness ${options.definition.name} was interrupted and active processes were stopped.`
        : (terminalAttempt?.summary ??
          `Harness ${options.definition.name} failed.`);
  const result: HarnessRunResult = {
    attempts: options.state.attempts,
    durationMs: finishedAt.getTime() - options.startedAt.getTime(),
    failedStep,
    feedback: terminalAttempt?.feedback ?? null,
    finishedAt: finishedAt.toISOString(),
    harnessName: options.definition.name,
    iterations: options.state.attempts.length,
    runDir: options.paths.runDir,
    startedAt: options.startedAt.toISOString(),
    status: terminalStatus,
    steps: [],
    summary,
  };

  options.state.finishedAt = finishedAt.toISOString();
  options.state.process = {
    ...options.state.process,
    stoppedAt: finishedAt.toISOString(),
    stopReason: terminalStatus === 'interrupted' ? 'interrupted' : 'exit',
  };
  options.state.status = terminalStatus;
  options.state.summary = summary;
  await writeHarnessState(options.paths, options.state);
  await appendHarnessLogEvent(options.paths, options.state, {
    kind: 'harness_finished',
    status: terminalStatus,
    stepId: options.definition.name,
    summary,
  });

  return result;
}

async function runHarnessAttempt(options: {
  agent: string;
  attempt: number;
  definition: HarnessDefinition;
  interruptState: {interrupted: boolean};
  paths: HarnessRunPaths;
  processRegistry: ProcessRegistry;
  progress: HarnessProgressRenderer;
  provider?: AgentProvider;
  request: HarnessRunRequest;
  state: HarnessState;
}): Promise<HarnessAttemptRecord> {
  const startedAt = new Date();
  const stepId = `attempt-${options.attempt}.agent`;
  await writeHarnessState(options.paths, options.state);
  options.progress.startStep({detail: stepId, label: options.agent});
  await appendHarnessLogEvent(options.paths, options.state, {
    agent: options.agent,
    kind: 'step_started',
    status: 'running',
    stepId,
    summary: `Running ${options.agent}.`,
  });

  let agentOutput: AgentOutput | undefined;
  let agentRunDir: string | undefined;
  let status: HarnessStepStatus = 'failed';
  let summary = '';
  let feedback: AgentFeedback | null = null;
  try {
    const runResult = await runAgent(
      {
        agentId: options.agent,
        color: options.request.color,
        onEvent: event => options.progress.onEvent(event),
        overrides: {resultMode: 'json'},
        processRegistry: options.processRegistry,
        progress: false,
        projectCwd: options.request.projectCwd,
        runtimeParent: {
          kind: 'harness',
          runId: basename(options.paths.runDir),
          stepId,
        },
        task: taskFromInputs(options.state.inputs, options.attempt),
        logLevel: options.request.logLevel,
        verbose: options.request.verbose,
      },
      options.provider,
    );
    agentRunDir = runResult.runDir;
    if (runResult.status === 'interrupted') {
      options.interruptState.interrupted = true;
    }
    await appendHarnessLogEvent(options.paths, options.state, {
      agent: options.agent,
      agentRunDir,
      exitCode: runResult.exitCode,
      kind: 'agent_run_finished',
      status: agentStatusFromRun(runResult.status),
      stepId,
      summary: `Agent run: ${agentRunDir}`,
    });

    if (runResult.status === 'interrupted') {
      status = 'failed';
      summary = 'Agent run was interrupted and stopped.';
      feedback = {problem: summary};
    } else if (runResult.status !== 'succeeded') {
      status = 'failed';
      summary = `Agent exited with status ${runResult.status}.`;
      feedback = {problem: summary};
    } else {
      agentOutput = parseAgentOutput(
        await readFile(runResult.paths.outputPath, 'utf8'),
        options.agent,
      );
      status = agentOutput.status;
      summary = agentOutput.summary;
      feedback = agentOutput.feedback;
    }
  } catch (error) {
    status = 'failed';
    if (options.interruptState.interrupted) {
      summary = 'Agent run was interrupted and stopped.';
    } else {
      summary = `Agent failed: ${errorMessage(error)}`;
    }
    feedback = {problem: summary};
  }

  const agentStep: StepResult = {
    artifacts: agentOutput?.artifacts ?? [],
    failureKind: agentOutput?.failureKind,
    feedback,
    finishedAt: new Date().toISOString(),
    kind: 'agent',
    result: agentOutput?.result ?? null,
    runDir: agentRunDir,
    startedAt: startedAt.toISOString(),
    status,
    stepId,
    summary,
  };
  options.progress.finishStep(
    {detail: stepId, label: options.agent},
    agentStep,
  );
  await appendHarnessLogEvent(options.paths, options.state, {
    agent: options.agent,
    agentRunDir,
    kind: 'step_finished',
    status,
    stepId,
    summary,
  });

  const checks: HarnessCheckResult[] = [];
  if (status === 'success') {
    for (const check of options.definition.checks) {
      if (options.interruptState.interrupted) {
        status = 'failed';
        summary = `Check ${check.id} was interrupted and stopped.`;
        feedback = {problem: summary};
        break;
      }
      const result = await runCheck({
        attempt: options.attempt,
        check,
        paths: options.paths,
        processRegistry: options.processRegistry,
        progress: options.progress,
        projectCwd: options.request.projectCwd,
        state: options.state,
        interruptState: options.interruptState,
      });
      checks.push(result);
      if (options.interruptState.interrupted) {
        status = 'failed';
        summary = `Check ${check.id} was interrupted and stopped.`;
        feedback = {problem: summary};
        break;
      }
      if (result.status !== 'success') {
        status = result.status;
        summary = `Check ${check.id} failed.`;
        feedback = {
          problem: summary,
          evidence: [result.stderr, result.stdout].filter(
            value => value.trim().length > 0,
          ),
        };
        break;
      }
    }
  }

  return {
    agentRunDir,
    attempt: options.attempt,
    checks,
    failureKind: agentOutput?.failureKind,
    feedback,
    finishedAt: new Date().toISOString(),
    startedAt: startedAt.toISOString(),
    status,
    summary,
  };
}

async function runCheck(options: {
  attempt: number;
  check: HarnessCheckDefinition;
  paths: HarnessRunPaths;
  processRegistry: ProcessRegistry;
  progress: HarnessProgressRenderer;
  projectCwd: string;
  state: HarnessState;
  interruptState: {interrupted: boolean};
}): Promise<HarnessCheckResult> {
  const stepId = `attempt-${options.attempt}.check.${options.check.id}`;
  const startedAt = new Date();
  const command = commandArgv(options.check.command);
  await writeHarnessState(options.paths, options.state);
  options.progress.startStep({detail: stepId, label: options.check.id});
  await appendHarnessLogEvent(options.paths, options.state, {
    command: command.join(' '),
    kind: 'check_started',
    status: 'running',
    stepId,
    summary: `Running check ${options.check.id}.`,
  });

  const proc = Bun.spawn(command, {
    cwd: options.projectCwd,
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const untrack = options.processRegistry.track(proc);
  let exitCode: number | null;
  let stdout: string;
  let stderr: string;
  try {
    [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
  } finally {
    untrack();
  }

  const finishedAt = new Date();
  const interrupted = options.interruptState.interrupted;
  const status: HarnessStepStatus =
    !interrupted && exitCode === 0 ? 'success' : 'failed';
  const result: HarnessCheckResult = {
    command: command.join(' '),
    exitCode,
    finishedAt: finishedAt.toISOString(),
    id: options.check.id,
    startedAt: startedAt.toISOString(),
    status,
    stderr,
    stdout,
  };
  options.progress.finishStep(
    {detail: stepId, label: options.check.id},
    {
      status,
      summary: interrupted
        ? `Check ${options.check.id} was interrupted.`
        : status === 'success'
          ? `Check ${options.check.id} passed.`
          : `Check ${options.check.id} failed.`,
    },
  );
  await appendHarnessLogEvent(options.paths, options.state, {
    command: result.command,
    exitCode,
    kind: 'check_finished',
    status,
    stepId,
    summary: interrupted
      ? `Check ${options.check.id} was interrupted.`
      : status === 'success'
        ? `Check ${options.check.id} passed.`
        : `Check ${options.check.id} failed.`,
  });
  return result;
}

async function resolveHarness(
  projectCwd: string,
  name: string,
): Promise<HarnessDefinition> {
  const projectPath = join(projectCwd, '.agentq', 'harnesses', `${name}.yaml`);
  if (existsSync(projectPath)) {
    return readHarnessFile(projectPath);
  }

  const globalPath = join(agentqHome(), 'harnesses', `${name}.yaml`);
  if (existsSync(globalPath)) {
    return readHarnessFile(globalPath);
  }

  throw new AgentQError(
    `Could not find harness "${name}" in .agentq/harnesses or ${join(agentqHome(), 'harnesses')}.`,
  );
}

async function readHarnessFile(filePath: string): Promise<HarnessDefinition> {
  return readHarnessMarkdown(await readFile(filePath, 'utf8'), filePath);
}

function readHarnessMarkdown(
  yaml: string,
  filePath: string,
): HarnessDefinition {
  const data = parseHarnessYaml(yaml, filePath);
  const name = requireString(data.name, 'Harness name must be a string.');
  const retries = parseRetries(data.retries);
  const checks = parseChecks(data.checks);
  const inputs = parseInputs(data.inputs);
  const steps = parseSteps(data.steps);

  if (steps) {
    return {checks, filePath, inputs, name, retries, steps};
  }

  const agent = requireString(data.agent, 'Harness agent must be a string.');
  return {agent, checks, filePath, inputs, name, retries};
}

function parseHarnessYaml(
  yaml: string,
  filePath: string,
): Record<string, unknown> {
  try {
    const parsed = frontMatter<Record<string, unknown>>(`---\n${yaml}\n---\n`);
    assertAgentQ(
      parsed.attributes &&
        typeof parsed.attributes === 'object' &&
        !Array.isArray(parsed.attributes),
      'Harness definition must be a YAML object.',
    );
    return parsed.attributes;
  } catch (error) {
    if (error instanceof AgentQError) {
      throw error;
    }
    throw new AgentQError(
      `Harness file is not valid YAML: ${filePath}. ${errorMessage(error)}`,
    );
  }
}

function parseChecks(value: unknown): HarnessCheckDefinition[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new AgentQError('Harness checks must be an array.');
  }
  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new AgentQError(`Harness check ${index + 1} must be an object.`);
    }
    const id = requireString(item.id, `Harness check ${index + 1} needs id.`);
    const command = item.command;
    if (!isHarnessCommand(command)) {
      throw new AgentQError(
        `Harness check "${id}" command must be a string or string array.`,
      );
    }
    return {command, id};
  });
}

function parseSteps(value: unknown): HarnessStepDefinition[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new AgentQError('Harness steps must be an array.');
  }
  if (value.length === 0) {
    throw new AgentQError('Harness steps must include at least one step.');
  }
  return value.map((item, index) => parseStep(item, index + 1, false));
}

function parseStep(
  value: unknown,
  index: number,
  inLoop: boolean,
): HarnessStepDefinition {
  if (!isRecord(value)) {
    throw new AgentQError(`Harness step ${index} must be an object.`);
  }
  const id = requireString(value.id, `Harness step ${index} needs id.`);

  if (value.loop !== undefined) {
    if (inLoop) {
      throw new AgentQError(
        `Harness loop "${id}" cannot contain nested loops.`,
      );
    }
    if (!isRecord(value.loop)) {
      throw new AgentQError(`Harness loop "${id}" must be an object.`);
    }
    const retries = parseRetries(value.loop.retries);
    const over =
      value.loop.over === undefined
        ? undefined
        : requireString(
            value.loop.over,
            `Harness loop "${id}" over must be a string.`,
          );
    const rawSteps = value.loop.steps;
    if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
      throw new AgentQError(
        `Harness loop "${id}" steps must be a non-empty array.`,
      );
    }
    const steps = rawSteps.map((item, itemIndex) => {
      const step = parseStep(item, itemIndex + 1, true);
      if (step.kind === 'loop') {
        throw new AgentQError(
          `Harness loop "${id}" cannot contain nested loops.`,
        );
      }
      return step;
    }) as HarnessLoopBodyStepDefinition[];
    return {id, kind: 'loop', over, retries, steps};
  }

  if (value.agent !== undefined) {
    return {
      agent: requireString(
        value.agent,
        `Harness step "${id}" agent must be a string.`,
      ),
      id,
      kind: 'agent',
    };
  }

  if (value.command !== undefined) {
    if (!isHarnessCommand(value.command)) {
      throw new AgentQError(
        `Harness step "${id}" command must be a string or string array.`,
      );
    }
    return {command: value.command, id, kind: 'command'};
  }

  throw new AgentQError(
    `Harness step "${id}" must define agent, command, or loop.`,
  );
}

function parseRetries(value: unknown): number {
  if (value === undefined) {
    return 0;
  }
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 10
  ) {
    throw new AgentQError('Harness retries must be an integer from 0 to 10.');
  }
  return value;
}

function parseInputs(value: unknown): Record<string, HarnessInputType> {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw new AgentQError('Harness inputs must be an object.');
  }

  const inputs: Record<string, HarnessInputType> = {};
  for (const [key, inputType] of Object.entries(value)) {
    if (
      inputType !== 'string' &&
      inputType !== 'number' &&
      inputType !== 'boolean'
    ) {
      throw new AgentQError(
        `Harness input "${key}" must be string, number, or boolean.`,
      );
    }
    inputs[key] = inputType;
  }
  return inputs;
}

async function loadHarnessInputs(
  request: HarnessRunRequest,
): Promise<Record<string, unknown>> {
  if (request.inputFile && request.inputText !== undefined) {
    throw new AgentQError('Use either inputFile or inputText, not both.');
  }
  const fromFile = request.inputFile
    ? parseInputContent(
        await readInputFile(request.projectCwd, request.inputFile),
      )
    : {};
  const fromText =
    request.inputText === undefined ? {} : parseInputContent(request.inputText);
  return {...fromFile, ...fromText, ...(request.inputs ?? {})};
}

async function readInputFile(
  projectCwd: string,
  inputPath: string,
): Promise<string> {
  if (inputPath === '-') {
    return new Response(Bun.stdin.stream()).text();
  }
  return readFile(resolveInputPath(projectCwd, inputPath), 'utf8');
}

function parseInputContent(content: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(content) as unknown;
    return isRecord(parsed) ? parsed : {task: parsed};
  } catch {
    return {task: content};
  }
}

function validateHarnessInputs(
  definition: HarnessDefinition,
  inputs: Record<string, unknown>,
): void {
  for (const [key, type] of Object.entries(definition.inputs)) {
    if (typeof inputs[key] !== type) {
      throw new AgentQError(`Harness input "${key}" must be ${type}.`);
    }
  }
}

function taskFromInputs(
  inputs: Record<string, unknown>,
  attempt: number,
): string {
  return JSON.stringify({attempt, inputs}, null, 2);
}

function taskFromStepContext(options: {
  attempt: number;
  feedback: AgentFeedback | null;
  inputs: Record<string, unknown>;
  loopItem: unknown;
  stepResults: Record<string, StepResult>;
}): string {
  const steps: Record<string, unknown> = {};
  for (const [id, result] of Object.entries(options.stepResults)) {
    steps[id] = {
      feedback: result.feedback,
      result: result.result,
      status: result.status,
      summary: result.summary,
    };
  }
  return JSON.stringify(
    {
      attempt: options.attempt,
      feedback: options.feedback,
      inputs: options.inputs,
      loopItem: options.loopItem,
      steps,
    },
    null,
    2,
  );
}

function resolveLoopItems(
  loop: HarnessLoopStepDefinition,
  state: HarnessState,
): unknown[] {
  if (!loop.over) {
    return [null];
  }
  const template = loop.over.match(/^\{\{\s*([a-zA-Z0-9_-]+)\.([^}]+)\s*\}\}$/);
  if (!template) {
    throw new AgentQError(
      `Harness loop "${loop.id}" over must use {{step.path}} syntax.`,
    );
  }
  const [, stepId, rawPath] = template;
  const stepResult = state.stepResults?.[stepId];
  if (!stepResult) {
    throw new AgentQError(
      `Harness loop "${loop.id}" references unknown step "${stepId}".`,
    );
  }
  const value = readPath(stepResult.result, rawPath.trim());
  if (!Array.isArray(value)) {
    throw new AgentQError(
      `Harness loop "${loop.id}" over did not resolve to an array.`,
    );
  }
  return value;
}

function readPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (!isRecord(current)) {
      return undefined;
    }
    return current[part];
  }, value);
}

function loopStepId(
  loopId: string,
  itemIndex: number,
  attempt: number,
  stepId: string,
): string {
  return `${loopId}.item-${itemIndex + 1}.attempt-${attempt}.${stepId}`;
}

function isRetryableFailure(result: StepResult): boolean {
  if (result.status === 'blocked') {
    return false;
  }
  return result.failureKind !== 'plan' && result.failureKind !== 'blocked';
}

function parseAgentOutput(output: string, agent: string): AgentOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new AgentQError(`Agent "${agent}" returned invalid JSON.`);
  }
  if (!isRecord(parsed)) {
    throw new AgentQError(`Agent "${agent}" output must be an object.`);
  }

  const status = parsed.status;
  const summary = parsed.summary;
  if (!isHarnessStepStatus(status) || typeof summary !== 'string') {
    throw new AgentQError(
      `Agent "${agent}" output must include status and summary.`,
    );
  }
  return {
    artifacts: Array.isArray(parsed.artifacts)
      ? (parsed.artifacts as ArtifactRef[])
      : [],
    failureKind: isFailureKind(parsed.failureKind)
      ? parsed.failureKind
      : undefined,
    feedback: isRecord(parsed.feedback)
      ? (parsed.feedback as unknown as AgentFeedback)
      : null,
    result: parsed.result ?? null,
    status,
    summary,
  };
}

function agentStatusFromRun(status: string): HarnessStepStatus {
  return status === 'succeeded' ? 'success' : 'failed';
}

async function createHarnessRunPaths(name: string): Promise<HarnessRunPaths> {
  const runDir = join(
    agentqHome(),
    'harness-runs',
    `${sanitizePathPart(name)}-${shortId()}`,
  );
  await mkdir(runDir, {recursive: true});
  return {
    logPath: join(runDir, 'log.jsonl'),
    runDir,
    tasksPath: join(runDir, 'tasks.json'),
  };
}

function harnessRunPathsFromDir(runDir: string): HarnessRunPaths {
  return {
    logPath: join(runDir, 'log.jsonl'),
    runDir,
    tasksPath: join(runDir, 'tasks.json'),
  };
}

async function readHarnessState(paths: HarnessRunPaths): Promise<HarnessState> {
  if (!existsSync(paths.tasksPath)) {
    throw new AgentQError(`Harness run state not found: ${paths.tasksPath}`);
  }
  return JSON.parse(await readFile(paths.tasksPath, 'utf8')) as HarnessState;
}

function writeHarnessState(
  paths: HarnessRunPaths,
  state: HarnessState,
): Promise<void> {
  return writeFile(
    paths.tasksPath,
    `${JSON.stringify(state, null, 2)}\n`,
    'utf8',
  );
}

function appendHarnessLogEvent(
  paths: HarnessRunPaths,
  state: HarnessState,
  event: Omit<HarnessLogEvent, 'harnessName' | 'timestamp'>,
): Promise<void> {
  const record: HarnessLogEvent = {
    ...event,
    harnessName: state.harnessName,
    timestamp: new Date().toISOString(),
  };
  return appendFile(paths.logPath, `${JSON.stringify(record)}\n`, 'utf8');
}

async function isHarnessRunActive(paths: HarnessRunPaths): Promise<boolean> {
  if (!existsSync(paths.tasksPath)) {
    return false;
  }
  const state = JSON.parse(await readFile(paths.tasksPath, 'utf8')) as {
    status?: string;
  };
  return state.status === 'running';
}

async function listHarnessesInDirectory(
  directory: string,
  scope: HarnessListEntry['scope'],
): Promise<HarnessListEntry[]> {
  if (!existsSync(directory)) {
    return [];
  }
  const entries = await readdir(directory);
  const harnesses: HarnessListEntry[] = [];
  for (const entry of entries) {
    if (entry.endsWith('.yaml')) {
      harnesses.push({
        filePath: join(directory, entry),
        id: entry.slice(0, -'.yaml'.length),
        scope,
      });
    }
  }
  return harnesses;
}

function commandArgv(command: HarnessCommand): string[] {
  if (Array.isArray(command)) {
    return command;
  }
  if (platform() === 'win32') {
    return ['powershell.exe', '-NoProfile', '-Command', command];
  }
  return ['sh', '-c', command];
}

function matchesHarnessLogRequest(
  event: HarnessLogEvent,
  request: HarnessLogsRequest,
): boolean {
  if (request.step && !event.stepId.startsWith(request.step)) {
    return false;
  }
  if (request.failed && event.status !== 'failed') {
    return false;
  }
  return true;
}

function resolveInputPath(projectCwd: string, inputPath: string): string {
  return isAbsolute(inputPath) ? inputPath : resolve(projectCwd, inputPath);
}

function durationMs(startedAt: string, finishedAt: string | undefined): number {
  const started = Date.parse(startedAt);
  const finished = finishedAt ? Date.parse(finishedAt) : Date.now();
  if (Number.isNaN(started) || Number.isNaN(finished)) {
    return 0;
  }
  return Math.max(0, finished - started);
}

function latestAttemptStep(state: HarnessState): string | undefined {
  const attempt = state.attempts.at(-1);
  return attempt ? `attempt-${attempt.attempt}` : undefined;
}

function timestampLabel(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return '--:--:--';
  }
  return date.toISOString().slice(11, 19);
}

function formatFeedback(feedback: AgentFeedback): string {
  return [feedback.problem, feedback.fix].filter(Boolean).join(' ');
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AgentQError(message);
  }
  return value;
}

function isHarnessCommand(value: unknown): value is HarnessCommand {
  return (
    typeof value === 'string' ||
    (Array.isArray(value) && value.every(item => typeof item === 'string'))
  );
}

function isHarnessStepStatus(value: unknown): value is HarnessStepStatus {
  return value === 'success' || value === 'failed' || value === 'blocked';
}

function isFailureKind(value: unknown): value is FailureKind {
  return (
    value === 'implementation' ||
    value === 'check' ||
    value === 'review' ||
    value === 'plan' ||
    value === 'blocked' ||
    value === 'environment'
  );
}

function requireHarnessAgent(definition: HarnessDefinition): string {
  if (!definition.agent) {
    throw new AgentQError(
      `Harness "${definition.name}" must define agent for legacy execution.`,
    );
  }
  return definition.agent;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shortId(): string {
  return randomBytes(3).toString('hex');
}

function sanitizePathPart(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'harness'
  );
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
