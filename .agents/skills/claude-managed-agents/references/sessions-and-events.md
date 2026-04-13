# Sessions & Event Protocol

A Session is a stateful instance of an Agent in an Environment. Communication is entirely event-based.

## Session Lifecycle

1.  **Creation**: `POST /v1/beta/sessions` combining Agent and Environment.
2.  **Status**: Transitions between `idle` (waiting), `running` (processing), `rescheduling` (retrying), and `terminated` (error).
3.  **Interaction**: Send `user.message` or `user.interrupt` events.
4.  **Archive/Delete**: Preserve history with Archive; wipe instance with Delete.

## Event Stream (SSE)

Communication uses `text/event-stream`. Common event types:

- **User**: `user.message`, `user.interrupt`, `user.tool_confirmation`.
- **Agent**: `agent.message`, `agent.thinking`, `agent.tool_use`, `agent.tool_result`.
- **Session**: `session.status_running`, `session.status_idle`, `session.error`.
- **Span**: `span.model_request_start`, `span.model_request_end`.

## Handling Interrupts

Use `user.interrupt` to stop Claude mid-turn. Follow up with a new `user.message` to redirect. Claude acknowledges and switches context immediately.

## Reconnecting to Sessions

To reconnect without missing events:
1. Open a new stream.
2. List full history to identify seen event IDs.
3. Tail the live stream, skipping events already in the history.

## Usage Tracking

Sessions include a `usage` field with cumulative `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, and `cache_read_input_tokens`.
