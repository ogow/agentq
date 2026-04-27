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
  columns?: number;
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
  tty?: boolean;
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
    return createHarnessThreadedVerboseRenderer({
      mode,
      outputStream,
      runId,
      style,
    });
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
      {columns: outputStream.columns},
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

function createHarnessThreadedVerboseRenderer({
  mode,
  outputStream,
  runId,
  style,
}: {
  mode: {format: OutputFormat; verbosity: Verbosity};
  outputStream: RenderStream;
  runId?: string;
  style: ChalkStyle;
}): HarnessProgressRenderer {
  let currentTokenSummary: string | undefined;
  let currentTask: HarnessTaskContext | undefined;
  let currentStep: HarnessProgressStep | undefined;
  let pendingRetry: {attempt: number; message: string} | undefined;
  let lastFailedTaskAttempt: number | undefined;
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
      const finishedStep = result.step ?? currentStep;
      const tokenSummary = currentTokenSummary;
      currentTask = undefined;
      currentStep = undefined;
      currentTokenSummary = undefined;
      pendingRetry = undefined;
      if (mode.verbosity >= 2 && finishedStep) {
        const diagnostics = formatHarnessThreadedResultDiagnostics(
          finishedStep,
          result,
          style,
          {columns: outputStream.columns, task},
        );
        for (const diagnostic of diagnostics) {
          outputStream.write(`${diagnostic}\n`);
        }
      }
      if (
        result.status !== 'success' &&
        lastFailedTaskAttempt !== (task.attempt ?? 1)
      ) {
        outputStream.write(
          `${formatHarnessThreadedTaskOutcome(task, result, style, {
            columns: outputStream.columns,
          })}\n`,
        );
      } else if (result.status === 'success') {
        outputStream.write(
          `${formatHarnessThreadedTaskOutcome(task, result, style, {
            columns: outputStream.columns,
            tokenSummary,
          })}\n`,
        );
      }
      lastFailedTaskAttempt = undefined;
    },
    finishStep: (step, result) => {
      const activeStep = currentStep ?? step;
      const tokenSummary = currentTokenSummary;
      if (mode.verbosity >= 2) {
        const diagnostics = formatHarnessThreadedResultDiagnostics(
          activeStep,
          result,
          style,
          {
            columns: outputStream.columns,
            task: currentTask,
          },
        );
        for (const diagnostic of diagnostics) {
          outputStream.write(`${diagnostic}\n`);
        }
      }
      currentStep = undefined;
      currentTokenSummary = undefined;
      if (result.status !== 'success' && currentTask) {
        outputStream.write(
          `${formatHarnessThreadedStepOutcome(activeStep, result, style, {
            columns: outputStream.columns,
            task: currentTask,
          })}\n`,
        );
        outputStream.write(
          `${formatHarnessThreadedTaskOutcome(currentTask, result, style, {
            columns: outputStream.columns,
          })}\n`,
        );
        pendingRetry = {
          attempt: (currentTask.attempt ?? 1) + 1,
          message: 'retrying with previous feedback',
        };
        lastFailedTaskAttempt = currentTask.attempt ?? 1;
        return;
      }
      outputStream.write(
        `${formatHarnessThreadedStepOutcome(activeStep, result, style, {
          columns: outputStream.columns,
          task: currentTask,
          tokenSummary,
        })}\n`,
      );
    },
    onEvent: event => {
      if (event.kind === 'token_usage') {
        currentTokenSummary =
          mode.verbosity >= 2
            ? formatTokenUsageSummary(event.tokenUsage, {
                compact: true,
              })
            : formatHarnessCompactTokenSummary(event.tokenUsage);
        return;
      }
      const line = formatHarnessThreadedEvent(event, style, {
        columns: outputStream.columns,
        task: currentTask,
        step: currentStep,
        verbosity: mode.verbosity,
      });
      if (line) {
        outputStream.write(`${line}\n`);
      }
    },
    startTask: task => {
      renderRunHeader();
      currentTask = task;
      currentStep = undefined;
      currentTokenSummary = undefined;
      pendingRetry = undefined;
      lastFailedTaskAttempt = undefined;
      outputStream.write(
        `${formatHarnessThreadedTaskStart(task, style, {
          columns: outputStream.columns,
        })}\n`,
      );
    },
    startStep: step => {
      renderRunHeader();
      if (
        currentTask &&
        pendingRetry &&
        (currentTask.attempt ?? 1) === pendingRetry.attempt
      ) {
        outputStream.write(
          `${formatHarnessThreadedRetry(
            currentTask,
            pendingRetry.message,
            style,
            {
              columns: outputStream.columns,
            },
          )}\n`,
        );
        pendingRetry = undefined;
      }
      currentStep = step;
      currentTokenSummary = undefined;
      outputStream.write(
        `${formatHarnessThreadedStepStart(step, style, {
          columns: outputStream.columns,
          task: currentTask,
        })}\n`,
      );
      if (mode.verbosity >= 2 && isCommandStep(step) && step.activity) {
        outputStream.write(
          `${formatHarnessDiagnostic('tool', `exec: ${step.activity}`, style, {
            columns: outputStream.columns,
            task: currentTask,
          })}\n`,
        );
      }
    },
    stop: () => undefined,
  };
}

const HARNESS_FALLBACK_WIDTH = 104;
const HARNESS_MAX_WIDTH = 104;
const HARNESS_MIN_MESSAGE_WIDTH = 20;
const HARNESS_STEP_NAME_WIDTH = 32;
const HARNESS_NOTE_PREFIX = '    … ';
const HARNESS_TOP_NOTE_PREFIX = '  … ';
const HARNESS_DIAGNOSTIC_LABEL_WIDTH = 5;

function formatHarnessThreadedTaskStart(
  task: HarnessTaskContext,
  style: ChalkStyle,
  options: {columns?: number} = {},
): string {
  return formatHarnessWrappedLine(
    `${colorHarnessGlyph('▶', style)} ${style.white(taskLabel(task))}  ${style.dim(
      retryLabel(task),
    )}  `,
    task.summary ?? task.detail ?? '',
    style,
    options,
  );
}

function formatHarnessThreadedRetry(
  task: HarnessTaskContext,
  message: string,
  style: ChalkStyle,
  options: {columns?: number} = {},
): string {
  return formatHarnessWrappedLine(
    `${colorHarnessGlyph('↻', style)} ${style.white(taskLabel(task))}  ${style.dim(
      retryLabel(task),
    )}  `,
    message,
    style,
    options,
  );
}

function formatHarnessThreadedTaskOutcome(
  task: HarnessTaskContext,
  result: HarnessProgressResult,
  style: ChalkStyle,
  options: {columns?: number; tokenSummary?: string} = {},
): string {
  const failurePrefix = result.status === 'blocked' ? 'blocked' : 'failed';
  const message =
    result.status === 'success'
      ? (task.summary ?? result.summary ?? task.detail ?? '')
      : `${failurePrefix}: ${result.summary ?? task.summary ?? failurePrefix}`;
  return formatHarnessWrappedLine(
    `${colorHarnessGlyph(threadedStatusGlyph(result.status), style)} ${style.white(
      taskLabel(task),
    )}  ${style.dim(retryLabel(task))}  `,
    appendTokenSummary(
      message,
      result.status === 'success' ? options.tokenSummary : undefined,
    ),
    style,
    options,
  );
}

function formatHarnessThreadedStepStart(
  step: HarnessProgressStep,
  style: ChalkStyle,
  options: {columns?: number; task?: HarnessTaskContext},
): string {
  const indent = options.task ? '  ' : '';
  return `${indent}${colorHarnessGlyph('●', style)} ${style.white(
    threadedStepScope(step),
  )}  ${style.dim(threadedActor(step))}`;
}

function formatHarnessThreadedStepOutcome(
  step: HarnessProgressStep,
  result: HarnessProgressResult,
  style: ChalkStyle,
  options: {
    columns?: number;
    task?: HarnessTaskContext;
    tokenSummary?: string;
  } = {},
): string {
  const baseSummary = isCommandStep(step)
    ? commandStepSummary(result.status)
    : ((result.status === 'success'
        ? formatHarnessOutputSummary(result.result)
        : undefined) ??
      result.summary ??
      step.detail ??
      step.label);
  const summary =
    result.status === 'success'
      ? (baseSummary ?? '')
      : `${result.status === 'blocked' ? 'blocked' : 'failed'}: ${baseSummary ?? result.status}`;
  const indent = options.task ? '  ' : '';
  return formatHarnessWrappedLine(
    `${indent}${colorHarnessGlyph(threadedStatusGlyph(result.status), style)} ${style.white(
      threadedStepScope(step),
    )}  `,
    appendTokenSummary(
      summary,
      result.status === 'success' ? options.tokenSummary : undefined,
    ),
    style,
    options,
  );
}

function formatHarnessThreadedEvent(
  event: AgentQEvent,
  style: ChalkStyle,
  options: {
    columns?: number;
    task?: HarnessTaskContext;
    step?: HarnessProgressStep;
    verbosity: Verbosity;
  },
): string | undefined {
  if (event.kind === 'assistant_message') {
    if (looksLikeAgentOutput(event.message)) {
      return undefined;
    }
    const message = normalizeWrappedMessage(event.message);
    if (!message) {
      return undefined;
    }
    return formatHarnessNote(message, style, {
      columns: options.columns,
      task: options.task,
    });
  }
  if (options.verbosity < 2) {
    return undefined;
  }
  if (event.kind === 'tool_started') {
    const detail = event.command
      ? `exec: ${event.command}`
      : `${event.toolName ?? 'tool'} started`;
    return formatHarnessDiagnostic('tool', detail, style, {
      columns: options.columns,
      task: options.task,
    });
  }
  if (event.kind === 'tool_finished' && event.status === 'failed') {
    const details = [
      event.exitCode !== undefined ? `exit ${String(event.exitCode)}` : '',
      event.message ? normalizeWrappedMessage(event.message) : '',
    ].filter(Boolean);
    return formatHarnessDiagnostic(
      'fail',
      details.join(' · ') || 'tool failed',
      style,
      {
        columns: options.columns,
        task: options.task,
      },
    );
  }
  return undefined;
}

function formatHarnessThreadedResultDiagnostics(
  step: HarnessProgressStep,
  result: HarnessProgressResult,
  style: ChalkStyle,
  options: {columns?: number; task?: HarnessTaskContext},
): string[] {
  const lines: string[] = [];
  if (result.command && !isCommandStep(step)) {
    lines.push(
      formatHarnessDiagnostic('tool', `exec: ${result.command}`, style, {
        columns: options.columns,
        task: options.task,
      }),
    );
  }
  if (result.status === 'success') {
    return lines;
  }
  const details = [
    result.exitCode !== undefined && result.exitCode !== null
      ? `exit ${String(result.exitCode)}`
      : '',
    result.stderrTail
      ? `stderr: ${normalizeWrappedMessage(result.stderrTail)}`
      : '',
    result.stdoutTail
      ? `stdout: ${normalizeWrappedMessage(result.stdoutTail)}`
      : '',
  ].filter(Boolean);
  if (details.length === 0) {
    return lines;
  }
  lines.push(
    formatHarnessDiagnostic('fail', details.join(' · '), style, {
      columns: options.columns,
      task: options.task,
    }),
  );
  return lines;
}

function formatHarnessNote(
  message: string,
  style: ChalkStyle,
  options: {columns?: number; task?: HarnessTaskContext} = {},
): string {
  const prefix = options.task ? HARNESS_NOTE_PREFIX : HARNESS_TOP_NOTE_PREFIX;
  const continuation = options.task
    ? ' '.repeat(HARNESS_NOTE_PREFIX.length)
    : ' '.repeat(HARNESS_TOP_NOTE_PREFIX.length);
  return formatHarnessWrappedLine(style.dim(prefix), message, style, options, {
    continuationPrefix: style.dim(continuation),
  });
}

function formatHarnessDiagnostic(
  label: 'fail' | 'tool',
  message: string,
  style: ChalkStyle,
  options: {columns?: number; task?: HarnessTaskContext} = {},
): string {
  const indent = options.task ? '    ' : '  ';
  const styledLabel = label === 'fail' ? style.red(label) : style.dim(label);
  const plainPrefix = `${indent}${label.padEnd(
    HARNESS_DIAGNOSTIC_LABEL_WIDTH,
  )} `;
  const styledPrefix = `${indent}${styledLabel}${' '.repeat(
    Math.max(HARNESS_DIAGNOSTIC_LABEL_WIDTH - label.length, 0),
  )} `;
  return formatHarnessWrappedLine(styledPrefix, message, style, options, {
    continuationPrefix: ' '.repeat(plainPrefix.length),
  });
}

function formatHarnessWrappedLine(
  prefix: string,
  message: string,
  style: ChalkStyle,
  options: {columns?: number} = {},
  wrapOptions: {continuationPrefix?: string} = {},
): string {
  const plainPrefix = stripAnsi(prefix);
  const continuationPrefix =
    wrapOptions.continuationPrefix ?? ' '.repeat(plainPrefix.length);
  const columns = harnessEffectiveColumns(options.columns);
  const messageWidth = Math.max(
    columns - plainLength(plainPrefix),
    HARNESS_MIN_MESSAGE_WIDTH,
  );
  const lines = wrapHarnessMessage(message, messageWidth);
  const visibleLines = lines.length > 0 ? lines : [''];
  return visibleLines
    .map((line, index) => {
      const linePrefix = index === 0 ? prefix : continuationPrefix;
      return `${linePrefix}${line ? style.dim(line) : ''}`.trimEnd();
    })
    .join('\n');
}

function appendTokenSummary(message: string, tokenSummary?: string): string {
  return tokenSummary ? `${message} · ${tokenSummary}` : message;
}

function harnessEffectiveColumns(columns: number | undefined): number {
  const terminalColumns =
    typeof columns === 'number' && columns > 0
      ? Math.floor(columns)
      : HARNESS_FALLBACK_WIDTH;
  return Math.max(60, Math.min(terminalColumns, HARNESS_MAX_WIDTH));
}

function colorHarnessGlyph(glyph: string, style: ChalkStyle): string {
  if (glyph === '✓') {
    return style.green(glyph);
  }
  if (glyph === '✗') {
    return style.red(glyph);
  }
  if (glyph === '!') {
    return style.yellow(glyph);
  }
  if (glyph === '↻' || glyph === '▶' || glyph === '●') {
    return style.cyan(glyph);
  }
  return style.dim(glyph);
}

function threadedStatusGlyph(
  status: HarnessProgressResult['status'],
): '✓' | '✗' | '!' {
  if (status === 'success') {
    return '✓';
  }
  if (status === 'blocked') {
    return '!';
  }
  return '✗';
}

function threadedStepScope(step: HarnessProgressStep): string {
  return middleTruncate(stepName(step), HARNESS_STEP_NAME_WIDTH);
}

function threadedActor(step: HarnessProgressStep): string {
  return isCommandStep(step) ? 'command' : step.label;
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
  options: {commandStep?: boolean; compactStep?: boolean; live?: boolean} = {},
): string {
  const primary = options.commandStep
    ? step.label
    : options.compactStep
      ? stepName(step)
      : step.label;
  const secondary = options.commandStep
    ? 'command'
    : options.compactStep
      ? step.label
      : step.detail;
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
  options: {
    commandStep?: boolean;
    compactStep?: boolean;
    tokenSummary?: string;
  } = {},
): string {
  const primary = options.commandStep
    ? step.label
    : options.compactStep
      ? stepName(step)
      : step.label;
  const secondary = options.commandStep
    ? 'command'
    : options.compactStep
      ? step.label
      : step.detail;
  const summary = options.commandStep
    ? commandStepSummary(result.status)
    : ((result.status === 'success'
        ? formatHarnessOutputSummary(result.result)
        : undefined) ??
      result.summary ??
      step.detail ??
      step.label);
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
  options: {columns?: number} = {},
): string {
  const columns =
    typeof options.columns === 'number' && options.columns > 0
      ? Math.floor(options.columns)
      : undefined;
  const agent = step?.label ?? 'waiting';
  const activityText = activity
    ? activity.trim().replace(/\s+/g, ' ')
    : 'working';
  const prefixSegments = [
    {plain: frame, render: (value: string) => style.cyan(value)},
    {plain: runId, render: (value: string) => style.bold(value)},
    {plain: taskLabel(task), render: (value: string) => style.dim(value)},
    {plain: retryLabel(task), render: (value: string) => style.dim(value)},
  ];
  const agentSegment = {
    plain: agent,
    render: (value: string) => style.white(value),
  };
  const visiblePrefix = [...prefixSegments, agentSegment];
  const renderedPrefix = visiblePrefix
    .map(segment => segment.render(segment.plain))
    .join(' ');

  if (!columns) {
    return [renderedPrefix, style.dim(activityText)].join('  ');
  }

  const prefixLength = plainLength(
    visiblePrefix.map(segment => segment.plain).join(' '),
  );
  const availableForActivity = columns - prefixLength - 2;
  if (availableForActivity <= 0) {
    return fitVisibleStyledLine(visiblePrefix, columns);
  }

  const fittedActivity = fitVisibleText(activityText, availableForActivity);
  if (!fittedActivity) {
    return fitVisibleStyledLine(visiblePrefix, columns);
  }

  return [renderedPrefix, style.dim(fittedActivity)].join('  ');
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

function isCommandStep(step: HarnessProgressStep): boolean {
  return typeof step.activity === 'string' && step.activity.trim().length > 0;
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
  return stripAnsi(value).length;
}

function stripAnsi(value: string): string {
  return value.replace(
    // eslint-disable-next-line no-control-regex
    /\u001b\[[0-9;]*m/g,
    '',
  );
}

function fitVisibleText(value: string, maxLength: number): string {
  const normalized = compact(value, Number.MAX_SAFE_INTEGER);
  if (maxLength <= 0 || normalized.length === 0) {
    return '';
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  if (maxLength <= 3) {
    return normalized.slice(0, maxLength);
  }

  const words = normalized.split(' ');
  let fitted = '';
  for (const word of words) {
    const next = fitted.length === 0 ? word : `${fitted} ${word}`;
    if (next.length > maxLength - 3) {
      break;
    }
    fitted = next;
  }

  if (fitted.length > 0) {
    return `${fitted}...`;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

interface StyledTextSegment {
  plain: string;
  render: (value: string) => string;
}

function fitVisibleStyledLine(
  parts: StyledTextSegment[],
  columns: number,
): string {
  if (columns <= 0) {
    return '';
  }

  const visibleParts: string[] = [];
  let visibleLength = 0;
  for (const part of parts.filter((segment): segment is StyledTextSegment =>
    Boolean(segment?.plain),
  )) {
    const separator = visibleParts.length === 0 ? '' : ' ';
    const separatorLength = separator.length;
    const nextLength = plainLength(part.plain);
    if (visibleLength + separatorLength + nextLength <= columns) {
      if (separator) {
        visibleParts.push(separator);
      }
      visibleParts.push(part.render(part.plain));
      visibleLength += separatorLength + nextLength;
      continue;
    }

    const remaining = columns - visibleLength - separatorLength;
    const fitted = fitVisibleText(part.plain, remaining);
    if (fitted.length > 0) {
      if (separator) {
        visibleParts.push(separator);
      }
      visibleParts.push(part.render(fitted));
    }
    break;
  }

  return visibleParts.join('');
}

function commandStepSummary(status: HarnessProgressResult['status']): string {
  if (status === 'success') {
    return 'passed';
  }
  if (status === 'blocked') {
    return 'blocked';
  }
  return 'failed';
}

interface KeyValueRow {
  label: string;
  value?: string;
}

export function formatKeyValueReport(
  rows: KeyValueRow[],
  options: {tty?: boolean} = {},
): string {
  const visibleRows = rows.filter(
    row => row.value !== undefined && row.value.length > 0,
  );
  if (visibleRows.length === 0) {
    return '';
  }

  if (!options.tty) {
    return visibleRows.map(row => `${row.label}: ${row.value}`).join('\n');
  }

  const width = Math.max(...visibleRows.map(row => row.label.length));
  return visibleRows
    .map(row => `${row.label.padEnd(width)} ${row.value}`)
    .join('\n');
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
    options.tty
      ? `${style.bold(metadata.agent.id)}  ${statusText(metadata.status, style)}`
      : `${metadata.agent.id}: ${statusText(metadata.status, style)}`,
    formatKeyValueReport(
      [
        {label: 'duration', value: formatDuration(metadata.durationMs)},
        {label: 'run', value: metadata.paths.runDir},
        {label: 'tools', value: summarizeTools(metadata.toolUsage)},
        {label: 'edits', value: summarizeFiles(metadata.changedFiles)},
        metadata.tokenUsage
          ? {
              label: 'tokens',
              value: formatTokenUsageSummary(metadata.tokenUsage, {
                compact: true,
              })?.slice('tokens: '.length),
            }
          : undefined,
      ].filter(Boolean) as KeyValueRow[],
      {tty: options.tty},
    ),
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
  const toolTotals = summarizeTools(metadata.toolUsage);
  const editTotals = summarizeFiles(metadata.changedFiles);
  const rows = formatKeyValueReport(
    [
      {label: 'agent', value: metadata.agent.id},
      {label: 'result', value: statusText(metadata.status, style)},
      {
        label: 'model',
        value: `${metadata.config.model} / ${metadata.config.reasoning}`,
      },
      {label: 'output', value: metadata.config.resultMode},
      {label: 'duration', value: formatDuration(metadata.durationMs)},
      {label: 'tools', value: toolTotals},
      {label: 'edits', value: editTotals},
      {label: 'events', value: String(metadata.eventCount)},
      metadata.tokenUsage
        ? {
            label: 'tokens',
            value: formatTokenUsageSummary(metadata.tokenUsage, {
              compact: false,
            })?.slice('tokens: '.length),
          }
        : undefined,
      {label: 'run', value: metadata.paths.runDir},
    ].filter(Boolean) as KeyValueRow[],
    {tty: options.tty},
  );

  const sections = [
    [style.bold(title), rows].join('\n'),
    formatChangedFiles(metadata.changedFiles, style),
    formatFailure(metadata, style),
    formatArtifacts(metadata, style),
    formatOutput(output, style),
  ].filter(section => section.length > 0);

  return sections.join('\n\n');
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
  const title = firstTitle ? `: ${firstTitle}` : '';
  return `${count} task${count === 1 ? '' : 's'}${title}`;
}

function normalizeWrappedMessage(
  message: string | undefined,
): string | undefined {
  if (!message) {
    return undefined;
  }

  const normalized = message
    .split(/\r?\n/)
    .map(line => line.trim().replace(/\s+/g, ' '))
    .join('\n')
    .trim();
  return normalized.length > 0 ? normalized : undefined;
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

export function formatTokenUsageSummary(
  tokenUsage: RunMetadata['tokenUsage'],
  options: {compact: boolean},
): string | undefined {
  if (!tokenUsage) {
    return undefined;
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

  const visibleFields = fields.filter(([, value]) => value !== undefined);
  if (visibleFields.length === 0) {
    return undefined;
  }

  return `tokens: ${visibleFields
    .map(([label, value]) => `${label} ${value ?? 'n/a'}`)
    .join(' · ')}`;
}

function formatHarnessCompactTokenSummary(
  tokenUsage: RunMetadata['tokenUsage'],
): string | undefined {
  if (!tokenUsage) {
    return undefined;
  }

  const total = formatTokenValue(tokenUsage.totalTokens, true);
  return total
    ? `tokens ${total}`
    : formatTokenUsageSummary(tokenUsage, {compact: true});
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

function middleTruncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength <= 3) {
    return value.slice(0, maxLength);
  }

  const remaining = maxLength - 3;
  const startLength = Math.ceil(remaining / 2);
  const endLength = Math.floor(remaining / 2);
  return `${value.slice(0, startLength)}...${value.slice(-endLength)}`;
}

function wrapHarnessMessage(value: string, width: number): string[] {
  const normalized = normalizeWrappedMessage(value);
  if (!normalized) {
    return [];
  }

  const lines: string[] = [];
  for (const paragraph of normalized.split('\n')) {
    if (paragraph.length === 0) {
      lines.push('');
      continue;
    }
    lines.push(...wrapParagraph(paragraph, width));
  }
  return lines;
}

function wrapParagraph(value: string, width: number): string[] {
  if (width < HARNESS_MIN_MESSAGE_WIDTH) {
    return [compact(value, Math.max(width, 1))];
  }

  const words = value.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (word.length > width) {
      if (current) {
        lines.push(current);
        current = '';
      }
      for (let index = 0; index < word.length; index += width) {
        lines.push(word.slice(index, index + width));
      }
      continue;
    }

    const next = current ? `${current} ${word}` : word;
    if (next.length <= width) {
      current = next;
      continue;
    }

    if (current) {
      lines.push(current);
    }
    current = word;
  }

  if (current) {
    lines.push(current);
  }

  return lines;
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
