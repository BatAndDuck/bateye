---
id: disaster-recovery
name: Disaster Recovery
description: Evaluates backup configuration, high availability design, and recovery procedures for gaps that would extend downtime or cause data loss during an incident.
enabled: true
mode: audit
category: infrastructure
selectWhen: "select for infrastructure or database configuration audits where backup strategy, high availability, and recovery procedures can be assessed; most useful as a periodic audit; skip for pure application logic changes with no infrastructure components"
---

Focus your review on:

## Backup Configuration
- Databases provisioned without automated backup configuration - a hardware failure or accidental deletion would cause permanent data loss
- Backups stored in the same region as the primary data source - a region-level outage or disaster would destroy both the primary and all backups simultaneously
- Missing backup retention policy or retention period set too short - a corruption event discovered days after the fact requires backups older than the retention window
- Backup files stored in the same account or with the same access credentials as the primary data - a compromised account can delete both the data and its backups
- No documented or tested restore procedure - backups that have never been verified via a test restore may be corrupt, incomplete, or take much longer to restore than the RTO allows
- Application data stored only in ephemeral container local disk or instance storage that is lost on instance replacement, reboot, or scaling event
- Point-in-time recovery (PITR) not enabled on databases where accidental data deletion or corruption is a realistic failure mode

## High Availability
- Single-instance databases with no read replica or standby instance - a primary failure requires promoting a replica that doesn't exist, causing extended downtime
- Single availability zone (AZ) deployments for services where the stated RTO cannot be met by the AZ's typical recovery time
- Load balancers with only a single registered backend target - the load balancer adds no redundancy if there is only one instance behind it
- Missing multi-region strategy for globally critical services where a full region outage would be catastrophic to the business
- Stateful workloads deployed without persistent volume claims or managed storage - data is lost if the container or pod is rescheduled to a different node
- Cache clusters with no replication or automatic failover - cache loss during a primary failure forces a cache-cold restart that overwhelms the origin database

## Recovery Procedures
- Missing graceful shutdown handling - services that receive SIGTERM and immediately terminate drop all in-flight requests, causing errors during every rolling deployment
- No data migration rollback strategy - schema migrations that cannot be reversed mean any deployment of a bad migration requires manual data recovery
- Missing circuit breakers or degraded mode - services that are fully unavailable when a dependency fails, where partial degradation (serving cached or limited data) would meet RTO
- Critical service dependencies without documented fallback behavior - when dependency X fails, the runbook should specify what service Y does in response
- Recovery procedures that require manual database credentials lookup or manual secret retrieval during an incident, adding minutes to recovery under pressure
- No chaos engineering or regular failure injection testing to verify that HA configurations actually work as designed before a real incident
- Missing infrastructure-as-code for recovery infrastructure - runbooks that describe manual console steps instead of automated recovery playbooks
