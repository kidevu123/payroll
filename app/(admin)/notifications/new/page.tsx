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
import { ComposeAnnouncementForm } from "../compose-form";

export const dynamic = "force-dynamic";

export default async function NewAnnouncementPage() {
  // Only ACTIVE/INACTIVE employees who actually have a linked user can
  // receive a push or in-app notification. We pass the lighter shape
  // the form needs for the SPECIFIC picker.
  const employees = await listEmployees();
  const eligible = employees
    .filter((e) => e.status !== "TERMINATED")
    .map((e) => ({
      id: e.id,
      displayName: e.displayName,
      payType: e.payType,
    }));

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/notifications"
          className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text"
        >
          <ArrowLeft className="h-3 w-3" /> Notifications
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
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
          <CardTitle className="text-base">Compose</CardTitle>
          <CardDescription className="text-xs">
            Audience preview updates as you change the filter.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ComposeAnnouncementForm employees={eligible} />
        </CardContent>
      </Card>
    </div>
  );
}
