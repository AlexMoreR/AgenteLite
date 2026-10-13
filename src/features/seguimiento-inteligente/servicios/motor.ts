import { Prisma } from "@prisma/client";

import { avisoSiNoSePuedeDescartar } from "@/features/crm/services/candado-descarte-sin-respuesta";
import type { EventoDelEmbudo } from "@/features/embudo/dominio/eventos";
import { enSegundoPlano, registrarEventos } from "@/features/embudo/servicios/eventos";
import { cancelarAutomaticosPendientesDelContacto, createFollow } from "@/features/seguimientos/services/follows";
import { getFlowReply } from "@/lib/agent-product-flow";
import { autoAssignConversationToCollaborator } from "@/lib/reparto-de-leads";
import { recordConversationActivity } from "@/lib/conversation-activity";
import { prisma } from "@/lib/prisma";

import { algoPrendido, esExcepcionQueActua, type ConfigSeguimientoInteligente } from "../dominio/config";
import { datosDeRecuperacion, evaluarLead, modoDeLaDecision, type Decision, type Evaluacion } from "../dominio/motor";
import { MOTIVO_RECUPERACION, cortoUnSilencioLargo } from "../dominio/recuperacion";
import { textoPermitido } from "../dominio/producto";
import { PREFIJO_FOLLOW_INTELIGENTE } from "./convivencia";
import { leerConfigSeguimiento, negociosConSeguimiento } from "./config";
import { leerFicha, leerNotasDelTurno, type FichaConContexto } from "./ficha";
import { descartarPorRecuperacion, recuperacionesCerradasAMano } from "./recuperacion";
import { marcarParaReactivar } from "./reactivacion";
import { aplicarTopeDeTareas } from "./tope";
import { barrerDiaSiguiente } from "./dia-siguiente";
import { barrerTrasAsesora } from "./tras-asesora";

/**
 * EL MOTOR EN VIVO del seguimiento inteligente.
 *
 * - En cada mensaje del cliente (webhook) y en el barrido del reloj, mira el lead, lo califica (F2)
 *   y decide la siguiente acción con la regla pura de dominio/motor.ts.
 * - Registra en el embudo: TEMPERATURA (si cambió) y SIGUIENTE_ACCION (si cambió la decisión).
 * - Modo "sombra": solo registra lo que HARÍA. Modo "activo": agenda el mensaje útil (pasa por el
 *   motor de seguimientos, o sea por el anti-bloqueo y el freno de siempre) y deja la tarea visible
 *   en Mi día y en el Supervisor. Nunca le escribe al cliente directamente.
 * - Nada de esto lanza ni demora la respuesta al cliente.
 */

function anotarError(donde: string, error: unknown, extra: Record<string, unknown> = {}) {
  console.warn(`[seguimiento-inteligente] ${donde}`, { ...extra, error: error instanceof Error ? error.message : String(error) });
}

// La Recuperación 72 h, el exterior y el descarte tienen su propio interruptor; con
// `motor.excepcionesActivas` el formulario y la cotización actúan aunque el motor esté en sombra (y el
// compromiso del cliente, con `trasAsesora.compromisoATarea` y el toque tras la asesora en activo).
const modoDe = modoDeLaDecision;

function datosDeLaDecision(decision: Decision, evaluacion: Evaluacion, modo: string): Record<string, unknown> {
  return {
    accion: decision.accion,
    motivo: decision.motivo,
    modo,
    prioridad: decision.prioridad,
    vence: decision.vence?.toISOString() ?? null,
    mensajeSugerido: decision.mensajeSugerido,
    mensajeUtil: decision.mensajeUtil ? { familia: decision.mensajeUtil.familia, resumen: decision.mensajeUtil.resumen } : null,
    programarPara: decision.programarPara?.toISOString() ?? null,
    supresion: decision.supresion,
    dormidoHasta: decision.dormidoHasta?.toISOString() ?? null,
    fechaCompra: decision.fechaCompra?.fecha.toISOString() ?? null,
    fechaComo: decision.fechaCompra?.como ?? null,
    fechaFragmento: decision.fechaCompra?.fragmento ?? null,
    toque: decision.toque,
    ...(decision.recuperacion ? { recuperacion: decision.recuperacion } : {}),
    ...(decision.detalle ? { detalle: decision.detalle } : {}),
    temperatura: evaluacion.calificacion.temperatura,
    temperaturaBase: evaluacion.calificacion.temperaturaBase,
    producto: evaluacion.familia,
    clave: decision.clave,
  };
}

/** Un flujo con "contraentrega" o "envío gratis" no sale como automático (política vigente). */
async function flujoPermitido(workspaceId: string, flowId: string): Promise<boolean> {
  const flujo = await getFlowReply({ workspaceId, flowId, includeOfficialApi: false }).catch(() => null);
  if (!flujo) return false;
  return flujo.steps.every((paso) => {
    const texto = paso.kind === "text" ? paso.content : "caption" in paso ? paso.caption ?? "" : "";
    return textoPermitido(texto ?? "");
  });
}

async function agendarMensajeUtil(ctx: FichaConContexto, decision: Decision): Promise<boolean> {
  const util = decision.mensajeUtil;
  if (!util) return false;
  for (const accion of util.acciones) {
    if (accion.flowId && !(await flujoPermitido(ctx.workspaceId, accion.flowId))) {
      anotarError("flujo no permitido para el mensaje util", null, { flowId: accion.flowId });
      return false;
    }
  }
  // Uno solo pendiente por contacto: si ya hay uno del motor esperando, no se agenda otro.
  const yaHay = await prisma.follow.count({
    where: { workspaceId: ctx.workspaceId, contactId: ctx.contactId, status: "PENDING", name: { startsWith: PREFIJO_FOLLOW_INTELIGENTE } },
  });
  if (yaHay > 0) return false;
  const primera = util.acciones[0];
  await createFollow({
    workspaceId: ctx.workspaceId,
    contactId: ctx.contactId,
    channelId: ctx.channelId,
    name: `${PREFIJO_FOLLOW_INTELIGENTE}${util.familia}${decision.toque ? ` · ${decision.toque}` : ""}`,
    timeType: "MINUTES",
    timeValue: 0,
    executeAt: decision.programarPara ?? new Date(),
    messageType: primera.messageType,
    content: primera.content,
    mediaUrl: primera.mediaUrl ?? null,
    actions: util.acciones.map((accion, order) => ({
      order,
      messageType: accion.messageType,
      content: accion.content,
      mediaUrl: accion.mediaUrl ?? null,
      flowId: accion.flowId ?? null,
    })),
    cancelOnActivity: true,
  });
  return true;
}

export const MOTIVO_DESCARTE_CADENCIA = "sin_respuesta";

/**
 * Descarte por la cadencia: PERDIDO con motivo "Sin respuesta", por la misma puerta y con la misma
 * nota que el descarte automático del CRM (sin autor, a la vista). Respeta el candado de la
 * cotización y no pisa un GANADO/PERDIDO. No le escribe nada al cliente.
 */
async function descartarPorCadencia(ctx: FichaConContexto, dias: number[]): Promise<boolean> {
  const aviso = await avisoSiNoSePuedeDescartar({ contactId: ctx.contactId, lostReason: MOTIVO_DESCARTE_CADENCIA }).catch(
    (error) => `no se pudo revisar el candado: ${error instanceof Error ? error.message : String(error)}`,
  );
  if (aviso) {
    console.log("[seguimiento-inteligente] descarte frenado por el candado", { conversationId: ctx.ficha.conversationId, aviso: aviso.slice(0, 200) });
    return false;
  }
  const movidos = await prisma.$executeRaw(Prisma.sql`
    UPDATE "Contact"
    SET "crmStage" = 'PERDIDO', "lostReason" = ${MOTIVO_DESCARTE_CADENCIA}, "wonAt" = NULL, "wonQuoteRef" = NULL, "updatedAt" = NOW()
    WHERE "id" = ${ctx.contactId} AND "crmStage"::text NOT IN ('GANADO', 'PERDIDO')
  `);
  if (movidos === 0) return false;
  await recordConversationActivity({
    workspaceId: ctx.workspaceId,
    conversationId: ctx.ficha.conversationId,
    channelId: ctx.channelId,
    contactId: ctx.contactId,
    kind: "stage_changed",
    actorUserId: null,
    origen: "seguimiento-inteligente",
    text: `Descartado automáticamente: sin respuesta tras 3 seguimientos (días ${dias.join(", ")} después de la asesora). Motivo: Sin respuesta.`,
  }).catch((error) => anotarError("no se pudo dejar la nota del descarte", error));
  await cancelarAutomaticosPendientesDelContacto({ workspaceId: ctx.workspaceId, contactId: ctx.contactId, motivo: "etapa_cerrada" });
  return true;
}

/**
 * Mira un lead: califica, decide, registra y (en modo activo) ejecuta. Nunca lanza.
 * Devuelve la evaluación (para pruebas y para el barrido).
 *
 * `soloRecuperacion`: lo usa el barrido de la Recuperación 72 h en SOMBRA para leads que el motor
 * no mira: solo anota lo que la recuperación HARÍA (RECUPERACION_72H), sin temperatura ni decisión.
 */
export async function revisarLead(conversationId: string, opciones: { ahora?: Date; soloRecuperacion?: boolean } = {}): Promise<Evaluacion | null> {
  try {
    const ctx = await leerFicha(conversationId);
    if (!ctx) return null;
    const config = await leerConfigSeguimiento(ctx.workspaceId);
    if (!algoPrendido(config)) return null;
    const ahora = opciones.ahora ?? new Date();
    const modoRec = config.recuperacion72h.modo;
    // Turno de la conversación: las notas del bot ("pide un asesor…") deciden si el turno es nuestro.
    if (config.turno?.activo) ctx.ficha.notas = await leerNotasDelTurno(conversationId).catch(() => []);
    // Recuperación 72 h: las llamadas registradas y las recuperaciones cerradas a mano.
    if (modoRec !== "apagado") {
      ctx.ficha.llamadas = await leerLlamadas(ctx.workspaceId, ctx.contactId).catch(() => []);
      ctx.ficha.recuperacionesCerradas = await recuperacionesCerradasAMano(conversationId).catch(() => []);
    }
    const evaluacion = evaluarLead(ctx.ficha, config, ahora);
    const { calificacion, decision } = evaluacion;
    const eventos: EventoDelEmbudo[] = [];
    const soloRecuperacion = Boolean(opciones.soloRecuperacion);

    if (!soloRecuperacion && (config.calificacion.activo || config.motor.modo !== "apagado")) {
      const cambio =
        ctx.lead?.temperatura !== calificacion.temperatura ||
        ctx.lead?.puntaje !== calificacion.puntaje ||
        (ctx.lead?.productoInteres ?? null) !== evaluacion.familia;
      if (cambio) {
        eventos.push({
          tipo: "TEMPERATURA",
          origen: "motor",
          producto: null,
          createdAt: ahora,
          datos: {
            temperatura: calificacion.temperatura,
            puntaje: calificacion.puntaje,
            puntajeBase: calificacion.puntajeBase,
            motivo: calificacion.motivo,
            productoInteres: evaluacion.familia,
            senales: calificacion.senales.slice(0, 6).map((s) => ({ tipo: s.tipo, fragmento: s.fragmento.slice(0, 80) })),
          },
        });
      }
    }

    const modoPropio = modoDe(decision, config);
    // Un descarte con su interruptor apagado se anota igual con el modo del motor (si está en sombra).
    const modo = modoPropio === "apagado" && decision.accion === "descartar" ? "apagado" : modoPropio;
    // La recuperación (activa) que estaba guardada y ya no aplica: se vuelve a registrar la decisión
    // de hoy para que la tarea desaparezca de Mi día aunque el motor esté apagado.
    const anterior = ctx.lead?.accionDatos ?? null;
    const salioDeRecuperacion = anterior?.motivo === MOTIVO_RECUPERACION && anterior?.modo === "activo" && decision.motivo !== MOTIVO_RECUPERACION;
    const registrarDecision =
      !soloRecuperacion && (modo !== "apagado" || (config.motor.modo !== "apagado" && decision.accion === "descartar") || salioDeRecuperacion);
    const modoAnotado = modo === "apagado" ? config.motor.modo : modo;
    // Nueva si cambió la decisión o el modo (al pasar de sombra a activo se vuelve a registrar y ejecutar).
    const decisionNueva =
      registrarDecision && (ctx.lead?.accionDatos?.clave !== decision.clave || ctx.lead?.accionDatos?.modo !== modoAnotado);
    if (decisionNueva) {
      eventos.push({ tipo: "SIGUIENTE_ACCION", origen: "motor", createdAt: ahora, datos: datosDeLaDecision(decision, evaluacion, modoAnotado) });
    }
    if (!soloRecuperacion && decision.accion === "excluir_exterior" && config.exterior.activo && !ctx.lead?.exterior) {
      eventos.push({ tipo: "EXTERIOR", origen: "motor", claveUnica: `EXTERIOR:${conversationId}`, createdAt: ahora, datos: { pais: ctx.ficha.pais } });
    }

    // RECUPERACIÓN 72 H: cada fase queda anotada una vez (en sombra, lo que HARÍA).
    // Formulario / cotización con SOLO EXCEPCIONES: manda su tarea (2 h / 24 h / 72 h o 24 h / 72 h);
    // la Recuperación no lo anota como "dentro" para no contarlo dos veces. Cuando sus escalones
    // terminan, la decisión vuelve a ser la de siempre y la Recuperación lo toma si corresponde.
    const rec = esExcepcionQueActua(decision.motivo, config) && evaluacion.recuperacion?.tipo === "dentro" ? null : evaluacion.recuperacion;
    if (modoRec !== "apagado" && rec) {
      const base = { modo: modoRec, asesora: ctx.ficha.asignadaA };
      if (rec.tipo === "dentro") {
        const datos = datosDeRecuperacion(rec.estado);
        eventos.push({
          tipo: "RECUPERACION_72H",
          origen: "motor",
          claveUnica: `REC:${modoRec}:${conversationId}:${rec.estado.entradaEn.toISOString().slice(0, 16)}:${rec.estado.fase}`,
          createdAt: ahora,
          datos: { ...base, ...datos, prioridad: rec.estado.prioridad, habriaDescartado: modoRec === "sombra" && rec.estado.fase === "descartar" },
        });
      } else if (rec.tipo === "recuperado") {
        eventos.push({
          tipo: "RECUPERACION_72H",
          origen: "motor",
          claveUnica: `REC:${modoRec}:${conversationId}:${rec.entradaEn.toISOString().slice(0, 16)}:recuperado`,
          createdAt: ahora,
          datos: { ...base, fase: "recuperado", motivo: rec.motivo, entradaEn: rec.entradaEn.toISOString() },
        });
      } else if (cortoUnSilencioLargo(ctx.ficha.mensajes, config.recuperacion72h.horas)) {
        // El cliente escribió después de 72 h o más: si estaba en recuperación, quedó recuperado.
        const ultimo = await prisma.embudoEvento
          .findFirst({
            where: { conversationId, tipo: "RECUPERACION_72H", createdAt: { gte: new Date(ahora.getTime() - 14 * 86_400_000) } },
            orderBy: { createdAt: "desc" },
            select: { datos: true },
          })
          .catch(() => null);
        const d = (ultimo?.datos ?? {}) as Record<string, unknown>;
        if (ultimo && typeof d.entradaEn === "string" && !["recuperado", "descartado", "deshecho", "mantener"].includes(String(d.fase))) {
          eventos.push({
            tipo: "RECUPERACION_72H",
            origen: "motor",
            claveUnica: `REC:${modoRec}:${conversationId}:${d.entradaEn.slice(0, 16)}:recuperado`,
            createdAt: ahora,
            datos: { ...base, fase: "recuperado", motivo: "cliente_respondio", desdeFase: d.fase ?? null, entradaEn: d.entradaEn },
          });
        }
      }
    }

    // Ejecutar (solo en modo activo y solo cuando la decisión es nueva: así no se repite).
    if (decisionNueva && modo === "activo" && decision.accion === "mensaje_util_producto") {
      const agendado = await agendarMensajeUtil(ctx, decision).catch((error) => {
        anotarError("no se pudo agendar el mensaje util", error, { conversationId });
        return false;
      });
      if (agendado) eventos.push({ tipo: "MENSAJE_UTIL", origen: "motor", createdAt: ahora, datos: { familia: decision.mensajeUtil?.familia, toque: decision.toque } });
    }
    // Recuperación sin dueña: se reparte con la rueda de siempre (respeta pausas, monitoreo y horario).
    if (decisionNueva && modo === "activo" && decision.motivo === MOTIVO_RECUPERACION && decision.accion === "tarea_asesora" && !ctx.ficha.asignadaA && ctx.channelId) {
      const asignada = await autoAssignConversationToCollaborator({ conversationId, channelId: ctx.channelId, workspaceId: ctx.workspaceId, ahora }).catch((error) => {
        anotarError("no se pudo repartir la recuperacion", error, { conversationId });
        return null;
      });
      if (asignada) console.log("[seguimiento-inteligente] recuperacion repartida", { conversationId, asignada });
    }
    if (decision.accion === "descartar" && decision.motivo === MOTIVO_RECUPERACION) {
      if (modo === "activo" && !soloRecuperacion) {
        const motivo = await descartarPorRecuperacion(
          { workspaceId: ctx.workspaceId, conversationId, contactId: ctx.contactId, channelId: ctx.channelId },
          decision.recuperacion,
          { ahora },
        ).catch((error) => (error instanceof Error ? error.message : String(error)));
        if (motivo) console.log("[seguimiento-inteligente] descarte de recuperacion frenado", { conversationId, motivo: motivo.slice(0, 200) });
      }
    } else if (decision.accion === "descartar" && modo !== "apagado" && !soloRecuperacion) {
      if (modo === "activo") {
        const hecho = await descartarPorCadencia(ctx, config.cadencia.dias).catch((error) => {
          anotarError("no se pudo descartar", error, { conversationId });
          return false;
        });
        if (hecho) eventos.push({ tipo: "DESCARTE_CADENCIA", origen: "motor", claveUnica: `DESCARTE:${conversationId}:${ahora.toISOString().slice(0, 10)}`, createdAt: ahora, datos: { modo } });
      } else {
        eventos.push({ tipo: "DESCARTE_CADENCIA", origen: "motor", claveUnica: `DESCARTE-SOMBRA:${conversationId}`, createdAt: ahora, datos: { modo, habriaDescartado: true } });
      }
    }

    if (eventos.length) {
      await registrarEventos({ workspaceId: ctx.workspaceId, conversationId, contactId: ctx.contactId, channelId: ctx.channelId }, eventos);
    }
    if (!soloRecuperacion) {
      // Que el reloj vuelva a mirarlo justo cuando cumpla las 72 h (si eso pasa antes).
      const despertar = rec?.tipo === "fuera" ? rec.despertarEn : rec?.tipo === "dentro" ? rec.estado.revisarEn : null;
      const revisarEn = despertar && despertar.getTime() < decision.revisarEn.getTime() ? despertar : decision.revisarEn;
      await prisma.embudoLead.updateMany({ where: { conversationId }, data: { revisarEn } }).catch(() => undefined);
    }
    return evaluacion;
  } catch (error) {
    anotarError("no se pudo revisar el lead", error, { conversationId });
    return null;
  }
}

/** Las llamadas registradas del contacto (CallAttempt) de los últimos 30 días. */
async function leerLlamadas(workspaceId: string, contactId: string) {
  const filas = await prisma.callAttempt.findMany({
    where: { workspaceId, contactId, calledAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
    orderBy: { calledAt: "asc" },
    take: 30,
    select: { calledAt: true, result: true },
  });
  return filas.map((l) => ({ en: l.calledAt, resultado: l.result }));
}

/** Desde el webhook, al llegar un mensaje del cliente: en segundo plano, sin demorar nada. */
export function revisarLeadAlEscribir(input: { workspaceId: string; conversationId: string }): void {
  if (!input.workspaceId || !input.conversationId) return;
  enSegundoPlano(async () => {
    const config = await leerConfigSeguimiento(input.workspaceId);
    if (!algoPrendido(config)) return;
    await revisarLead(input.conversationId);
  });
}

let barriendo = false;
const POR_VUELTA = 60;

/**
 * EL BARRIDO (reloj de cada minuto): los leads a los que les toca revisión (`revisarEn` vencido o
 * nunca revisados), de a 60 por negocio. Así cae la temperatura por silencio, vencen las tareas,
 * salen los mensajes útiles y avanza la cadencia aunque el cliente no escriba.
 */
export async function barrerSeguimientoInteligente(ahora = new Date()): Promise<{ negocios: number; revisados: number }> {
  if (barriendo) return { negocios: 0, revisados: 0 };
  barriendo = true;
  try {
    const negocios = await negociosConSeguimiento();
    let revisados = 0;
    for (const workspaceId of negocios) {
      const config = await leerConfigSeguimiento(workspaceId);
      // Con solo la recuperación o los automáticos tras la asesora prendidos (todo lo demás apagado),
      // el motor no recorre su lista salvo para mover las recuperaciones activas.
      const motorPrendido = config.calificacion.activo || config.motor.modo !== "apagado" || config.exterior.activo || config.cadencia.descarte !== "apagado";
      if (motorPrendido || config.recuperacion72h.modo === "activo") {
        const ventanaDias = Math.max(config.motor.diasDeSeguimiento, Math.max(...config.cadencia.dias) + config.cadencia.horasDeGracia / 24 + 3, config.cotizacion.diasVigente);
        const leads = await prisma.embudoLead.findMany({
          where: {
            workspaceId,
            exterior: false,
            OR: [{ revisarEn: null }, { revisarEn: { lte: ahora } }],
            AND: [{ OR: [{ ultimoClienteEn: { gte: new Date(ahora.getTime() - ventanaDias * 86_400_000) } }, { dormidoHasta: { not: null } }] }],
          },
          orderBy: { revisarEn: { sort: "asc", nulls: "first" } },
          take: POR_VUELTA,
          select: { conversationId: true },
        });
        for (const lead of leads) {
          await revisarLead(lead.conversationId, { ahora });
          revisados += 1;
        }
      }
      // Recuperación 72 h: los chats que llegan a las 72 h aunque el motor no los tenga en su lista.
      revisados += await barrerRecuperacion(workspaceId, config, ahora);
      // Automáticos después de la asesora (cada 5 minutos).
      await barrerTrasAsesora(workspaceId, config, ahora);
      // "Día siguiente" del paso que se re-arma en cada silencio (diaSiguiente.rearmar; cada minuto).
      await barrerDiaSiguiente(workspaceId, config, ahora);
      // "Llamar solo las de 7 días o menos": marca para reactivación las de la Recuperación con el
      // cliente callado hace más (cada 5 minutos; el tope y las listas ya no las cuentan).
      await marcarParaReactivar(workspaceId, config, ahora);
      // Tope de tareas por asesora al día (reparte el excedente o lo pospone; nunca se pierde).
      await aplicarTopeDeTareas(workspaceId, config, ahora);
    }
    return { negocios: negocios.length, revisados };
  } catch (error) {
    anotarError("fallo el barrido", error);
    return { negocios: 0, revisados: 0 };
  } finally {
    barriendo = false;
  }
}

/* ------------------------------------------------------------------------------------------------
   BARRIDO DE LA RECUPERACIÓN 72 H
------------------------------------------------------------------------------------------------ */

/** Hasta cuándo no se vuelve a mirar un chat (memoria del proceso; los que no tienen EmbudoLead). */
const proximaMirada = new Map<string, number>();
const REC_POR_VUELTA = 40;
const ultimaVueltaRec = new Map<string, number>();

/**
 * Cada 5 minutos, con `recuperacion72h.modo` en sombra o activo: los chats de las líneas del V3 con
 * el cliente callado entre 72 h y 72 h + `diasMaximos`, etapa abierta. En ACTIVO se revisan con el
 * motor completo (la recuperación toma la decisión y queda la tarea); en SOMBRA solo se anota lo que
 * haría. Devuelve cuántos miró. Nunca lanza.
 */
export async function barrerRecuperacion(workspaceId: string, config: ConfigSeguimientoInteligente, ahora = new Date()): Promise<number> {
  const rc = config.recuperacion72h;
  if (rc.modo === "apagado") return 0;
  if (ahora.getTime() - (ultimaVueltaRec.get(workspaceId) ?? 0) < 4.5 * 60_000) return 0;
  ultimaVueltaRec.set(workspaceId, ahora.getTime());
  try {
    const desde = new Date(ahora.getTime() - (rc.horas * 3_600_000 + rc.diasMaximos * 86_400_000));
    const hasta = new Date(ahora.getTime() - rc.horas * 3_600_000);
    const candidatos = await prisma.$queryRaw<Array<{ id: string; revisarEn: Date | null; motivo: string | null }>>(Prisma.sql`
      WITH charlas AS MATERIALIZED (
        SELECT c."id",
               (SELECT max(m."createdAt") FROM "Message" m
                 WHERE m."conversationId" = c."id" AND m."direction" = 'INBOUND' AND m."type" <> 'SYSTEM' AND m."deletedAt" IS NULL) AS "ultimoIn"
          FROM "Conversation" c
          JOIN "Contact" ct ON ct."id" = c."contactId"
          JOIN "WhatsAppChannel" w ON w."id" = c."channelId"
         WHERE c."workspaceId" = ${workspaceId}
           AND ct."crmStage"::text NOT IN ('GANADO', 'PERDIDO')
           AND (w."metadata"->>'agenteV3') = 'true'
           AND c."lastMessageAt" >= ${desde}
      )
      SELECT ch."id", l."revisarEn", l."accionDatos"->>'motivo' AS "motivo"
        FROM charlas ch
        LEFT JOIN "EmbudoLead" l ON l."conversationId" = ch."id"
       WHERE ch."ultimoIn" IS NOT NULL AND ch."ultimoIn" >= ${desde} AND ch."ultimoIn" <= ${hasta}
       ORDER BY ch."ultimoIn" DESC
       LIMIT 400`);
    let mirados = 0;
    for (const c of candidatos) {
      if (mirados >= REC_POR_VUELTA) break;
      // Los que ya están en recuperación activa los mueve el barrido del motor (por su revisarEn).
      if (c.motivo === MOTIVO_RECUPERACION && c.revisarEn && c.revisarEn.getTime() > ahora.getTime()) continue;
      if ((proximaMirada.get(c.id) ?? 0) > ahora.getTime()) continue;
      const evaluacion = await revisarLead(c.id, { ahora, soloRecuperacion: rc.modo === "sombra" });
      mirados += 1;
      const r = evaluacion?.recuperacion ?? null;
      const proxima =
        r?.tipo === "dentro"
          ? Math.max(r.estado.revisarEn.getTime(), ahora.getTime() + 15 * 60_000)
          : r?.tipo === "fuera" && r.despertarEn
            ? r.despertarEn.getTime()
            : ahora.getTime() + 6 * 3_600_000;
      proximaMirada.set(c.id, proxima);
    }
    if (proximaMirada.size > 20_000) {
      for (const [id, hastaCuando] of proximaMirada) if (hastaCuando < ahora.getTime()) proximaMirada.delete(id);
    }
    return mirados;
  } catch (error) {
    anotarError("fallo el barrido de la recuperacion", error, { workspaceId });
    return 0;
  }
}
