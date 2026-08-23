import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { canAccessClientModule, getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { getWaCallsSessionId, getWaCallsSessionIdForChannel, waCallsRequest } from "@/lib/wacalls";

export const dynamic = "force-dynamic";

/**
 * El puente entre el marcador del CRM y el servicio de llamadas.
 *
 * Existe para que el navegador NUNCA vea el token de WaCalls: con ese token se puede llamar a
 * cualquier número desde la línea del negocio. Acá la asesora se identifica con su sesión del CRM
 * —la de siempre— y el servidor pone el token. De paso, eso hace que nadie tenga que conocer la
 * contraseña del marcador.
 *
 * Va todo en una ruta con un campo `accion` en vez de cuatro rutas: las cuatro operaciones
 * comparten exactamente la misma comprobación de permisos y el mismo id de línea, y separarlas
 * era repetir ese bloque cuatro veces con el riesgo de que una quedara sin control.
 */

type Accion = "iniciar" | "webrtc" | "colgar" | "silenciar";

type Cuerpo = {
  accion?: Accion;
  /** Canal del chat desde donde se llama: define POR QUE numero sale la llamada. */
  channelId?: string;
  phone?: string;
  callId?: string;
  sdpOffer?: string;
  muted?: boolean;
};

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  // Mismo permiso que la pantalla de Llamadas: quien no puede ver el módulo tampoco puede marcar.
  const access = await getClientWorkspaceAccessForUser(session.user.id);
  if (!access || !canAccessClientModule(access, "llamadas")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  let cuerpo: Cuerpo;
  try {
    cuerpo = (await request.json()) as Cuerpo;
  } catch {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  /**
   * La linea con la que se marca es la DEL CANAL del chat, para que al cliente le entre la
   * llamada desde el mismo numero con el que viene hablando. Solo si no se sabe de que canal
   * viene —marcar desde una pantalla que no lo conoce— se cae a cualquier linea vinculada.
   */
  const sid =
    (await getWaCallsSessionIdForChannel(cuerpo.channelId ?? null)) ?? (await getWaCallsSessionId());
  if (!sid) {
    return NextResponse.json(
      { error: "Este canal todavía no tiene línea de llamadas. Vinculala en Conexión." },
      { status: 503 },
    );
  }

  const operadorId = session.user.id;

  switch (cuerpo.accion) {
    case "iniciar": {
      // Solo dígitos: WaCalls igual los limpia, pero lo que llega es un teléfono escrito por
      // otra gente y no tiene por qué llegar entero hasta allá.
      const phone = (cuerpo.phone ?? "").replace(/[^0-9+]/g, "");
      if (!phone) {
        return NextResponse.json({ error: "Falta el número" }, { status: 400 });
      }
      const respuesta = await waCallsRequest<{ call?: { callId?: string } }>({
        path: `/api/sessions/${sid}/calls`,
        method: "POST",
        body: { phone },
        operadorId,
      });
      if (!respuesta.ok) {
        return NextResponse.json({ error: traducir(respuesta.error) }, { status: respuesta.status });
      }
      const callId = respuesta.data.call?.callId;
      if (!callId) {
        return NextResponse.json({ error: "El servicio no devolvió la llamada." }, { status: 502 });
      }
      return NextResponse.json({ ok: true, callId });
    }

    case "webrtc": {
      if (!cuerpo.callId || !cuerpo.sdpOffer) {
        return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
      }
      const respuesta = await waCallsRequest<{ sdp_answer?: string }>({
        path: `/api/sessions/${sid}/calls/${encodeURIComponent(cuerpo.callId)}/webrtc`,
        method: "POST",
        body: { sdp_offer: cuerpo.sdpOffer },
        operadorId,
      });
      if (!respuesta.ok) {
        return NextResponse.json({ error: traducir(respuesta.error) }, { status: respuesta.status });
      }
      return NextResponse.json({ ok: true, sdpAnswer: respuesta.data.sdp_answer ?? "" });
    }

    case "colgar": {
      if (!cuerpo.callId) {
        return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
      }
      const respuesta = await waCallsRequest<unknown>({
        path: `/api/sessions/${sid}/calls/${encodeURIComponent(cuerpo.callId)}`,
        method: "DELETE",
        operadorId,
      });
      // Colgar algo que ya se cortó no es un error para quien esta del otro lado de la pantalla.
      if (!respuesta.ok && respuesta.status !== 404) {
        return NextResponse.json({ error: traducir(respuesta.error) }, { status: respuesta.status });
      }
      return NextResponse.json({ ok: true });
    }

    case "silenciar": {
      if (!cuerpo.callId || typeof cuerpo.muted !== "boolean") {
        return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
      }
      const respuesta = await waCallsRequest<unknown>({
        path: `/api/sessions/${sid}/calls/${encodeURIComponent(cuerpo.callId)}/mute`,
        method: "POST",
        body: { muted: cuerpo.muted },
        operadorId,
      });
      if (!respuesta.ok) {
        return NextResponse.json({ error: traducir(respuesta.error) }, { status: respuesta.status });
      }
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
  }
}

/**
 * Los errores del servicio vienen en inglés y en su vocabulario. Los pocos que una asesora puede
 * provocar se traducen a algo accionable; el resto se deja pasar tal cual para no esconder
 * información al depurar.
 */
function traducir(error: string): string {
  switch (error) {
    case "operator already on a call":
      return "Ya tenés una llamada en curso.";
    case "not paired":
      return "La línea de llamadas está desconectada.";
    case "invalid phone":
      return "Ese número no es válido.";
    case "max concurrent calls":
      return "Hay demasiadas llamadas a la vez. Esperá un momento.";
    case "no such call":
      return "Esa llamada ya terminó.";
    default:
      return error;
  }
}
