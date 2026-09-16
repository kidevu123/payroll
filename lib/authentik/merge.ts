// Profile merge precedence: Authentik owns display name and email.
//
// Deliberately NOT owned by the IdP: payroll role, employee linkage, pay
// data, enabled/disabled. Those are business facts, audited on the payroll
// side, and an IdP edit must never move them.
//
// Pure — no I/O. The caller resolves `emailTakenByAnotherUser` and applies
// whatever this returns.

export type ProfileMerge = {
  email: { from: string; to: string } | null;
  displayName: { from: string; to: string } | null;
  conflicts: {
    field: "email";
    reason: "taken-by-another-payroll-user";
    value: string;
  }[];
};

function clean(value: string | null): string {
  return (value ?? "").trim();
}

export function computeProfileMerge(input: {
  payrollEmail: string;
  payrollDisplayName: string | null;
  idpEmail: string | null;
  idpName: string | null;
  emailTakenByAnotherUser: boolean;
}): ProfileMerge {
  const merge: ProfileMerge = { email: null, displayName: null, conflicts: [] };

  const idpEmail = clean(input.idpEmail);
  const payrollEmail = clean(input.payrollEmail);
  if (idpEmail.length > 0 && idpEmail.toLowerCase() !== payrollEmail.toLowerCase()) {
    if (input.emailTakenByAnotherUser) {
      // Never break the unique index and never lock anyone out over a
      // profile detail: skip, report, admit the login.
      merge.conflicts.push({
        field: "email",
        reason: "taken-by-another-payroll-user",
        value: idpEmail,
      });
    } else {
      merge.email = { from: payrollEmail, to: idpEmail };
    }
  }

  const idpName = clean(input.idpName);
  const payrollName = clean(input.payrollDisplayName);
  if (idpName.length > 0 && idpName !== payrollName) {
    merge.displayName = { from: payrollName, to: idpName };
  }

  return merge;
}
