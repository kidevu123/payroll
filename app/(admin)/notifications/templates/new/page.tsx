// New announcement template. Saved templates appear in the Saved templates
// card on /notifications; picking one pre-fills the compose form.

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TemplateForm } from "./template-form";

export const dynamic = "force-dynamic";

export default function NewTemplatePage() {
  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/notifications"
          className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text"
        >
          <ArrowLeft className="h-3 w-3" /> Notifications
        </Link>
        <h1 className="text-title tracking-tight antialiased text-text">New template</h1>
        <p className="text-sm text-text-muted">
          Save a reusable starting point. Sending from a template still walks
          through the normal compose flow, so you can adjust the wording and
          pick the audience each time.
        </p>
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Template</CardTitle>
          <CardDescription className="text-xs">
            The name is only shown to admins; the title and message are what
            recipients see.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TemplateForm />
        </CardContent>
      </Card>
    </div>
  );
}
