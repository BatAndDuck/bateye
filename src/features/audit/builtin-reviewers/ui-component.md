---
id: ui-component
name: UI Component Standards
description: Checks for correct usage of Design System components instead of custom ad-hoc styling.
enabled: true
mode: both
category: ux
selectWhen: "select when the repository uses a Design System component library and code adds or modifies UI components, pages, or layouts; skip for backend-only, CLI, infrastructure, or projects with no design system"
---

Focus your review on:

## Design System Component Usage
- Custom `<div>` or `<span>` elements used in place of an existing Design System component (e.g., hand-rolled button instead of `<Button>`, custom card wrapper instead of `<Card>`)
- Duplicate implementations of components already provided by the design library (custom modal, tooltip, badge, avatar, etc.)
- Design System components imported from wrong or non-canonical paths (reaching into internal package directories instead of public exports)
- Conditional rendering or prop drilling that bypasses the component's intended API

## Styling Approach
- Inline `style={{}}` attributes used where a Design System component prop, CSS module class, or utility token should be used instead
- Direct CSS property values hardcoded in `style` attributes (e.g., `style="color: #3B82F6"`) instead of design tokens or CSS variables
- Hardcoded color hex/rgb values in CSS/SCSS files that should reference `var(--color-*)` or theme tokens
- Hardcoded spacing values (e.g., `margin: 12px`, `padding: 8px 16px`) where design system spacing tokens (`--spacing-2`, `$space-4`, `gap-2` utility) should be used
- Custom `z-index` values that bypass the design system's z-index scale, risking stacking conflicts
- Font size, weight, or family values hardcoded instead of typography tokens

## Component Prop Misuse
- Passing the wrong `variant` prop value (e.g., using `variant="primary"` when only `"default" | "outline" | "destructive"` are valid)
- Missing required props that the component needs to render accessibly or correctly (e.g., omitting `label` on an `<IconButton>`)
- Providing props that conflict with each other according to the component's documented constraints
- Overriding internal component styles via `className` hacks or `!important` rules that break design consistency

## Layout and Spacing
- Custom grid or flex containers built from scratch where a Design System `<Grid>`, `<Stack>`, or `<Flex>` layout component exists
- Inconsistent padding/margin values that break the 4px or 8px base grid assumed by the design system
- Fixed-pixel gap values between layout elements instead of spacing tokens
- Mixing spacing systems (e.g., using Tailwind spacing classes alongside a separate token-based design system)

## Interactive Elements
- Custom `<a>` tags styled as buttons or custom `<div onClick>` elements where a `<Button>` or `<Link>` component should be used
- Non-standard focus ring styles that override the design system's default focus indicator
- Custom loading spinner or skeleton components that duplicate existing design system equivalents
- Custom form inputs (text field, checkbox, radio, select) built from scratch instead of using the design system's form components
