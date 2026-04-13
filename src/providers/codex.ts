import {createWriteStream} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {
  normalizeCodexJsonLine,
  summarizeChangedFiles,
  summarizeToolUsage,
} from '../core/events';
import {AgentQError} from '../core/errors';
import {contextFallbackName} from '../core/paths';
import {createProgressRenderer} from '../core/render';
import type {AgentQEvent, PreparedRun, ProviderRunResult} from '../core/types';
import type {ProgressRenderer} from '../core/render';
import type {AgentProvider} from './provider';

export class CodexProvider implements AgentProvider {
  async run(
    prepared: PreparedRun,
    options: {agentId: string; color?: boolean; verbose?: boolean},
  ): Promise<ProviderRunResult> {
    assertBinary('bun');
    assertBinary('codex');

    await writeFile(prepared.paths.stdoutPath, '', 'utf8');
    await writeFile(prepared.paths.stderrPath, '', 'utf8');
    await writeFile(prepared.paths.outputPath, '', 'utf8');

    const args = buildCodexArgs(prepared);
    const proc = Bun.spawn(['codex', ...args], {
      cwd: prepared.projectCwd,
      env: {
        ...process.env,
        ...prepared.config.env,
      },
      stderr: 'pipe',
      stdin: 'pipe',
      stdout: 'pipe',
    });

    await proc.stdin.write(prepared.prompt);
    await proc.stdin.end();

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, prepared.config.timeoutMs);

    const progress = createProgressRenderer({
      agentId: options.agentId,
      color: options.color,
      verbose: options.verbose,
    });
    const stdoutPump = pumpStdout(
      proc.stdout,
      prepared.paths.stdoutPath,
      progress,
    );
    const stderrPump = pumpStderr(proc.stderr, prepared.paths.stderrPath);

    try {
      const exitCode = await proc.exited;
      const [events, stderr] = await Promise.all([stdoutPump, stderrPump]);
      return {
        changedFiles: summarizeChangedFiles(events),
        events,
        exitCode,
        stderr,
        timedOut,
        toolUsage: summarizeToolUsage(events),
      };
    } finally {
      clearTimeout(timer);
      progress.stop();
    }
  }
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

function assertBinary(binary: string): void {
  if (!Bun.which(binary)) {
    throw new AgentQError(`Required command not found: ${binary}`);
  }
}

async function pumpStdout(
  stream: ReadableStream<Uint8Array>,
  stdoutPath: string,
  progress: ProgressRenderer,
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
      buffered = processCompleteLines(buffered + chunk, events, progress);
    }

    const finalChunk = decoder.decode();
    if (finalChunk.length > 0) {
      writer.write(finalChunk);
      buffered = processCompleteLines(buffered + finalChunk, events, progress);
    }

    if (buffered.trim().length > 0) {
      const event = normalizeCodexJsonLine(buffered);
      if (event) {
        events.push(event);
        progress.onEvent(event);
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
): string {
  const lines = buffered.split(/\r?\n/);
  const rest = lines.pop() ?? '';

  for (const line of lines) {
    const event = normalizeCodexJsonLine(line);
    if (event) {
      events.push(event);
      progress.onEvent(event);
    }
  }

  return rest;
}
