import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sendUnifiedChatReplyAction } from "@/app/actions/chats-actions";
import {
  clasificarFalloDeEnvio,
  idDeEnvioValido,
  soltarCandadoDeEnvio,
  tomarCandadoDeEnvio,
} from "@/lib/chat-envio-reintento";
import { anotarErrorDeEnvio, datosDeLineaDelChat } from "@/lib/chat-errores-de-envio";
import { prisma } from "@/lib/prisma";
import { getOfficialApiConfigByWorkspaceId } from "@/lib/official-api-config";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

export const dynamic = "force-dynamic";
// El gateway tiene 25 s de tiempo limite; con un reintento interno de conexion cabe holgado.
export const maxDuration = 90;

/*
  Envio de TEXTO de Chats por una ruta normal del servidor.

  Antes el texto iba por una "accion del servidor" de Next.js: al subir una version nueva, las
  pestañas abiertas con la version vieja ya no la encontraban ("Failed to find Server Action") y el
  envio fallaba hasta recargar. Esta ruta (POST /api/cliente/chats/enviar) no depende de la version.

  Por dentro llama a la MISMA funcion de envio de siempre (sendUnifiedChatReplyAction), asi que la
  firma, el control de chat equivocado y las respuestas rapidas no cambian.

  Numero unico (`clientMessageId`): si el servidor ya tiene un mensaje con ese numero, o el mismo
  envio sigue en curso, contesta "ya enviado" y NO vuelve a mandarlo a WhatsApp.
*/

type Respuesta = {
  ok: boolean;
  error?: string;
  suppressOptimistic?: boolean;
  yaEnviado?: boolean;
  motivo?: string;
  reintentable?: boolean;
};

function responder(cuerpo: Respuesta, status = 200) {
  return NextResponse.json(cuerpo, { status, headers: { "Cache-Control": "no-store" } });
}

/** Un mensaje con este numero unico ya esta guardado en el negocio. */
async function yaEstaGuardado(input: {
  source: string;
  workspaceId: string;
  clientMessageId: string;
}): Promise<boolean> {
  try {
    if (input.source === "official") {
      const config = await getOfficialApiConfigByWorkspaceId(input.workspaceId);
      if (!config) {
        return false;
      }
      const filas = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "OfficialApiMessage"
        WHERE "configId" = ${config.id}
          AND "rawPayload"->>'clientMessageId' = ${input.clientMessageId}
        LIMIT 1
      `;
      return filas.length > 0;
    }
    const existente = await prisma.message.findFirst({
      where: {
        workspaceId: input.workspaceId,
        rawPayload: { path: ["clientMessageId"], equals: input.clientMessageId },
      },
      select: { id: true },
    });
    return Boolean(existente);
  } catch {
    // Si la consulta falla no se frena el envio: el candado en memoria sigue cubriendo el doble clic.
    return false;
  }
}

function esRedireccion(error: unknown) {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return responder({ ok: false, error: "No autorizado", motivo: "sesion", reintentable: false }, 401);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return responder({ ok: false, error: "No se pudo enviar el mensaje", motivo: "otro", reintentable: false }, 400);
  }

  const membership = await getPrimaryWorkspaceForUser(userId);
  const workspaceId = membership?.workspace.id;
  if (!workspaceId) {
    return responder({ ok: false, error: "Workspace no encontrado", motivo: "otro", reintentable: false });
  }

  const source = formData.get("source") === "official" ? "official" : "agent";
  const conversationId = String(formData.get("conversationId") ?? "");
  const clientMessageId = idDeEnvioValido(formData.get("clientMessageId"));
  const intento = Number(formData.get("intento") ?? 1) || 1;

  let clave: string | null = null;
  if (clientMessageId) {
    if (await yaEstaGuardado({ source, workspaceId, clientMessageId })) {
      return responder({ ok: true, yaEnviado: true, suppressOptimistic: true });
    }
    clave = `${userId}:${clientMessageId}`;
    if (!tomarCandadoDeEnvio(clave)) {
      // El mismo envio sigue en camino: no se manda otra vez, el original dira como termino.
      return responder({ ok: true, yaEnviado: true });
    }
  }

  try {
    const resultado = await sendUnifiedChatReplyAction(formData);
    if (resultado.ok !== false) {
      return responder({ ok: true, suppressOptimistic: resultado.suppressOptimistic });
    }

    const error = resultado.error ?? "No se pudo enviar el mensaje";
    const fallo = clasificarFalloDeEnvio({ error });
    await anotarErrorDeEnvio({
      workspaceId,
      conversationId,
      linea: await datosDeLineaDelChat({ source, conversationId, workspaceId }),
      motivo: fallo.motivo,
      detalle: error,
      clientMessageId,
      userId,
      intento,
      origen: "servidor",
    });
    return responder({ ok: false, error, motivo: fallo.motivo, reintentable: fallo.reintentable });
  } catch (error) {
    if (esRedireccion(error)) {
      return responder({ ok: false, error: "No autorizado", motivo: "sesion", reintentable: false }, 401);
    }
    const detalle = error instanceof Error ? error.message : String(error);
    const fallo = clasificarFalloDeEnvio({ error: detalle });
    await anotarErrorDeEnvio({
      workspaceId,
      conversationId,
      linea: await datosDeLineaDelChat({ source, conversationId, workspaceId }),
      motivo: fallo.motivo,
      detalle,
      clientMessageId,
      userId,
      intento,
      origen: "servidor",
    });
    return responder({
      ok: false,
      error: "No se pudo enviar el mensaje",
      motivo: fallo.motivo,
      reintentable: fallo.reintentable,
    });
  } finally {
    if (clave) {
      soltarCandadoDeEnvio(clave);
    }
  }
}
