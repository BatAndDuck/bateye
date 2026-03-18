---
id: input-validation
name: Input Validation
description: Ensures external payloads and user inputs are properly sanitized and validated before processing.
enabled: true
mode: both
category: security
selectWhen: "select when code adds or modifies user-facing input handlers, API request parsing, form processing, query parameter handling, or any code that accepts external data; skip for purely internal transformations or read-only code"
---

Focus your review on:

## Schema Validation on Request Inputs
- Request body accessed (`req.body`, `request.json()`, `@Body()`) without any schema validation library (Zod, Joi, Yup, class-validator, Pydantic, go-playground/validator) before use
- Validation schema defined but not actually applied to the incoming request (schema created but `.parse()` / `.validate()` not called, or validation middleware not wired to the route)
- Schema validation only on a subset of fields while other request body properties are used without validation
- Error handling for validation failures missing — parse errors uncaught, allowing the application to proceed with invalid data
- Validation performed on the serialized string representation rather than the deserialized object, missing type coercion issues

## Query Parameters and Path Variables
- URL query parameters (`req.query.*`, `request.args.get()`) used directly in business logic or passed to downstream calls without type checking or allowlisting
- Path parameters (`req.params.*`) cast to a numeric type without bounds checking (e.g., negative IDs, extremely large integers)
- Query parameter values used as boolean flags via truthy checks rather than strict string comparison (`=== "true"`)
- Multiple query parameters combined without validating their mutual consistency (e.g., `startDate` and `endDate` where end must be after start)

## Type Coercion and Casting
- External data assumed to be a specific type without explicit coercion: using `+req.body.age` or `parseInt(value)` without validating the input is actually numeric first
- Objects or arrays from external sources spread or destructured without confirming their structure (e.g., `const { role, ...rest } = req.body` when `role` should not be user-settable)
- `JSON.parse()` on user-supplied strings without catching `SyntaxError` and without schema validation of the resulting object

## Length and Range Constraints
- String fields without maximum length validation — long inputs can cause denial of service, database errors, or log bloat
- Numeric fields without minimum and maximum bounds — negative quantities, zero-division inputs, or unreasonably large values not rejected
- Array or list inputs without a maximum element count — unbounded arrays can exhaust memory or trigger O(n²) processing
- Pagination parameters (`page`, `limit`, `offset`) without upper bounds — a caller requesting `limit=1000000` should be rejected or clamped

## File Upload Validation
- File upload handlers that do not validate the MIME type or content type of uploaded files (relying only on the client-supplied `Content-Type` header)
- Missing file size limit on upload handlers — no `maxSize` configuration in the multipart parser
- File extension not validated or validated only by string suffix without inspecting the actual file content (magic bytes)
- Uploaded files processed (parsed, executed, or rendered) without virus scanning or safe content checking in security-sensitive contexts
- Temporary files from uploads not cleaned up on error paths

## Regular Expression Safety (ReDoS)
- Regular expressions with nested quantifiers or overlapping alternatives applied to user-controlled input (e.g., `/(a+)+$/`, `/(a|aa)+$/`) — these patterns have exponential worst-case matching time
- User-supplied regex patterns accepted and compiled at runtime (`new RegExp(userInput)`) without sanitization or timeout
- Email or URL validation regexes with catastrophic backtracking potential applied to unbounded user input without a length limit guard

## Nested and Complex Input Structures
- Deeply nested JSON objects from external sources traversed recursively without depth limiting, risking stack overflow
- Array of objects accepted from the client where only the top-level array length is checked, not the size of nested objects
- Union or discriminated union types in request bodies where the discriminator field is not validated before branching logic
- Missing validation of object keys when a map/dictionary structure is accepted from external input

## Trust Boundary Violations
- Values sourced from external APIs, webhooks, or third-party integrations used directly without re-validation at the trust boundary
- Internal service calls that skip validation because the caller is assumed to be trusted, even though the data ultimately originates from user input
- Headers (e.g., `X-Forwarded-For`, `X-User-Id`) used directly for authorization or routing decisions without server-side enforcement that the header is set by a trusted proxy
- Treating `localStorage` or cookie values as trusted inputs in server-side logic without re-validation

## Scope Clarification
- This reviewer does NOT cover SQL injection or XSS — those are in the `owasp` reviewer
- This reviewer does NOT cover authentication or authorization logic — those are in `security-api` and `authorization-logic` reviewers
