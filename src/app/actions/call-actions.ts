"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import {
  canAccessClientModule,
  getClientWorkspaceAccessForUser,
  requireClientWorkspaceAccess,
} from "@/lib/client-workspace-access";
import { AVISO_MODO_MONITOREO, estaEnModoMonitoreo } from "@/lib/modo-monitoreo";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import {
  CALL_RESULTS,
  CALL_RESULT_LOST,
  CALL_RESULT_STAGE_EFFECT,
  CALL_RESULT_PENDING,
  getCallResultLabel,
  getCrmLostReasonLabel,
  isPendingCallResult,
  type CallResult, motivoOtroSinDetalle } from "@/features/crm/domain/crm-config";
import { updateCrmStageAction } from "@/app/actions/crm-actions";
import { transcribirYResumirLlamada, type SugerenciaDeLlamada } from "@/lib/llamada-transcripcion";

const CALL_RESULT_VALUES = CALL_RESULTS.map((result) => result.value) as [string, ...string[]];

const registerCallSchema = z.object({
  contactId: z.string().trim().min(1),
  result: z.enum(CALL_RESULT_VALUES),
  summary: z.string().trim().max(280).optional(),
  // ISO date del PRÓXIMO contacto (solo la fecha importa, se ancla al mediodía de Bogotá).
  nextContactAt: z.string().trim().min(1).optional(),
  // Obligatorio solo cuando result === "perdido".
  lostReason: z.string().trim().min(1).max(140).optional(),
  // Fecha REAL de la llamada (para registro retroactivo del Google Sheet). Si no viene, es ahora.
  calledAt: z.string().trim().min(1).optional(),
  /**
   * Id del intento que hay que COMPLETAR, en vez de crear uno nuevo.
   *
   * Lo usa la asesora cuando la llamada ya fue anotada sola por WaCalls y solo falta decir cómo
   * quedó. Si se creara un intento nuevo, la misma llamada quedaría contada dos veces y el lead
   * figuraría con el doble de intentos de los que tuvo.
   */
  completeAttemptId: z.string().trim().min(1).optional(),
});

export type RegisterCallInput = z.infer<typeof registerCallSchema>;

export type UltimaLlamada = {
  id: string;
  etiqueta: string;
  /** Se hablo pero nadie dijo todavia como quedo: el aviso ofrece clasificarla. */
  pendiente: boolean;
  noContesto: boolean;
  resumen: string | null;
  calledAt: string;
  intento: number;
};

/**
 * La ultima llamada de un contacto, para el aviso de arriba del chat (pedido de Alex, 14-sep-2026):
 * quien abre el chat ve que paso en la llamada antes de escribir, y si falta, la clasifica ahi.
 *
 * Devuelve null -sin aviso- si no hubo llamadas o si quien mira no tiene el modulo de Llamadas.
 * No usa requireClientWorkspaceAccess porque ese REDIRIGE: llamado desde el chat sacaria a la
 * asesora de la pantalla.
 */
export async function ultimaLlamadaDelContactoAction(contactId: string): Promise<UltimaLlamada | null> {
  const session = await auth();
  if (!session?.user?.id || typeof contactId !== "string" || !contactId.trim()) {
    return null;
  }
  const access = await getClientWorkspaceAccessForUser(session.user.id);
  if (!access || !canAccessClientModule(access, "llamadas")) {
    return null;
  }

  const intento = await prisma.callAttempt.findFirst({
    where: { workspaceId: access.workspaceId, contactId: contactId.trim() },
    orderBy: { calledAt: "desc" },
    select: { id: true, result: true, summary: true, calledAt: true, attemptNumber: true },
  });
  if (!intento) {
    return null;
  }

  return {
    id: intento.id,
    etiqueta: getCallResultLabel(intento.result) ?? intento.result,
    pendiente: isPendingCallResult(intento.result),
    noContesto: intento.result === "no_contesto",
    resumen: intento.summary?.trim() || null,
    calledAt: intento.calledAt.toISOString(),
    intento: intento.attemptNumber,
  };
}

/**
 * La transcripcion y el resultado sugerido de una llamada grabada, para llenar "¿Cómo quedó?".
 *
 * Si todavia no se habia transcrito (llamadas anteriores a esto, o fallo al guardar la grabacion),
 * se hace ahora: tarda unos segundos y el formulario muestra que esta escuchando.
 */
export async function sugerenciaDeLlamadaAction(
  attemptId: string,
): Promise<{ sugerencia: SugerenciaDeLlamada | null } | { error: string }> {
  const session = await auth();
  if (!session?.user?.id || typeof attemptId !== "string" || !attemptId.trim()) {
    return { error: "No autorizado" };
  }
  const access = await getClientWorkspaceAccessForUser(session.user.id);
  if (!access || !canAccessClientModule(access, "llamadas")) {
    return { error: "No autorizado" };
  }
  const intento = await prisma.callAttempt.findFirst({
    where: { id: attemptId.trim(), workspaceId: access.workspaceId },
    select: { id: true },
  });
  if (!intento) {
    return { error: "Esa llamada ya no está disponible" };
  }
  try {
    return { sugerencia: await transcribirYResumirLlamada(intento.id) };
  } catch (error) {
    console.warn("[llamadas] no se pudo transcribir", error);
    return { error: "No se pudo escuchar la grabación" };
  }
}

export type DetalleDeLlamada = {
  id: string;
  contactId: string;
  cliente: string;
  calledAt: string;
  asesora: string | null;
  intento: number;
  resultado: string;
  pendiente: boolean;
  /** Lo que escribio la asesora al clasificar; el automatico ("Llamada saliente · 12s") va en `como`. */
  resumen: string | null;
  como: string | null;
  proximoContacto: string | null;
  motivoPerdida: string | null;
  grabacion: string | null;
  resumenIa: string | null;
  transcripcion: string | null;
};

/**
 * El detalle de la llamada que se toco en el chat (Alex, 15-sep-2026: la burbuja con el resumen
 * largo desbordaba el chat; ahora es corta y el detalle se abre aparte).
 *
 * El id viene del mensaje: `llamada:<intento>` cuando la nota se armo desde el intento, o el id de
 * un Message guardado por WaCalls, que se ubica por contacto y hora (±2 min, igual que el cargador).
 */
export async function detalleDeLlamadaAction(messageId: string): Promise<{ detalle: DetalleDeLlamada } | { error: string }> {
  const session = await auth();
  if (!session?.user?.id || typeof messageId !== "string" || !messageId.trim()) {
    return { error: "No autorizado" };
  }
  const access = await getClientWorkspaceAccessForUser(session.user.id);
  if (!access) {
    return { error: "No autorizado" };
  }

  const seleccion = {
    id: true,
    contactId: true,
    calledAt: true,
    attemptNumber: true,
    result: true,
    summary: true,
    nextContactAt: true,
    lostReason: true,
    recordingUrl: true,
    calledBy: { select: { name: true, email: true } },
    contact: { select: { name: true, phoneNumber: true } },
  } as const;

  let intento = null;
  if (messageId.startsWith("llamada:")) {
    intento = await prisma.callAttempt.findFirst({
      where: { id: messageId.slice("llamada:".length), workspaceId: access.workspaceId },
      select: seleccion,
    });
  } else {
    const mensaje = await prisma.message.findFirst({
      where: { id: messageId, workspaceId: access.workspaceId, type: "SYSTEM" },
      select: { contactId: true, createdAt: true },
    });
    if (mensaje?.contactId) {
      const cercanos = await prisma.callAttempt.findMany({
        where: {
          workspaceId: access.workspaceId,
          contactId: mensaje.contactId,
          calledAt: {
            gte: new Date(mensaje.createdAt.getTime() - 2 * 60 * 1000),
            lte: new Date(mensaje.createdAt.getTime() + 2 * 60 * 1000),
          },
        },
        select: seleccion,
      });
      intento =
        cercanos.sort(
          (a, b) =>
            Math.abs(a.calledAt.getTime() - mensaje.createdAt.getTime()) -
            Math.abs(b.calledAt.getTime() - mensaje.createdAt.getTime()),
        )[0] ?? null;
    }
  }
  if (!intento) {
    return { error: "No se encontró el registro de esta llamada" };
  }

  const guardada = await prisma.appSetting.findUnique({ where: { key: `llamada:transcripcion:${intento.id}` } });
  let ia: { resumen?: string; transcripcion?: string } = {};
  try {
    ia = guardada ? (JSON.parse(guardada.value) as typeof ia) : {};
  } catch {
    ia = {};
  }

  const resumen = intento.summary?.trim() || null;
  const esAutomatico = Boolean(resumen && /^llamada\s+(entrante|saliente)/i.test(resumen));

  return {
    detalle: {
      id: intento.id,
      contactId: intento.contactId,
      cliente: intento.contact.name?.trim() || intento.contact.phoneNumber,
      calledAt: intento.calledAt.toISOString(),
      asesora: intento.calledBy?.name?.trim() || intento.calledBy?.email || null,
      intento: intento.attemptNumber,
      resultado: getCallResultLabel(intento.result) ?? intento.result,
      pendiente: isPendingCallResult(intento.result),
      resumen: esAutomatico ? null : resumen,
      como: esAutomatico ? resumen : null,
      proximoContacto: intento.nextContactAt ? intento.nextContactAt.toISOString() : null,
      motivoPerdida: intento.lostReason ? getCrmLostReasonLabel(intento.lostReason) : null,
      grabacion: intento.recordingUrl,
      resumenIa: ia.resumen?.trim() || null,
      transcripcion: ia.transcripcion?.trim() || null,
    },
  };
}

export type LlamadaDelEquipo = {
  id: string;
  calledAt: string;
  asesora: string;
  cliente: string;
  telefono: string;
  conversationId: string | null;
  resultado: string;
  pendiente: boolean;
  resumen: string | null;
  /** Lo que resumio la IA de la grabacion, si se transcribio. */
  resumenIa: string | null;
  grabacion: string | null;
};

const LLAMADAS_POR_PAGINA = 30;

/**
 * Todas las llamadas del negocio, de la mas nueva a la mas vieja, con su grabacion.
 *
 * Solo dueño o administrador (Alex, 15-sep-2026): escuchar las llamadas de todo el equipo es
 * supervision. Cada asesora sigue viendo las suyas en su Resumen.
 */
export async function llamadasDelEquipoAction(input: {
  pagina?: number;
  soloConGrabacion?: boolean;
}): Promise<{ llamadas: LlamadaDelEquipo[]; hayMas: boolean } | { error: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "No autorizado" };
  }
  const access = await getClientWorkspaceAccessForUser(session.user.id);
  if (!access || !canAccessClientModule(access, "llamadas") || !(access.isOwner || access.role === "ADMIN")) {
    return { error: "Solo el dueño o un administrador" };
  }

  const pagina = Math.max(0, Math.floor(Number(input.pagina) || 0));
  const intentos = await prisma.callAttempt.findMany({
    where: {
      workspaceId: access.workspaceId,
      ...(input.soloConGrabacion ? { recordingUrl: { not: null } } : {}),
    },
    orderBy: { calledAt: "desc" },
    skip: pagina * LLAMADAS_POR_PAGINA,
    take: LLAMADAS_POR_PAGINA + 1,
    select: {
      id: true,
      calledAt: true,
      result: true,
      summary: true,
      recordingUrl: true,
      calledBy: { select: { name: true, email: true } },
      contact: {
        select: {
          name: true,
          phoneNumber: true,
          conversations: {
            where: { workspaceId: access.workspaceId },
            orderBy: { lastMessageAt: "desc" },
            take: 1,
            select: { id: true },
          },
        },
      },
    },
  });

  const pagina30 = intentos.slice(0, LLAMADAS_POR_PAGINA);
  const transcripciones = pagina30.length
    ? await prisma.appSetting.findMany({
        where: { key: { in: pagina30.map((intento) => `llamada:transcripcion:${intento.id}`) } },
        select: { key: true, value: true },
      })
    : [];
  const resumenIaDe = (id: string) => {
    const fila = transcripciones.find((t) => t.key === `llamada:transcripcion:${id}`);
    try {
      return fila ? ((JSON.parse(fila.value) as { resumen?: string }).resumen?.trim() || null) : null;
    } catch {
      return null;
    }
  };

  return {
    hayMas: intentos.length > LLAMADAS_POR_PAGINA,
    llamadas: pagina30.map((intento) => ({
      id: intento.id,
      calledAt: intento.calledAt.toISOString(),
      asesora: intento.calledBy?.name?.trim() || intento.calledBy?.email || "Sin asesora",
      cliente: intento.contact.name?.trim() || intento.contact.phoneNumber,
      telefono: intento.contact.phoneNumber,
      conversationId: intento.contact.conversations[0]?.id ?? null,
      resultado: getCallResultLabel(intento.result) ?? intento.result,
      pendiente: isPendingCallResult(intento.result),
      resumen: intento.summary?.trim() || null,
      resumenIa: resumenIaDe(intento.id),
      grabacion: intento.recordingUrl,
    })),
  };
}

const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

function bogotaToday(now: Date) {
  // en-CA da el formato "2026-07-31", igual que el <input type="date">.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(now);
}

/**
 * Las fechas del formulario vienen de un <input type="date">, o sea "2026-07-31" pelado.
 *
 * `new Date("2026-07-31")` lo lee como medianoche UTC, que en Bogotá son las SIETE DE LA TARDE
 * DEL DÍA ANTERIOR. Por eso una llamada registrada hoy quedaba guardada ayer y el resumen del
 * día le mostraba 0 llamadas a la asesora que sí las había cargado. Lo mismo le pasaba al
 * próximo contacto: uno agendado para mañana caía en "llamar hoy".
 *
 * Se ancla al MEDIODÍA de Bogotá: bien adentro del día elegido, sin riesgo de irse al vecino.
 */
function parseOptionalDate(value: string | undefined): Date | null | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(SOLO_FECHA.test(value) ? `${value}T12:00:00-05:00` : value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

/**
 * Cuando la llamada es de HOY se guarda la hora real, no el mediodía: así el orden de las
 * llamadas del día es el de verdad. El mediodía queda solo para el registro retroactivo.
 */
function resolveCalledAt(value: string | undefined, now: Date): Date {
  if (!value || value === bogotaToday(now)) {
    return now;
  }
  return parseOptionalDate(value) ?? now;
}

/**
 * Registra UN intento de llamada a un lead y aplica la regla de etapa del Playbook.
 *
 * No envía WhatsApp (eso es Fase 2): si el resultado cambia la etapa (lo piensa → Tibio,
 * Ganado, Perdido) se delega en updateCrmStageAction, que ya dispara los seguimientos por
 * CRM_STAGE y registra la actividad — exactamente igual que mover la tarjeta en el kanban.
 */
export async function registerCallAttemptAction(input: RegisterCallInput) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return { error: "No autorizado" };
  }
  await requireClientWorkspaceAccess("llamadas");

  const parsed = registerCallSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Datos inválidos" };
  }

  const isLost = parsed.data.result === CALL_RESULT_LOST;
  const lostReason = isLost ? parsed.data.lostReason?.trim() || "" : null;
  // "Perdido" SIEMPRE requiere motivo — no se puede guardar sin él (regla del Playbook).
  if (isLost && !lostReason) {
    return { error: "Para cerrar como Perdido tenés que elegir un motivo." };
  }
  if (isLost && motivoOtroSinDetalle(lostReason)) {
    return { error: "Escribe cuál fue la razón de «Otro»." };
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    return { error: "Workspace no encontrado" };
  }
  const workspaceId = membership.workspace.id;

  /*
    Quien solo monitorea no llama.

    Registrar una llamada es afirmar que se hablo con el cliente, y el modo existe justamente para
    que no lo contacte. Ver `modo-monitoreo.ts`.
  */
  if (await estaEnModoMonitoreo({ workspaceId, userId: session.user.id })) {
    return { error: AVISO_MODO_MONITOREO };
  }

  const contact = await prisma.contact.findFirst({
    where: { id: parsed.data.contactId, workspaceId },
    select: { id: true },
  });
  if (!contact) {
    return { error: "Contacto no encontrado" };
  }

  const now = new Date();
  const nextContactAt = parseOptionalDate(parsed.data.nextContactAt) ?? null;
  const calledAt = resolveCalledAt(parsed.data.calledAt, now);

  /**
   * Completar una llamada que ya estaba anotada, o anotar una nueva.
   *
   * Al completar se respetan el número de intento y la hora ORIGINALES: los puso el sistema
   * cuando la llamada de verdad ocurrió, y son más fiables que la fecha que muestra el formulario
   * (que es "hoy"). Lo que sí queda es quién la clasificó.
   */
  const paraCompletar = parsed.data.completeAttemptId
    ? await prisma.callAttempt.findFirst({
        where: { id: parsed.data.completeAttemptId, workspaceId, contactId: contact.id },
        select: { id: true, calledAt: true },
      })
    : null;

  if (parsed.data.completeAttemptId && !paraCompletar) {
    return { error: "Esa llamada ya no está disponible. Recargá la página." };
  }

  if (paraCompletar) {
    await prisma.callAttempt.update({
      where: { id: paraCompletar.id },
      data: {
        calledByUserId: session.user.id,
        result: parsed.data.result,
        summary: parsed.data.summary?.trim() || null,
        nextContactAt,
        lostReason,
      },
    });
    /*
      Las llamadas ANTERIORES del mismo cliente que seguian sin clasificar quedan con el mismo
      resultado. En "Sin registrar" se muestra una tarjeta por cliente (la ultima llamada); sin esto
      las viejas nunca se cerraban y el cliente volvia a aparecer repetido.
    */
    await prisma.callAttempt.updateMany({
      where: {
        workspaceId,
        contactId: contact.id,
        result: CALL_RESULT_PENDING,
        calledAt: { lt: paraCompletar.calledAt },
      },
      data: { calledByUserId: session.user.id, result: parsed.data.result, lostReason },
    });
  } else {
    // intento_numero = cuántas llamadas ya tiene este lead + 1.
    const previousAttempts = await prisma.callAttempt.count({
      where: { workspaceId, contactId: contact.id },
    });

    await prisma.callAttempt.create({
      data: {
        workspaceId,
        contactId: contact.id,
        calledByUserId: session.user.id,
        attemptNumber: previousAttempts + 1,
        result: parsed.data.result,
        summary: parsed.data.summary?.trim() || null,
        nextContactAt,
        lostReason,
        calledAt,
      },
    });
  }

  // Regla de etapa del Playbook (si aplica). Se reutiliza updateCrmStageAction para heredar el
  // disparo de seguimientos por CRM_STAGE y el registro de actividad, igual que el kanban.
  const stageEffect = CALL_RESULT_STAGE_EFFECT[parsed.data.result as CallResult];
  if (stageEffect) {
    await updateCrmStageAction({
      contactId: contact.id,
      status: stageEffect,
      lostReason: isLost ? lostReason ?? undefined : undefined,
      // Playbook: "Ganado el día del pago, ligado al intento que lo cerró" → la fecha de venta
      // es la fecha de ESTA llamada (calledAt, editable para registro retroactivo). Al completar
      // una llamada ya anotada vale la fecha ORIGINAL: la venta se cerró cuando se habló, no
      // cuando la asesora se sentó a clasificarla.
      wonAt:
        stageEffect === "GANADO"
          ? (paraCompletar?.calledAt ?? calledAt).toISOString()
          : undefined,
    });
  }

  revalidatePath("/cliente/llamadas");
  revalidatePath("/cliente/crm/mi-dia");
  return { success: true as const };
}

export type CallContactSearchItem = {
  contactId: string;
  name: string;
  phoneNumber: string;
  avatarUrl: string | null;
  stage: string;
};

/**
 * Busca contactos por nombre o teléfono para registrar una llamada a un lead que NO está en los
 * buckets de hoy (p.ej. registrar RETROACTIVAMENTE las llamadas que Ingrid ya hizo esta semana,
 * migrando el Google Sheet).
 */
export async function searchContactsForCallAction(query: string): Promise<{ items: CallContactSearchItem[] }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { items: [] };
  }
  await requireClientWorkspaceAccess("llamadas");

  const term = query.trim();
  if (term.length < 2) {
    return { items: [] };
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    return { items: [] };
  }

  const contacts = await prisma.contact.findMany({
    where: {
      workspaceId: membership.workspace.id,
      excludedFromCrm: false,
      OR: [
        { name: { contains: term, mode: "insensitive" } },
        { phoneNumber: { contains: term } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: 12,
    select: { id: true, name: true, phoneNumber: true, avatarUrl: true, crmStage: true },
  });

  return {
    items: contacts.map((contact) => ({
      contactId: contact.id,
      name: contact.name?.trim() || contact.phoneNumber,
      phoneNumber: contact.phoneNumber,
      avatarUrl: contact.avatarUrl,
      stage: contact.crmStage,
    })),
  };
}

export type CallHistoryItem = {
  id: string;
  attemptNumber: number;
  resultLabel: string;
  summary: string | null;
  calledAt: string;
  nextContactAt: string | null;
  calledByName: string | null;
};

/**
 * Historial de intentos de llamada de un contacto, para el modal del lead en el Kanban
 * ("qué pasó la última vez"). Se gatea con "crm" porque lo consume el Kanban del CRM.
 */
export async function getContactCallHistoryAction(contactId: string): Promise<{ items: CallHistoryItem[] }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { items: [] };
  }
  await requireClientWorkspaceAccess("crm");

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    return { items: [] };
  }

  const attempts = await prisma.callAttempt.findMany({
    where: { workspaceId: membership.workspace.id, contactId },
    orderBy: { calledAt: "desc" },
    take: 20,
    select: {
      id: true,
      attemptNumber: true,
      result: true,
      summary: true,
      calledAt: true,
      nextContactAt: true,
      calledBy: { select: { name: true, email: true } },
    },
  });

  return {
    items: attempts.map((attempt) => ({
      id: attempt.id,
      attemptNumber: attempt.attemptNumber,
      resultLabel: getCallResultLabel(attempt.result) ?? attempt.result,
      summary: attempt.summary,
      calledAt: attempt.calledAt.toISOString(),
      nextContactAt: attempt.nextContactAt?.toISOString() ?? null,
      calledByName: attempt.calledBy?.name?.trim() || attempt.calledBy?.email || null,
    })),
  };
}
