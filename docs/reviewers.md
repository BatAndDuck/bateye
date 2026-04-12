# Reviewers

BatEye ships with a built-in catalog of AI reviewers. Each reviewer is an independent AI agent focused on a specific concern. You can also write your own.

## Built-in reviewers

Run `bateye reviewers` to see the full list with descriptions.

| Reviewer ID | Focus area |
|---|---|
| `security-api` | API security, injection flaws, authentication, authorization gaps |
| `code-quality` | Code smells, duplication, maintainability, naming |
| `complexity` | Cyclomatic complexity, cognitive load, refactor candidates |
| `test-coverage` | Missing tests, edge cases, brittle assertions, test quality |
| `documentation` | Missing or stale docs, unclear comments, API docs |
| `input-validation` | Unvalidated inputs, type coercions, boundary conditions |
| `error-handling` | Missing error handling, swallowed exceptions, failure modes |
| `dependencies` | Outdated dependencies, known vulnerabilities, unused packages |
| `performance` | N+1 queries, unnecessary allocations, blocking operations |
| `accessibility` | WCAG compliance, ARIA, keyboard navigation |
| `responsiveness` | Mobile/responsive layout issues |
| `i18n` | Hardcoded strings, locale handling, date/number formatting |
| `inline-docs` | Inline comment quality, JSDoc/TSDoc completeness |
| ...and more | Run `bateye reviewers` to see everything |

## How reviewers are selected

For `bateye audit`, BatEye runs all applicable reviewers by default.

For `bateye pr-review`, an orchestrator AI selects the most relevant reviewers based on the diff content. Reviewers that share the same investigation scope (same model, no external tool) are grouped into **execution bundles** and run together in a single bounded OpenCode session to reduce cost. Reviewers with an external `tool` or a custom `model` override always run in their own isolated session. Every finding is attributed back to its originating reviewer via a `reviewerId` field, so per-reviewer reporting and attribution are preserved regardless of how the session was grouped.

### Run specific reviewers

```bash
bateye audit --reviewers security-api,code-quality
```

### Disable reviewers per mode

In `.bateye/config.json`:

```json
{
  "disabledReviewers": {
    "audit": ["responsiveness", "accessibility", "i18n"],
    "prReview": ["inline-docs"]
  }
}
```

Useful for repos where certain concerns don't apply (e.g., a backend-only service has no accessibility concerns).

---

## Custom reviewers

Create `.bateye/reviewers/*.md` files to add your own reviewers.

### Format

```markdown
---
id: my-reviewer
name: My Custom Reviewer
description: Checks for specific patterns in our codebase.
enabled: true
selectWhen: "select when the diff touches [relevant area]; skip for [irrelevant cases]"
---

You are reviewing code for [your concern here].

Focus on:
- Rule 1
- Rule 2
- Rule 3

When you find an issue, report:
- The file and line number
- What the problem is
- How to fix it
```

### Frontmatter fields

| Field | Required | Description |
|---|---|---|
| `id` | Yes | Unique identifier (used in CLI and config) |
| `name` | Yes | Human-readable name |
| `description` | Yes | One-line summary (shown in `bateye reviewers`) |
| `enabled` | No | Set to `false` to disable without deleting the file |
| `selectWhen` | No | Natural-language description of when the orchestrator should select this reviewer for PR review (e.g. `"select when the diff touches authentication or session logic; skip for documentation-only changes"`) |

### Overriding built-in reviewers

A custom reviewer with the same `id` as a built-in reviewer replaces it completely. This lets you customise the prompt for any built-in reviewer:

```bash
# Get the built-in security-api reviewer as a starting point
bateye reviewers --show security-api > .bateye/reviewers/security-api.md
# Edit it to match your team's security requirements
```

---

## Reviewer output

Each reviewer produces:

```json
{
  "reviewerId": "security-api",
  "score": 72,
  "summary": "Found 3 issues: one high-severity SQL injection risk and two medium-severity auth gaps.",
  "findings": [
    {
      "title": "SQL injection via raw query",
      "severity": "high",
      "file": "src/db/queries.ts",
      "line": 42,
      "description": "User input is interpolated directly into a SQL string.",
      "suggestion": "Use parameterised queries or a query builder."
    }
  ]
}
```

The full audit report at `.bateye/out/audit.json` contains results from all reviewers plus an overall summary.
