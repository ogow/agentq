---
name: claude-managed-agents
description: Practical Claude reference skill for `aiman`. Covers Managed Agents architecture plus prompt engineering, prompting tools, testing/evals, and guardrail harness patterns.
---

# Claude Managed Agents Reference

Use this skill when you need to research, adapt, or implement Claude patterns in `aiman`. It covers both Managed Agents architecture and the prompt, eval, and guardrail topics that matter when making authored `aiman` agents more reliable.

## Reference Modules

Read the specific module for the task at hand to maintain a lean context:

### Managed Agents Architecture

- **[references/core-concepts.md](references/core-concepts.md)**: High-level architecture, how it works, and key benefits.
- **[references/quickstart.md](references/quickstart.md)**: Step-by-step CLI/SDK implementation guide.
- **[references/agent-configuration.md](references/agent-configuration.md)**: Defining agents, versioning, and lifecycle management.
- **[references/environments.md](references/environments.md)**: Cloud containers, package management, and networking modes.
- **[references/sessions-and-events.md](references/sessions-and-events.md)**: Session lifecycle, status machine, and the SSE event protocol.
- **[references/tool-use-and-permissions.md](references/tool-use-and-permissions.md)**: Pre-built toolsets, permission policies, and custom tools.
- **[references/files-and-vision.md](references/files-and-vision.md)**: Files API, mounting resources, and Vision (Images/PDFs) capabilities.
- **[references/mcp-and-vaults.md](references/mcp-and-vaults.md)**: MCP connectors, credential vaults, and GitHub repo mounting.
- **[references/advanced-features.md](references/advanced-features.md)**: Research Preview features: Outcomes, Multiagent sessions, and Memory stores.
- **[references/skill-authoring.md](references/skill-authoring.md)**: Best practices for creating skills and enterprise governance.

### Prompt Engineering

- **[references/prompt-engineering.md](references/prompt-engineering.md)**: Bridge module for when to read prompting guidance and how it maps to `aiman`.
- **[references/prompting-overview.md](references/prompting-overview.md)**: Prompt-engineering workflow, prerequisites, and when prompt work is or is not the right lever.
- **[references/prompting-best-practices.md](references/prompting-best-practices.md)**: Clear instructions, examples, XML structure, roles, long-context handling, output control, and thinking guidance.
- **[references/prompting-tools.md](references/prompting-tools.md)**: Claude Console prompt generator, templates/variables, and prompt improver.

### Testing, Evals, And Guardrails

- **[references/testing-and-evals.md](references/testing-and-evals.md)**: Success criteria, eval design, evaluation-tool workflow, and latency tuning after quality is proven.
- **[references/guardrails-hallucinations.md](references/guardrails-hallucinations.md)**: Grounding, quotes, uncertainty handling, and verification patterns.
- **[references/guardrails-consistency.md](references/guardrails-consistency.md)**: Output-shape consistency, examples, templates, and when to prefer structured outputs.
- **[references/guardrails-jailbreaks.md](references/guardrails-jailbreaks.md)**: Input screening, policy prompts, and layered safeguards for risky inputs.
- **[references/guardrails-prompt-leak.md](references/guardrails-prompt-leak.md)**: Prompt-leak reduction strategies and tradeoffs.

## How to Apply These Ideas in Aiman

When the goal is to improve `aiman` using these references:

1. **Identify the Gap**: Determine whether the issue is prompt quality, testing, guardrails, or Managed Agents architecture.
2. **Consult the Reference**: Read the corresponding module above to understand the industry-standard solution.
3. **Map to Aiman Architecture**: Translate "managed" concepts into "local-first" or "file-system-native" solutions.
4. **Choose The Right Layer**: Put the change in the authored agent body, shared repo context, harness wrapper, or runtime depending on the module guidance.
5. **Verify Against Aiman Contracts**: Ensure the change remains compatible with existing `aiman` contracts like `run.json`, `resultMode`, and the thin runtime model.

## Common Use Cases

- Writing more reliable authored agent prompts.
- Deciding whether a failure should be fixed in the prompt, harness, or runtime.
- Designing repeatable evals for agent quality, safety, and latency.
- Choosing guardrails for hallucinations, jailbreaks, consistency, or prompt leak.
- Implementing persistent long-term memory for local agents.
- Designing a standardized tool execution and confirmation protocol.
- Enhancing the workbench with real-time streaming status updates.
- Adopting Model Context Protocol (MCP) for extensible tool integration.
