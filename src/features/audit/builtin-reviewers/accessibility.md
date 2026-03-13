---
id: accessibility
name: Accessibility
description: Validates ARIA attributes, semantic HTML, color contrast, and keyboard navigation.
enabled: true
mode: both
category: ux
scopeHints:
  - component
  - ui
  - view
  - page
  - form
  - button
  - modal
  - nav
  - header
  - dialog
---

Focus your review on:

## ARIA Roles and Attributes
- Missing `role` attribute on custom interactive components that have no native semantic equivalent (e.g., custom dropdown, custom tab panel)
- Incorrect ARIA roles applied to elements (e.g., `role="button"` on an element that already has a native semantic role)
- Missing `aria-label` or `aria-labelledby` on icon-only buttons, icon links, or elements whose visible text is insufficient
- Missing `aria-describedby` to associate help text, error messages, or descriptions with their form control
- `aria-hidden="true"` applied to focusable elements, making them unreachable by screen readers while still keyboard-focusable
- Dynamic content changes (toasts, live regions, error summaries) lacking `aria-live` or `role="status"` / `role="alert"` to announce updates
- `aria-expanded`, `aria-haspopup`, `aria-controls` missing or misused on disclosure widgets (accordions, dropdowns, tooltips)

## Semantic HTML
- `<div>` or `<span>` used where a semantically appropriate element exists: `<button>`, `<nav>`, `<main>`, `<header>`, `<footer>`, `<section>`, `<article>`, `<aside>`, `<h1>`–`<h6>`
- Heading hierarchy violations — skipping heading levels (e.g., jumping from `<h1>` to `<h4>`) or using headings purely for visual sizing
- `<table>` layouts without `<caption>`, `<th scope="col/row">`, or `<thead>`/`<tbody>` structure
- `<ul>` or `<ol>` lists used without `<li>` children, or non-list content wrapped in list elements
- `<a>` tags with no `href` used as buttons — these behave differently for keyboard and screen reader users

## Images and Media
- `<img>` elements missing `alt` attribute entirely
- `<img>` elements that convey meaningful information using `alt=""` (empty alt is valid only for decorative images)
- CSS background images used to convey non-decorative content with no text alternative
- `<video>` or `<audio>` elements missing `<track kind="captions">` or transcript link
- SVG icons that are informative missing `<title>` or `aria-label`, or decorative SVGs missing `aria-hidden="true"`

## Forms and Labels
- `<input>`, `<textarea>`, or `<select>` without an associated `<label>` (via `for`/`id` pairing or wrapping)
- Placeholder text used as the only label — placeholders disappear on input and are insufficient for screen readers
- Required form fields not marked with `required` / `aria-required="true"`
- Form validation errors not programmatically associated to their field via `aria-describedby` or `aria-errormessage`
- Fieldsets of related controls (radio groups, checkboxes) missing `<legend>`

## Keyboard Navigation
- `onClick` handlers attached to `<div>`, `<span>`, or other non-interactive elements without a corresponding `onKeyDown`/`onKeyPress` handler for Enter/Space
- Interactive elements missing `tabIndex="0"` when they are not natively focusable
- `tabIndex` values greater than 0 that disrupt natural tab order
- Modals or dialogs that do not trap focus within the dialog while open
- Keyboard shortcuts that conflict with browser or assistive technology shortcuts without a way to remap

## Focus Management
- Modal dialogs that do not move focus to the first focusable element (or the dialog container) when opened
- Modals that do not return focus to the triggering element when closed
- Page transitions or dynamic content loads that do not announce the new view or move focus to the relevant content
- Custom dropdown/combobox components missing arrow-key navigation between options

## Color and Visual
- Information conveyed by color alone with no text or icon fallback (e.g., red = error with no icon or text)
- Interactive element states (hover, focus, selected) distinguished only by color change
- Missing visible focus indicator — relying solely on browser default that may be removed by `outline: none` or `outline: 0` without a replacement

## Navigation and Structure
- Missing skip navigation link (`<a href="#main-content">Skip to main content</a>`) on pages with repeated navigation
- Empty `<a>` or `<button>` elements (no text content, no `aria-label`) that produce meaningless announcements
- Landmark regions (`<main>`, `<nav>`, `<aside>`) duplicated without distinct `aria-label` to differentiate them
