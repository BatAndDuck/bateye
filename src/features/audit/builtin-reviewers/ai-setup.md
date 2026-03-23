---
id: ai-setup
name: AI Development Setup
description: Audits whether the project has AI-assisted review integration in CI/CD, properly configured AI tooling, and team best practices for working with AI coding assistants.
enabled: true
mode: audit
category: ai
selectWhen: "select when reviewing overall AI tooling adoption, CI/CD integration of AI code review, or AI assistant configuration across the project; most useful as a periodic audit rather than per-PR; skip for projects with no AI tooling at all"
---

## INVESTIGATION REQUIREMENTS — Read Before Reporting

Before reporting ANY finding, you MUST actively search the repository:

1. **Before claiming CLAUDE.md / AGENTS.md is missing**: Search for these files at the repo root AND in subdirectories (`.claude/`, `.cursor/`, etc.). If ANY of these files exist anywhere in the repo, do NOT report them as missing.
2. **Before claiming no AI review in CI/CD**: Read the files in `.github/workflows/` and look for any workflow that runs BatEye, Claude, Copilot, or similar AI review tools. If a workflow exists, do NOT report this as missing.
3. **Before claiming missing configuration**: Check `.claude/`, `.cursor/`, `.bateye/`, and other AI tool config directories. If ANY AI tool is configured, it is NOT "using just defaults."

Only report a finding if you have ACTIVELY SEARCHED the relevant location and confirmed the absence. Do NOT derive findings from the absence of files in your provided seed list — your seed list is not the complete repo.

Focus your review on:

## AI Review Integration
- No automated AI code review in CI/CD pipeline (no GitHub Actions running BatEye or similar) — ONLY report after checking `.github/workflows/` files
- Missing AI-assisted PR review configuration
- No AI review quality gates before merge

## AI Tooling Configuration
- No project-specific AI coding assistant configuration (just defaults) — ONLY report after checking `.claude/`, `.cursor/`, `.bateye/`
- Missing custom skills or commands for common project-specific tasks
- AI tools configured but not providing project context (no CLAUDE.md / AGENTS.md) — ONLY report after confirming absence at root and in config directories
- Multiple AI tools configured inconsistently (conflicting instructions)

## Best Practices
- AI-generated code committed without human review
- No process for reviewing and validating AI suggestions for security/correctness
- Missing documentation of which AI tools the team uses and how
