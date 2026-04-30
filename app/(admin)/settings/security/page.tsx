import { getSetting } from "@/lib/settings/runtime";
import { SecurityForm } from "./security-form";

export default async function Page() {
  const settings = await getSetting("security");
  return <SecurityForm settings={settings} />;
}
