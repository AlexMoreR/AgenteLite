import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canAccessClientModule, getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

// 100 MB es el tope de WhatsApp para documentos: por encima de eso no lo recibe ni el cliente,
// asi que no tiene sentido aceptarlo. Estaba en 25 y un catalogo en PDF lo pasa sin esfuerzo.
//
// OJO si esto se sube mas: el archivo se lee ENTERO en memoria mas abajo (file.arrayBuffer), y
// este servidor ya se queda sin RAM —el kernel viene matando Postgres por eso—. Subir el numero
// sin pasar a escritura por partes es pedirle al servidor que se caiga con el archivo mas grande.
const MAX_FILE_SIZE_MB = 100;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "application/pdf",
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

function getExtensionForMime(mimeType: string, originalName: string) {
  const fromName = path.extname(originalName).toLowerCase();
  if (fromName) return fromName === ".jpeg" ? ".jpg" : fromName;
  if (mimeType.includes("png")) return ".png";
  if (mimeType.includes("webp")) return ".webp";
  if (mimeType.includes("gif")) return ".gif";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return ".jpg";
  if (mimeType.includes("quicktime")) return ".mov";
  if (mimeType.includes("webm")) return ".webm";
  if (mimeType.includes("mp4")) return ".mp4";
  if (mimeType.includes("pdf")) return ".pdf";
  return ".bin";
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
  if (!ALLOWED_MIME_TYPES.has(baseMimeType)) {
    return NextResponse.json({ ok: false, error: `Formato no permitido (${file.type || "desconocido"}).` }, { status: 400 });
  }

  if (file.size <= 0 || file.size > MAX_FILE_SIZE_BYTES) {
    // El peso real en el mensaje, no solo el limite: "no se pudo enviar" mandaba a revisar el
    // chat, el numero y el gateway cuando el problema estaba en el archivo que uno tenia en la
    // mano. Un error que no dice el motivo cuesta una mañana de trabajo.
    const pesa = Math.max(1, Math.round(file.size / (1024 * 1024)));
    return NextResponse.json(
      {
        ok: false,
        error:
          file.size <= 0
            ? "El archivo está vacío."
            : `El archivo pesa ${pesa} MB y el máximo es ${MAX_FILE_SIZE_MB} MB.`,
      },
      { status: 400 },
    );
  }

  const uploadDir = path.join(process.cwd(), "public", "uploads", "chat-media");
  await mkdir(uploadDir, { recursive: true });

  const ext = getExtensionForMime(baseMimeType, file.name);
  const fileName = `${Date.now()}-${randomUUID()}${ext}`;
  const filePath = path.join(uploadDir, fileName);
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(filePath, bytes);

  const relativeUrl = `/uploads/chat-media/${fileName}`;
  const baseUrl = getBaseUrl(request);

  const mediaType = baseMimeType.startsWith("image/")
    ? "IMAGE"
    : baseMimeType.startsWith("video/")
      ? "VIDEO"
      : "DOCUMENT";

  return NextResponse.json({
    ok: true,
    url: baseUrl ? `${baseUrl}${relativeUrl}` : relativeUrl,
    relativeUrl,
    fileName: file.name || fileName,
    mimeType: baseMimeType,
    mediaType,
  });
}
