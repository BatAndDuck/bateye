---
id: local-setup
name: Local Development Setup
description: Evaluates onboarding experience, environment configuration, developer tooling, and reproducibility of the local development environment.
enabled: true
mode: audit
category: devex
selectWhen: "select as a periodic onboarding audit or when README, setup scripts, environment configuration, or developer tooling documentation is modified; most valuable for new repositories or after major refactors"
---

Focus your review on:

## Onboarding Experience
- README missing or lacking step-by-step getting started instructions
- More than 3 commands required to get the application running locally - **Exception**: Compiled projects (TypeScript, Go, Rust) that require a build step (`install → build → link/run`) may need more commands. This is normal for CLI tools and compiled libraries; flag only if the build process is unnecessarily fragmented or undocumented.
- Setup steps requiring manual actions not covered in documentation
- Missing prerequisite software versions (Node 18+, Python 3.11+, Docker 24+)

## Environment Configuration
- .env.example missing or not kept in sync with actual required environment variables - **Note**: Only flag this if you have confirmed the file is absent AND the README explicitly references it as a setup step. The reviewer sees only a subset of the repository; if you cannot see the file in the provided snapshot, assume it may exist elsewhere unless the README itself reports an error about it.
- Environment variables with no description of what they do or valid values
- Required secrets not documented with instructions on how to obtain them
- No local development defaults for external services (should use docker-compose for local DB/Redis/etc.)

## Developer Tooling
- Missing or broken lint/format scripts (no way to auto-fix code style issues)
- Test command not documented or doesn't work out of the box
- Missing debugging configuration (VS Code launch.json, etc.)
- Hot reload not configured for local development

## Reproducibility
- Steps that work on one OS but not others (Windows/Mac/Linux differences not addressed)
- Version-pinned dependencies not reflected in lock files
- Database seed data not provided for meaningful local testing
- Missing health check or "is it working?" verification step

Requirements:
- Prefer concrete onboarding breaks over wishlist items. Missing local-setup findings should point to a command, environment variable, prerequisite, or verification step that a new contributor would realistically need.
- If the repository is a CLI or library rather than a web app, tailor setup expectations to install, build, smoke-test, and local usage workflows instead of browser or server runbooks.
- Do not flag optional tooling enhancements (VS Code launch.json, debugging config, hot reload) as findings - these are developer preferences, not onboarding blockers. Only flag what is explicitly missing and would block a new contributor from running the project.
- Missing lint/format documentation is low priority if standard npm scripts are present and discoverable via `npm run`.
