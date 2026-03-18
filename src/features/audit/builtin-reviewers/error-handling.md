---
id: error-handling
name: Error Handling
description: Identifies swallowed errors, missing async error handling, improper error propagation, and error type discipline issues that cause silent failures or poor debuggability.
enabled: true
mode: both
category: code-quality
selectWhen: "almost always — select for any async functions, promise chains, try/catch blocks, service/handler code, or code that can throw or reject; skip only for pure documentation, CSS, or trivial config-value changes"
---

Focus your review on:

## Swallowed Errors
- Empty catch blocks with no logging, no re-throw, and no fallback logic — the error disappears silently and the program continues in a potentially corrupt state
- Catch blocks that log the error and then continue as if nothing happened, when the error is unrecoverable and the operation should be aborted
- Promise rejections without a `.catch()` handler — unhandled rejections cause silent failures in older Node.js versions and process crashes in newer ones
- Async functions called without `await` and without a `.catch()` attached — fire-and-forget patterns that discard errors from async operations
- `try/catch` blocks that catch all errors generically and swallow specifics needed to distinguish expected conditions from genuine failures
- Go-style error checks where the error return is assigned to `_` or simply not checked, silently ignoring failure

## Error Type Discipline
- Throwing raw strings instead of `Error` objects — strings do not have a stack trace, making the origin of the error impossible to locate in production
- All errors mapped to a single generic `Error` or `Exception` type throughout the codebase — callers cannot differentiate validation errors from network errors from authorization errors
- Error messages that include internal stack traces, file paths, SQL queries, or implementation details that are surfaced to end users in API responses or UI
- Error codes or error message strings that are dynamically generated or include variable data in ways that change the string between runs, making log aggregation by error type impossible
- Custom error classes that extend `Error` but don't call `super(message)` or don't set `this.name`, breaking `instanceof` checks and error type identification
- Errors constructed with no message at all, producing generic "Error" strings in logs that provide no debugging context

## Error Propagation
- Errors caught at the wrong architectural layer — data-access errors caught and swallowed in the infrastructure layer when the business layer should decide how to handle them
- Error context stripped during re-throw — catching an error and throwing a new generic error without wrapping the original cause, losing the root cause and original stack trace
- Multiple redundant nested `try/catch` blocks wrapping the same code path, where a single catch at the appropriate level would suffice
- Missing `finally` blocks for cleanup operations — file handles, database connections, locks, and timers not released when an error occurs in the try block
- Inconsistent error propagation patterns in the same module: some functions throw, others return `null`, others return a `Result<T, Error>` type — callers must check the source to know what to expect
- Error boundary missing at the top-level entry point — unhandled errors in request handlers or queue consumers crash the process rather than being caught and logged

## Async Error Handling
- Unhandled rejection at the top level of async initialization code — an error during startup is silently swallowed and the service starts in a broken state
- Missing error boundary for async initialization: `async main()` called without `.catch()` means startup errors crash the process with an unhandled rejection warning
- Fire-and-forget async calls inside request handlers or event consumers where errors are discarded — background operations that fail without any indication in logs or metrics
- `Promise.all` used without considering that a single rejection rejects the entire array — use `Promise.allSettled` when partial success should be handled gracefully
- Async callbacks in event emitters (`EventEmitter`, `process.on`) without try/catch wrapping — an uncaught error inside an async event handler causes an unhandled rejection
- Race conditions in cleanup logic — `finally` blocks containing async operations not awaited, meaning cleanup may not complete before the function returns
