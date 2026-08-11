import { Download, BookOpen } from "lucide-react";
import { PdfLink } from "@/components/domain/pdf-link";
import { getSetting } from "@/lib/settings/runtime";
import { BrandingForm } from "./branding-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function Page() {
  const company = await getSetting("company");
  return (
    <div className="space-y-6">
      <BrandingForm company={company} />

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <BookOpen className="h-4 w-4 text-brand-700" aria-hidden />
          <CardTitle>Employee guide PDF</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-text-muted">
            A 5-page printable PDF you can email or hand out to a new
            employee. Covers Add-to-Home-Screen, viewing pay, requesting
            time off, and reporting a missed punch — branded with your
            company name and brand color.
          </p>
          <p className="text-xs text-text-subtle">
            To embed real screenshots, drop PNGs into{" "}
            <code className="text-[11px]">/data/employee-guide/</code> on
            the host (filenames: <code className="text-[11px]">install.png</code>,{" "}
            <code className="text-[11px]">home.png</code>,{" "}
            <code className="text-[11px]">pay.png</code>,{" "}
            <code className="text-[11px]">time.png</code>,{" "}
            <code className="text-[11px]">profile.png</code>). The PDF
            renders tasteful placeholders when files are missing.
          </p>
          <Button asChild>
            <PdfLink href="/api/guides/employee" filename="employee-guide.pdf">
              <Download className="h-4 w-4" /> Download employee guide
            </PdfLink>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
