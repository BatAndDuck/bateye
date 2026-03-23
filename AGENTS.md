# AGENTS

## Session Log — Read Before Implementing

**Always read `.ai-sessions-log` before starting any implementation task.**

It records past AI sessions: what changed, why, and gotchas discovered.
Prevents repeating past mistakes and re-solving already-solved problems.

```
cat .ai-sessions-log
```

## Session Log — Update Before Pushing

**Before every `git push`, add or update an entry in `.ai-sessions-log`.**

Rules:
- One entry per session/PR branch — update the same line for followup pushes
- Max 300 chars: what changed + why (no fluff)
- Format: `YYYY-MM-DD | branch-or-topic | summary`
- Followup: append ` +YYYY-MM-DD <note>` to the existing line

Example:
```
2026-03-20 | pr-review-pipeline | Added 10-stage pipeline with diff parser + verifier. Replaces broken runner.ts flow that missed line ranges and duplicated findings across reviewers.
```

---

## Design Principles

- Build tools to be repository-agnostic and tool-agnostic.
- They must work across different repositories, codebases, and toolsets, including APIs, frontends, CLIs, workers, and similar systems.
- Do not add repository-specific, stack-specific, or tool-type-specific code unless explicitly required.

## Setup

Install dependencies:
```
npm install
```

## Build

Compile TypeScript to `dist/` and copy templates:
```
npm run build
```

## Test

Run the full test suite:
```
npm test
```

## Lint

Check for style and type errors:
```
npm run lint
```

## Local Development

After building, link the CLI globally so `bateye` resolves to the local build:
```
npm link
```

Then run any command against a local repo:
```
bateye audit
bateye pr-review --base <sha>
```
