import { prisma } from "@/lib/prisma";
import { resolveCallablePhone } from "@/lib/whatsapp-lid";
import { getCallResultLabel, getCrmLostReasonLabel } from "@/features/crm/domain/crm-config";
import type { CrmStage } from "@/features/crm/types";

// ── Utilidades de fecha (día de HOY en Bogotá, UTC-5) ───────────────────────────────────────
const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000;

function endOfTodayUtc(now: Date): Date {
  const bogotaNow = new Date(now.getTime() - BOGOTA_OFFSET_MS);
  const endOfBogotaDay = Date.UTC(
    bogotaNow.getUTCFullYear(),
    bogotaNow.getUTCMonth(),
    bogotaNow.getUTCDate(),
    23,
    59,
    59,
    999,
  );
  return new Date(endOfBogotaDay + BOGOTA_OFFSET_MS);
}

function startOfTodayUtc(now: Date): Date {
  const bogotaNow = new Date(now.getTime() - BOGOTA_OFFSET_MS);
  const startOfBogotaDay = Date.UTC(bogotaNow.getUTCFullYear(), bogotaNow.getUTCMonth(), bogotaNow.getUTCDate(), 0, 0, 0, 0);
  return new Date(startOfBogotaDay + BOGOTA_OFFSET_MS);
}

// ── VISTA VENDEDORA ─────────────────────────────────────────────────────────────────────────

export type LlamadaLead = {
  contactId: string;
  name: string;
  phoneNumber: string;
  /**
   * El numero que la asesora puede MARCAR, o null si no hay ninguno.
   *
   * No siempre coincide con phoneNumber: cuando el cliente llega identificado solo con un LID de
   * WhatsApp, phoneNumber guarda ese LID (hace falta para responderle por chat) pero no es un
   * telefono. Mostrarlo como si lo fuera mandaba a Ingrid a marcar 15 digitos inexistentes.
   */
  callablePhone: string | null;
  avatarUrl: string | null;
  stage: CrmStage;
  // Último resultado registrado (etiqueta legible) y cuántos intentos lleva. El objetivo es que
  // Ingrid vea, SIN clic: nombre, teléfono, qué pasó la última vez y cuántas veces llamó.
  lastResultLabel: string | null;
  attemptCount: number;
  nextContactAt: string | null; // ISO
};

export type LlamadasVendedoraData = {
  generatedAt: string;
  // 🔴 Calientes (NEGOCIACION) con próximo contacto para hoy → LLAMAR.
  llamarHoy: LlamadaLead[];
  // 🟡 Tibios (PROPUESTA) con próximo contacto para hoy → WhatsApp.
  whatsappHoy: LlamadaLead[];
  // ⚪ Nuevos sin ninguna llamada aún (máx. 10 sugeridos).
  nuevos: LlamadaLead[];
};

type LatestCallRow = {
  contactId: string;
  name: string | null;
  phoneNumber: string;
  metadata: unknown;
  avatarUrl: string | null;
  crmStage: CrmStage;
  result: string;
  attemptNumber: number;
  nextContactAt: Date | null;
};

/**
 * La lista de llamadas de UNA asesora.
 *
 * Antes traia los leads de TODO el negocio: a Ingrid le aparecian los de Marcela y al reves. Dos
 * llamando al mismo cliente, y ninguna haciendose cargo del resto ("pense que lo hacias vos").
 * Es el mismo criterio que "Mi dia": entran los MIOS y los que no tienen dueño (esos estan para
 * que los agarre quien pueda). Los de otra persona, no.
 */
export async function getLlamadasVendedoraData(
  workspaceId: string,
  userId: string,
): Promise<LlamadasVendedoraData> {
  const now = new Date();
  const dueBefore = endOfTodayUtc(now);

  let llamarHoy: LlamadaLead[] = [];
  let whatsappHoy: LlamadaLead[] = [];
  let nuevos: LlamadaLead[] = [];

  try {
    // Último intento por lead (DISTINCT ON) + estado y datos del contacto, en una sola query.
    const latestRows = await prisma.$queryRaw<LatestCallRow[]>`
      SELECT DISTINCT ON (ca."contactId")
        ca."contactId"      AS "contactId",
        c."name"            AS "name",
        c."phoneNumber"     AS "phoneNumber",
        c."metadata"        AS "metadata",
        c."avatarUrl"       AS "avatarUrl",
        c."crmStage"        AS "crmStage",
        ca."result"         AS "result",
        ca."attemptNumber"  AS "attemptNumber",
        ca."nextContactAt"  AS "nextContactAt"
      FROM "CallAttempt" ca
      JOIN "Contact" c ON c."id" = ca."contactId"
      WHERE ca."workspaceId" = ${workspaceId}
        AND c."excludedFromCrm" = false
        AND EXISTS (
          SELECT 1 FROM "Conversation" cv
          WHERE cv."contactId" = c."id"
            AND cv."workspaceId" = ${workspaceId}
            AND (cv."assignedToUserId" = ${userId} OR cv."assignedToUserId" IS NULL)
        )
      ORDER BY ca."contactId", ca."calledAt" DESC
    `;

    const toLead = (row: LatestCallRow): LlamadaLead => ({
      contactId: row.contactId,
      name: row.name?.trim() || row.phoneNumber,
      phoneNumber: row.phoneNumber,
      callablePhone: resolveCallablePhone(row),
      avatarUrl: row.avatarUrl,
      stage: row.crmStage,
      lastResultLabel: getCallResultLabel(row.result),
      attemptCount: row.attemptNumber,
      nextContactAt: row.nextContactAt ? row.nextContactAt.toISOString() : null,
    });

    // Due = tiene próximo contacto y ya llegó (hoy o vencido). Vencidos primero (más urgentes).
    const due = latestRows.filter((row) => row.nextContactAt && row.nextContactAt <= dueBefore);
    const byNextAsc = (a: LlamadaLead, b: LlamadaLead) =>
      (a.nextContactAt ?? "").localeCompare(b.nextContactAt ?? "");

    llamarHoy = due.filter((row) => row.crmStage === "NEGOCIACION").map(toLead).sort(byNextAsc);
    whatsappHoy = due.filter((row) => row.crmStage === "PROPUESTA").map(toLead).sort(byNextAsc);

    // Nuevos sin tocar: etapa NUEVO y CERO llamadas registradas. Máx. 10, los más recientes.
    const nuevosRows = await prisma.contact.findMany({
      where: {
        workspaceId,
        excludedFromCrm: false,
        crmStage: "NUEVO",
        callAttempts: { none: {} },
        conversations: {
          some: { OR: [{ assignedToUserId: userId }, { assignedToUserId: null }] },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, name: true, phoneNumber: true, avatarUrl: true, crmStage: true, metadata: true },
    });
    nuevos = nuevosRows.map((contact) => ({
      contactId: contact.id,
      name: contact.name?.trim() || contact.phoneNumber,
      phoneNumber: contact.phoneNumber,
      callablePhone: resolveCallablePhone(contact),
      avatarUrl: contact.avatarUrl,
      stage: contact.crmStage,
      lastResultLabel: null,
      attemptCount: 0,
      nextContactAt: null,
    }));
  } catch (error) {
    console.error("[getLlamadasVendedoraData] error", error);
  }

  return {
    generatedAt: now.toISOString(),
    llamarHoy,
    whatsappHoy,
    nuevos,
  };
}

// ── TABLERO DUEÑO ───────────────────────────────────────────────────────────────────────────

export type LlamadasOwnerData = {
  generatedAt: string;
  callsToday: number;
  callsThisWeek: number;
  // Llamadas por vendedor (hoy / semana).
  byUser: Array<{ userId: string | null; name: string; today: number; week: number }>;
  /**
   * Tablero por vendedora: como viene cada una, en una sola fila.
   *
   * Antes solo se veian las llamadas, que es una parte chica del trabajo. Con los leads ya
   * repartidos (cada una se queda con el chat que contesta) se puede mostrar tambien cuantos
   * tiene a cargo, cuantos movio hoy y cuanto cerro — que es lo que Alex necesita para saber
   * quien esta empujando y quien esta trabada.
   */
  equipo: Array<{
    userId: string | null;
    name: string;
    leadsACargo: number;
    conMovimientoHoy: number;
    llamadasHoy: number;
    llamadasSemana: number;
    ventasSemana: number;
  }>;
  // Conteo REAL de leads por etapa (excluye descartados del CRM).
  stageDistribution: Array<{ stage: CrmStage; count: number }>;
  // Motivos de pérdida más frecuentes.
  lostReasons: Array<{ reason: string; label: string; count: number }>;
  // Leads activos que se están "pudriendo": +5 días sin ningún intento de llamada.
  rottingCount: number;
  rotting: Array<{ contactId: string; name: string; phoneNumber: string; daysSinceLastCall: number | null }>;
};

const ACTIVE_STAGES: CrmStage[] = ["NUEVO", "CALIFICADO", "PROPUESTA", "NEGOCIACION"];

export async function getLlamadasOwnerData(workspaceId: string): Promise<LlamadasOwnerData> {
  const now = new Date();
  const startToday = startOfTodayUtc(now);
  const startWeek = new Date(startToday.getTime() - 6 * 24 * 60 * 60 * 1000); // últimos 7 días
  const rottenBefore = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

  const result: LlamadasOwnerData = {
    generatedAt: now.toISOString(),
    callsToday: 0,
    callsThisWeek: 0,
    byUser: [],
    equipo: [],
    stageDistribution: [],
    lostReasons: [],
    rottingCount: 0,
    rotting: [],
  };

  try {
    // Llamadas de la semana con quién llamó, para contar hoy/semana por vendedor.
    const weekCalls = await prisma.callAttempt.findMany({
      where: { workspaceId, calledAt: { gte: startWeek } },
      select: { calledAt: true, calledByUserId: true, calledBy: { select: { name: true, email: true } } },
    });

    const perUser = new Map<string, { name: string; today: number; week: number }>();
    for (const call of weekCalls) {
      const key = call.calledByUserId ?? "sin_usuario";
      const name = call.calledBy?.name?.trim() || call.calledBy?.email || "Sin asignar";
      const entry = perUser.get(key) ?? { name, today: 0, week: 0 };
      entry.week += 1;
      if (call.calledAt >= startToday) {
        entry.today += 1;
        result.callsToday += 1;
      }
      result.callsThisWeek += 1;
      perUser.set(key, entry);
    }
    result.byUser = Array.from(perUser.entries())
      .map(([userId, value]) => ({ userId: userId === "sin_usuario" ? null : userId, ...value }))
      .sort((a, b) => b.week - a.week);

    /**
     * Tablero por vendedora. Se arma con lo que se puede medir de verdad:
     *
     *  - leads a cargo y ventas salen de la ASIGNACION de la conversacion,
     *  - las llamadas del registro de llamadas.
     *
     * "Con movimiento hoy" cuenta chats que se movieron hoy, sin distinguir si escribio ella o
     * el cliente: los mensajes no guardan quien los escribio, asi que decir "respondidos por
     * Marcela" seria inventarlo. Se llama como lo que realmente mide.
     */
    const [aCargo, movidosHoy, ganadosSemana, miembros] = await Promise.all([
      prisma.conversation.groupBy({
        by: ["assignedToUserId"],
        where: { workspaceId, assignedToUserId: { not: null }, contact: { excludedFromCrm: false } },
        _count: { _all: true },
      }),
      prisma.conversation.groupBy({
        by: ["assignedToUserId"],
        where: {
          workspaceId,
          assignedToUserId: { not: null },
          lastMessageAt: { gte: startToday },
          contact: { excludedFromCrm: false },
        },
        _count: { _all: true },
      }),
      prisma.conversation.groupBy({
        by: ["assignedToUserId"],
        where: {
          workspaceId,
          assignedToUserId: { not: null },
          contact: { crmStage: "GANADO", wonAt: { gte: startWeek } },
        },
        _count: { _all: true },
      }),
      prisma.workspaceMember.findMany({
        where: { workspaceId, isActive: true },
        select: { userId: true, user: { select: { name: true, email: true } } },
      }),
    ]);

    const cuenta = (filas: Array<{ assignedToUserId: string | null; _count: { _all: number } }>) =>
      new Map(filas.map((fila) => [fila.assignedToUserId ?? "", fila._count._all]));
    const mapaACargo = cuenta(aCargo);
    const mapaMovidos = cuenta(movidosHoy);
    const mapaGanados = cuenta(ganadosSemana);

    result.equipo = miembros
      .map((miembro) => {
        const llamadas = perUser.get(miembro.userId);
        return {
          userId: miembro.userId,
          name: miembro.user?.name?.trim() || miembro.user?.email || "Sin nombre",
          leadsACargo: mapaACargo.get(miembro.userId) ?? 0,
          conMovimientoHoy: mapaMovidos.get(miembro.userId) ?? 0,
          llamadasHoy: llamadas?.today ?? 0,
          llamadasSemana: llamadas?.week ?? 0,
          ventasSemana: mapaGanados.get(miembro.userId) ?? 0,
        };
      })
      .sort((a, b) => b.ventasSemana - a.ventasSemana || b.leadsACargo - a.leadsACargo);

    // Distribución real por etapa.
    const stageGroups = await prisma.contact.groupBy({
      by: ["crmStage"],
      where: { workspaceId, excludedFromCrm: false },
      _count: { _all: true },
    });
    const stageOrder: CrmStage[] = ["NUEVO", "CALIFICADO", "PROPUESTA", "NEGOCIACION", "GANADO", "PERDIDO"];
    result.stageDistribution = stageOrder.map((stage) => ({
      stage,
      count: stageGroups.find((group) => group.crmStage === stage)?._count._all ?? 0,
    }));

    // Motivos de pérdida (contactos PERDIDO agrupados por lostReason).
    const lostGroups = await prisma.contact.groupBy({
      by: ["lostReason"],
      where: { workspaceId, excludedFromCrm: false, crmStage: "PERDIDO", lostReason: { not: null } },
      _count: { _all: true },
    });
    result.lostReasons = lostGroups
      .map((group) => ({
        reason: group.lostReason as string,
        label: getCrmLostReasonLabel(group.lostReason) ?? (group.lostReason as string),
        count: group._count._all,
      }))
      .sort((a, b) => b.count - a.count);

    // Leads que se pudren: activos, con última llamada hace +5 días O sin ninguna llamada.
    const rottingRows = await prisma.$queryRaw<
      Array<{ contactId: string; name: string | null; phoneNumber: string; lastCall: Date | null }>
    >`
      SELECT c."id" AS "contactId", c."name" AS "name", c."phoneNumber" AS "phoneNumber",
             MAX(ca."calledAt") AS "lastCall"
      FROM "Contact" c
      LEFT JOIN "CallAttempt" ca ON ca."contactId" = c."id"
      WHERE c."workspaceId" = ${workspaceId}
        AND c."excludedFromCrm" = false
        AND c."crmStage"::text = ANY(${ACTIVE_STAGES}::text[])
      GROUP BY c."id", c."name", c."phoneNumber"
      HAVING MAX(ca."calledAt") IS NULL OR MAX(ca."calledAt") < ${rottenBefore}
    `;
    result.rottingCount = rottingRows.length;
    result.rotting = rottingRows
      .map((row) => ({
        contactId: row.contactId,
        name: row.name?.trim() || row.phoneNumber,
        phoneNumber: row.phoneNumber,
        daysSinceLastCall: row.lastCall
          ? Math.floor((now.getTime() - row.lastCall.getTime()) / (24 * 60 * 60 * 1000))
          : null,
      }))
      .sort((a, b) => (b.daysSinceLastCall ?? 9999) - (a.daysSinceLastCall ?? 9999))
      .slice(0, 30);
  } catch (error) {
    console.error("[getLlamadasOwnerData] error", error);
  }

  return result;
}
