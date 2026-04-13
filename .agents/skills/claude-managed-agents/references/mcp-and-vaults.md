# MCP Connector & Vaults

Model Context Protocol (MCP) connects agents to external services. Vaults manage the necessary credentials securely.

## MCP Connector

Configuration is split into two steps to separate logic from secrets:
1. **Agent Definition**: Declare the MCP server name and URL.
2. **Session Creation**: Provide the `vault_id` containing the credentials.

## Vaults & Credentials

Vaults are workspace-scoped collections of per-user credentials.

### Credential Types
- **`mcp_oauth`**: For OAuth 2.0 servers. Anthropic manages token refresh.
- **`static_bearer`**: For API keys or personal access tokens.

### Configuration
- **One per URL**: Only one active credential per `mcp_server_url` per vault.
- **Rotation**: Secrets are write-only. Rotate by updating the credential; changes propagate to running sessions.
- **Archiving**: purges secrets but retains records for auditing.

## GitHub Integration

Specialized pattern for mounting repositories:
1. Declare GitHub MCP in the agent.
2. Mount the repo as a `resource` at session creation:
```json
"resources": [
  {
    "type": "github_repository",
    "url": "https://github.com/org/repo",
    "mount_path": "/workspace/repo",
    "authorization_token": "ghp_..."
  }
]
```
GitHub repositories are cached for fast starts in future sessions.
