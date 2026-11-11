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
import { indiceDePedazoValido, recibirPedazo } from "@/lib/chat-upload-pedazos";

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
 * Esta ruta no recomprime nada: guarda el archivo tal como llega. PDF, documentos y la Biblioteca
 * llegan intactos, porque un catalogo con las fotos machacadas vende menos que uno que tarda. Las
 * fotos sueltas del compositor de Chats si llegan achicadas (1600 px, unos 400 KB): las achica el
 * compositor antes de subirlas (`src/lib/comprimir-foto.ts`), no esta ruta.
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

  // El indice forma parte de una ruta de archivo: fuera de 0..total-1 se rechaza antes de tocar el disco.
  if (!(chunk instanceof File) || !uploadId || !indiceDePedazoValido(indice, total)) {
    return NextResponse.json({ ok: false, error: "Pedido invalido." }, { status: 400 });
  }

  if (!ALLOWED_MIME_TYPES.has(mimeDeclarado)) {
    return NextResponse.json(
      { ok: false, error: `Formato no permitido (${mimeDeclarado || "desconocido"}).` },
      { status: 400 },
    );
  }

  const tmpDir = path.join(process.cwd(), ...CHAT_MEDIA_TMP_DIR);
  const uploadDir = path.join(process.cwd(), ...CHAT_MEDIA_DIR);
  const ext = getExtensionForMime(mimeDeclarado, nombreOriginal);
  const fileName = `${Date.now()}-${randomUUID()}${ext}`;

  // Cada pedazo se guarda aparte y el archivo se arma con el ultimo, comprobando que esten todos
  // (ver chat-upload-pedazos). Asi se pueden mandar varios a la vez sin desordenar el archivo.
  let resultado;
  try {
    resultado = await recibirPedazo({
      tmpDir,
      destinoDir: uploadDir,
      uploadId,
      indice,
      total,
      datos: Buffer.from(await chunk.arrayBuffer()),
      maxBytes: MAX_FILE_SIZE_BYTES,
      maxMb: MAX_FILE_SIZE_MB,
      nombreFinal: fileName,
    });
  } catch (error) {
    console.error("[chat-upload] no se pudo guardar un pedazo", {
      uploadId,
      indice,
      total,
      motivo: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ ok: false, error: "No se pudo guardar el archivo. Vuelve a enviarlo." }, { status: 500 });
  }

  if (resultado.estado === "error") {
    return NextResponse.json({ ok: false, error: resultado.error }, { status: resultado.status });
  }

  // Todavia faltan trozos: se avisa cuanto va para que la pantalla pueda mostrar el avance.
  if (resultado.estado === "guardado") {
    return NextResponse.json({ ok: true, recibido: resultado.recibido, bytes: resultado.bytes });
  }

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
