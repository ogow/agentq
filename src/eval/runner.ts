import {existsSync} from 'node:fs';
import {appendFile, readFile, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {AgentQError} from '../core/errors';
import {parseDurationMs} from '../core/durations';
import {killProcessTreeByPid} from '../core/processes';
import {runAgent} from '../core/run';
import {runHarness} from '../core/harness';
import type {RunMetadata} from '../core/metadata';
import type {AgentProvider} from '../providers/provider';
import type {RunOverrides} from '../core/types';
import {
  createEvalRunPaths,
  evalPackNameFromPath,
  resolveEvalPackPath,
  resolveEvalRunDir,
} from './paths';
import {getJsonPathValue} from './json-path';
import {isDefinedEval} from './definition';
import {setEvalPackDir} from './fixtures';
import type {DefinedEval} from './definition';
import type {
  EvalAgentCaseDefinition,
  EvalAgentExecutionRecord,
  EvalCaseDefinition,
  EvalCaseExecutionRecord,
  EvalCaseRecord,
  EvalCommandCaseDefinition,
  EvalCommandExecutionRecord,
  EvalGraderDefinition,
  EvalGraderRecord,
  EvalHarnessCaseDefinition,
  EvalHarnessExecutionRecord,
  EvalRunPaths,
  EvalRunRecord,
  EvalRunRequest,
  EvalRunStatus,
  EvalRunSummaryCounts,
} from './types';

export {defineEval, isDefinedEval} from './definition';

export async function loadEvalPack(
  projectCwd: string,
  packRef: string,
): Promise<{definition: DefinedEval; packPath: string}> {
  const packPath = resolveEvalPackPath(projectCwd, packRef);
  setEvalPackDir(dirname(packPath));

  try {
    const module = (await import(pathToFileURL(packPath).href)) as {
      default?: unknown;
    };
    if (!isDefinedEval(module.default)) {
      throw new AgentQError(
        `Eval pack ${packPath} must default-export a value created with defineEval().`,
      );
    }
    return {definition: module.default, packPath};
  } catch (error) {
    if (shouldFallbackToTranspiledImport(error)) {
      const module = await importTransformedEvalPack(packPath);
      if (!isDefinedEval(module.default)) {
        throw new AgentQError(
          `Eval pack ${packPath} must default-export a value created with defineEval().`,
        );
      }
      return {definition: module.default, packPath};
    }
    throw error;
  } finally {
    setEvalPackDir(undefined);
  }
}

export async function runEval(
  request: EvalRunRequest,
): Promise<EvalRunRecord & {paths: EvalRunPaths}> {
  const startedAt = new Date();
  const initialName = evalPackNameFromPath(request.pack);
  const paths = await createEvalRunPaths(initialName);

  await writeLog(paths, {
    evalName: initialName,
    kind: 'eval_started',
    requestedPack: request.pack,
    timestamp: startedAt.toISOString(),
  });

  let loadedPack: {definition: DefinedEval; packPath: string} | undefined;
  try {
    loadedPack = await loadEvalPack(request.projectCwd, request.pack);
  } catch (error) {
    let packPath: string | undefined;
    try {
      packPath = resolveEvalPackPath(request.projectCwd, request.pack);
    } catch {
      packPath = undefined;
    }
    const finishedAt = new Date();
    const record = buildPackFailureRecord({
      error,
      evalName: initialName,
      packPath,
      projectCwd: request.projectCwd,
      requestedPack: request.pack,
      startedAt,
      finishedAt,
      runDir: paths.runDir,
    });
    await writeResults(paths, record);
    await writeLog(paths, {
      counts: record.counts,
      evalName: record.evalName,
      kind: 'eval_finished',
      message: record.error,
      status: record.status,
      timestamp: record.finishedAt,
    });
    return {...record, paths};
  }

  const definition = loadedPack.definition;
  const caseResults: EvalCaseRecord[] = [];
  const counts: EvalRunSummaryCounts = {
    blocked: 0,
    failed: 0,
    passed: 0,
    total: 0,
  };

  for (const evalCase of definition.cases) {
    const result = await runEvalCase({
      caseDefinition: evalCase,
      projectCwd: request.projectCwd,
      provider: request.provider,
      runName: definition.name,
      runPaths: paths,
    });
    caseResults.push(result);
    incrementCounts(counts, result.status);
    counts.total += 1;
  }

  const status: EvalRunStatus =
    counts.blocked > 0 ? 'blocked' : counts.failed > 0 ? 'failed' : 'success';
  const finishedAt = new Date();
  const record: EvalRunRecord = {
    cases: caseResults,
    completedAt: finishedAt.toISOString(),
    counts,
    evalName: definition.name,
    error: undefined,
    finishedAt: finishedAt.toISOString(),
    packPath: loadedPack.packPath,
    projectCwd: request.projectCwd,
    requestedPack: request.pack,
    runDir: paths.runDir,
    startedAt: startedAt.toISOString(),
    status,
  };
  await writeResults(paths, record);
  await writeLog(paths, {
    counts,
    evalName: definition.name,
    kind: 'eval_finished',
    message: undefined,
    status,
    timestamp: finishedAt.toISOString(),
  });

  return {...record, paths};
}

export async function inspectEvalRun(
  runIdOrPath: string,
): Promise<EvalRunRecord & {paths: EvalRunPaths}> {
  const runDir = resolveEvalRunDir(runIdOrPath);
  const paths = {
    logPath: join(runDir, 'log.jsonl'),
    resultsPath: join(runDir, 'results.json'),
    runDir,
  };

  if (!existsSync(paths.resultsPath)) {
    throw new AgentQError(`Eval run state not found: ${paths.resultsPath}`);
  }

  const record = JSON.parse(
    await readFile(paths.resultsPath, 'utf8'),
  ) as EvalRunRecord;
  return {...record, paths};
}

async function runEvalCase(options: {
  caseDefinition: EvalCaseDefinition;
  projectCwd: string;
  provider?: AgentProvider;
  runName: string;
  runPaths: EvalRunPaths;
}): Promise<EvalCaseRecord> {
  const caseId = options.caseDefinition.id;
  const caseType = options.caseDefinition.type;
  const startedAt = new Date();
  await writeLog(options.runPaths, {
    caseId,
    evalName: options.runName,
    kind: 'case_started',
    timestamp: startedAt.toISOString(),
  });

  try {
    let result: EvalCaseRecord;
    switch (options.caseDefinition.type) {
      case 'command':
        result = await runCommandCase({
          caseDefinition: options.caseDefinition,
          projectCwd: options.projectCwd,
          startedAt,
        });
        break;
      case 'agent':
        result = await runAgentCase({
          caseDefinition: options.caseDefinition,
          projectCwd: options.projectCwd,
          provider: options.provider,
          startedAt,
        });
        break;
      case 'harness':
        result = await runHarnessCase({
          caseDefinition: options.caseDefinition,
          projectCwd: options.projectCwd,
          provider: options.provider,
          startedAt,
        });
        break;
      default:
        throw new AgentQError(
          `Eval case "${caseId}" has unsupported type "${String(caseType)}".`,
        );
    }

    await writeLog(options.runPaths, {
      caseId: result.id,
      evalName: options.runName,
      kind: 'case_finished',
      nestedRunDir: result.nestedRunDir,
      status: result.status,
      timestamp: result.finishedAt,
    });
    return result;
  } catch (error) {
    const finishedAt = new Date();
    const result = buildErrorCaseRecord({
      caseDefinition: options.caseDefinition,
      error,
      finishedAt,
      startedAt,
    });
    await writeLog(options.runPaths, {
      caseId: result.id,
      evalName: options.runName,
      kind: 'case_finished',
      status: result.status,
      timestamp: finishedAt.toISOString(),
    });
    return result;
  }
}

async function runCommandCase(options: {
  caseDefinition: EvalCommandCaseDefinition;
  projectCwd: string;
  startedAt: Date;
}): Promise<EvalCaseRecord> {
  const cwd = options.caseDefinition.cwd
    ? resolve(options.projectCwd, options.caseDefinition.cwd)
    : options.projectCwd;
  const timeoutMs = options.caseDefinition.timeout
    ? parseDurationMs(options.caseDefinition.timeout)
    : undefined;
  const proc = Bun.spawn(options.caseDefinition.command, {
    cwd,
    stderr: 'pipe',
    stdout: 'pipe',
  });

  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs !== undefined) {
    timer = setTimeout(() => {
      timedOut = true;
      if (proc.pid !== undefined) {
        void killProcessTreeByPid(proc.pid);
      }
    }, timeoutMs);
  }

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
    if (timer) {
      clearTimeout(timer);
    }
  }

  const execution: EvalCommandExecutionRecord = {
    command: options.caseDefinition.command,
    cwd,
    exitCode,
    stderr,
    status: timedOut ? 'timed_out' : exitCode === 0 ? 'success' : 'failed',
    stdout,
    timedOut,
    type: 'command',
  };
  const graders = gradeCase({
    changedFiles: [],
    exitCode,
    graders: options.caseDefinition.graders,
    harnessStatus: undefined,
    output: '',
    outputJson: undefined,
    projectCwd: options.projectCwd,
    runStatus: undefined,
    stderr,
    stdout,
  });
  const status = caseStatusFromGraders(graders, execution.status);
  return {
    execution,
    finishedAt: new Date().toISOString(),
    graders,
    id: options.caseDefinition.id,
    kind: 'command',
    startedAt: options.startedAt.toISOString(),
    status,
  };
}

async function runAgentCase(options: {
  caseDefinition: EvalAgentCaseDefinition;
  projectCwd: string;
  provider?: AgentProvider;
  startedAt: Date;
}): Promise<EvalCaseRecord> {
  const result = await runAgent(
    {
      agentId: options.caseDefinition.agent,
      overrides: options.caseDefinition.overrides as RunOverrides | undefined,
      projectCwd: options.projectCwd,
      task: options.caseDefinition.task,
    },
    options.provider,
  );

  const [runJson, output, stderr, stdout] = await Promise.all([
    readJson<RunMetadata>(join(result.runDir, 'run.json')),
    readTextOrEmpty(result.paths.outputPath),
    readTextOrEmpty(join(result.runDir, 'stderr.log')),
    readTextOrEmpty(join(result.runDir, 'stdout.jsonl')),
  ]);

  const graders = gradeCase({
    changedFiles: runJson.changedFiles.map(file => file.path),
    exitCode: runJson.exitCode,
    graders: options.caseDefinition.graders,
    harnessStatus: undefined,
    output,
    outputJson: parseJsonOutput(output),
    projectCwd: options.projectCwd,
    runStatus: runJson.status,
    stderr,
    stdout,
  });
  const execution: EvalAgentExecutionRecord = {
    agent: options.caseDefinition.agent,
    outputPath: result.paths.outputPath,
    runDir: result.runDir,
    status: runJson.status,
    task: options.caseDefinition.task,
    type: 'agent',
  };
  return {
    execution,
    finishedAt: new Date().toISOString(),
    graders,
    id: options.caseDefinition.id,
    kind: 'agent',
    nestedRunDir: result.runDir,
    startedAt: options.startedAt.toISOString(),
    status: caseStatusFromGraders(graders, runJson.status),
  };
}

async function runHarnessCase(options: {
  caseDefinition: EvalHarnessCaseDefinition;
  projectCwd: string;
  provider?: AgentProvider;
  startedAt: Date;
}): Promise<EvalCaseRecord> {
  const result = await runHarness({
    inputFile: options.caseDefinition.inputFile,
    inputText: options.caseDefinition.inputText,
    inputs: options.caseDefinition.inputs,
    name: options.caseDefinition.harness,
    projectCwd: options.projectCwd,
    provider: options.provider,
  });

  const state = await readJson<{status?: string}>(
    join(result.runDir, 'tasks.json'),
  );
  const harnessStatus = normalizeHarnessStatus(state.status);
  const graders = gradeCase({
    changedFiles: [],
    exitCode: undefined,
    graders: options.caseDefinition.graders,
    harnessStatus,
    output: '',
    outputJson: undefined,
    projectCwd: options.projectCwd,
    runStatus: undefined,
    stderr: '',
    stdout: '',
  });
  const execution: EvalHarnessExecutionRecord = {
    harness: options.caseDefinition.harness,
    runDir: result.runDir,
    status: harnessStatus,
    type: 'harness',
  };
  return {
    execution,
    finishedAt: new Date().toISOString(),
    graders,
    id: options.caseDefinition.id,
    kind: 'harness',
    nestedRunDir: result.runDir,
    startedAt: options.startedAt.toISOString(),
    status: caseStatusFromGraders(graders, harnessStatus),
  };
}

function gradeCase(options: {
  changedFiles: string[];
  exitCode?: number | null;
  graders: EvalGraderDefinition[];
  harnessStatus?: string;
  output: string;
  outputJson: unknown;
  projectCwd: string;
  runStatus?: string;
  stderr: string;
  stdout: string;
}): EvalGraderRecord[] {
  return options.graders.map(grader =>
    gradeSingle(grader, {
      changedFiles: options.changedFiles,
      exitCode: options.exitCode,
      harnessStatus: options.harnessStatus,
      output: options.output,
      outputJson: options.outputJson,
      projectCwd: options.projectCwd,
      runStatus: options.runStatus,
      stderr: options.stderr,
      stdout: options.stdout,
    }),
  );
}

function gradeSingle(
  grader: EvalGraderDefinition,
  context: {
    changedFiles: string[];
    exitCode?: number | null;
    harnessStatus?: string;
    output: string;
    outputJson: unknown;
    projectCwd: string;
    runStatus?: string;
    stderr: string;
    stdout: string;
  },
): EvalGraderRecord {
  switch (grader.type) {
    case 'exit_code': {
      const actual = context.exitCode ?? null;
      const passed = Object.is(actual, grader.expected);
      return buildGraderRecord(
        grader.type,
        grader.expected,
        actual,
        passed,
        `exit_code expected ${grader.expected}, got ${String(actual)}`,
      );
    }
    case 'stdout_contains': {
      const actual = context.stdout.includes(grader.value);
      return buildGraderRecord(
        grader.type,
        grader.value,
        actual,
        actual,
        `stdout_contains expected to find ${JSON.stringify(grader.value)}, got ${actual}`,
      );
    }
    case 'stderr_contains': {
      const actual = context.stderr.includes(grader.value);
      return buildGraderRecord(
        grader.type,
        grader.value,
        actual,
        actual,
        `stderr_contains expected to find ${JSON.stringify(grader.value)}, got ${actual}`,
      );
    }
    case 'run_status': {
      const actual = context.runStatus ?? null;
      const passed = actual === grader.expected;
      return buildGraderRecord(
        grader.type,
        grader.expected,
        actual,
        passed,
        `run_status expected ${grader.expected}, got ${String(actual)}`,
      );
    }
    case 'harness_status': {
      const actual = context.harnessStatus ?? null;
      const passed = actual === grader.expected;
      return buildGraderRecord(
        grader.type,
        grader.expected,
        actual,
        passed,
        `harness_status expected ${grader.expected}, got ${String(actual)}`,
      );
    }
    case 'output_contains': {
      const actual = context.output.includes(grader.value);
      return buildGraderRecord(
        grader.type,
        grader.value,
        actual,
        actual,
        `output_contains expected to find ${JSON.stringify(grader.value)}, got ${actual}`,
      );
    }
    case 'output_json_path_equals': {
      const actual = getJsonPathValue(grader.path, context.outputJson);
      const passed = Object.is(actual, grader.expected);
      return buildGraderRecord(
        grader.type,
        grader.expected,
        actual,
        passed,
        `output_json_path_equals ${grader.path} expected ${stringify(grader.expected)}, got ${stringify(actual)}`,
      );
    }
    case 'changed_files_contains': {
      const actual = pathIsPresent(
        context.changedFiles,
        context.projectCwd,
        grader.path,
      );
      return buildGraderRecord(
        grader.type,
        true,
        actual,
        actual,
        `changed_files_contains expected ${grader.path}`,
      );
    }
    case 'file_exists': {
      const actual = existsSync(resolve(context.projectCwd, grader.path));
      return buildGraderRecord(
        grader.type,
        true,
        actual,
        actual,
        `file_exists expected ${grader.path}`,
      );
    }
    default:
      return {
        actual: null,
        expected: null,
        message: `Unsupported grader type "${String((grader as {type: string}).type)}".`,
        status: 'blocked',
        type: (grader as {type: string}).type,
      };
  }
}

function buildGraderRecord(
  type: string,
  expected: unknown,
  actual: unknown,
  passed: boolean,
  failureMessage: string,
): EvalGraderRecord {
  return {
    actual,
    expected,
    message: passed ? `${type} passed` : failureMessage,
    status: passed ? 'passed' : 'failed',
    type,
  };
}

function caseStatusFromGraders(
  graders: EvalGraderRecord[],
  executionStatus?: string,
): 'success' | 'failed' | 'blocked' {
  if (graders.some(grader => grader.status === 'blocked')) {
    return 'blocked';
  }
  if (graders.some(grader => grader.status === 'failed')) {
    return 'failed';
  }
  if (executionStatus === 'timed_out') {
    return 'failed';
  }
  return 'success';
}

function buildErrorCaseRecord(options: {
  caseDefinition: EvalCaseDefinition;
  error: unknown;
  finishedAt: Date;
  startedAt: Date;
}): EvalCaseRecord {
  const status = isBlockedError(options.error) ? 'blocked' : 'failed';
  return {
    execution: buildErrorExecution(options.caseDefinition),
    finishedAt: options.finishedAt.toISOString(),
    graders: [
      {
        actual: null,
        expected: null,
        message: errorMessage(options.error),
        status,
        type: 'case_error',
      },
    ],
    id: options.caseDefinition.id,
    kind: options.caseDefinition.type,
    startedAt: options.startedAt.toISOString(),
    status,
  };
}

function buildErrorExecution(
  caseDefinition: EvalCaseDefinition,
): EvalCaseExecutionRecord {
  const executionStatus = 'failed' as const;
  switch (caseDefinition.type) {
    case 'command':
      return {
        command: caseDefinition.command,
        cwd: caseDefinition.cwd ?? '',
        exitCode: null,
        stderr: '',
        status: executionStatus,
        stdout: '',
        timedOut: false,
        type: 'command',
      };
    case 'agent':
      return {
        agent: caseDefinition.agent,
        outputPath: '',
        runDir: '',
        status: executionStatus,
        task: caseDefinition.task,
        type: 'agent',
      };
    case 'harness':
      return {
        harness: caseDefinition.harness,
        runDir: '',
        status: executionStatus,
        type: 'harness',
      };
  }
}

function buildPackFailureRecord(options: {
  error: unknown;
  evalName: string;
  finishedAt: Date;
  packPath?: string;
  projectCwd: string;
  requestedPack: string;
  runDir: string;
  startedAt: Date;
}): EvalRunRecord {
  const status = isBlockedError(options.error) ? 'blocked' : 'failed';
  const message = errorMessage(options.error);
  return {
    cases: [],
    completedAt: options.finishedAt.toISOString(),
    counts: {blocked: 0, failed: 0, passed: 0, total: 0},
    evalName: options.evalName,
    error: message,
    finishedAt: options.finishedAt.toISOString(),
    packPath: options.packPath,
    projectCwd: options.projectCwd,
    requestedPack: options.requestedPack,
    runDir: options.runDir,
    startedAt: options.startedAt.toISOString(),
    status,
  };
}

function incrementCounts(
  counts: EvalRunSummaryCounts,
  status: EvalRunStatus | 'success' | 'failed' | 'blocked',
): void {
  if (status === 'success') {
    counts.passed += 1;
    return;
  }

  if (status === 'failed') {
    counts.failed += 1;
    return;
  }

  if (status === 'blocked') {
    counts.blocked += 1;
  }
}

function pathIsPresent(
  values: string[],
  projectCwd: string,
  expectedPath: string,
): boolean {
  const resolved = resolve(projectCwd, expectedPath);
  return values.includes(expectedPath) || values.includes(resolved);
}

function normalizeHarnessStatus(
  status: string | undefined,
): EvalHarnessExecutionRecord['status'] {
  switch (status) {
    case 'success':
    case 'failed':
    case 'blocked':
    case 'timed_out':
    case 'interrupted':
      return status;
    default:
      return 'blocked';
  }
}

function parseJsonOutput(output: string): unknown {
  const trimmed = output.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function stringify(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value);
}

async function importTransformedEvalPack(
  packPath: string,
): Promise<{default?: unknown}> {
  const source = await readFile(packPath, 'utf8');
  const localEvalModule = new URL('./index.ts', import.meta.url).href;
  const rewritten = source.replace(
    /from\s+(['"])agentq\/eval\1/g,
    `from '${localEvalModule}'`,
  );
  const transpiler = new Bun.Transpiler({loader: 'ts', target: 'bun'});
  const transpiled = transpiler.transformSync(rewritten, 'ts');
  const dataUrl = `data:text/javascript;base64,${Buffer.from(
    transpiled,
    'utf8',
  ).toString('base64')}`;
  return (await import(dataUrl)) as {default?: unknown};
}

function shouldFallbackToTranspiledImport(error: unknown): boolean {
  const message = errorMessage(error);
  return (
    message.includes('Cannot find module') ||
    message.includes('agentq/eval') ||
    message.includes('Cannot resolve module')
  );
}

function isBlockedError(error: unknown): boolean {
  return error instanceof AgentQError;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function readTextOrEmpty(path: string): Promise<string> {
  if (!existsSync(path)) {
    return '';
  }
  return readFile(path, 'utf8');
}

async function writeResults(
  paths: EvalRunPaths,
  record: EvalRunRecord,
): Promise<void> {
  await writeFile(
    paths.resultsPath,
    `${JSON.stringify(record, null, 2)}\n`,
    'utf8',
  );
}

async function writeLog(paths: EvalRunPaths, event: unknown): Promise<void> {
  await appendFile(paths.logPath, `${JSON.stringify(event)}\n`, 'utf8');
}
