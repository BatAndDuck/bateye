---
id: scalability
name: Scalability
description: Identifies horizontal scaling blockers, connection pool issues, async/concurrency anti-patterns, and uneven load distribution that limit system throughput under load.
enabled: true
mode: audit
category: infrastructure
selectWhen: "select for server-side services, APIs, or background workers where horizontal scaling, connection pooling, and throughput under load matter; skip for CLI tools, one-shot scripts, or libraries with no long-running service boundary"
---

Focus your review on:

## Horizontal Scaling Blockers
- In-process state that prevents running multiple instances: in-memory caches serving as the source of truth, local file storage for data shared across requests, in-memory queues or job registries
- Singleton patterns that rely on process-level state which is not distributed - multiple instances will have divergent state, causing inconsistent behavior
- File locks or local filesystem path assumptions that only work in a single-instance deployment (writing to `/tmp`, reading config from relative paths)
- Sticky session requirements implemented at the application level without corresponding load balancer affinity configuration - sticky sessions prevent even load distribution
- Background job or scheduler logic that must run on exactly one instance, without a distributed lock or leader election mechanism to prevent duplicate execution
- WebSocket or long-polling connections stored in process memory, making it impossible to route follow-up requests from the same client to a different instance

## Connection & Resource Pools
- New database connection opened per request instead of using a connection pool - at moderate concurrency, this exhausts database connection limits
- Connection pool `min` and `max` sizes not explicitly configured, leaving the application running with framework defaults that may be too small for production concurrency
- Missing Redis or cache client connection pooling - each cache operation opening a new TCP connection adds latency and risks hitting Redis's connection limit
- Connections not properly returned to the pool in error paths - missing `finally` blocks or error handlers that release connections, causing pool exhaustion over time
- Database connection pool too small for the expected request concurrency - requests queue waiting for a connection, artificially capping throughput
- Missing pool connection health checks - stale or broken connections not evicted from the pool cause sporadic failures until connections are recycled

## Async & Concurrency
- Blocking synchronous I/O operations inside async/event-loop contexts (Node.js, Python asyncio, Go goroutines) - a single blocking call freezes the entire event loop or goroutine scheduler
- CPU-bound operations executed on the main event loop or request thread that should be offloaded to worker threads, worker processes, or a task queue
- Missing pagination or streaming for large dataset operations - loading an entire table or large result set into memory in a single query will cause OOM under realistic data volumes
- N+1 query patterns that worsen under load: each item in a list triggers an additional database query, so 100 items cause 101 queries and 1000 items cause 1001 queries
- Sequential async operations that could be parallelized: `await a(); await b();` where `a` and `b` are independent should be `await Promise.all([a(), b()])`
- Unbounded concurrency with no semaphore or rate limiter - spawning thousands of concurrent database queries or HTTP requests overwhelms downstream systems

## Load Distribution
- Missing health check endpoints that load balancers require to detect unhealthy instances and stop routing traffic to them
- Thundering herd on startup - all service instances simultaneously query the database or external service on boot without any staggering or cache warm-up, overwhelming the dependency
- Read-heavy workloads without read replicas - all read queries going to the primary database when replicas could distribute the load
- Hotspot keys in cache (all traffic hitting the same cache key) or in database (all writes going to the same partition key) causing uneven resource utilization
- Missing rate limiting at the API level - a single client can send unlimited requests and consume all available capacity, starving other clients
- Round-robin load balancing used for requests with highly variable processing times - some backends become overloaded with slow requests while others are idle (least-connections algorithm would be better)
