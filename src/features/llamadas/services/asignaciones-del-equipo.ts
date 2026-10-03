import { prisma } from "@/lib/prisma";

/**
 * Dos columnas del tablero "Cómo viene cada una" (Alex, 02-10-2026), que salen del registro de
 * asignaciones de cada chat:
 *
 *  - ASIGNADOS HOY: chats que le cayeron hoy a cada una, por el reparto o porque alguien se los
 *    pasó. No cuentan los que ella tomó al responder (no se los asignaron: se los quedó).
 *  - PRIMERA RESPUESTA: de los chats que se le asignaron en los últimos 7 días, cuánto tardó en
 *    promedio en escribir el primer mensaje desde que se lo asignaron. Escribir es mandar desde el
 *    CRM o desde el celular de la línea: lo que contesta el agente no cuenta.
 *
 * A quién se le asignó: desde el 02-10-2026 viaja como dato en la nota (`assigneeUserId`). Las
 * notas más viejas solo lo tienen en el texto ("Magilus asignó a Genesis Moreno", "Ingrid Sanchez
 * auto-asignado a esta conversación"), y para esas se reconoce el nombre.
 */

export type AsignacionesDelEquipo = {
  asignadosHoy: Map<string, number>;
  /** Promedio en minutos; sin entrada si no tuvo asignaciones respondidas en los 7 días. */
  minutosHastaPrimeraRespuesta: Map<string, number>;
};

type Miembro = { userId: string; nombre: string };

function quienRecibio(texto: string, payloadAsignada: string | null, miembros: Miembro[]): string | null {
  if (payloadAsignada) {
    return payloadAsignada;
  }
  const minusculas = texto.toLowerCase();
  if (minusculas.includes("tomó esta conversación") || minusculas.includes("quitó la asignación")) {
    return null;
  }
  // El nombre más largo primero: "Maria Camila Bautista" antes que "Maria".
  const ordenados = [...miembros].sort((a, b) => b.nombre.length - a.nombre.length);
  for (const miembro of ordenados) {
    const nombre = miembro.nombre.toLowerCase();
    if (!nombre) continue;
    if (
      minusculas.includes(`asignó a ${nombre}`) ||
      minusculas.startsWith(`${nombre} auto-asignado`) ||
      minusculas.startsWith(`${nombre} se asignó`)
    ) {
      return miembro.userId;
    }
  }
  return null;
}

export async function leerAsignacionesDelEquipo(input: {
  workspaceId: string;
  inicioDeHoy: Date;
  inicioDeLaSemana: Date;
  miembros: Miembro[];
}): Promise<AsignacionesDelEquipo> {
  const notas = await prisma.$queryRaw<
    Array<{ conversationId: string; createdAt: Date; content: string | null; asignada: string | null; tomada: boolean }>
  >`
    SELECT m."conversationId", m."createdAt", m."content",
           m."rawPayload"->>'assigneeUserId' AS "asignada",
           (m."content" ILIKE '%tomó esta conversación%') AS "tomada"
    FROM "Message" m
    WHERE m."workspaceId" = ${input.workspaceId}
      AND m."type" = 'SYSTEM'
      AND m."createdAt" >= ${input.inicioDeLaSemana}
      AND m."rawPayload"->>'kind' = 'assigned'
  `;

  const asignaciones = notas
    .filter((nota) => !nota.tomada)
    .map((nota) => ({
      conversationId: nota.conversationId,
      en: nota.createdAt,
      userId: quienRecibio(nota.content ?? "", nota.asignada, input.miembros),
    }))
    .filter((fila): fila is { conversationId: string; en: Date; userId: string } => Boolean(fila.userId));

  const asignadosHoy = new Map<string, Set<string>>();
  for (const fila of asignaciones) {
    if (fila.en >= input.inicioDeHoy) {
      if (!asignadosHoy.has(fila.userId)) asignadosHoy.set(fila.userId, new Set());
      asignadosHoy.get(fila.userId)!.add(fila.conversationId);
    }
  }

  // Lo que escribió una persona en esos chats (no el agente): "manual" desde el CRM, "instance"
  // desde el celular de la línea. Solo de los chats asignados en la semana, así es poco.
  const chats = [...new Set(asignaciones.map((fila) => fila.conversationId))];
  const escritos = chats.length
    ? await prisma.$queryRaw<Array<{ conversationId: string; createdAt: Date }>>`
        SELECT m."conversationId", m."createdAt"
        FROM "Message" m
        WHERE m."conversationId" = ANY(${chats})
          AND m."direction" = 'OUTBOUND'
          AND m."type" <> 'SYSTEM'
          AND m."createdAt" >= ${input.inicioDeLaSemana}
          AND COALESCE(m."rawPayload"->>'source', '') IN ('manual', 'instance')
        ORDER BY m."createdAt" ASC
      `
    : [];
  const escritosPorChat = new Map<string, Date[]>();
  for (const fila of escritos) {
    if (!escritosPorChat.has(fila.conversationId)) escritosPorChat.set(fila.conversationId, []);
    escritosPorChat.get(fila.conversationId)!.push(fila.createdAt);
  }

  const demoras = new Map<string, number[]>();
  for (const fila of asignaciones) {
    const primera = escritosPorChat.get(fila.conversationId)?.find((cuando) => cuando >= fila.en);
    if (!primera) continue;
    if (!demoras.has(fila.userId)) demoras.set(fila.userId, []);
    demoras.get(fila.userId)!.push((primera.getTime() - fila.en.getTime()) / 60_000);
  }

  return {
    asignadosHoy: new Map([...asignadosHoy].map(([userId, set]) => [userId, set.size])),
    minutosHastaPrimeraRespuesta: new Map(
      [...demoras].map(([userId, lista]) => [userId, lista.reduce((a, b) => a + b, 0) / lista.length]),
    ),
  };
}
