---
id: gdpr-pii
name: GDPR & PII Protection
description: Ensures personal data is masked in logs, handled with consent, and not unnecessarily retained.
enabled: true
mode: audit
category: compliance
selectWhen: "select when code handles user profiles, personal data (email, phone, address, IP), logging, analytics, or third-party data sharing; particularly important for applications serving EU users or subject to GDPR; skip for internal tooling with no personal data handling"
---

Focus your review on:

## PII in Logs
- Email addresses, phone numbers, SSNs, passport numbers, or national IDs logged in plaintext via `console.log`, `logger.info`, `print`, or equivalent
- IP addresses logged without pseudonymization - under GDPR, IP addresses are considered personal data
- Full names or usernames included in log messages at `INFO` or `DEBUG` level that persist in log aggregation systems
- Request/response body logging middleware that captures full payloads without redacting PII fields
- Error stack traces that include user-supplied data (e.g., `Error: User john.doe@example.com not found`) forwarded to log aggregators

## Third-Party Data Sharing
- User data (email, device ID, behavioral events) sent to third-party analytics services (Google Analytics, Segment, Mixpanel, Amplitude) without evidence of a consent gate being checked first
- Tracking pixels or SDKs initialized unconditionally on page load without waiting for user consent confirmation
- User identifiers or attributes forwarded to advertising networks or data brokers without explicit consent
- Server-side API calls to third-party enrichment services (Clearbit, Hunter.io) that send user email or personal data without consent or a legitimate interest basis

## Data Minimization
- More personal data collected in forms, API payloads, or registration flows than is necessary for the stated purpose
- PII fields included in analytics event payloads where an anonymous identifier would suffice
- Full date of birth stored when only age group or birth year is needed for the feature
- Location data collected at high precision (GPS coordinates) when only city-level resolution is needed

## PII in Error Responses
- Detailed error messages returned to the client that include PII (e.g., `"User with email john@example.com already exists"` - leaks whether an email is registered)
- Validation error responses that echo back the invalid user-supplied PII value rather than a generic error code
- API responses that include more user fields than necessary for the operation (over-fetching with unexposed PII fields)

## Data Retention
- User data stored without any code-level indication of a retention policy or TTL (no expiry date on stored records, no scheduled cleanup job)
- Audit or event logs containing PII with no log rotation or anonymization after a defined retention period
- Backup or export operations that include unmasked PII without access controls equivalent to the production database

## Anonymization and Pseudonymization
- Analytics pipelines that use real user IDs or email addresses as event identifiers rather than pseudonymous IDs (hashed or tokenized)
- A/B test or feature flag tracking that ties experiment exposure to identifiable user data without anonymization
- Data exports or reports that include raw PII rather than aggregated or anonymized statistics
- Machine learning training datasets generated from production data without PII stripping or k-anonymity guarantees

## Cookie Consent and Tracking
- Cookies placed before the user has interacted with a consent banner (pre-consent cookie setting)
- Non-essential cookies (analytics, marketing) not conditioned on a positive consent signal from the consent management platform
- Consent state not persisted across sessions, causing repeated consent prompts or loss of consent records
- `document.cookie` or cookie library calls for non-essential cookies that do not check the consent store first

## Right to Erasure
- User deletion flows that soft-delete records (set `deleted_at`) without removing or anonymizing the PII fields - the data is retained but hidden
- Cascade deletion not implemented for related records containing PII when a user account is deleted
- Backup systems or append-only audit logs that retain PII after account deletion with no documented exception or anonymization step
- Third-party integrations not included in the deletion flow (e.g., CRM, mailing list, analytics user profile not deleted on account removal)

## PII Exposure in URLs and Storage
- User email addresses or other PII embedded in URL paths or query parameters (e.g., `GET /users/john@example.com/profile`) - URLs are logged in access logs and browser history
- User PII stored in `localStorage` or `sessionStorage` where it is accessible to any script on the same origin
- Unencrypted PII stored in browser cookies (should be server-side session references only)
- User identifiable data included in analytics event names or URL paths tracked by third-party tools
