---
id: ai-setup
name: AI Development Setup
description: Audits whether the project has AI-assisted review integration in CI/CD, properly configured AI tooling, and team best practices for working with AI coding assistants.
enabled: true
mode: audit
category: ai
scopeHints:
  - claude
  - cursor
  - copilot
  - ai
  - setup
  - config
  - review
  - automation
  - workflow
recommendedGlobs:
  - "**/.claude/**"
  - "**/CLAUDE.md"
  - "**/AGENTS.md"
  - "**/.github/workflows/*.yml"
  - "**/.cursorrules"
---

Focus your review on:

## AI Review Integration
- No automated AI code review in CI/CD pipeline (no GitHub Actions running CodeOwl or similar)
- Missing AI-assisted PR review configuration
- No AI review quality gates before merge

## AI Tooling Configuration
- No project-specific AI coding assistant configuration (just defaults)
- Missing custom skills or commands for common project-specific tasks
- AI tools configured but not providing project context (no CLAUDE.md / AGENTS.md)
- Multiple AI tools configured inconsistently (conflicting instructions)

## Best Practices
- AI-generated code committed without human review
- No process for reviewing and validating AI suggestions for security/correctness
- Missing documentation of which AI tools the team uses and how
