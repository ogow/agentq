#!/usr/bin/env bun
import {readFile} from 'node:fs/promises';
import yargs from 'yargs';
import {hideBin} from 'yargs/helpers';
import {AgentQError} from './core/errors';
import {listRunHistory, parseRunLookbackMs} from './core/history';
import {formatRunHistoryTable, formatRunSummary} from './core/render';
import {listAgents} from './core/paths';
import {runAgent} from './core/run';
import type {RunMetadata} from './core/metadata';
import type {
  ApprovalPolicy,
  ProviderId,
  ReasoningEffort,
  ResultMode,
  SandboxMode,
} from './core/types';

async function main(): Promise<void> {
  await yargs(hideBin(process.argv))
    .scriptName('agentq')
    .usage('$0 <command>')
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
          }),
      async argv => {
        const agentId = String(argv.agent);
        const result = await runAgent({
          agentId,
          color: argv.color,
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
          details: argv.details || argv.verbose,
        });

        if (result.status !== 'succeeded') {
          process.exitCode = 1;
        }
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
    })
    .parseAsync();
}

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
