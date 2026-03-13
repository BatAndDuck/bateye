---
id: tracing
name: Distributed Tracing
description: Reviews trace context propagation across async boundaries and services, span quality, and instrumentation gaps that make it impossible to follow a request through the system.
enabled: true
mode: both
category: sre
scopeHints:
  - trace
  - span
  - opentelemetry
  - otel
  - jaeger
  - zipkin
  - datadog
  - apm
  - context
  - propagation
---

Focus your review on:

## Trace Context Propagation
- Trace context not propagated in outgoing HTTP requests (missing traceparent header)
- Async operations (setTimeout, setInterval, Promise.all) that lose trace context
- Message queue producers not injecting trace context into message headers
- Queue consumers not extracting and continuing the trace from message headers

## Span Quality
- Operations without spans (database calls, external API calls, complex business operations not traced)
- Spans without meaningful names (generic "HTTP request" instead of "GET /api/users/{id}")
- Missing span attributes (HTTP status code, DB query, error details)
- Spans not marked as errors when operations fail

## Instrumentation Gaps
- New microservice or external integration not instrumented with OpenTelemetry
- Manual timing code (Date.now()) used instead of proper span duration
- Missing correlation between logs and traces (logs not tagged with trace ID)
