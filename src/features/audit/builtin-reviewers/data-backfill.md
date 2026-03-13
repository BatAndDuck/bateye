---
id: data-backfill
name: Data Backfill Safety
description: Reviews backfill and data repair scripts for large-scale mutation safety, missing rollback plans, absent dry-run modes, and operational concerns like rate limiting and progress tracking.
enabled: true
mode: both
category: database
scopeHints:
  - migration
  - backfill
  - script
  - batch
  - update
  - repair
  - seed
  - data
  - job
  - task
recommendedGlobs:
  - "**/migrations/**"
  - "**/scripts/**"
  - "**/jobs/**"
  - "**/tasks/**"
  - "**/*.sql"
  - "**/*.ts"
  - "**/*.py"
---

Focus your review on:

## Large-Scale Mutation Safety
- Bulk UPDATE or DELETE without batching (locks entire table, causes timeouts)
- Scripts that process millions of rows in a single transaction
- Missing progress tracking and resumability for long-running backfills
- No dry-run mode to preview changes before execution

## Data Safety
- Backfill scripts without a rollback plan
- Destructive operations (DELETE, DROP) without confirmation prompts
- Missing WHERE clause constraints that accidentally affect all rows
- Scripts modifying production data without prior testing on staging

## Operational Concerns
- Backfill scripts not rate-limited (overwhelming the database)
- Missing logging of what records were changed and how
- Scripts with no time estimate or progress indication
- No check that the expected rows were actually updated (missing verification step)
