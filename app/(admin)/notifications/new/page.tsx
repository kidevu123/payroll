import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listEmployees } from "@/lib/db/queries/employees";
import { getAnnouncementTemplateById } from "@/lib/db/queries/announcement-templates";
import { ComposeAnnouncementForm } from "../compose-form";

export const dynamic = "force-dynamic";

export default async function NewAnnouncementPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string }>;
}) {
  const sp = await searchParams;
  // Only ACTIVE/INACTIVE employees who actually have a linked user can
  // receive a push or in-app notification. We pass the lighter shape
  // the form needs for the SPECIFIC picker.
  const [employees, template] = await Promise.all([
    listEmployees(),
    sp.template
      ? getAnnouncementTemplateById(sp.template).catch(() => null)
      : Promise.resolve(null),
  ]);
  const eligible = employees
    .filter((e) => e.status !== "TERMINATED")
    .map((e) => ({
      id: e.id,
      displayName: e.displayName,
      payType: e.payType,
    }));

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/notifications"
          className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text"
        >
          <ArrowLeft className="h-3 w-3" /> Notifications
        </Link>
        <h1 className="text-title tracking-tight antialiased text-text">
          Send announcement
        </h1>
        <p className="text-sm text-text-muted">
          Broadcasts a message to the in-app inbox and a Web Push to anyone
          who has the PWA installed and granted notifications. The exact
          words you type are what people see.
        </p>
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Compose</CardTitle>
          <CardDescription className="text-xs">
            Audience preview updates as you change the filter.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ComposeAnnouncementForm
            employees={eligible}
            {...(template
              ? {
                  initial: {
                    title: template.title,
                    body: template.body,
                    link: template.link,
                  },
                }
              : {})}
          />
        </CardContent>
      </Card>
    </div>
  );
}
