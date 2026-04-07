# Contributing

Thanks for helping improve BatEye.

## Ground Rules

- Keep changes repository-agnostic and tool-agnostic unless a task explicitly requires otherwise.
- Keep the main [README](./README.md) lean; move deeper setup or reference detail into `docs/`.
- Update docs when user-facing behavior changes.
- Add or update tests for behavior changes whenever practical.

## Local Setup

```bash
npm ci
npm run build
npm run lint
npm test
npm run link:local
```

Copy `.env.example` to `.env` if you need provider keys for local development.

## Pull Requests

Good PRs are small, focused, and clear about:

- what changed
- why it changed
- how it was tested
- which docs changed, if any

If your change affects installation, configuration, provider setup, CI usage, or command output, update the relevant doc in `docs/` or the top-level [README](./README.md).

## Release Hygiene

If a change is intended for an npm release:

1. Move `## Unreleased` in [CHANGELOG.md](./CHANGELOG.md) to the new version heading.
2. Bump the matching version in [package.json](./package.json).
3. Commit those changes with the rest of the release work.
