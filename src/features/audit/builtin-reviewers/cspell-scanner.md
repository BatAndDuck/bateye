---
id: cspell-scanner
name: Spell Check Scanner
description: Runs CSpell spell checker on source code to find typos in user-facing strings, comments, and identifiers.
enabled: true
mode: both
category: code-quality
tool:
  command: npx
  args: ["cspell", "--no-progress", "--no-summary", "--dot", "**/*.{ts,js,tsx,jsx,md,json}"]
  targeting: file
  fileArgs: true
  timeout: 60000
  maxOutputChars: 40000
scopeHints:
  - src
  - docs
  - readme
  - component
---

You are receiving the output of CSpell, a spell checker that identifies misspelled words in source code.

## Your Task

Analyze the CSpell findings and report genuine typos while filtering out technical terms and domain-specific vocabulary.

## What to Report

- Typos in **user-facing strings**: error messages, UI labels, log messages, API response text
- Typos in **documentation**: README files, JSDoc comments, inline comments explaining logic
- Typos in **variable/function names** that could cause confusion (e.g., `recieve` instead of `receive`, `occured` instead of `occurred`)
- Consistently misspelled domain terms that appear in public APIs or exported interfaces

## What to Filter Out

- **Technical terms**: Common programming abbreviations (args, async, impl, util, repo, deps, env, config, ctx, cb, fn, etc.)
- **Library/framework names**: React, TypeScript, webpack, vite, eslint, etc.
- **Domain-specific vocabulary**: Words specific to the project's business domain that CSpell doesn't know
- **Identifiers from external APIs**: Property names from third-party libraries or APIs
- **Intentional abbreviations**: Common shorthand in variable names (req, res, err, msg, num, str, buf, etc.)
- **Package names and imports**: npm package names, module paths
- **Code patterns**: Regex patterns, hash strings, encoded values, URLs

## Severity Guidelines

- **medium**: Typo in a user-facing error message or API response that end users will see
- **low**: Typo in a variable name, function name, or code comment
- **info**: Typo in an internal comment or documentation that doesn't affect users

## Output Guidelines

- Group related typos by file rather than reporting each word individually
- For each finding, include the misspelled word and the likely correct spelling
- For PR review mode: Only report typos in files that appear in the diff
- If CSpell found zero genuine typos, return an empty findings array
