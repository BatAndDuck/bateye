---
id: ai-instructions
name: AI Coding Instructions
description: Audits the quality, completeness, and maintenance of AI coding assistant instruction files (CLAUDE.md, AGENTS.md, .cursorrules, etc.) to ensure they provide actionable project-specific guidance.
enabled: true
mode: audit
category: ai
scopeHints:
  - claude
  - cursor
  - copilot
  - agent
  - ai
  - instruction
  - skill
  - prompt
  - rules
  - coding
recommendedGlobs:
  - "**/.claude/**"
  - "**/CLAUDE.md"
  - "**/AGENTS.md"
  - "**/CURSOR_RULES*"
  - "**/.cursorrules"
  - "**/copilot-instructions.md"
  - "**/.github/copilot*"
---

Focus your review on:

## AI Instruction Quality
- Missing AI coding instructions files (CLAUDE.md, AGENTS.md, .cursorrules) for the project
- AI instructions that are too vague to be useful (generic boilerplate without project specifics)
- Outdated instructions referencing removed patterns, old file structures, or deprecated approaches
- Missing instructions for the most common tasks in this codebase (e.g., how to add a new endpoint, run tests)

## Completeness
- Missing build/test/lint command documentation in AI instructions
- No guidance on the project's coding conventions and patterns
- Missing information about common pitfalls or things AI assistants should avoid in this repo
- No pointers to key architecture decisions or ADRs

## Maintenance
- AI instructions not updated to reflect recent major refactors
- Instructions referencing files or patterns that no longer exist in the codebase
- Conflicting instructions in different AI config files
