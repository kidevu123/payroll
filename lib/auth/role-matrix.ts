// Role × surface authorization matrix. Owner-editable.
//
// Existing pattern: hardcoded role lists baked into auth-guards.ts —
// requireAdmin = OWNER+ADMIN+PAYROLL_STAFF, requireCashDrawer =
// OWNER+ADMIN+ACCOUNTANT, etc. That's fine for code paths that never
// change shape. But the owner asked for a UI to "pick and choose"
// what PAYROLL_STAFF and ACCOUNTANT can see — without that, scope
// changes need a deploy.
//
// This module is the override layer. Defaults match the hardcoded
// guards so behavior is unchanged out of the box. Owner toggles on
// /settings/roles, the override is persisted to a Setting, and any
// surface gated by `canAccessSurface` (or `requireSurface`) honours
// the new shape on the next request.
//
// OWNER is always allowed everywhere — non-negotiable. ADMIN's
// matrix is editable but OWNER cannot lock themselves out
// (the UI hides the OWNER column entirely). EMPLOYEE's matrix is
// empty — they live at /me/*, not /admin/*.

import type { Role } from "@/lib/auth";
import { getSetting } from "@/lib/settings/runtime";

export const SURFACES = [
  "/dashboard",
  "/employees",
  "/salaried",
  "/time",
  "/punches",
  "/payroll",
  "/calendar",
  "/requests",
  "/ngteco",
  "/reports",
  "/hall-monitor",
  "/cash-drawer",
  "/notifications",
  "/audit",
  "/db",
  "/settings",
] as const;

export type Surface = (typeof SURFACES)[number];

export const SURFACE_LABEL: Record<Surface, string> = {
  "/dashboard": "Dashboard",
  "/employees": "Employees",
  "/salaried": "Salaried staff",
  "/time": "Time grid",
  "/punches": "All punches",
  "/payroll": "Payroll",
  "/calendar": "Calendar",
  "/requests": "Requests",
  "/ngteco": "NGTeco poll",
  "/reports": "Reports",
  "/hall-monitor": "Hall monitor",
  "/cash-drawer": "Cash drawer",
  "/notifications": "Notifications",
  "/audit": "Audit log",
  "/db": "Database browser",
  "/settings": "Settings",
};

export type EditableRole = "PAYROLL_STAFF" | "ACCOUNTANT" | "ADMIN";

/** Defaults match the existing hardcoded guards as of 2026-05-06. */
const DEFAULTS: Record<Role, ReadonlyArray<Surface>> = {
  OWNER: [...SURFACES],
  ADMIN: SURFACES.filter((s) => s !== "/db"),
  PAYROLL_STAFF: [
    "/dashboard",
    "/employees",
    "/salaried",
    "/time",
    "/punches",
    "/payroll",
    "/calendar",
    "/requests",
    "/ngteco",
    "/reports",
    "/hall-monitor",
  ],
  ACCOUNTANT: ["/dashboard", "/cash-drawer", "/reports"],
  EMPLOYEE: [],
};

export function defaultSurfacesFor(role: Role): ReadonlyArray<Surface> {
  return DEFAULTS[role];
}

/** Read the override setting, merge with defaults, return the
 *  surface set this role currently has access to. */
export async function effectiveSurfacesFor(
  role: Role,
): Promise<ReadonlyArray<Surface>> {
  if (role === "OWNER") return DEFAULTS.OWNER;
  if (role === "EMPLOYEE") return [];
  const override = await readOverride();
  const o = override?.[role as EditableRole];
  if (!o) return DEFAULTS[role];
  // Filter to known surfaces only — avoids stale-key bombs if an old
  // setting still references a removed route.
  return o.filter((s): s is Surface =>
    (SURFACES as ReadonlyArray<string>).includes(s),
  );
}

/** Boolean check used by middleware / page guards. */
export async function canAccessSurface(
  role: Role,
  surface: Surface,
): Promise<boolean> {
  const list = await effectiveSurfacesFor(role);
  return list.includes(surface);
}

/** Accountants can follow a cash-drawer/report row into one period review
 * without getting the whole payroll workspace surface. */
export function isAccountantPeriodReviewPath(pathname: string): boolean {
  return /^\/payroll\/[^/]+\/?$/.test(pathname);
}

type Override = { [R in EditableRole]?: ReadonlyArray<string> };

/** Read the rolePermissions setting. Falls back to {} if unset. */
async function readOverride(): Promise<Override | null> {
  try {
    const cfg = await getSetting("rolePermissions");
    return (cfg?.overrides as Override) ?? null;
  } catch {
    return null;
  }
}
