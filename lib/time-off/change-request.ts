export type TimeOffChangeAction = "EDIT" | "CANCEL";
export type TimeOffResolution = "APPROVED" | "REJECTED";

export function isEmployeeEditableTimeOff(
  request: { status: string; endDate: string },
  today: string,
): boolean {
  return request.status === "APPROVED" && request.endDate >= today;
}

export function isAdminManageableTimeOff(
  request: { status: string; type: string; endDate: string },
  today: string,
): boolean {
  return request.type !== "SCHEDULE_NOTE" && isEmployeeEditableTimeOff(request, today);
}

export function timeOffChangeApprovalPlan(
  action: TimeOffChangeAction,
  status: TimeOffResolution,
): {
  resolveChangeAs: "APPROVED" | "REJECTED" | "CANCELLED";
  cancelOriginal: boolean;
} {
  if (status === "REJECTED") {
    return { resolveChangeAs: "REJECTED", cancelOriginal: false };
  }
  return {
    resolveChangeAs: action === "CANCEL" ? "CANCELLED" : "APPROVED",
    cancelOriginal: true,
  };
}
