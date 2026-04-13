# Agent Configuration & Lifecycle

An Agent is a reusable, versioned resource defining how Claude behaves. Reference it by ID to start sessions.

## Configuration Fields

| Field | Description |
| :--- | :--- |
| `name` | Human-readable identifier. |
| `model` | Claude model (e.g., `claude-sonnet-4-6`). |
| `system` | Persona-defining system prompt. |
| `tools` | Pre-built, MCP, and custom tools. |
| `mcp_servers` | URLs for external Model Context Protocol servers. |
| `skills` | Reusable filesystem-based expertise. |
| `callable_agents` | Subagents for orchestration (Research Preview). |
| `metadata` | Arbitrary tracking data. |

## Lifecycle Operations

- **Create**: Define the agent once. Response includes an `id`.
- **Update**: Creates a new version (auto-incrementing). Omitted fields are preserved. Scalar fields are replaced; arrays are fully replaced.
- **List Versions**: Fetch history to track changes over time.
- **Archive**: Makes the agent read-only. New sessions cannot reference it; existing ones continue.

## Best Practices

- **Role Setting**: Even a single sentence in the `system` prompt significantly affects tone and behavior.
- **Version Pinning**: Sessions can pin to a specific agent version for staging rollouts.
- **Array Replacement**: Remember that updating `tools` or `skills` replaces the entire array; you must send the full set of intended items.
