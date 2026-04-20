# Plan 02a: Harness Live Row Patch

## Status

Planned.

This is a focused patch on top of Plan 02. Do not reopen the whole harness live
output design. The goal is to refine the default TTY row so it is clearer while
keeping Plan 02's logging ownership and verbosity model intact.

## Goal

Make the default harness TTY output show exactly one mutable live row for the
active task, with clear task progress, retry progress, current agent, and a
compact view of what the agent/model is doing.

The row should make it obvious:

- which run is active
- which task is active
- which attempt is active
- which agent is currently working
- whether the run is still moving
- what the LLM or command is currently doing, without printing a transcript

## Desired Default TTY Row

Use this shape:

```text
<spinner> <run-id> task <current>/<total> attempt <current>/<max>  <agent>  <activity>
```

Example:

```text
⠦ devloop-e50232 task 1/4 attempt 2/4  harness-builder  fixing item count vs attempt count
```

Rules:

- Keep `<run-id>` as one copyable token, for example `devloop-e50232`.
- Do not split it into `devloop e50232`.
- Use `task`, not `item`.
- Use `task 1/4`, not `task 1 of 4`.
- Use `attempt 2/4`, not `iteration`.
- Show the current agent id directly, for example `harness-builder`.
- Do not render `msg:`.
- Do not render `by`, as in `review by harness-reviewer`.
- The final activity segment should be plain compact text.
- Human color can distinguish meaning: the activity/message segment should be
  dim or greyish.

## Live Row Behavior

Default TTY output should maintain one mutable row for the active task.

Agent messages, tool activity, step changes, and retry status update the same
row in place. They must not create durable rows.

The row should be overwritten as the task progresses:

```text
⠧ devloop-e50232 task 1/4 attempt 1/4  harness-builder  reading harness summary code
```

then the same physical row becomes:

```text
⠇ devloop-e50232 task 1/4 attempt 1/4  harness-builder  bun test tests/harness.test.ts
```

then the same physical row becomes:

```text
⠏ devloop-e50232 task 1/4 attempt 1/4  harness-reviewer  reviewing patch
```

The terminal must not accumulate those as separate durable lines.

## Retry Behavior

If a task attempt fails but the task will retry, keep the same live row.

Example sequence on the same physical row:

```text
⠦ devloop-e50232 task 2/4 attempt 1/4  harness-builder  check failed, retrying
```

then:

```text
⠧ devloop-e50232 task 2/4 attempt 2/4  harness-builder  applying feedback
```

Only when the task reaches terminal success, terminal failure, or blocked state
should the row become durable.

## Durable Task Lines

When a task finishes, clear the mutable row and print one durable line for that
task.

Success:

```text
✓ task 2/4 success attempt 2/4  Add JSONL output mode
```

Failure:

```text
✗ task 2/4 failed attempt 4/4  Add JSONL output mode

Failure
  agent: harness-reviewer
  attempt: 4/4
  reason: JSONL output still prints human summary
  run: ~/.agentq/harness-runs/devloop-e50232
```

After a task finishes, the next task starts on the next row:

```text
✓ task 2/4 success attempt 2/4  Add JSONL output mode
⠋ devloop-e50232 task 3/4 attempt 1/4  harness-builder  reading renderer tests
```

## Activity Segment

The activity segment is ephemeral. It should be compact, dim/greyish, and
overwritten in place.

It may come from:

- latest assistant message preview
- current command
- current step/action fallback
- retry status
- waiting/running fallback

Suggested priority:

1. Current command, compacted.
2. Latest assistant message, compacted.
3. Retry status.
4. Current step/action.
5. Generic running/waiting text.

Do not print full assistant paragraphs in default mode. Keep the preview short
enough that the live row stays readable.

## Non-TTY Behavior

Non-TTY default output cannot safely overwrite a row. It should not print live
row updates.

For non-TTY default output, print only:

- terminal task lines
- failure blocks
- final summary

Do not print assistant-message previews, retry heartbeats, spinner frames, or
tool activity in non-TTY default mode.

## Verbosity

Keep the existing Plan 02 model:

```sh
agentq harness run devloop
agentq harness run devloop -v
agentq harness run devloop -vv
agentq harness run devloop --jsonl
agentq harness run devloop --jsonl -v
agentq harness run devloop --jsonl -vv
```

This patch is mainly about default human TTY output.

`-v`, `-vv`, and `--jsonl` should continue to respect the Plan 02 behavior. Do
not redesign JSONL while implementing this patch unless a small field is needed
to expose task/attempt state consistently.

## Implementation Notes

The renderer needs task attempt context, not just step context.

Track enough live state to render:

- run id
- task index and total
- current attempt and max attempts
- current agent
- compact activity
- terminal task result

Avoid using the agent id or step id as a substitute for task progress. Avoid
counting internal steps as tasks.

The renderer should own terminal redraw behavior. Do not add durable logs or
copy nested agent events into harness logs to solve presentation problems.

## Tests

Add or update focused tests for:

- default TTY live updates use the same mutable row until task terminal state
- assistant messages update the activity segment without creating durable rows
- tool activity updates the activity segment without creating durable rows
- retryable attempt failure stays on the same task row and increments attempt
- terminal task success prints exactly one durable line
- terminal task failure prints exactly one durable line plus a concise failure
  block
- durable task lines use `task`, not `item`
- live row includes full copyable run id, for example `devloop-e50232`
- live row includes `attempt current/max`
- non-TTY default output omits live row updates
- `bun run check` passes

## Acceptance Criteria

- Default TTY live row uses:

  ```text
  <spinner> <run-id> task <current>/<total> attempt <current>/<max>  <agent>  <activity>
  ```

- The run id is one copyable token.
- Default output uses `task`, not `item`.
- Default output shows attempt progress for the active task.
- Retryable failures update the same live row instead of printing durable rows.
- A task prints a durable row only at terminal task success/failure/blocked.
- Activity text is compact and dim/greyish in human output.
- Non-TTY default output remains bounded.
- Plan 02 storage rules remain unchanged.

## Non-goals

- No new output mode.
- No quiet mode.
- No TUI.
- No dashboard.
- No copied nested agent logs in harness run directories.
- No full assistant transcript in default mode.
- No broad JSONL redesign.

## Suggested Harness Command

```sh
bun run agentq harness run devloop --input-file plans/02a-harness-live-row-patch.md
```
