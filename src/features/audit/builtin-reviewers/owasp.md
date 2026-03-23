---
id: owasp
name: OWASP Top 10
description: Scans for common web vulnerabilities including XSS, SQL injection, CSRF, and SSRF.
enabled: true
mode: both
category: security
selectWhen: "almost always - select whenever there are user inputs, API endpoints, authentication flows, session management, or data persistence; skip only for pure UI cosmetic changes, documentation, or infrastructure-only PRs"
---

Focus your review on:

## Cross-Site Scripting (XSS)
- `dangerouslySetInnerHTML` in React components assigned directly from user-controlled or API-sourced data without sanitization
- `element.innerHTML =` or `document.write()` assignments using untrusted input
- Template engines rendering user-supplied variables without auto-escaping (e.g., Handlebars `{{{variable}}}` triple-brace unescaped output, Jinja2 `| safe` filter on untrusted data)
- `eval()`, `new Function()`, or `setTimeout(string)` called with any dynamically constructed string that may include user input
- `href` or `src` attributes set from user-controlled data without validating the scheme (allows `javascript:` URIs)

## SQL Injection
- String concatenation or template literals used to build SQL queries where user-supplied values are embedded directly (e.g., `` `SELECT * FROM users WHERE id = ${req.params.id}` ``)
- ORM raw query methods (`sequelize.query()`, `knex.raw()`, `prisma.$queryRaw()`) called with unparameterized user input
- Stored procedure calls that concatenate user input rather than using bind parameters
- Dynamic `ORDER BY` or `LIMIT` clauses constructed from unvalidated user input
- NoSQL injection via unvalidated MongoDB query operators (e.g., user-supplied `{ "$gt": "" }` reaching a `find()` call)

## Command Injection
- `child_process.exec()`, `child_process.execSync()`, `os.system()`, `subprocess.Popen(shell=True)` called with any string that includes user-controlled data
- `child_process.spawn()` where the arguments array is constructed by splitting a user-supplied string
- Shell metacharacters not stripped from filenames or identifiers passed to system commands
- LDAP queries constructed by string concatenation with user-supplied input (LDAP injection)

## Path Traversal
- File read/write operations (`fs.readFile`, `open()`, `File()`) where the path is derived from user input without normalization and validation
- `path.join()` results not validated to confirm the resolved path stays within an expected base directory (e.g., using `path.resolve()` and checking `startsWith(baseDir)`)
- Archive extraction (unzip, tar) without checking for `../` sequences in archived entry names (zip slip)
- User-controlled filenames used directly in `require()` or dynamic `import()` calls

## Cross-Site Request Forgery (CSRF)
- State-changing endpoints (POST, PUT, PATCH, DELETE) that rely solely on session cookies for authentication with no CSRF token validation
- CSRF middleware present in the framework but explicitly disabled or excluded for specific routes
- `SameSite=None` cookies without a CSRF token as an additional safeguard
- GraphQL mutations served over GET requests, which bypass CSRF protections

## Server-Side Request Forgery (SSRF)
- HTTP client calls (`fetch`, `axios`, `http.get`, `requests.get`) where the URL is derived directly from user-supplied input without allowlist validation
- Webhooks or URL-fetching features that do not restrict targets to public internet IPs (allowing requests to `169.254.169.254` cloud metadata endpoints, `localhost`, or internal RFC 1918 ranges)
- Redirect following enabled on HTTP clients that process user-supplied URLs without subsequent validation of the resolved destination
- DNS rebinding risk: URL validation performed before the HTTP request rather than also validating the resolved IP at request time

## Insecure Deserialization
- `JSON.parse()` applied to user-supplied input that is then used to construct object prototypes or class instances without validation
- `pickle.loads()`, `yaml.load()` (without `Loader=yaml.SafeLoader`), or `Marshal.load()` applied to data from untrusted sources
- Java `ObjectInputStream.readObject()` or similar native deserialization called on network or user-supplied bytes
- `node-serialize` or similar libraries that execute code during deserialization of untrusted payloads

## Open Redirect
- `res.redirect()`, `window.location =`, or `router.push()` called with a URL derived from a query parameter (e.g., `?next=`, `?returnUrl=`) without validating that the destination is a relative path or an allowlisted domain
- OAuth or SSO callback parameters that accept arbitrary redirect URIs without strict validation against a registered allowlist

## Scope Clarification
- This reviewer does NOT cover authentication or authorization issues - those are handled by the `security-api` and `authorization-logic` reviewers
- This reviewer does NOT cover hardcoded secrets - that is handled by the `secrets` reviewer
- This reviewer does NOT cover input schema validation - that is handled by the `input-validation` reviewer
