"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createTemplateAction } from "../../actions";

export function TemplateForm() {
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  return (
    <form
      action={async (form) => {
        setPending(true);
        setError(null);
        const r = await createTemplateAction(form);
        setPending(false);
        if (r?.error) setError(r.error);
      }}
      className="space-y-4"
    >
      <div className="space-y-1">
        <Label htmlFor="name">Template name</Label>
        <Input
          id="name"
          name="name"
          required
          maxLength={120}
          placeholder="e.g. Weekly reminder"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          name="title"
          required
          maxLength={200}
          placeholder="What recipients see as the headline"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="body">Message</Label>
        <textarea
          id="body"
          name="body"
          required
          rows={5}
          maxLength={2000}
          placeholder="The message body. You can tweak it before each send."
          className="w-full rounded-input border border-border bg-surface px-3 py-2 text-sm"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="link">Optional link</Label>
        <Input
          id="link"
          name="link"
          maxLength={500}
          placeholder="/me/time  (or  https://...)"
        />
      </div>
      {error && <p className="text-sm text-danger-700">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save template"}
        </Button>
      </div>
    </form>
  );
}
