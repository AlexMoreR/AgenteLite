import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

// Subida de foto de perfil. Disponible para CUALQUIER usuario autenticado (dueno o
// empleado): la foto de perfil no depende de modulos. Solo imagenes, hasta 8 MB.
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function getSafeImageExtension(fileName: string, mime: string) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg" || mime === "image/jpeg" || mime === "image/jpg") return ".jpg";
  if (ext === ".png" || mime === "image/png") return ".png";
  if (ext === ".webp" || mime === "image/webp") return ".webp";
  if (ext === ".gif" || mime === "image/gif") return ".gif";
  return ".jpg";
}

function getBaseUrl(request: Request) {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = request.headers.get("host")?.trim();
  if (forwardedHost) return `${forwardedProto || "https"}://${forwardedHost}`;
  if (host) return `${forwardedProto || (host.includes("localhost") ? "http" : "https")}://${host}`;
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || "";
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file") ?? formData?.get("image");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "No se recibio ninguna imagen." }, { status: 400 });
  }

  if (!ALLOWED_IMAGE_MIME_TYPES.has(file.type)) {
    return NextResponse.json({ ok: false, error: "Solo se permiten imagenes (JPG, PNG, WEBP o GIF)." }, { status: 400 });
  }

  if (file.size <= 0 || file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({ ok: false, error: "La imagen debe pesar entre 1 byte y 8 MB." }, { status: 400 });
  }

  const uploadDir = path.join(process.cwd(), "public", "uploads", "profile-photos");
  await mkdir(uploadDir, { recursive: true });

  const ext = getSafeImageExtension(file.name, file.type);
  const fileName = `${session.user.id}-${Date.now()}-${randomUUID()}${ext}`;
  const filePath = path.join(uploadDir, fileName);
  await writeFile(filePath, Buffer.from(await file.arrayBuffer()));

  const relativeUrl = `/uploads/profile-photos/${fileName}`;
  const baseUrl = getBaseUrl(request);

  return NextResponse.json({
    ok: true,
    url: baseUrl ? `${baseUrl}${relativeUrl}` : relativeUrl,
    relativeUrl,
  });
}
