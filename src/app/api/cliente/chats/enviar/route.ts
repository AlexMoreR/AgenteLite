import { NextResponse, after } from "next/server";
import { auth } from "@/auth";
import { sendUnifiedChatReplyAction } from "@/app/actions/chats-actions";
import type { SendChatReplyResult } from "@/app/actions/agent-actions";
import { canAccessClientModule, getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { idDeMensajeValido, motivoSeReintentaSolo, type MotivoDeFallo } from "@/lib/chat-envio-reintento";
import { anotarErrorDeEnvio } from "@/lib/chat-errores-de-envio";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

/*
  Envio de texto de las asesoras desde Chats (tarjeta whovymqk).

  Antes el texto iba por una "accion del servidor" de Next.js. Despues de cada subida, las pestañas
  abiertas con la version vieja ya no la encontraban ("Failed to find Server Action"): el envio
  fallaba, Reintentar fallaba igual y habia que recargar. Una ruta normal no cambia entre versiones.

  Por dentro llama a la MISMA funcion de siempre (sendUnifiedChatReplyAction): firma, control de
  chat equivocado, modo monitoreo y respuestas rapidas siguen iguales.

  Numero unico (clientMessageId): si el mismo mensaje llega otra vez mientras el primero sigue en
  camino, este espera a ese y contesta lo mismo, sin mandarlo de nuevo (como las notas de voz). Si
  ya se guardo, lo frena la accion mirando la base.

  Cada fallo se anota en ChatSendError (linea, hora, motivo) para medir.
*/

type Respuesta =
  | { ok: true; repetido?: boolean; suppressOptimistic?: boolean }
  | { ok: false; error: string; motivo: MotivoDeFallo; reintentable: boolean };

const ENVIOS_EN_CURSO = new Map<string, { promesa: Promise<SendChatReplyResult>; at: number }>();
// Un envio que ya salio se recuerda este rato: cubre los flujos rapidos, que no guardan el numero.
const VIDA_ENVIO_EN_CURSO_MS = 10 * 60_000;

function respuesta(cuerpo: Respuesta, status = 200) {
  return NextResponse.json(cuerpo, { status, headers: { "Cache-Control": "no-store" } });
}

function noAutorizado(error: string, status: number) {
  return respuesta({ ok: false, error, motivo: "otro", reintentable: false }, status);
}

/** redirect() de Next por dentro de la accion (sin permiso): se contesta como no autorizado. */
function esRedireccion(error: unknown) {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

function leerIntento(valor: FormDataEntryValue | null) {
  const numero = typeof valor === "string" ? Number.parseInt(valor, 10) : NaN;
  return Number.isInteger(numero) && numero > 0 ? Math.min(numero, 10) : 1;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return noAutorizado("Tu sesión se cerró. Vuelve a entrar para enviar.", 401);
  }
  const userId = session.user.id;
  const access = await getClientWorkspaceAccessForUser(userId);
  if (!access || !canAccessClientModule(access, "chats")) {
    return noAutorizado("No autorizado", 403);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return respuesta({ ok: false, error: "No se pudo enviar el mensaje", motivo: "otro", reintentable: false }, 400);
  }

  const clientMessageId = idDeMensajeValido(formData.get("clientMessageId"));
  const intento = leerIntento(formData.get("intento"));
  formData.delete("intento");
  const source = formData.get("source") === "official" ? "official" : "agent";
  const conversationIdCrudo = formData.get("conversationId");
  const conversationId = typeof conversationIdCrudo === "string" && conversationIdCrudo.trim() ? conversationIdCrudo.trim().slice(0, 200) : null;

  const ahora = Date.now();
  for (const [clave, entrada] of ENVIOS_EN_CURSO) {
    if (ahora - entrada.at > VIDA_ENVIO_EN_CURSO_MS) {
      ENVIOS_EN_CURSO.delete(clave);
    }
  }

  // La clave lleva al usuario: el numero lo pone el navegador y no puede pisar el envio de otra persona.
  const clave = clientMessageId ? `${userId}:${clientMessageId}` : null;
  const enCurso = clave ? ENVIOS_EN_CURSO.get(clave) : undefined;
  if (enCurso) {
    const anterior = await enCurso.promesa.catch(() => null);
    // Si el primero salio, este no sale. Si fallo, este reintento si vale.
    if (anterior?.ok) {
      return respuesta({ ok: true, repetido: true });
    }
  }

  const promesa = sendUnifiedChatReplyAction(formData);
  if (clave) {
    ENVIOS_EN_CURSO.set(clave, { promesa, at: Date.now() });
  }

  let resultado: SendChatReplyResult;
  try {
    resultado = await promesa;
  } catch (error) {
    if (clave) {
      ENVIOS_EN_CURSO.delete(clave);
    }
    if (esRedireccion(error)) {
      return noAutorizado("No autorizado", 403);
    }
    // Lanzo en medio del envio (por ejemplo un flujo rapido a medias): no se sabe si salio, no se repite solo.
    const detalle = error instanceof Error ? error.message : String(error);
    console.error("[chats/enviar] el envio lanzo un error", { conversationId, source, error: detalle });
    after(async () => {
      const membership = await getPrimaryWorkspaceForUser(userId).catch(() => null);
      if (membership?.workspace.id) {
        await anotarErrorDeEnvio({
          workspaceId: membership.workspace.id,
          source,
          conversationId,
          motivo: "otro",
          detalle,
          clientMessageId,
          userId,
          intento,
        });
      }
    });
    return respuesta({ ok: false, error: "No se pudo enviar el mensaje", motivo: "otro", reintentable: false });
  }

  if (resultado.ok) {
    return respuesta({
      ok: true,
      ...(resultado.repetido ? { repetido: true } : {}),
      ...(resultado.suppressOptimistic ? { suppressOptimistic: true } : {}),
    });
  }

  if (clave) {
    ENVIOS_EN_CURSO.delete(clave);
  }
  const motivo: MotivoDeFallo = resultado.motivo ?? "otro";
  const detalle = resultado.error;
  console.error("[chats/enviar] no se envio", { conversationId, source, motivo, intento, error: detalle });
  after(async () => {
    const membership = await getPrimaryWorkspaceForUser(userId).catch(() => null);
    if (membership?.workspace.id) {
      await anotarErrorDeEnvio({
        workspaceId: membership.workspace.id,
        source,
        conversationId,
        motivo,
        detalle,
        clientMessageId,
        userId,
        intento,
      });
    }
  });
  return respuesta({ ok: false, error: resultado.error, motivo, reintentable: motivoSeReintentaSolo(motivo) });
}
