import { Prisma } from "@prisma/client";

import { leerConfigSeguimiento } from "@/features/seguimiento-inteligente/servicios/config";
import { corteDeLaConfig, filtroSinReactivar } from "@/features/seguimiento-inteligente/servicios/reactivacion";
import { CacheConTtl } from "@/lib/cache-en-memoria";
import { prisma } from "@/lib/prisma";

import { armarAlarma, type AlarmaDeHoy } from "../dominio/semana";

/**
 * LA ALARMA DE HOY de Recuperación: tareas de asesora vencidas (o que vencen en 24 h) sin hacer.
 * Mismo criterio que el tope (seguimiento-inteligente/servicios/tope.ts): EmbudoLead con accion
 * "tarea_asesora", no exterior, contacto abierto, sin mensaje de una persona después de creada
 * (salvo la Recuperación 72 h, que se da por hecha con llamada y audio). Sin las que van a
 * reactivación ("Llamar solo las de 7 días o menos"). La asesora es la del plan del tope o, sin
 * plan, la dueña del chat. Una consulta agrupada, 5 minutos en memoria.
 */

const cache = new CacheConTtl<AlarmaDeHoy | null>({ ttlMs: 5 * 60_000, maxEntradas: 20 });

type Fila = { asesora: string | null; total: bigint | number; llamadas: bigint | number };

export function leerAlarmaDeHoy(workspaceId: string): Promise<AlarmaDeHoy | null> {
  return cache.obtener(workspaceId, () => cargar(workspaceId));
}

async function cargar(workspaceId: string): Promise<AlarmaDeHoy | null> {
  const ahora = new Date();
  const config = await leerConfigSeguimiento(workspaceId);
  const finDelDia = new Date(ahora.getTime() + 24 * 3_600_000);
  const filas = await prisma.$queryRaw<Fila[]>(Prisma.sql`
    SELECT u."name" AS "asesora", count(*) AS "total",
           count(*) FILTER (WHERE l."accionDatos"->>'motivo' = 'recuperacion_72h') AS "llamadas"
      FROM "EmbudoLead" l
      JOIN "Conversation" c ON c."id" = l."conversationId"
      JOIN "Contact" ct ON ct."id" = c."contactId"
      LEFT JOIN "User" u ON u."id" = COALESCE(l."accionDatos"->'tope'->>'para', c."assignedToUserId")
     WHERE l."workspaceId" = ${workspaceId}
       AND l."accion" = 'tarea_asesora'
       AND l."exterior" = false
       AND ct."crmStage"::text NOT IN ('GANADO', 'PERDIDO')
       AND (l."tareaVence" IS NULL OR l."tareaVence" <= ${finDelDia})
       ${filtroSinReactivar(corteDeLaConfig(config, ahora))}
       AND (l."accionDatos"->>'motivo' = 'recuperacion_72h' OR NOT EXISTS (
         SELECT 1 FROM "Message" m
          WHERE m."conversationId" = l."conversationId" AND m."direction" = 'OUTBOUND'
            AND m."rawPayload"->>'source' IN ('manual', 'instance')
            AND m."createdAt" > COALESCE(l."accionEn", l."updatedAt")))
     GROUP BY 1`);
  let vencidas = 0;
  let llamadas72h = 0;
  const porAsesora: Array<{ asesora: string; tareas: number }> = [];
  for (const fila of filas) {
    const total = Number(fila.total);
    vencidas += total;
    llamadas72h += Number(fila.llamadas);
    if (fila.asesora) porAsesora.push({ asesora: fila.asesora.trim().split(/\s+/)[0] || fila.asesora, tareas: total });
  }
  return armarAlarma({ vencidas, llamadas72h, porAsesora, tope: config.tareas.maxPorAsesoraDia });
}
