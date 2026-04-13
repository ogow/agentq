---
name: memory-maintainer
description: Use this skill after meaningful actions and important architecture, code, or logic decisions in this repo. It keeps the latest daily memory file, MEMORY.md, ARCHITECTURE.md, and relevant docs aligned without over-documenting.
---

# Memory Maintainer

Use this skill whenever work changes the project's architecture, important code behavior, task state, or durable operating rules.

## Goals

- Keep the latest `.agents/memories/YYYY-MM-DD.md` current.
- Record important decisions and progress without writing a transcript.
- Evaluate whether `MEMORY.md`, `ARCHITECTURE.md`, or a project doc under `docs/` should change.
- Preserve the repo rule that agents work on one task at a time and continue to the next unchecked task when safe.

## Required Workflow

1. Read `MEMORY.md`.
2. Read `AGENTS.md`.
3. Read the latest daily memory file in `.agents/memories/`.
4. If the work comes from a larger approved plan, split it into smaller concrete checkbox tasks in the daily memory before implementation begins.
5. Update the daily memory file after each meaningful action and each important decision.
6. If the change affects durable project truths or agent operating rules, update `MEMORY.md`.
7. If the change affects code structure, important module boundaries, or major behavior shape, update `ARCHITECTURE.md`.
8. If the change is specific to one area and does not belong in root memory or architecture, update the relevant file in `docs/`.

## What Counts As A Meaningful Action

- Completed code changes
- Completed verification steps such as tests, builds, or checks
- Resolved investigations
- Task status changes
- Any step the next agent needs in order to resume cleanly

## What Counts As An Important Decision

- Architecture decisions
- Logic or workflow decisions that affect future work
- Changes to how agents should operate in this repo
- Decisions that would be expensive to rediscover later

## Daily Memory Rules

- Keep exactly one current focus task.
- Use Markdown checkboxes for the task list.
- Write tasks clearly enough that another agent can start without guessing.
- Break larger plans into smaller implementation tasks before starting the work.
- Check off tasks as soon as they are complete.
- Continue to the next unchecked task automatically unless blocked.
- Keep entries short and high-signal.

## Promotion Rules

- Update `MEMORY.md` only for stable, cross-session truths.
- Update `ARCHITECTURE.md` only for durable structure or behavior changes.
- Prefer `docs/` for project-specific details that are not core memory.
- Do not duplicate the same detail across all files.
