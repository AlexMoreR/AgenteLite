import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canAccessOfficialApiModule } from "@/lib/admin-module-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
]);

function getBaseUrl(request: Request) {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = request.headers.get("host")?.trim();

  if (forwardedHost) {
    return `${forwardedProto || "https"}://${forwardedHost}`;
  }

  if (host) {
    const protocol = forwardedProto || (host.includes("localhost") ? "http" : "https");
    return `${protocol}://${host}`;
  }

  return process.env.NEXT_PUBLIC_APP_URL?.trim() || "";
}

function getSafeImageExtension(fileName: string) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".jpeg" || ext === ".jpg") {
    return ".jpg";
  }
  if (ext === ".png") {
    return ".png";
  }
  if (ext === ".webp") {
    return ".webp";
  }
  if (ext === ".gif") {
    return ".gif";
  }
  if (ext === ".bmp") {
    return ".bmp";
  }
  return ".jpg";
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  if (!(await canAccessOfficialApiModule(session.user.id, session.user.role))) {
    return NextResponse.json({ ok: false, error: "Modulo desactivado para este rol." }, { status: 403 });
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership?.workspace.id) {
    return NextResponse.json({ ok: false, error: "Workspace no encontrado" }, { status: 404 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("image");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "No se recibio ninguna imagen." }, { status: 400 });
  }

  if (!ALLOWED_IMAGE_MIME_TYPES.has(file.type)) {
    return NextResponse.json({ ok: false, error: "Formato no permitido. Usa JPG, PNG, WEBP, GIF o BMP." }, { status: 400 });
  }

  if (file.size <= 0 || file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({ ok: false, error: "La imagen debe pesar entre 1 byte y 8 MB." }, { status: 400 });
  }

  const uploadDir = path.join(process.cwd(), "public", "uploads", "official-api-chatbot");
  await mkdir(uploadDir, { recursive: true });

  const ext = getSafeImageExtension(file.name);
  const fileName = `${Date.now()}-${randomUUID()}${ext}`;
  const filePath = path.join(uploadDir, fileName);
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(filePath, bytes);

  const relativeUrl = `/uploads/official-api-chatbot/${fileName}`;
  const baseUrl = getBaseUrl(request);

  return NextResponse.json({
    ok: true,
    url: baseUrl ? `${baseUrl}${relativeUrl}` : relativeUrl,
    relativeUrl,
  });
}
