---
id: resilience-patterns
name: Resilience Patterns
description: Identifies missing circuit breakers, retry/timeout configuration, graceful degradation, and bulkhead isolation in service-to-service communication.
enabled: true
mode: audit
category: architecture
selectWhen: "select when code makes external HTTP calls, uses service clients, calls third-party APIs, or implements retry/timeout/circuit-breaker logic; skip for CLI tools, libraries, or repos with no outbound service-to-service communication"
---

Focus your review on:

## Circuit Breakers
- External service calls (HTTP, gRPC, database, cache) made without a circuit breaker — a sustained outage in a downstream dependency will block and exhaust threads/connections in the calling service
- No fallback behavior defined for when a downstream service is unavailable — the calling service should degrade gracefully rather than hard-fail
- Hard failures from optional or non-critical dependencies propagating all the way up the call stack and returning errors to users
- Circuit breaker thresholds not configured — default open/close thresholds may be too aggressive or too lenient for the service's SLO
- Missing half-open state probe logic — circuit that opens never tests whether the dependency has recovered
- Circuit breaker state not shared across multiple instances of the calling service (in-process only), so each instance opens independently with full retry load

## Retry & Timeout
- HTTP or gRPC calls made without an explicit timeout — a slow downstream response will hold the connection open indefinitely, exhausting connection pools
- Missing retry logic for transient failures (network hiccups, 503s, rate limit responses) — one bad request should not permanently fail the operation
- Retry logic without exponential backoff — fixed-interval retries add a constant load on an already-struggling downstream service
- Retry backoff without jitter — all clients back off for the same duration and retry simultaneously, creating a thundering herd
- Retrying non-idempotent operations (POST, PATCH without idempotency key) where retries can cause duplicate side effects (double charges, double sends)
- Infinite retry loops without a maximum attempt count or deadline, causing requests to hang indefinitely
- Retry logic that retries on all error codes, including 4xx client errors that will never succeed regardless of how many times they are retried

## Graceful Degradation
- Features that fail completely and return errors when a partial response would still be valuable to the caller
- Missing default or cached fallback values when an external call fails — returning stale data is often better than returning nothing
- All-or-nothing aggregation responses where one failed upstream call causes the entire response to fail, even when other data sources are healthy
- No circuit to serve from cache when the primary data source is unavailable
- UI or API responses that expose internal error details to end users instead of a graceful degraded response
- Missing feature flags or kill switches that allow disabling a non-critical integration without a deployment

## Bulkhead Pattern
- Shared thread pools or connection pools across critical and non-critical execution paths — a slow non-critical operation can exhaust resources needed for critical paths
- Slow downstream dependencies that block the main request-handling thread or event loop, degrading the entire service
- Missing resource isolation between tenants in multi-tenant systems — one tenant's high load should not degrade service for others
- Missing separate timeouts and circuit breakers per downstream dependency — a single global timeout applies the same policy to fast and slow dependencies alike
- Database connection pool shared between OLTP request handlers and long-running batch or analytics queries
- Missing queue depth limits — an unbounded work queue allows one slow consumer to grow memory usage without bound

Requirements:
- Only apply this reviewer when the repository clearly contains service-to-service or process-to-process communication that the code under review directly controls.
- Do not require circuit breakers, bulkheads, or readiness endpoints for CLI tools, libraries, static analysis tools, or repos that do not expose a long-running service boundary.
- If network policy, retry, timeout, or fallback behavior is centralized in a shared client or runtime abstraction, prefer findings on that abstraction instead of duplicating the same recommendation at each caller.
- Return no finding rather than a speculative architecture wish when the repository does not show enough operational context.
