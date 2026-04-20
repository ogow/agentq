import {Chalk, chalkStderr} from 'chalk';
import cliSpinners from 'cli-spinners';
import type {
  AgentQEvent,
  ChangedFileSummary,
  OutputFormat,
  LogLevel,
  RunStatus,
  Verbosity,
} from './types';
import type {RunMetadata} from './metadata';
import type {RunInspection} from './history';

type ChalkStyle = typeof chalkStderr;

interface RenderStream {
  isTTY?: boolean;
  write: (chunk: string) => unknown;
}

export interface ProgressRenderer {
  onEvent: (event: AgentQEvent) => void;
  stop: () => void;
}

export interface HarnessProgressStep {
  activity?: string;
  detail?: string;
  label: string;
}

export interface HarnessProgressResult {
  agentRunDir?: string;
  command?: string;
  exitCode?: number | null;
  durable?: boolean;
  durationMs?: number;
  stderrTail?: string;
  stdoutTail?: string;
  status: 'success' | 'failed' | 'blocked';
  summary?: string;
  result?: unknown;
  step?: HarnessProgressStep;
}

export interface HarnessProgressRenderer {
  finishTask: (task: HarnessTaskContext, result: HarnessProgressResult) => void;
  finishStep: (
    step: HarnessProgressStep,
    result: HarnessProgressResult,
  ) => void;
  onEvent: (event: AgentQEvent) => void;
  startTask: (task: HarnessTaskContext) => void;
  startStep: (step: HarnessProgressStep) => void;
  stop: (result?: {
    durationMs?: number;
    status?: string;
    summary?: string;
    step?: HarnessProgressStep;
  }) => void;
}

interface RenderOptions {
  color?: boolean;
  details?: boolean;
}

interface ProgressOptions extends RenderOptions {
  agentId: string;
  format?: OutputFormat;
  logLevel?: LogLevel;
  progress?: boolean;
  stream?: RenderStream;
  verbosity?: Verbosity;
  verbose?: boolean;
}

interface HarnessProgressOptions extends RenderOptions {
  format?: OutputFormat;
  harnessName?: string;
  logLevel?: LogLevel;
  runDir?: string;
  runId?: string;
  stream?: RenderStream;
  verbosity?: Verbosity;
  verbose?: boolean;
}

interface StructuredLogContext {
  agentId?: string;
  source: 'agent' | 'harness';
  step?: HarnessProgressStep;
}

interface HarnessTaskContext {
  attempt?: number;
  detail?: string;
  index: number;
  label: string;
  maxAttempts?: number;
  summary?: string;
  total: number;
}

export function createProgressRenderer({
  agentId,
  color,
  format,
  logLevel,
  progress = true,
  stream,
  verbosity,
  verbose,
}: ProgressOptions): ProgressRenderer {
  const style = createStyle(color);
  const mode = resolveOutputMode({format, logLevel, verbosity, verbose});
  const outputStream =
    stream ?? (mode.format === 'jsonl' ? process.stdout : process.stderr);

  if (!progress) {
    return noopProgressRenderer();
  }

  if (mode.format === 'jsonl') {
    return {
      onEvent: event => {
        if (!shouldEmitAgentJsonlEvent(event, mode.verbosity)) {
          return;
        }
        outputStream.write(
          `${formatStructuredLogEvent(event, {agentId, source: 'agent'})}\n`,
        );
      },
      stop: () => undefined,
    };
  }

  if (mode.verbosity === 1) {
    return {
      onEvent: event => {
        const line = formatMessageLogEvent(event, {color});
        if (line) {
          outputStream.write(`${line}\n`);
        }
      },
      stop: () => undefined,
    };
  }

  if (mode.verbosity === 2) {
    return {
      onEvent: event => {
        const line = formatTimelineEvent(event, {color});
        if (line) {
          outputStream.write(`${line}\n`);
        }
      },
      stop: () => undefined,
    };
  }

  if (!outputStream.isTTY) {
    return {
      onEvent: () => undefined,
      stop: () => undefined,
    };
  }

  const spinner = cliSpinners.dots;
  const frames = spinner.frames;
  let index = 0;
  let detail = 'starting';
  let tokenSummary: string | undefined;
  let lastPlainLength = 0;
  const prefix = `AgentQ ${agentId}`;

  const clearLine = () => {
    if (lastPlainLength > 0) {
      outputStream.write('\r\x1b[2K');
      lastPlainLength = 0;
    }
  };

  const render = () => {
    const plain = `${prefix} ${frames[index]} ${detail}`;
    const line = [
      style.magenta.bold('AgentQ'),
      style.dim(agentId),
      style.cyan(frames[index]),
      style.white(detail),
    ].join(' ');
    outputStream.write(`\r\x1b[2K${line}`);
    lastPlainLength = plain.length;
  };

  render();
  const interval = setInterval(() => {
    index = (index + 1) % frames.length;
    render();
  }, spinner.interval);

  return {
    onEvent: event => {
      const eventDetail = formatProgressDetail(event);
      if (mode.verbosity >= 1 && event.kind === 'token_usage' && eventDetail) {
        tokenSummary = eventDetail;
      }
      if (
        event.kind !== 'assistant_message' &&
        event.kind !== 'token_usage' &&
        eventDetail
      ) {
        detail = eventDetail;
      }
      render();
    },
    stop: () => {
      clearInterval(interval);
      clearLine();
      if (mode.verbosity >= 1 && tokenSummary) {
        outputStream.write(
          `${style.dim('agent')} ${agentId}  ${tokenSummary}\n`,
        );
      }
    },
  };
}

export function createHarnessProgressRenderer({
  color,
  format,
  harnessName,
  logLevel,
  runDir,
  runId,
  stream,
  verbosity,
  verbose,
}: HarnessProgressOptions = {}): HarnessProgressRenderer {
  const style = createStyle(color);
  const mode = resolveOutputMode({format, logLevel, verbosity, verbose});
  const outputStream =
    stream ?? (mode.format === 'jsonl' ? process.stdout : process.stderr);
  const harnessTitle = [harnessName, runId].filter(Boolean).join(' ');
  const harnessPath = runDir ? style.dim(runDir) : undefined;

  if (mode.format === 'jsonl') {
    let currentTask: HarnessTaskContext | undefined;
    let currentStep: HarnessProgressStep | undefined;
    outputStream.write(
      `${JSON.stringify(
        formatHarnessJsonlEvent(
          'harness.started',
          {
            harnessName,
            runDir,
            runId,
          },
          mode.verbosity,
        ),
      )}\n`,
    );
    return {
      finishTask: (task, result) => {
        outputStream.write(
          `${JSON.stringify(
            formatHarnessJsonlEvent(
              'task.finished',
              {
                harnessName,
                result,
                runDir,
                runId,
                step: currentStep ?? result.step,
                task,
              },
              mode.verbosity,
            ),
          )}\n`,
        );
        currentTask = undefined;
      },
      finishStep: (step, result) => {
        if (
          mode.verbosity >= 1 ||
          (!currentTask && result.status !== 'success')
        ) {
          outputStream.write(
            `${JSON.stringify(
              formatHarnessJsonlEvent(
                'step.finished',
                {
                  harnessName,
                  result,
                  runDir,
                  runId,
                  step,
                  task: currentTask,
                },
                mode.verbosity,
              ),
            )}\n`,
          );
        }
        currentStep = undefined;
      },
      onEvent: event => {
        if (!shouldEmitHarnessJsonlEvent(event, mode.verbosity)) {
          return;
        }
        outputStream.write(
          `${JSON.stringify(
            formatHarnessJsonlEvent(
              'event',
              {
                event,
                harnessName,
                runDir,
                runId,
                step: currentStep,
                task: currentTask,
              },
              mode.verbosity,
            ),
          )}\n`,
        );
      },
      startTask: task => {
        currentTask = task;
        outputStream.write(
          `${JSON.stringify(
            formatHarnessJsonlEvent(
              'task.started',
              {
                harnessName,
                runDir,
                runId,
                task,
              },
              mode.verbosity,
            ),
          )}\n`,
        );
      },
      startStep: step => {
        currentStep = step;
        if (mode.verbosity >= 1) {
          outputStream.write(
            `${JSON.stringify(
              formatHarnessJsonlEvent(
                'step.started',
                {
                  harnessName,
                  runDir,
                  runId,
                  step,
                  task: currentTask,
                },
                mode.verbosity,
              ),
            )}\n`,
          );
        }
      },
      stop: result => {
        if (!result) {
          return;
        }
        outputStream.write(
          `${JSON.stringify(
            formatHarnessJsonlEvent(
              'harness.finished',
              {
                harnessName,
                result,
                runDir,
                runId,
                step: currentStep ?? result.step,
              },
              mode.verbosity,
            ),
          )}\n`,
        );
      },
    };
  }

  if (mode.verbosity >= 1) {
    let currentTokenSummary: string | undefined;
    let currentTask: HarnessTaskContext | undefined;
    let currentStep: HarnessProgressStep | undefined;
    let printedRunHeader = false;
    const renderRunHeader = () => {
      if (printedRunHeader || !runId) {
        return;
      }
      printedRunHeader = true;
      outputStream.write(`${style.bold(runId)}\n`);
    };
    return {
      finishTask: (task, result) => {
        const finishedStep = currentStep;
        const tokenSummary =
          mode.verbosity >= 1 ? currentTokenSummary : undefined;
        currentTask = undefined;
        currentStep = undefined;
        currentTokenSummary = undefined;
        outputStream.write(
          `${formatHarnessCompletionLine(task, result, style, {
            tokenSummary,
          })}\n`,
        );
        if (result.status !== 'success') {
          outputStream.write(
            `${formatHarnessFailureBlock(task, result, style, {
              harnessPath,
              harnessTitle,
              step: finishedStep,
              verbosity: mode.verbosity,
            })}\n`,
          );
        }
      },
      finishStep: (step, result) => {
        const tokenSummary =
          mode.verbosity >= 1 ? currentTokenSummary : undefined;
        currentStep = undefined;
        currentTokenSummary = undefined;
        outputStream.write(
          `${formatHarnessStepLine(step, result, style, {
            compactStep: mode.verbosity === 1,
            tokenSummary,
          })}\n`,
        );
        if (
          result.status !== 'success' &&
          (mode.verbosity >= 2 || !currentTask)
        ) {
          outputStream.write(
            `${formatHarnessFailureBlock(undefined, result, style, {
              harnessPath,
              harnessTitle,
              step,
              verbosity: mode.verbosity,
            })}\n`,
          );
        }
      },
      onEvent: event => {
        const line = formatHarnessVerboseEvent(event, {
          color,
          step: currentStep,
          verbosity: mode.verbosity,
        });
        if (line) {
          outputStream.write(`${line}\n`);
          return;
        }
        if (mode.verbosity >= 1 && event.kind === 'token_usage') {
          currentTokenSummary = formatTokenUsageSummary(event.tokenUsage, {
            compact: true,
          });
          return;
        }
      },
      startTask: task => {
        renderRunHeader();
        currentTask = task;
        currentTokenSummary = undefined;
        outputStream.write(`${formatHarnessStartLine(task, style)}\n`);
      },
      startStep: step => {
        renderRunHeader();
        currentStep = step;
        currentTokenSummary = undefined;
        outputStream.write(
          `${formatHarnessStepStartLine(step, style, {
            compactStep: mode.verbosity === 1,
          })}\n`,
        );
      },
      stop: () => undefined,
    };
  }

  if (!outputStream.isTTY) {
    let currentTask: HarnessTaskContext | undefined;
    let currentStep: HarnessProgressStep | undefined;
    return {
      finishTask: (task, result) => {
        const finishedStep = result.step ?? currentStep;
        currentTask = undefined;
        currentStep = undefined;
        outputStream.write(
          `${formatHarnessCompletionLine(task, result, style)}\n`,
        );
        if (result.status !== 'success') {
          outputStream.write(
            `${formatHarnessFailureBlock(task, result, style, {
              harnessPath,
              harnessTitle,
              step: finishedStep,
              verbosity: mode.verbosity,
            })}\n`,
          );
        }
      },
      finishStep: (step, result) => {
        currentStep = step;
        if (result.status !== 'success' && !currentTask) {
          outputStream.write(
            `${formatHarnessFailureBlock(undefined, result, style, {
              harnessPath,
              harnessTitle,
              step,
              verbosity: mode.verbosity,
            })}\n`,
          );
          return;
        }
        if (result.status !== 'success' && result.durable === false) {
          return;
        }
        currentStep = undefined;
      },
      onEvent: () => undefined,
      startTask: task => {
        currentTask = task;
        currentStep = undefined;
      },
      startStep: step => {
        currentStep = step;
      },
      stop: () => undefined,
    };
  }

  const spinner = cliSpinners.dots;
  const frames = spinner.frames;
  let currentTask: HarnessTaskContext | undefined;
  let currentStep: HarnessProgressStep | undefined;
  let currentAssistantActivity: string | undefined;
  let currentFallbackActivity: string | undefined;
  let currentRetryActivity: string | undefined;
  let index = 0;
  let lastPlainLength = 0;
  const interval = setInterval(() => {
    index = (index + 1) % frames.length;
    render();
  }, spinner.interval);

  const clearLine = () => {
    if (lastPlainLength > 0) {
      outputStream.write('\r\x1b[2K');
      lastPlainLength = 0;
    }
  };

  const render = () => {
    if (!currentTask) {
      return;
    }

    const line = formatHarnessActiveLine(
      runId ?? harnessName ?? 'harness',
      currentTask,
      currentStep,
      resolveHarnessLiveActivity({
        assistantActivity: currentAssistantActivity,
        fallbackActivity: currentFallbackActivity,
        retryActivity: currentRetryActivity,
      }),
      frames[index],
      style,
    );
    outputStream.write(`\r\x1b[2K${line}`);
    lastPlainLength = plainLength(line);
  };

  return {
    finishTask: (task, result) => {
      const finishedStep = result.step ?? currentStep;
      clearLine();
      currentTask = undefined;
      currentStep = undefined;
      currentAssistantActivity = undefined;
      currentFallbackActivity = undefined;
      currentRetryActivity = undefined;
      outputStream.write(
        `${formatHarnessCompletionLine(task, result, style)}\n`,
      );
      if (result.status !== 'success') {
        outputStream.write(
          `${formatHarnessFailureBlock(task, result, style, {
            harnessPath,
            harnessTitle,
            step: finishedStep,
          })}\n`,
        );
      }
    },
    finishStep: (step, result) => {
      clearLine();
      if (result.status !== 'success' && !currentTask) {
        outputStream.write(
          `${formatHarnessFailureBlock(undefined, result, style, {
            harnessPath,
            harnessTitle,
            step,
          })}\n`,
        );
        return;
      }
      if (result.status !== 'success' && result.durable === false) {
        currentRetryActivity = 'retrying';
        render();
        return;
      }
      currentStep = undefined;
      currentAssistantActivity = undefined;
      currentFallbackActivity = undefined;
      currentRetryActivity = undefined;
      if (result.status !== 'success' || mode.verbosity >= 2) {
        outputStream.write(
          `${formatHarnessStepLine(step, result, style, {
            compactStep: true,
          })}\n`,
        );
      }
      render();
    },
    onEvent: event => {
      if (mode.verbosity >= 1) {
        const line = formatHarnessVerboseEvent(event, {
          color,
          step: currentStep,
          verbosity: mode.verbosity,
        });
        if (line) {
          clearLine();
          outputStream.write(`${line}\n`);
          render();
          return;
        }
      }
      if (event.kind === 'assistant_message') {
        currentAssistantActivity = formatAssistantMessagePreview(event, 80);
        currentRetryActivity = undefined;
      } else if (event.kind === 'tool_started') {
        currentFallbackActivity ??= 'working';
      } else if (event.kind === 'tool_finished') {
        currentRetryActivity =
          event.status === 'failed' ? 'retrying' : undefined;
      }
      render();
    },
    startTask: task => {
      currentTask = task;
      currentStep = undefined;
      currentAssistantActivity = undefined;
      currentFallbackActivity = undefined;
      currentRetryActivity = undefined;
      index = 0;
      render();
    },
    startStep: step => {
      currentStep = step;
      currentAssistantActivity = undefined;
      currentFallbackActivity = 'working';
      currentRetryActivity = undefined;
      if (mode.verbosity >= 1) {
        clearLine();
        outputStream.write(
          `${formatHarnessStepStartLine(step, style, {compactStep: true})}\n`,
        );
        render();
      } else {
        render();
      }
    },
    stop: () => {
      if (interval) {
        clearInterval(interval);
      }
      clearLine();
    },
  };
}

export function formatTimelineEvent(
  event: AgentQEvent,
  options: RenderOptions = {},
): string | undefined {
  const style = createStyle(options.color);
  const label = eventLabel(event);
  const detail = formatVerboseProgressDetail(event);

  if (!label || !detail) {
    return undefined;
  }

  return [
    style.dim(timestampLabel(event.timestamp)),
    colorLabel(label, event.kind, style),
    detail,
  ].join('  ');
}

export function formatStructuredLogEvent(
  event: AgentQEvent,
  context: StructuredLogContext,
): string {
  return JSON.stringify({
    agentId: context.agentId,
    callId: event.callId,
    command: event.command,
    detail: context.step?.detail,
    exitCode: event.exitCode,
    files: event.files,
    kind: event.kind,
    label: context.step?.label,
    message: event.message,
    phase: event.phase,
    provider: event.provider,
    rawType: event.rawType,
    source: context.source,
    status: event.status,
    timestamp: event.timestamp,
    tokenUsage: event.tokenUsage,
    toolName: event.toolName,
  });
}

function resolveOutputMode(options: {
  format?: OutputFormat;
  logLevel?: LogLevel;
  verbosity?: Verbosity;
  verbose?: boolean | number;
}): {format: OutputFormat; verbosity: Verbosity} {
  const verbosity = normalizeVerbosity(
    options.verbosity ??
      (typeof options.verbose === 'number'
        ? options.verbose
        : options.verbose
          ? 1
          : undefined),
  );
  if (options.format) {
    return {format: options.format, verbosity};
  }

  if (options.logLevel === 'json' || options.logLevel === 'json-messages') {
    return {
      format: 'jsonl',
      verbosity:
        options.logLevel === 'json-messages'
          ? normalizeVerbosity(Math.max(verbosity, 1))
          : verbosity,
    };
  }
  if (options.logLevel === 'messages') {
    return {
      format: 'human',
      verbosity: normalizeVerbosity(Math.max(verbosity, 1)),
    };
  }
  if (options.logLevel === 'verbose') {
    return {format: 'human', verbosity: 2};
  }
  return {
    format: 'human',
    verbosity,
  };
}

function normalizeVerbosity(value: unknown): Verbosity {
  if (value === 2 || value === '2') {
    return 2;
  }
  if (value === 1 || value === '1' || value === true) {
    return 1;
  }
  return 0;
}

function shouldEmitAgentJsonlEvent(
  event: AgentQEvent,
  verbosity: Verbosity,
): boolean {
  if (verbosity >= 2) {
    return true;
  }
  if (event.kind === 'run_started' || event.kind === 'run_completed') {
    return true;
  }
  if (event.kind === 'failure') {
    return true;
  }
  if (event.kind === 'assistant_message' || event.kind === 'token_usage') {
    return verbosity >= 1;
  }
  if (event.kind === 'tool_started') {
    return verbosity >= 2;
  }
  if (event.kind === 'tool_finished') {
    return verbosity >= 2;
  }
  return false;
}

function shouldEmitHarnessJsonlEvent(
  event: AgentQEvent,
  verbosity: Verbosity,
): boolean {
  if (verbosity >= 2) {
    return true;
  }
  if (
    (event.kind === 'run_started' || event.kind === 'run_completed') &&
    verbosity >= 1
  ) {
    return true;
  }
  if (event.kind === 'failure') {
    return verbosity >= 1;
  }
  if (event.kind === 'assistant_message' || event.kind === 'token_usage') {
    return verbosity >= 1;
  }
  if (event.kind === 'tool_started') {
    return verbosity >= 2;
  }
  if (event.kind === 'tool_finished') {
    return verbosity >= 2;
  }
  return false;
}

function formatHarnessJsonlEvent(
  type:
    | 'harness.started'
    | 'event'
    | 'harness.finished'
    | 'step.finished'
    | 'step.started'
    | 'task.finished'
    | 'task.started',
  context: {
    event?: AgentQEvent;
    harnessName?: string;
    result?: {
      agentRunDir?: string;
      command?: string;
      durationMs?: number;
      exitCode?: number | null;
      stderrTail?: string;
      status?: string;
      stdoutTail?: string;
      summary?: string;
      step?: HarnessProgressStep;
    };
    runDir?: string;
    runId?: string;
    step?: HarnessProgressStep;
    task?: HarnessTaskContext;
  },
  verbosity: Verbosity,
): Record<string, unknown> {
  if (type === 'event') {
    const event = context.event;
    return {
      callId: verbosity >= 2 ? event?.callId : undefined,
      command: verbosity >= 2 ? event?.command : undefined,
      detail: context.step?.detail,
      exitCode: verbosity >= 2 ? event?.exitCode : undefined,
      files: verbosity >= 2 ? event?.files : undefined,
      label: context.step?.label,
      message: event?.message,
      phase: event?.phase,
      status: event?.status,
      step: context.step?.label,
      task: context.task?.summary ?? context.task?.detail,
      rawType: verbosity >= 2 ? event?.rawType : undefined,
      timestamp: event?.timestamp,
      tokenUsage: event?.tokenUsage,
      toolName: event?.toolName,
      type: event?.kind ?? 'unknown',
    };
  }

  const result = context.result;
  const includeDiagnostics = verbosity >= 2;
  const step = context.step ?? result?.step;
  const summary =
    result?.status === 'success'
      ? (context.task?.summary ?? result?.summary)
      : (result?.summary ?? context.task?.summary);
  return {
    agentRunDir: includeDiagnostics ? result?.agentRunDir : undefined,
    harness: context.harnessName,
    durationMs: context.result?.durationMs,
    command: includeDiagnostics ? result?.command : undefined,
    exitCode: includeDiagnostics ? result?.exitCode : undefined,
    runDir: context.runDir,
    runId: context.runId,
    status: context.result?.status,
    summary,
    step: step?.label,
    stderrTail: includeDiagnostics ? result?.stderrTail : undefined,
    stdoutTail: includeDiagnostics ? result?.stdoutTail : undefined,
    task: context.task
      ? {
          attempt: context.task.attempt,
          detail: context.task.detail,
          index: context.task.index,
          label: context.task.label,
          retryIndex: context.task.attempt,
          retryTotal: context.task.maxAttempts,
          maxAttempts: context.task.maxAttempts,
          summary: context.task.summary,
          total: context.task.total,
        }
      : undefined,
    type,
  };
}

function formatHarnessStartLine(
  task: HarnessTaskContext,
  style: ChalkStyle,
): string {
  const parts = [
    style.bold(taskLabel(task)),
    style.dim(retryLabel(task)),
    task.summary ? style.white(task.summary) : '',
  ].filter(Boolean);
  return parts.length > 0
    ? `${style.dim('▸')} ${parts.join('  ')}`
    : style.dim('▸');
}

function formatHarnessCompletionLine(
  task: HarnessTaskContext,
  result: HarnessProgressResult,
  style: ChalkStyle,
  options: {tokenSummary?: string} = {},
): string {
  const summary = compact(
    task.summary ?? result.summary ?? task.detail ?? '',
    120,
  );
  const suffix = summary ? ` ${summary}` : '';
  const tokenSuffix = options.tokenSummary ? ` · ${options.tokenSummary}` : '';
  return [
    statusGlyph(result.status, style),
    style.white(taskLabel(task)),
    style.dim(result.status),
    style.dim(retryLabel(task)),
    suffix ? style.white(suffix) : '',
    tokenSuffix ? style.dim(tokenSuffix) : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function formatHarnessFailureBlock(
  task: HarnessTaskContext | undefined,
  result: HarnessProgressResult,
  style: ChalkStyle,
  options: {
    harnessPath?: string;
    harnessTitle?: string;
    step?: HarnessProgressStep;
    verbosity?: Verbosity;
  } = {},
): string {
  const lines = [style.bold('Failure')];
  const includeDiagnostics = (options.verbosity ?? 0) >= 2;
  const stepText = options.step
    ? includeDiagnostics
      ? stepLabel(options.step)
      : options.step.label
    : includeDiagnostics
      ? (result.step?.detail ?? task?.detail)
      : humanizeStepId(result.step?.detail ?? task?.detail);
  if (!task && stepText) {
    lines.push(`  step: ${stepText}`);
  }
  if (options.step?.label ?? result.step?.label) {
    lines.push(`  agent: ${options.step?.label ?? result.step?.label}`);
  }
  if (task) {
    lines.push(`  retry: ${retryProgress(task)}`);
  }
  if (result.summary) {
    lines.push(`  reason: ${result.summary}`);
  }
  if (includeDiagnostics && result.command) {
    lines.push(`  command: ${compact(result.command, 120)}`);
  }
  if (includeDiagnostics && result.exitCode !== undefined) {
    lines.push(`  exit: ${String(result.exitCode)}`);
  }
  if (options.harnessPath) {
    lines.push(`  run: ${options.harnessPath}`);
  }
  if (includeDiagnostics && result.stderrTail) {
    lines.push(`  stderr: ${compact(result.stderrTail, 120)}`);
  }
  if (includeDiagnostics && result.stdoutTail) {
    lines.push(`  stdout: ${compact(result.stdoutTail, 120)}`);
  }
  return lines.join('\n');
}

function formatHarnessStepStartLine(
  step: HarnessProgressStep,
  style: ChalkStyle,
  options: {compactStep?: boolean} = {},
): string {
  const primary = options.compactStep ? stepName(step) : step.label;
  const secondary = options.compactStep ? step.label : step.detail;
  const parts = [
    style.white(primary),
    secondary ? style.dim(secondary) : '',
  ].filter(Boolean);
  return parts.length > 0
    ? `${style.dim('▸')} ${parts.join('  ')}`
    : style.dim('▸');
}

function formatHarnessStepLine(
  step: HarnessProgressStep,
  result: HarnessProgressResult,
  style: ChalkStyle,
  options: {compactStep?: boolean; tokenSummary?: string} = {},
): string {
  const primary = options.compactStep ? stepName(step) : step.label;
  const secondary = options.compactStep ? step.label : step.detail;
  const summary =
    (result.status === 'success'
      ? formatHarnessOutputSummary(result.result)
      : undefined) ??
    result.summary ??
    step.detail ??
    step.label;
  const tokenSuffix = options.tokenSummary ? ` · ${options.tokenSummary}` : '';
  const parts = [
    style.white(primary),
    secondary ? style.dim(secondary) : '',
    summary ? style.white(summary) : '',
    tokenSuffix ? style.dim(tokenSuffix) : '',
  ].filter(Boolean);
  return parts.length > 0
    ? `${statusGlyph(result.status, style)} ${parts.join('  ')}`
    : statusGlyph(result.status, style);
}

function formatHarnessVerboseEvent(
  event: AgentQEvent,
  options: {
    color?: boolean;
    step?: HarnessProgressStep;
    verbosity: Verbosity;
  },
): string | undefined {
  if (event.kind === 'assistant_message') {
    if (looksLikeAgentOutput(event.message)) {
      return undefined;
    }

    if (options.verbosity >= 2) {
      const prefix = options.step
        ? `agent ${
            options.verbosity >= 2
              ? stepLabel(options.step)
              : options.step.label
          }`
        : 'agent';
      return formatMessageLogEvent(event, {color: options.color, prefix});
    }

    return formatHarnessTraceLine(event, {color: options.color});
  }

  if (options.verbosity < 2) {
    return undefined;
  }

  const line = formatTimelineEvent(event, {color: options.color});
  if (!line) {
    return undefined;
  }

  return options.step
    ? `${stylePrefix(options.color, options.step)} ${line}`
    : line;
}

function formatHarnessTraceLine(
  event: AgentQEvent,
  options: RenderOptions = {},
): string | undefined {
  const message = formatAssistantMessagePreview(event, 120);
  if (!message) {
    return undefined;
  }

  const style = createStyle(options.color);
  return [style.dim('  trace'), style.dim(compact(message, 120))]
    .filter(Boolean)
    .join('  ');
}

function formatHarnessActiveLine(
  runId: string,
  task: HarnessTaskContext,
  step: HarnessProgressStep | undefined,
  activity: string | undefined,
  frame: string,
  style: ChalkStyle,
): string {
  const agent = step?.label ?? 'waiting';
  const activityText = activity ? compact(activity, 80) : 'running';
  const head = [
    style.cyan(frame),
    style.bold(runId),
    style.dim(taskLabel(task)),
    style.dim(retryLabel(task)),
  ]
    .filter(Boolean)
    .join(' ');
  return [head, style.white(agent), style.dim(activityText)]
    .filter(Boolean)
    .join('  ');
}

function resolveHarnessLiveActivity(state: {
  assistantActivity?: string;
  fallbackActivity?: string;
  retryActivity?: string;
}): string | undefined {
  return (
    state.retryActivity ??
    state.assistantActivity ??
    state.fallbackActivity ??
    'working'
  );
}

function taskLabel(task: HarnessTaskContext): string {
  return `task ${task.index}/${task.total}`;
}

function retryLabel(task: HarnessTaskContext): string {
  return `retry ${retryProgress(task)}`;
}

function retryProgress(task: HarnessTaskContext): string {
  return `${task.attempt ?? 1}/${task.maxAttempts ?? 1}`;
}

function stepLabel(step: HarnessProgressStep): string {
  return step.detail ?? step.label;
}

function humanizeStepId(stepId: string | undefined): string | undefined {
  if (!stepId) {
    return undefined;
  }

  return stepId
    .split('.')
    .filter(part => !/^attempt-\d+$/.test(part))
    .join('.');
}

function stepName(step: HarnessProgressStep): string {
  return (
    compact(step.detail ?? step.label, 64)
      .split('.')
      .at(-1) ?? step.label
  );
}

function stylePrefix(
  color: boolean | undefined,
  step: HarnessProgressStep,
): string {
  const style = createStyle(color);
  return `${style.dim('agent')} ${style.dim(stepLabel(step))}`;
}

function plainLength(value: string): number {
  return value.length;
}

export function formatRunSummary(
  metadata: RunMetadata,
  output: string,
  options: RenderOptions = {},
): string {
  if (!options.details) {
    return formatCompactRunSummary(metadata, output, options);
  }

  return formatDetailedRunSummary(metadata, output, options);
}

export function formatRunInspection(
  inspection: RunInspection,
  options: RenderOptions = {},
): string {
  const style = createStyle(options.color);
  const metadata = inspection.metadata;
  const rows = [
    row('agent id', metadata.agent.id),
    row('status', statusText(metadata.status, style)),
    row('duration', formatDuration(metadata.durationMs)),
    row('model', metadata.config.model),
    row('reasoning', metadata.config.reasoning),
    row('sandbox', metadata.config.sandbox),
    ...(metadata.config.approval
      ? [row('approval', metadata.config.approval)]
      : []),
    row('run dir', inspection.runDir),
    row('tools', summarizeTools(metadata.toolUsage)),
    row('edits', summarizeFiles(metadata.changedFiles)),
  ];
  const sections = [
    box('Run Inspection', rows, style),
    formatChangedFiles(metadata.changedFiles, style),
    formatInspectionFailure(metadata, style),
    formatInspectionOutput(inspection.output, style),
  ].filter(section => section.length > 0);

  return sections.join('\n\n');
}

export function formatRunHistoryTable(
  runs: RunMetadata[],
  options: RenderOptions & {limit?: number; since?: string} = {},
): string {
  const style = createStyle(options.color);

  if (runs.length === 0) {
    const suffix = options.since ? ` in the last ${options.since}` : '';
    return style.yellow(`No runs found${suffix}.`);
  }

  const rows = runs.map(metadata => ({
    agent: metadata.agent.id,
    duration: formatDuration(metadata.durationMs),
    model: `${metadata.config.model} / ${metadata.config.reasoning}`,
    run: runDirName(metadata.paths.runDir),
    started: formatStartedAt(metadata.startedAt),
    status: metadata.status,
    task: compact(metadata.task, 44),
  }));
  const columns = [
    column(
      'Started',
      rows.map(row => row.started),
      17,
    ),
    column(
      'Status',
      rows.map(row => row.status),
      9,
    ),
    column(
      'Agent',
      rows.map(row => row.agent),
      16,
    ),
    column(
      'Duration',
      rows.map(row => row.duration),
      10,
    ),
    column(
      'Model',
      rows.map(row => row.model),
      24,
    ),
    column(
      'Task',
      rows.map(row => row.task),
      44,
    ),
    column(
      'Run',
      rows.map(row => row.run),
      24,
    ),
  ];
  const border = tableBorder(columns);
  const header = tableRow(
    columns.map(item => style.bold(pad(item.header, item.width))),
  );
  const body = rows.map(item =>
    tableRow([
      pad(item.started, columns[0].width),
      statusHistoryText(item.status, style)(pad(item.status, columns[1].width)),
      pad(item.agent, columns[2].width),
      pad(item.duration, columns[3].width),
      pad(compact(item.model, columns[4].width), columns[4].width),
      pad(item.task, columns[5].width),
      style.dim(pad(item.run, columns[6].width)),
    ]),
  );
  const summary = [
    style.bold('AgentQ Runs'),
    `${runs.length} ${runs.length === 1 ? 'run' : 'runs'} shown`,
    options.since ? `since: ${options.since}` : '',
    options.limit ? `limit: ${options.limit}` : '',
  ].filter(Boolean);

  return [
    summary.join('\n'),
    style.magenta.bold(border),
    header,
    style.magenta.bold(border),
    ...body,
    style.magenta.bold(border),
  ].join('\n');
}

function formatCompactRunSummary(
  metadata: RunMetadata,
  output: string,
  options: RenderOptions,
): string {
  const style = createStyle(options.color);
  const lines = [
    compactTitle(metadata, style),
    `run: ${style.dim(metadata.paths.runDir)}`,
    `tools: ${summarizeTools(metadata.toolUsage)}`,
    `edits: ${summarizeFiles(metadata.changedFiles)}`,
    formatTokenUsageSummary(metadata.tokenUsage, {compact: true}),
  ];

  const sections = [
    lines.join('\n'),
    formatChangedFiles(metadata.changedFiles, style),
    formatFailure(metadata, style),
    formatOutput(output, style),
  ].filter(section => section.length > 0);

  return sections.join('\n\n');
}

function formatDetailedRunSummary(
  metadata: RunMetadata,
  output: string,
  options: RenderOptions,
): string {
  const style = createStyle(options.color);
  const title =
    metadata.status === 'succeeded'
      ? 'AgentQ Run Complete'
      : metadata.status === 'timed_out'
        ? 'AgentQ Run Timed Out'
        : 'AgentQ Run Failed';
  const runName = runDirName(metadata.paths.runDir);
  const toolTotals = summarizeTools(metadata.toolUsage);
  const editTotals = summarizeFiles(metadata.changedFiles);
  const rows = [
    row('agent', metadata.agent.id),
    row('result', statusText(metadata.status, style)),
    row('model', `${metadata.config.model} / ${metadata.config.reasoning}`),
    row('output', metadata.config.resultMode),
    row('duration', formatDuration(metadata.durationMs)),
    row('tools', toolTotals),
    row('edits', editTotals),
    row('events', String(metadata.eventCount)),
    row(
      'tokens',
      formatTokenUsageSummary(metadata.tokenUsage, {compact: false}).slice(
        'tokens: '.length,
      ),
    ),
    row('run', runName),
  ];

  const sections = [
    box(title, rows, style),
    formatChangedFiles(metadata.changedFiles, style),
    formatFailure(metadata, style),
    formatArtifacts(metadata, style),
    formatOutput(output, style),
  ].filter(section => section.length > 0);

  return sections.join('\n\n');
}

function compactTitle(metadata: RunMetadata, style: ChalkStyle): string {
  const connector = metadata.status === 'succeeded' ? 'in' : 'after';
  return [
    style.bold('AgentQ'),
    metadata.agent.id,
    statusText(metadata.status, style),
    connector,
    formatDuration(metadata.durationMs),
  ].join(' ');
}

function createStyle(color?: boolean): ChalkStyle {
  if (color === false) {
    return new Chalk({level: 0});
  }

  if (color === true) {
    return new Chalk({level: 1});
  }

  return chalkStderr;
}

function formatProgressDetail(event: AgentQEvent): string | undefined {
  if (event.kind === 'run_started') {
    return 'loaded agent and started run';
  }

  if (event.kind === 'assistant_message') {
    return formatAssistantMessage(event, 80);
  }

  if (event.kind === 'tool_started') {
    return event.command
      ? compact(event.command, 80)
      : event.toolName
        ? `${event.toolName} started`
        : undefined;
  }

  if (event.kind === 'tool_finished') {
    if (event.status === 'failed') {
      return event.toolName ? `${event.toolName} failed` : 'tool failed';
    }

    return undefined;
  }

  if (event.kind === 'run_completed') {
    return 'completed';
  }

  if (event.kind === 'token_usage' && event.tokenUsage) {
    return formatTokenUsageSummary(event.tokenUsage, {compact: true});
  }

  return undefined;
}

function formatVerboseProgressDetail(event: AgentQEvent): string | undefined {
  if (event.kind === 'run_started') {
    return 'loaded agent and started run';
  }

  if (event.kind === 'assistant_message') {
    return formatAssistantMessage(event, 120);
  }

  if (event.kind === 'tool_started') {
    return event.command
      ? `${event.toolName}: ${compact(event.command, 90)}`
      : `${event.toolName} started`;
  }

  if (event.kind === 'tool_finished') {
    const suffix = event.status === 'failed' ? 'failed' : 'done';
    return event.toolName ? `${event.toolName} ${suffix}` : undefined;
  }

  if (event.kind === 'run_completed') {
    return 'completed';
  }

  if (event.kind === 'token_usage' && event.tokenUsage) {
    return formatTokenUsageSummary(event.tokenUsage, {compact: true});
  }

  return undefined;
}

function formatMessageLogEvent(
  event: AgentQEvent,
  options: RenderOptions & {prefix?: string} = {},
): string | undefined {
  if (!isAssistantMessage(event)) {
    return undefined;
  }

  const style = createStyle(options.color);
  const prefix = options.prefix ?? 'agent';
  return [
    style.dim(prefix),
    style.dim(timestampLabel(event.timestamp)),
    style.magenta.bold('message'),
    formatAssistantMessage(event, 2000),
  ].join('  ');
}

function formatAssistantMessage(
  event: AgentQEvent,
  maxLength: number,
): string | undefined {
  if (!event.message) {
    return undefined;
  }

  const message = compact(event.message, maxLength);
  return event.phase ? `[${event.phase}] ${message}` : message;
}

function formatAssistantMessagePreview(
  event: AgentQEvent,
  maxLength: number,
): string | undefined {
  if (!event.message) {
    return undefined;
  }

  return compact(event.message, maxLength);
}

function formatHarnessOutputSummary(result: unknown): string | undefined {
  if (!isRecord(result)) {
    return undefined;
  }

  const tasks = result.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return undefined;
  }

  const firstTitle = tasks
    .map(task =>
      isRecord(task) && typeof task.title === 'string' ? task.title.trim() : '',
    )
    .find(title => title.length > 0);
  const count = tasks.length;
  const title = firstTitle ? `: ${compact(firstTitle, 80)}` : '';
  return `${count} task${count === 1 ? '' : 's'}${title}`;
}

function looksLikeAgentOutput(message: string | undefined): boolean {
  if (!message) {
    return false;
  }

  const trimmed = message.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return false;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return (
      isRecord(parsed) &&
      typeof parsed.status === 'string' &&
      typeof parsed.summary === 'string'
    );
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAssistantMessage(event: AgentQEvent): boolean {
  return event.kind === 'assistant_message' && Boolean(event.message);
}

function noopProgressRenderer(): ProgressRenderer {
  return {
    onEvent: () => undefined,
    stop: () => undefined,
  };
}

function statusGlyph(
  status: HarnessProgressResult['status'],
  style: ChalkStyle,
): string {
  if (status === 'success') {
    return style.green('✓');
  }
  if (status === 'blocked') {
    return style.yellow('!');
  }
  return style.red('✗');
}

function eventLabel(event: AgentQEvent): string | undefined {
  if (event.kind === 'run_started') {
    return 'start';
  }
  if (event.kind === 'assistant_message') {
    return 'message';
  }
  if (event.kind === 'tool_started') {
    return 'tool';
  }
  if (event.kind === 'tool_finished') {
    return event.status === 'failed' ? 'fail' : 'ok';
  }
  if (event.kind === 'run_completed') {
    return 'done';
  }
  if (event.kind === 'token_usage') {
    return 'tokens';
  }
  return undefined;
}

function colorLabel(
  label: string,
  kind: AgentQEvent['kind'],
  style: ChalkStyle,
) {
  if (kind === 'tool_finished') {
    return label === 'fail' ? style.red.bold(label) : style.green.bold(label);
  }
  if (kind === 'tool_started') {
    return style.cyan.bold(label);
  }
  if (kind === 'token_usage') {
    return style.yellow.bold(label);
  }
  if (kind === 'run_completed') {
    return style.green.bold(label);
  }
  return style.magenta.bold(label);
}

function timestampLabel(timestamp: string | undefined): string {
  if (!timestamp) {
    return '--:--';
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return '--:--';
  }

  return date.toISOString().slice(11, 19);
}

function row(label: string, value: string): string {
  return `${label.padEnd(9)} ${value}`;
}

function box(title: string, rows: string[], style: ChalkStyle): string {
  const width =
    Math.max(title.length + 4, ...rows.map(line => line.length)) + 4;
  const top = `+-- ${title} ${'-'.repeat(Math.max(0, width - title.length - 5))}+`;
  const bottom = `+${'-'.repeat(width)}+`;
  const body = rows.map(line => `| ${line.padEnd(width - 2)} |`);
  return [style.magenta.bold(top), ...body, style.magenta.bold(bottom)].join(
    '\n',
  );
}

function statusText(status: RunStatus, style: ChalkStyle): string {
  if (status === 'succeeded') {
    return style.green(status);
  }
  if (status === 'timed_out') {
    return style.yellow(status);
  }
  return style.red(status);
}

function statusHistoryText(status: RunStatus, style: ChalkStyle) {
  if (status === 'succeeded') {
    return style.green;
  }
  if (status === 'timed_out') {
    return style.yellow;
  }
  if (status === 'running') {
    return style.cyan;
  }
  return style.red;
}

function summarizeTools(tools: RunMetadata['toolUsage']): string {
  if (tools.length === 0) {
    return '0 calls';
  }

  const calls = tools.reduce((sum, tool) => sum + tool.calls, 0);
  const failures = tools.reduce((sum, tool) => sum + tool.failures, 0);
  return `${calls} calls, ${failures} failures`;
}

function summarizeFiles(files: ChangedFileSummary[]): string {
  if (files.length === 0) {
    return '0 files changed';
  }

  return `${files.length} ${files.length === 1 ? 'file' : 'files'} changed`;
}

function formatTokenUsageSummary(
  tokenUsage: RunMetadata['tokenUsage'],
  options: {compact: boolean},
): string {
  if (!tokenUsage) {
    return 'tokens: n/a';
  }

  const fields = [
    ['input', formatTokenValue(tokenUsage.inputTokens, options.compact)],
    ['output', formatTokenValue(tokenUsage.outputTokens, options.compact)],
    ['cached', formatTokenValue(tokenUsage.cachedInputTokens, options.compact)],
    [
      'reasoning',
      formatTokenValue(tokenUsage.reasoningOutputTokens, options.compact),
    ],
    ['total', formatTokenValue(tokenUsage.totalTokens, options.compact)],
  ] as const;

  return `tokens: ${fields
    .map(([label, value]) => `${label} ${value ?? 'n/a'}`)
    .join(' · ')}`;
}

function formatChangedFiles(
  files: ChangedFileSummary[],
  style: ChalkStyle,
): string {
  if (files.length === 0) {
    return '';
  }

  return [
    style.bold('Changed files'),
    ...files.map(file =>
      [
        `  ${style.yellow(file.operation.padEnd(7))}`,
        style.dim(file.source.padEnd(12)),
        file.path,
      ].join(' '),
    ),
  ].join('\n');
}

function formatFailure(metadata: RunMetadata, style: ChalkStyle): string {
  if (!metadata.failure) {
    return '';
  }

  const lines = [style.red.bold('Failure'), `  ${metadata.failure.message}`];
  if (metadata.failure.stderrTail) {
    lines.push('', style.dim(indent(metadata.failure.stderrTail)));
  }

  return lines.join('\n');
}

function formatInspectionFailure(
  metadata: RunMetadata,
  style: ChalkStyle,
): string {
  if (!metadata.failure) {
    return '';
  }

  const lines = [
    style.red.bold('Failure'),
    `  kind      ${metadata.failure.kind}`,
    `  message   ${metadata.failure.message}`,
  ];

  if (
    metadata.failure.exitCode !== undefined &&
    metadata.failure.exitCode !== null
  ) {
    lines.push(`  exit code ${metadata.failure.exitCode}`);
  }

  if (metadata.failure.timedOut) {
    lines.push('  timed out true');
  }

  if (metadata.failure.stderrTail) {
    lines.push('', style.dim(indent(metadata.failure.stderrTail)));
  }

  return lines.join('\n');
}

function formatArtifacts(metadata: RunMetadata, style: ChalkStyle): string {
  return [
    style.bold('Artifacts'),
    `  output   ${style.dim(metadata.paths.output)}`,
    `  run      ${style.dim(metadata.paths.runDir)}`,
    `  events   ${style.dim(metadata.paths.stdout)}`,
    `  stderr   ${style.dim(metadata.paths.stderr)}`,
  ].join('\n');
}

function formatOutput(output: string, style: ChalkStyle): string {
  if (output.trim().length === 0) {
    return '';
  }

  return [style.bold('Final output'), output.trim()].join('\n');
}

function formatInspectionOutput(output: string, style: ChalkStyle): string {
  const preview = previewText(output, 20, 1200);
  if (preview.length === 0) {
    return '';
  }

  return [style.bold('Final output'), preview].join('\n');
}

function compact(value: string, maxLength: number): string {
  const oneLine = value.trim().replace(/\s+/g, ' ');
  if (oneLine.length <= maxLength) {
    return oneLine;
  }

  return `${oneLine.slice(0, maxLength - 3)}...`;
}

function previewText(
  value: string,
  maxLines: number,
  maxChars: number,
): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return '';
  }

  const lines = trimmed.split(/\r?\n/);
  let preview = lines.slice(0, maxLines).join('\n');

  if (preview.length > maxChars) {
    preview = `${preview.slice(0, maxChars - 3).trimEnd()}...`;
  }

  if (lines.length > maxLines) {
    preview = `${preview}\n...`;
  }

  return preview;
}

function indent(value: string): string {
  return value
    .split(/\r?\n/)
    .map(line => `  ${line}`)
    .join('\n');
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) {
    return 'running';
  }

  if (ms < 1000) {
    return `${ms}ms`;
  }

  const seconds = Math.round(ms / 100) / 10;
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function compactTokenCount(value: number | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}k`;
  }

  return String(value);
}

function formatTokenValue(
  value: number | undefined,
  compact: boolean,
): string | undefined {
  return compact ? compactTokenCount(value) : formatTokenCount(value);
}

function formatTokenCount(value: number | undefined): string {
  if (value === undefined) {
    return 'n/a';
  }

  return formatNumber(value);
}

function runDirName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function formatStartedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'unknown';
  }

  return date.toISOString().replace('T', ' ').slice(0, 16);
}

function column(
  header: string,
  values: string[],
  maxWidth: number,
): {header: string; width: number} {
  const contentWidth = Math.max(
    header.length,
    ...values.map(value => value.length),
  );
  return {header, width: Math.min(contentWidth, maxWidth)};
}

function tableBorder(columns: {width: number}[]): string {
  return `+${columns.map(item => '-'.repeat(item.width + 2)).join('+')}+`;
}

function tableRow(values: string[]): string {
  return `| ${values.join(' | ')} |`;
}

function pad(value: string, width: number): string {
  return compact(value, width).padEnd(width);
}
