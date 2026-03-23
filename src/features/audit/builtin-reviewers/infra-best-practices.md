---
id: infra-best-practices
name: Infrastructure Best Practices
description: Reviews infrastructure configuration for environment parity, networking security, and operational readiness gaps that increase incident risk or recovery time.
enabled: true
mode: audit
category: infrastructure
selectWhen: "select for audits of infrastructure configuration, networking, environment parity, and operational readiness; most useful as a periodic audit; skip for pure application code changes with no infrastructure or deployment configuration"
---

Focus your review on:

## Environment Parity
- Production-only services or configurations not mirrored in staging — differences between environments cause bugs that only appear in production and cannot be reproduced locally
- Significantly different instance types or sizes between staging and production that mask memory or CPU-related issues during testing
- Environment-specific secrets or connection strings hardcoded in configuration files instead of injected through environment variables or a secrets manager
- `.env.example` or documented environment variables out of sync with the actual variables the application reads — new required variables added without updating the example file
- Services that exist in production but are mocked or absent in staging, allowing integration bugs to reach production undetected
- Database migration process or schema state not kept in parity between environments, causing staging tests to validate against a different schema than production

## Networking
- Compute resources (databases, internal APIs, cache clusters) placed in public subnets when they should be in private subnets with no direct internet access
- Missing VPC, virtual network, or equivalent network segmentation — all services sharing a flat network with no isolation boundaries
- DNS not configured with health checks for automatic failover — a primary endpoint going down requires manual DNS update rather than automatic rerouting
- Missing or improperly configured SSL/TLS termination — services accessible over HTTP in non-local environments
- Self-signed certificates used in staging or pre-production environments that are different from the CA-signed certificates in production, hiding TLS configuration bugs
- Overly broad security group or firewall rules granting more network access than the service requires — principle of least privilege applies to network as well as IAM
- Missing egress filtering — services able to make outbound connections to any internet endpoint, which increases data exfiltration risk and complicates compliance

## Operational Readiness
- No runbook, operations guide, or incident response documentation for the infrastructure — during an incident, responders must rediscover how to operate the system under pressure
- Missing alerting configuration for critical resource metrics: CPU, memory, disk usage, connection pool exhaustion, error rates, queue depth
- Deployment scripts or automation that cannot be safely rolled back — changes should be reversible in the event of a bad deploy
- Manual steps required in the deployment process that are not captured in automation — undocumented manual steps are skipped under pressure or performed incorrectly
- Missing infrastructure change preview in CI — Terraform plan or equivalent not run as part of the PR pipeline, allowing infrastructure changes to be merged without review
- No drift detection or reconciliation — infrastructure state can diverge from IaC definitions through manual console changes without detection
- Missing on-call rotation or escalation path documented alongside the infrastructure, leaving unclear who is responsible during an incident
