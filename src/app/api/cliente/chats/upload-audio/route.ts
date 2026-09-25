import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canAccessClientModule, getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

const MAX_FILE_SIZE_BYTES = 16 * 1024 * 1024;
const ALLOWED_AUDIO_MIME_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/opus",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/wav",
  "audio/x-wav",
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

/*
  La extension importa, y mas de lo que parece.

  Una nota de voz grabada desde el CRM llega del navegador como `audio/mp4` (asi la entregan
  Safari y el iPhone). Se guardaba con extension `.mp4`, que para todo el mundo -WhatsApp
  incluido- significa VIDEO: al descargar ese audio y querer reenviarlo, WhatsApp contestaba "el
  archivo que intentaste añadir no es compatible", porque veia un video sin imagen (Alex,
  25-09-2026).

  El contenedor correcto para audio en MP4 es `.m4a`. Es el mismo archivo, con el nombre que
  corresponde, y con eso lo reconocen WhatsApp y cualquier reproductor.
*/
function getAudioExtension(mimeType: string) {
  if (mimeType.includes("ogg") || mimeType.includes("opus")) return ".ogg";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return ".mp3";
  if (mimeType.includes("mp4") || mimeType.includes("m4a") || mimeType.includes("aac")) return ".m4a";
  if (mimeType.includes("wav")) return ".wav";
  return ".webm";
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const access = await getClientWorkspaceAccessForUser(session.user.id);
  if (!access || !canAccessClientModule(access, "chats")) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 403 });
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership?.workspace.id) {
    return NextResponse.json({ ok: false, error: "Workspace no encontrado" }, { status: 404 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "No se recibio ningun archivo." }, { status: 400 });
  }

  const baseMimeType = file.type.split(";")[0].trim().toLowerCase();
  if (!ALLOWED_AUDIO_MIME_TYPES.has(baseMimeType)) {
    return NextResponse.json({ ok: false, error: `Formato de audio no permitido (${file.type || "desconocido"}).` }, { status: 400 });
  }

  if (file.size <= 0 || file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({ ok: false, error: "El audio debe pesar entre 1 byte y 16 MB." }, { status: 400 });
  }

  const uploadDir = path.join(process.cwd(), "public", "uploads", "chat-audio");
  await mkdir(uploadDir, { recursive: true });

  const ext = getAudioExtension(baseMimeType);
  const fileName = `${Date.now()}-${randomUUID()}${ext}`;
  const filePath = path.join(uploadDir, fileName);
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(filePath, bytes);

  const relativeUrl = `/uploads/chat-audio/${fileName}`;
  const baseUrl = getBaseUrl(request);

  return NextResponse.json({
    ok: true,
    url: baseUrl ? `${baseUrl}${relativeUrl}` : relativeUrl,
    relativeUrl,
  });
}
