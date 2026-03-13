---
id: separation-of-concerns
name: Separation of Concerns
description: Identifies code that mixes business logic with presentation, data access with domain logic, and cross-cutting concerns scattered throughout the codebase rather than centralized.
enabled: true
mode: audit
category: code-quality
scopeHints:
  - controller
  - service
  - repository
  - model
  - view
  - component
  - handler
  - middleware
---

Focus your review on:

## Mixing Concerns
- Business logic placed directly in controllers or route handlers: SQL queries written inline in request handlers, domain calculations performed before the service layer is reached
- Presentation concerns bleeding into the service layer: service methods that build HTML strings, format API response objects, set HTTP headers, or construct HTTP status codes
- Database access occurring directly in domain models or entity classes — persistence concerns should be separated from domain behavior
- Logging and monitoring code interleaved throughout business logic functions rather than applied as middleware, decorators, or aspect-oriented wrappers
- Input parsing and deserialization mixed into the same functions that perform business operations — these should be separate steps with clear boundaries
- Orchestration logic mixed with transformation logic in the same function — coordinating a sequence of calls is a different concern from transforming data

## Data Access
- Multiple architectural layers making direct database calls instead of all data access being routed through a repository or data-access layer
- Raw SQL queries or ORM calls scattered throughout service methods, controllers, and domain objects rather than centralized in repository classes
- Domain models with active record pattern where `save()`, `delete()`, `find()` methods are defined on the entity itself, coupling business representation with persistence behavior
- Query construction logic duplicated across multiple services where a shared query builder or repository method should own the logic
- Data transformation between persistence format and domain format performed inconsistently across layers instead of in a dedicated mapper
- Database-specific concepts (transaction objects, query builders, connection objects) passed into or returned from business logic functions

## Cross-Cutting Concerns
- Authentication and authorization checks duplicated in multiple route handlers or service methods instead of enforced by centralized middleware or a policy engine
- Input validation logic duplicated between the API request handler and the domain service, with the two implementations potentially diverging over time
- Configuration reading scattered throughout the codebase — `process.env.SOME_VAR` accessed in many different modules instead of read once and injected
- Error transformation from technical errors (database errors, network errors) to user-friendly error messages scattered across multiple catch blocks instead of handled in one place
- Request tracing or correlation ID propagation duplicated across multiple service calls instead of handled by a centralized middleware or context propagation mechanism
- Rate limiting or throttling logic implemented per-endpoint rather than centralized in a middleware or API gateway layer
