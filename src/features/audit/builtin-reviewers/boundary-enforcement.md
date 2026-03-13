---
id: boundary-enforcement
name: Layer Boundary Enforcement
description: Detects violations of layered architecture, clean architecture, and hexagonal architecture patterns where code crosses layer boundaries inappropriately.
enabled: true
mode: audit
category: architecture
scopeHints:
  - repository
  - controller
  - service
  - usecase
  - domain
  - infrastructure
  - presentation
  - api
  - db
  - model
---

Focus your review on:

## Layered Architecture Violations
- Presentation or controller layer directly importing from repository or data-access layer, bypassing the service or use-case layer entirely
- Route handlers or controllers containing SQL queries, ORM calls, or raw database access
- Repository or data layer importing from business logic or presentation layers, reversing the dependency direction
- Domain or entity models importing framework-specific annotations, HTTP libraries, or ORM base classes that tie them to infrastructure
- Circular imports between layers — e.g., service importing from controller, which also imports from service
- Utility or helper files in one layer that directly access database connections belonging to another layer
- Test code that tests business logic by going through HTTP handlers, coupling the test to the presentation layer

## Clean Architecture / Hexagonal Architecture
- Core domain logic importing from external framework adapters — domain entities should have no knowledge of Express, Spring, Django, etc.
- Use cases or application services that directly call database libraries (Sequelize, TypeORM, SQLAlchemy, GORM) instead of going through a repository interface
- Infrastructure concerns leaking into business logic: HTTP status codes in domain objects, database column names referenced in service methods, framework error types caught in use cases
- Missing dependency injection — concrete infrastructure implementations instantiated directly inside use cases rather than injected through constructor or parameter interfaces
- Port interfaces (repository interfaces, external service interfaces) defined in the infrastructure layer rather than in the application or domain layer
- Adapters (controllers, repositories) that contain business rules instead of delegating to domain/use-case objects
- Domain events that carry framework-specific types (e.g., ORM entity instances) instead of plain domain value objects

## Module Cohesion
- Business logic scattered across multiple layers without a single clear owner — the same concept partially in the controller, partially in the service, partially in the model
- Cross-cutting concerns (logging, authentication, authorization, request tracing) duplicated throughout business logic instead of centralized in middleware, decorators, or aspects
- Feature code split across too many packages or directories with unclear conceptual boundaries, making it impossible to change a feature without touching many modules
- Shared mutable state (global singletons, module-level variables) accessed across layer boundaries, introducing hidden coupling
- Infrastructure adapters that bundle together multiple unrelated responsibilities (one file handling both HTTP and database concerns)
- Domain models that accumulate presentation helpers, serialization logic, and persistence mappings alongside business behavior
