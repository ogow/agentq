import type {AgentProvider} from '../providers/provider';
import type {RunStatus} from '../core/types';

export type EvalRunStatus = 'success' | 'failed' | 'blocked';

export type EvalCaseStatus = EvalRunStatus;

export type EvalCaseKind = 'command' | 'agent' | 'harness';

export interface EvalDefinition {
  name: string;
  cases: EvalCaseDefinition[];
}

export type EvalCaseDefinition =
  | EvalCommandCaseDefinition
  | EvalAgentCaseDefinition
  | EvalHarnessCaseDefinition;

export interface EvalBaseCaseDefinition {
  graders: EvalGraderDefinition[];
  id: string;
}

export interface EvalCommandCaseDefinition extends EvalBaseCaseDefinition {
  command: string[];
  cwd?: string;
  timeout?: string;
  type: 'command';
}

export interface EvalAgentCaseDefinition extends EvalBaseCaseDefinition {
  agent: string;
  overrides?: EvalAgentOverrides;
  task: string;
  type: 'agent';
}

export interface EvalHarnessCaseDefinition extends EvalBaseCaseDefinition {
  harness: string;
  inputFile?: string;
  inputText?: string;
  inputs?: Record<string, unknown>;
  type: 'harness';
}

export interface EvalAgentOverrides {
  approval?: string;
  contextFile?: string;
  model?: string;
  provider?: string;
  reasoning?: string;
  resultMode?: string;
  sandbox?: string;
  timeout?: string;
}

export type EvalGraderDefinition =
  | EvalExitCodeGraderDefinition
  | EvalStdoutContainsGraderDefinition
  | EvalStderrContainsGraderDefinition
  | EvalRunStatusGraderDefinition
  | EvalHarnessStatusGraderDefinition
  | EvalOutputContainsGraderDefinition
  | EvalOutputJsonPathEqualsGraderDefinition
  | EvalChangedFilesContainsGraderDefinition
  | EvalFileExistsGraderDefinition;

export interface EvalExitCodeGraderDefinition {
  expected: number;
  type: 'exit_code';
}

export interface EvalStdoutContainsGraderDefinition {
  type: 'stdout_contains';
  value: string;
}

export interface EvalStderrContainsGraderDefinition {
  type: 'stderr_contains';
  value: string;
}

export interface EvalRunStatusGraderDefinition {
  expected: RunStatus;
  type: 'run_status';
}

export interface EvalHarnessStatusGraderDefinition {
  expected: 'success' | 'failed' | 'blocked' | 'timed_out' | 'interrupted';
  type: 'harness_status';
}

export interface EvalOutputContainsGraderDefinition {
  type: 'output_contains';
  value: string;
}

export interface EvalOutputJsonPathEqualsGraderDefinition {
  expected: unknown;
  path: string;
  type: 'output_json_path_equals';
}

export interface EvalChangedFilesContainsGraderDefinition {
  path: string;
  type: 'changed_files_contains';
}

export interface EvalFileExistsGraderDefinition {
  path: string;
  type: 'file_exists';
}

export interface EvalRunRequest {
  pack: string;
  projectCwd: string;
  provider?: AgentProvider;
}

export interface EvalRunPaths {
  logPath: string;
  resultsPath: string;
  runDir: string;
}

export interface EvalRunSummaryCounts {
  blocked: number;
  failed: number;
  passed: number;
  total: number;
}

export interface EvalRunRecord {
  cases: EvalCaseRecord[];
  completedAt?: string;
  counts: EvalRunSummaryCounts;
  evalName: string;
  error?: string;
  finishedAt: string;
  packPath?: string;
  projectCwd: string;
  requestedPack: string;
  runDir: string;
  startedAt: string;
  status: EvalRunStatus;
}

export interface EvalCaseRecord {
  execution: EvalCaseExecutionRecord;
  finishedAt: string;
  graders: EvalGraderRecord[];
  id: string;
  kind: EvalCaseKind;
  nestedRunDir?: string;
  startedAt: string;
  status: EvalCaseStatus;
}

export type EvalCaseExecutionRecord =
  | EvalCommandExecutionRecord
  | EvalAgentExecutionRecord
  | EvalHarnessExecutionRecord;

export interface EvalCommandExecutionRecord {
  command: string[];
  cwd: string;
  exitCode: number | null;
  stderr: string;
  stdout: string;
  status: 'success' | 'failed' | 'timed_out';
  timedOut: boolean;
  type: 'command';
}

export interface EvalAgentExecutionRecord {
  agent: string;
  outputPath: string;
  runDir: string;
  task: string;
  status: RunStatus;
  type: 'agent';
}

export interface EvalHarnessExecutionRecord {
  harness: string;
  runDir: string;
  status: 'success' | 'failed' | 'blocked' | 'timed_out' | 'interrupted';
  type: 'harness';
}

export interface EvalGraderRecord {
  actual?: unknown;
  expected?: unknown;
  message: string;
  status: 'passed' | 'failed' | 'blocked';
  type: string;
}

export interface EvalStartedLogEvent {
  evalName: string;
  kind: 'eval_started';
  packPath?: string;
  requestedPack: string;
  timestamp: string;
}

export interface EvalCaseLogEvent {
  caseId: string;
  evalName: string;
  kind: 'case_started' | 'case_finished';
  message?: string;
  nestedRunDir?: string;
  status?: EvalCaseStatus;
  timestamp: string;
}

export interface EvalFinishedLogEvent {
  counts: EvalRunSummaryCounts;
  evalName: string;
  kind: 'eval_finished';
  message?: string;
  status: EvalRunStatus;
  timestamp: string;
}

export type EvalLogEvent =
  | EvalStartedLogEvent
  | EvalCaseLogEvent
  | EvalFinishedLogEvent;
