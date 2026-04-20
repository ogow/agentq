import {describe, expect, test} from 'bun:test';
import {mkdtempSync, existsSync} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {
  formatEvalRunInspection,
  inspectEvalRun,
  loadEvalPack,
  runEval,
} from '../src/eval';
import type {AgentProvider} from '../src/providers/provider';

describe('eval packs', () => {
  test('loads a project TypeScript eval pack by name and runs command graders', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-eval-'));
    const restoreHome = useHome(root);
    const projectCwd = join(root, 'project');
    await writeEvalPack(
      projectCwd,
      'smoke',
      `import {defineEval, graders} from 'agentq/eval';

export default defineEval({
  name: 'smoke',
  cases: [
    {
      id: 'command-smoke',
      type: 'command',
      command: [
        'bun',
        '-e',
        'await Bun.write("created.txt", "ok"); console.log("AgentQ Runs");',
      ],
      graders: [
        graders.exitCode(0),
        graders.stdoutContains('AgentQ Runs'),
        graders.fileExists('created.txt'),
      ],
    },
  ],
});
`,
    );

    try {
      const pack = await loadEvalPack(projectCwd, 'smoke');
      const result = await runEval({
        pack: 'smoke',
        projectCwd,
      });
      const inspect = await inspectEvalRun(result.runDir);
      const results = JSON.parse(
        await readFile(join(result.runDir, 'results.json'), 'utf8'),
      ) as {cases: Array<{graders: Array<{status: string}>}>; status: string};
      const log = await readFile(join(result.runDir, 'log.jsonl'), 'utf8');

      expect(pack.definition.name).toBe('smoke');
      expect(result.status).toBe('success');
      expect(result.counts).toEqual({
        blocked: 0,
        failed: 0,
        passed: 1,
        total: 1,
      });
      expect(result.cases[0].graders.map(grader => grader.status)).toEqual([
        'passed',
        'passed',
        'passed',
      ]);
      expect(results.status).toBe('success');
      expect(results.cases).toHaveLength(1);
      expect(inspect.runDir).toBe(result.runDir);
      expect(existsSync(join(result.runDir, 'results.json'))).toBe(true);
      expect(existsSync(join(result.runDir, 'log.jsonl'))).toBe(true);
      expect(log).toContain('"kind":"eval_started"');
      expect(log).toContain('"kind":"eval_finished"');
    } finally {
      restoreHome();
    }
  });

  test('rejects an invalid eval module shape with a useful error', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-eval-'));
    const restoreHome = useHome(root);
    const projectCwd = join(root, 'project');
    await writeEvalPack(
      projectCwd,
      'invalid',
      `export default {
  name: 'invalid',
  cases: [],
};
`,
    );

    try {
      await expect(loadEvalPack(projectCwd, 'invalid')).rejects.toThrow(
        /defineEval/,
      );
    } finally {
      restoreHome();
    }
  });

  test('stores nested run pointers for agent cases', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-eval-'));
    const restoreHome = useHome(root);
    const projectCwd = join(root, 'project');
    await writeAgent(projectCwd, 'task-splitter');
    await writeEvalPack(
      projectCwd,
      'agent-smoke',
      `import {defineEval, graders} from 'agentq/eval';

export default defineEval({
  name: 'agent-smoke',
  cases: [
    {
      id: 'splitter-json-contract',
      type: 'agent',
      agent: 'task-splitter',
      task: 'Return JSON with status success.',
      graders: [
        graders.runStatus('succeeded'),
        graders.outputJsonPathEquals('$.status', 'success'),
      ],
    },
  ],
});
`,
    );
    const provider = outputProvider([{status: 'success'}]);

    try {
      const result = await runEval({
        pack: 'agent-smoke',
        projectCwd,
        provider,
      });
      const results = JSON.parse(
        await readFile(join(result.runDir, 'results.json'), 'utf8'),
      ) as {
        cases: Array<{nestedRunDir?: string; status: string}>;
        status: string;
      };

      expect(result.status).toBe('success');
      expect(result.cases[0].nestedRunDir).toBeTruthy();
      expect(results.cases[0].nestedRunDir).toBeTruthy();
      expect(results.status).toBe('success');
    } finally {
      restoreHome();
    }
  });

  test('keeps failed output_contains evidence out of eval results', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-eval-'));
    const restoreHome = useHome(root);
    const projectCwd = join(root, 'project');
    const rawOutput = 'RAW_NESTED_AGENT_OUTPUT_DO_NOT_DUPLICATE';
    await writeAgent(projectCwd, 'task-splitter');
    await writeEvalPack(
      projectCwd,
      'output-smoke',
      `import {defineEval, graders} from 'agentq/eval';

export default defineEval({
  name: 'output-smoke',
  cases: [
    {
      id: 'splitter-output-contract',
      type: 'agent',
      agent: 'task-splitter',
      task: 'Return JSON with status success.',
      graders: [graders.outputContains('needle')],
    },
  ],
});
`,
    );
    const provider = outputProvider([{secret: rawOutput}]);

    try {
      const result = await runEval({
        pack: 'output-smoke',
        projectCwd,
        provider,
      });
      const resultsText = await readFile(
        join(result.runDir, 'results.json'),
        'utf8',
      );
      const results = JSON.parse(resultsText) as {
        cases: Array<{
          execution: {outputPath: string};
          graders: Array<{actual: boolean; message: string; status: string}>;
        }>;
        status: string;
      };
      const nestedOutput = await readFile(
        results.cases[0].execution.outputPath,
        'utf8',
      );

      expect(result.status).toBe('failed');
      expect(results.status).toBe('failed');
      expect(results.cases[0].graders[0].status).toBe('failed');
      expect(results.cases[0].graders[0].actual).toBe(false);
      expect(results.cases[0].graders[0].message).toContain('got false');
      expect(resultsText).not.toContain(rawOutput);
      expect(nestedOutput).toContain(rawOutput);
    } finally {
      restoreHome();
    }
  });

  test('stores harness status graders with nested harness run pointers', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-eval-'));
    const restoreHome = useHome(root);
    const projectCwd = join(root, 'project');
    await writeAgent(projectCwd, 'builder');
    await writeHarness(
      projectCwd,
      'work',
      `name: work
agent: builder
inputs:
  task: string
`,
    );
    await writeEvalPack(
      projectCwd,
      'harness-smoke',
      `import {defineEval, graders} from 'agentq/eval';

export default defineEval({
  name: 'harness-smoke',
  cases: [
    {
      id: 'work-status',
      type: 'harness',
      harness: 'work',
      inputText: 'build it',
      graders: [graders.harnessStatus('success')],
    },
  ],
});
`,
    );
    const provider = outputProvider([
      {status: 'success', summary: 'Built the thing.'},
    ]);

    try {
      const result = await runEval({
        pack: 'harness-smoke',
        projectCwd,
        provider,
      });
      const results = JSON.parse(
        await readFile(join(result.runDir, 'results.json'), 'utf8'),
      ) as {
        cases: Array<{
          execution: {status: string};
          graders: Array<{message: string; status: string}>;
          nestedRunDir?: string;
        }>;
        status: string;
      };

      expect(result.status).toBe('success');
      expect(results.status).toBe('success');
      expect(result.cases[0].nestedRunDir).toBeTruthy();
      expect(results.cases[0].nestedRunDir).toBeTruthy();
      expect(
        existsSync(join(results.cases[0].nestedRunDir!, 'tasks.json')),
      ).toBe(true);
      expect(results.cases[0].execution.status).toBe('success');
      expect(results.cases[0].graders[0].status).toBe('passed');
      expect(results.cases[0].graders[0].message).toBe('harness_status passed');
    } finally {
      restoreHome();
    }
  });

  test('persists invalid pack load errors in eval results and inspection output', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-eval-'));
    const restoreHome = useHome(root);
    const projectCwd = join(root, 'project');
    await writeEvalPack(
      projectCwd,
      'broken',
      `export default {
  name: 'broken',
  cases: [],
};
`,
    );

    try {
      const result = await runEval({
        pack: 'broken',
        projectCwd,
      });
      const inspect = await inspectEvalRun(result.runDir);
      const results = JSON.parse(
        await readFile(join(result.runDir, 'results.json'), 'utf8'),
      ) as {error?: string; status: string};
      const log = await readFile(join(result.runDir, 'log.jsonl'), 'utf8');
      const rendered = formatEvalRunInspection(result);

      expect(result.status).toBe('blocked');
      expect(result.error).toContain('defineEval');
      expect(results.status).toBe('blocked');
      expect(results.error).toContain('defineEval');
      expect(log).toContain('"kind":"eval_finished"');
      expect(log).toContain('defineEval');
      expect(inspect.error).toContain('defineEval');
      expect(rendered).toContain('error:');
      expect(rendered).toContain('defineEval');
    } finally {
      restoreHome();
    }
  });
});

function useHome(homePath: string): () => void {
  const originalHome = process.env.HOME;
  process.env.HOME = homePath;
  return () => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  };
}

async function writeEvalPack(
  projectCwd: string,
  name: string,
  source: string,
): Promise<void> {
  const evalsDir = join(projectCwd, '.agentq', 'evals');
  await mkdir(evalsDir, {recursive: true});
  await writeFile(join(evalsDir, `${name}.ts`), source, 'utf8');
}

async function writeAgent(projectCwd: string, agentId: string): Promise<void> {
  const agentsDir = join(projectCwd, '.agentq', 'agents');
  await mkdir(agentsDir, {recursive: true});
  await writeFile(
    join(agentsDir, `${agentId}.md`),
    `---
id: ${agentId}
description: Test agent.
model: gpt-5.4
provider: codex
reasoning: none
result_mode: json
sandbox: workspace-write
timeout: 1m
---

<instructions>Return JSON.</instructions>

<task>
{{task}}
</task>

<artifacts>
Write output.md under {{artifacts}}.
</artifacts>
`,
    'utf8',
  );
}

async function writeHarness(
  projectCwd: string,
  name: string,
  yaml: string,
): Promise<void> {
  const harnessDir = join(projectCwd, '.agentq', 'harnesses');
  await mkdir(harnessDir, {recursive: true});
  await writeFile(join(harnessDir, `${name}.yaml`), yaml, 'utf8');
}

function outputProvider(outputs: unknown[]): AgentProvider {
  let index = 0;
  return {
    run: async prepared => {
      const output = outputs[index++] ?? {};
      await writeFile(
        prepared.paths.outputPath,
        `${JSON.stringify(output)}\n`,
        'utf8',
      );
      return {
        changedFiles: [],
        events: [{kind: 'run_started', provider: 'codex'}],
        exitCode: 0,
        stderr: '',
        timedOut: false,
        toolUsage: [],
      };
    },
  };
}
