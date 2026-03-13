---
id: caching
name: Caching Strategy
description: Reviews caching usage for missing cache opportunities, cache correctness issues (stale data, collisions, stampedes), and improper cache sizing and TTL configuration.
enabled: true
mode: audit
category: performance
scopeHints:
  - cache
  - redis
  - memcached
  - memo
  - memoize
  - ttl
  - invalidate
  - store
  - fetch
  - compute
recommendedGlobs:
  - "**/*.ts"
  - "**/*.js"
  - "**/*.py"
  - "**/*.go"
  - "**/*.java"
---

Focus your review on:

## Missing Cache Opportunities
- Expensive computations (aggregations, ML inference, complex business logic) called on every request without caching
- External API calls without response caching (repeated identical requests to third-party services)
- Database queries for rarely-changing reference data without caching
- Heavy rendering computations (PDF generation, report building) without result caching

## Cache Correctness
- Cache keys that don't include all relevant parameters (cache collisions between different users/tenants)
- Missing cache invalidation when underlying data changes (stale data served)
- Race conditions in cache population (cache stampede — many requests simultaneously compute the same value)
- Caching mutable objects by reference (mutations affect cached value)

## Cache Sizing & TTL
- Caches without eviction policy or maximum size (unbounded memory growth)
- TTLs too long for data that changes frequently
- TTLs too short for data that rarely changes (defeating the cache benefit)
- Missing cache warming strategy for cold starts
