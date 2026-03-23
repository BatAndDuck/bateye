---
id: html-validate-scanner
name: HTML Validation & Accessibility Scanner
description: Runs html-validate for HTML standards compliance and accessibility violations (WCAG).
enabled: true
mode: audit
category: ux
tool:
  command: npx
  args: ["html-validate", "--formatter", "json", "src/**/*.html"]
  targeting: file
  fileArgs: true
  timeout: 60000
  maxOutputChars: 50000
selectWhen: "select when the repository contains HTML files, HTML templates, or server-side rendered views; skip for backend-only, CLI, or non-browser projects with no HTML output"
---

You are receiving the JSON output of html-validate, which checks HTML files for standards compliance and accessibility issues.

## Your Task

Analyze the html-validate findings and report accessibility and correctness issues that matter for users.

## What to Report

### Accessibility (WCAG Compliance)
- Missing `alt` attributes on images
- Missing form labels or `aria-label` / `aria-labelledby` attributes
- Invalid or missing ARIA roles and attributes
- Missing heading hierarchy (skipping h1 → h3)
- Interactive elements without accessible names
- Missing `lang` attribute on `<html>` element
- Form elements without associated labels
- Color-only information indicators (missing text alternatives)

### HTML Correctness
- Invalid HTML that could cause rendering issues across browsers
- Deprecated elements or attributes
- Missing required attributes (e.g., `<script>` without `type`, `<meta>` charset)
- Duplicate IDs (causes accessibility and JavaScript issues)
- Unclosed tags or incorrect nesting

## What to Filter Out

- **Framework template syntax**: Angular `*ngIf`, React JSX expressions, Vue `v-if` — these are valid in their context
- **Component placeholders**: Custom elements from web components or framework components
- **Stylistic preferences**: Attribute ordering, self-closing tag style, quote style
- **Generated HTML**: Build output or minified HTML files
- **Partial templates**: HTML fragments that are included/embedded (missing `<html>`, `<head>` is expected)

## Severity Guidelines

- **high**: Missing accessibility features that prevent users with disabilities from using the page (no alt text, no form labels, missing ARIA)
- **medium**: HTML validity issues that cause cross-browser rendering problems or duplicate IDs
- **low**: Minor standards compliance issues, deprecated attributes that still work
- **info**: Best-practice suggestions that don't affect functionality or accessibility

## Output Guidelines

- Group findings by file, then by category (accessibility vs. correctness)
- For accessibility findings, reference the specific WCAG criterion (e.g., WCAG 2.1 Level A: 1.1.1 Non-text Content)
- Provide specific fix recommendations (add `alt="description"`, wrap in `<label>`, etc.)

## PR Review Mode (when you receive a diff with [Line N] markers)

1. **Diff-only**: Only report issues on lines that are added/changed in the diff.
2. **Consolidate by category per file**: All accessibility issues in a file → ONE finding. All HTML validity issues → ONE finding. That gives at most 2 findings per changed HTML file.
3. **Hard cap**: At most **4 findings total**. Prioritise high-severity accessibility issues over low-severity validity issues.
4. **codeQuote**: The exact changed HTML line that introduced the issue.
