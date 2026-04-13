# Claude Managed Agents: Core Concepts

Claude Managed Agents (Public Beta) provides a fully managed infrastructure for running Claude as an autonomous agent. It abstracts away the complexities of building agent loops, managing tool execution, and provisioning runtimes.

## Core Concepts

| Concept | Description |
| :--- | :--- |
| **Agent** | Reusable, versioned definition of model, system prompt, tools, MCP servers, and skills. |
| **Environment** | Configured cloud container template defining pre-installed packages, network rules, and file mounts. |
| **Session** | A stateful, running instance of an agent within an environment. Sessions are persistent across interactions. |
| **Events** | Event-driven protocol (SSE) for real-time communication (user turns, tool results, status updates). |

## How It Works

1.  **Define the Agent**: Specify model, persona, and capabilities.
2.  **Configure Environment**: Define the sandbox (networking, software dependencies).
3.  **Launch Session**: Combine Agent and Environment into a stateful instance.
4.  **Delegate & Stream**: Send tasks via events; Claude executes tools and streams results.
5.  **Steer or Interrupt**: Guide the agent mid-execution or change direction mid-task.

## Key Benefits for Aiman

- **Offloaded Harness**: Managed Agents handle the loop, prompt caching, and context compaction automatically.
- **Persistent State**: File systems and history survive across turns, ideal for long-running workflows.
- **Secure Sandbox**: High-privilege tools (Bash, File Ops) run in isolated cloud containers.
- **Credential Safety**: Vaults keep secrets out of agent prompts and session logs.

## When to Use Managed Agents

- **Long-running execution**: Tasks spanning minutes or hours with multiple tool calls.
- **Infrastructure-light**: No need to build custom sandboxes or tool execution layers.
- **Asynchronous work**: Scenarios where "done" is a result of many autonomous steps.
