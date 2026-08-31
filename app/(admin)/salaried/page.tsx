// The standalone Salaried page was consolidated into /payroll's Salaried
// tab (Aug 2026) — the tab renders the identical workflow inline, so two
// nav destinations for one job collapsed into one. This route survives as
// a redirect for old bookmarks and deep links. The upload slot + actions
// in this directory remain the real implementation, imported by the
// payroll page's SalariedTabBody.

import { redirect } from "next/navigation";

export default function SalariedPage(): never {
  redirect("/payroll?schedule=salaried");
}
