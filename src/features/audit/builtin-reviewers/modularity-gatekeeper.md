---
id: modularity-gatekeeper
name: Modularity Gatekeeper
description: Enforces module boundaries, controls coupling between features, and flags growth anti-patterns that erode codebase modularity over time.
enabled: true
mode: both
category: architecture
scopeHints:
  - module
  - package
  - component
  - service
  - feature
  - index
  - barrel
  - import
  - dependency
---

Focus your review on:

## Module Coupling
- Business logic modules directly importing from each other's internal implementation files, creating tight coupling that makes refactoring one module require changes in others
- Missing clear public API surface — other modules importing internal implementation files (`/internal/`, `/_private/`, non-index files) instead of the module's published interface
- Barrel files (`index.ts`, `__init__.py`) that blindly re-export every symbol from every file in the directory, making it impossible to distinguish public API from internal implementation
- Cross-feature imports that should route through a shared interface or abstraction layer — feature A importing feature B's internals means they cannot evolve independently
- Bidirectional dependencies between modules — if A imports B and B imports A, neither can be understood, tested, or deployed independently
- Test files importing internal helpers from other modules' non-public paths, coupling tests to implementation details across module boundaries

## Cohesion Problems
- Files that mix multiple unrelated concerns in a single module — authentication logic, logging setup, and business rules combined in one file
- Modules with no identifiable single purpose or responsibility — a collection of loosely related utilities that belongs to no clear domain
- Feature code split across too many unrelated directories without a clear organizing principle, making it impossible to find all code for a given feature in one place
- "Grab bag" modules that grow by accumulation — every time someone needs a new utility, it gets added to an existing catch-all rather than placed in a domain-appropriate location
- Modules that export both domain-specific types and generic infrastructure utilities, mixing abstraction levels

## Dependency Direction
- Lower-level utility or infrastructure modules importing from higher-level feature or domain modules, reversing the intended dependency direction
- Shared utilities importing from feature-specific code — shared utilities should have no knowledge of specific features
- Plugin or extension code importing from core business logic in a way that prevents the core from being used without the plugin
- Framework or library wrapper modules that import application-specific types, creating a circular dependency between infrastructure and application layers
- Configuration or environment modules that import from business logic to determine configuration values

## Growth Anti-Patterns
- Single files exceeding 500 lines of code — almost always a signal that too many responsibilities have accumulated in one place and extraction is overdue
- Modules with more than 20 exported symbols — a large public API surface usually indicates the module needs decomposition into cohesive sub-modules
- "Utils" or "helpers" files that grow without limit — `utils.ts` with 40 unrelated functions should be reorganized by domain (e.g., `dateUtils.ts`, `stringUtils.ts`, `validationUtils.ts`)
- Continuously growing index files that accumulate new exports each sprint without corresponding removal of obsolete ones
- Modules where every new feature requires touching the same central file — a sign of a missing extension point or that the module needs splitting
- Increasing average import count per file over time — each new file importing from more and more places signals emerging spaghetti dependencies

Severity guidance:
- Large-file and cohesion findings are usually **medium**. Use **high** only when you can show a concrete coupling or change-risk problem in the current code.
- Do not report duplicated logic across layers when one module is only a thin re-export or facade over the other.
