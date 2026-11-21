import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse, after } from "next/server";
import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { normalizePhoneFromJid } from "@/lib/evolution-webhook";
import { notifyRealtimeUpdate } from "@/lib/realtime-notify";
import { buscarFichaDeLaLlamada, getWaCallsBaseUrl } from "@/lib/wacalls";
import {
  avisarFinDeLlamada,
  avisarLlamadaEntrante,
  type DatosDeLaLlamada,
} from "@/features/llamadas/services/avisar-llamada-entrante";
import { CALL_RESULT_PENDING } from "@/features/crm/domain/crm-config";
import { transcribirYResumirLlamada } from "@/lib/llamada-transcripcion";

export const dynamic = "force-dynamic";

/**
 * Buzón de WaCalls: anota TODAS las llamadas del lead, las haga quien las haga.
 *
 * WaCalls avisa acá cada vez que termina una llamada —salientes y entrantes, atendidas y
 * perdidas— y todas quedan registradas en el historial del lead. Que la llamada existió es un
 * hecho, y hasta ahora dependía de que alguien se acordara de anotarla.
 *
 * Lo que el buzón NO hace es decidir cómo quedó el cliente:
 *
 *  - Si NO se habló → se cierra sola como "no contestó". Es el único resultado del Playbook SIN
 *    efecto sobre la etapa (ver CALL_RESULT_STAGE_EFFECT), así que anotarlo no mueve nada.
 *  - Si SÍ se habló → queda "sin registrar" esperando a la asesora, que elige el resultado desde
 *    Llamadas. Interesada / lo piensa / perdido mueven la etapa del lead y disparan seguimientos:
 *    deducir eso del audio no sería un dato de más, sería un lead movido de etapa por error.
 */

/**
 * Finales que significan "no hablé con el cliente", según el vocabulario de WaCalls
 * (internal/voip/core/types.go).
 *
 * Quedan afuera "user_ended" (alguien colgó, o sea que la llamada se atendió), "failed" y
 * "unknown": ante la duda, no se anota. Es preferible que la asesora cargue una llamada de más a
 * que el CRM invente un "no contestó" sobre una conversación que sí ocurrió.
 */
const FINALES_SIN_CONTACTO = new Set([
  "timeout",
  "declined",
  "busy",
  "do_not_disturb",
  "cancelled",
]);

/*
  Los avisos de WaCalls ANTES del final (parte 1 de "Llamadas entrantes en la PWA", 20-nov-2026).

  Lo que se sabe de la API de WaCalls (internal/app/events/webhook.go del VPS) es que avisa a este
  buzón cuando la llamada empieza a sonar, cuando se conecta y cuando termina ("call.ended"), siempre
  con el mismo cuerpo firmado: `event` y `call` con `callId` (el id de la llamada), `sessionId` (la
  línea), `peer` (el número del cliente, como JID), `direction` ("inbound" entrante, "outbound"
  saliente), `startedAt` y, al final, `endedAt` y `endReason` (el estado con que terminó).

  La sesión que hizo este cambio corrió en la nube, sin acceso al VPS, y no pudo leer el nombre exacto
  de los dos primeros eventos. Por eso se aceptan los nombres probables de cada uno; un nombre
  que no esté acá se sigue ignorando como hasta hoy (200 sin hacer nada), así que no rompe nada.
  PENDIENTE de confirmar en el VPS: `grep -rn '"call\.' internal/` en el código de WaCalls.
*/
// "call.started" queda afuera a propósito: podría ser el de "se conectó", y timbrar una llamada ya
// atendida sería peor que no timbrar.
const EVENTOS_DE_TIMBRE = new Set(["call.ringing", "call.incoming", "call.offer", "call.received"]);
const EVENTOS_DE_CONTESTADA = new Set(["call.connected", "call.answered", "call.accepted"]);

/** Entrante, según WaCalls. Sin dirección no se avisa: mejor un timbre de menos que uno falso. */
function esEntrante(direccion: string | undefined) {
  const valor = (direccion ?? "").trim().toLowerCase();
  return valor === "inbound" || valor === "incoming";
}

/** Lo que necesita el aviso al equipo. Sin id de llamada o sin número no se puede avisar. */
function datosDelAviso(
  llamada: WaCallsWebhookBody["call"],
  workspaceFijado: string | null,
): DatosDeLaLlamada | null {
  const llamadaId = llamada?.callId?.trim();
  const telefono = normalizePhoneFromJid(llamada?.peer ?? null);
  if (!llamadaId || !telefono) {
    return null;
  }
  return { llamadaId, sessionId: llamada?.sessionId ?? null, telefono, workspaceFijado };
}

/** Margen de reloj aceptado para la firma. Corta los reenvíos de un pedido viejo capturado. */
const TOLERANCIA_SEGUNDOS = 300;

type WaCallsWebhookBody = {
  event?: string;
  call?: {
    /** La linea de WaCalls por la que salio. Junto con callId, arma el nombre del WAV grabado. */
    sessionId?: string;
    callId?: string;
    /** Quien marco. Viaja como X-Client-Id al iniciar y vuelve aca; es el id del usuario del CRM. */
    owner?: string | null;
    direction?: string;
    peer?: string;
    peerName?: string;
    startedAt?: number;
    endedAt?: number;
    endReason?: string;
  };
};

/**
 * La firma es HMAC-SHA256 sobre `timestamp + "." + cuerpo`, en hexadecimal y con prefijo "v1="
 * (internal/app/events/webhook.go). Se compara con timingSafeEqual y no con ===: comparar
 * strings corta apenas encuentra una diferencia, y ese tiempo distinto filtra, byte a byte, cómo
 * es la firma correcta.
 */
function firmaValida(secreto: string, timestamp: string, cuerpo: string, recibida: string) {
  const esperada = createHmac("sha256", secreto).update(`${timestamp}.${cuerpo}`).digest("hex");
  const limpia = recibida.startsWith("v1=") ? recibida.slice(3) : recibida;

  const a = Buffer.from(esperada, "utf8");
  const b = Buffer.from(limpia, "utf8");
  // timingSafeEqual explota si los largos no coinciden, y el largo no es secreto.
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const secreto = process.env.WACALLS_WEBHOOK_SECRET?.trim();
  if (!secreto) {
    // Sin secreto configurado no se acepta nada: un buzón abierto dejaría que cualquiera invente
    // llamadas en el CRM.
    console.warn("[wacalls] llega un aviso pero falta WACALLS_WEBHOOK_SECRET");
    return NextResponse.json({ error: "no configurado" }, { status: 503 });
  }

  const workspaceFijado = process.env.WACALLS_WORKSPACE_ID?.trim() || null;
  const cuerpo = await request.text();
  const firma = request.headers.get("x-wacalls-signature");
  const timestamp = request.headers.get("x-wacalls-timestamp");

  if (!firma || !timestamp || !firmaValida(secreto, timestamp, cuerpo, firma)) {
    return NextResponse.json({ error: "firma inválida" }, { status: 401 });
  }

  const enviadoHace = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(enviadoHace) || enviadoHace > TOLERANCIA_SEGUNDOS) {
    return NextResponse.json({ error: "aviso vencido" }, { status: 401 });
  }

  let payload: WaCallsWebhookBody;
  try {
    payload = JSON.parse(cuerpo) as WaCallsWebhookBody;
  } catch {
    return NextResponse.json({ error: "cuerpo inválido" }, { status: 400 });
  }

  const evento = payload.event ?? "";

  /*
    Llamada ENTRANTE que empieza a sonar, o que alguien contestó: se avisa al equipo y se responde
    200 enseguida. El aviso va en after(): no demora la respuesta (WaCalls reintenta si tardamos) y,
    si falla, el webhook ya respondió bien. Las salientes no se avisan: las hizo alguien del equipo.
  */
  if (EVENTOS_DE_TIMBRE.has(evento) || EVENTOS_DE_CONTESTADA.has(evento)) {
    const datos = datosDelAviso(payload.call, workspaceFijado);
    if (!datos || !esEntrante(payload.call?.direction)) {
      return NextResponse.json({ ok: true, ignorado: evento });
    }
    if (EVENTOS_DE_TIMBRE.has(evento)) {
      after(() =>
        avisarLlamadaEntrante(datos).catch((error) =>
          console.warn("[wacalls] no se pudo avisar la llamada entrante", error),
        ),
      );
    } else {
      after(() =>
        avisarFinDeLlamada({ ...datos, estado: "contestada", huboContacto: true }).catch((error) =>
          console.warn("[wacalls] no se pudo avisar que contestaron la llamada", error),
        ),
      );
    }
    return NextResponse.json({ ok: true, avisada: evento });
  }

  // De lo demás, acá solo interesa el final. Se responde 200 igual: un 4xx haría que WaCalls
  // reintente tres veces un aviso que está bien.
  if (evento !== "call.ended") {
    return NextResponse.json({ ok: true, ignorado: payload.event ?? null });
  }

  const llamada = payload.call;
  if (!llamada?.startedAt) {
    return NextResponse.json({ ok: true, ignorado: "sin datos" });
  }

  const telefono = normalizePhoneFromJid(llamada.peer ?? null);
  if (!telefono) {
    return NextResponse.json({ ok: true, ignorado: "sin teléfono" });
  }

  /*
    Si era ENTRANTE, al final se avisa que dejó de sonar (y, si nadie contestó, la notificación pasa a
    "Llamada perdida"). Va después de anotarla, en after(), y también cuando el número no tiene ficha:
    esa llamada igual timbró. No se repite en un aviso "repetido" (un reintento de WaCalls).
  */
  const finDeLaEntrante = () => {
    const datos = datosDelAviso(llamada, workspaceFijado);
    if (!datos || !esEntrante(llamada.direction)) {
      return;
    }
    const huboContactoEnLaLlamada = !FINALES_SIN_CONTACTO.has((llamada.endReason ?? "").trim());
    after(() =>
      avisarFinDeLlamada({ ...datos, estado: "terminada", huboContacto: huboContactoEnLaLlamada }).catch(
        (error) => console.warn("[wacalls] no se pudo avisar el fin de la llamada", error),
      ),
    );
  };

  /**
   * La ficha se busca por teléfono. Si el número no está en el CRM no se crea una ficha nueva:
   * una llamada a un número suelto no es un lead, y crear fichas desde acá llenaría el embudo de
   * equivocaciones de marcado y de llamadas a proveedores.
   */
  // El mismo teléfono puede existir en dos negocios distintos. Sin acotarlo, una llamada podría
  // anotarse en el equivocado; con WACALLS_WORKSPACE_ID puesto, eso deja de ser posible. Sin la
  // variable sigue funcionando como antes (el más reciente). La búsqueda vive en src/lib/wacalls.ts
  // porque el aviso de llamada entrante usa la misma.
  const contacto = await buscarFichaDeLaLlamada({ telefono, workspaceId: workspaceFijado });
  if (!contacto) {
    console.info(`[wacalls] llamada con ${telefono}: no hay ficha en el CRM`);
    finDeLaEntrante();
    return NextResponse.json({ ok: true, ignorado: "sin ficha" });
  }

  /**
   * `calledAt` es el arranque exacto de la llamada, y eso lo vuelve la llave natural del registro.
   *
   * Hace falta porque WaCalls reintenta el aviso hasta tres veces si nuestra respuesta tarda o
   * falla, y sin esto el mismo intento quedaría anotado dos o tres veces. Dos llamadas distintas
   * al mismo lead no pueden arrancar en el mismo milisegundo, así que alcanza para distinguirlas.
   */
  const calledAt = new Date(llamada.startedAt);
  const yaRegistrada = await prisma.callAttempt.findFirst({
    where: { workspaceId: contacto.workspaceId, contactId: contacto.id, calledAt },
    select: { id: true },
  });
  if (yaRegistrada) {
    return NextResponse.json({ ok: true, ignorado: "repetida" });
  }

  /**
   * El operador que manda WaCalls es el id de usuario que puso el CRM al marcar. Se verifica
   * contra el workspace de la ficha antes de usarlo: es un dato que entra desde afuera, y sin
   * comprobarlo se le podrian atribuir llamadas a cualquier usuario.
   */
  const operador = typeof llamada.owner === "string" ? llamada.owner.trim() : "";
  const autora = operador
    ? (
        await prisma.workspaceMember.findFirst({
          where: { userId: operador, workspaceId: contacto.workspaceId, isActive: true },
          select: { userId: true },
        })
      )?.userId ?? null
    : null;

  const intentosPrevios = await prisma.callAttempt.count({
    where: { workspaceId: contacto.workspaceId, contactId: contacto.id },
  });

  const saliente = llamada.direction === "outbound";
  const huboContacto = !FINALES_SIN_CONTACTO.has((llamada.endReason ?? "").trim());

  /**
   * La única pregunta que decide el resultado es: ¿se habló con el cliente?
   *
   * Si NO se habló —da igual que la llamada fuera nuestra o de él— se cierra sola como "no
   * contestó": es el único resultado del Playbook sin efecto sobre la etapa, así que anotarlo no
   * mueve nada, y el resumen del día la cuenta bien (como llamada no atendida). Una entrante
   * perdida marcada "sin registrar" le habría dicho a la asesora que habló con alguien que en
   * realidad no atendió.
   *
   * Si SÍ se habló, queda SIN CLASIFICAR esperando a la asesora. Que hablaron es un hecho y por
   * eso se anota; cómo quedó el cliente no se deduce del audio, y equivocarse ahí no sería un
   * dato de más sino un lead movido de etapa por error.
   */
  const result = huboContacto ? CALL_RESULT_PENDING : "no_contesto";

  const resumen = comoFue(
    saliente,
    huboContacto,
    llamada.endReason ?? "",
    duracionEnSegundos(llamada),
  );

  const intento = await prisma.callAttempt.create({
    data: {
      workspaceId: contacto.workspaceId,
      contactId: contacto.id,
      /**
       * Quien llamo, cuando se sabe.
       *
       * Las llamadas hechas desde el CRM viajan con el id de la asesora, asi que vuelven
       * identificadas. Las hechas desde el marcador de WaCalls a secas no traen a nadie, y ahi
       * queda en blanco: inventar una asesora le atribuiria llamadas que capaz no hizo. Se
       * completa sola cuando alguien clasifica la llamada.
       */
      calledByUserId: autora,
      attemptNumber: intentosPrevios + 1,
      result,
      summary: resumen,
      calledAt,
    },
  });

  await dejarLaLlamadaEnElChat({
    workspaceId: contacto.workspaceId,
    contactId: contacto.id,
    saliente,
    resumen,
    calledAt,
  });

  /*
    La grabacion se trae DESPUES de responder.

    Es un WAV de varios megas -una llamada de 5 minutos son ~10 MB- y WaCalls reintenta el aviso si
    nuestra respuesta tarda. Bajarla antes de contestar podia terminar en el mismo aviso llegando
    dos o tres veces mientras el archivo todavia viajaba.
  */
  const sesionDeLaLlamada = llamada.sessionId?.trim();
  const idDeLaLlamada = llamada.callId?.trim();
  if (sesionDeLaLlamada && idDeLaLlamada) {
    after(() =>
      guardarLaGrabacion({
        attemptId: intento.id,
        sessionId: sesionDeLaLlamada,
        callId: idDeLaLlamada,
      }),
    );
  }

  finDeLaEntrante();

  console.info(
    `[wacalls] anotada llamada ${saliente ? "saliente" : "entrante"} a ${telefono} (${llamada.endReason}) como ${result}, intento ${intentosPrevios + 1}`,
  );

  revalidatePath("/cliente/llamadas");
  revalidatePath("/cliente/crm/mi-dia");
  revalidatePath("/cliente/chats");
  return NextResponse.json({ ok: true, registrada: true });
}

/**
 * La llamada, dentro de la conversacion.
 *
 * Hasta hoy una llamada quedaba anotada en Llamadas y el chat no se enteraba: la asesora abria la
 * charla, leia "quedamos en eso" y no habia forma de saber que ese "eso" se hablo por telefono
 * hace diez minutos. WhatsApp deja la llamada entre los mensajes por esa misma razon.
 *
 * La burbuja ya estaba programada y esperando (`getCallMessageSummary`): dibuja cualquier mensaje
 * de tipo SYSTEM cuyo texto empiece con "Llamada". El texto que se guarda en Llamadas ya viene
 * con ese formato a proposito; lo unico que faltaba era escribir el mensaje. Antes lo hacia el
 * webhook de Evolution al recibir un evento CALL, y al pasar las lineas a WAHA ese camino quedo
 * muerto sin que nadie ocupara su lugar: en toda la base habia CERO registros de llamada en chats.
 *
 * No rompe nada si falla: la llamada YA quedo anotada en Llamadas, que es el registro que importa.
 * Por eso va con su propio try: perder la burbuja es molesto, perder el registro no es opcion.
 */
async function dejarLaLlamadaEnElChat(input: {
  workspaceId: string;
  contactId: string;
  saliente: boolean;
  resumen: string;
  calledAt: Date;
}) {
  try {
    /*
      El mismo contacto puede tener varias conversaciones (una por linea). Va en la ULTIMA que
      tuvo movimiento: es la que la asesora tiene abierta y donde la llamada tiene sentido.
    */
    const conversacion = await prisma.conversation.findFirst({
      where: { workspaceId: input.workspaceId, contactId: input.contactId },
      orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
      select: { id: true, channelId: true, lastMessageAt: true },
    });
    if (!conversacion) {
      console.info("[wacalls] llamada sin conversacion donde dejarla");
      return;
    }

    await prisma.message.create({
      data: {
        workspaceId: input.workspaceId,
        conversationId: conversacion.id,
        channelId: conversacion.channelId,
        contactId: input.contactId,
        // De que lado queda la burbuja: la que hicimos nosotros va a la derecha, como un mensaje
        // nuestro; la que entro, a la izquierda.
        direction: input.saliente ? "OUTBOUND" : "INBOUND",
        type: "SYSTEM",
        content: input.resumen,
        /*
          Se guarda con la hora en que ARRANCO la llamada, no con la de ahora.

          El aviso de WaCalls llega cuando la llamada termina; en una de veinte minutos, fecharla
          al final la pondria despues de mensajes que en realidad se escribieron durante. Va donde
          de verdad paso.
        */
        createdAt: input.calledAt,
        /*
          Marcada como llamada.

          La lista tapa TODOS los mensajes de sistema en la vista previa de la fila -es lo que
          evita que "cambio la etapa a Caliente" pise el ultimo mensaje del cliente-. Una llamada
          no es eso: es actividad real con la persona, y en WhatsApp la fila lo dice. Con esta
          marca la lista la deja pasar sin abrirle la puerta a las notas internas.
        */
        rawPayload: { source: "llamada" },
      },
    });

    /*
      El chat sube al tope de la bandeja, como en WhatsApp: una llamada es actividad con ese
      cliente y la fila pasa a decir "Llamada saliente - 18s".

      Solo si es mas nueva que lo ultimo que hay. Un aviso que llega tarde -WaCalls reintenta
      hasta tres veces- no puede tirar la conversacion hacia atras ni pisar un mensaje posterior.
    */
    if (!conversacion.lastMessageAt || conversacion.lastMessageAt < input.calledAt) {
      await prisma.conversation.update({
        where: { id: conversacion.id },
        data: { lastMessageAt: input.calledAt },
      });
    }

    // Para que aparezca sola en la pantalla de quien la tenga abierta, sin recargar.
    void notifyRealtimeUpdate({
      workspaceId: input.workspaceId,
      conversationId: conversacion.id,
      type: "llamada",
    });
  } catch (error) {
    console.error("[wacalls] no se pudo dejar la llamada en el chat", error);
  }
}

function duracionEnSegundos(llamada: { startedAt?: number; endedAt?: number }) {
  if (!llamada.startedAt || !llamada.endedAt || llamada.endedAt <= llamada.startedAt) {
    return 0;
  }
  return Math.round((llamada.endedAt - llamada.startedAt) / 1000);
}

/**
 * Qué pasó, en palabras.
 *
 * El texto arranca SIEMPRE con "Llamada saliente" o "Llamada entrante" porque ese es el formato
 * que el chat ya sabe dibujar como una nota de llamada (ver getCallMessageSummary): la misma
 * frase sirve para el historial del lead en Llamadas y para la burbuja en la conversación, sin
 * guardar el dato dos veces.
 *
 * En las que se hablaron va la duración: al clasificar una llamada de hace un rato, "4 min" es lo
 * que le permite a la asesora acordarse de cuál fue.
 */
function comoFue(saliente: boolean, huboContacto: boolean, endReason: string, segundos: number) {
  const cabecera = saliente ? "Llamada saliente" : "Llamada entrante";

  if (huboContacto) {
    const duracion =
      segundos >= 60 ? `${Math.floor(segundos / 60)} min ${segundos % 60}s` : `${segundos}s`;
    return `${cabecera} · ${duracion}`;
  }

  if (!saliente) {
    return `${cabecera} · perdida`;
  }

  switch (endReason) {
    case "timeout":
      return `${cabecera} · no contestó`;
    case "declined":
      return `${cabecera} · rechazada`;
    case "busy":
      return `${cabecera} · ocupado`;
    case "do_not_disturb":
      return `${cabecera} · tenía no molestar`;
    case "cancelled":
      return `${cabecera} · se cortó antes de que atendiera`;
    default:
      return `${cabecera} · sin contacto`;
  }
}

/*
  El tope de una grabacion. 200 MB son unas 17 horas de audio: ninguna llamada llega, pero un
  archivo anomalo no puede llenar el disco del servidor.
*/
const MAX_BYTES_GRABACION = 200 * 1024 * 1024;

/**
 * Trae el WAV de la llamada desde WaCalls y lo deja en /uploads/grabaciones.
 *
 * Solo hay grabacion para las llamadas hechas desde el marcador del CRM: son las unicas cuyo audio
 * pasa por WaCalls. Una llamada desde el celular llega igual a este buzon y aca no encuentra nada
 * que bajar, que es lo esperado -no un error-.
 *
 * Se reintenta porque el archivo se termina de escribir cuando la llamada se cierra, en paralelo
 * con este aviso: el primer pedido puede llegar antes de que el WAV este completo.
 *
 * No rompe nada si falla: la llamada ya quedo anotada. Se pierde el audio, no el registro.
 */
async function guardarLaGrabacion(input: { attemptId: string; sessionId: string; callId: string }) {
  const base = getWaCallsBaseUrl();
  const token = process.env.WACALLS_API_TOKEN?.trim();
  if (!base || !token) {
    return;
  }

  const direccion = `${base}/api/sessions/${encodeURIComponent(input.sessionId)}/calls/${encodeURIComponent(input.callId)}/recording`;

  for (const espera of [0, 2000, 5000]) {
    if (espera) {
      await new Promise((resolver) => setTimeout(resolver, espera));
    }

    try {
      const respuesta = await fetch(direccion, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(60000),
      });

      if (respuesta.status === 404) {
        const texto = await respuesta.text().catch(() => "");
        // Con la grabacion apagada en WaCalls no tiene sentido insistir.
        if (texto.includes("recording disabled")) {
          return;
        }
        continue;
      }
      if (!respuesta.ok) {
        continue;
      }

      const largoDeclarado = Number(respuesta.headers.get("content-length") ?? "0");
      if (largoDeclarado > MAX_BYTES_GRABACION) {
        console.warn(`[wacalls] grabacion demasiado grande (${largoDeclarado} bytes), no se guarda`);
        return;
      }

      const audio = Buffer.from(await respuesta.arrayBuffer());
      // 44 bytes es la cabecera sola: el archivo existe pero no se grabo nada adentro.
      if (audio.length <= 44 || audio.length > MAX_BYTES_GRABACION) {
        return;
      }

      const nombre = `${input.callId.replace(/[^A-Za-z0-9_-]/g, "-")}.wav`;
      const carpeta = path.join(process.cwd(), "public", "uploads", "grabaciones");
      await mkdir(carpeta, { recursive: true });
      await writeFile(path.join(carpeta, nombre), audio);

      await prisma.callAttempt.update({
        where: { id: input.attemptId },
        data: { recordingUrl: `/uploads/grabaciones/${nombre}` },
      });

      console.info(`[wacalls] grabacion guardada: ${nombre} (${Math.round(audio.length / 1024)} KB)`);
      revalidatePath("/cliente/llamadas");

      /*
        Si hablaron, la llamada se pasa a texto y se resume ya: cuando la asesora abra "¿Cómo quedó?"
        la sugerencia esta lista. Si falla, se reintenta sola al abrir el formulario.
      */
      const intento = await prisma.callAttempt.findUnique({ where: { id: input.attemptId }, select: { result: true } });
      if (intento?.result === CALL_RESULT_PENDING) {
        await transcribirYResumirLlamada(input.attemptId).catch((error) =>
          console.warn("[wacalls] no se pudo transcribir la grabacion", error),
        );
      }
      return;
    } catch (error) {
      console.warn("[wacalls] no se pudo traer la grabacion", error);
    }
  }
}

