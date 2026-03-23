---
id: ai-instructions
name: AI Coding Instructions
description: Audits the quality, completeness, and maintenance of AI coding assistant instruction files (CLAUDE.md, AGENTS.md, .cursorrules, etc.) to ensure they provide actionable project-specific guidance.
enabled: true
mode: audit
category: ai
selectWhen: "select when the repository contains or is missing AI coding assistant instruction files (CLAUDE.md, AGENTS.md, .cursorrules, .cursor/) or when AI tooling configuration is being added or modified; skip for projects with no AI assistant integration and no such files anywhere in the repo"
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
