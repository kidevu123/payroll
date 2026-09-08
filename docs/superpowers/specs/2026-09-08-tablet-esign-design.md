# Tablet e-signature for payslips — design

Date: 2026-09-08. Owner ask: employees currently sign the printed Admin
Report (one shared sheet listing every employee's hours and pay), so they
see each other's pay and it is causing conflict. Replace the shared paper
sheet with individual e-signatures captured on the warehouse tablet, while
keeping a printable signed report for the owner and accountant.

## Goals

1. An employee never sees anyone else's pay while signing.
2. Each employee draws a real signature on the tablet for their own payslip.
3. The owner can still print the Signature report PDF; signed rows carry the
   drawn signature and signed date, unsigned rows stay blank.
4. Two ways to sign: self-serve on the existing `/kiosk` (clock ID + PIN),
   and a "payday" mode where the owner unlocks a names-only list for one
   period and hands the tablet around, no employee PIN needed.

Non-goals: typed-name signatures, signature on the individual payslip PDF,
counter-signature by the owner, cryptographic signing.

## Data model

Three nullable columns on `payslips` (migration `0047_payslip_signature.sql`):

| column | type | meaning |
| --- | --- | --- |
| `signature_path` | text | absolute path of the PNG under `STORAGE_ROOT/uploads/payslip-signatures/<periodId>/<payslipId>.png` |
| `signed_at` | timestamptz | when the employee tapped Sign |
| `signed_via` | text | `KIOSK` (self-serve) or `PAYDAY` (owner-driven) |

Signing is also acknowledgement: the sign query sets `acknowledged_at` if it
is null. A payslip can be signed once; re-signing is refused (the old
signature is never overwritten). Audit action `payslip.sign` with the
`signedVia` in the payload, never the image.

`lib/payslips/signature-storage.ts` owns validation and persistence:

- accepts a `data:image/png;base64,...` string from the client
- caps decoded size at 200 KB, rejects anything not starting with the PNG
  magic bytes, rejects an empty (fully transparent) drawing by requiring at
  least `MIN_INK_BYTES` of non-header payload
- writes the file with `mkdir -p`, returns the stored path
- `isSignaturePath()` containment check for reading back

`lib/db/queries/payslips.ts` gains `signPayslip(id, { path, via }, actor)`
(transaction + audit) and `listSignatureStatusForPeriod(periodId)` returning
`{ signed, total, unsigned: [{ employeeId, displayName }] }` over active
payslips.

## Signature pad

`components/domain/signature-pad.tsx`, a client component with no
dependency: a `<canvas>` sized to its container at devicePixelRatio, pointer
events (works with finger and stylus), 3px round-cap strokes, Clear button,
and a hidden `<input name="signature">` filled with the PNG data URL on
every stroke end. Exposes `hasInk` so the Sign button stays disabled until
something is drawn. `touch-action: none` on the canvas so the page does not
scroll while drawing. Window-level `pointerdown` already resets the kiosk
idle timer, so drawing keeps the session alive.

## Self-serve kiosk flow

`/kiosk/pay`: the "New payslip — needs your OK" card keeps the period, day
rows and total. The Approve form is replaced by a link "Sign & approve" to
`/kiosk/pay/sign/[payslipId]`. The card now targets the newest published
payslip with no `signed_at` (previously no `acknowledged_at`).

`/kiosk/pay/sign/[payslipId]`: same summary (period, hours, day rows, pay),
a statement line "I confirm these hours and pay are correct", the pad,
Clear + Sign. Server action `kioskSignPayslipAction` re-checks that the
payslip belongs to the session employee and is published, calls the storage
and query helpers, redirects to `/kiosk/pay?signed=1` which shows a
"Signed. Thank you." banner. Copy is bilingual through `lib/kiosk/copy.ts`.

`kioskAcknowledgePayslipAction` is removed; signing is the only approval
path on the kiosk. The phone portal's acknowledge flow is untouched.

## Payday mode (owner hands the tablet around)

Unlock: on `/payroll/[periodId]` the Payroll documents card gains a
"Payday signing" button (Owner/Admin). It calls `createPaydayCodeAction`
which stores a 6-digit code in a new `lib/kiosk/payday.ts` in-memory map
`{ code -> { periodId, exp } }` with a 15-minute TTL, single use, and
shows it inline with "Enter this on the warehouse tablet". In-memory is
fine: single-node app, and a lost code is regenerated in one click.

Tablet: `/kiosk` login screen gains a quiet "Payday signing" link to
`/kiosk/payday` which asks for the code (big keypad-style input). On
success the action sets an httpOnly cookie `kiosk_payday` (HMAC-sealed
`{ periodId, exp }` via the existing seal/open helpers with a distinct key
suffix, path `/kiosk`, 3-hour TTL) and redirects to `/kiosk/payday/list`.

`/kiosk/payday/list`: header "Payday signing — <period dates>" with a red
End button (deletes the cookie with the matching path). Body: one row per
active payslip in the period, name only, unsigned first, signed rows show a
check and are not tappable. Tapping a row opens
`/kiosk/payday/sign/[payslipId]`, the same signing screen as self-serve
but authorised by the payday cookie (payslip must belong to the cookie's
period). On success it returns to the list. The payday routes live under
`app/kiosk/payday/` OUTSIDE the `(session)` group so they never require the
employee PIN session and never render the employee idle watcher; they get
their own layout with the End button and a 3-minute idle return to the list
(not a logout: the owner is standing there).

Security notes: the payday cookie can only reach names and one payslip at a
time for one period; the code is single use and expires; the admin session
never touches the tablet.

## Signed record

`AdminReportInput.employees[]` and `SignatureReportInput.rows[]` gain
optional `signaturePng?: string` (data URL) and `signedAt?: string`
(formatted). `admin-report.tsx` renders the PNG inside the sign row at the
line's height and prints the date in the DATE slot; `signature-report.tsx`
does the same in its Signature/Date cells. Blank when absent, so the sheet
is unchanged for unsigned rows. `build-admin-report.ts` reads each active
payslip's `signature_path` and inlines the file. The publish job's stored
`signature-report.pdf` is rendered before anyone signs and stays as-is; the
on-demand route is the signed one.

Period page: next to the Signature report button, "Signed 14 of 18" with a
tooltip listing who has not signed. Reports table period row: a small
"14/18 signed" chip when at least one payslip exists.

## Testing

- `signature-storage.test.ts`: accepts a valid PNG data URL, rejects
  non-PNG, oversize, and empty drawings, path containment.
- `payday.test.ts`: code issue/consume, single use, expiry, wrong code.
- `payslips` query tests (existing pattern): sign sets signed + acknowledged,
  refuses a second signature.
- PDF render tests: admin report and signature report with one signed row
  render without throwing and include the image.
- Playwright on a 1024x768 tablet viewport against the throwaway DB: sign
  via kiosk PIN, sign a second employee via payday code, confirm the list
  never shows an amount, download the signature report and assert it
  contains two embedded images.

## Files

New: `drizzle/0047_payslip_signature.sql`, `lib/payslips/signature-storage.ts`
(+test), `lib/kiosk/payday.ts` (+test), `components/domain/signature-pad.tsx`,
`app/kiosk/(session)/pay/sign/[payslipId]/page.tsx`, `app/kiosk/payday/`
(layout, page, list/page, sign/[payslipId]/page, actions).
Changed: `lib/db/schema.ts`, `lib/db/queries/payslips.ts`, `lib/pdf/types.ts`,
`lib/pdf/admin-report.tsx`, `lib/pdf/signature-report.tsx`,
`lib/pdf/build-admin-report.ts`, `app/kiosk/actions.ts`, `app/kiosk/page.tsx`,
`app/kiosk/(session)/pay/page.tsx`, `lib/kiosk/copy.ts`,
`app/(admin)/payroll/[periodId]/page.tsx` (+ actions),
`app/(admin)/reports/reports-table.tsx`, `CLAUDE.md`, `docs/spec.md`.
