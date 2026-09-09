// Tab keys shared by the server page (parsing ?tab=) and the client strip.

export type ReportsTabKey = "runs" | "employees" | "schedules" | "methods";

export const REPORTS_TABS: Array<[ReportsTabKey, string]> = [
  ["runs", "Pay runs"],
  ["employees", "Employees"],
  ["schedules", "Schedules"],
  ["methods", "Payment methods"],
];

export function parseReportsTab(v: string | undefined): ReportsTabKey {
  return REPORTS_TABS.some(([k]) => k === v) ? (v as ReportsTabKey) : "runs";
}
