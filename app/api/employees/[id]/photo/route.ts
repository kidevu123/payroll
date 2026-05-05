// Employee profile photo — GET serves the stored file, POST accepts
// a multipart upload from the employee themselves (or an admin).
//
// Storage layout: /data/uploads/photos/<employee-id>.<ext>. We
// overwrite on every upload so there's only ever one file per
// employee. Path is recorded on employees.photo_path so future
// renderers can find it without scanning disk.

import { NextResponse } from "next/server";
import { mkdir, writeFile, readFile, stat, unlink } from "node:fs/promises";
import { join, extname } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees } from "@/lib/db/schema";
import { requireSession } from "@/lib/auth-guards";
import { writeAudit } from "@/lib/db/audit";

const STORAGE_ROOT = process.env.STORAGE_ROOT ?? "/data";
const PHOTO_DIR = join(STORAGE_ROOT, "uploads", "photos");
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const [emp] = await db
    .select({ photoPath: employees.photoPath })
    .from(employees)
    .where(eq(employees.id, id));
  if (!emp?.photoPath) return new NextResponse("not found", { status: 404 });
  let bytes: Buffer;
  try {
    bytes = await readFile(emp.photoPath);
  } catch {
    return new NextResponse("file missing", { status: 410 });
  }
  const ext = extname(emp.photoPath).toLowerCase();
  const mime =
    Object.entries(ALLOWED_MIME).find(([, e]) => e === ext)?.[0] ??
    "application/octet-stream";
  const st = await stat(emp.photoPath).catch(() => null);
  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": mime,
      // Cache the photo by mtime so a re-upload busts immediately
      // (the URL we hand out includes ?v=mtime).
      "Cache-Control": "private, max-age=300",
      ETag: `"${st?.mtimeMs ?? "0"}"`,
    },
  });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await requireSession();
  const { id } = await ctx.params;
  // Employees can update their own photo; admins can update anyone's.
  // Anything else is a 403.
  const isSelf = session.user.employeeId === id;
  const isAdmin =
    session.user.role === "OWNER" ||
    session.user.role === "ADMIN" ||
    session.user.role === "PAYROLL_STAFF";
  if (!isSelf && !isAdmin) {
    return new NextResponse("forbidden", { status: 403 });
  }

  const form = await req.formData();
  const file = form.get("photo");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing photo file." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (${file.size} bytes; max ${MAX_BYTES}).` },
      { status: 413 },
    );
  }
  const ext = ALLOWED_MIME[file.type];
  if (!ext) {
    return NextResponse.json(
      { error: `Unsupported type ${file.type}. Use PNG, JPEG, WebP or GIF.` },
      { status: 415 },
    );
  }

  await mkdir(PHOTO_DIR, { recursive: true });
  // Sweep any prior file with a different extension so we don't end
  // up with both photos/foo.png and photos/foo.jpg.
  for (const e of Object.values(ALLOWED_MIME)) {
    if (e === ext) continue;
    await unlink(join(PHOTO_DIR, `${id}${e}`)).catch(() => {});
  }
  const path = join(PHOTO_DIR, `${id}${ext}`);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path, buffer);

  const [before] = await db
    .select({ photoPath: employees.photoPath })
    .from(employees)
    .where(eq(employees.id, id));
  await db.update(employees).set({ photoPath: path }).where(eq(employees.id, id));
  await writeAudit({
    actorId: session.user.id,
    actorRole: session.user.role,
    action: "employee.photo.update",
    targetType: "Employee",
    targetId: id,
    before: { photoPath: before?.photoPath ?? null },
    after: { photoPath: path },
  });

  return NextResponse.json({
    ok: true,
    url: `/api/employees/${id}/photo?v=${Date.now()}`,
  });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await requireSession();
  const { id } = await ctx.params;
  const isSelf = session.user.employeeId === id;
  const isAdmin =
    session.user.role === "OWNER" ||
    session.user.role === "ADMIN" ||
    session.user.role === "PAYROLL_STAFF";
  if (!isSelf && !isAdmin) {
    return new NextResponse("forbidden", { status: 403 });
  }
  const [emp] = await db
    .select({ photoPath: employees.photoPath })
    .from(employees)
    .where(eq(employees.id, id));
  if (emp?.photoPath) {
    await unlink(emp.photoPath).catch(() => {});
  }
  await db.update(employees).set({ photoPath: null }).where(eq(employees.id, id));
  await writeAudit({
    actorId: session.user.id,
    actorRole: session.user.role,
    action: "employee.photo.remove",
    targetType: "Employee",
    targetId: id,
    before: { photoPath: emp?.photoPath ?? null },
    after: { photoPath: null },
  });
  return NextResponse.json({ ok: true });
}
