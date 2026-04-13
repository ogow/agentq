# Sessions & Event Streaming

Sessions represent a stateful, long-running instance of an Agent in an Environment. They use an asynchronous, event-driven protocol based on Server-Sent Events (SSE).

## Session Lifecycle

1.  **Creation**: `POST /v1/beta/sessions` launches the instance.
2.  **Interaction**: `POST /v1/beta/sessions/{id}/events` sends instructions.
3.  **Completion**: The agent reaches a terminal state (e.g., success, failure, timeout).
4.  **Retrieval**: `GET /v1/beta/sessions/{id}/events` retrieves the full historical event log.

## Event Protocol (SSE)

Communication happens via the `text/event-stream` format.

| Event Type | Direction | Description |
| :--- | :--- | :--- |
| `user_turn` | Client -> API | User input or task instructions. |
| `agent_turn` | API -> Client | Claude's internal thought process. |
| `tool_use` | API -> Client | Notification that Claude is calling a tool. |
| `tool_result` | API -> Client | The output resulting from a tool call. |
| `status_update` | API -> Client | Progress indicator (e.g., "Installing packages..."). |
| `session_complete` | API -> Client | Final terminal signal with an outcome. |

## Outcomes

Sessions can be configured with specific completion criteria.
- **Success**: The task was completed according to the instructions.
- **Failure**: The task could not be completed.
- **Intervention Needed**: The agent is blocked and needs human guidance.

## Steering and Interruption

- **Guiding**: Send a new `user_turn` event while the session is active to provide mid-flight feedback.
- **Interrupting**: Send a special `interrupt` event to immediately stop all current tool executions.
