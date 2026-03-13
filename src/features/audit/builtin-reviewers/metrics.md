---
id: metrics
name: Metrics & Telemetry
description: Identifies missing instrumentation on new endpoints and jobs, metric quality problems (missing labels, high-cardinality abuse), and gaps in alerting readiness.
enabled: true
mode: both
category: sre
scopeHints:
  - metric
  - counter
  - gauge
  - histogram
  - prometheus
  - statsd
  - datadog
  - telemetry
  - monitor
  - observ
recommendedGlobs:
  - "**/*.ts"
  - "**/*.js"
  - "**/*.py"
  - "**/*.go"
  - "**/*.java"
---

Focus your review on:

## Missing Instrumentation
- New API endpoints without request count, latency, and error rate metrics
- Background jobs without success/failure/duration metrics
- Queue consumers without message processing rate and lag metrics
- External API calls without metrics (latency, error rate, circuit breaker state)

## Metric Quality
- Metrics without labels/dimensions that would allow filtering by environment, service, or endpoint
- High-cardinality labels on metrics (user IDs, request IDs as metric labels — causes metric explosion)
- Missing SLI metrics for user-facing operations (availability, error rate, latency P99)
- Histogram buckets not aligned with SLO thresholds (can't compute P99 accurately)

## Alerting Readiness
- New features without corresponding runbook or alert definition
- Metrics emitted but no alert configured for abnormal values
- Missing business metrics alongside technical metrics (transactions/second, not just requests/second)
