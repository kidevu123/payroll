# Payroll UI Geometry Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve Milo's current dark visual language while fixing clipped dashboard widgets, inconsistent button geometry, undersized text/targets, the narrow desktop canvas, and the Time grid's cramped rail layout.

**Architecture:** Strengthen shared primitives first, then remove page-level height locks and unsafe clipping. Keep data and workflows unchanged; this pass is presentation-only and uses existing Tailwind tokens and components.

**Tech Stack:** Next.js 15, React 19, Tailwind CSS 4, Vitest, React DOM server rendering.

---

### Task 1: Lock shared geometry contracts with tests

**Files:**
- Create: `components/ui/button.test.tsx`
- Create: `components/dashboard/dash-primitives.test.tsx`
- Modify: `components/ui/button.tsx`
- Modify: `components/dashboard/dash-primitives.tsx`

- [ ] Write server-rendered component tests requiring 44px default/icon targets, 12px dashboard captions, and content-safe card padding.
- [ ] Run `npx vitest run components/ui/button.test.tsx components/dashboard/dash-primitives.test.tsx` and confirm RED against the current 40px/10px/8px contracts.
- [ ] Update the primitives without changing their public APIs.
- [ ] Rerun the same test command and confirm GREEN.

### Task 2: Repair the global shell and feedback control

**Files:**
- Modify: `app/globals.css`
- Modify: `components/dashboard/dark-shell.tsx`
- Modify: `components/admin/feedback-launcher.tsx`

- [ ] Make `html`, `body`, admin root, and dark shell cover the viewport background.
- [ ] Expand the desktop content ceiling from 1500px to 1840px while preserving readable inner layouts.
- [ ] Make the bug launcher a true 44px icon button at every breakpoint with a screen-reader label and tooltip.

### Task 3: Make Dashboard content-safe and readable

**Files:**
- Modify: `app/(admin)/dashboard/page.tsx`
- Modify: `components/dashboard/cadence-card.tsx`
- Modify: `components/dashboard/insight-cards.tsx`
- Modify: `components/dashboard/activity-cards.tsx`

- [ ] Remove the desktop viewport height lock and page-level hidden overflow.
- [ ] Use natural card minimum heights and responsive 12-column placement.
- [ ] Clip only decorative chart layers, never the full cadence card.
- [ ] Raise operational metadata from 9–11px to 12px and make primary actions at least 40px tall.

### Task 4: Give Time room to work

**Files:**
- Modify: `app/(admin)/time/page.tsx`

- [ ] Delay the grid-plus-rail split to ultrawide screens.
- [ ] Add an explicit horizontal-scroll affordance above the desktop grid.
- [ ] Keep the employee column and header sticky and enforce safe cell widths.
- [ ] Raise day labels and state pills to the shared 12px metadata floor.

### Task 5: Verify the pass

**Files:**
- No production files.

- [ ] Run focused tests, `npm run typecheck`, and `npm run build`.
- [ ] Run the existing test suite and record any unrelated failures separately.
- [ ] Render Dashboard and Time locally at desktop and narrow widths; verify no clipped cards, white viewport gaps, malformed circles, or hidden actions.
