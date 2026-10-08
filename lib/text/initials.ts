// Avatar / icon initials. Was copied into seven files that differed only in
// what an empty name shows, so that is the one parameter.
export function initialsFor(name: string, empty = "—"): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return empty;
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
