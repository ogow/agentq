import {describe, expect, test} from 'bun:test';
import {mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {mkdtempSync} from 'node:fs';
import {
  buildEffectiveRunConfig,
  readAgentFile,
  renderAgentPrompt,
} from '../src/core/agent';
import {loadAgentQConfig} from '../src/core/config';
import {resolveAgent} from '../src/core/paths';

const VALID_AGENT = `---
id: example
description: Test agent used by AgentQ unit tests.
model: gpt-5.4
provider: codex
reasoning: none
result_mode: plain
sandbox: workspace-write
timeout: 1m
---

<instructions>
Be useful.
</instructions>

<task>
{{task}}
</task>

<artifacts>
Write output.md under {{artifacts}}.
</artifacts>
`;

describe('agent files', () => {
  test('reads frontmatter and renders task anchor', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-'));
    const filePath = join(root, 'example.md');
    await writeFile(filePath, VALID_AGENT, 'utf8');

    const agent = await readAgentFile(filePath, 'project');
    const prompt = renderAgentPrompt(agent, 'do the thing');

    expect(agent.id).toBe('example');
    expect(agent.frontmatter.description).toBe(
      'Test agent used by AgentQ unit tests.',
    );
    expect(prompt).toContain('<task>\ndo the thing\n</task>');
  });

  test('replaces the artifacts placeholder with the run artifact directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-'));
    const filePath = join(root, 'example.md');
    await writeFile(filePath, VALID_AGENT, 'utf8');

    const agent = await readAgentFile(filePath, 'project');
    const prompt = renderAgentPrompt(
      agent,
      'do the thing',
      '/tmp/agentq-run/artifacts',
    );

    expect(prompt).toContain(
      'Write output.md under /tmp/agentq-run/artifacts.',
    );
    expect(prompt).not.toContain('{{artifacts}}');
    expect(prompt).not.toContain('AgentQ artifact directory:');
  });

  test('adds result mode instructions to the artifacts anchor', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-'));
    const filePath = join(root, 'example.md');
    await writeFile(filePath, VALID_AGENT, 'utf8');

    const agent = await readAgentFile(filePath, 'project');
    const prompt = renderAgentPrompt(
      agent,
      'do the thing',
      '/tmp/agentq-run/artifacts',
      'json',
    );

    expect(prompt).toContain('AgentQ result mode:\njson');
    expect(prompt).toContain('Final output must be valid JSON only');
  });

  test('adds the run artifact directory to legacy artifacts anchors', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-'));
    const filePath = join(root, 'example.md');
    await writeFile(
      filePath,
      VALID_AGENT.replace(
        'Write output.md under {{artifacts}}.',
        'Write output.md.',
      ),
      'utf8',
    );

    const agent = await readAgentFile(filePath, 'project');
    const prompt = renderAgentPrompt(
      agent,
      'do the thing',
      '/tmp/agentq-run/artifacts',
    );

    expect(prompt).toContain('Write output.md.');
    expect(prompt).toContain('AgentQ artifact directory:');
    expect(prompt).toContain('/tmp/agentq-run/artifacts');
  });

  test('applies CLI override precedence over frontmatter', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-'));
    const filePath = join(root, 'example.md');
    await writeFile(filePath, VALID_AGENT, 'utf8');

    const agent = await readAgentFile(filePath, 'project');
    const config = buildEffectiveRunConfig(agent, {
      model: 'override-model',
      reasoning: 'low',
      resultMode: 'json',
      sandbox: 'read-only',
      timeout: '100ms',
    });

    expect(config.model).toBe('override-model');
    expect(config.reasoning).toBe('low');
    expect(config.resultMode).toBe('json');
    expect(config.sandbox).toBe('read-only');
    expect(config.timeoutMs).toBe(100);
  });

  test('uses AgentQ config for context file with CLI override precedence', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-'));
    const filePath = join(root, 'example.md');
    await writeFile(filePath, VALID_AGENT, 'utf8');

    const agent = await readAgentFile(filePath, 'project');
    const configured = buildEffectiveRunConfig(
      agent,
      {},
      {
        contextFile: 'README.md',
      },
    );
    const overridden = buildEffectiveRunConfig(
      agent,
      {contextFile: 'AGENTS.md'},
      {contextFile: 'README.md'},
    );

    expect(configured.contextFile).toBe('README.md');
    expect(overridden.contextFile).toBe('AGENTS.md');
  });

  test('loads project AgentQ config', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-'));
    const configDir = join(root, '.agentq');
    await mkdir(configDir, {recursive: true});
    await writeFile(
      join(configDir, 'config.json'),
      JSON.stringify({context_file: 'README.md'}),
      'utf8',
    );

    await expect(loadAgentQConfig(root)).resolves.toEqual({
      contextFile: 'README.md',
    });
  });

  test('requires explicit provider, model, reasoning, and result mode', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-'));
    const filePath = join(root, 'missing-runtime.md');
    await writeFile(
      filePath,
      `---
id: missing-runtime
description: Invalid test agent missing runtime fields.
sandbox: workspace-write
timeout: 1m
---

<task>
{{task}}
</task>

<artifacts>
Write output.md.
</artifacts>
`,
      'utf8',
    );

    await expect(readAgentFile(filePath, 'project')).rejects.toThrow('model');
  });

  test('requires result mode to be plain or json', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-'));
    const filePath = join(root, 'bad-result-mode.md');
    await writeFile(
      filePath,
      VALID_AGENT.replace('result_mode: plain', 'result_mode: xml'),
      'utf8',
    );

    await expect(readAgentFile(filePath, 'project')).rejects.toThrow(
      'result_mode',
    );
  });

  test('rejects agent env values that override process lookup paths', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-'));
    const filePath = join(root, 'bad-env.md');
    await writeFile(
      filePath,
      VALID_AGENT.replace(
        'timeout: 1m',
        `timeout: 1m
env:
  PATH: C:\\not\\real`,
      ),
      'utf8',
    );

    await expect(readAgentFile(filePath, 'project')).rejects.toThrow(
      'reserved',
    );
  });

  test('requires task and artifacts anchors', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-'));
    const filePath = join(root, 'bad.md');
    await writeFile(
      filePath,
      `---
id: bad
description: Invalid test agent missing required anchors.
sandbox: workspace-write
timeout: 1m
---
missing anchors
`,
      'utf8',
    );

    await expect(readAgentFile(filePath, 'project')).rejects.toThrow();
  });

  test('project-local agents resolve before global agents', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-'));
    const agentsDir = join(root, '.agentq', 'agents');
    await mkdir(agentsDir, {recursive: true});
    await writeFile(join(agentsDir, 'example.md'), VALID_AGENT, 'utf8');

    const agent = await resolveAgent(root, 'example');

    expect(agent.scope).toBe('project');
    expect(agent.filePath).toBe(join(agentsDir, 'example.md'));
  });

  test('does not resolve embedded agents', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-'));
    const restoreHome = useHome(root);

    try {
      await expect(resolveAgent(root, 'harness-builder')).rejects.toThrow(
        'Could not find agent "harness-builder" in .agentq/agents or',
      );
    } finally {
      restoreHome();
    }
  });

  test('project-local agents keep explicit output contracts', async () => {
    const projectRoot = process.cwd();
    const agentsDir = join(projectRoot, '.agentq', 'agents');
    const harnessesDir = join(projectRoot, '.agentq', 'harnesses');
    const agentFiles = (await readdir(agentsDir))
      .filter(file => file.endsWith('.md'))
      .sort();

    expect(agentFiles.length).toBeGreaterThan(0);

    const harnessOwnedAgents = new Set([
      'harness-builder',
      'harness-reviewer',
      'task-splitter',
    ]);
    const requiredAgentOutputFields = [
      '"status"',
      '"summary"',
      '"failureKind"',
      '"result"',
      '"feedback"',
      '"artifacts"',
    ];

    for (const file of agentFiles) {
      const filePath = join(agentsDir, file);
      const markdown = await readFile(filePath, 'utf8');
      const agent = await readAgentFile(filePath, 'project');
      const prompt = renderAgentPrompt(
        agent,
        'inspect the current task',
        '/tmp/agentq-run/artifacts',
        agent.frontmatter.resultMode,
      );

      for (const key of [
        'provider',
        'model',
        'reasoning',
        'result_mode',
        'sandbox',
        'timeout',
      ]) {
        expect(markdown).toMatch(new RegExp(`^${key}:\\s+.+$`, 'm'));
      }

      expect(agent.frontmatter.provider).toBe('codex');
      expect(agent.frontmatter.model.length).toBeGreaterThan(0);
      expect(agent.frontmatter.reasoning.length).toBeGreaterThan(0);
      expect(agent.frontmatter.resultMode).toBe('json');
      expect(agent.frontmatter.timeout.length).toBeGreaterThan(0);

      expect(prompt).toContain('AgentQ result mode:\njson');
      expect(prompt).toContain('Final output must be valid JSON only');
      expect(markdown).not.toMatch(
        /^(Goal|Repository context|Skill and reference use|Evidence|Diagnosis rules|Proposal rules|Verification|Constraints|Rules|Feedback schema):$/m,
      );

      if (harnessOwnedAgents.has(agent.id)) {
        for (const field of requiredAgentOutputFields) {
          expect(prompt).toContain(field);
        }
      }
    }

    const harnessFiles = (await readdir(harnessesDir))
      .filter(file => file.endsWith('.yaml'))
      .sort();
    const harnessDefinitions = await Promise.all(
      harnessFiles.map(async file => ({
        file,
        yaml: await readFile(join(harnessesDir, file), 'utf8'),
      })),
    );

    expect(
      harnessDefinitions.some(({yaml}) =>
        /\bagent:\s+agent-improver\b/.test(yaml),
      ),
    ).toBe(false);
    expect(
      harnessDefinitions.some(
        ({yaml}) =>
          /\bagent:\s+harness-builder\b/.test(yaml) ||
          /\bagent:\s+harness-reviewer\b/.test(yaml) ||
          /\bagent:\s+task-splitter\b/.test(yaml),
      ),
    ).toBe(true);
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
