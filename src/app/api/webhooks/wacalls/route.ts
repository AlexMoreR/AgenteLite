import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { normalizePhoneFromJid } from "@/lib/evolution-webhook";

export const dynamic = "force-dynamic";

/**
 * Buzón de WaCalls: registra solo las llamadas QUE NADIE ATENDIÓ.
 *
 * WaCalls avisa acá cada vez que termina una llamada. De todos los finales posibles, este buzón
 * anota únicamente los que significan "no hablé con el cliente" (no contestó, rechazó, ocupado,
 * no molestar, o la asesora cortó antes de que atendieran). Son los más comunes y los más
 * aburridos de cargar a mano, y sobre todo son los únicos que el CRM puede deducir SIN inventar
 * nada.
 *
 * Cuando la llamada SÍ se atendió no se anota nada a propósito. El resultado de una llamada
 * atendida —interesada, lo piensa, perdido— mueve la etapa del lead y dispara seguimientos, y eso
 * no se puede adivinar del audio: lo elige la asesora. Un registro automático equivocado ahí no
 * sería un dato de más, sería un lead movido de etapa por error.
 *
 * Por eso también "no contestó" es seguro de automatizar: es el único resultado del Playbook que
 * NO tiene efecto sobre la etapa (ver CALL_RESULT_STAGE_EFFECT en crm-config).
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

  // Solo las llamadas que HIZO la asesora. Un intento de llamada es algo que hicimos nosotros;
  // que un cliente nos llame y no alcancemos a atender no es un intento nuestro.
  if (llamada.direction !== "outbound") {
    return NextResponse.json({ ok: true, ignorado: "entrante" });
  }

  if (!FINALES_SIN_CONTACTO.has((llamada.endReason ?? "").trim())) {
    return NextResponse.json({ ok: true, ignorado: "atendida" });
  }

  const telefono = normalizePhoneFromJid(llamada.peer ?? null);
  if (!telefono) {
    return NextResponse.json({ ok: true, ignorado: "sin teléfono" });
  }

  /**
   * La ficha se busca por teléfono. Si el número no está en el CRM no se crea una ficha nueva:
   * una llamada sin contestar a un número suelto no es un lead, y crear fichas desde acá llenaría
   * el embudo de equivocaciones de marcado.
   */
  const contacto = await prisma.contact.findFirst({
    where: { phoneNumber: telefono },
    orderBy: { updatedAt: "desc" },
    select: { id: true, workspaceId: true },
  });
  if (!contacto) {
    console.info(`[wacalls] llamada sin contestar a ${telefono}: no hay ficha en el CRM`);
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

  const intentosPrevios = await prisma.callAttempt.count({
    where: { workspaceId: contacto.workspaceId, contactId: contacto.id },
  });

  await prisma.callAttempt.create({
    data: {
      workspaceId: contacto.workspaceId,
      contactId: contacto.id,
      // Queda sin autora: WaCalls sabe desde qué línea se llamó, no qué persona marcó. Inventar
      // una asesora acá le atribuiría llamadas a alguien que capaz no las hizo.
      calledByUserId: null,
      attemptNumber: intentosPrevios + 1,
      result: "no_contesto",
      summary: motivoEnPalabras(llamada.endReason ?? ""),
      calledAt,
    },
  });

  console.info(
    `[wacalls] anotada llamada sin contestar a ${telefono} (${llamada.endReason}) como intento ${intentosPrevios + 1}`,
  );

  revalidatePath("/cliente/llamadas");
  revalidatePath("/cliente/crm/mi-dia");
  return NextResponse.json({ ok: true, registrada: true });
}

/** El motivo, como lo diría una persona. Es lo que la asesora ve en el historial del lead. */
function motivoEnPalabras(endReason: string) {
  switch (endReason) {
    case "timeout":
      return "No contestó (llamada por WaCalls)";
    case "declined":
      return "Rechazó la llamada (WaCalls)";
    case "busy":
      return "Ocupado (WaCalls)";
    case "do_not_disturb":
      return "Tenía el teléfono en no molestar (WaCalls)";
    case "cancelled":
      return "Se cortó antes de que atendiera (WaCalls)";
    default:
      return "Sin contacto (WaCalls)";
  }
}
