---
id: dependency-bloat
name: Dependency Bloat
description: Identifies unnecessary, unused, and over-sized dependencies that inflate bundle size and maintenance burden, including dev dependencies misplaced in production.
enabled: true
mode: both
category: dependency
scopeHints:
  - package
  - dependency
  - import
  - require
  - npm
  - pip
  - go.mod
  - maven
  - gradle
  - module
---

Focus your review on:

## Unnecessary Dependencies
- Large libraries imported for a single utility function (moment for date formatting, lodash for one function)
- Packages that duplicate built-in language/runtime capabilities (e.g., isString package, uuid when crypto.randomUUID exists)
- Development dependencies accidentally in production dependencies
- Packages added but never actually used in the codebase

## Bundle Impact
- Heavy transitive dependencies pulled in by a small utility package
- Packages with no tree-shaking support forcing full bundle inclusion
- Duplicate packages at different versions in the dependency tree

## Maintenance Risk
- Packages with very few weekly downloads or GitHub stars (low adoption = high abandonment risk)
- Large monorepo packages imported when only a sub-package is needed
- Packages with known performance issues in their dependencies
