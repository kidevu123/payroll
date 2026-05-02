"use client";

import * as React from "react";
import { ImagePlus, Palette, RefreshCw, Star } from "lucide-react";
import type { CompanySettings } from "@/lib/settings/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wordmark } from "@/components/brand/wordmark";
import {
  regenerateIconsAction,
  updateBrandColorAction,
  uploadFaviconAction,
  uploadLogoAction,
} from "./actions";

export function BrandingForm({ company }: { company: CompanySettings }) {
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);
  const [color, setColor] = React.useState(company.brandColorHex);

  // Cache-bust the preview after upload by appending a version query.
  const [logoCacheBust, setLogoCacheBust] = React.useState(0);
  const [faviconCacheBust, setFaviconCacheBust] = React.useState(0);

  const previewLogoUrl = company.logoPath
    ? `${company.logoPath}${company.logoPath.includes("?") ? "&" : "?"}cb=${logoCacheBust}`
    : null;
  const previewFaviconUrl = company.faviconPath
    ? `${company.faviconPath}${company.faviconPath.includes("?") ? "&" : "?"}cb=${faviconCacheBust}`
    : null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Branding</h2>
        <p className="text-xs text-text-muted">
          Logo cascades to the sidebar, login page, payslip PDFs, and PWA app
          icon.
        </p>
      </div>
      <div className="space-y-6">
          <PreviewTile
            company={company}
            color={color}
            previewLogoUrl={previewLogoUrl}
          />

          <form
            action={async (form) => {
              setPending("logo");
              setError(null);
              const result = await uploadLogoAction(form);
              setPending(null);
              if (result?.error) setError(result.error);
              else setLogoCacheBust(Date.now());
            }}
            className="space-y-2 rounded-card border border-border bg-surface-2 p-4 shadow-sm"
          >
            <Label htmlFor="logo" className="font-medium flex items-center gap-2">
              <ImagePlus className="h-4 w-4" /> Logo (PNG, SVG, JPEG or WebP — max 2MB)
            </Label>
            <Input
              id="logo"
              name="logo"
              type="file"
              accept="image/png,image/svg+xml,image/jpeg,image/webp"
              required
            />
            <Button type="submit" size="sm" disabled={pending !== null}>
              {pending === "logo" ? "Uploading…" : "Upload logo"}
            </Button>
            {company.logoPath && !pending && (
              <p className="text-xs text-text-muted">
                A logo is already set. Uploading a new one replaces it and
                regenerates the PWA icons.
              </p>
            )}
          </form>

          <form
            action={async (form) => {
              setPending("favicon");
              setError(null);
              const result = await uploadFaviconAction(form);
              setPending(null);
              if (result?.error) setError(result.error);
              else setFaviconCacheBust(Date.now());
            }}
            className="space-y-2 rounded-card border border-border bg-surface-2 p-4 shadow-sm"
          >
            <Label htmlFor="favicon" className="font-medium flex items-center gap-2">
              <Star className="h-4 w-4" /> Favicon (PNG, ICO or SVG — max 256KB)
            </Label>
            <Input
              id="favicon"
              name="favicon"
              type="file"
              accept="image/png,image/x-icon,image/vnd.microsoft.icon,image/svg+xml"
              required
            />
            <Button type="submit" size="sm" disabled={pending !== null}>
              {pending === "favicon" ? "Uploading…" : "Upload favicon"}
            </Button>
            {previewFaviconUrl && (
              <div className="flex items-center gap-2 text-xs text-text-muted">
                Current:
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewFaviconUrl} alt="" className="h-4 w-4" />
              </div>
            )}
          </form>

          <form
            action={async (form) => {
              setPending("color");
              setError(null);
              const result = await updateBrandColorAction(form);
              setPending(null);
              if (result?.error) setError(result.error);
            }}
            className="space-y-2 rounded-card border border-border bg-surface-2 p-4 shadow-sm"
          >
            <Label htmlFor="brandColorHex" className="font-medium flex items-center gap-2">
              <Palette className="h-4 w-4" /> Brand color
            </Label>
            <div className="flex items-center gap-3">
              <Input
                id="brandColorHex"
                name="brandColorHex"
                type="color"
                defaultValue={company.brandColorHex}
                onChange={(e) => setColor(e.target.value)}
                className="h-10 w-20"
              />
              <code className="rounded-input bg-surface-3 px-2 py-1 font-mono text-xs">
                {color}
              </code>
            </div>
            <Button type="submit" size="sm" disabled={pending !== null}>
              {pending === "color" ? "Saving…" : "Save color"}
            </Button>
          </form>

          <div className="space-y-2 rounded-card border border-border bg-surface-2 p-4 shadow-sm">
            <Label className="font-medium">PWA app icons</Label>
            <p className="text-xs text-text-muted">
              Generated from the logo via sharp on every upload. If the OS
              install icon ever looks stale, regenerate manually.
            </p>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending !== null}
              onClick={async () => {
                setPending("icons");
                setError(null);
                const result = await regenerateIconsAction();
                setPending(null);
                if (result?.error) setError(result.error);
              }}
            >
              <RefreshCw className="h-4 w-4" />{" "}
              {pending === "icons" ? "Regenerating…" : "Regenerate PWA icons"}
            </Button>
          </div>

          {error && <p className="text-sm text-red-700">{error}</p>}
      </div>
    </div>
  );
}

function PreviewTile({
  company,
  color,
  previewLogoUrl,
}: {
  company: CompanySettings;
  color: string;
  previewLogoUrl: string | null;
}) {
  return (
    <div
      className="rounded-card overflow-hidden border border-border shadow-sm"
      style={{
        backgroundImage: `linear-gradient(135deg, ${color}, color-mix(in oklab, ${color} 100%, white 8%))`,
      }}
    >
      <div className="px-6 py-8 text-white flex items-center gap-4">
        <Wordmark
          name={company.name}
          logoPath={previewLogoUrl ?? company.logoPath}
          size="lg"
        />
      </div>
      <div className="bg-surface-2 px-6 py-3 text-xs text-text-muted">
        Live preview — sidebar header, login panel, and PDF cover use this
        composition.
      </div>
    </div>
  );
}
