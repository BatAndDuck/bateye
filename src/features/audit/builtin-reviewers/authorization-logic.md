---
id: authorization-logic
name: Authorization Logic
description: Reviews authorization checks, access control enforcement, and privilege escalation risks.
enabled: true
mode: both
category: security
scopeHints:
  - auth
  - authz
  - permission
  - role
  - policy
  - guard
  - middleware
  - access
  - admin
  - user
---

Focus your review on:

## Insecure Direct Object References (IDOR)
- Resource lookups (database queries, file reads) using a user-supplied ID without verifying that the authenticated user owns or has permission to access that resource (e.g., `getOrder(req.params.id)` without a `WHERE user_id = currentUser.id` constraint)
- Bulk endpoints that return collections without filtering to only the records the caller is authorized to see
- Resource IDs that are sequential integers or otherwise guessable, combined with missing ownership validation
- Update or delete operations that accept a resource ID in the request body without re-fetching the record and checking ownership before modification

## Role-Based Access Control (RBAC)
- Privileged operations (admin actions, data exports, user management) not gated by a role check before execution
- Role checks implemented inconsistently — some routes use middleware guards, others inline checks, others none at all
- Hardcoded role strings compared with `==` to user-supplied values without normalization (case-sensitivity bugs like `"Admin"` vs `"admin"` bypassing a check)
- Role checks that only verify the role name without validating that the role is still active or has not been revoked
- Superuser or admin endpoints grouped with user endpoints where the authorization middleware is applied only to the user group

## Privilege Escalation
- Vertical privilege escalation: a lower-privilege user able to call an endpoint reserved for a higher-privilege role due to missing or misconfigured guard
- Horizontal privilege escalation: a user able to act on behalf of another user of the same role by supplying a different `userId` parameter
- Privilege escalation via JWT manipulation — roles or permissions read directly from an unverified token payload without server-side verification of the signature and claims
- Escalation via parameter injection: endpoints that accept a `role` or `isAdmin` field in the request body that is applied without server-side authority check

## Client-Side Only Authorization
- Authorization decisions made exclusively in the frontend (hiding UI elements, disabling buttons) with no corresponding server-side enforcement
- Feature flags or permissions fetched from the client and trusted by the server without re-validation
- Server-side endpoints that assume a client-side check has already occurred ("internal" endpoints exposed over the network without auth middleware)

## Mass Assignment
- ORM model instances created or updated directly from the request body (`User.create(req.body)`, `Object.assign(user, req.body)`) without an explicit allowlist of permitted fields
- `role`, `isAdmin`, `verified`, `balance`, or other sensitive fields included in the set of mass-assignable attributes
- PATCH endpoints that apply all provided fields to the model without filtering out protected attributes
- GraphQL mutations that resolve directly to ORM `update()` calls with the full input object

## Deny-By-Default Posture
- Authorization logic structured as a denylist (block known bad roles) rather than an allowlist (only allow explicitly permitted roles) — new roles added later inherit access by default
- Missing default `else` branch in authorization condition chains, falling through to allow access when no condition matches
- Feature or route access controlled by a flag that defaults to `true` (enabled) rather than `false` (disabled) when not explicitly configured

## Authorization Logic Bypasses
- URL path traversal or normalization issues that allow bypassing route-level authorization middleware (e.g., `/admin/../user/profile` resolving to a protected admin endpoint)
- HTTP method override headers (`X-HTTP-Method-Override`, `_method`) accepted without re-applying authorization checks for the overridden method
- GraphQL introspection enabled in production, leaking schema information that aids in crafting authorization bypass queries
- Batch API endpoints or GraphQL batching that allow multiple operations in a single request, where per-request rate limiting or per-operation authorization is bypassed
- Authorization checks on the parent resource but not on nested sub-resources accessed through relationship traversal
