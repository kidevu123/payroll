// One place for "an employee signed this payslip on the tablet": validate
// the pad's PNG, persist it, stamp the row. Used by both the self-serve
// kiosk action and the payday action; ownership/authorisation checks stay
// in the callers because they differ (employee session vs period session).

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, type Payslip } from "@/lib/db/schema";
import {
  PayslipAlreadySignedError,
  signPayslip,
  type SignedVia,
} from "@/lib/db/queries/payslips";
import {
  SignatureInvalidError,
  parseSignatureDataUrl,
  validateSignaturePng,
  writeSignatureFile,
} from "./signature-storage";

export type SignFlowResult = { ok: true } | { error: string };

export async function signPayslipFromPad(args: {
  slip: Payslip;
  signature: unknown;
  via: SignedVia;
  /** Copy for the two user-facing failures. */
  copy: { empty: string; error: string };
}): Promise<SignFlowResult> {
  const { slip, signature, via, copy } = args;
  if (slip.signedAt) return { error: copy.error };
  let png: Buffer;
  try {
    png = parseSignatureDataUrl(signature);
    await validateSignaturePng(png);
  } catch (e) {
    if (e instanceof SignatureInvalidError) {
      return { error: /sign before/i.test(e.message) ? copy.empty : copy.error };
    }
    throw e;
  }
  let path: string;
  try {
    path = await writeSignatureFile(slip.periodId, slip.id, png);
  } catch (e) {
    // "wx" flag: the file already exists → someone signed in between.
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return { error: copy.error };
    throw e;
  }
  const [linkedUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.employeeId, slip.employeeId))
    .limit(1);
  try {
    await signPayslip(
      slip.id,
      { signaturePath: path, signedVia: via },
      { id: linkedUser?.id ?? null, role: "EMPLOYEE" },
    );
  } catch (e) {
    if (e instanceof PayslipAlreadySignedError) return { error: copy.error };
    throw e;
  }
  return { ok: true };
}
