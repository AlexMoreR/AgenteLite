import { Prisma } from "@prisma/client";

import { registrarEventos } from "@/features/embudo/servicios/eventos";
import { calcularReparto } from "@/lib/channel-collaborators";
import { leerHorariosDeReparto, recibeEnEsteMomento } from "@/lib/horario-de-reparto";
import { prisma } from "@/lib/prisma";

import type { ConfigSeguimientoInteligente } from "../dominio/config";
import { diaBogota, planearTareas, type EstadoDelTope, type TareaParaElTope } from "../dominio/tope";

/**
 * EL TOPE DE TAREAS EN VIVO (máximo `tareas.maxPorAsesoraDia` por asesora al día; por defecto 15).
 *
 * Lo corre el barrido del reloj después de revisar los leads. Lee las tareas vencidas (o que vencen
 * hoy) que todavía nadie hizo, las planea con la regla pura de dominio/tope.ts y guarda el plan en
 * `EmbudoLead.accionDatos.tope` ({ dia, para, estado, de, pospuestaHasta }). Mi día muestra a cada
 * asesora las que tienen `para` = ella; el Supervisor ve todas, con su estado.
 *
 * - Se pasa la TAREA, no el chat: la asesora que la recibe la ve en su Mi día con "pasada de
 *   Fulana por tope" y abre el chat desde ahí. El dueño del chat no cambia.
 * - En modo sombra solo registra el plan (y el evento): a nadie le aparece nada.
 * - Nunca lanza.
 */

type Fila = {
  conversationId: string;
  workspaceId: string;
  contactId: string;
  channelId: string | null;
  tareaPrioridad: string | null;
  tareaVence: Date | null;
  temperatura: string | null;
  accionDatos: Record<string, unknown> | null;
  duena: string | null;
  metadataDeLaLinea: unknown;
};

function planGuardado(datos: Record<string, unknown> | null): TareaParaElTope["plan"] {
  const tope = datos?.tope;
  if (!tope || typeof tope !== "object" || Array.isArray(tope)) return null;
  const t = tope as Record<string, unknown>;
  if (typeof t.dia !== "string" || typeof t.estado !== "string") return null;
  return {
    dia: t.dia,
    para: typeof t.para === "string" ? t.para : null,
    estado: t.estado as EstadoDelTope,
    pospuestaHasta: typeof t.pospuestaHasta === "string" ? t.pospuestaHasta : null,
  };
}

export async function aplicarTopeDeTareas(workspaceId: string, config: ConfigSeguimientoInteligente, ahora = new Date()): Promise<{ planeadas: number; redistribuidas: number; pospuestas: number }> {
  const vacio = { planeadas: 0, redistribuidas: 0, pospuestas: 0 };
  try {
    if (config.motor.modo === "apagado") return vacio;
    const finDelDia = new Date(ahora.getTime() + 24 * 3_600_000);
    const filas = await prisma.$queryRaw<Fila[]>(Prisma.sql`
      SELECT l."conversationId", l."workspaceId", l."contactId", c."channelId", l."tareaPrioridad", l."tareaVence", l."temperatura",
             l."accionDatos", c."assignedToUserId" AS "duena", w."metadata" AS "metadataDeLaLinea"
        FROM "EmbudoLead" l
        JOIN "Conversation" c ON c."id" = l."conversationId"
        JOIN "Contact" ct ON ct."id" = c."contactId"
        LEFT JOIN "WhatsAppChannel" w ON w."id" = c."channelId"
       WHERE l."workspaceId" = ${workspaceId}
         AND l."accion" = 'tarea_asesora'
         AND l."exterior" = false
         AND ct."crmStage"::text NOT IN ('GANADO', 'PERDIDO')
         AND (l."tareaVence" IS NULL OR l."tareaVence" <= ${finDelDia})
         AND NOT EXISTS (
           SELECT 1 FROM "Message" m
            WHERE m."conversationId" = l."conversationId" AND m."direction" = 'OUTBOUND'
              AND m."rawPayload"->>'source' IN ('manual', 'instance')
              AND m."createdAt" > COALESCE(l."accionEn", l."updatedAt"))
       LIMIT 500`);
    if (!filas.length) return vacio;

    const horarios = await leerHorariosDeReparto(workspaceId).catch(() => ({}) as Record<string, never>);
    const elegiblesDe = (metadata: unknown) =>
      calcularReparto(metadata).filter((asesora) => recibeEnEsteMomento((horarios as Record<string, Parameters<typeof recibeEnEsteMomento>[0]>)[asesora], ahora));

    const tareas: TareaParaElTope[] = filas.map((fila) => ({
      conversationId: fila.conversationId,
      prioridad: fila.tareaPrioridad ?? "C",
      temperatura: (typeof fila.accionDatos?.temperaturaBase === "string" ? fila.accionDatos.temperaturaBase : fila.temperatura) ?? null,
      vence: fila.tareaVence ? new Date(fila.tareaVence) : null,
      duena: fila.duena,
      elegibles: elegiblesDe(fila.metadataDeLaLinea),
      plan: planGuardado(fila.accionDatos),
    }));
    const planes = planearTareas({ tareas, tope: config.tareas.maxPorAsesoraDia, ahora });
    const porId = new Map(filas.map((fila) => [fila.conversationId, fila]));
    let redistribuidas = 0;
    let pospuestas = 0;
    for (const plan of planes) {
      const fila = porId.get(plan.conversationId);
      if (!fila) continue;
      const modo = typeof fila.accionDatos?.modo === "string" ? fila.accionDatos.modo : config.motor.modo;
      const tope = { ...plan, modo, en: ahora.toISOString(), maximo: config.tareas.maxPorAsesoraDia };
      await prisma.$executeRaw(Prisma.sql`
        UPDATE "EmbudoLead"
           SET "accionDatos" = COALESCE("accionDatos", '{}'::jsonb) || jsonb_build_object('tope', ${JSON.stringify(tope)}::jsonb),
               "version" = "version" + 1, "updatedAt" = NOW()
         WHERE "conversationId" = ${plan.conversationId} AND "accion" = 'tarea_asesora'`);
      if (plan.estado === "redistribuida" || plan.estado === "pospuesta") {
        if (plan.estado === "redistribuida") redistribuidas += 1;
        else pospuestas += 1;
        await registrarEventos(
          { workspaceId, conversationId: plan.conversationId, contactId: fila.contactId, channelId: fila.channelId },
          [
            {
              tipo: "TAREA_REPARTIDA",
              origen: "motor",
              claveUnica: `TOPE:${plan.conversationId}:${plan.dia}:${plan.estado}`,
              createdAt: ahora,
              datos: { ...tope, motivo: plan.estado === "pospuesta" ? "pospuesta_por_tope" : "pasada_por_tope" },
            },
          ],
        );
      }
    }
    if (redistribuidas || pospuestas) {
      console.log("[seguimiento-inteligente] tope de tareas", { workspaceId, dia: diaBogota(ahora), redistribuidas, pospuestas, modo: config.motor.modo });
    }
    return { planeadas: planes.length, redistribuidas, pospuestas };
  } catch (error) {
    console.warn("[seguimiento-inteligente] fallo el tope de tareas", { workspaceId, error: error instanceof Error ? error.message : String(error) });
    return vacio;
  }
}
