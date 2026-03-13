---
id: cloud-cost
name: Cloud Cost
description: Identifies over-provisioned resources, inefficient architecture choices, and forgotten or orphaned cloud resources that unnecessarily inflate infrastructure costs.
enabled: true
mode: audit
category: infrastructure
scopeHints:
  - aws
  - azure
  - gcp
  - lambda
  - ec2
  - rds
  - s3
  - storage
  - instance
  - tier
  - size
  - resource
  - iac
  - terraform
---

Focus your review on:

## Over-Provisioned Resources
- Compute instances sized at large, xlarge, or 2xlarge for workloads where metrics or actual usage suggest a smaller instance type would be sufficient
- RDS or managed database instances with read replicas provisioned for single-tenant, low-traffic workloads where a single instance would serve the load
- Reserved capacity or savings plans purchased for workloads with spiky or unpredictable traffic patterns — on-demand or spot instances would be cheaper with comparable availability
- Lambda or Cloud Function memory and timeout allocations set much higher than profiling shows is needed — memory directly determines CPU and cost per invocation
- NAT Gateway provisioned in every availability zone for workloads where a single NAT Gateway (with the associated HA trade-off accepted) would suffice
- Managed services (managed Kafka, managed Elasticsearch) provisioned at production-grade cluster sizes for development or staging environments
- Multi-AZ RDS deployments in non-production environments where single-AZ would be sufficient and significantly cheaper

## Inefficient Architecture Choices
- Synchronous request-response pattern used for long-running operations where decoupling with a queue would allow cheaper, smaller compute to process work asynchronously
- Storing temporary or intermediate processing data in expensive hot storage tiers (S3 Standard) instead of cheaper storage tiers (S3 Infrequent Access, S3 Glacier for archival)
- Missing S3 lifecycle rules — objects that are only accessed within the first 30 days continue to be stored at full cost indefinitely without a transition or expiry policy
- Data transfer inefficiency: fetching all rows or all fields from a database in application code and then filtering, when the filter could be pushed down to the database query
- Missing CDN (CloudFront, Fastly, Azure CDN) for static assets or cacheable API responses being served from origin on every request, driving unnecessary origin compute and data transfer costs
- Polling-based architectures where a Lambda or compute job runs on a fixed schedule to check for work, compared to event-driven triggers that only incur cost when work exists
- Full table scans on large datasets caused by missing indexes — expensive in both time and, for serverless databases billed by data scanned, in direct cost

## Forgotten/Orphaned Resources
- Snapshots, AMIs, or machine images provisioned for point-in-time backups that were never cleaned up and accumulate indefinitely
- EBS volumes, managed disks, or persistent disks detached from any compute instance but continuing to incur storage costs
- Elastic IPs or static public IP addresses allocated but not attached to any running resource (charged at idle in most clouds)
- Development or staging environments provisioned identically to production — these should use smaller instance families, minimal redundancy, and scale-to-zero where possible
- Load balancers with no healthy targets behind them, still incurring hourly charges
- Missing auto-scaling or scale-to-zero configuration for non-production environments — dev and staging resources should not run at full capacity 24/7
- Old container image versions or package versions stored in container registries or artifact repositories without a retention/cleanup policy
