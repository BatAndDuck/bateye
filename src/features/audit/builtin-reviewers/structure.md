---
id: structure
name: Code Structure
description: Reviews file organization, directory layout, import patterns, and cross-codebase consistency to ensure the codebase remains navigable as it grows.
enabled: true
mode: audit
category: code-quality
scopeHints:
  - module
  - package
  - directory
  - folder
  - index
  - barrel
  - feature
  - domain
  - layer
recommendedGlobs:
  - "**/*.ts"
  - "**/*.js"
  - "**/*.py"
  - "**/*.go"
  - "**/*.java"
---

Focus your review on:

## File Organization
- Feature code scattered across unrelated directories rather than grouped by feature or domain — finding all files for a given feature requires knowing many different locations
- Flat directory structures that don't reflect the system's conceptual boundaries — every file in the same directory regardless of layer, domain, or responsibility
- Files exceeding 300 lines of code — a strong signal that the file has accumulated too many responsibilities and should be split by concern
- Inconsistent file naming conventions within the same project: PascalCase mixed with kebab-case mixed with snake_case for files of the same type (e.g., services named `UserService.ts`, `auth-service.ts`, and `payment_service.ts`)
- Test files not co-located with the production code they test — distant placement makes it harder to notice when tests are out of date with code changes
- Configuration or environment files mixed into source directories rather than having a designated configuration directory

## Import/Dependency Patterns
- Deep relative import paths (`../../../../utils/foo`, `../../../shared/types`) indicating missing module boundaries that would allow absolute or alias-based imports
- Barrel files (`index.ts`, `__init__.py`) that re-export every internal symbol, making it impossible to tree-shake or control what is public versus internal
- Circular dependency chains — module A imports from B which imports from C which imports from A — these prevent clean module loading and indicate a design problem
- Inconsistent import aliasing — some files using `@/` path aliases, others using relative paths, others using absolute paths for the same imports
- Importing from deep internal paths of third-party packages (`lodash/internal/...`) rather than the package's public API, creating brittleness to upstream changes
- Test utilities and test fixtures imported from production source directories rather than from a dedicated test helpers location

## Consistency
- Similar patterns implemented differently across different parts of the codebase — service initialization, route definition, error handling, or data mapping done multiple different ways for the same purpose
- Inconsistent use of `async/await` versus `.then()` chains — mixing both styles in the same module makes async flow harder to follow
- Inconsistent error handling approaches across similar modules — some throw, some return null, some use a Result type for functionally identical operations
- Inconsistent use of types and interfaces across similar structures — some DTOs use `interface`, others use `type`, others use `class` with the same shape, without a consistent rationale
- Inconsistent export patterns — some modules use named exports exclusively, others use default exports, others mix both for similar types of symbols
- Inconsistent test naming and structure — some tests use `describe`/`it`, others use `test` at the top level, others use custom frameworks, without a standard across the project
