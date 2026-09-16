// Authentik username derivation.
//
// The live directory uses first name + last initial, lowercase (juanh,
// sahilk, seriv, sohanb). New accounts follow the same shape so the IdP
// stays readable; collisions are handled by the caller, which refuses to
// guess rather than appending a number (see lib/authentik/decide.ts).

/** Lowercase, strip accents, keep [a-z0-9]. */
function slug(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function deriveAuthentikUsername(input: {
  name: string | null;
  email: string;
}): string {
  const words = (input.name ?? "")
    .trim()
    .split(/\s+/)
    .map(slug)
    .filter((w) => w.length > 0);

  if (words.length >= 2) {
    const first = words[0]!;
    const surname = words[words.length - 1]!;
    return `${first}${surname.slice(0, 1)}`;
  }
  if (words.length === 1) return words[0]!;

  const local = slug(input.email.split("@")[0] ?? "");
  return local.length > 0 ? local : "user";
}
