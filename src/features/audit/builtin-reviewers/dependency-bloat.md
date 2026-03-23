---
id: dependency-bloat
name: Dependency Bloat
description: Identifies unnecessary, unused, and over-sized dependencies that inflate bundle size and maintenance burden, including dev dependencies misplaced in production.
enabled: true
mode: both
category: dependency
selectWhen: "select when package.json, requirements.txt, go.mod, or equivalent dependency manifests are modified, or as a periodic audit; skip for changes with no dependency modifications"
---

Focus your review on:

## Unnecessary Dependencies
- Large libraries imported for a single utility function (moment for date formatting, lodash for one function)
- Packages that duplicate built-in language/runtime capabilities (e.g., isString package, uuid when crypto.randomUUID exists)
- Development dependencies accidentally in production dependencies
- Packages added but never actually used in the codebase

Requirements:
- **Score consistency**: Your score MUST reflect your findings. If you return 0 findings, your score MUST be 85 or higher. Never assign a score below 80 when you have no findings - that is contradictory. Only assign low scores when you have concrete filed findings to back them up.
- Treat a package as a mistaken production dependency only when the repository shows it is not required by shipped runtime code, CLI execution paths, optional runtime features, or generated artifacts that are intentionally committed.
- If the package is referenced by source files under `src/`, runtime command execution, or a production feature path, do not flag it as a devDependency mistake.
- **CLI subprocess tools**: If a package ships a CLI binary that is called via `execa`, `child_process.spawn`, or similar at runtime, it is correctly in production dependencies even if it looks like a dev tool (e.g., `dependency-cruiser`, `eslint` used as CLI scanners at runtime).
- Prefer "unused dependency" findings only when you can find no meaningful source usage at all.
- Do not treat multiple provider SDKs or a consolidated SDK as redundant by default in configurable tooling. Only report replacement opportunities when the repository evidence shows a narrower package would satisfy the actual imported surface with low migration risk.
- **Lockfile transitive dependencies**: Do NOT flag packages found in `package-lock.json` or `yarn.lock` but absent from `package.json` - transitive dependencies are expected and managed automatically. Only analyze direct dependencies declared in `package.json`.

## Bundle Impact
- Heavy transitive dependencies pulled in by a small utility package
- Packages with no tree-shaking support forcing full bundle inclusion
- Duplicate packages at different versions in the dependency tree

## Maintenance Risk
- Packages with very few weekly downloads or GitHub stars (low adoption = high abandonment risk)
- Large monorepo packages imported when only a sub-package is needed
- Packages with known performance issues in their dependencies
