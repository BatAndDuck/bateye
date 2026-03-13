---
id: iac-best-practices
name: IaC Best Practices
description: Reviews Terraform, Pulumi, and Helm configurations for security misconfigurations, missing conventions, and state management issues.
enabled: true
mode: both
category: infrastructure
scopeHints:
  - terraform
  - pulumi
  - helm
  - aws
  - azure
  - gcp
  - cloud
  - infra
  - stack
  - resource
---

Focus your review on:

## Terraform/Pulumi Conventions
- Resources defined without meaningful name tags — missing `environment`, `team`, `project`, and `managed-by` tags makes cost attribution and incident response much harder
- Hardcoded values that should be input variables: region, instance types, CIDR blocks, account IDs, AMI IDs
- Missing remote state backend configuration — local state checked into the repository causes state conflicts in team environments and exposes sensitive state data in version control
- Sensitive outputs (passwords, private keys, connection strings) declared without `sensitive = true`, causing them to appear in plan output and CI logs
- Missing version constraints on Terraform providers and external modules — unpinned versions will silently upgrade and may introduce breaking changes
- Terraform modules without a `README` or input/output documentation, making them unusable by other teams
- Resources defined without `lifecycle` rules where they are needed (e.g., `prevent_destroy` on production databases, `create_before_destroy` on resources that cannot have downtime)
- Missing `terraform fmt` and `terraform validate` enforcement in CI pipeline

## Security Configuration
- Security groups or firewall rules with `0.0.0.0/0` ingress on sensitive ports (22/SSH, 3306/MySQL, 5432/Postgres, 6379/Redis) that should be locked down to specific CIDRs or security groups
- IAM policies with wildcard `*` actions or wildcard `*` resources — always use least-privilege with explicit service and resource ARNs
- S3 buckets without server-side encryption enabled or without the public access block configuration
- Missing KMS encryption on sensitive data stores: RDS instances, EBS volumes, SQS queues, SNS topics, Secrets Manager secrets
- Overly permissive IAM roles attached to compute resources (EC2 instance profiles, Lambda execution roles, ECS task roles) with more permissions than the workload requires
- Secrets or credentials passed as plaintext environment variables in compute resource definitions instead of referencing Secrets Manager or Parameter Store
- Missing VPC endpoint configurations for services that should not route through the public internet (S3, DynamoDB, STS, Secrets Manager)
- RDS instances or clusters with `publicly_accessible = true` that should be in a private subnet

## State Management
- Committed state manipulation commands or workarounds (`terraform state mv`, `terraform state rm`) without corresponding documentation of why and what changed
- Multiple environments or workspaces sharing the same state backend path, risking state conflicts or cross-environment resource drift
- Missing remote state data sources — hardcoded resource ARNs or IDs that should be fetched from shared state via `terraform_remote_state` or SSM Parameter Store
- No state locking configured on the remote backend — simultaneous `terraform apply` runs can corrupt state
- State file stored in an S3 bucket without versioning enabled, preventing recovery from accidental state corruption

## Helm Chart Issues
- Default values that are insecure out of the box: `privileged: true`, `runAsUser: 0`, `allowPrivilegeEscalation: true` in default `values.yaml`
- Missing CPU and memory `requests` and `limits` on containers — without these, pods can consume unbounded resources and evict neighbors
- Hardcoded image tags (`latest` or a specific version embedded in templates) instead of parameterized via `values.yaml`, preventing version management per environment
- Missing liveness and readiness probes — Kubernetes cannot detect unhealthy containers or delay traffic until the container is ready
- Secrets referenced as plaintext `ConfigMap` values instead of `Secret` objects or external secrets manager references
- Missing `podDisruptionBudget` for workloads that must maintain minimum availability during cluster upgrades or node drains
- `imagePullPolicy: Always` in production charts causing unnecessary image pulls on every pod restart
