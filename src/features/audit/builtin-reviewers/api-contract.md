---
id: api-contract
name: API Contract
description: Ensures OpenAPI/Swagger specs or GraphQL schemas are updated when API code changes.
enabled: true
mode: both
category: documentation
selectWhen: "select when code adds or modifies API endpoints, route handlers, GraphQL resolvers, gRPC methods, or request/response DTOs, especially when an OpenAPI/Swagger spec or GraphQL schema exists in the repo; skip for purely internal changes with no API surface"
---

Focus your review on:

## New Endpoints Without Spec Coverage
- New route handler, controller method, or REST endpoint introduced in code without a corresponding path entry in the OpenAPI/Swagger specification (`openapi.yaml`, `swagger.json`, or code-first annotations such as `@ApiOperation`, `@swagger`, `@oas`)
- New GraphQL query, mutation, or subscription added to the resolver without a matching type definition in the `.graphql` schema file
- New gRPC service method defined in code without the corresponding `.proto` file update
- New WebSocket message type or event introduced without documentation in the API contract

## Schema Drift — Request and Response Shapes
- Request body shape changed in code (new required fields added, field types changed, field removed) without updating the corresponding OpenAPI `requestBody` schema
- Response object shape changed (new fields added to the response DTO, fields renamed or removed) without updating the OpenAPI `responses` schema
- GraphQL type fields added, removed, or made non-nullable in the resolver response without the schema type definition being updated to match
- Enum values added to a field in code without adding them to the OpenAPI or GraphQL schema's enum definition

## Deprecation and Versioning
- Endpoints or fields marked as deprecated in code (e.g., `@deprecated` JSDoc, `x-deprecated` in spec) but still documented as active with no deprecation notice in the API spec
- API version incremented in code (route prefix changed from `/v1/` to `/v2/`) without the spec reflecting the new version and the migration path documented
- Breaking changes introduced to an existing endpoint under the same version number without a major version bump or a deprecation period
- Old API version routes removed from code but still present and documented in the spec, leading to consumers attempting to use non-existent endpoints

## Error Response Documentation
- New error conditions added to an endpoint's code (new 4xx or 5xx responses thrown) without documenting the corresponding response codes and schemas in the spec
- Only the 200 happy-path response documented; 400 (validation error), 401 (unauthorized), 403 (forbidden), 404 (not found), and 409 (conflict) responses missing from the spec
- Error response body shape changed (new `errors` array format, changed `message` field name) without updating the error schema in the spec

## Authentication Documentation
- Authentication requirement added to an endpoint (new auth middleware applied) without updating the `security` field in the OpenAPI spec for that path
- Authentication scheme removed or changed (switched from API key to Bearer JWT) without updating the spec's `securitySchemes` definition
- OAuth scopes required by an endpoint not reflected in the spec's security requirements

## Breaking Changes
- Renaming an existing field in a request or response body — this is a breaking change for existing consumers and requires a deprecation strategy or version bump
- Changing a field from optional to required in a request body — breaks clients that omit the field
- Changing a field's type (e.g., `string` to `integer`, `object` to `array`) — breaks clients that assume the previous type
- Removing a response field that downstream consumers may depend on — should be deprecated first with a timeline

## Spec Completeness
- `description` fields missing on newly added path operations, parameters, or schema properties — the spec serves as documentation for consumers
- `example` or `examples` values missing for complex request/response schemas, making the spec harder to understand and test
- API tags or groupings not updated when new endpoint groups are added, leaving new paths uncategorized in generated documentation
- `operationId` values missing or auto-generated with non-descriptive names (e.g., `post_users_id_orders_post`) rather than semantic names
