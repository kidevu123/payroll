import { redirect } from "next/navigation";

// /run-payroll is a passthrough — the only landing surface is /run-payroll/upload.
// Sidebar and other links may point here; redirect rather than dead-end.
export default function Page() {
  redirect("/run-payroll/upload");
}
