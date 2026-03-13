---
id: data-privacy
name: Data Privacy
description: Reviews how sensitive and personal data is stored, whether data minimization principles are followed, and whether access patterns enforce proper tenant isolation and field-level authorization.
enabled: true
mode: both
category: database
scopeHints:
  - user
  - profile
  - personal
  - email
  - phone
  - address
  - password
  - secret
  - sensitive
  - pii
  - store
  - persist
recommendedGlobs:
  - "**/*.ts"
  - "**/*.js"
  - "**/*.py"
  - "**/*.go"
  - "**/*.sql"
  - "**/*.prisma"
  - "**/migrations/**"
---

Focus your review on:

## Data Storage
- Passwords stored as plaintext or with weak hashing (MD5, SHA1 without salt)
- PII stored in plaintext when encryption at rest is required
- Sensitive fields (SSN, credit card, health data) stored without encryption
- Sensitive data stored in application logs or audit tables

## Data Minimization
- Collecting and persisting more user data than needed for the feature
- Data without retention/expiry policy (stored forever when it should be deleted)
- PII in places it shouldn't be: analytics events, error tracking, test databases

## Access Patterns
- No row-level security or data isolation between tenants
- Sensitive data returned to clients who shouldn't see it (missing field-level authorization)
- Missing anonymization for data shared with analytics or data science
