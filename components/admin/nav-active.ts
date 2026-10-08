// Is this nav item the current section? Shared by the sidebar and the phone
// tab bar so the two can never highlight different items.
export function isNavActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard" || pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}
