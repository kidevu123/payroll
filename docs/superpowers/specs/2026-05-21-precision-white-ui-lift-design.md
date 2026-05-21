# Milo — Precision White × Teal: Global UI Lift

**Date:** 2026-05-21  
**Scope:** All surfaces (admin, employee PWA, login/auth)  
**Direction:** Precision White — pure white backgrounds, zinc borders, teal accent, monospaced numbers

---

## 1. Problem

The current UI has good structure but its visual language reads as "soft" rather than crisp:

- **Warm page background** (#f7f7f5) plus ambient radial gradients and a dot-grid mesh add visual noise and warmth that fight the precision tool aesthetic.
- **Large card radius** (0.875rem = 14px) rounds every surface, softening data-dense tables and KPI cards.
- **Warm borders** (#e2e0db) feel beige rather than sharp.
- **Decorative gradients** on the sidebar wordmark header and topbar brand bar add complexity without clarity.
- **Footer Heart icon** violates the no-decoration convention and looks toyish.

None of the data or behavior changes. This is a pure visual upgrade.

---

## 2. Typography

| Role | Current | New |
|---|---|---|
| UI sans | Manrope | **IBM Plex Sans** (300/400/500/600/700) |
| Monospace / numbers | JetBrains Mono | **DM Mono** (400/500) |

IBM Plex Sans is designed for interfaces — tighter, crisper, slightly narrower than Manrope. Retains the same weight range. DM Mono is cleaner for financial figures than JetBrains Mono.

**Type scale** (unchanged):

| Token | Size |
|---|---|
| display | 2rem / −0.025em |
| title | 1.5rem / −0.02em |
| heading | 1.125rem / −0.01em |
| body | 0.875rem / 1.3rem lh |
| caption | 0.75rem / 1.05rem lh |

---

## 3. Color Tokens

All changes stay within the existing `@theme` block in `globals.css`. The Tailwind utility classes (bg-surface, border-border, etc.) require no changes in component files.

| Token | Current | New | Rationale |
|---|---|---|---|
| `--color-page` | #f7f7f5 (warm off-white) | **#ffffff** | Pure white — crisp, no warmth tint |
| `--color-surface` | #ffffff | #ffffff | No change |
| `--color-surface-2` | #f1f0ed (warm) | **#f4f4f5** (zinc-100) | Neutral cool sidebar/hover bg |
| `--color-surface-3` | #e8e6e1 (warm) | **#e4e4e7** (zinc-200) | Neutral pressed state |
| `--color-border` | #e2e0db (warm) | **#e4e4e7** (zinc-200) | Sharper, crisper rule lines |
| `--color-border-strong` | #c8c5be (warm) | **#d4d4d8** (zinc-300) | Emphasized borders, no warmth |
| `--color-text` | #18181b | **#09090b** | Slightly darker, maximum crispness |
| `--color-text-muted` | #525057 | **#52525b** (zinc-600) | Same value, zinc-aligned |
| `--color-text-subtle` | #76747c | **#71717a** (zinc-500) | Same value, zinc-aligned |

**Teal brand accent stays completely unchanged.** brand-50 through brand-900 are untouched.

**Semantic status colors** (success/warn/danger/info) are untouched.

---

## 4. Geometry

| Token | Current | New |
|---|---|---|
| `--radius-card` | 0.875rem (14px) | **0.5rem (8px)** — crisp, not pill |
| `--radius-input` | 0.5rem | **0.375rem (6px)** — slightly tighter |
| `--radius-chip` | 0.375rem | **0.25rem (4px)** — sharp chips |

---

## 5. Shadows

Current shadows are elaborate multi-layer. Replace with clean single-layer:

```css
--shadow-card:        0 1px 2px 0 rgb(9 9 11 / 0.06), 0 0 0 1px rgb(9 9 11 / 0.04);
--shadow-card-strong: 0 2px 6px -1px rgb(9 9 11 / 0.10), 0 0 0 1px rgb(9 9 11 / 0.05);
--shadow-card-hover:  0 4px 12px -2px rgb(9 9 11 / 0.12), 0 0 0 1px rgb(9 9 11 / 0.05);
--shadow-pop:         0 8px 24px -4px rgb(9 9 11 / 0.18), 0 0 0 1px rgb(9 9 11 / 0.06);
```

---

## 6. Background — Remove Ambient Decoration

Delete both `body::before` and `body::after` pseudo-elements entirely. These add the radial gradient washes and the dot-grid mesh. The pure `--color-page: #ffffff` background with card borders creates all the visual structure needed.

Also delete the `@media (prefers-color-scheme: dark)` overrides for these two pseudo-elements.

---

## 7. Component Changes

### 7a. `app/layout.tsx` — Font swap

Replace the Google Fonts import:

```html
<!-- Remove -->
Manrope:wght@300;400;500;600;700;800 + JetBrains+Mono

<!-- Add -->
IBM+Plex+Sans:wght@300;400;500;600;700 + DM+Mono:wght@400;500
```

Update `--font-sans` and `--font-mono` in `globals.css` accordingly.

### 7b. `components/admin/sidebar.tsx` — Remove wordmark gradient

Remove the `bg-gradient-to-b from-brand-100/70` span and the radial blur span from the wordmark area. Replace with a simple clean div — no background decoration.

Before (wordmark area):
```tsx
<div className="relative px-5 pt-6 pb-5 ...">
  <span aria-hidden className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-brand-100/70 ..." />
  <span aria-hidden className="absolute -left-4 -top-4 h-24 w-32 rounded-full bg-brand-400/10 blur-2xl ..." />
  <Wordmark ... />
</div>
```

After:
```tsx
<div className="px-5 pt-5 pb-4">
  <Wordmark ... />
</div>
```

Also remove the bottom brand accent bar (`bg-gradient-to-r from-brand-400/0 via-brand-500/80` span) from the sidebar footer.

### 7c. `components/admin/topbar.tsx` — Remove brand bar gradient

Remove the `before:content-[''] before:absolute before:inset-x-0 before:top-0 before:h-[3px] before:bg-gradient-to-r` classes from the topbar div. Keep everything else.

### 7d. `components/app-footer.tsx` — Remove heart decoration

Replace the "Made with Heart by your haute tech team" span with a plain text credit line, removing the Heart Lucide import.

Before:
```tsx
<span className="inline-flex items-center gap-1">
  Made with <Heart className="h-3 w-3 fill-current text-rose-500" aria-label="love" /> by your haute tech team
</span>
```

After:
```tsx
<span>Made by your haute tech team</span>
```

Remove the `Heart` import from lucide-react.

---

## 8. Scope

| Surface | Changes |
|---|---|
| Admin shell (sidebar, topbar, footer) | Font, tokens, remove gradients |
| Admin pages | Font + tokens flow through — no component edits needed |
| Employee PWA | Font + tokens flow through via `globals.css` |
| Login / auth | Font + tokens flow through |
| Print / PDF | `body::before`/`::after` are already hidden in `@media print` — no change needed |

---

## 9. What Does NOT Change

- Teal brand color (#0f766e) and the full brand-50→900 scale
- All Tailwind utility class names (bg-surface, border-border, etc.)
- All routes, server actions, database schema
- Auth, i18n, OTel, audit
- Lucide icons
- Dark mode token overrides (kept, updated to use zinc values to match light mode)
- All component logic and data

---

## 10. Files Changed

1. `app/layout.tsx` — Google Fonts URL
2. `app/globals.css` — @theme tokens + remove body::before/::after
3. `components/admin/sidebar.tsx` — remove wordmark + footer gradients
4. `components/admin/topbar.tsx` — remove brand bar
5. `components/app-footer.tsx` — remove Heart icon + "Made with love" copy
