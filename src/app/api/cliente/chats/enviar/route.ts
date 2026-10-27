import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sendUnifiedChatReplyAction } from "@/app/actions/chats-actions";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import { gatewayDeLaLinea } from "@/lib/evolution";
import { registrarErrorDeEnvio } from "@/lib/chat-errores-de-envio";
import {
  clasificarMotivo,
  crearCandadoDeEnvios,
  idDeMensajeValido,
  type MotivoDeFalla,
} from "@/lib/chat-envio-reintento";

/*
  Envio de TEXTO del chat por una ruta normal (queja de las asesoras, 27-oct-2026: "a cada rato al
  enviar sale error y toca recargar").

  Antes el texto iba por una accion del servidor de Next.js. Al subir una version nueva, las
  pestañas abiertas con la version vieja ya no encontraban la accion ("Failed to find Server
  Action"): el envio fallaba y Reintentar fallaba igual hasta recargar. Una ruta normal no se
  rompe con las subidas.

  Por dentro llama a la MISMA funcion de envio de siempre (firma, control del chat equivocado,
  respuestas rapidas, modo monitoreo), y le suma:
  - Numero unico por mensaje (clientMessageId): si ya esta guardado o el mismo envio sigue en
    curso, NO se manda otra vez a WhatsApp ("ya enviado").
  - Registro de cada error de envio (tabla ChatSendError) para medirlos.
  No manda nada por su cuenta: solo envia lo que la asesora escribio, una vez.
*/

export const maxDuration = 60;

type Respuesta = {
  ok: boolean;
  error?: string;
  motivo?: MotivoDeFalla;
  suppressOptimistic?: boolean;
  yaEnviado?: boolean;
};

const candado = crearCandadoDeEnvios<Respuesta>();

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor : "";
}

async function yaEstaGuardado(input: {
  source: string;
  workspaceId: string;
  conversationId: string;
  clientMessageId: string;
}): Promise<boolean> {
  try {
    if (input.source === "official") {
      const filas = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT m."id"
        FROM "OfficialApiMessage" m
        WHERE m."conversationId" = ${input.conversationId}
          AND m."direction" = 'OUTBOUND'::"OfficialApiMessageDirection"
          AND m."rawPayload"->>'clientMessageId' = ${input.clientMessageId}
        LIMIT 1
      `;
      return filas.length > 0;
    }
    const guardado = await prisma.message.findFirst({
      where: {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        direction: "OUTBOUND",
        rawPayload: { path: ["clientMessageId"], equals: input.clientMessageId },
      },
      select: { id: true },
    });
    return Boolean(guardado);
  } catch {
    // Si no se puede comprobar, se sigue: es mejor intentar el envio que dejar sin respuesta.
    return false;
  }
}

async function datosDeLaLinea(source: string, conversationId: string, workspaceId: string) {
  try {
    if (source === "official") {
      return { lineaId: null, lineaNombre: "API oficial", gateway: "OFFICIAL" };
    }
    const conversacion = await prisma.conversation.findFirst({
      where: { id: conversationId, workspaceId },
      select: { channel: { select: { id: true, name: true, evolutionInstanceName: true } } },
    });
    const canal = conversacion?.channel;
    if (!canal) {
      return { lineaId: null, lineaNombre: null, gateway: null };
    }
    return {
      lineaId: canal.id,
      lineaNombre: canal.name,
      gateway: canal.evolutionInstanceName ? await gatewayDeLaLinea(canal.evolutionInstanceName) : null,
    };
  } catch {
    return { lineaId: null, lineaNombre: null, gateway: null };
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json<Respuesta>(
      { ok: false, error: "Tu sesión venció. Recarga la página para volver a entrar.", motivo: "sin_sesion" },
      { status: 401 },
    );
  }

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json<Respuesta>({ ok: false, error: "Datos inválidos", motivo: "otro" }, { status: 400 });
  }

  const source = texto(cuerpo.source) === "official" ? "official" : "agent";
  const conversationId = texto(cuerpo.conversationId);
  const clientMessageId = idDeMensajeValido(texto(cuerpo.clientMessageId));
  const intento = Math.max(1, Math.min(Number(cuerpo.intento) || 1, 9));

  const membership = await getPrimaryWorkspaceForUser(session.user.id).catch(() => null);
  const workspaceId = membership?.workspace.id ?? null;

  const formData = new FormData();
  for (const [nombre, valor] of Object.entries(cuerpo)) {
    if (typeof valor === "string") {
      formData.set(nombre, valor);
    }
  }
  formData.set("source", source);
  if (clientMessageId) {
    formData.set("clientMessageId", clientMessageId);
  }

  const enviar = async (): Promise<Respuesta> => {
    if (clientMessageId && workspaceId && conversationId) {
      const guardado = await yaEstaGuardado({ source, workspaceId, conversationId, clientMessageId });
      if (guardado) {
        return { ok: true, yaEnviado: true, suppressOptimistic: false };
      }
    }

    let error: string | null = null;
    try {
      const resultado = await sendUnifiedChatReplyAction(formData);
      if (resultado.ok) {
        return { ok: true, suppressOptimistic: resultado.suppressOptimistic };
      }
      error = resultado.error;
    } catch (excepcion) {
      // redirect("/unauthorized") u otra excepcion de la accion: se responde como error normal.
      const digest = (excepcion as { digest?: string } | null)?.digest ?? "";
      error = digest.startsWith("NEXT_REDIRECT")
        ? "No autorizado"
        : excepcion instanceof Error
          ? excepcion.message || "No se pudo enviar el mensaje"
          : "No se pudo enviar el mensaje";
    }

    const motivo = clasificarMotivo(error);
    if (workspaceId) {
      const linea = await datosDeLaLinea(source, conversationId, workspaceId);
      await registrarErrorDeEnvio({
        workspaceId,
        conversationId: conversationId || null,
        ...linea,
        motivo,
        detalle: error,
        clientMessageId,
        userId: session.user.id,
        intento,
        origen: "servidor",
      });
    }
    return { ok: false, error: error ?? "No se pudo enviar el mensaje", motivo };
  };

  // Mismo numero unico a la vez: comparten UN solo envio. Solo se recuerdan los que salieron.
  const respuesta = clientMessageId
    ? await candado.ejecutar(clientMessageId, enviar, (valor) => valor.ok)
    : await enviar();

  // Los que se comparten con otra llamada ya salieron: se avisa "ya enviado" a la segunda.
  return NextResponse.json<Respuesta>(respuesta, { status: 200 });
}
