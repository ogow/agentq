# Prompting Overview

Prompt engineering is not the first step. Claude's guidance starts with:

- define success criteria
- create a way to test against them
- write a first draft prompt
- then iterate on the prompt

Prompt work is only one lever. Some failures are better solved by:

- choosing a different model
- changing the harness
- simplifying the task
- improving the surrounding context or retrieved inputs

## What Claude Recommends

- Start from a concrete task and a first prompt draft.
- Evaluate changes against explicit success criteria instead of eyeballing outputs.
- Use prompt engineering for controllable behaviors like clarity, structure, grounding, and output shape.
- Do not treat latency or cost as prompt problems first if model or system choices are the bigger lever.

## Useful Decisions

Prompt engineering is the right tool when you need to improve:

- instruction following
- tone and communication style
- output format reliability
- reasoning structure
- grounding on supplied context

Prompt engineering is often not the first tool when you need to improve:

- latency
- cost
- missing external data
- broken tool integration
- provider or harness failures

## How To Apply In Aiman

For `aiman`, treat prompt engineering as authored-agent work first.

- Put task behavior in the agent body.
- Put repo-wide stable rules in shared repo context like `AGENTS.md`.
- Use `aiman run` smoke tasks and repeatable eval scripts to judge changes.
- Fix runtime code only when the failure is really about persistence, validation, or provider launch behavior.
- Optimize latency only after the prompt is already producing the quality bar you want.
