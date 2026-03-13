---
id: audit-log
name: Audit Trail
description: Verifies that critical state changes write to an immutable audit trail.
enabled: true
mode: both
category: compliance
scopeHints:
  - audit
  - log
  - event
  - history
  - journal
  - change
  - admin
  - permission
  - payment
  - delete
---

Focus your review on:

## Critical Operations Without Audit Entries
- User role or permission changes (grant, revoke, escalate) that do not write an audit log entry before or after the change takes effect
- Account lifecycle events (creation, deletion, suspension, reactivation) not recorded in the audit trail
- Payment events (charge, refund, subscription change, payment method update) executed without a corresponding audit record
- Data export or bulk download operations not logged — these are high-risk events for data exfiltration that require accountability
- Administrative operations (config changes, feature flag toggles, system settings modifications) missing from the audit log
- Sensitive data access (viewing PII, reading health records, downloading financial data) not recorded when an audit trail is required by policy or regulation

## Audit Log Integrity
- Audit log entries written to the same database table or storage location as the operational data, allowing the same application code or database user that creates business records to also delete or modify audit entries
- Audit records updated or overwritten after the fact — audit entries should be append-only and immutable
- Audit log table lacking the constraints (no DELETE permission on the app DB user, insert-only storage, WORM storage backend) that would prevent tampering
- Audit entries generated in the same transaction as the business operation without a compensating mechanism to ensure the audit write succeeds even if the business transaction is rolled back

## Required Fields in Audit Entries
- Actor identity missing from audit log entries — who performed the action (user ID, service account, API key identifier) must be recorded
- Timestamp missing or using a non-monotonic clock that can be manipulated — audit timestamps should use server-side UTC time, not client-supplied values
- Client IP address or request origin missing from audit entries for user-initiated operations
- Resource identifier missing — the audit entry records the action type but not which specific record was affected (e.g., "role changed" without the user ID whose role changed)
- Before and after state not captured for mutation operations — recording only "record updated" without the previous value makes it impossible to reconstruct what changed

## Swallowed Audit Events
- Audit log write calls inside `try/catch` blocks where the `catch` silently ignores errors, allowing the operation to proceed even if the audit entry was not persisted
- Audit log calls made asynchronously (fire-and-forget) without error handling, where a failure in the background write goes unnoticed
- Audit events conditionally emitted based on a feature flag or environment variable that could be disabled in production, creating gaps in the audit trail
- Audit log writes skipped during bulk operations or data migrations for performance reasons without a compensating batch audit record

## Completeness and Coverage
- Consistent audit logging applied to some administrative endpoints but not others of equivalent sensitivity, creating uneven coverage
- Multi-step workflows where only the final step is audited, losing the record of intermediate state changes
- Service-to-service calls that modify sensitive data not attributed to the originating user (audit shows the service account, not the human actor who triggered the flow)
- Audit trail covering the application layer but not database-level direct access (no database audit log for DBA or privileged access)

## Audit Log Access Controls
- Audit logs readable or queryable by regular application users who should not have visibility into other users' activity records
- No separation of duty between the team that can perform operations and the team that can access the audit log for those operations
- Audit log query endpoint lacking pagination or rate limiting, allowing bulk export of the entire audit history
- Audit log entries for a user not accessible to that user for their own records (right of access under GDPR), if the application is subject to such requirements
