---
id: local-setup
name: Local Development Setup
description: Evaluates onboarding experience, environment configuration, developer tooling, and reproducibility of the local development environment.
enabled: true
mode: audit
category: devex
scopeHints:
  - readme
  - setup
  - install
  - env
  - docker
  - compose
  - makefile
  - script
  - dev
  - start
recommendedGlobs:
  - "**/README*"
  - "**/.env*"
  - "**/docker-compose*"
  - "**/Makefile"
  - "**/package.json"
  - "**/pyproject.toml"
---

Focus your review on:

## Onboarding Experience
- README missing or lacking step-by-step getting started instructions
- More than 3 commands required to get the application running locally
- Setup steps requiring manual actions not covered in documentation
- Missing prerequisite software versions (Node 18+, Python 3.11+, Docker 24+)

## Environment Configuration
- .env.example missing or not kept in sync with actual required environment variables
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
