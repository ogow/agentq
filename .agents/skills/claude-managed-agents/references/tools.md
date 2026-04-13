# Tools Reference: `agent_toolset_20260401`

The `agent_toolset_20260401` is a pre-built toolset for Claude Managed Agents that provides a suite of 8 autonomous tools for file operations, shell execution, and web access.

## Toolset Configuration

When defining an agent, use the `configs` array to override settings for specific tools.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| **`type`** | `string` | Must be set to `"agent_toolset_20260401"`. |
| **`configs`** | `array` | (Optional) Override settings for specific tools. |
| **`default_config`** | `object` | (Optional) Sets default `enabled` and `permission_policy`. |

### Per-Tool Config (`configs`)
- **`name`**: Tool identifier (e.g., `"bash"`, `"write"`, `"web_search"`).
- **`enabled`**: `boolean`. Whether the tool is available.
- **`permission_policy`**:
  - `{ "type": "always_allow" }`: (Default) Executes without asking.
  - `{ "type": "always_ask" }`: Requires user approval for every call.

---

## Full List of Tools

| Tool Name | Identifier | Description |
| :--- | :--- | :--- |
| **Bash** | `bash` | Executes bash commands in the session's container. |
| **Read** | `read` | Reads the content of a file from the local filesystem. |
| **Write** | `write` | Creates or overwrites a file in the local filesystem. |
| **Edit** | `edit` | Performs surgical string replacement within a file. |
| **Glob** | `glob` | Finds files using pattern matching (e.g., `src/**/*.ts`). |
| **Grep** | `grep` | Searches for text patterns using regular expressions. |
| **Web Fetch** | `web_fetch` | Downloads the content/HTML of a specific URL. |
| **Web Search** | `web_search` | Performs a web search to find information. |

---

## Example: Secure Configuration

This configuration creates an agent that requires permission for `bash` and disables `web_search` entirely.

```json
"tools": [
  {
    "type": "agent_toolset_20260401",
    "configs": [
      {
        "name": "web_search",
        "enabled": false
      },
      {
        "name": "bash",
        "permission_policy": {
          "type": "always_ask"
        }
      }
    ]
  }
]
```

## Tool Execution Model

1.  **Autonomous Selection**: Claude determines the tool sequence based on the system prompt and user goals.
2.  **Sandboxed Execution**: Tools run in the isolated environment defined by the session.
3.  **Result Processing**: Results are returned as JSON events and fed back into Claude's context.
