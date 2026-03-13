---
id: schema-migration
name: Schema Migration Safety
description: Reviews database migrations for backward compatibility issues, unsafe operations (locking, missing CONCURRENTLY), missing rollbacks, and data integrity risks during rolling deploys.
enabled: true
mode: both
category: database
scopeHints:
  - migration
  - schema
  - database
  - db
  - table
  - column
  - index
  - constraint
  - alembic
  - flyway
  - prisma
  - knex
recommendedGlobs:
  - "**/migrations/**"
  - "**/*.migration.ts"
  - "**/*.migration.sql"
  - "**/schema.prisma"
  - "**/*.sql"
---

Focus your review on:

## Backward Compatibility
- Adding NOT NULL columns without a DEFAULT value (breaks existing rows and rolling deploys)
- Renaming columns without a two-phase migration (add new, migrate data, remove old)
- Dropping columns that are still referenced in code (not yet removed from application)
- Changing column types in a non-backward-compatible way

## Migration Safety
- Missing index creation on foreign keys (causes table locks and slow queries on large tables)
- Index creation without CONCURRENTLY option on live tables (blocks writes)
- Migrations that lock tables for extended periods (bulk updates without batching)
- Missing rollback/down migration for every up migration

## Data Integrity
- Adding unique constraints without verifying existing data has no duplicates
- Foreign key constraints added without validating existing data integrity
- Migrations that delete data without a backup/recovery plan
- Schema changes that break existing application code running in parallel during deploy
