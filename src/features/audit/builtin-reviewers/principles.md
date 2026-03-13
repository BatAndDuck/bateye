---
id: principles
name: Design Principles
description: Reviews adherence to foundational software design principles including SOLID, DRY, YAGNI, and Law of Demeter.
enabled: true
mode: audit
category: architecture
scopeHints:
  - service
  - class
  - module
  - interface
  - component
  - util
  - handler
  - controller
recommendedGlobs:
  - "**/*.ts"
  - "**/*.js"
  - "**/*.py"
  - "**/*.go"
  - "**/*.java"
---

Focus your review on:

## SOLID Principles
- Single Responsibility: classes or modules that handle multiple unrelated concerns — for example, a `UserService` that also sends emails, manages sessions, and writes audit logs
- Single Responsibility: functions that mix I/O, business logic, and validation in a single body, making unit testing impossible without mocking everything
- Open/Closed: code that requires modification to an existing class or function every time a new variant is added, rather than being extendable via interfaces or strategy injection
- Open/Closed: large switch or if-else chains dispatching on a type discriminator — a signal that polymorphism or a registry pattern should be used
- Liskov Substitution: subclasses that throw exceptions for methods the parent guarantees succeed, violating caller expectations
- Liskov Substitution: subclasses that silently ignore parameters or return empty/null where the parent always returns a value
- Interface Segregation: large interfaces with many methods where implementing classes only use a subset, forcing stub/no-op implementations
- Interface Segregation: interfaces mixing query methods, mutation methods, and lifecycle hooks that should be separate contracts
- Dependency Inversion: high-level business logic that directly imports and instantiates low-level infrastructure classes (database clients, HTTP clients, file system wrappers) rather than depending on abstractions
- Dependency Inversion: missing dependency injection — concrete implementations instantiated with `new` inside the class that uses them, making testing or swapping implementations impossible

## DRY (Don't Repeat Yourself)
- Business logic duplicated across multiple files or modules that must be kept in sync manually — a bug fix in one location leaves the other broken
- The same validation rules copy-pasted across multiple API handlers, domain methods, or form components instead of being extracted to a shared validator
- Repeated error formatting or error mapping logic spread across multiple catch blocks instead of a centralized error handler
- Magic constants (strings, numbers, limits) that appear in multiple places and will require a search-and-replace when the value changes
- The same query or data transformation repeated in multiple service methods instead of extracted to a shared query builder or mapper function
- Duplicated test setup code that should be extracted to shared fixtures or factory helpers

## YAGNI (You Ain't Gonna Need It)
- Over-engineered abstractions built for a single use case that has no realistic prospect of needing variation — a plugin system for a feature with exactly one plugin
- Generic frameworks or base classes built speculatively for hypothetical future consumers that do not yet exist
- Unnecessary indirection layers — factories that produce factories, strategies with exactly one implementation, repositories wrapping repositories
- Configuration systems with dozens of options for a feature that only ever runs in one mode
- Event-driven intra-module communication where direct function calls would be clearer and sufficient
- Heavily parameterized functions designed for flexibility that is never used — reduce to the actual required signature

## Law of Demeter
- Long method chains that access deeply nested internal state: `order.getCustomer().getAddress().getCity()` — each dot is a dependency on a collaborator's internals
- Code that receives a complex object but only needs one field from it — the field should be passed directly, not the whole object
- Service classes that reach through collaborators to access their collaborators' state, creating hidden coupling to internal structure
- Functions that navigate deeply into nested data structures passed as arguments, rather than receiving the specific value they need
- Modules that import a class only to access a static property on it — the value should be passed as a dependency instead
