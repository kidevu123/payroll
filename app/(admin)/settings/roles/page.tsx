import { requireOwner } from "@/lib/auth-guards";
import { getSetting } from "@/lib/settings/runtime";
import { defaultSurfacesFor, SURFACES, SURFACE_LABEL, type EditableRole, type Surface } from "@/lib/auth/role-matrix";
import { RolesMatrixForm } from "./roles-form";

const ROLES: ReadonlyArray<EditableRole> = ["PAYROLL_STAFF", "ACCOUNTANT", "ADMIN"];

const ROLE_LABEL: Record<EditableRole, string> = {
  PAYROLL_STAFF: "Payroll staff",
  ACCOUNTANT: "Accountant",
  ADMIN: "Admin",
};

export default async function Page() {
  // Owner-only — this matrix can grant/revoke access to every other role.
  await requireOwner();
  const cfg = await getSetting("rolePermissions");
  const overrides = cfg?.overrides ?? {};

  // Build the resolved matrix the form should render: for each role,
  // show the override if present, otherwise the default.
  const rows: Array<{
    role: EditableRole;
    label: string;
    surfaces: Record<Surface, boolean>;
    isOverride: boolean;
  }> = ROLES.map((role) => {
    const override = overrides[role];
    const allowed = new Set<string>(override ?? defaultSurfacesFor(role));
    const surfaces = Object.fromEntries(
      SURFACES.map((s) => [s, allowed.has(s)]),
    ) as Record<Surface, boolean>;
    return {
      role,
      label: ROLE_LABEL[role],
      surfaces,
      isOverride: !!override,
    };
  });

  return (
    <RolesMatrixForm
      rows={rows}
      surfaces={SURFACES.map((s) => ({ key: s, label: SURFACE_LABEL[s] }))}
    />
  );
}
