import { Prisma } from "@prisma/client";

import { leerConfigSeguimiento } from "@/features/seguimiento-inteligente/servicios/config";
import { corteDeLaConfig, filtroSinReactivar } from "@/features/seguimiento-inteligente/servicios/reactivacion";
import { CacheConTtl } from "@/lib/cache-en-memoria";
import { SQL_CHAT_ABIERTO } from "@/lib/chat-resuelto-sql";
import { prisma } from "@/lib/prisma";

import type { TareaVencida } from "../dominio/listas";
import { armarAlarma, type AlarmaDeHoy } from "../dominio/semana";

/**
 * LA ALARMA DE HOY de Recuperación: tareas de asesora vencidas (o que vencen en 24 h) sin hacer.
 * Mismo criterio que el tope (seguimiento-inteligente/servicios/tope.ts): EmbudoLead con accion
 * "tarea_asesora", no exterior, contacto abierto, sin mensaje de una persona después de creada
 * (salvo la Recuperación 72 h, que se da por hecha con llamada y audio). Sin las que van a
 * reactivación ("Llamar solo las de 7 días o menos"). La asesora es la del plan del tope o, sin
 * plan, la dueña del chat. Una consulta agrupada, 5 minutos en memoria.
 *
 * La lista "Tareas vencidas" / "Llamadas 72 h" de la vista Leads usa EL MISMO pedazo de SQL
 * (`desdeTareasVencidas`), así el total de la lista es el número de la alarma.
 */

const cache = new CacheConTtl<AlarmaDeHoy | null>({ ttlMs: 5 * 60_000, maxEntradas: 20 });
const cacheLista = new CacheConTtl<TareaVencida[]>({ ttlMs: 5 * 60_000, maxEntradas: 20 });

/** Tope de seguridad de la lista (la alarma de hoy anda en ~200). */
const MAX_TAREAS = 2000;

type Fila = { asesora: string | null; total: bigint | number; llamadas: bigint | number };

function primerNombre(nombre: string | null): string | null {
  return nombre ? nombre.trim().split(/\s+/)[0] || nombre : null;
}

/**
 * FROM … WHERE de las tareas vencidas (alias l = EmbudoLead, c, ct, u). `unir`: un LEFT JOIN más
 * por llave para la lista (no cambia el conteo).
 */
function desdeTareasVencidas(workspaceId: string, finDelDia: Date, corte: Date | null, unir: Prisma.Sql = Prisma.empty): Prisma.Sql {
  return Prisma.sql`
      FROM "EmbudoLead" l
      JOIN "Conversation" c ON c."id" = l."conversationId"
      JOIN "Contact" ct ON ct."id" = c."contactId"
      LEFT JOIN "User" u ON u."id" = COALESCE(l."accionDatos"->'tope'->>'para', c."assignedToUserId")
      ${unir}
     WHERE l."workspaceId" = ${workspaceId}
       AND l."accion" = 'tarea_asesora'
       AND l."exterior" = false
       AND ct."crmStage"::text NOT IN ('GANADO', 'PERDIDO')
       ${SQL_CHAT_ABIERTO}
       AND (l."tareaVence" IS NULL OR l."tareaVence" <= ${finDelDia})
       ${filtroSinReactivar(corte)}
       AND (l."accionDatos"->>'motivo' = 'recuperacion_72h' OR NOT EXISTS (
         SELECT 1 FROM "Message" m
          WHERE m."conversationId" = l."conversationId" AND m."direction" = 'OUTBOUND'
            AND m."rawPayload"->>'source' IN ('manual', 'instance')
            AND m."createdAt" > COALESCE(l."accionEn", l."updatedAt")))`;
}

/**
 * "Recuperación vencida" para las AUTOMATIZACIONES: el chat (alias `c` = Conversation) tiene una
 * tarea de la alarma de hoy con motivo `recuperacion_72h`. Mismo criterio que `desdeTareasVencidas`
 * (no exterior, etapa abierta, vence en 24 h o antes, sin las que van a reactivación).
 */
export async function condicionRecuperacionVencida(workspaceId: string, ahora = new Date()): Promise<Prisma.Sql> {
  const config = await leerConfigSeguimiento(workspaceId);
  const finDelDia = new Date(ahora.getTime() + 24 * 3_600_000);
  const corte = corteDeLaConfig(config, ahora);
  return Prisma.sql`EXISTS (
      SELECT 1
        FROM "EmbudoLead" l
        JOIN "Contact" ct ON ct."id" = c."contactId"
       WHERE l."conversationId" = c."id"
         AND l."workspaceId" = ${workspaceId}
         AND l."accion" = 'tarea_asesora'
         AND l."exterior" = false
         AND l."accionDatos"->>'motivo' = 'recuperacion_72h'
         AND ct."crmStage"::text NOT IN ('GANADO', 'PERDIDO')
         ${SQL_CHAT_ABIERTO}
         AND (l."tareaVence" IS NULL OR l."tareaVence" <= ${finDelDia})
         ${filtroSinReactivar(corte)})`;
}

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
    ${desdeTareasVencidas(workspaceId, finDelDia, corteDeLaConfig(config, ahora))}
     GROUP BY 1`);
  let vencidas = 0;
  let llamadas72h = 0;
  const porAsesora: Array<{ asesora: string; tareas: number }> = [];
  for (const fila of filas) {
    const total = Number(fila.total);
    vencidas += total;
    llamadas72h += Number(fila.llamadas);
    if (fila.asesora) porAsesora.push({ asesora: primerNombre(fila.asesora) ?? fila.asesora, tareas: total });
  }
  return armarAlarma({ vencidas, llamadas72h, porAsesora, tope: config.tareas.maxPorAsesoraDia });
}

type FilaTarea = {
  conversationId: string;
  asesora: string | null;
  motivo: string | null;
  vence: Date | null;
  nombre: string | null;
  telefono4: string | null;
  linea: string | null;
  etapa: string | null;
  producto: string | null;
  ultimoClienteEn: Date | null;
};

/**
 * Las tareas de la alarma, una por chat (sin el último mensaje: eso se pide solo para las que se
 * muestran, con `ultimosMensajesDelCliente`). Una consulta, 5 minutos en memoria.
 */
export function leerTareasVencidas(workspaceId: string): Promise<TareaVencida[]> {
  return cacheLista.obtener(workspaceId, () => cargarTareas(workspaceId));
}

async function cargarTareas(workspaceId: string): Promise<TareaVencida[]> {
  const ahora = new Date();
  const config = await leerConfigSeguimiento(workspaceId);
  const finDelDia = new Date(ahora.getTime() + 24 * 3_600_000);
  const filas = await prisma.$queryRaw<FilaTarea[]>(Prisma.sql`
    SELECT l."conversationId", u."name" AS "asesora", l."accionDatos"->>'motivo' AS "motivo",
           l."tareaVence" AS "vence",
           NULLIF(btrim(ct."name"), '') AS "nombre", right(ct."phoneNumber", 4) AS "telefono4",
           w."name" AS "linea", ct."crmStage"::text AS "etapa",
           COALESCE(c."activeProductContext"->>'productName', l."productoActual", l."productoInteres") AS "producto",
           l."ultimoClienteEn"
    ${desdeTareasVencidas(workspaceId, finDelDia, corteDeLaConfig(config, ahora), Prisma.sql`LEFT JOIN "WhatsAppChannel" w ON w."id" = c."channelId"`)}
     ORDER BY l."tareaVence" ASC NULLS FIRST
     LIMIT ${MAX_TAREAS}`);
  return filas.map((fila) => ({ ...fila, asesora: primerNombre(fila.asesora), ultimoTexto: null }));
}

/** El último mensaje del cliente de cada chat (para los ≤ 200 que se muestran). Un salto de índice por chat. */
export async function ultimosMensajesDelCliente(ids: ReadonlyArray<string>): Promise<Map<string, { texto: string | null; en: Date | null }>> {
  if (!ids.length) return new Map();
  const filas = await prisma.$queryRaw<Array<{ id: string; texto: string | null; tipo: string | null; en: Date | null }>>(Prisma.sql`
    SELECT x."id", u."texto", u."tipo", u."en"
    FROM unnest(${[...ids]}::text[]) AS x("id")
    LEFT JOIN LATERAL (
      SELECT left(COALESCE(NULLIF(m."content", ''), m."transcripcion"), 140) AS "texto", m."type"::text AS "tipo",
             m."createdAt" AS "en"
      FROM "Message" m
      WHERE m."conversationId" = x."id" AND m."direction" = 'INBOUND' AND m."type" <> 'SYSTEM'
      ORDER BY m."createdAt" DESC
      LIMIT 1
    ) u ON true`);
  return new Map(
    filas.map((fila) => [
      fila.id,
      { texto: fila.texto || (fila.tipo && fila.tipo !== "TEXT" ? `[${fila.tipo.toLowerCase()}]` : null), en: fila.en },
    ]),
  );
}
