"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Camera, Trash2, AlertCircle } from "lucide-react";
import { Avatar } from "@/components/domain/avatar";
import { Button } from "@/components/ui/button";

// Profile photo uploader. POSTs multipart to /api/employees/{id}/photo.
// On success, busts the avatar URL with a fresh ?v= so the new image
// shows immediately, then router.refresh() so the rest of the page
// (sidebar avatars, etc.) picks it up too.

export function PhotoUpload({
  employeeId,
  name,
  initialPhotoUrl,
}: {
  employeeId: string;
  name: string;
  initialPhotoUrl: string | null;
}) {
  const router = useRouter();
  const [photoUrl, setPhotoUrl] = React.useState<string | null>(initialPhotoUrl);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  async function upload(file: File) {
    setError(null);
    setPending(true);
    try {
      const fd = new FormData();
      fd.append("photo", file);
      const r = await fetch(`/api/employees/${employeeId}/photo`, {
        method: "POST",
        body: fd,
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `Upload failed (${r.status})`);
      }
      const j = (await r.json()) as { url: string };
      setPhotoUrl(j.url);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    setError(null);
    setPending(true);
    try {
      const r = await fetch(`/api/employees/${employeeId}/photo`, {
        method: "DELETE",
      });
      if (!r.ok) throw new Error(`Remove failed (${r.status})`);
      setPhotoUrl(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <Avatar name={name} size="lg" photoUrl={photoUrl} />
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => inputRef.current?.click()}
          >
            <Camera className="h-3.5 w-3.5" />
            {pending ? "Uploading…" : photoUrl ? "Change photo" : "Upload photo"}
          </Button>
          {photoUrl && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={remove}
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </Button>
          )}
        </div>
        <p className="text-[11px] text-text-muted leading-relaxed">
          PNG, JPEG, WebP or GIF · max 5 MB
        </p>
        {error && (
          <p className="inline-flex items-center gap-1.5 text-[11px] text-red-700">
            <AlertCircle className="h-3 w-3" />
            {error}
          </p>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          // reset value so the same file can be re-selected later
          e.target.value = "";
        }}
      />
    </div>
  );
}
