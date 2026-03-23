---
id: dead-code-exterminator
name: Dead Code Exterminator
description: Finds unused code, abandoned features, permanently disabled feature flags, and commented-out blocks that add noise and maintenance burden without delivering value.
enabled: true
mode: audit
category: code-quality
selectWhen: "select for any non-trivial code change or as a periodic whole-codebase audit; particularly valuable when feature flags, old exports, or commented-out blocks are suspected; skip for documentation-only or infrastructure-only changes"
---

Focus your review on:

## Unused Code
- Exported functions, classes, or constants with no import statement anywhere in the codebase pointing to them - they are dead exports that add to the public API surface unnecessarily
- Unused local variables or function parameters that are declared but never read - they add noise and suggest the code was partially refactored without completing the cleanup
  - **Exception**: Parameters prefixed with underscore (`_param`, `_unused`) are a TypeScript/JavaScript convention for intentionally unused parameters (e.g., when implementing an interface that requires the parameter signature). Do not flag these.
- Unreachable code appearing after `return`, `throw`, `break`, or `continue` statements - the compiler or runtime will never execute these lines
- Unused imports at the top of files - symbols imported but never referenced, often left behind after refactoring
- Test cases or test suites marked as skipped (`.skip`, `@pytest.mark.skip`, `t.Skip()`) that are never re-enabled and are no longer maintained alongside the code they were meant to test
- Interface methods or abstract class methods with no implementations in the codebase - dead contract surface that was defined speculatively
- Type aliases or interfaces defined in type files but never used in any other file

## Abandoned Features
- Feature flags that are hardcoded to always be `true` or always be `false` - a permanently enabled flag means the feature is fully rolled out and the flag and its branching code should be removed; a permanently disabled flag means the feature was killed and the code path should be deleted
- Code paths guarded by environment checks that reference environment names or variables that no longer exist in any deployment configuration
- Migration scripts or one-time data fix scripts left in the codebase and in the regular execution path after they have already been run
- "v1" or "old" or "legacy" prefixed functions or classes kept alongside their "v2" replacements long after the transition was completed and the old version is no longer called
- Deprecated code marked with `@deprecated` annotations that still has callers and was never actually removed after callers were migrated
- Conditional branches guarded by version checks for application versions that are no longer supported or in use

## Commented-Out Code
- Blocks of code commented out without any accompanying comment explaining why they were disabled - without context, future maintainers cannot know whether it is safe to delete them
- Large commented-out code blocks that have been in the file for more than a few days - if the code is needed again, it exists in git history; leaving it in the file adds noise
- TODO or FIXME comments referencing work that was completed in a different PR - the comment was not cleaned up and now misleads readers about the current state of the code
- Commented-out import statements left at the top of files after the usage was removed
- Inline explanatory comments describing what the original code did that remain after the code itself was replaced with a different approach
- Debug `console.log`, `print`, or `fmt.Println` statements commented out rather than deleted - they should be removed if they were temporary debugging aids

## Requirements
- Before flagging an import as unused, verify it is not referenced **anywhere** in the file - including late in the file, in function bodies, or in calls to external APIs. You may only see a portion of large files; do NOT flag an import as unused unless you have high confidence it is truly unreferenced throughout the entire file.
- Before flagging a constant or variable as unused, confirm it is not referenced in error messages, template strings, indirect usage (e.g., `NAMES.join(', ')`), or passed to other functions.
- **Exported functions are not dead code unless you verify they are unused across the ENTIRE codebase**: An exported function, class, or constant is only dead if NO other file imports it. You typically see only a subset of the codebase. If you cannot verify all import sites, do NOT flag exported symbols as unused - assume they are imported elsewhere. This is especially important for utility files, helpers, and runtime modules.
- **Private functions that call each other**: If a function is a module-private (non-exported) helper, verify it is not called by ANY other function in the same file before flagging it. Local call graphs can be hard to trace in large files.
- Do not report findings with confidence below 0.7 - low-confidence dead code reports cause false positives that are worse than the dead code itself.
