import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * EL FRENO DE LOS MENSAJES AUTOMÁTICOS: nada automático a quien no leyó lo anterior.
 *
 * Regla de Alex (02-10-2026). En un chat el agente mandó dos seguimientos ("Para continuar…" y
 * "Si deseas adquirirlo…") a una clienta que no había leído ni el mensaje del precio: chulitos
 * grises. Eso es lo que hace que la gente reporte la línea y WhatsApp la bloquee, y como no
 * usamos la API oficial el riesgo de bloqueo es alto.
 *
 * Aplica a todo lo que sale SIN que el cliente haya escrito: los seguimientos del Agente V3, los
 * seguimientos programados y el mensaje de reactivación. Las respuestas a algo que escribió el
 * cliente NO pasan por acá: esas se contestan siempre.
 *
 * Dos frenos:
 *  - `no_leido`: el último mensaje nuestro no está leído. Un audio escuchado también cuenta como
 *    leído: WhatsApp lo informa con el mismo recibo y se guarda igual.
 *  - `dos_sin_respuesta`: ya salieron 2 automáticos seguidos sin que el cliente conteste. El
 *    tercero no sale aunque los haya leído: si leyó dos y no contestó, un tercero es insistir.
 *
 * Costo conocido: hay clientes con la confirmación de lectura apagada en WhatsApp, y sus mensajes
 * nunca pasan a "leído" aunque los lean (medido el 02-10-2026: 1 de cada 4 chats que responden).
 * A ellos ya no les sale ningún automático. Se aceptó así: es preferible no escribirle a quien no
 * sabemos si leyó a arriesgar la línea.
 */

/** Los `rawPayload.source` de los mensajes que salieron solos, sin que nadie los escribiera. */
export const ORIGENES_AUTOMATICOS = [
  "agente-v3-seguimiento",
  "agente-v3-seguimiento-ia",
  "follow",
  "automation_reactivation",
] as const;

const MAXIMO_AUTOMATICOS_SEGUIDOS = 2;

/** Mensajes nuestros a menos de esto uno del otro son UN envío (un seguimiento con dos textos). */
const MISMO_ENVIO_MS = 60_000;

/** Cuántos mensajes hacia atrás se miran. Alcanza de sobra para encontrar lo último del cliente. */
const MENSAJES_A_MIRAR = 30;

export type MotivoDeFreno = "no_leido" | "dos_sin_respuesta";

export type FrenoDeAutomatico = { enviar: true } | { enviar: false; motivo: MotivoDeFreno };

type Fila = {
  direction: "INBOUND" | "OUTBOUND";
  status: string;
  readAt: Date | null;
  createdAt: Date;
  origen: string | null;
};

/**
 * ¿Puede salir un mensaje automático en este chat?
 *
 * Se pasa la conversación cuando se la conoce. Los seguimientos programados solo saben el
 * contacto y, a veces, la línea: entonces se mira lo que ese contacto tiene en esa línea (o en
 * todas, si no hay línea).
 */
export async function revisarFrenoDeAutomatico(input: {
  conversationId?: string | null;
  contactId?: string | null;
  channelId?: string | null;
}): Promise<FrenoDeAutomatico> {
  const donde = input.conversationId
    ? Prisma.sql`m."conversationId" = ${input.conversationId}`
    : input.contactId
      ? input.channelId
        ? Prisma.sql`m."contactId" = ${input.contactId} AND m."channelId" = ${input.channelId}`
        : Prisma.sql`m."contactId" = ${input.contactId}`
      : null;
  if (!donde) {
    return { enviar: true };
  }

  // Solo `->>'source'` del rawPayload, no el payload entero: es lo pesado de la tabla.
  const filas = await prisma.$queryRaw<Fila[]>(Prisma.sql`
    SELECT m."direction", m."status"::text AS "status", m."readAt", m."createdAt",
           m."rawPayload"->>'source' AS "origen"
    FROM public."Message" m
    WHERE ${donde} AND m."type" <> 'SYSTEM' AND m."deletedAt" IS NULL
    ORDER BY m."createdAt" DESC
    LIMIT ${MENSAJES_A_MIRAR}
  `);

  return decidirFreno(filas);
}

/** La decisión, aparte de la consulta, para poder probarla con filas armadas a mano. */
export function decidirFreno(filasDeLaMasNueva: Fila[]): FrenoDeAutomatico {
  const ultimo = filasDeLaMasNueva[0];
  // Sin mensajes, o el último lo escribió el cliente: no hay nada nuestro sin leer.
  if (!ultimo || ultimo.direction === "INBOUND") {
    return { enviar: true };
  }

  const leido = ultimo.status === "READ" || ultimo.readAt !== null;
  if (!leido) {
    return { enviar: false, motivo: "no_leido" };
  }

  // Automáticos que salieron desde lo último que escribió el cliente, contando como uno solo
  // los textos que salieron juntos.
  let envios = 0;
  let anterior: Date | null = null;
  for (const fila of filasDeLaMasNueva) {
    if (fila.direction === "INBOUND") {
      break;
    }
    if (!fila.origen || !(ORIGENES_AUTOMATICOS as readonly string[]).includes(fila.origen)) {
      continue;
    }
    if (!anterior || anterior.getTime() - fila.createdAt.getTime() > MISMO_ENVIO_MS) {
      envios += 1;
    }
    anterior = fila.createdAt;
  }
  if (envios >= MAXIMO_AUTOMATICOS_SEGUIDOS) {
    return { enviar: false, motivo: "dos_sin_respuesta" };
  }

  return { enviar: true };
}
