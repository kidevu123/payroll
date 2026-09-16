// Which of the three things to do with one payroll user.
//
// Matching is by EMAIL only. A username hit is ambiguous — it can mean "the
// same person whose email changed in the IdP" or "a different person with the
// same first name and last initial" — and payroll cannot tell those apart.
// Linking the wrong one would hand someone else's SSO identity a payroll
// account, so that case stops and asks for a human instead of guessing.

export type ProvisionDecision =
  | { action: "skip"; reason: "already-linked" | "disabled" | "no-email" }
  | { action: "link"; authentikPk: number; username: string }
  | { action: "create"; username: string }
  | { action: "needs-review"; reason: "username-taken"; username: string };

export function decideProvision(input: {
  alreadyLinked: boolean;
  disabled: boolean;
  email: string;
  candidateUsername: string;
  matchByEmail: { pk: number; username: string } | null;
  usernameTaken: boolean;
}): ProvisionDecision {
  if (input.alreadyLinked) return { action: "skip", reason: "already-linked" };
  if (input.disabled) return { action: "skip", reason: "disabled" };
  if (input.email.trim().length === 0) return { action: "skip", reason: "no-email" };

  if (input.matchByEmail) {
    return {
      action: "link",
      authentikPk: input.matchByEmail.pk,
      username: input.matchByEmail.username,
    };
  }
  if (input.usernameTaken) {
    return { action: "needs-review", reason: "username-taken", username: input.candidateUsername };
  }
  return { action: "create", username: input.candidateUsername };
}
