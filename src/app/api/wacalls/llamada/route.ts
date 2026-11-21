import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { canAccessClientModule, getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { normalizePhoneFromJid } from "@/lib/evolution-webhook";
import {
  buscarFichaDeLaLlamada,
  getLineasDelNegocio,
  getOtraLineaDelNegocio,
  getWaCallsSessionIdDelNegocio,
  getWaCallsSessionIdForChannel,
  waCallsRequest,
} from "@/lib/wacalls";

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

type Accion =
  | "iniciar"
  | "webrtc"
  | "colgar"
  | "silenciar"
  | "estado"
  | "diagnostico"
  | "entrante"
  | "contestar"
  | "rechazar";

type Cuerpo = {
  accion?: Accion;
  /** Canal del chat desde donde se llama: define POR QUE numero sale la llamada. */
  channelId?: string;
  phone?: string;
  /** Identificador oculto de WhatsApp, para los leads que llegan sin telefono. */
  lid?: string;
  callId?: string;
  sdpOffer?: string;
  muted?: boolean;
  /** Solo "diagnostico": los contadores de audio del navegador (audio-de-llamada.ts). */
  diagnostico?: Record<string, unknown>;
  segundosHablados?: number;
  /**
   * Solo "iniciar", para la llamada de tres: la linea que YA esta en la llamada con el cliente.
   * La nueva llamada sale por otra linea del mismo negocio.
   */
  otraLineaDistintaDe?: string;
  /**
   * La linea por la que salio la llamada, tal como la devolvio "iniciar". Hace falta para colgar,
   * consultar o conectar el sonido de la segunda llamada de una llamada de tres, que no sale por
   * la linea del chat. Solo se acepta si es una linea de ESTE negocio.
   */
  sessionId?: string;
  /**
   * Solo "entrante", "contestar" y "rechazar": el id de la llamada ENTRANTE en WaCalls, tal como
   * llego en el aviso en vivo (`type: "llamada-entrante"`) o en el `?llamada=<id>` de la notificacion.
   */
  llamadaId?: string;
};

const SIN_OTRA_LINEA = "No hay otra línea libre para agregar a alguien";

/** Los campos del diagnostico que se aceptan; todo lo demas se ignora. */
const CAMPOS_DIAGNOSTICO = [
  "enviados",
  "descartados",
  "recibidos",
  "bytesRecibidos",
  "colaMaxima",
  "huecoMaximoRecibidoMs",
  "huecoMaximoEnviadoMs",
  "microfonoCaido",
  "cortesReproduccion",
  "objetivoColchonMaxMs",
  "bytesEnviadosRed",
  "bytesRecibidosRed",
  "rttMs",
] as const;

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
   * llamada desde el mismo numero con el que viene hablando.
   *
   * Si ese canal no tiene linea propia, se cae a otra DEL MISMO NEGOCIO. Nunca a una de otro:
   * el servidor de llamadas atiende a los tres, y antes la unica linea vinculada marcaba las
   * llamadas de todos.
   */
  const sidPedido = limpiarSessionId(cuerpo.sessionId);
  if (sidPedido && !(await getLineasDelNegocio(access.workspaceId)).includes(sidPedido)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const sid =
    sidPedido ??
    (await getWaCallsSessionIdForChannel(cuerpo.channelId ?? null)) ??
    (await getWaCallsSessionIdDelNegocio(access.workspaceId));
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
      const lid = (cuerpo.lid ?? "").replace(/[^0-9]/g, "");
      if (!phone && !lid) {
        return NextResponse.json({ error: "Falta el número" }, { status: 400 });
      }

      /*
        A los leads de anuncios WhatsApp no nos da su telefono, solo un identificador oculto. Y a
        ese identificador SÍ se le puede llamar: es la misma direccion con la que intercambiamos
        mensajes cifrados. Probado el 25-09-2026 llamando al numero de Alex por su identificador:
        timbro, contesto y el audio se establecio.

        Son el 15% de la base -355 contactos-, que hasta hoy no se podian llamar de ninguna forma.
      */
      const marcar = (linea: string) =>
        waCallsRequest<{ call?: { callId?: string } }>({
          path: `/api/sessions/${linea}/calls`,
          method: "POST",
          body: lid ? { lid } : { phone },
          operadorId,
        });

      /*
        Llamada de tres: la linea que ya esta hablando con el cliente no puede hacer otra llamada,
        asi que la nueva sale por OTRA linea del mismo negocio. Primero se intenta la del chat (si
        no es la que ya esta ocupada); si WaCalls dice que esta ocupada, o si era justo esa, se
        busca otra. La busqueda filtra siempre por el negocio de quien llama.
      */
      const excluir = limpiarSessionId(cuerpo.otraLineaDistintaDe);
      let linea: string | null = sid;
      if (excluir && linea === excluir) {
        linea = await getOtraLineaDelNegocio(access.workspaceId, excluir);
        if (!linea) {
          return NextResponse.json({ error: SIN_OTRA_LINEA }, { status: 409 });
        }
      }

      let respuesta = await marcar(linea);
      if (!respuesta.ok && estaOcupada(respuesta)) {
        const otra = await getOtraLineaDelNegocio(
          access.workspaceId,
          excluir ? [linea, excluir] : [linea],
        );
        if (otra) {
          linea = otra;
          respuesta = await marcar(otra);
        }
        if (!respuesta.ok && excluir && (!otra || estaOcupada(respuesta))) {
          return NextResponse.json({ error: SIN_OTRA_LINEA }, { status: 409 });
        }
      }
      if (!respuesta.ok) {
        return NextResponse.json({ error: traducir(respuesta.error) }, { status: respuesta.status });
      }
      const callId = respuesta.data.call?.callId;
      if (!callId) {
        return NextResponse.json({ error: "El servicio no devolvió la llamada." }, { status: 502 });
      }
      // La linea usada vuelve al navegador para que la mande en colgar, estado y webrtc.
      return NextResponse.json({ ok: true, callId, sessionId: linea });
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

    /*
      En que va la llamada: timbrando, contestada o terminada (y por que).

      El navegador NO lo puede saber solo: su audio se conecta con WaCalls apenas se marca, cuando
      al cliente todavia le esta timbrando. Mirando eso, el marcador mostraba "en llamada" con el
      reloj corriendo y nadie del otro lado (Alex, 02-10-2026). El que sabe cuando el cliente
      levanta es WaCalls, y aca se le pregunta.

      Una llamada terminada ya no esta en la lista de las activas (WaCalls la borra al cortar) y
      pasa a su historial: de ahi sale el motivo -no contesto, rechazo, ocupado-.
    */
    case "estado": {
      if (!cuerpo.callId) {
        return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
      }
      const respuesta = await waCallsRequest<{ call?: { status?: string; endReason?: string } }>({
        path: `/api/sessions/${sid}/calls/${encodeURIComponent(cuerpo.callId)}`,
        operadorId,
        timeoutMs: 5000,
      });
      if (respuesta.ok) {
        return NextResponse.json({
          ok: true,
          status: respuesta.data.call?.status ?? "ringing",
          endReason: respuesta.data.call?.endReason ?? null,
          enHistorial: false,
        });
      }
      if (respuesta.status !== 404) {
        return NextResponse.json({ error: traducir(respuesta.error) }, { status: respuesta.status });
      }

      const historial = await waCallsRequest<{ calls?: Array<{ callId?: string; endReason?: string }> }>({
        path: `/api/sessions/${sid}/history?limit=20`,
        operadorId,
        timeoutMs: 5000,
      });
      const fila = historial.ok ? historial.data.calls?.find((call) => call.callId === cuerpo.callId) : undefined;
      return NextResponse.json({
        ok: true,
        status: "ended",
        endReason: fila?.endReason ?? null,
        enHistorial: Boolean(fila),
      });
    }

    /*
      Lo que conto el navegador del audio de la llamada, al colgar. No se guarda en la base: va
      a los registros del servicio (docker service logs aizenlite_aizenbot_app | grep
      "llamadas:diagnostico") para poder contestar, llamada por llamada, si el audio fue en los
      dos sentidos. Ver audio-de-llamada.ts.
    */
    case "diagnostico": {
      if (!cuerpo.callId || !cuerpo.diagnostico || typeof cuerpo.diagnostico !== "object") {
        return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
      }
      const limpio: Record<string, number | null> = {};
      for (const campo of CAMPOS_DIAGNOSTICO) {
        const valor = cuerpo.diagnostico[campo];
        limpio[campo] = typeof valor === "number" && Number.isFinite(valor) ? Math.round(valor) : null;
      }
      const segundos = typeof cuerpo.segundosHablados === "number" && Number.isFinite(cuerpo.segundosHablados) ? Math.round(cuerpo.segundosHablados) : null;
      console.info(
        "[llamadas:diagnostico]",
        JSON.stringify({ callId: cuerpo.callId.slice(0, 64), sid, operadorId, segundosHablados: segundos, ...limpio }),
      );
      return NextResponse.json({ ok: true });
    }

    /*
      Llamadas ENTRANTES (parte 3 de "Llamadas entrantes en la PWA", 21-nov-2026).

      El navegador solo conoce el id de la llamada, no la linea por la que entro. La linea se busca
      preguntandole a WaCalls por esa llamada en CADA linea DE ESTE NEGOCIO (getLineasDelNegocio):
      asi nunca se toca una llamada de otro negocio aunque alguien mande un id ajeno.

      - "entrante": si la llamada sigue sonando, con quien es (para el `?llamada=<id>` de la
        notificacion, cuando la pantalla se abre sin el aviso en vivo).
      - "contestar": la contesta desde el CRM y devuelve lo mismo que "iniciar" (callId y la linea),
        que es lo que necesita el navegador para conectar el audio con "webrtc".
      - "rechazar": la corta mientras suena (el boton Colgar de la pantalla de llamada entrante).
    */
    case "entrante":
    case "contestar":
    case "rechazar": {
      const llamadaId = limpiarSessionId(cuerpo.llamadaId);
      if (!llamadaId) {
        return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
      }
      const encontrada = await buscarLlamadaEnElNegocio(access.workspaceId, llamadaId, operadorId);
      const estadoDeLaLlamada = encontrada?.call.status ?? "ended";
      const terminada = estadoDeLaLlamada === "ended";

      if (cuerpo.accion === "entrante") {
        if (!encontrada || terminada || estadoDeLaLlamada === "connected") {
          return NextResponse.json({ ok: true, sonando: false, contestada: estadoDeLaLlamada === "connected" });
        }
        const numero = normalizePhoneFromJid(encontrada.call.peer ?? null);
        const ficha = numero
          ? await buscarFichaDeLaLlamada({ telefono: numero, workspaceId: access.workspaceId }).catch(() => null)
          : null;
        return NextResponse.json({
          ok: true,
          sonando: true,
          llamadaId,
          nombre: ficha?.name?.trim() || null,
          numero: numero ?? "",
          foto: ficha?.avatarUrl?.trim() || null,
        });
      }

      if (!encontrada || terminada) {
        if (cuerpo.accion === "rechazar") {
          // Rechazar algo que ya se corto no es un error para la asesora, como en "colgar".
          return NextResponse.json({ ok: true });
        }
        return NextResponse.json({ error: "La llamada ya terminó." }, { status: 410 });
      }

      if (cuerpo.accion === "rechazar") {
        const respuesta = await waCallsRequest<unknown>({
          path: `/api/sessions/${encontrada.linea}/calls/${encodeURIComponent(llamadaId)}`,
          method: "DELETE",
          operadorId,
        });
        if (!respuesta.ok && respuesta.status !== 404) {
          return NextResponse.json({ error: traducir(respuesta.error) }, { status: respuesta.status });
        }
        return NextResponse.json({ ok: true });
      }

      // contestar
      if (estadoDeLaLlamada === "connected") {
        return NextResponse.json({ error: "Ya la contestó otra persona." }, { status: 409 });
      }
      /*
        OJO: la sesion que hizo esto corrio en la nube, sin acceso al VPS, y no pudo confirmar en el
        codigo de WaCalls que exista un endpoint para contestar una llamada entrante. Se intenta con
        el nombre probable (`/accept`); si WaCalls no lo tiene (o falla por lo que sea), se responde
        `contestarDesdeElCelular` y la pantalla le dice a la asesora que conteste en el celular de la
        linea. El parche de WaCalls, si hace falta, va en otra tarjeta.
      */
      const respuesta = await waCallsRequest<{ call?: { callId?: string } }>({
        path: `/api/sessions/${encontrada.linea}/calls/${encodeURIComponent(llamadaId)}/accept`,
        method: "POST",
        operadorId,
      });
      if (!respuesta.ok) {
        if (respuesta.error === "no such call") {
          return NextResponse.json({ error: "La llamada ya terminó." }, { status: 410 });
        }
        if (respuesta.error === "operator already on a call") {
          return NextResponse.json({ error: traducir(respuesta.error) }, { status: 409 });
        }
        console.info(
          "[wacalls] contestar desde el CRM no disponible",
          JSON.stringify({ llamadaId: llamadaId.slice(0, 64), status: respuesta.status }),
        );
        return NextResponse.json(
          { error: "Contesta desde el celular de la línea.", contestarDesdeElCelular: true },
          { status: 501 },
        );
      }
      // Lo mismo que devuelve "iniciar": con esto el navegador conecta el audio por "webrtc".
      return NextResponse.json({
        ok: true,
        callId: respuesta.data.call?.callId || llamadaId,
        sessionId: encontrada.linea,
      });
    }

    default:
      return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
  }
}

/** Un id de linea que llega del navegador: texto corto o nada. Despues se compara con las del negocio. */
function limpiarSessionId(valor: unknown): string | null {
  if (typeof valor !== "string") {
    return null;
  }
  const limpio = valor.trim();
  return limpio && limpio.length <= 128 ? limpio : null;
}

/**
 * La llamada `llamadaId` en las lineas de ESTE negocio: la primera linea donde WaCalls la tiene
 * activa. Si no esta en ninguna (termino o es de otro negocio), null.
 */
async function buscarLlamadaEnElNegocio(
  workspaceId: string,
  llamadaId: string,
  operadorId: string,
): Promise<{ linea: string; call: { status?: string; peer?: string } } | null> {
  const lineas = await getLineasDelNegocio(workspaceId);
  const respuestas = await Promise.all(
    lineas.map(async (linea) => ({
      linea,
      respuesta: await waCallsRequest<{ call?: { status?: string; peer?: string } }>({
        path: `/api/sessions/${linea}/calls/${encodeURIComponent(llamadaId)}`,
        operadorId,
        timeoutMs: 5000,
      }),
    })),
  );
  for (const { linea, respuesta } of respuestas) {
    if (respuesta.ok && respuesta.data.call) {
      return { linea, call: respuesta.data.call };
    }
  }
  return null;
}

/** WaCalls no pudo marcar porque la linea (o quien llama) ya esta en otra llamada. */
function estaOcupada(respuesta: { status: number; error: string }): boolean {
  return (
    respuesta.status === 409 ||
    respuesta.error === "operator already on a call" ||
    /\bbusy\b/i.test(respuesta.error)
  );
}

/**
 * Los errores del servicio vienen en inglés y en su vocabulario. Los pocos que una asesora puede
 * provocar se traducen a algo accionable; el resto se deja pasar tal cual para no esconder
 * información al depurar.
 */
function traducir(error: string): string {
  switch (error) {
    case "operator already on a call":
      return "Ya tienes una llamada en curso.";
    case "not paired":
      return "La línea de llamadas está desconectada.";
    case "invalid phone":
      return "Ese número no es válido.";
    case "max concurrent calls":
      return "Hay demasiadas llamadas a la vez. Espera un momento.";
    case "no such call":
      return "Esa llamada ya terminó.";
    default:
      return error;
  }
}
