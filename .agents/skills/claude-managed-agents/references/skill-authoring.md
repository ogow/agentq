# Skill Authoring & Enterprise Governance

Agent Skills are modular, filesystem-based resources that extend Claude's expertise through instructions, code, and resources.

## Skill Structure (SKILL.md)

- **YAML Frontmatter**: Requires `name` (lowercase, hyphens) and `description` (discovery metadata).
- **Progressive Disclosure**: SKILL.md should be an overview (<500 lines). Move details to reference files. Claude reads these only when needed.

## Authoring Principles

- **Gerund Form**: Use verb+ing for names (e.g., `analyzing-spreadsheets`).
- **Degrees of Freedom**:
    - **High**: General text instructions for heuristic-based tasks.
    - **Medium**: Pseudocode/templates for variable tasks.
    - **Low**: Specific scripts for fragile, deterministic tasks.
- **Utility Scripts**: Use scripts (`*.py`, `*.js`) for complex algorithms or validation. Claude executes these via bash without loading the code into context.

## Enterprise Governance

### Security Vetting (Risk Indicators)
- Code execution (scripts).
- Instruction manipulation (directives to ignore safety).
- Network access patterns (`curl`, `fetch`).
- Hardcoded credentials.

### Lifecycle Management
1. **Plan**: Identify repetitive, high-value workflows.
2. **Review**: Ensure compliance with best practices and security rules.
3. **Test**: Use evaluation suites (3-5 queries) across all relevant models (Haiku, Sonnet, Opus).
4. **Deploy**: Upload via Skills API for workspace access.
5. **Monitor**: Track usage and iterate based on real-world edge cases.

### Coexistence & Consolidation
Start with specific, narrow skills. Consolidate into role-based bundles (e.g., `engineering-ops`) only when evaluations confirm no performance degradation.
