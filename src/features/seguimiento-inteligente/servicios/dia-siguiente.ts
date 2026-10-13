import { Prisma } from "@prisma/client";

import { elV3AtendioLaCharla, leerEstado } from "@/features/agente-v3/motor/estado";
import { createFollow } from "@/features/seguimientos/services/follows";
import { PRODUCT_FUNNEL_STAGES } from "@/lib/product-funnel-stages";
import { prisma } from "@/lib/prisma";

import type { ConfigSeguimientoInteligente } from "../dominio/config";
import {
  PREFIJO_TRAS_ASESORA,
  contenidoDelFollow,
  decidirDiaSiguiente,
  elegirSeguimientoDelDia1,
  nombreDelDiaSiguiente,
  type FollowConocido,
  type SeguimientoDelDia1,
} from "../dominio/dia-siguiente";

/**
 * EL "DÍA SIGUIENTE" QUE SE RE-ARMA, en vivo (regla en dominio/dia-siguiente.ts).
 *
 * En cada vuelta del reloj (cada minuto), con `diaSiguiente.rearmar` prendido, mira los chats de
 * las líneas del V3 (no ADMIN), sin pausa y con etapa abierta, donde lo último es nuestro y fue
 * hace menos de 3 días. Para cada uno deja UN Follow "Etapa <paso> · día siguiente" a las 24 h de
 * nuestra última respuesta (o lo corre, o lo cancela). El envío lo hace el motor de seguimientos
 * de siempre, con todo su anti-bloqueo. Nunca lanza.
 */

const ETIQUETA_POR_ETAPA = new Map(PRODUCT_FUNNEL_STAGES.map((etapa) => [etapa.stage as string, etapa.label]));
const POR_VUELTA = 80;
const VENTANA_HORAS = 72;
/** Chat + su último mensaje → hasta cuándo no se vuelve a mirar (un mensaje nuevo cambia la clave). */
const enEspera = new Map<string, number>();
let barriendo = false;

type Dia1Cacheado = { seguimiento: SeguimientoDelDia1 | null; vence: number };
const dia1PorPaso = new Map<string, Dia1Cacheado>();

/** El "día siguiente" de un paso de un producto (1 min de memoria). */
export async function leerDia1DelPaso(workspaceId: string, productId: string, paso: string): Promise<SeguimientoDelDia1 | null> {
  const clave = `${workspaceId}:${productId}:${paso}`;
  const guardado = dia1PorPaso.get(clave);
  if (guardado && guardado.vence > Date.now()) return guardado.seguimiento;
  const etapa = await prisma.productFunnelStage.findFirst({
    where: { stage: paso, playbook: { workspaceId, productId } },
    select: {
      followUps: {
        where: { isActive: true },
        orderBy: { sortOrder: "asc" },
        select: { timeType: true, timeValue: true, content: true, flowId: true, cancelOnActivity: true },
      },
    },
  });
  const seguimiento = elegirSeguimientoDelDia1(
    (etapa?.followUps ?? []).map((f) => ({ ...f, timeType: String(f.timeType) })),
  );
  dia1PorPaso.set(clave, { seguimiento, vence: Date.now() + 60_000 });
  return seguimiento;
}

async function cancelar(ids: string[], motivo: string) {
  if (!ids.length) return;
  await prisma.follow.updateMany({
    where: { id: { in: ids }, status: "PENDING" },
    data: { status: "CANCELLED", cancelledAt: new Date(), executionError: motivo, lockedAt: null, lockedBy: null },
  });
}

export async function barrerDiaSiguiente(
  workspaceId: string,
  config: ConfigSeguimientoInteligente,
  ahora = new Date(),
): Promise<{ armados: number; cancelados: number; mirados: number }> {
  const salida = { armados: 0, cancelados: 0, mirados: 0 };
  if (!config.diaSiguiente?.rearmar || barriendo) return salida;
  barriendo = true;
  try {
    const calma = config.diaSiguiente.minutosDeCalma;
    const candidatos = await prisma.$queryRaw<Array<{ id: string; lastMessageAt: Date | null }>>(Prisma.sql`
      SELECT c."id", c."lastMessageAt"
        FROM "Conversation" c
        JOIN "Contact" ct ON ct."id" = c."contactId"
        JOIN "WhatsAppChannel" w ON w."id" = c."channelId"
       WHERE c."workspaceId" = ${workspaceId}
         AND c."automationPaused" = false
         AND (w."metadata"->>'agenteV3') = 'true'
         AND w."purpose" <> 'ADMIN'
         AND (ct."crmStage" IS NULL OR ct."crmStage"::text NOT IN ('GANADO', 'PERDIDO'))
         AND c."lastMessageAt" >= ${new Date(ahora.getTime() - VENTANA_HORAS * 3_600_000)}
         AND c."lastMessageAt" <= ${new Date(ahora.getTime() - calma * 60_000)}
         AND (SELECT m."direction" FROM "Message" m
               WHERE m."conversationId" = c."id" AND m."type" <> 'SYSTEM' AND m."deletedAt" IS NULL
               ORDER BY m."createdAt" DESC LIMIT 1) = 'OUTBOUND'
       ORDER BY c."lastMessageAt" DESC
       LIMIT 1000`);

    for (const { id, lastMessageAt } of candidatos) {
      if (salida.mirados >= POR_VUELTA) break;
      const claveDeEspera = `${id}:${lastMessageAt?.toISOString() ?? ""}`;
      if ((enEspera.get(claveDeEspera) ?? 0) > ahora.getTime()) continue;
      salida.mirados += 1;
      const r = await rearmarDiaSiguienteDelChat(id, config, ahora).catch((error) => {
        console.warn("[dia-siguiente] fallo un chat", { conversationId: id, error: error instanceof Error ? error.message : String(error) });
        return null;
      });
      // Lo que espera la calma se mira a su hora; lo demás, cuando cambie el chat (o en 1 h).
      enEspera.set(claveDeEspera, r?.revisarEn ? r.revisarEn.getTime() : ahora.getTime() + 3_600_000);
      if (!r) continue;
      salida.armados += r.armado ? 1 : 0;
      salida.cancelados += r.cancelados;
    }
    if (enEspera.size > 20_000) {
      for (const [clave, hasta] of enEspera) if (hasta < ahora.getTime()) enEspera.delete(clave);
    }
    if (salida.armados || salida.cancelados) console.log("[dia-siguiente] vuelta", { workspaceId, ...salida });
  } catch (error) {
    console.warn("[dia-siguiente] fallo la vuelta", { workspaceId, error: error instanceof Error ? error.message : String(error) });
  } finally {
    barriendo = false;
  }
  return salida;
}

/** Decide y aplica para UN chat. */
export async function rearmarDiaSiguienteDelChat(
  conversationId: string,
  config: ConfigSeguimientoInteligente,
  ahora = new Date(),
): Promise<{ armado: boolean; cancelados: number; motivo: string; revisarEn: Date | null }> {
  const charla = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      workspaceId: true,
      contactId: true,
      channelId: true,
      automationPaused: true,
      contact: { select: { crmStage: true } },
      channel: { select: { purpose: true } },
    },
  });
  if (!charla) return { armado: false, cancelados: 0, motivo: "sin_chat", revisarEn: null };

  const [v3Atendio, estado, mensajes, follows] = await Promise.all([
    elV3AtendioLaCharla(conversationId),
    leerEstado(conversationId),
    prisma.$queryRaw<Array<{ direction: string; createdAt: Date; origen: string | null }>>(Prisma.sql`
      SELECT m."direction", m."createdAt", m."rawPayload"->>'source' AS "origen"
        FROM "Message" m
       WHERE m."conversationId" = ${conversationId} AND m."type" <> 'SYSTEM' AND m."deletedAt" IS NULL
       ORDER BY m."createdAt" DESC
       LIMIT 40`),
    prisma.follow.findMany({
      where: {
        workspaceId: charla.workspaceId,
        contactId: charla.contactId,
        OR: [
          { status: "PENDING" },
          { name: { startsWith: PREFIJO_TRAS_ASESORA }, createdAt: { gte: new Date(ahora.getTime() - 4 * 86_400_000) } },
        ],
      },
      select: { id: true, name: true, status: true, content: true, timeType: true, timeValue: true, executeAt: true, createdAt: true },
      take: 100,
    }),
  ]);

  const paso = estado.pasoActual ? String(estado.pasoActual) : null;
  const productoId = estado.productoActivo ?? null;
  const seguimiento = paso && productoId ? await leerDia1DelPaso(charla.workspaceId, productoId, paso) : null;

  const decision = decidirDiaSiguiente({
    activo: Boolean(config.diaSiguiente?.rearmar),
    esAdmin: charla.channel?.purpose === "ADMIN",
    v3Atendio,
    pausado: Boolean(charla.automationPaused),
    etapaCrm: charla.contact?.crmStage ? String(charla.contact.crmStage) : null,
    mensajes: mensajes.map((m) => ({ direccion: m.direction === "INBOUND" ? "IN" : "OUT", origen: m.origen, en: m.createdAt })),
    paso,
    productoId,
    seguimiento,
    follows: follows.map((f): FollowConocido => ({ ...f, timeType: String(f.timeType), status: String(f.status) })),
    minutosDeCalma: config.diaSiguiente?.minutosDeCalma ?? 3,
    ahora,
  });

  await cancelar(decision.cancelar, decision.accion === "armar" ? "Re-armado: dia siguiente" : `Dia siguiente: ${decision.motivo}`);
  if (decision.accion !== "armar") {
    return { armado: false, cancelados: decision.cancelar.length, motivo: decision.motivo, revisarEn: decision.accion === "nada" ? decision.revisarEn : null };
  }

  const s = decision.seguimiento;
  const flowId = s.flowId?.trim() || null;
  const etiqueta = ETIQUETA_POR_ETAPA.get(paso ?? "") ?? paso ?? "";
  const creado = await createFollow({
    workspaceId: charla.workspaceId,
    contactId: charla.contactId,
    channelId: charla.channelId,
    name: nombreDelDiaSiguiente(etiqueta),
    timeType: s.timeType as "MINUTES" | "HOURS" | "DAYS",
    timeValue: s.timeValue,
    executeAt: decision.executeAt,
    messageType: "TEXT",
    content: contenidoDelFollow(s),
    ...(flowId ? { actions: [{ messageType: "TEXT" as const, content: "Flujo del embudo", flowId }] } : {}),
    cancelOnActivity: s.cancelOnActivity,
  });
  console.log("[dia-siguiente] armado", {
    conversationId,
    paso,
    motivo: decision.motivo,
    ancla: decision.ancla.toISOString(),
    executeAt: decision.executeAt.toISOString(),
    cancelados: decision.cancelar.length,
  });
  return { armado: Boolean(creado), cancelados: decision.cancelar.length, motivo: decision.motivo, revisarEn: null };
}
