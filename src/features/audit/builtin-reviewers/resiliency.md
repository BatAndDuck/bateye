---
id: resiliency
name: Resiliency & SRE Practices
description: Identifies missing timeouts, retry/backoff logic, health check issues, and single points of failure that make services fragile under real-world conditions.
enabled: true
mode: both
category: sre
scopeHints:
  - http
  - client
  - fetch
  - retry
  - timeout
  - circuit
  - external
  - api
  - service
  - downstream
  - upstream
---

Focus your review on:

## External Calls
- HTTP calls to external services without timeout configuration
- Missing retry logic on transient network errors (503, 429, connection reset)
- Missing exponential backoff with jitter on retries
- Cascading failures: errors from one dependency bringing down the whole service

## Health & Readiness
- Service missing /health or /healthz endpoint for load balancer health checks
- /health endpoint that always returns 200 regardless of dependency state
- Missing readiness vs liveness distinction (service is live but not ready to accept traffic)
- Health check performing expensive operations on every check

## Graceful Degradation
- Service returning 500 for non-critical feature failures (should return partial results)
- Missing fallback data for failed external calls (default values, cached responses)
- No degraded mode when non-critical dependencies are unavailable
- Single point of failure in critical request path with no alternative
