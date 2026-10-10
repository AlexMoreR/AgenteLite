import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * LAS TAREAS DEL SEGUIMIENTO INTELIGENTE, para Mi día (las de cada asesora) y el Supervisor (las
 * que no tienen dueña y el resumen). Solo lectura.
 *
 * Una tarea es la foto del lead con accion = "tarea_asesora". Se da por HECHA si una persona le
 * escribió al cliente después de que se creó (aunque el reloj todavía no la haya recalculado).
 */

export type TareaDeSeguimiento = {
  conversationId: string;
  nombre: string;
  telefonoFinal: string | null;
  prioridad: string;
  vence: Date | null;
  motivo: string;
  mensajeSugerido: string | null;
  temperatura: string | null;
  producto: string | null;
  asesoraId: string | null;
  asesoraNombre: string | null;
  modo: string;
  toque: string | null;
  /** Tope diario: "propia" | "redistribuida" | "pospuesta" | "sin_duena" (null = todavía sin plan). */
  topeEstado: string | null;
  /** Para quién quedó la tarea por el tope y de quién era (si se pasó). */
  paraNombre: string | null;
  deNombre: string | null;
  pospuestaHasta: Date | null;
};

type Fila = {
  conversationId: string;
  nombre: string | null;
  telefono: string | null;
  tareaPrioridad: string | null;
  tareaVence: Date | null;
  accionDatos: Record<string, unknown> | null;
  temperatura: string | null;
  productoInteres: string | null;
  asesoraId: string | null;
  asesoraNombre: string | null;
  paraNombre: string | null;
  deNombre: string | null;
};

function aTarea(fila: Fila): TareaDeSeguimiento {
  const datos = fila.accionDatos ?? {};
  const tope = (datos.tope && typeof datos.tope === "object" ? datos.tope : {}) as Record<string, unknown>;
  const telefono = (fila.telefono ?? "").replace(/\D/g, "");
  return {
    conversationId: fila.conversationId,
    nombre: fila.nombre?.trim() || "Cliente",
    telefonoFinal: telefono.length >= 7 && telefono.length <= 13 ? telefono.slice(-4) : null,
    prioridad: fila.tareaPrioridad ?? "C",
    vence: fila.tareaVence ? new Date(fila.tareaVence) : null,
    motivo: typeof datos.motivo === "string" ? datos.motivo : "",
    mensajeSugerido: typeof datos.mensajeSugerido === "string" ? datos.mensajeSugerido : null,
    temperatura: fila.temperatura,
    producto: fila.productoInteres,
    asesoraId: fila.asesoraId,
    asesoraNombre: fila.asesoraNombre,
    modo: typeof datos.modo === "string" ? datos.modo : "sombra",
    toque: typeof datos.toque === "string" ? datos.toque : null,
    topeEstado: typeof tope.estado === "string" ? tope.estado : null,
    paraNombre: fila.paraNombre,
    deNombre: fila.deNombre,
    pospuestaHasta: typeof tope.pospuestaHasta === "string" ? new Date(tope.pospuestaHasta) : null,
  };
}

async function leerTareas(input: {
  workspaceId: string;
  hasta: Date;
  asesoraId?: string | null;
  sinDuena?: boolean;
  soloActivas?: boolean;
  ocultarPospuestas?: boolean;
  limite?: number;
}): Promise<TareaDeSeguimiento[]> {
  const filas = await prisma.$queryRaw<Fila[]>(Prisma.sql`
    SELECT l."conversationId", ct."name" AS "nombre", ct."phoneNumber" AS "telefono", l."tareaPrioridad", l."tareaVence",
           l."accionDatos", l."temperatura", l."productoInteres", c."assignedToUserId" AS "asesoraId", u."name" AS "asesoraNombre",
           para."name" AS "paraNombre", de."name" AS "deNombre"
      FROM "EmbudoLead" l
      JOIN "Conversation" c ON c."id" = l."conversationId"
      JOIN "Contact" ct ON ct."id" = c."contactId"
      LEFT JOIN "User" u ON u."id" = c."assignedToUserId"
      LEFT JOIN "User" para ON para."id" = l."accionDatos"->'tope'->>'para'
      LEFT JOIN "User" de ON de."id" = l."accionDatos"->'tope'->>'de'
     WHERE l."workspaceId" = ${input.workspaceId}
       AND l."accion" = 'tarea_asesora'
       AND l."exterior" = false
       AND ct."crmStage"::text NOT IN ('GANADO', 'PERDIDO')
       AND (l."tareaVence" IS NULL OR l."tareaVence" <= ${input.hasta})
       ${input.soloActivas ? Prisma.sql`AND l."accionDatos"->>'modo' = 'activo'` : Prisma.empty}
       ${
         input.asesoraId
           ? /*
               Tope diario: la tarea es de quien dice el plan (la dueña o a quien se le pasó). Sin
               plan todavía, de la dueña del chat. Las pospuestas no aparecen hasta su día.
             */
             Prisma.sql`AND (
               (l."accionDatos"->'tope' IS NULL AND c."assignedToUserId" = ${input.asesoraId})
               OR (l."accionDatos"->'tope'->>'para' = ${input.asesoraId} AND l."accionDatos"->'tope'->>'estado' IN ('propia', 'redistribuida'))
             )`
           : Prisma.empty
       }
       ${input.ocultarPospuestas ? Prisma.sql`AND COALESCE(l."accionDatos"->'tope'->>'estado', '') <> 'pospuesta'` : Prisma.empty}
       ${input.sinDuena ? Prisma.sql`AND c."assignedToUserId" IS NULL` : Prisma.empty}
       AND NOT EXISTS (
         SELECT 1 FROM "Message" m
          WHERE m."conversationId" = l."conversationId" AND m."direction" = 'OUTBOUND'
            AND m."rawPayload"->>'source' IN ('manual', 'instance')
            AND m."createdAt" > COALESCE(l."accionEn", l."updatedAt"))
     ORDER BY l."tareaPrioridad" ASC, l."tareaVence" ASC NULLS LAST
     LIMIT ${input.limite ?? 50}`);
  return filas.map(aTarea);
}

/** Las de una asesora para hoy (vencidas o que vencen antes de terminar el día), solo modo activo. */
export async function leerTareasDeAsesora(workspaceId: string, asesoraId: string, ahora = new Date()): Promise<TareaDeSeguimiento[]> {
  const finDelDia = new Date(ahora.getTime() + 12 * 3_600_000);
  return leerTareas({ workspaceId, hasta: finDelDia, asesoraId, soloActivas: true, ocultarPospuestas: true, limite: 30 });
}

/** Las vencidas sin dueña (modo activo): el Supervisor las marca para asignar (NO reasigna). */
export async function leerTareasSinDuena(workspaceId: string, ahora = new Date()): Promise<TareaDeSeguimiento[]> {
  return leerTareas({ workspaceId, hasta: ahora, sinDuena: true, soloActivas: true, limite: 30 });
}

/** Todas las de hoy (sombra o activo), para la pantalla del Supervisor. */
export async function leerTareasParaSupervisor(workspaceId: string, ahora = new Date()): Promise<TareaDeSeguimiento[]> {
  return leerTareas({ workspaceId, hasta: new Date(ahora.getTime() + 12 * 3_600_000), limite: 60 });
}

/** El resumen del motor en las últimas 24 h: cuántas decisiones de cada tipo (para la pantalla). */
export async function resumenDelMotor(workspaceId: string, ahora = new Date()): Promise<Array<{ accion: string; modo: string; total: number }>> {
  const filas = await prisma.$queryRaw<Array<{ accion: string | null; modo: string | null; total: bigint | number }>>(Prisma.sql`
    SELECT e."datos"->>'accion' AS "accion", e."datos"->>'modo' AS "modo", count(*) AS "total"
      FROM "EmbudoEvento" e
     WHERE e."workspaceId" = ${workspaceId} AND e."tipo" = 'SIGUIENTE_ACCION' AND e."createdAt" > ${new Date(ahora.getTime() - 86_400_000)}
     GROUP BY 1, 2 ORDER BY 3 DESC`);
  return filas.map((fila) => ({ accion: fila.accion ?? "?", modo: fila.modo ?? "?", total: Number(fila.total) }));
}
