import type { ZohoOrganization } from "@/lib/db/schema";
import { getZohoAccessToken } from "./client";

type WorkDriveUploadResponse = {
  data?: Array<{
    id?: string;
    attributes?: {
      resource_id?: string;
      parent_id?: string;
      name?: string;
    };
  }>;
  errors?: Array<{ id?: string; title?: string; detail?: string }>;
};

function workDriveBaseUrl(org: ZohoOrganization): string {
  try {
    const host = new URL(org.apiDomain).hostname;
    const suffix = host.replace(/^www\.zohoapis/, "");
    if (!suffix || suffix === ".com") return "https://workdrive.zoho.com";
    return `https://workdrive.zoho${suffix}`;
  } catch {
    return "https://workdrive.zoho.com";
  }
}

function extractFileId(json: WorkDriveUploadResponse): string | null {
  const first = json.data?.[0];
  return first?.attributes?.resource_id ?? first?.id ?? null;
}

function describeWorkDriveError(json: WorkDriveUploadResponse): string | null {
  const first = json.errors?.[0];
  if (!first) return null;
  return [first.id, first.title, first.detail].filter(Boolean).join(": ");
}

export async function uploadAdminReportToWorkDrive(args: {
  org: ZohoOrganization;
  folderId: string;
  filename: string;
  pdfBytes: Buffer;
}): Promise<{ fileId: string | null; raw: WorkDriveUploadResponse }> {
  const token = await getZohoAccessToken(args.org);
  const form = new FormData();
  form.set("parent_id", args.folderId);
  form.set("filename", args.filename);
  form.set("override-name-exist", "true");
  form.set(
    "content",
    new Blob([new Uint8Array(args.pdfBytes)], { type: "application/pdf" }),
    args.filename,
  );

  const resp = await fetch(`${workDriveBaseUrl(args.org)}/api/v1/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: form,
  });
  const text = await resp.text();
  let json: WorkDriveUploadResponse;
  try {
    json = JSON.parse(text) as WorkDriveUploadResponse;
  } catch {
    json = {};
  }
  if (!resp.ok) {
    const detail = describeWorkDriveError(json) ?? text.slice(0, 500);
    throw new Error(`WorkDrive upload failed: ${resp.status} ${detail}`);
  }
  const fileId = extractFileId(json);
  if (!fileId) {
    throw new Error(`WorkDrive upload returned no file id: ${text.slice(0, 500)}`);
  }
  return { fileId, raw: json };
}

export async function testWorkDriveUploadScope(
  org: ZohoOrganization,
): Promise<{ ok: boolean; message: string }> {
  try {
    await getZohoAccessToken(org);
    const resp = await fetch(`${workDriveBaseUrl(org)}/api/v1/upload`, {
      method: "OPTIONS",
    });
    if (resp.status < 500) {
      return {
        ok: true,
        message: "WorkDrive API reachable; upload permission is verified by the backup job.",
      };
    }
    return { ok: false, message: `WorkDrive API returned ${resp.status}.` };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
