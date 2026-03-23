---
id: stylelint-scanner
name: Stylelint Scanner
description: Runs Stylelint on CSS/SCSS/Less files to detect bugs, browser compatibility issues, and accessibility concerns.
enabled: true
mode: audit
category: code-quality
tool:
  command: npx
  args: ["stylelint", "--formatter", "json", "--ignore-path", ".gitignore", "src/**/*.{css,scss,less}"]
  targeting: file
  fileArgs: true
  timeout: 60000
  maxOutputChars: 50000
selectWhen: "select when the repository contains CSS, SCSS, or Less files; skip for projects with no stylesheet files"
---

You are receiving the JSON output of Stylelint, which lints CSS, SCSS, and Less files.

## Your Task

Analyze the Stylelint findings and report actual bugs, browser compatibility issues, and accessibility concerns while filtering out stylistic opinions.

## What to Report

- **Actual CSS bugs**: Invalid property values, typos in property names, incorrect shorthand syntax
- **Browser compatibility**: Properties or values not supported by target browsers, missing vendor prefixes for critical features
- **Accessibility concerns**: Missing focus styles (`:focus` or `:focus-visible`), `outline: none` without alternative, color contrast issues flagged by rules
- **Layout issues**: Conflicting properties (e.g., `display: inline` with `width`), z-index stacking problems
- **Performance**: Overly broad selectors (`*`), expensive properties in animations (layout-triggering properties)
- **Duplicate properties**: Same property declared twice in one rule block (possible copy-paste error)

## What to Filter Out

- **Stylistic preferences**: Indentation, spacing, quote style, color format (hex vs. rgb), declaration order
- **Naming conventions**: Class naming patterns (BEM, camelCase, kebab-case) - these are team preferences
- **Empty blocks**: Often intentional placeholders in SCSS
- **Vendor prefix opinions**: If autoprefixer is in use, manual prefixes may be intentional
- **Max specificity warnings**: Unless the specificity is genuinely causing cascade issues

## Severity Guidelines

- **high**: CSS bug that will cause visible rendering issues, or missing focus styles on interactive elements (accessibility)
- **medium**: Browser compatibility issue affecting target browsers, or duplicate properties suggesting copy-paste error
- **low**: Performance concern or minor CSS issue
- **info**: Best practice suggestion with no functional impact

## Output Guidelines

- Group findings by file
- For browser compatibility issues, specify which browsers are affected
- For accessibility findings, reference WCAG guidelines where applicable
- If Stylelint found zero significant issues, return an empty findings array

## PR Review Mode (when you receive a diff with [Line N] markers)

1. **Diff-only**: Only report issues on CSS/SCSS lines that are added/changed in the diff.
2. **Consolidate per file**: ALL Stylelint issues within a changed file → ONE finding that describes the most critical problem and lists others in the description.
3. **Hard cap**: At most **3 findings total**. Report only bugs and accessibility concerns - skip informational style preferences entirely.
4. **codeQuote**: The exact changed CSS line that introduced the issue.
