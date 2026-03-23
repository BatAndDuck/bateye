---
id: event-driven
name: Event-Driven Architecture
description: Reviews event-driven systems for idempotency, error handling, schema versioning, ordering assumptions, and consumer group configuration.
enabled: true
mode: audit
category: architecture
selectWhen: "select when code uses message queues, event buses, pub/sub systems (Kafka, RabbitMQ, SNS/SQS, EventBridge, Pub/Sub), or any event-driven consumer/producer patterns; skip for codebases with no messaging or async event-driven architecture"
---

Focus your review on:

## Idempotency
- Event handlers that apply side effects (write to database, send email, charge payment) without first checking whether the event has already been processed
- Missing deduplication keys or idempotency IDs on published events - without a stable identifier, consumers cannot detect and skip duplicate deliveries
- State mutations that are not idempotent by design (increment counters, append to lists) without a guard against double processing
- Handlers that assume at-most-once delivery semantics on systems that guarantee at-least-once delivery
- Missing unique constraint or conditional update at the database level to enforce idempotency even if the application check is bypassed
- Outbox table entries created without checking whether the triggering business operation was already committed

## Error Handling & Dead Letter Queues
- Missing Dead Letter Queue (DLQ) configuration - failed messages are silently dropped or cause the consumer to crash-loop without recovery path
- Uncaught exceptions inside consumer handlers that cause the process to crash, losing the message or triggering repeated redelivery without a bound
- Missing retry logic for transient failures - network timeouts or downstream unavailability should not immediately route messages to the DLQ
- Retry backoff without jitter - synchronized retries from multiple consumer instances create thundering herd on the downstream service
- Consumer code that does not explicitly reject or nack failed messages, causing the broker to consider them successfully processed and lose them
- Swallowed errors in async consumer callbacks - promises rejected inside event handler callbacks that aren't awaited or caught
- Missing alerting on DLQ depth - messages accumulating in DLQ with no operational visibility or automated recovery

## Event Schema & Versioning
- Events published without a version field - when the schema evolves, consumers have no way to distinguish old format from new format messages
- Missing event type discriminator field, requiring consumers to infer type from payload shape rather than an explicit identifier
- Event payloads that carry mutable object references (ORM entity instances, live state objects) instead of immutable snapshots of the data at publish time
- Breaking schema changes published to existing topics without a migration strategy - removed fields or changed types break existing consumers silently
- Missing correlation IDs or causation IDs, making it impossible to trace a business transaction across a chain of events in distributed logs
- Events that carry only entity IDs without sufficient payload, forcing consumers to make synchronous calls back to the producer to fetch state (CQRS anti-pattern)
- No schema registry or formal schema contract (Avro, Protobuf, JSON Schema) enforcement, allowing schema drift between producer and consumer

## Consumer Group & Ordering
- Consumer code that assumes strict message ordering when the broker or partition configuration does not guarantee it
- Processing logic that is order-dependent (e.g., applying a delta before a create event) without compensating mechanisms
- Missing consumer group configuration - consumers without a group ID each receive every message, causing duplicate processing across instances
- Consumers that perform long-running synchronous work inside the poll/receive loop, blocking message processing and causing consumer lag or partition rebalancing
- Missing backpressure handling for high-throughput topics - consumers that fall behind without rate limiting or flow control will run out of memory buffering unprocessed messages
- Single-threaded consumers for high-volume topics where partitioned parallelism should be used
- Missing lag monitoring - no alerting when consumer lag grows beyond acceptable thresholds, indicating processing is falling behind production rate
