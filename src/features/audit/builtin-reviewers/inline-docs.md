---
id: inline-docs
name: Inline Documentation
description: Checks for missing JSDoc/Docstrings on public methods and complex logic blocks.
enabled: true
mode: audit
category: documentation
scopeHints:
  - api
  - service
  - util
  - helper
  - lib
  - interface
  - type
  - function
  - class
---

Focus your review on:

## Exported Functions and Methods
- Exported functions or module-level functions missing a JSDoc comment (`/** ... */`) or docstring (`"""..."""`) entirely
- Public class methods (non-private, non-protected) without a doc comment explaining the method's purpose, parameters, and return value
- Exported arrow functions or function expressions assigned to a `const` missing any documentation
- Overloaded function signatures in TypeScript without a doc comment on the implementation signature explaining the overloading behavior

## Parameter and Return Documentation
- `@param` tags absent for functions with more than one parameter, or present but missing the parameter description (just the name, no explanation of what it represents or its valid range)
- `@returns` or `@return` tag missing for non-void functions whose return value is non-obvious from the type alone
- `@throws` or `@throws {ErrorType}` missing for functions that can throw non-trivial errors that callers must handle
- `@param` or `@returns` types that do not match the actual TypeScript/Go/Java types in the function signature — outdated docs that contradict the implementation

## Type Aliases and Interfaces
- Exported TypeScript `interface` or `type` definitions without a JSDoc comment explaining the shape's purpose and where it is used
- Individual properties within an exported interface or type that have non-obvious meanings (e.g., `flags: number`, `mode: string`) without inline property-level JSDoc (`/** ... */` above the property)
- Enum members without JSDoc explaining what each value represents when the values are not self-explanatory
- Generic type parameters (`<T>`, `<K, V>`) without `@template` documentation when their constraints or intended semantics are not obvious from the constraint alone

## Complex Logic Blocks
- Algorithms or logic blocks longer than approximately 15 lines that are non-obvious (sorting with unusual comparators, bitmask operations, state machines, recursive tree traversals) without an explanatory comment above the block
- Non-trivial regular expressions without a comment explaining what the pattern matches and why it was constructed that way
- Magic numbers or magic strings used in computation without a named constant or inline comment explaining their origin (e.g., `* 86400` without a comment indicating "seconds per day")
- Multi-step data transformation pipelines (chained `.map().filter().reduce()`) without a comment describing the overall transformation intent

## TODO and FIXME Quality
- `TODO` or `FIXME` comments without a reference to an issue tracker ticket (e.g., `// TODO: fix this` without `// TODO(#1234)` or a linked issue URL), making them untraceable and likely to be forgotten
- `HACK` or `WORKAROUND` comments without an explanation of why the hack is necessary and what the proper long-term fix would be
- `@deprecated` annotations without an explanation of what to use instead and when the deprecated code will be removed

## Outdated Comments
- Inline comments that describe behavior that the code no longer implements — the comment says one thing but the code does another
- Doc comments with example code snippets that use an outdated API (function renamed, parameters changed, return type changed) that would fail if a user tried to copy and run the example
- Class-level or module-level documentation that describes responsibilities that have been moved to other modules, without being updated to reflect the refactored structure
- `@since` or `@version` tags in JSDoc that reference versions significantly older than the current package version, suggesting the comment was written once and never revisited

## File and Module Level
- Module-level or file-level documentation comment missing on files that export a public API surface — a reader should be able to understand the module's purpose from the top of the file
- Class-level JSDoc missing on exported classes, especially those with non-trivial construction requirements or lifecycle constraints
- Missing documentation on constructor parameters for classes where the constructor accepts complex options objects
