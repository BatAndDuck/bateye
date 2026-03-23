---
id: industry-compliance
name: Industry Compliance
description: Elastic template for domain-specific compliance rules (HIPAA, PCI-DSS, SOC 2, ISO 27001).
enabled: true
mode: audit
category: compliance
selectWhen: "select when the codebase handles payment card data (PCI-DSS), protected health information (HIPAA), or is subject to SOC 2 or ISO 27001 requirements; skip for applications with no regulated data or compliance framework obligations"
---

Focus your review on:

## PCI-DSS (Payment Card Industry)
- Primary Account Numbers (PAN - full 16-digit card numbers) stored anywhere after authorization: in databases, logs, files, or in-memory caches beyond the minimum necessary processing window
- Card Verification Values (CVV, CVC, CVV2) stored after authorization - PCI-DSS explicitly prohibits storing these values under any circumstances
- Magnetic stripe track data or PIN block data stored in any form
- Card numbers not masked in user-facing displays - only the last 4 digits should be visible to cardholders and support staff; intermediary digits must be masked (e.g., `**** **** **** 4242`)
- Payment processing performed without tokenization - raw PANs transmitted between services rather than using a payment gateway token (Stripe token, Braintree nonce)
- Cardholder data included in log output, error messages, or diagnostic endpoints
- Payment-related API endpoints lacking TLS enforcement - HTTP access to endpoints that handle card data must be blocked

## HIPAA (Health Insurance Portability and Accountability Act)
- Protected Health Information (PHI) - patient name, date of birth, diagnosis, treatment, medical record number, health plan ID - logged in plaintext or included in unencrypted log streams
- PHI transmitted over unencrypted channels (HTTP, unencrypted SMTP) rather than TLS-secured transport
- PHI included in URL paths or query parameters (e.g., `GET /patients/john-smith/records`) - URLs appear in access logs and browser history
- PHI accessible without minimum necessary access controls - broad database queries returning all patient fields when only a subset is needed for the operation
- PHI stored without encryption at rest in databases, file systems, or object storage
- Business Associate Agreements (BAA) not reflected in code-level data handling: PHI sent to third-party services (analytics, logging, error tracking) that are not covered under a BAA

## SOC 2 (Service Organization Control)
- Sensitive data at rest (user credentials, financial data, PII) stored without encryption - SOC 2 Trust Service Criteria require encryption of sensitive data at rest
- Missing access logging for sensitive data operations - SOC 2 availability and confidentiality criteria require audit trails for access to sensitive information
- No evidence of backup or recovery procedures in code - scheduled backup jobs, point-in-time recovery configuration, or disaster recovery runbooks not present or referenced
- Encryption keys or secrets managed without rotation logic - SOC 2 requires documented key management and rotation practices
- Monitoring and alerting absent for security-relevant events (failed logins, privilege changes, data exports) required by SOC 2 availability and security criteria
- Change management gaps: production configuration changes made without version control or peer review controls

## ISO 27001 / General Information Security Management
- Missing data classification markers - code handling data at different sensitivity levels (public, internal, confidential, restricted) without annotation or tagging that enables appropriate handling
- Unencrypted transmission of any data classified as confidential or restricted
- Access control implementation lacking the principle of least privilege - service accounts, API keys, or database users granted broader permissions than required for their function
- Hardcoded compliance-relevant configurations (encryption algorithms, key sizes, TLS versions) that should be externalized and reviewable without code changes
- Missing integrity checks on compliance-critical data - no checksums, digital signatures, or hash verification on regulated records that must not be tampered with
- Third-party dependencies used to process regulated data without evidence of vendor security assessment or contractual obligations matching the compliance framework's requirements
