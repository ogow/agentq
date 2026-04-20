#!/usr/bin/env bun
import {readFile} from 'node:fs/promises';
import yargs from 'yargs';
import {hideBin} from 'yargs/helpers';
import {AgentQError} from './core/errors';
import {listRunHistory, parseRunLookbackMs} from './core/history';
import {
  formatHarnessSummary,
  followHarnessLogEvents,
  formatHarnessLogEvent,
  inspectHarnessRun,
  readHarnessLogEvents,
  runHarness,
} from './core/harness';
import {formatRunHistoryTable, formatRunSummary} from './core/render';
import {listAgents} from './core/paths';
import {runAgent} from './core/run';
import {formatWorkStatus, listWorkStatus, stopWork} from './core/status';
import type {RunMetadata} from './core/metadata';
import type {
  ApprovalPolicy,
  LogLevel,
  ProviderId,
  ReasoningEffort,
  ResultMode,
  SandboxMode,
} from './core/types';

const LOG_LEVEL_CHOICES = [
  'progress',
  'messages',
  'verbose',
  'json',
  'json-messages',
] as const;

async function main(): Promise<void> {
  const argv = hideBin(process.argv);
  await buildCli(argv).parseAsync();
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    if (error instanceof AgentQError) {
      process.stderr.write(`agentq: ${error.message}\n`);
    } else if (error instanceof Error) {
      process.stderr.write(`agentq: ${error.message}\n`);
    } else {
      process.stderr.write('agentq: unknown error\n');
    }
    process.exitCode = 1;
  });
}

async function printRunSummary(
  result: Awaited<ReturnType<typeof runAgent>>,
  options: {color?: boolean; details?: boolean},
) {
  const output = await readOutput(result.paths.outputPath);
  const metadata = await readRunMetadata(result.paths.runJsonPath);

  process.stdout.write(`${formatRunSummary(metadata, output, options)}\n`);
}

async function readOutput(outputPath: string): Promise<string> {
  try {
    return (await readFile(outputPath, 'utf8')).trim();
  } catch {
    return '';
  }
}

async function readRunMetadata(runJsonPath: string): Promise<RunMetadata> {
  return JSON.parse(await readFile(runJsonPath, 'utf8')) as RunMetadata;
}

export function buildCli(argv: string[]) {
  return yargs(argv)
    .scriptName('agentq')
    .usage('$0 <command>')
    .option('color', {
      describe: 'Colorize terminal output',
      type: 'boolean',
    })
    .command('harness <command>', 'Run and inspect harnesses', command =>
      command
        .command(
          'run <name>',
          'Run a harness',
          builder =>
            builder
              .positional('name', {
                describe: 'Harness name to run',
                type: 'string',
              })
              .option('input-file', {
                describe:
                  'JSON file with harness inputs, raw text file, or - for stdin',
                type: 'string',
              })
              .option('input-text', {
                describe: 'Freeform harness input text',
                type: 'string',
              })
              .option('color', {
                describe: 'Colorize terminal output',
                type: 'boolean',
              })
              .option('verbose', {
                default: false,
                describe: 'Stream agent activity while steps run',
                type: 'boolean',
              })
              .option('log-level', {
                choices: LOG_LEVEL_CHOICES,
                describe:
                  'Run logging: progress, messages, verbose, json, or json-messages',
                type: 'string',
              })
              .check(argv => {
                if (argv.inputFile && argv.inputText !== undefined) {
                  throw new AgentQError(
                    'Use either --input-file or --input-text, not both.',
                  );
                }
                return true;
              }),
          async argv => {
            const result = await runHarness({
              color: argv.color,
              inputFile: argv.inputFile,
              inputText: argv.inputText,
              logLevel: logLevelFromArg(argv.logLevel, argv.verbose),
              name: String(argv.name),
              projectCwd: process.cwd(),
              verbose: argv.verbose,
            });

            process.stdout.write(`${formatHarnessSummary(result)}\n`);
            if (result.status !== 'success') {
              process.exitCode = 1;
            }
          },
        )
        .command(
          'inspect <run>',
          'Inspect a harness run',
          builder =>
            builder.positional('run', {
              describe: 'Harness run id or directory',
              type: 'string',
            }),
          async argv => {
            const result = await inspectHarnessRun(String(argv.run));
            process.stdout.write(`${formatHarnessSummary(result)}\n`);
          },
        )
        .command(
          'logs <run>',
          'Print a harness run event timeline',
          builder =>
            builder
              .positional('run', {
                describe: 'Harness run id or directory',
                type: 'string',
              })
              .option('step', {
                describe: 'Only show events for one step id or step prefix',
                type: 'string',
              })
              .option('failed', {
                default: false,
                describe: 'Only show failed steps or failed tool events',
                type: 'boolean',
              })
              .option('follow', {
                alias: 'f',
                default: false,
                describe: 'Wait for new events while the harness is running',
                type: 'boolean',
              }),
          async argv => {
            const request = {
              failed: argv.failed,
              follow: argv.follow,
              run: String(argv.run),
              step: argv.step,
            };
            const events = await readHarnessLogEvents(request);
            for (const event of events) {
              const line = formatHarnessLogEvent(event);
              if (line.length === 0) {
                continue;
              }
              process.stdout.write(`${line}\n`);
            }
            if (argv.follow) {
              await followHarnessLogEvents(request, event => {
                const line = formatHarnessLogEvent(event);
                if (line.length === 0) {
                  return;
                }
                process.stdout.write(`${line}\n`);
              });
            }
          },
        )
        .demandCommand(1, 'Choose a harness command.'),
    )
    .command(
      'run <agent>',
      'Run an agent with a task',
      command =>
        command
          .positional('agent', {
            describe: 'Agent id to run',
            type: 'string',
          })
          .option('task', {
            demandOption: true,
            describe: 'Task text for the agent',
            type: 'string',
          })
          .option('model', {
            describe: 'Model for the run',
            type: 'string',
          })
          .option('provider', {
            choices: ['codex'] as const,
            describe: 'Provider adapter for the run',
            type: 'string',
          })
          .option('reasoning', {
            choices: [
              'none',
              'minimal',
              'low',
              'medium',
              'high',
              'xhigh',
            ] as const,
            describe: 'Reasoning effort for the run',
            type: 'string',
          })
          .option('result-mode', {
            choices: ['plain', 'json'] as const,
            describe: 'Final output contract for the run',
            type: 'string',
          })
          .option('timeout', {
            describe: 'Maximum runtime, such as 100ms, 1m, or 1h',
            type: 'string',
          })
          .option('sandbox', {
            choices: [
              'read-only',
              'workspace-write',
              'danger-full-access',
            ] as const,
            describe: 'Codex sandbox mode for the run',
            type: 'string',
          })
          .option('approval', {
            choices: [
              'untrusted',
              'on-failure',
              'on-request',
              'never',
            ] as const,
            describe: 'Codex approval policy for the run',
            type: 'string',
          })
          .option('context-file', {
            describe: 'Project instruction/context file Codex should discover',
            type: 'string',
          })
          .option('color', {
            describe: 'Colorize terminal output',
            type: 'boolean',
          })
          .option('details', {
            default: false,
            describe: 'Print detailed run metadata and artifact paths',
            type: 'boolean',
          })
          .option('verbose', {
            default: false,
            describe: 'Stream JSONL-derived activity while the run is active',
            type: 'boolean',
          })
          .option('log-level', {
            choices: LOG_LEVEL_CHOICES,
            describe:
              'Run logging: progress, messages, verbose, json, or json-messages',
            type: 'string',
          }),
      async argv => {
        const agentId = String(argv.agent);
        const logLevel = logLevelFromArg(argv.logLevel, argv.verbose);
        const result = await runAgent({
          agentId,
          color: argv.color,
          logLevel,
          overrides: {
            approval: argv.approval as ApprovalPolicy | undefined,
            contextFile: argv.contextFile,
            model: argv.model,
            provider: argv.provider as ProviderId | undefined,
            reasoning: argv.reasoning as ReasoningEffort | undefined,
            resultMode: argv.resultMode as ResultMode | undefined,
            sandbox: argv.sandbox as SandboxMode | undefined,
            timeout: argv.timeout,
          },
          projectCwd: process.cwd(),
          task: argv.task,
          verbose: argv.verbose,
        });

        await printRunSummary(result, {
          color: argv.color,
          details: argv.details || logLevel === 'verbose',
        });

        if (result.status !== 'succeeded') {
          process.exitCode = 1;
        }
      },
    )
    .command(
      'status',
      'Show active or suspicious AgentQ work',
      command =>
        command
          .option('all', {
            default: false,
            describe: 'Include completed runs',
            type: 'boolean',
          })
          .option('json', {
            default: false,
            describe: 'Print machine-readable JSON',
            type: 'boolean',
          }),
      async argv => {
        const items = await listWorkStatus({all: argv.all});
        process.stdout.write(
          argv.json
            ? `${JSON.stringify(items, null, 2)}\n`
            : `${formatWorkStatus(items)}\n`,
        );
      },
    )
    .command(
      'stop <run>',
      'Stop a running AgentQ agent or harness by run id',
      command =>
        command.positional('run', {
          describe: 'Agent or harness run id or directory',
          type: 'string',
        }),
      async argv => {
        const item = await stopWork(String(argv.run));
        process.stdout.write(`${formatWorkStatus([item])}\n`);
      },
    )
    .command(
      'runs list',
      'List previous runs',
      command =>
        command
          .option('since', {
            describe:
              'Only show runs from the last duration, such as 1h, 7d, or 2w',
            type: 'string',
          })
          .option('limit', {
            default: 20,
            describe: 'Maximum number of runs to show',
            type: 'number',
          })
          .option('color', {
            describe: 'Colorize terminal output',
            type: 'boolean',
          })
          .check(argv => {
            if (
              !Number.isInteger(argv.limit) ||
              argv.limit === undefined ||
              argv.limit <= 0
            ) {
              throw new AgentQError('--limit must be a positive integer.');
            }
            return true;
          }),
      async argv => {
        const since = argv.since ? String(argv.since) : undefined;
        const limit = Number(argv.limit);
        const runs = await listRunHistory({
          limit,
          sinceMs: since ? parseRunLookbackMs(since) : undefined,
        });

        process.stdout.write(
          `${formatRunHistoryTable(
            runs.map(run => run.metadata),
            {
              color: argv.color,
              limit,
              since,
            },
          )}\n`,
        );
      },
    )
    .command(
      'agents list',
      'List available agents',
      () => undefined,
      async () => {
        const agents = await listAgents(process.cwd());

        if (agents.length === 0) {
          process.stdout.write(
            'No agents found in .agentq/agents or ~/.agentq/agents.\n',
          );
          return;
        }

        for (const agent of agents) {
          process.stdout.write(
            `${agent.id}\t${agent.scope}\t${agent.description}\t${agent.filePath}\n`,
          );
        }
      },
    )
    .demandCommand(1, 'Choose a command.')
    .strict()
    .help()
    .fail((message, error) => {
      throw error ?? new AgentQError(message);
    });
}

function logLevelFromArg(
  logLevel: string | undefined,
  verbose: boolean | undefined,
): LogLevel | undefined {
  if (logLevel) {
    return logLevel as LogLevel;
  }
  return verbose ? 'verbose' : undefined;
}
