/** NGTeco Person grid cells often include an avatar initial before the name. */
export function sanitizeNgtecoPersonName(raw: string): string {
  let name = raw.trim().replace(/\s+/g, " ");
  if (!name) return name;

  // "CCatalina Ramirez" — avatar letter duplicated at start of textContent.
  if (
    name.length >= 2 &&
    name[0]!.toLowerCase() === name[1]!.toLowerCase() &&
    /[A-Za-z]/.test(name[0]!)
  ) {
    name = name.slice(1).trim();
  }

  return name;
}

export function looksLikeDoubledAvatarName(raw: string): boolean {
  const name = raw.trim();
  return (
    name.length >= 2 &&
    name[0]!.toLowerCase() === name[1]!.toLowerCase() &&
    /[A-Za-z]/.test(name[0]!)
  );
}
