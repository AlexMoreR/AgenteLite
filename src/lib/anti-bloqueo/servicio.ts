import { Prisma } from "@prisma/client";

import { registrarSeguimientoFrenado } from "@/features/embudo/servicios/eventos";
import { ORIGENES_AUTOMATICOS } from "@/lib/freno-de-automaticos";
import { prisma } from "@/lib/prisma";

import {
  VENTANA_DEL_ANUNCIO_MS,
  decidirDueno,
  decidirEspaciado,
  decidirTope,
  dentroDelHorario,
  esperaDeHorarioV3,
  leerConfigAntiBloqueoDeTexto,
  reprogramarFueraDeHorario,
  siguienteEsperaMs,
  type ConfigAntiBloqueo,
  type HistorialParaTope,
  type MotivoAntiBloqueo,
} from "./reglas";

/**
 * ANTI-BLOQUEO: lo que necesita la base (ver reglas.ts para el porqué de cada medida).
 *
 * Interruptor y configuración en AppSetting `antibloqueo:config:<workspaceId>` (JSON). Sin fila,
 * o con el JSON roto, todo queda APAGADO y los automáticos salen como siempre.
 */

const MEMORIA_MS = 60_000;

export const claveConfigAntiBloqueo = (workspaceId: string) => `antibloqueo:config:${workspaceId}`;
/** Cuándo puede salir el próximo automático por esa línea (lo marca cada envío). */
export const claveProximoEnvioDeLinea = (lineaId: string) => `antibloqueo:linea:${lineaId}`;

const configs = new Map<string, { valor: ConfigAntiBloqueo; vence: number }>();

export async function leerConfigAntiBloqueo(workspaceId: string): Promise<ConfigAntiBloqueo> {
  const guardado = configs.get(workspaceId);
  if (guardado && guardado.vence > Date.now()) return guardado.valor;
  let valor: ConfigAntiBloqueo;
  try {
    const fila = await prisma.appSetting.findUnique({ where: { key: claveConfigAntiBloqueo(workspaceId) } });
    valor = leerConfigAntiBloqueoDeTexto(fila?.value);
  } catch {
    // Base caída: apagado, que es exactamente el comportamiento de antes.
    valor = leerConfigAntiBloqueoDeTexto(null);
  }
  configs.set(workspaceId, { valor, vence: Date.now() + MEMORIA_MS });
  return valor;
}

/** Para las pruebas y para que un cambio de config se vea al toque en este proceso. */
export function olvidarConfigAntiBloqueo(workspaceId?: string) {
  if (workspaceId) configs.delete(workspaceId);
  else configs.clear();
}

/* ------------------------------------------------------------------------------------------------
   LA CHARLA: se busca por id o, si solo se sabe el contacto, la más reciente en esa línea.
------------------------------------------------------------------------------------------------ */

type Charla = {
  id: string;
  automationPaused: boolean;
  startedAt: Date;
  crmStage: string | null;
};

async function buscarCharla(input: {
  conversationId?: string | null;
  contactId?: string | null;
  channelId?: string | null;
  workspaceId: string;
}): Promise<Charla | null> {
  const fila = input.conversationId
    ? await prisma.conversation.findUnique({
        where: { id: input.conversationId },
        select: { id: true, automationPaused: true, startedAt: true, contact: { select: { crmStage: true } } },
      })
    : input.contactId
      ? await prisma.conversation.findFirst({
          where: {
            workspaceId: input.workspaceId,
            contactId: input.contactId,
            ...(input.channelId ? { channelId: input.channelId } : {}),
          },
          orderBy: { lastMessageAt: "desc" },
          select: { id: true, automationPaused: true, startedAt: true, contact: { select: { crmStage: true } } },
        })
      : null;
  if (!fila) return null;
  return {
    id: fila.id,
    automationPaused: Boolean(fila.automationPaused),
    startedAt: fila.startedAt,
    crmStage: fila.contact?.crmStage ?? null,
  };
}

/** Lo que hace falta para el tope: primer y último mensaje del cliente, y los automáticos. */
async function historialParaTope(conversationId: string): Promise<HistorialParaTope> {
  const [resumen] = await prisma.$queryRaw<
    Array<{ primero: Date | null; ultimo: Date | null; despues: number | bigint | null }>
  >(Prisma.sql`
    WITH entrantes AS (
      SELECT m."createdAt"
      FROM public."Message" m
      WHERE m."conversationId" = ${conversationId}
        AND m."direction" = 'INBOUND' AND m."type" <> 'SYSTEM' AND m."deletedAt" IS NULL
    )
    SELECT
      (SELECT MIN("createdAt") FROM entrantes) AS "primero",
      (SELECT MAX("createdAt") FROM entrantes) AS "ultimo",
      (SELECT COUNT(*) FROM entrantes
        WHERE "createdAt" > (SELECT MIN("createdAt") FROM entrantes) + (${VENTANA_DEL_ANUNCIO_MS / 1000} * INTERVAL '1 second')
      )::int AS "despues"
  `);
  const automaticos = await prisma.$queryRaw<Array<{ createdAt: Date }>>(Prisma.sql`
    SELECT m."createdAt"
    FROM public."Message" m
    WHERE m."conversationId" = ${conversationId}
      AND m."direction" = 'OUTBOUND' AND m."type" <> 'SYSTEM' AND m."deletedAt" IS NULL
      AND m."rawPayload"->>'source' IN (${Prisma.join([...ORIGENES_AUTOMATICOS])})
    ORDER BY m."createdAt" DESC
    LIMIT 200
  `);
  return {
    primerEntrante: resumen?.primero ?? null,
    ultimoEntrante: resumen?.ultimo ?? null,
    entrantesDespuesDelAnuncio: Number(resumen?.despues ?? 0),
    automaticos: automaticos.map((fila) => fila.createdAt),
  };
}

/** Mensajes de una persona (CRM o celular) desde el último mensaje del cliente. */
async function mensajesHumanosDesdeElCliente(conversationId: string) {
  return prisma.$queryRaw<Array<{ createdAt: Date; origen: string | null }>>(Prisma.sql`
    SELECT m."createdAt", m."rawPayload"->>'source' AS "origen"
    FROM public."Message" m
    WHERE m."conversationId" = ${conversationId}
      AND m."direction" = 'OUTBOUND' AND m."type" <> 'SYSTEM' AND m."deletedAt" IS NULL
      AND m."rawPayload"->>'source' IN ('manual', 'instance')
      AND m."createdAt" > COALESCE((
        SELECT MAX(e."createdAt") FROM public."Message" e
        WHERE e."conversationId" = ${conversationId} AND e."direction" = 'INBOUND' AND e."type" <> 'SYSTEM'
      ), 'epoch'::timestamp)
    ORDER BY m."createdAt" DESC
    LIMIT 10
  `);
}

/* ------------------------------------------------------------------------------------------------
   ESPACIADO
------------------------------------------------------------------------------------------------ */

async function estadoDeLaLinea(lineaId: string, ahora: Date) {
  const [fila, recientes] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: claveProximoEnvioDeLinea(lineaId) } }),
    prisma.$queryRaw<Array<{ createdAt: Date }>>(Prisma.sql`
      SELECT m."createdAt"
      FROM public."Message" m
      WHERE m."channelId" = ${lineaId}
        AND m."direction" = 'OUTBOUND'
        AND m."createdAt" > ${new Date(ahora.getTime() - 60_000)}
        AND m."rawPayload"->>'source' IN (${Prisma.join([...ORIGENES_AUTOMATICOS])})
      ORDER BY m."createdAt" ASC
      LIMIT 100
    `),
  ]);
  const proximo = fila?.value ? new Date(fila.value) : null;
  return {
    proximoPermitido: proximo && !Number.isNaN(proximo.getTime()) ? proximo : null,
    // Un envío con varios mensajes (texto + foto) cuenta como uno: se agrupan los del mismo segundo.
    enviosUltimoMinuto: new Set(recientes.map((fila) => Math.floor(fila.createdAt.getTime() / 5_000))).size,
    masViejoDelMinuto: recientes[0]?.createdAt ?? null,
  };
}

/**
 * Marca que acaba de salir un automático por la línea: el próximo puede salir recién después de
 * una espera al azar (20–90 s por defecto). No hace nada si el espaciado está apagado.
 */
export async function marcarEnvioAutomatico(input: { workspaceId: string; lineaId: string | null; ahora?: Date }) {
  if (!input.lineaId) return;
  try {
    const config = await leerConfigAntiBloqueo(input.workspaceId);
    if (!config.espaciado.activo) return;
    const ahora = input.ahora ?? new Date();
    const value = new Date(ahora.getTime() + siguienteEsperaMs(config.espaciado)).toISOString();
    const key = claveProximoEnvioDeLinea(input.lineaId);
    await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  } catch (error) {
    console.warn("[anti-bloqueo] no se pudo marcar el envio de la linea", {
      lineaId: input.lineaId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/* ------------------------------------------------------------------------------------------------
   LA REVISIÓN
------------------------------------------------------------------------------------------------ */

export type ResultadoAntiBloqueo =
  | { enviar: true; conversationId: string | null }
  | { enviar: false; motivo: MotivoAntiBloqueo; reprogramarPara: Date | null; conversationId: string | null };

/**
 * ¿Puede salir este automático ahora?
 *
 * Orden: horario (se corre) → dueño (se cancela) → tope (se cancela) → espaciado (se corre). El
 * texto vigente lo mira el motor de seguimientos, porque solo él sabe qué texto quedó agendado.
 *
 * `medidas` dice qué medidas aplican a este envío (un seguimiento que agendó una asesora, por
 * ejemplo, no se cancela por dueño ni por tope: el dueño es ella).
 */
export async function revisarAntiBloqueo(input: {
  workspaceId: string;
  conversationId?: string | null;
  contactId?: string | null;
  channelId?: string | null;
  medidas: { dueno: boolean; tope: boolean };
  /** Solo el reloj del V3: desde cuándo está callado el chat (para la espera de la apertura). */
  silencioDesde?: Date | null;
  ahora?: Date;
  /** Para reprogramar fuera de horario (pruebas). */
  azar?: () => number;
}): Promise<ResultadoAntiBloqueo> {
  const ahora = input.ahora ?? new Date();
  const config = await leerConfigAntiBloqueo(input.workspaceId);
  const nada = !config.horario.activo && !config.unDueno.activo && !config.topeTotal.activo && !config.espaciado.activo;
  if (nada) {
    return { enviar: true, conversationId: input.conversationId ?? null };
  }

  // 2. Horario.
  if (config.horario.activo) {
    if (input.silencioDesde) {
      const desde = esperaDeHorarioV3({
        ahora,
        silencioDesde: input.silencioDesde,
        horario: config.horario,
        semilla: input.conversationId ?? input.contactId ?? "",
      });
      if (desde) {
        return { enviar: false, motivo: "fuera_de_horario", reprogramarPara: desde, conversationId: input.conversationId ?? null };
      }
    } else if (!dentroDelHorario(ahora, config.horario)) {
      return {
        enviar: false,
        motivo: "fuera_de_horario",
        reprogramarPara: reprogramarFueraDeHorario(ahora, config.horario, input.azar),
        conversationId: input.conversationId ?? null,
      };
    }
  }

  const necesitaCharla = (config.unDueno.activo && input.medidas.dueno) || (config.topeTotal.activo && input.medidas.tope);
  const charla = necesitaCharla ? await buscarCharla({ ...input }) : null;
  const conversationId = charla?.id ?? input.conversationId ?? null;

  // 3. Un solo dueño.
  if (config.unDueno.activo && input.medidas.dueno && charla) {
    const motivo = decidirDueno({
      automationPaused: charla.automationPaused,
      crmStage: charla.crmStage,
      inicioDeLaCharla: charla.startedAt,
      mensajesHumanos: await mensajesHumanosDesdeElCliente(charla.id),
    });
    if (motivo) return { enviar: false, motivo, reprogramarPara: null, conversationId };
  }

  // 1. Tope total.
  if (config.topeTotal.activo && input.medidas.tope && charla) {
    const motivo = decidirTope(await historialParaTope(charla.id), config.topeTotal);
    if (motivo) return { enviar: false, motivo, reprogramarPara: null, conversationId };
  }

  // 5. Espaciado.
  if (config.espaciado.activo && input.channelId) {
    const linea = await estadoDeLaLinea(input.channelId, ahora);
    const decision = decidirEspaciado({ ahora, porMinuto: config.espaciado.porMinuto, ...linea });
    if (!decision.enviar) {
      return { enviar: false, motivo: "espaciado", reprogramarPara: decision.desde, conversationId };
    }
  }

  return { enviar: true, conversationId };
}

/* ------------------------------------------------------------------------------------------------
   MÉTRICA: cada frenado queda en el log y en el embudo (SEGUIMIENTO_FRENADO), una vez.
------------------------------------------------------------------------------------------------ */

const yaAnotados = new Set<string>();

export function anotarFrenado(input: {
  workspaceId: string;
  conversationId?: string | null;
  contactId: string;
  channelId?: string | null;
  motor: "v3" | "follow";
  motivo: string;
  /** Para no repetir el evento: el mismo seguimiento frenado por lo mismo cuenta una vez. */
  claveUnica: string;
  reglaId?: string | null;
  reglaNombre?: string | null;
  paso?: string | null;
  reprogramadoPara?: Date | null;
  datos?: Record<string, unknown>;
}): void {
  // El reloj del V3 vuelve a mirar el mismo chat cada minuto: al log va una vez por clave.
  if (yaAnotados.has(input.claveUnica)) return;
  yaAnotados.add(input.claveUnica);
  if (yaAnotados.size > 5_000) {
    for (const clave of yaAnotados) {
      yaAnotados.delete(clave);
      if (yaAnotados.size <= 4_000) break;
    }
  }
  console.log("[anti-bloqueo] frenado", {
    motor: input.motor,
    motivo: input.motivo,
    conversationId: input.conversationId ?? null,
    contactId: input.contactId,
    channelId: input.channelId ?? null,
    regla: input.reglaNombre ?? input.reglaId ?? null,
    reprogramadoPara: input.reprogramadoPara?.toISOString() ?? null,
  });
  registrarSeguimientoFrenado(input);
}
