# Quickstart Guide: Managed Agents

Build an autonomous agent in 3 steps: Create an Agent, Configure an Environment, and Start a Session.

## 1. Create an Agent

Define the model, instructions, and tools.

```bash
# Example using Anthropic CLI (ant)
ant beta:agents create \
  --name "Developer Assistant" \
  --model claude-3-7-sonnet \
  --system "You are a senior full-stack developer." \
  --tool '{type: agent_toolset_20260401}'
```

**Response includes an `agent_id`.**

## 2. Create an Environment

Define the infrastructure baseline (software, network).

```bash
ant beta:environments create \
  --name "node-env" \
  --config '{type: cloud, networking: {type: unrestricted}}'
```

**Response includes an `environment_id`.**

## 3. Start a Session

Combine the Agent and Environment to launch a persistent run.

```bash
ant beta:sessions create \
  --agent_id <AGENT_ID> \
  --environment_id <ENVIRONMENT_ID>
```

**Response includes a `session_id`.**

## 4. Send a Task

Send the initial user event to start work.

```bash
ant beta:sessions send-event <SESSION_ID> \
  --text "Review the code in the current directory and fix any lint errors."
```

## 5. Listen to the Stream

Listen to Server-Sent Events (SSE) to see the agent's progress.

```bash
ant beta:sessions events <SESSION_ID> --follow
```

---

## Technical Details

- **Model Selection**: Claude 3.7+ is recommended for agentic tasks.
- **Beta Headers**: All API requests require `managed-agents-2026-04-01`.
- **Tool Selection**: `agent_toolset_20260401` provides 8 core tools for local file and web operations.
