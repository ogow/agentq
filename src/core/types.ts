import type {ProcessRegistry} from './processes';

export type SandboxMode =
  | 'read-only'
  | 'workspace-write'
  | 'danger-full-access';

export type ApprovalPolicy =
  | 'untrusted'
  | 'on-failure'
  | 'on-request'
  | 'never';

export type RunStatus =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'timed_out'
  | 'interrupted';

export type WorkKind = 'agent' | 'harness';

export interface RunParentLink {
  kind: WorkKind;
  runId: string;
  stepId?: string;
}

export interface ProcessMetadata {
  command: string;
  host: string;
  pid: number;
  startedAt: string;
  stoppedAt?: string;
  stopReason?: string;
}

export type AgentScope = 'project' | 'global';

export type ProviderId = 'codex';

export type ReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh';

export type ResultMode = 'plain' | 'json';

export type LogLevel =
  | 'progress'
  | 'messages'
  | 'verbose'
  | 'json'
  | 'json-messages';

export interface AgentFrontmatter {
  description: string;
  id: string;
  model: string;
  provider: ProviderId;
  reasoning: ReasoningEffort;
  resultMode: ResultMode;
  sandbox: SandboxMode;
  timeout: string;
  approval?: ApprovalPolicy;
  env?: Record<string, string>;
}

export interface AgentQConfig {
  contextFile?: string;
}

export interface ResolvedAgent {
  body: string;
  filePath: string;
  frontmatter: AgentFrontmatter;
  id: string;
  scope: AgentScope;
}

export interface RunOverrides {
  approval?: ApprovalPolicy;
  contextFile?: string;
  model?: string;
  provider?: ProviderId;
  reasoning?: ReasoningEffort;
  resultMode?: ResultMode;
  sandbox?: SandboxMode;
  timeout?: string;
}

export interface EffectiveRunConfig {
  agentId: string;
  approval?: ApprovalPolicy;
  contextFile?: string;
  env: Record<string, string>;
  model: string;
  provider: ProviderId;
  reasoning: ReasoningEffort;
  resultMode: ResultMode;
  sandbox: SandboxMode;
  timeout: string;
  timeoutMs: number;
}

export interface RunPaths {
  artifactsDirPath: string;
  outputPath: string;
  runJsonPath: string;
  runDir: string;
  stderrPath: string;
  stdoutPath: string;
}

export interface RunRequest {
  agentId: string;
  color?: boolean;
  logLevel?: LogLevel;
  onEvent?: (event: AgentQEvent) => void;
  overrides?: RunOverrides;
  runtimeParent?: RunParentLink;
  processRegistry?: ProcessRegistry;
  progress?: boolean;
  projectCwd: string;
  task: string;
  verbose?: boolean;
}

export interface PreparedRun {
  agent: ResolvedAgent;
  config: EffectiveRunConfig;
  contextFilePath?: string;
  paths: RunPaths;
  projectCwd: string;
  prompt: string;
  task: string;
}

export interface ProviderRunResult {
  changedFiles: ChangedFileSummary[];
  events: AgentQEvent[];
  exitCode: number | null;
  interrupted?: boolean;
  stderr: string;
  timedOut: boolean;
  toolUsage: ToolUsageSummary[];
}

export interface RunResult {
  agentId: string;
  exitCode: number | null;
  paths: RunPaths;
  runDir: string;
  status: RunStatus;
  timedOut: boolean;
}

export interface AgentListEntry {
  description: string;
  filePath: string;
  id: string;
  scope: AgentScope;
}

export type AgentQEventKind =
  | 'assistant_message'
  | 'failure'
  | 'run_completed'
  | 'run_started'
  | 'token_usage'
  | 'tool_finished'
  | 'tool_started'
  | 'unknown';

export interface AgentQEvent {
  callId?: string;
  command?: string;
  exitCode?: number | null;
  files?: ChangedFileSummary[];
  kind: AgentQEventKind;
  message?: string;
  phase?: string;
  provider: ProviderId;
  rawType?: string;
  status?: 'completed' | 'failed' | 'running';
  timestamp?: string;
  tokenUsage?: TokenUsageSummary;
  toolName?: string;
}

export interface TokenUsageSummary {
  cachedInputTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  totalTokens?: number;
}

export interface RunTokenUsageSummary {
  cachedInputTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  totalTokens?: number;
}

export interface ChangedFileSummary {
  operation: 'add' | 'delete' | 'move' | 'update' | 'unknown';
  path: string;
  source: string;
}

export interface ToolUsageSummary {
  calls: number;
  failures: number;
  name: string;
  successes: number;
}

export interface RunFailureMetadata {
  exitCode?: number | null;
  kind: 'provider_error' | 'provider_exit' | 'timeout';
  message: string;
  stderrTail?: string;
  timedOut: boolean;
}

export type HarnessStepStatus = 'success' | 'failed' | 'blocked';

export type FailureKind =
  | 'implementation'
  | 'check'
  | 'review'
  | 'plan'
  | 'blocked'
  | 'environment';

export interface AgentFeedback {
  problem: string;
  cause?: string;
  evidence?: string[];
  fix?: string;
}

export interface ArtifactRef {
  name: string;
  kind: 'file' | 'directory' | 'log' | 'patch' | 'json' | 'text';
  path: string;
  description?: string;
}

export interface AgentOutput {
  status: HarnessStepStatus;
  summary: string;
  result: unknown | null;
  feedback: AgentFeedback | null;
  artifacts: ArtifactRef[];
  failureKind?: FailureKind;
}

export interface StepResult extends AgentOutput {
  stepId: string;
  kind: 'agent' | 'command' | 'loop';
  startedAt: string;
  finishedAt: string;
  runDir?: string;
  command?: string;
  exitCode?: number | null;
}
