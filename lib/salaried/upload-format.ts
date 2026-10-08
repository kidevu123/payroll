// Shapes and formatters shared by the salaried paystub upload slot and its
// rows. Moved out of app/(admin)/salaried/salaried-upload-slot.tsx.

export type DocLite = {
  id: string;
  originalFilename: string;
  kind: "W2" | "PAYSTUB" | "OTHER";
  uploadedAt: string;
  payPeriodStart: string | null;
  payPeriodEnd: string | null;
  amountCents: number | null;
  zohoExpenseId: string | null;
};

export const KIND_LABEL: Record<DocLite["kind"], string> = {
  PAYSTUB: "Paystub",
  W2: "W2",
  OTHER: "Other",
};

export function formatRange(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  const a = new Date(`${start}T12:00:00Z`);
  const b = new Date(`${end}T12:00:00Z`);
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  const left = `${m[a.getUTCMonth()]} ${a.getUTCDate()}${sameYear ? "" : `, ${a.getUTCFullYear()}`}`;
  const right = `${m[b.getUTCMonth()]} ${b.getUTCDate()}, ${b.getUTCFullYear()}`;
  return `${left} – ${right}`;
}

export function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

/** "2143.20" from integer cents — for pre-filling the editable net input. */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

export type ReadState =
  | { kind: "IDLE" }
  | { kind: "READING" }
  | { kind: "FILLED" }
  | { kind: "MANUAL"; reason: string };
