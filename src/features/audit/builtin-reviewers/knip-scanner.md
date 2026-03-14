---
id: knip-scanner
name: Knip Dead Code Scanner
description: Runs Knip to find unused files, exports, dependencies, and types — comprehensive dead code detection.
enabled: true
mode: audit
category: code-quality
tool:
  command: npx
  args: ["knip", "--reporter", "json"]
  targeting: project
  timeout: 120000
  maxOutputChars: 80000
scopeHints:
  - src
  - package
  - tsconfig
  - dependency
---

You are receiving the JSON output of Knip, which detects unused files, exports, dependencies, types, and more across the project.

## Your Task

Analyze the Knip results and report genuinely unused code that should be cleaned up.

## What to Report

- **Unused dependencies**: Packages in package.json that are never imported anywhere in source
- **Unused exports**: Functions, classes, or constants exported but never imported by any other module
- **Unused files**: Source files that are not imported or referenced by any entry point
- **Unused types**: TypeScript type definitions that are exported but never used
- **Unused dev dependencies**: Build/test tools listed but never referenced in scripts or source

## What to Filter Out

- **Plugin/loader dependencies**: Packages loaded implicitly by frameworks (e.g., babel plugins, eslint plugins, jest transformers)
- **Bin/CLI dependencies**: Packages used via `npx` or npm scripts but not imported in source
- **Dynamic imports**: Code loaded via `require()` with variable paths or `import()` with template strings
- **Re-exports**: Barrel files (index.ts) that re-export for public API — the re-export itself may appear "unused" internally
- **Configuration references**: Packages referenced in config files (tsconfig paths, jest moduleNameMapper, etc.)
- **Template/asset files**: HTML, CSS, image files that may be loaded by bundlers
- **Peer dependencies**: Packages that are expected to be provided by the consuming project

## Severity Guidelines

- **medium**: Unused production dependency adding to bundle size and attack surface
- **low**: Unused export or file that is dead code but not actively harmful
- **info**: Unused dev dependency or type that just adds clutter

## Output Guidelines

- Group findings by category (unused deps, unused exports, unused files)
- For unused exports, include the file path and export name
- For unused dependencies, name the package and recommend removal command
- Point filePath to the relevant file (the unused file, or package.json for deps)
- If Knip found nothing or all results are false positives, return an empty findings array
