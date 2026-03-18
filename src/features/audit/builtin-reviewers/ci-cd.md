---
id: ci-cd
name: CI/CD Pipeline
description: Reviews CI/CD pipeline correctness, performance, security, and reliability — covering missing gates, caching, secret hygiene, and deployment verification.
enabled: true
mode: both
category: devex
selectWhen: "select when the PR modifies CI/CD workflow files (.github/workflows/, Jenkinsfile, .circleci/, etc.), build scripts, Dockerfile, docker-compose, Makefile, or package.json scripts; skip for pure application source code changes with no build/deploy impact"
---

Focus your review on:

## Pipeline Correctness
- Missing steps that run tests before deployment
- Deployment happening without lint/type-check gates
- Missing environment-specific deployment approvals for production
- Build artifacts not versioned or tagged (can't roll back to specific artifact)

## Performance & Cost
- No caching of dependencies between runs (downloading node_modules on every run)
- Sequential steps that could run in parallel (tests + lint + build)
- All tests running on every PR regardless of changed files (no path-based filtering)
- Overly large Docker images being pulled on every build (should cache layers)

## Security
- Secrets hardcoded in workflow files instead of using GitHub/GitLab secrets
- Third-party actions used without pinned SHA (supply chain risk)
- Pull requests from forks with access to repository secrets
- Missing OIDC-based authentication (using long-lived credentials instead)

## Reliability
- Flaky steps not retried (transient failures causing full pipeline failures)
- No timeout on jobs (runaway jobs consuming CI minutes indefinitely)
- Missing notifications on deployment failure
- Deploy steps that don't verify the deployment succeeded (no health check after deploy)
