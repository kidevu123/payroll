// Shared by every row of the reports ledger: the column template and the
// handler bundle the table passes down to its rows.
import type { ZohoOrganization } from "@/lib/db/schema";

/** Shared lg column template — the header row, every period line, and the
 *  month subtotal row use the exact same tracks so the statement reads as one
 *  aligned table: period | schedule | payment | status | gross | net | actions.
 *
 *  The actions track is a FIXED width, not `auto`. Each row is its own grid
 *  container (there is no subgrid here), so an `auto` track resolved against
 *  each row's own content: 72px in the header, ~74px in a plain row, ~135px
 *  when a LOCKED row added its "Pay" button, ~180px mid delete-confirm. Every
 *  one of those redistributed the remaining six fr tracks differently, so the
 *  header lined up with nothing and rows didn't line up with each other. A
 *  fixed track makes all containers resolve identically. */
export const ACTIONS_TRACK = "7.5rem";
// The pay-period track has a floor so "Aug 03 – Aug 09, 2026" never clips
// under the schedule chip at the 1440px content cap; the chip and the
// paid-via columns are the ones that give.
// Eight tracks (owner mock): period | schedule | paid via | status |
// gross | net | employees | actions.
export const TABLE_GRID =
  "lg:grid-cols-[minmax(11rem,1.2fr)_minmax(6.5rem,0.7fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.85fr)_minmax(0,0.9fr)_5.5rem_6.5rem]";

export type SharedHandlers = {
  busyId: string | null;
  setError: (v: string | null) => void;
  confirmDelete: string | null;
  setConfirmDelete: (v: string | null) => void;
  onPush: (reportId: string, orgId: string | undefined, label: string) => void;
  onRepush: (
    reportId: string,
    orgId: string | undefined,
    label: string,
    expenseId: string | null,
  ) => void;
  onPublish: (id: string) => void;
  onDelete: (id: string) => void;
  haute: ZohoOrganization | undefined;
  boomin: ZohoOrganization | undefined;
  drawerBalanceCents: number;
  canManageReports: boolean;
};
