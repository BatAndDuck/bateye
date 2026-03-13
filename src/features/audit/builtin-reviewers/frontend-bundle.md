---
id: frontend-bundle
name: Frontend Bundle Size
description: Detects patterns that inflate JavaScript bundle size including heavy imports, missing code splitting, and bundle anti-patterns that slow page load.
enabled: true
mode: both
category: performance
scopeHints:
  - import
  - bundle
  - webpack
  - vite
  - rollup
  - next
  - component
  - page
  - client
  - browser
recommendedGlobs:
  - "**/*.tsx"
  - "**/*.jsx"
  - "**/*.ts"
  - "**/*.js"
  - "**/*.vue"
  - "**/*.svelte"
---

Focus your review on:

## Heavy Imports
- Importing entire libraries when only one function is needed (import _ from 'lodash' vs import debounce from 'lodash/debounce')
- Importing full icon libraries (import * from '@heroicons/react') when only a few icons are used
- Moment.js usage (should migrate to date-fns or Luxon for smaller bundles)
- Heavy polyfills included when target browsers don't require them

## Code Splitting Opportunities
- Large page components without dynamic imports / lazy loading
- Modal or off-screen content loaded eagerly instead of lazily
- Heavy third-party widgets (charts, editors, maps) not code-split
- Routes not wrapped in React.lazy() / dynamic import

## Bundle Anti-Patterns
- Server-side-only modules imported in client code (node:fs, node:path, dotenv)
- Development-only utilities included in production builds (non-tree-shakeable)
- Duplicate dependencies imported under different names
- CSS-in-JS runtime styles that should be build-time extracted
