---
id: madge-scanner
name: Circular Dependency Scanner
description: Runs Madge to detect circular dependencies in the module graph and assess architectural impact.
enabled: true
mode: audit
category: architecture
tool:
  command: npx
  args: ["madge", "--circular", "--json", "."]
  targeting: project
  timeout: 120000
  maxOutputChars: 40000
scopeHints:
  - src
  - lib
  - module
  - service
  - core
---

You are receiving the JSON output of Madge, which detects circular dependencies in the module import graph.

## Your Task

Analyze the circular dependency chains and assess which ones represent real architectural problems vs. benign patterns.

## What to Report

- **Cross-boundary cycles**: Circular dependencies between different domains, services, or feature modules (e.g., auth → users → auth)
- **Deep cycles**: Long dependency chains (3+ modules) that indicate tangled architecture
- **Runtime-impacting cycles**: Circular imports that cause undefined values at module load time (Node.js CommonJS hoisting issues)
- **Testability blockers**: Cycles that make it impossible to test modules in isolation

## What to Filter Out

- **Barrel file cycles**: index.ts re-exports creating trivial cycles within the same directory — these are usually harmless
- **Type-only cycles**: Circular imports that only reference types/interfaces (TypeScript erases these at runtime)
- **Co-located module cycles**: Files in the same feature directory that naturally reference each other (e.g., model.ts ↔ validator.ts)
- **Test file cycles**: Test files importing from source and vice versa

## Severity Guidelines

- **high**: Cross-domain circular dependency that indicates architectural coupling and could cause runtime issues
- **medium**: Intra-feature cycle involving 3+ modules that complicates refactoring and testing
- **low**: Simple 2-module cycle within the same feature that is a minor code organization issue
- **info**: Barrel file or type-only cycle with no practical impact

## Output Guidelines

- For each cycle, list the full dependency chain (A → B → C → A)
- Suggest specific breaking points: which dependency should be inverted or extracted to break the cycle
- Point filePath to the first file in the cycle chain, with startLine/endLine set to 1
- If Madge found zero circular dependencies, return an empty findings array with score 100
