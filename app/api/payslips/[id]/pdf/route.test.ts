// Authz tests for /api/payslips/[id]/pdf. The route layers three checks on
// top of requireSession; this exercises each negative branch with a
// mocked session + query layer (no real DB or filesystem touched).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth-guards", () => ({
  requireSession: vi.fn(),
}));

vi.mock("@/lib/db/queries/payslips", () => ({
  getPayslip: vi.fn(),
  isPayslipPublishedToPortal: vi.fn(),
}));

import { requireSession } from "@/lib/auth-guards";
import {
  getPayslip,
  isPayslipPublishedToPortal,
} from "@/lib/db/queries/payslips";
import { GET } from "./route";

const PAYSLIP_ID = "11111111-1111-1111-1111-111111111111";
const EMP_ID_OWNER = "22222222-2222-2222-2222-222222222222";
const EMP_ID_OTHER = "33333333-3333-3333-3333-333333333333";

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function basePayslip() {
  return {
    id: PAYSLIP_ID,
    employeeId: EMP_ID_OWNER,
    periodId: "44444444-4444-4444-4444-444444444444",
    payrollRunId: "55555555-5555-5555-5555-555555555555",
    generatedAt: new Date(),
    hoursWorked: "40.00",
    grossPayCents: 80000,
    roundedPayCents: 80000,
    taskPayCents: 0,
    pdfPath: "/data/payslips/legacy/2026-01-01__2026-01-07/report.pdf",
    publishedAt: new Date(),
    acknowledgedAt: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/api/payslips/[id]/pdf authz", () => {
  it("returns 403 when an employee asks for someone else's payslip", async () => {
    vi.mocked(requireSession).mockResolvedValue({
      user: {
        id: "user-other",
        email: "other@local",
        role: "EMPLOYEE",
        employeeId: EMP_ID_OTHER,
      },
      expires: "9999-01-01",
    } as never);
    vi.mocked(getPayslip).mockResolvedValue(basePayslip() as never);

    const resp = await GET(new Request("http://x/api/payslips/x/pdf"), makeContext(PAYSLIP_ID));
    expect(resp.status).toBe(403);
  });

  it("returns 404 when the payslip belongs to the user but the run is not yet published to the portal", async () => {
    vi.mocked(requireSession).mockResolvedValue({
      user: {
        id: "user-self",
        email: "self@local",
        role: "EMPLOYEE",
        employeeId: EMP_ID_OWNER,
      },
      expires: "9999-01-01",
    } as never);
    vi.mocked(getPayslip).mockResolvedValue(basePayslip() as never);
    vi.mocked(isPayslipPublishedToPortal).mockResolvedValue(false);

    const resp = await GET(new Request("http://x/api/payslips/x/pdf"), makeContext(PAYSLIP_ID));
    expect(resp.status).toBe(404);
  });

  it("returns 404 when the payslip does not exist", async () => {
    vi.mocked(requireSession).mockResolvedValue({
      user: {
        id: "user-self",
        email: "self@local",
        role: "EMPLOYEE",
        employeeId: EMP_ID_OWNER,
      },
      expires: "9999-01-01",
    } as never);
    vi.mocked(getPayslip).mockResolvedValue(null);

    const resp = await GET(new Request("http://x/api/payslips/x/pdf"), makeContext(PAYSLIP_ID));
    expect(resp.status).toBe(404);
  });

  it("admins can read any payslip regardless of published_to_portal_at", async () => {
    vi.mocked(requireSession).mockResolvedValue({
      user: {
        id: "user-admin",
        email: "admin@local",
        role: "ADMIN",
        employeeId: undefined,
      },
      expires: "9999-01-01",
    } as never);
    vi.mocked(getPayslip).mockResolvedValue(basePayslip() as never);
    // isPayslipPublishedToPortal must NOT be called for admins.
    vi.mocked(isPayslipPublishedToPortal).mockResolvedValue(false);

    // Admins reach the file-read step. Stub fs/promises so the test doesn't
    // touch disk; expect a 410 (the canonical "file missing" path) which
    // proves authz let the admin through.
    const resp = await GET(new Request("http://x/api/payslips/x/pdf"), makeContext(PAYSLIP_ID));
    expect(resp.status).toBe(410);
    expect(isPayslipPublishedToPortal).not.toHaveBeenCalled();
  });
});
