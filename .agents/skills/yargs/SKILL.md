---
name: yargs
description: Use this skill when building, debugging, or refactoring Node.js or TypeScript CLIs that use yargs, including commands, positional args, options, help text, completion, parser behavior, command modules, and common yargs patterns.
---

# Yargs

Use this skill for practical yargs work. Prefer the bundled yargs repo docs and examples before guessing API details from memory.

## When To Use It

- creating or changing a CLI built with `yargs`
- adding commands, subcommands, positional args, or options
- fixing help output, validation, defaults, coercion, middleware, or parser behavior
- translating a yargs example into repo-specific code
- checking TypeScript usage or browser support for yargs

## Workflow

1. Identify the task shape:
   - API usage
   - command structure
   - parser behavior
   - TypeScript
   - example-driven implementation
2. Read the narrowest matching doc under `references/docs/` first.
3. If the task is easier to model from working code, open the closest file under `references/example/`.
4. Apply the pattern to the repo code with minimal adaptation.
5. If behavior still seems version-sensitive or ambiguous, verify against the upstream yargs project before finalizing.

## References

Start with the smallest relevant file:

- `references/docs/api.md` for the main API surface and builder methods
- `references/docs/advanced.md` for middleware, command modules, parser configuration, and advanced flows
- `references/docs/typescript.md` for TypeScript patterns
- `references/docs/tricks.md` for edge cases and common implementation shortcuts
- `references/docs/browser.md` for browser usage
- `references/docs/examples.md` for curated example pointers
- `references/example/` for runnable upstream examples, especially:
  - `command_hierarchy.mjs`
  - `complex.mjs`
  - `usage-options.mjs`
  - `requires_arg.mjs`
  - `cmds/`

Use `rg` inside `references/docs` or `references/example` when you need a specific method, option, or pattern.

## Source Snapshot

Bundled references were copied from `github.com/yargs/yargs` at commit `437f3a4e0f41` (2026-02-22).
