import {describe, expect, test} from 'bun:test';
import {mkdir, writeFile} from 'node:fs/promises';
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
sandbox: workspace-write
timeout: 1m
---

<instructions>
Be useful.
</instructions>

<task>
</task>

<artifacts>
Write output.md.
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

  test('adds the run artifact directory to the artifacts anchor', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentq-'));
    const filePath = join(root, 'example.md');
    await writeFile(filePath, VALID_AGENT, 'utf8');

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
      sandbox: 'read-only',
      timeout: '100ms',
    });

    expect(config.model).toBe('override-model');
    expect(config.reasoning).toBe('low');
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

  test('requires explicit provider, model, and reasoning', async () => {
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
</task>

<artifacts>
Write output.md.
</artifacts>
`,
      'utf8',
    );

    await expect(readAgentFile(filePath, 'project')).rejects.toThrow('model');
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
});
