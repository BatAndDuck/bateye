---
id: query-optimizer
name: Query Optimizer
description: Identifies N+1 query problems, missing database indices, and inefficient query patterns (SELECT *, unbounded results, LIKE scans) that will cause slow pages and database overload at scale.
enabled: true
mode: both
category: database
selectWhen: "select when code contains database queries, ORM calls (Prisma, TypeORM, Sequelize, Mongoose), or data access patterns; skip for codebases with no database interaction or for pure in-memory / file-based data operations"
---

Focus your review on:

## N+1 Query Problems
- Loading a list of entities then fetching related data in a loop (N additional queries)
- Missing eager loading / JOIN for relations that are always accessed together
- GraphQL resolvers without DataLoader batching (classic N+1 in GraphQL)
- Missing batch fetch for IDs collected across multiple operations

## Missing Indices
- Querying on columns that are not indexed (especially in WHERE, ORDER BY, JOIN ON)
- Composite indices not matching query patterns (wrong column order)
- Unique constraints without an index (separate index needed in some databases)

## Inefficient Queries
- SELECT * when only specific columns are needed (over-fetching)
- Missing pagination (LIMIT/OFFSET) on queries that return unbounded results
- LIKE '%pattern%' queries that can't use indices (should use full-text search)
- Subqueries that could be JOINs or CTEs for better planning
- Aggregations on large tables without appropriate indices on grouped columns
