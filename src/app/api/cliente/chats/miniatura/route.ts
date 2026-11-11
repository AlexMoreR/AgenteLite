import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { getVisibleChannelIds } from "@/lib/channel-visibility";
import { canAccessClientModule, getClientWorkspaceAccessForUserCached } from "@/lib/client-workspace-access";
import { bytesDeLaMiniatura } from "@/lib/miniaturas-aparte";
import { prisma } from "@/lib/prisma";

/**
 * Una miniatura que venia adentro del mensaje (vista previa de un enlace, poster de un video, foto o
 * anuncio), servida aparte. Ver lib/miniaturas-aparte.ts: el cargador de mensajes la cambia por esta
 * direccion y el navegador la baja solo si la muestra.
 *
 * Postgres devuelve SOLO ese pedazo del mensaje (`#>`), no el crudo entero. La miniatura de un mensaje
 * no cambia nunca: se guarda un año en el navegador. Mismos permisos que la bandeja: del negocio y de
 * una linea que quien pide puede ver.
 */
export const dynamic = "force-dynamic";

const SEGMENTO_VALIDO = /^[A-Za-z0-9_-]{1,64}$/;

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse(null, { status: 401 });
  }
  const access = await getClientWorkspaceAccessForUserCached(session.user.id);
  if (!access || !canAccessClientModule(access, "chats")) {
    return new NextResponse(null, { status: 403 });
  }

  const url = new URL(request.url);
  const messageId = url.searchParams.get("m")?.trim() ?? "";
  const ruta = (url.searchParams.get("r") ?? "").split(".").filter(Boolean);
  const ultima = ruta[ruta.length - 1] ?? "";
  if (
    !messageId ||
    ruta.length === 0 ||
    ruta.length > 11 ||
    !ruta.every((segmento) => SEGMENTO_VALIDO.test(segmento)) ||
    !["jpegThumbnail", "JPEGThumbnail", "thumbnail"].includes(ultima)
  ) {
    return new NextResponse(null, { status: 400 });
  }

  const [fila] = await prisma.$queryRaw<Array<{ channelId: string | null; miniatura: unknown }>>`
    SELECT "channelId", ("rawPayload" #> ${ruta}::text[]) AS "miniatura"
    FROM "Message"
    WHERE "id" = ${messageId} AND "workspaceId" = ${access.workspaceId}
    LIMIT 1
  `;
  if (!fila || fila.miniatura === null || fila.miniatura === undefined) {
    return new NextResponse(null, { status: 404 });
  }

  const canalesVisibles = await getVisibleChannelIds({
    workspaceId: access.workspaceId,
    userId: session.user.id,
    esJefe: access.isOwner || access.role === "ADMIN",
  });
  if (canalesVisibles && (!fila.channelId || !canalesVisibles.includes(fila.channelId))) {
    return new NextResponse(null, { status: 404 });
  }

  const bytes = bytesDeLaMiniatura(fila.miniatura);
  if (!bytes) {
    return new NextResponse(null, { status: 404 });
  }
  const cuerpo = typeof bytes === "string" ? Buffer.from(bytes, "base64") : Buffer.from(bytes);
  return new NextResponse(new Uint8Array(cuerpo), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Length": String(cuerpo.length),
    },
  });
}
