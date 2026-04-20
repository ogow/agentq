# Planning

## Name

The project name is AgentQ. Use `agentq` as the CLI binary name. The name references Q from James Bond: the toolmaker behind the agent, providing equipment, constraints, context, harnesses, and run artifacts.

## Product

In this repo I would like to have a few different tools that help with:
- building agents
- hardening prompts
- creating harnesses
- testing agents
- orchestration of agents.

I dont want 1 tool thats trying to do everything i think its best to split it up to multiple tools, maybe packages that can be used in other tools.

Tools should be doing 1 think very well and be able to work with other tools. unix methodology.

## Agent authoring direction

The first user is me, so the first version should be CLI-first with no UI. I need to be able to configure my own agents and create project-specific agents.

Agent definitions should be authored as readable Markdown documents, closer to a README than a pure YAML config file. Use YAML frontmatter for execution metadata and runtime knobs, then use the Markdown body for the actual agent behavior.

Use XML-like tags only as important anchors, not as the whole document format. The tags should make critical boundaries easy for both the runner and the model to find, especially:

- `<instructions>` for must-follow behavior
- `<task>` for the exact task injected by the CLI; authored templates should use `{{task}}` as the placeholder
- `<artifacts>` for expected output locations and files; authored templates should use `{{artifacts}}` as the run artifact directory placeholder
- optional sections like `<context>`, `<verification>`, or `<handoff>` when useful

This is inspired by Claude-style agent authoring: YAML frontmatter plus a Markdown system prompt, with XML tags used to structure important prompt sections. The local CLI should be stricter than generic agent authoring by requiring stable anchors such as `<task>` and `<artifacts>` so runs are repeatable and inspectable.

## Codex CLI wrapper direction

The CLI should wrap `codex exec` rather than implement its own agent runtime. The wrapper should make runs repeatable and inspectable while letting Codex own execution.

Codex is the only provider needed for v1, but the architecture should not make Codex the core abstraction. The core package should define provider-neutral agent config, run config, run status, event, artifact, and output contracts. Codex should be implemented as the first provider adapter that emits the normalized output format. Future providers must follow the same run/output contract.

It should be possible to import a package from this repo and create/run agents programmatically, not only through the CLI. The CLI should be a thin interface over reusable core APIs.

The tools must run on Unix-like systems and Windows, including PowerShell. Cross-platform support is a core requirement, not a later port. Command execution, path handling, shell quoting, environment variables, process timeouts, and artifact paths should be designed with both Unix shells and PowerShell in mind.

CLI usability is a v1 requirement. The command surface should be easy to understand, logical to remember, and shallow:

- prefer one clear subcommand after `agentq`, such as `agentq run <agent> --task "..."`
- allow one noun group when it reads naturally, such as `agentq agents list`
- avoid deep command trees such as `agentq agents local list` or `agentq runs history show`

I need to be able to choose:

- provider for the run
- model for the run
- reasoning effort for the run, using `none` when the selected model does not support reasoning
- result mode for the final output, either `plain` for humans or `json` for harnesses
- max runtime, such as `100ms`, `1m`, or `1h`
- which file Codex should use as the project instruction/context file
- sandbox settings for the run

Sandbox settings must be configurable per run because some workflows need different permissions. For example, `playwright-cli` often fails in a restricted sandbox, so I need to be able to choose between Codex sandbox modes such as read-only, workspace-write, and danger/full-access style execution depending on the task and risk.

Run output should be quiet by default while the agent is working. The live CLI should show an animation or progress indicator so I know the run is active, but it should not flood the terminal with every model comment or tool event.

The wrapper should still capture Codex's JSONL event stream from `codex exec --json`. Those events should be stored in the run artifacts so I can inspect what the model said, which comments it made, which tools it used, what files changed, and what happened during the run after it finishes.

Choosing an instruction/context file should make Codex aware of the file through its native instruction-loading system. Do not inject the file into the prompt as a `<context source="...">` block.

The normal path should use Codex project instruction discovery, especially `project_doc_fallback_filenames`, so non-`AGENTS.md` files can be treated as project instruction files. `model_instructions_file` exists, but it replaces Codex's built-in model instructions and should be treated as an advanced/risky escape hatch, not the default way to provide project context.

For v1, keep agent runtime config directly in the agent file's YAML frontmatter instead of adding run profiles. Each agent should be self-contained enough to understand and run by opening one file. Frontmatter must explicitly include `id`, `description`, `provider`, `model`, `reasoning`, `result_mode`, `timeout`, and `sandbox`. Optional settings can include `approval` and `env`.

Use AgentQ config for the file Codex should treat as project instruction/context for runs. This is a tool/project setting, not an agent setting. Store it as `context_file` in `.agentq/config.json` or `~/.agentq/config.json`; internally the wrapper can map it to Codex's project instruction discovery settings.

CLI flags should override other settings. Use this precedence order:

1. CLI flags
2. agent frontmatter for agent-owned runtime fields
3. project AgentQ config
4. global AgentQ config
5. Codex defaults

Run profiles may be added later only if repeated execution settings across many agents create enough duplication to justify them.

Agents should support both global and project-local definitions. Project-local agents override global agents when they use the same `id`.

Run history should always be stored in the user directory, not inside the project repository, so runs do not dirty the repo. Use simple human-readable run directory names based on the agent id plus a short unique id, for example `build-k48p7q` or `reviewer-2hd91m`. Do not put timestamps in the run directory name by default; store exact timestamps and sorting metadata inside `run.json`.

Codex must be able to read and write the active run directory in addition to the project working directory. Because runs live under `~/.agentq/runs`, the wrapper should grant the active run directory as an additional writable/readable path for the Codex process when sandbox settings would otherwise restrict access.

V1 behavior decisions:

- `sandbox` is required in each agent file; do not default it.
- logs should always be saved.
- `--verbose` can stream JSONL-derived activity while the run is active.
- Windows support should target PowerShell only for v1.
- if `bun` or `codex` is missing, fail quickly with a clear error.
- in general, fail quickly when configuration, paths, required fields, or runtime prerequisites are wrong.
- validate agents when they run; a separate lint command is not required for v1.
- cleanup/pruning can stay manual for v1.

V1 implementation scope:

- implement the CLI in TypeScript running on Bun.
- use Bun as the package manager, script runner, test runner, and local development runtime.
- use `yargs` for command parsing.
- keep reusable agent/run logic in a package that can be imported programmatically.
- implement Codex as the first provider adapter behind a provider interface.
- use Bun-compatible Node subprocess APIs with argv arrays to run `codex`; do not build shell-string commands.
- support `agentq run <agent> --task <task>` as the primary command.
- keep common run controls as flags on `agentq run`: `--task`, `--provider`, `--model`, `--reasoning`, `--result-mode`, `--timeout`, `--sandbox`, `--approval`, `--context-file`, and `--verbose`.
- optionally support `agentq agents list` if useful while building, without adding deeper command levels.
- resolve agents from project-local `.agentq/agents/<id>.md` first, then global `~/.agentq/agents/<id>.md`.
- parse YAML frontmatter plus Markdown body.
- require at least `id`, `description`, `provider`, `model`, `reasoning`, `result_mode`, `sandbox`, `timeout`, `<task>`, and `<artifacts>` in an agent run.
- allow CLI flags to override frontmatter for settings like `provider`, `model`, `reasoning`, `result_mode`, `timeout`, `sandbox`, and `approval`; allow `--context-file` to override AgentQ config.
- write each run to `~/.agentq/runs/<agent-id>-<short-id>/`.
- store `run.json`, `stdout.jsonl`, `stderr.log`, and `output.md`; keep source agent and context paths in `run.json` instead of copying those files into every run.
- expose an `artifacts/` directory path to the agent for any additional files requested by the `<artifacts>` contract.
- implement run timeouts in the wrapper and mark timed-out runs clearly in metadata.

## Resources

- https://developers.openai.com/tracks/building-agents
- https://cloud.google.com/discover/what-is-agentic-coding
- https://resources.anthropic.com/hubfs/2026%20Agentic%20Coding%20Trends%20Report.pdf
- https://www.anthropic.com/engineering/building-effective-agents
- https://clickhouse.com/blog/agentic-coding
- https://developers.openai.com/cookbook/examples/codex/build_code_review_with_codex_sdk
- https://developers.openai.com/cookbook/examples/codex/codex_mcp_agents_sdk/----building_consistent_workflows_codex_cli_agents_sdk
- https://developers.openai.com/cookbook/examples/partners/agentic_governance_guide/agentic_governance_cookbook
- https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- https://openai.com/index/harness-engineering/
- https://developers.openai.com/cookbook/examples/how_to_use_guardrails
- https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide
