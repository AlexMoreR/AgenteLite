import { prisma } from "@/lib/prisma";

import type { EstadoDeLaCharla } from "./decidir";

/**
 * En qué va cada conversación: producto, paso y qué flujos ya se enviaron.
 *
 * Vive en AppSetting, una fila por conversación, para no migrar la base de producción mientras el
 * V3 se prueba. Cuando el V3 reemplace al V2 esto se muda a una columna de Conversation, que es su
 * lugar natural; hasta entonces, una fila suelta no le hace daño a nadie.
 *
 * Es el dato que el V2 nunca guardó bien y por eso se repetía: sin saber qué flujo ya salió, el
 * agente reenviaba el mismo catálogo dos veces en la misma charla.
 */

const CLAVE = "agente-v3:estado:";

/** Llave de la fila de estado de una conversación en AppSetting. */
export function claveDeEstado(conversationId: string): string {
  return `${CLAVE}${conversationId}`;
}

/**
 * ¿El V3 atendió alguna vez esta conversación? (tiene su fila de estado)
 *
 * El motor la guarda en cada mensaje que atiende. Un chat sin fila nunca pasó por el V3: el aviso del
 * Supervisor a una asesora, un chat que abrió una persona. Ahí no van los recordatorios del libro.
 */
export async function elV3AtendioLaCharla(conversationId: string): Promise<boolean> {
  const fila = await prisma.appSetting.findUnique({ where: { key: `${CLAVE}${conversationId}` }, select: { key: true } });
  return Boolean(fila);
}

export async function leerEstado(conversationId: string): Promise<EstadoDeLaCharla> {
  const vacio: EstadoDeLaCharla = {
    productoActivo: null,
    pasoActual: null,
    flujosEnviados: [],
    esPrimerMensaje: true,
    seguimientosEnviados: [],
    avisoDePausaEnviado: false,
  };
  const fila = await prisma.appSetting.findUnique({ where: { key: `${CLAVE}${conversationId}` } });
  if (!fila?.value) {
    /*
      Sin estado guardado NO significa que sea el primer mensaje de la conversación.

      Significa que el agente todavía no ha atendido a nadie ahí. Es distinto: un chat que abrimos
      NOSOTROS -una campaña, una asesora escribiendo primero- ya tiene historia cuando el cliente
      por fin contesta.

      Pasó tal cual: le escribimos a las 17:42 con fotos y precio, salieron los dos seguimientos, y
      cuando ella contestó a las 19:49 el agente le mandó la BIENVENIDA como si acabara de llegar,
      dos horas y tres mensajes después (Alex, 25-09-2026).

      Así que se mira lo único que de verdad responde la pregunta: ¿ya le dijimos algo a esta
      persona? Si sí, no es un primer mensaje y no va el saludo.
    */
    const yaLeHablamos = await prisma.message.count({
      where: { conversationId, direction: "OUTBOUND", type: { not: "SYSTEM" } },
    });
    return { ...vacio, esPrimerMensaje: yaLeHablamos === 0 };
  }
  return parsearEstado(fila.value) ?? vacio;
}

/** El estado guardado en la fila, o null si no se puede leer. */
function parsearEstado(value: string): EstadoDeLaCharla | null {
  try {
    const guardado = JSON.parse(value) as Partial<EstadoDeLaCharla>;
    return {
      productoActivo: typeof guardado.productoActivo === "string" ? guardado.productoActivo : null,
      pasoActual: (guardado.pasoActual as EstadoDeLaCharla["pasoActual"]) ?? null,
      flujosEnviados: Array.isArray(guardado.flujosEnviados)
        ? guardado.flujosEnviados.filter((id): id is string => typeof id === "string")
        : [],
      esPrimerMensaje: guardado.esPrimerMensaje === true,
      seguimientosEnviados: Array.isArray(guardado.seguimientosEnviados)
        ? guardado.seguimientosEnviados.filter((minutos): minutos is number => typeof minutos === "number")
        : [],
      avisoDePausaEnviado: guardado.avisoDePausaEnviado === true,
    };
  } catch {
    return null;
  }
}

/** El JSON exacto que se guarda en la fila de estado. */
export function serializarEstado(estado: EstadoDeLaCharla): string {
  return JSON.stringify({
    productoActivo: estado.productoActivo,
    pasoActual: estado.pasoActual,
    // Se recortan: una charla larga no necesita recordar cincuenta envíos, y la fila no crece sola.
    flujosEnviados: estado.flujosEnviados.slice(-20),
    esPrimerMensaje: estado.esPrimerMensaje,
    seguimientosEnviados: estado.seguimientosEnviados ?? [],
    avisoDePausaEnviado: estado.avisoDePausaEnviado === true,
  });
}

export async function guardarEstado(conversationId: string, estado: EstadoDeLaCharla): Promise<void> {
  const value = serializarEstado(estado);
  await prisma.appSetting.upsert({
    where: { key: `${CLAVE}${conversationId}` },
    create: { key: `${CLAVE}${conversationId}`, value },
    update: { value },
  });
}

export type ReservaDelSeguimiento = "reservado" | "ya_salio" | "alguien_escribio" | "chat_pausado" | "sin_estado";

/**
 * EL CANDADO DEL RELOJ (tarjeta yp8xzwvm, 4-nov-2026): reserva un recordatorio ANTES de enviarlo.
 *
 * El 3-nov salieron tres recordatorios dos veces en el mismo minuto ("Así te confirmo el envío 🚚 ¿En qué
 * ciudad lo recibirías?"). El reloj leía el estado, enviaba y solo DESPUÉS anotaba "ya salió": si dos vueltas
 * se cruzaban, las dos enviaban. Ahora, dentro de una transacción con candado por chat, se vuelve a leer todo
 * (que no haya salido, que nadie haya escrito desde `ultimoEn` y que el chat no esté pausado) y se anota.
 * Recién después se envía. Si otra vuelta ya lo reservó, devuelve "ya_salio" y no sale.
 *
 * Si el envío falla después de reservar, NO se reintenta: no se sabe si salió, y reintentar es justo lo que
 * duplica. El siguiente recordatorio sigue su curso.
 */
export async function reservarSeguimientoV3(input: {
  conversationId: string;
  /** El recordatorio que va a salir (sus minutos). */
  minutos: number;
  /** Los que quedan marcados con él (los vencidos del paso, hasta este). */
  marcar: number[];
  /** El último mensaje (no SYSTEM) que vio el reloj: si cambió, alguien escribió. */
  ultimoEn: Date;
}): Promise<ReservaDelSeguimiento> {
  const clave = `${CLAVE}${input.conversationId}`;
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`agente-v3:seguimiento:${input.conversationId}`}::text))`;

    const charla = await tx.conversation.findUnique({
      where: { id: input.conversationId },
      select: { automationPaused: true },
    });
    if (!charla || charla.automationPaused) return "chat_pausado";

    const ultimo = await tx.message.findFirst({
      where: { conversationId: input.conversationId, type: { not: "SYSTEM" } },
      orderBy: { createdAt: "desc" },
      select: { direction: true, createdAt: true },
    });
    if (!ultimo || ultimo.direction !== "OUTBOUND" || ultimo.createdAt.getTime() !== input.ultimoEn.getTime()) {
      return "alguien_escribio";
    }

    const fila = await tx.appSetting.findUnique({ where: { key: clave } });
    const estado = fila?.value ? parsearEstado(fila.value) : null;
    if (!estado) return "sin_estado";
    const yaSalieron = estado.seguimientosEnviados ?? [];
    if (yaSalieron.includes(input.minutos)) return "ya_salio";

    await tx.appSetting.update({
      where: { key: clave },
      data: {
        value: serializarEstado({ ...estado, seguimientosEnviados: [...new Set([...yaSalieron, ...input.marcar])] }),
      },
    });
    return "reservado";
  });
}
