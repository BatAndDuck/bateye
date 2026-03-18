---
id: breaking-change
name: Breaking Change Detector
description: Identifies changes that break backward compatibility for API consumers, database clients, and configuration users.
enabled: true
mode: pr-review
category: architecture
selectWhen: "select when public APIs, exported interfaces, CLI command signatures, config file schemas, database schemas, or event contracts are modified; skip for pure internal refactors with no external contract changes"
---

Focus your review on:

## Public API Contract Changes
- Removed or renamed exported functions, classes, or constants that consumers reference by name
- Changed function signatures by adding required parameters — callers will break without updates
- Removed parameters from function signatures that callers may be passing positionally or by name
- Changed parameter types to stricter or incompatible types that reject previously valid input
- Changed return types in a way that breaks callers (e.g., returning `null` where a value was guaranteed, changing shape of returned object)
- Removed fields from exported interfaces or types that downstream consumers destructure or access
- Changed field types on exported interfaces (e.g., `string` to `number`, `T` to `T | null`)
- Narrowed union types that previously accepted more variants
- Converted named exports to default exports or vice versa, breaking import syntax at call sites
- Removed re-exports from barrel/index files that consumers relied on for stable import paths

## Database Schema Breaking Changes
- Removed or renamed columns in migration files without a corresponding backward-compatible migration step
- Changed column types in a non-compatible direction (e.g., `varchar(255)` to `varchar(64)`, `int` to `text`)
- Removed tables that are still referenced by foreign keys or application queries elsewhere
- Added NOT NULL constraints on existing columns without providing a default value, breaking existing rows
- Dropped or renamed indexes that application queries depend on for correctness (unique constraints used for deduplication)
- Changed enum values by removing or renaming variants that existing data or code uses
- Changed primary key type or structure, breaking ORM mapping or existing references
- Removed stored procedures or views referenced by application code

## Configuration Breaking Changes
- Removed or renamed required configuration keys that existing deployments will have set
- Changed expected format or type of a configuration value (e.g., URL string to object, integer seconds to duration string)
- Removed environment variables that users or deployment pipelines have configured
- Changed CLI flag names, short forms, or default behavior in ways that break existing scripts or documentation
- Changed config file schema in a way that makes previously valid config files invalid
- Removed previously accepted config values from an enum-style field
- Changed the default value of a config key in a way that silently alters behavior for users who relied on the default

## REST/GraphQL Contract Changes
- Removed endpoint paths or changed HTTP methods that clients are calling
- Changed required request body fields — existing clients not sending the new field will receive errors
- Changed the shape of response bodies by removing fields that clients destructure
- Changed field types in JSON responses (e.g., `id` from integer to string UUID)
- Changed error response formats or error codes that clients pattern-match on
- Changed HTTP status codes returned for specific conditions (e.g., 404 to 400) that clients branch on
- GraphQL field removals or renames that break existing queries and fragments
- GraphQL type removals or interface changes that invalidate existing client operations
- Changed pagination format or cursor encoding scheme breaking clients that page through results
- Added required input fields to GraphQL mutations without default values, breaking existing mutation calls

## Severity Guidance

- Use **critical** only when the breaking change will cause immediate runtime failures in production consumers (e.g., removed required API endpoint, removed field from a response type used everywhere).
- Use **high** for changes with a clear, concrete breakage path — an external consumer calling a removed function, a removed config key that deployments will have set.
- Use **medium** for changes that are technically breaking but are unlikely to affect real consumers (e.g., a helper function removed from an internal utilities module).
- Use **low** or omit entirely for changes that are breaking in theory but have no realistic consumers outside the current repo.

## What is NOT a breaking change

- Removing `export` from a function or class that is only used **within the same repository** and has no external consumers — this is a visibility reduction, not a public API break. Only flag export removals if you have evidence of cross-package imports or the function is part of a documented public API.
- Making a previously exported function or type internal (un-exporting it) when the module is an application, CLI tool, or internal library not published to a package registry.
- Renaming or removing a function that has no callers outside its own file or feature folder.
- Adding optional fields to a schema or type — consumers that don't use the field are unaffected.
- Changing the implementation body of a function without changing its signature or behavior contract.
- Extracting a constant, changing a comment, or renaming an internal variable.

**Key principle**: A breaking change requires a plausible consumer. Before flagging, ask: "Does concrete evidence exist that an external caller depends on this?" For intra-repo changes, require direct evidence (an import from outside the module, documented public API, or published package usage) before raising a finding.
