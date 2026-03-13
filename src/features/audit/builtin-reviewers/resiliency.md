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

Requirements:
- Only report health, readiness, or liveness findings when the repository clearly exposes a long-running network service, worker, or API process that would reasonably be monitored by an orchestrator or load balancer.
- Only report missing timeout or retry findings when the analyzed code performs direct external I/O itself, or when the surrounding abstraction clearly lacks that policy. If a shared runtime/client layer owns outbound calls, prefer reviewing that layer instead of every caller.
- For CLI tools, libraries, build tooling, and one-shot scripts, prefer no findings unless there is concrete evidence of operational resiliency requirements in the repository.
- Do not report retries for local file reads or similar local operations unless the code shows a recurring operational failure mode or an availability requirement that makes retries meaningfully actionable.
