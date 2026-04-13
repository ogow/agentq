import {Chalk, chalkStderr} from 'chalk';
import type {AgentQEvent, ChangedFileSummary, RunStatus} from './types';
import type {RunMetadata} from './metadata';

type ChalkStyle = typeof chalkStderr;

interface RenderStream {
  isTTY?: boolean;
  write: (chunk: string) => unknown;
}

export interface ProgressRenderer {
  onEvent: (event: AgentQEvent) => void;
  stop: () => void;
}

interface RenderOptions {
  color?: boolean;
  details?: boolean;
}

interface ProgressOptions extends RenderOptions {
  agentId: string;
  stream?: RenderStream;
  verbose?: boolean;
}

export function createProgressRenderer({
  agentId,
  color,
  stream = process.stderr,
  verbose,
}: ProgressOptions): ProgressRenderer {
  const style = createStyle(color);

  if (verbose) {
    return {
      onEvent: event => {
        const line = formatTimelineEvent(event, {color});
        if (line) {
          stream.write(`${line}\n`);
        }
      },
      stop: () => undefined,
    };
  }

  if (!stream.isTTY) {
    return {
      onEvent: () => undefined,
      stop: () => undefined,
    };
  }

  const frames = ['-', '\\', '|', '/'];
  let index = 0;
  let detail = 'starting';
  let lastPlainLength = 0;
  const prefix = `AgentQ ${agentId}`;

  const render = () => {
    const plain = `${prefix} ${frames[index]} ${detail}`;
    const line = [
      style.magenta.bold('AgentQ'),
      style.dim(agentId),
      style.cyan(frames[index]),
      style.white(detail),
    ].join(' ');
    stream.write(
      `\r${line}${' '.repeat(Math.max(0, lastPlainLength - plain.length))}`,
    );
    lastPlainLength = plain.length;
  };

  render();
  const interval = setInterval(() => {
    index = (index + 1) % frames.length;
    render();
  }, 120);

  return {
    onEvent: event => {
      detail = formatProgressDetail(event) ?? detail;
      render();
    },
    stop: () => {
      clearInterval(interval);
      stream.write('\r');
      stream.write(' '.repeat(lastPlainLength));
      stream.write('\r');
    },
  };
}

export function formatTimelineEvent(
  event: AgentQEvent,
  options: RenderOptions = {},
): string | undefined {
  const style = createStyle(options.color);
  const label = eventLabel(event);
  const detail = formatProgressDetail(event);

  if (!label || !detail) {
    return undefined;
  }

  return [
    style.dim(timestampLabel(event.timestamp)),
    colorLabel(label, event.kind, style),
    detail,
  ].join('  ');
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
  const tokenTotal = metadata.tokenUsage?.totalTokens;
  const rows = [
    row('agent', metadata.agent.id),
    row('result', statusText(metadata.status, style)),
    row('model', `${metadata.config.model} / ${metadata.config.reasoning}`),
    row('output', metadata.config.resultMode),
    row('duration', formatDuration(metadata.durationMs)),
    row('tools', toolTotals),
    row('edits', editTotals),
    row('events', String(metadata.eventCount)),
    ...(tokenTotal ? [row('tokens', formatNumber(tokenTotal))] : []),
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

  if (event.kind === 'assistant_message' && event.message) {
    return compact(event.message, 120);
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

  if (event.kind === 'token_usage' && event.tokenUsage?.totalTokens) {
    return `${formatNumber(event.tokenUsage.totalTokens)} total`;
  }

  return undefined;
}

function eventLabel(event: AgentQEvent): string | undefined {
  if (event.kind === 'run_started') {
    return 'start';
  }
  if (event.kind === 'assistant_message') {
    return 'think';
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

function compact(value: string, maxLength: number): string {
  const oneLine = value.trim().replace(/\s+/g, ' ');
  if (oneLine.length <= maxLength) {
    return oneLine;
  }

  return `${oneLine.slice(0, maxLength - 3)}...`;
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
