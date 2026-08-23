import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { normalizePhoneFromJid } from "@/lib/evolution-webhook";
import { CALL_RESULT_PENDING } from "@/features/crm/domain/crm-config";

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

/** Margen de reloj aceptado para la firma. Corta los reenvíos de un pedido viejo capturado. */
const TOLERANCIA_SEGUNDOS = 300;

type WaCallsWebhookBody = {
  event?: string;
  call?: {
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

  // WaCalls también avisa cuando empieza a sonar y cuando se conecta. Acá solo interesa el final.
  // Se responde 200 igual: un 4xx haría que WaCalls reintente tres veces un aviso que está bien.
  if (payload.event !== "call.ended") {
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

  /**
   * La ficha se busca por teléfono. Si el número no está en el CRM no se crea una ficha nueva:
   * una llamada a un número suelto no es un lead, y crear fichas desde acá llenaría el embudo de
   * equivocaciones de marcado y de llamadas a proveedores.
   */
  const contacto = await prisma.contact.findFirst({
    where: {
      phoneNumber: telefono,
      // El mismo teléfono puede existir en dos negocios distintos. Sin acotarlo, una llamada
      // podría anotarse en el equivocado; con WACALLS_WORKSPACE_ID puesto, eso deja de ser
      // posible. Sin la variable sigue funcionando como antes (el más reciente).
      ...(workspaceFijado ? { workspaceId: workspaceFijado } : {}),
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, workspaceId: true },
  });
  if (!contacto) {
    console.info(`[wacalls] llamada con ${telefono}: no hay ficha en el CRM`);
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

  await prisma.callAttempt.create({
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
      summary: comoFue(saliente, huboContacto, llamada.endReason ?? "", duracionEnSegundos(llamada)),
      calledAt,
    },
  });

  console.info(
    `[wacalls] anotada llamada ${saliente ? "saliente" : "entrante"} a ${telefono} (${llamada.endReason}) como ${result}, intento ${intentosPrevios + 1}`,
  );

  revalidatePath("/cliente/llamadas");
  revalidatePath("/cliente/crm/mi-dia");
  return NextResponse.json({ ok: true, registrada: true });
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

