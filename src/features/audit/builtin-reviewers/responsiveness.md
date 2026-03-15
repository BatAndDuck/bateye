---
id: responsiveness
name: Responsiveness
description: Flags hardcoded pixel values and layout patterns that may break on mobile or varying screen sizes.
enabled: true
mode: audit
category: ux
scopeHints:
  - component
  - ui
  - view
  - page
  - layout
  - style
  - css
---

Focus your review on:

## Hardcoded Dimensions
- Fixed `width` or `height` values in pixels on layout containers (e.g., `width: 1200px`, `height: 600px`) that prevent the element from adapting to smaller viewports
- Inline styles with fixed pixel dimensions (`style={{ width: 480 }}`) applied to containers that should be fluid
- `min-width` or `max-width` constraints in pixels that cause horizontal overflow on small screens without a responsive fallback
- Fixed pixel dimensions on images or media elements — should use `max-width: 100%` and `height: auto` as a baseline
- CSS `height: 100px` on elements whose content can grow, causing overflow rather than adapting

## Units and Responsive Alternatives
- `px` units for font sizes on the `<html>` or `<body>` root element — this prevents users from scaling text via browser font size preferences (prefer `rem`/`em`)
- Layout spacing (margin, padding, gap) specified exclusively in `px` for elements that should scale with content or viewport (consider `rem`, `%`, or CSS clamp)
- `vw`/`vh` used for font sizes without a `clamp()` guard, causing excessively large or small text at extreme viewport widths
- Width/height specified in `pt`, `pc`, or `cm` units — print-oriented units that do not respond to viewport changes

## Breakpoints and Media Queries
- Breakpoint values hardcoded as JavaScript variables (e.g., `if (window.innerWidth < 768)`) used for layout decisions that should be handled by CSS media queries
- Resize event listeners used for layout toggling without debouncing, degrading performance on mobile
- Media queries written only for a single breakpoint, ignoring intermediate sizes (tablet, large mobile, wide desktop)
- `@media` queries using `max-width` exclusively — missing `min-width` or range queries means the design may not handle very wide screens
- JS-driven responsive logic that duplicates or conflicts with existing CSS media queries, causing inconsistent behavior

## Layout Patterns
- `overflow: hidden` on a container without a responsive fallback — content may be clipped on small screens with no scroll affordance
- Absolute or fixed positioning that anchors elements to pixel coordinates without considering smaller viewports (e.g., a modal anchored at `top: 200px` falls off screen on mobile)
- CSS grid or flexbox with `grid-template-columns` or `flex-basis` values hardcoded in pixels without `minmax()` or `auto-fill`/`auto-fit`
- Negative margins in pixels used for layout offsetting that can cause horizontal overflow on narrow screens
- Multi-column layouts without a single-column fallback at mobile breakpoints

## Images and Media
- `<img>` elements missing `srcset` and `sizes` attributes — serving the same full-resolution image to mobile and desktop wastes bandwidth
- `<img>` missing `max-width: 100%` style, allowing images to overflow their container on small screens
- CSS background images using `background-size: cover` on elements with fixed pixel dimensions that do not scale
- `<video>` or `<iframe>` embed elements with hardcoded `width` and `height` HTML attributes and no CSS aspect-ratio or responsive wrapper

## Touch and Mobile Interaction
- Interactive elements (buttons, links, custom controls) with a hit target smaller than 44×44px — too small for reliable touch interaction
- Hover-only interaction patterns (tooltips triggered exclusively on `:hover`) with no touch or focus equivalent
- Horizontal scroll containers lacking `-webkit-overflow-scrolling: touch` or `touch-action` hints for smooth scrolling on iOS
- `cursor: pointer` without a corresponding touch affordance for custom interactive components

## Viewport Configuration
- Missing `<meta name="viewport" content="width=device-width, initial-scale=1">` in the HTML `<head>` — without this, mobile browsers render the page at a desktop width and scale it down
- `user-scalable=no` or `maximum-scale=1` in the viewport meta tag — these prevent users from zooming, which is an accessibility violation and a usability regression on mobile

## Requirements
- Apply this reviewer only when the project contains user-facing web UI, mobile UI, or HTML templates rendered in a browser. For CLI tools, backend services, infrastructure code, developer tooling, or projects with no browser-rendered UI, return 0 findings — responsive design is not applicable.
- If the only HTML files are internal tooling reports or offline documents (not served to end users), they do not require responsive design treatment.
