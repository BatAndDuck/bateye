# AGENTS

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

After building, link the CLI globally so `codeowl` resolves to the local build:
```
npm link
```

Then run any command against a local repo:
```
codeowl audit
codeowl pr-review --base <sha>
```
