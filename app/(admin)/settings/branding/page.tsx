import { getSetting } from "@/lib/settings/runtime";
import { BrandingForm } from "./branding-form";

export const dynamic = "force-dynamic";

export default async function Page() {
  const company = await getSetting("company");
  return <BrandingForm company={company} />;
}
