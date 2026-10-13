import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import type { ConfigSeguimientoInteligente } from "../dominio/config";
import { MOTIVO_RECUPERACION_72H, corteDeReactivacion } from "../dominio/reactivacion";

/**
 * "LLAMAR SOLO LAS DE 7 DÍAS O MENOS" en la base (la regla pura está en dominio/reactivacion.ts).
 *
 *  - `filtroSinReactivar`: el pedazo de SQL que saca de las listas (Mi día, tope, Supervisor,
 *    alarma de Recuperación) las tareas de la Recuperación 72 h cuyo cliente no escribe desde
 *    antes del corte. Va en consultas sobre "EmbudoLead" con alias `l`. Cada fila mira el índice
 *    Message[workspaceId, conversationId, direction, createdAt] (un rango corto, sin leer mensajes).
 *  - `marcarParaReactivar`: deja `accionDatos.paraReactivar` en esas tareas (y se lo quita a las
 *    que volvieron a escribir) para la futura campaña de reactivación. No envía nada.
 */

export function filtroSinReactivar(corte: Date | null): Prisma.Sql {
  if (!corte) return Prisma.empty;
  return Prisma.sql`AND NOT (
    l."accion" = 'tarea_asesora'
    AND COALESCE(l."accionDatos"->>'motivo', '') = ${MOTIVO_RECUPERACION_72H}
    AND NOT EXISTS (
      SELECT 1 FROM "Message" mr
       WHERE mr."workspaceId" = l."workspaceId" AND mr."conversationId" = l."conversationId"
         AND mr."direction" = 'INBOUND' AND mr."type" <> 'SYSTEM' AND mr."createdAt" >= ${corte}))`;
}

/** El corte de la config del negocio (null = regla apagada). */
export function corteDeLaConfig(config: ConfigSeguimientoInteligente, ahora = new Date()): Date | null {
  return corteDeReactivacion(ahora, config.recuperacion72h?.vencerTrasDias ?? 0);
}

const ultimaMarca = new Map<string, number>();

/** Cada 5 minutos desde el barrido del reloj. Nunca lanza. */
export async function marcarParaReactivar(
  workspaceId: string,
  config: ConfigSeguimientoInteligente,
  ahora = new Date(),
): Promise<{ marcadas: number; desmarcadas: number }> {
  const nada = { marcadas: 0, desmarcadas: 0 };
  const corte = corteDeLaConfig(config, ahora);
  if (!corte) return nada;
  if (ahora.getTime() - (ultimaMarca.get(workspaceId) ?? 0) < 4.5 * 60_000) return nada;
  ultimaMarca.set(workspaceId, ahora.getTime());
  try {
    const marca = JSON.stringify({ en: ahora.toISOString(), dias: config.recuperacion72h.vencerTrasDias });
    const marcadas = await prisma.$executeRaw(Prisma.sql`
      UPDATE "EmbudoLead" l
         SET "accionDatos" = COALESCE(l."accionDatos", '{}'::jsonb) || jsonb_build_object('paraReactivar', ${marca}::jsonb),
             "version" = l."version" + 1
       WHERE l."workspaceId" = ${workspaceId}
         AND l."accion" = 'tarea_asesora'
         AND l."accionDatos"->>'motivo' = ${MOTIVO_RECUPERACION_72H}
         AND l."accionDatos"->'paraReactivar' IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM "Message" mr
            WHERE mr."workspaceId" = l."workspaceId" AND mr."conversationId" = l."conversationId"
              AND mr."direction" = 'INBOUND' AND mr."type" <> 'SYSTEM' AND mr."createdAt" >= ${corte})`);
    // El cliente volvió a escribir: ya no es para reactivar (vuelve a las listas por el filtro).
    const desmarcadas = await prisma.$executeRaw(Prisma.sql`
      UPDATE "EmbudoLead" l
         SET "accionDatos" = l."accionDatos" - 'paraReactivar', "version" = l."version" + 1
       WHERE l."workspaceId" = ${workspaceId}
         AND l."accion" = 'tarea_asesora'
         AND l."accionDatos"->'paraReactivar' IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM "Message" mr
            WHERE mr."workspaceId" = l."workspaceId" AND mr."conversationId" = l."conversationId"
              AND mr."direction" = 'INBOUND' AND mr."type" <> 'SYSTEM' AND mr."createdAt" >= ${corte})`);
    if (marcadas || desmarcadas) {
      console.log("[seguimiento-inteligente] recuperacion para reactivar", { workspaceId, marcadas, desmarcadas });
    }
    return { marcadas, desmarcadas };
  } catch (error) {
    console.warn("[seguimiento-inteligente] fallo marcar para reactivar", { workspaceId, error: error instanceof Error ? error.message : String(error) });
    return nada;
  }
}
