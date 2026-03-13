---
id: system-design-review
name: System Design Review
description: Evaluates the overall system architecture for distributed systems anti-patterns, scalability, data consistency, and operational readiness.
enabled: true
mode: audit
category: architecture
scopeHints:
  - service
  - module
  - api
  - gateway
  - proxy
  - db
  - cache
  - queue
  - worker
  - scheduler
  - config
recommendedGlobs:
  - "**/*.ts"
  - "**/*.js"
  - "**/*.py"
  - "**/*.go"
  - "**/*.yaml"
  - "**/*.tf"
  - "**/*.md"
---

Focus your review on:

## Distributed Systems Anti-Patterns
- Distributed monolith: services deployed independently but requiring synchronous calls to each other for every request — failure or latency in one cascades to all
- Chatty microservices: a single user request triggering dozens of synchronous calls across services, multiplying latency and failure surface
- Shared database between multiple services — two services accessing the same tables creates an invisible coupling that makes independent deployments and schema evolution impossible
- Services that expose their internal database schema (table names, column names) as part of their API contract, cementing the schema as a public interface
- Synchronous inter-service calls forming long dependency chains where the slowest service determines end-to-end latency
- Missing API gateway or service mesh for cross-cutting concerns (auth, rate limiting, observability), leading to duplication of these concerns in every service
- Tight version coupling between services — services that must be deployed in lockstep because one depends on the other's exact API version

## Scalability Design
- Stateful services that cannot be horizontally scaled because they store session state, user context, or in-progress work in process memory or local disk
- Synchronous request-response patterns used for operations that could be decoupled with async messaging, creating unnecessary latency dependencies
- Missing caching layer for expensive repeated computations or database reads that return identical results within a predictable time window
- Single points of failure: individual services, databases, or load balancers with no redundant instance or standby
- Synchronous database calls in the hot path for data that changes infrequently and could be precomputed or cached
- Write path that cannot be parallelized because it uses a single-writer pattern (one process owns all writes) without sharding
- Background jobs or cron tasks not distributed across workers — single-instance schedulers that become a bottleneck or SPOF

## Data Consistency
- Missing transaction boundaries around multi-step operations that must succeed or fail atomically — partial failures leave data in an inconsistent state
- Eventual consistency used for operations that require strong consistency guarantees (financial transfers, inventory decrements, access control changes)
- Missing saga or outbox pattern for operations that span multiple services or databases — distributed transactions without compensation logic leave orphaned state on partial failure
- Read-after-write inconsistency not accounted for — a write to a primary is immediately followed by a read from a replica that hasn't yet replicated the write
- Missing optimistic locking or version fields on entities that multiple concurrent writers could update, causing lost updates
- Caches not invalidated on write, serving stale data after mutations that should be immediately visible
- Event sourcing systems without snapshot strategy — replay time grows unbounded as event history grows

## Operational Concerns
- Services without health check endpoints (liveness and readiness probes) preventing load balancers and orchestrators from routing traffic correctly
- Missing graceful shutdown handling — services that terminate abruptly drop in-flight requests instead of draining them
- Configuration not externalized — hardcoded endpoints, connection strings, feature flags, or timeouts that require a code change and redeploy to modify
- Missing structured logging with correlation IDs, making it impossible to trace a request across service boundaries in production logs
- No distributed tracing instrumentation — latency problems in multi-service flows cannot be attributed to specific services or operations
- Missing runbook or operational documentation for failure modes and recovery procedures
- Services that cannot be re-deployed without downtime because they lack zero-downtime deployment support (rolling update, blue/green, or canary)
