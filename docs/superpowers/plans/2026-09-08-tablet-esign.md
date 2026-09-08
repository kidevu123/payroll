# Tablet e-signature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Employees sign their own payslip on the warehouse tablet (never seeing anyone else's pay); the owner's printed Signature report embeds those signatures.

**Architecture:** Three nullable columns on `payslips` hold the signature PNG path, time, and channel. A dependency-free canvas pad posts a PNG data URL to server actions that validate, store the file under `STORAGE_ROOT/uploads/payslip-signatures`, and stamp the row. Two entry points share one signing screen: the PIN-authed `/kiosk` session and a period-scoped `/kiosk/payday` session unlocked by a 6-digit code minted on the admin period page. The on-demand report PDFs inline the PNGs.

**Tech Stack:** Next 15 app router + server actions, Drizzle/Postgres, @react-pdf/renderer, vitest, Playwright.

Spec: `docs/superpowers/specs/2026-09-08-tablet-esign-design.md`.

---

### Task 1: Schema + migration
- Modify `lib/db/schema.ts` payslips: `signaturePath text`, `signedAt timestamptz`, `signedVia text`.
- Run `npx drizzle-kit generate --name payslip_signature` → `drizzle/0047_payslip_signature.sql` + journal + snapshot.
- Commit `feat(db): payslip signature columns`.

### Task 2: Signature storage helper (TDD)
- Test `lib/payslips/signature-storage.test.ts`: accepts a real 1x1 PNG data URL; rejects non-PNG data URL, JPEG bytes, oversize (>200 KB), and a payload below `MIN_INK_BYTES`; `isSignaturePath` containment.
- Implement `lib/payslips/signature-storage.ts`: `parseSignatureDataUrl(s): Buffer`, `writeSignatureFile(periodId, payslipId, png): Promise<string>`, `isSignaturePath`, `SIGNATURE_DIR`.
- Commit.

### Task 3: Scoped kiosk tokens + payday codes (TDD)
- Refactor `lib/kiosk/session.ts`: `sealScopedToken/openScopedToken(scope)`; kiosk wrappers unchanged; existing tests still pass.
- Test `lib/kiosk/payday.test.ts`: `issuePaydayCode(periodId)` returns 6 digits; `consumePaydayCode(code)` returns periodId once then null; expired code null; unknown code null; payday token round-trip and cross-scope rejection (a kiosk token is not a payday token).
- Implement `lib/kiosk/payday.ts`: in-memory map, `PAYDAY_CODE_TTL_S = 900`, `PAYDAY_SESSION_TTL_S = 3*3600`, `PAYDAY_COOKIE_NAME = "kiosk_payday"`, seal/open with scope `kiosk-payday`.
- Commit.

### Task 4: Payslip queries
- `lib/db/queries/payslips.ts`: `signPayslip(id, { signaturePath, signedVia }, actor)` — throws `PayslipAlreadySignedError` if `signedAt` set; sets `signedAt`, `signaturePath`, `signedVia`, and `acknowledgedAt` if null; audit `payslip.sign` with `{ signedVia }` payload only. `listSignatureStatusForPeriod(periodId)`.
- Commit.

### Task 5: Signature pad component
- `components/domain/signature-pad.tsx` (client): canvas at DPR, pointer events, `touch-action:none`, Clear, hidden input `signature`, `onInkChange(hasInk)`.
- `components/domain/payslip-sign-form.tsx` (client): wraps pad + statement + Sign button disabled until ink; takes `action`, `payslipId`, copy strings.
- Commit.

### Task 6: Kiosk self-serve signing
- `lib/kiosk/copy.ts`: `paySignTitle`, `paySign`, `paySignStatement`, `paySignClear`, `paySignedBanner`, `paySignHint` en/es.
- Extract the day-rows loader from `app/kiosk/(session)/pay/page.tsx` into `lib/kiosk/payslip-days.ts` (`loadPayslipDays(employeeId, slip, period, tz, locale)`) so the sign pages reuse it.
- `app/kiosk/(session)/pay/page.tsx`: card targets newest unsigned slip; Approve form → Link to `/kiosk/pay/sign/[id]`; `?signed=1` banner.
- `app/kiosk/(session)/pay/sign/[payslipId]/page.tsx` + `kioskSignPayslipAction` in `app/kiosk/actions.ts` (replaces `kioskAcknowledgePayslipAction`).
- Commit.

### Task 7: Payday mode
- `app/kiosk/payday/actions.ts`: `paydayUnlockAction(code)`, `paydayEndAction`, `paydaySignPayslipAction`, `requirePaydayPeriod()`.
- `app/kiosk/payday/page.tsx` (code entry, keypad), `app/kiosk/payday/(session)/layout.tsx` (header + End + 3-min idle return to list), `list/page.tsx` (names only), `sign/[payslipId]/page.tsx`.
- `app/kiosk/page.tsx`: quiet "Payday signing" link.
- Commit.

### Task 8: Admin surfaces
- `app/(admin)/payroll/[periodId]/payroll-docs-actions.ts`: `createPaydayCodeAction(periodId)` (requireAdmin, audit `payday.code_issue`).
- `app/(admin)/payroll/[periodId]/payday-signing-button.tsx` (client): button → shows code + expiry.
- Period page: button in Payroll documents card; acknowledgement card gains "Signed n of m" line + unsigned names.
- `app/(admin)/reports/reports-table.tsx`: signed count chip on the period row (query adds `signedCount`).
- Commit.

### Task 9: PDF embedding
- `lib/pdf/types.ts`: optional `signaturePng?: string; signedAt?: string` on AdminReport employees and SignatureReport rows.
- `lib/pdf/admin-report.tsx`, `lib/pdf/signature-report.tsx`: render `<Image>` + date when present.
- `lib/pdf/build-admin-report.ts`: read `signaturePath` per stored payslip, inline as data URL.
- Render tests updated with one signed row.
- Commit.

### Task 10: Verify
- `npm test`, `npx tsc --noEmit`, `npm run build`.
- Playwright tablet run (1024x768, light theme) against local throwaway DB: kiosk PIN sign, payday code sign, list shows no `$`, signature report PDF contains 2 images.
- Update `CLAUDE.md` + `docs/spec.md`; commit; deploy per runbook.
