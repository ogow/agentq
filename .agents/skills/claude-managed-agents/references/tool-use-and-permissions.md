# Tool Use & Permission Policies

Managed Agents can use built-in, MCP, and custom tools. Execution is governed by permission policies.

## Built-in Agent Toolset (`agent_toolset_20260401`)

| Tool | ID | Description |
| :--- | :--- | :--- |
| **Bash** | `bash` | Run shell commands in the container. |
| **File Ops** | `read`, `write`, `edit` | Surgical or full file operations. |
| **Search** | `glob`, `grep` | Pattern-based discovery. |
| **Web** | `web_search`, `web_fetch` | Information retrieval. |

## Permission Policies

Policies control whether server-executed tools run automatically.

- **`always_allow`**: Tool executes immediately (default for agent toolset).
- **`always_ask`**: Session pauses and emits `requires_action`. Client must send `user.tool_confirmation` (`allow` or `deny`).

## Configuring Tools

Use the `configs` array in the agent definition to override defaults:
```json
"tools": [
  {
    "type": "agent_toolset_20260401",
    "configs": [
      { "name": "bash", "permission_policy": { "type": "always_ask" } },
      { "name": "web_fetch", "enabled": false }
    ]
  }
]
```

## Custom Tools

Custom tools are client-executed.
1. Claude emits `agent.custom_tool_use`.
2. Session pauses with `requires_action`.
3. Client executes logic and returns `user.custom_tool_result`.

**Best Practice**: Provide extremely detailed descriptions (3-4 sentences) for custom tools to ensure accurate selection.
