import {createWriteStream} from 'node:fs';
import {readFile, writeFile} from 'node:fs/promises';
import {
  normalizeCodexJsonLine,
  summarizeChangedFiles,
  summarizeToolUsage,
} from '../core/events';
import {AgentQError} from '../core/errors';
import {contextFallbackName} from '../core/paths';
import {currentHost, killProcessTree} from '../core/processes';
import {createProgressRenderer} from '../core/render';
import type {
  AgentQEvent,
  OutputFormat,
  LogLevel,
  PreparedRun,
  ProviderRunResult,
  Verbosity,
} from '../core/types';
import type {ProcessRegistry} from '../core/processes';
import type {ProgressRenderer} from '../core/render';
import type {AgentProvider} from './provider';

type BinaryResolver = (binary: string) => string | null;

export class CodexProvider implements AgentProvider {
  constructor(private readonly resolveBinary: BinaryResolver = Bun.which) {}

  async run(
    prepared: PreparedRun,
    options: {
      agentId: string;
      color?: boolean;
      format?: OutputFormat;
      logLevel?: LogLevel;
      onEvent?: (event: AgentQEvent) => void;
      onSpawn?: (process: {
        command: string;
        host: string;
        pid: number;
        startedAt: string;
      }) => void | Promise<void>;
      processRegistry?: ProcessRegistry;
      progress?: boolean;
      verbosity?: Verbosity;
      verbose?: boolean;
    },
  ): Promise<ProviderRunResult> {
    this.requireBinary('bun');
    const codexBin = this.requireBinary('codex');
    const env = {
      ...process.env,
      ...prepared.config.env,
    };

    await writeFile(prepared.paths.stdoutPath, '', 'utf8');
    await writeFile(prepared.paths.stderrPath, '', 'utf8');
    await writeFile(prepared.paths.outputPath, '', 'utf8');

    const args = buildCodexArgs(prepared);
    const proc = Bun.spawn([codexBin, ...args], {
      cwd: prepared.projectCwd,
      env,
      stderr: 'pipe',
      stdin: 'pipe',
      stdout: 'pipe',
    });
    const untrackProcess = options.processRegistry?.track(proc);
    if (proc.pid !== undefined) {
      await options.onSpawn?.({
        command: 'codex exec',
        host: currentHost(),
        pid: proc.pid,
        startedAt: new Date().toISOString(),
      });
    }

    await proc.stdin.write(prepared.prompt);
    await proc.stdin.end();

    let timedOut = false;
    let exited = false;
    let interrupted = false;
    const interrupt = () => {
      interrupted = true;
      void killProcessTree(proc);
    };
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    const timer = setTimeout(() => {
      timedOut = true;
      void killProcessTree(proc);
    }, prepared.config.timeoutMs);

    const progress =
      options.progress === false
        ? {
            onEvent: () => undefined,
            stop: () => undefined,
          }
        : createProgressRenderer({
            agentId: options.agentId,
            color: options.color,
            format: options.format,
            logLevel: options.logLevel,
            progress: options.progress,
            verbosity: options.verbosity,
            verbose: options.verbose,
          });
    const completion = createCompletionSignal();
    const stdoutPump = pumpStdout(
      proc.stdout,
      prepared.paths.stdoutPath,
      progress,
      event => {
        completion.observe(event);
        options.onEvent?.(event);
      },
    );
    const stderrPump = pumpStderr(proc.stderr, prepared.paths.stderrPath);

    try {
      const outcome = await Promise.race([
        proc.exited.then(exitCode => ({exitCode, kind: 'exit' as const})),
        completion.promise.then(event => ({
          event,
          exitCode: 0,
          kind: 'completed' as const,
        })),
      ]);
      if (outcome.kind === 'completed') {
        clearTimeout(timer);
        await writeCompletionOutputFallback(
          prepared.paths.outputPath,
          outcome.event,
        );
        await stopCompletedProcess(proc);
      }
      const exitCode = outcome.exitCode;
      exited = true;
      const [events, stderr] = await Promise.all([stdoutPump, stderrPump]);
      return {
        changedFiles: summarizeChangedFiles(events),
        events,
        exitCode,
        interrupted,
        stderr,
        timedOut,
        toolUsage: summarizeToolUsage(events),
      };
    } finally {
      clearTimeout(timer);
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', interrupt);
      if (!exited) {
        await killProcessTree(proc);
      }
      untrackProcess?.();
      progress.stop();
    }
  }

  private requireBinary(binary: string): string {
    const resolved = this.resolveBinary(binary);
    if (!resolved) {
      throw new AgentQError(
        `Required command not found: ${binary}. Make sure it is installed and available on PATH.`,
      );
    }

    return resolved;
  }
}

function createCompletionSignal(): {
  observe: (event: AgentQEvent) => void;
  promise: Promise<AgentQEvent>;
} {
  let completed = false;
  let resolveCompletion: (event: AgentQEvent) => void = () => undefined;
  const promise = new Promise<AgentQEvent>(resolve => {
    resolveCompletion = resolve;
  });

  return {
    observe: event => {
      if (completed || event.kind !== 'run_completed') {
        return;
      }
      completed = true;
      resolveCompletion(event);
    },
    promise,
  };
}

async function writeCompletionOutputFallback(
  outputPath: string,
  event: AgentQEvent,
): Promise<void> {
  const message = event.message;
  if (!message || message.trim().length === 0) {
    return;
  }

  let current = '';
  try {
    current = await readFile(outputPath, 'utf8');
  } catch {
    current = '';
  }
  if (current.trim().length > 0) {
    return;
  }

  await writeFile(
    outputPath,
    message.endsWith('\n') ? message : `${message}\n`,
  );
}

async function stopCompletedProcess(process: Bun.Subprocess): Promise<void> {
  const exited = await Promise.race([
    process.exited.then(
      () => true,
      () => true,
    ),
    delay(250).then(() => false),
  ]);
  if (exited) {
    return;
  }

  await killProcessTree(process);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildCodexArgs(prepared: PreparedRun): string[] {
  const args = [
    'exec',
    '--json',
    '--cd',
    prepared.projectCwd,
    '--skip-git-repo-check',
    '--add-dir',
    prepared.paths.runDir,
    '--output-last-message',
    prepared.paths.outputPath,
    '--sandbox',
    prepared.config.sandbox,
  ];

  if (prepared.contextFilePath) {
    args.push(
      '-c',
      `project_doc_fallback_filenames=${JSON.stringify([contextFallbackName(prepared.projectCwd, prepared.contextFilePath)])}`,
    );
  }

  args.push('--model', prepared.config.model);

  if (prepared.config.approval) {
    args.push(
      '-c',
      `approval_policy=${JSON.stringify(prepared.config.approval)}`,
    );
  }

  if (prepared.config.reasoning !== 'none') {
    args.push(
      '-c',
      `model_reasoning_effort=${JSON.stringify(prepared.config.reasoning)}`,
    );
  }

  args.push('-');
  return args;
}

async function pumpStdout(
  stream: ReadableStream<Uint8Array>,
  stdoutPath: string,
  progress: ProgressRenderer,
  onEvent?: (event: AgentQEvent) => void,
): Promise<AgentQEvent[]> {
  const writer = createWriteStream(stdoutPath, {flags: 'a'});
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buffered = '';
  const events: AgentQEvent[] = [];

  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) {
        break;
      }

      const chunk = decoder.decode(value, {stream: true});
      writer.write(chunk);
      buffered = processCompleteLines(
        buffered + chunk,
        events,
        progress,
        onEvent,
      );
    }

    const finalChunk = decoder.decode();
    if (finalChunk.length > 0) {
      writer.write(finalChunk);
      buffered = processCompleteLines(
        buffered + finalChunk,
        events,
        progress,
        onEvent,
      );
    }

    if (buffered.trim().length > 0) {
      const event = normalizeCodexJsonLine(buffered);
      if (event) {
        events.push(event);
        progress.onEvent(event);
        onEvent?.(event);
      }
    }

    return events;
  } finally {
    await new Promise<void>(resolve => writer.end(resolve));
  }
}

async function pumpStderr(
  stream: ReadableStream<Uint8Array>,
  stderrPath: string,
): Promise<string> {
  const writer = createWriteStream(stderrPath, {flags: 'a'});
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let stderr = '';

  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) {
        break;
      }

      const chunk = decoder.decode(value, {stream: true});
      stderr += chunk;
      writer.write(chunk);
    }

    const finalChunk = decoder.decode();
    if (finalChunk.length > 0) {
      stderr += finalChunk;
      writer.write(finalChunk);
    }

    return stderr;
  } finally {
    await new Promise<void>(resolve => writer.end(resolve));
  }
}

function processCompleteLines(
  buffered: string,
  events: AgentQEvent[],
  progress: ProgressRenderer,
  onEvent?: (event: AgentQEvent) => void,
): string {
  const lines = buffered.split(/\r?\n/);
  const rest = lines.pop() ?? '';

  for (const line of lines) {
    const event = normalizeCodexJsonLine(line);
    if (event) {
      events.push(event);
      progress.onEvent(event);
      onEvent?.(event);
    }
  }

  return rest;
}
