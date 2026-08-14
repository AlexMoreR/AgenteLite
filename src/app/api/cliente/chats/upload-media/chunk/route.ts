import { appendFile, mkdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canAccessClientModule, getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import {
  ALLOWED_MIME_TYPES,
  CHAT_MEDIA_DIR,
  CHAT_MEDIA_TMP_DIR,
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_MB,
  getBaseUrl,
  getExtensionForMime,
  resolveMediaType,
  sanitizeUploadId,
} from "@/lib/chat-upload";

/**
 * SUBIDA POR PEDAZOS.
 *
 * Existe por un numero medido el 14-ago-2026: con la señal de un celular en la calle (14-32 KB/s)
 * un catalogo de 15 MB tarda entre 8 y 18 minutos en subir, y una peticion tan larga no llega a
 * terminar. Se cortaba sin dejar rastro —ni archivo, ni fila, ni linea de log— y el chat decia
 * "No se pudo enviar", que mandaba a buscar el problema al gateway, al numero o al archivo.
 *
 * Partido en trozos de ~1 MB, cada peticion dura segundos: ninguna vive lo suficiente como para
 * que la corten. Y si la señal se cae, se reintenta SOLO ese trozo en vez de los 15 MB.
 *
 * El archivo llega intacto: no se recomprime nada. Era la condicion, porque un catalogo con las
 * fotos machacadas vende menos que uno que tarda.
 */
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
  const chunk = formData?.get("chunk");
  const uploadId = sanitizeUploadId(formData?.get("uploadId"));
  const indice = Number(formData?.get("index"));
  const total = Number(formData?.get("total"));
  const nombreOriginal = String(formData?.get("fileName") ?? "").trim();
  const mimeDeclarado = String(formData?.get("mimeType") ?? "").split(";")[0].trim().toLowerCase();

  if (!(chunk instanceof File) || !uploadId || !Number.isInteger(indice) || !Number.isInteger(total) || total < 1) {
    return NextResponse.json({ ok: false, error: "Pedido invalido." }, { status: 400 });
  }

  if (!ALLOWED_MIME_TYPES.has(mimeDeclarado)) {
    return NextResponse.json(
      { ok: false, error: `Formato no permitido (${mimeDeclarado || "desconocido"}).` },
      { status: 400 },
    );
  }

  const tmpDir = path.join(process.cwd(), ...CHAT_MEDIA_TMP_DIR);
  await mkdir(tmpDir, { recursive: true });
  const parcial = path.join(tmpDir, `${uploadId}.part`);

  // El trozo 0 arranca de cero: si un intento anterior quedo a medias, reintentar desde el
  // principio tiene que empezar limpio y no pegarse atras de la basura del intento fallido.
  if (indice === 0) {
    await unlink(parcial).catch(() => {});
  }

  const bytes = Buffer.from(await chunk.arrayBuffer());
  await appendFile(parcial, bytes);

  const acumulado = await stat(parcial).then((info) => info.size).catch(() => 0);
  if (acumulado > MAX_FILE_SIZE_BYTES) {
    await unlink(parcial).catch(() => {});
    return NextResponse.json(
      { ok: false, error: `El archivo supera los ${MAX_FILE_SIZE_MB} MB.` },
      { status: 400 },
    );
  }

  // Todavia faltan trozos: se avisa cuanto va para que la pantalla pueda mostrar el avance.
  if (indice < total - 1) {
    return NextResponse.json({ ok: true, recibido: indice, bytes: acumulado });
  }

  const uploadDir = path.join(process.cwd(), ...CHAT_MEDIA_DIR);
  await mkdir(uploadDir, { recursive: true });

  const ext = getExtensionForMime(mimeDeclarado, nombreOriginal);
  const fileName = `${Date.now()}-${randomUUID()}${ext}`;
  // rename y no copiar: mover dentro del mismo volumen es instantaneo y no duplica 15 MB en
  // disco, que en este servidor (93% ocupado) importa.
  await rename(parcial, path.join(uploadDir, fileName));

  const relativeUrl = `/uploads/chat-media/${fileName}`;
  const baseUrl = getBaseUrl(request);

  return NextResponse.json({
    ok: true,
    completo: true,
    url: baseUrl ? `${baseUrl}${relativeUrl}` : relativeUrl,
    relativeUrl,
    fileName: nombreOriginal || fileName,
    mimeType: mimeDeclarado,
    mediaType: resolveMediaType(mimeDeclarado),
  });
}
