# Advanced Features (Research Preview)

Advanced orchestration and persistence capabilities currently in Research Preview.

## 1. Outcomes (Goal-Oriented Work)

Elevates sessions from "conversations" to "work" by defining success criteria.

- **Rubrics**: Markdown documents describing gradeable criteria.
- **Graders**: Automated, independent model-instances that evaluate artifacts against the rubric.
- **Iteration**: Claude iterates (up to `max_iterations`) until the grader reports `satisfied`.
- **Deliverables**: Outputs are typically written to `/mnt/session/outputs/`.

## 2. Multiagent Sessions

Coordinate multiple specialized agents in one session.

- **Primary Thread**: The top-level stream containing the coordinator.
- **Subagent Threads**: Isolated event streams for specialized roles (Reviewer, Researcher, etc.).
- **Isolation**: Tools and context are not shared between threads.
- **Orchestration**: Only one level of delegation is supported.

## 3. Agent Memory Stores

Persistent memory surviving across sessions.

- **Stores**: Workspace-scoped collections of markdown documents.
- **Automatic Check/Write**: Agents check stores at start and write learnings at completion.
- **Memory Tools**: `memory_read`, `memory_write`, `memory_edit`, `memory_search`.
- **Versioning**: Every mutation creates an immutable version for auditing or rollback.
- **Redact**:hard-clears content while preserving audit trails for compliance.
