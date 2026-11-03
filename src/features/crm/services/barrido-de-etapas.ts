import { prisma as prismaReal } from "@/lib/prisma";
import {
  causaCorta,
  etapaAutomaticaPrendida,
  ganadoAutomaticoPrendido,
  marcaDeGanadoPorGestion,
  marcarGanadoPorGestion,
  moverEtapaAutomatica,
} from "@/lib/etapa-automatica-crm";
import {
  fechaDeRecontacto,
  interpretarRespuestaDeLaIA,
  type IntencionDeLaIA,
} from "@/features/crm/domain/intencion-del-cliente";
import { variantesDeTelefono } from "@/features/pauta/dominio/reporte";
import type { CrmStage } from "@/features/crm/types";

/**
 * BARRIDO DE ETAPAS (parte 2 de "Etapas automáticas", 3-nov-2026). Corre cada 10 minutos desde el
 * reloj (api/cron/follows), por negocio, en segundo plano. Solo escribe en el CRM: no le escribe a
 * ningún cliente, no toca Gestión (solo lee la tabla VentaDePauta que ya llena la pauta) y no dispara
 * reglas de seguimiento.
 *
 * 1. GANADO DESDE GESTIÓN: las ventas pagadas de Gestión de los últimos 7 días (VentaDePauta, sin las
 *    "CRM:…", que son Ganados del propio CRM) se cruzan por teléfono, con y sin 57, igual que la pauta.
 *    El lead pasa a Ganado con la fecha del pago y la cotización, aunque esté en Descartado puesto a mano.
 *    Si el mismo número quedó en dos fichas de la misma persona, gana la del chat más reciente; si son
 *    dos personas distintas (los dos con nombre y nombres distintos), no se marca nada. Cada venta se
 *    marca una sola vez: si una persona después lo saca de Ganado, el barrido no lo vuelve a poner.
 *    Interruptor propio: `crm:etapa-automatica:ganado:<negocio>` = `off`.
 * 2. LA IA PARA LOS CHATS SIN ETAPA ("---"): de la línea de ventas, con un mensaje del cliente en los
 *    últimos 7 días. La IA barata lee los últimos 10 mensajes y solo puede decir Frío, Tibio o Caliente
 *    (Descartado o Ganado no cuentan). El cambio pasa por el motor de la etapa automática, con la
 *    regla de no bajar lo puesto a mano, y queda con la nota "[ia]". Máximo 20 chats por vuelta y 300 al
 *    día por negocio. Un chat leído no se vuelve a leer hasta que el cliente escriba de nuevo
 *    (Contact.metadata.barridoIaLeidoHasta).
 *
 * Todo apagado con `crm:etapa-automatica:<negocio>` = `off`. NUNCA lanza: cada falla queda en el
 * registro con una causa corta.
 */

const DIAS_ATRAS = 7;
const MENSAJES_POR_CHAT = 10;
const CHATS_POR_VUELTA = 20;
const CHATS_POR_DIA = 300;
/** Cuántos chats candidatos se miran por vuelta para llenar los 20 (los ya leídos se saltan). */
const CANDIDATOS_POR_VUELTA = 200;

/** En Contact.metadata: la fecha (ISO) del último mensaje del cliente que ya leyó la IA del barrido. */
export const CLAVE_LEIDO_POR_IA = "barridoIaLeidoHasta";

/** Contador de chats leídos por la IA en el día (hora de Colombia), por negocio. */
export function claveContadorDeIA(workspaceId: string): string {
  return `crm:barrido-de-etapas:ia-del-dia:${workspaceId}`;
}

/** Recibe el chat ya armado ("Cliente: …" / "Nosotros: …") y devuelve la respuesta cruda de la IA. */
export type PreguntaALaIA = (chat: string) => Promise<string | null>;

type Db = typeof prismaReal;

export type Dependencias = {
  /** Para las pruebas: un prisma falso. */
  prisma?: Db;
  /** Para las pruebas: una IA falsa. */
  ia?: PreguntaALaIA;
  ahora?: Date;
};

export type ResultadoDelBarrido = { ganados: number; leidosPorIA: number; movidosPorIA: number };

const MODELO = "gpt-4.1-mini";
const ESPERA_IA_MS = 8_000;

const SISTEMA = `Eres el clasificador del CRM de una tienda de mobiliario para estética (camillas, sillas, combos) en Colombia.
Lees los últimos mensajes de un chat de WhatsApp entre el cliente y la tienda y contestas con UNA palabra:
CALIENTE si el cliente quiere comprar ya: pregunta cómo pagar, pide datos para consignar, pide el total, elige color o modelo, dice su ciudad o manda sus datos.
TIBIO si muestra interés pero lo deja para después, duda o lo va a pensar.
FRIO si pregunta el precio o pide fotos.
NADA si solo saluda, pregunta información general o no se sabe.
Nunca contestes otra cosa.`;

/** La IA de verdad (la misma barata de etapa-por-lectura). Sin clave, no pregunta. */
const iaReal: PreguntaALaIA = async (chat) => {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const respuesta = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODELO,
      temperature: 0,
      max_tokens: 3,
      messages: [
        { role: "system", content: SISTEMA },
        { role: "user", content: chat.slice(0, 4_000) },
      ],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(ESPERA_IA_MS),
  });
  if (!respuesta.ok) throw new Error(`OpenAI respondió ${respuesta.status}`);
  const datos = (await respuesta.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return datos.choices?.[0]?.message?.content ?? null;
};

function leerMetadata(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? { ...(valor as Record<string, unknown>) } : {};
}

/** El día en hora de Colombia (AAAA-MM-DD). */
function diaDeColombia(ahora: Date): string {
  return new Date(ahora.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
}

/** "Juan Pérez" → "juan": para saber si dos fichas del mismo número son la misma persona. */
function primerNombre(nombre: string | null | undefined): string {
  return (nombre ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .split(/\s+/)[0] ?? "";
}

/* ---------------------------------------------------------------------------------------------- */
/* 1. GANADO DESDE GESTIÓN */

async function barrerGanados(db: Db, workspaceId: string, ahora: Date): Promise<number> {
  if (!(await ganadoAutomaticoPrendido(workspaceId))) return 0;
  const desde = new Date(ahora.getTime() - DIAS_ATRAS * 86_400_000);
  const ventas = (
    await db.ventaDePauta.findMany({
      where: { workspaceId, pagadaEn: { gte: desde }, NOT: { ventaGestionId: { startsWith: "CRM:" } } },
      orderBy: { pagadaEn: "asc" },
      select: { ventaGestionId: true, cotizacion: true, telefono: true, pagadaEn: true },
    })
  ).filter((v) => !v.ventaGestionId.startsWith("CRM:"));
  if (ventas.length === 0) return 0;

  const variantes = [...new Set(ventas.flatMap((v) => variantesDeTelefono(v.telefono)))];
  if (variantes.length === 0) return 0;
  const contactos = await db.contact.findMany({
    where: { workspaceId, phoneNumber: { in: variantes }, excludedFromCrm: false },
    select: { id: true, phoneNumber: true, name: true, crmStage: true },
  });
  if (contactos.length === 0) return 0;

  // El chat más reciente de cada ficha: si el mismo número quedó en dos fichas, gana esa.
  const chats = await db.conversation.findMany({
    where: { workspaceId, contactId: { in: contactos.map((c) => c.id) } },
    select: { contactId: true, lastMessageAt: true, createdAt: true },
  });
  const ultimoChat = new Map<string, number>();
  for (const chat of chats) {
    const t = (chat.lastMessageAt ?? chat.createdAt)?.getTime() ?? 0;
    if (t > (ultimoChat.get(chat.contactId) ?? -1)) ultimoChat.set(chat.contactId, t);
  }

  let ganados = 0;
  for (const venta of ventas) {
    try {
      const delNumero = new Set(variantesDeTelefono(venta.telefono));
      const candidatos = contactos.filter((c) => delNumero.has(c.phoneNumber));
      if (candidatos.length === 0) continue;
      // Dos personas distintas con el mismo número (los dos con nombre y distinto): no se adivina.
      const nombres = new Set(candidatos.map((c) => primerNombre(c.name)).filter(Boolean));
      if (nombres.size > 1) {
        console.info(`[barrido-de-etapas] venta ${venta.ventaGestionId} coincide con ${candidatos.length} contactos distintos: no se marca`);
        continue;
      }
      const elegido = [...candidatos].sort((a, b) => (ultimoChat.get(b.id) ?? -1) - (ultimoChat.get(a.id) ?? -1))[0];
      if ((elegido.crmStage as CrmStage) === "GANADO") continue;

      // Cada venta se marca una sola vez: si una persona lo sacó de Ganado después, no se le pisa.
      const yaMarcada = await db.historialEtapa.findFirst({
        where: { workspaceId, contactId: elegido.id, origen: "AUTOMATICO", nota: { contains: marcaDeGanadoPorGestion(venta.cotizacion) } },
        select: { id: true },
      });
      if (yaMarcada) continue;

      const movido = await marcarGanadoPorGestion({
        workspaceId,
        contactId: elegido.id,
        cotizacion: venta.cotizacion,
        fechaPago: venta.pagadaEn,
      });
      if (movido) {
        elegido.crmStage = "GANADO";
        ganados += 1;
      }
    } catch (falla) {
      console.info(`[barrido-de-etapas] no revisó la venta ${venta.ventaGestionId} causa=${causaCorta(falla)}`);
    }
  }
  return ganados;
}

/* ---------------------------------------------------------------------------------------------- */
/* 2. LA IA PARA LOS CHATS SIN ETAPA */

/** La nota de cada respuesta de la IA. */
const PORQUE_DE_LA_IA: Record<IntencionDeLaIA, string> = {
  CALIENTE: "la IA leyó el chat: el cliente mostró intención de compra",
  TIBIO: "la IA leyó el chat: el cliente lo deja para después",
  INTERESADO: "la IA leyó el chat: el cliente pidió precio o fotos",
};

type MensajeDelChat = { direction: string; type: string; content: string | null; transcripcion: string | null };

function textoDelMensaje(m: MensajeDelChat): string {
  const texto = (m.content ?? m.transcripcion ?? "").replace(/\s+/g, " ").trim();
  if (texto) return texto.slice(0, 400);
  return `[${m.type.toLowerCase()}]`;
}

/** El chat como lo lee la IA: los últimos mensajes, del más viejo al más nuevo. */
export function chatParaLaIA(mensajes: MensajeDelChat[]): string {
  return mensajes.map((m) => `${m.direction === "INBOUND" ? "Cliente" : "Nosotros"}: ${textoDelMensaje(m)}`).join("\n");
}

async function leerContador(db: Db, workspaceId: string, dia: string): Promise<number> {
  const fila = await db.appSetting.findUnique({ where: { key: claveContadorDeIA(workspaceId) }, select: { value: true } });
  try {
    const valor = JSON.parse(fila?.value ?? "{}") as { dia?: string; usados?: number };
    return valor.dia === dia && Number.isFinite(valor.usados) ? Number(valor.usados) : 0;
  } catch {
    return 0;
  }
}

async function guardarContador(db: Db, workspaceId: string, dia: string, usados: number): Promise<void> {
  const value = JSON.stringify({ dia, usados });
  await db.appSetting.upsert({
    where: { key: claveContadorDeIA(workspaceId) },
    create: { key: claveContadorDeIA(workspaceId), value },
    update: { value },
  });
}

async function barrerConIA(
  db: Db,
  workspaceId: string,
  ahora: Date,
  ia: PreguntaALaIA,
): Promise<{ leidos: number; movidos: number }> {
  const dia = diaDeColombia(ahora);
  const usados = await leerContador(db, workspaceId, dia);
  const cupo = Math.min(CHATS_POR_VUELTA, CHATS_POR_DIA - usados);
  if (cupo <= 0) return { leidos: 0, movidos: 0 };

  const desde = new Date(ahora.getTime() - DIAS_ATRAS * 86_400_000);
  const conversaciones = await db.conversation.findMany({
    where: {
      workspaceId,
      lastMessageAt: { gte: desde },
      channel: { purpose: "SALES" },
      contact: { crmStage: "NUEVO", excludedFromCrm: false },
    },
    orderBy: { lastMessageAt: "desc" },
    take: CANDIDATOS_POR_VUELTA,
    select: { id: true, contactId: true, contact: { select: { metadata: true } } },
  });

  let leidos = 0;
  let movidos = 0;
  const vistos = new Set<string>();
  for (const conversacion of conversaciones) {
    if (leidos >= cupo) break;
    // Un contacto con dos chats: se lee solo el más reciente.
    if (vistos.has(conversacion.contactId)) continue;
    vistos.add(conversacion.contactId);
    try {
      const ultimoDelCliente = await db.message.findFirst({
        where: { conversationId: conversacion.id, direction: "INBOUND", isStatusBroadcast: false, createdAt: { gte: desde } },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, content: true },
      });
      if (!ultimoDelCliente) continue;
      const leidoHasta = Date.parse(String(leerMetadata(conversacion.contact?.metadata)[CLAVE_LEIDO_POR_IA] ?? ""));
      if (Number.isFinite(leidoHasta) && leidoHasta >= ultimoDelCliente.createdAt.getTime()) continue;

      const mensajes = (
        await db.message.findMany({
          where: { conversationId: conversacion.id, isStatusBroadcast: false, type: { not: "SYSTEM" } },
          orderBy: { createdAt: "desc" },
          take: MENSAJES_POR_CHAT,
          select: { direction: true, type: true, content: true, transcripcion: true },
        })
      ).reverse();
      if (mensajes.length === 0) continue;

      leidos += 1;
      let respuesta: string | null;
      try {
        respuesta = await ia(chatParaLaIA(mensajes));
      } catch (falla) {
        // Sin respuesta no se marca como leído: se intenta en la próxima vuelta.
        console.info(`[barrido-de-etapas] la IA no contestó conversationId=${conversacion.id} causa=${causaCorta(falla)}`);
        continue;
      }

      // Leído: no se vuelve a preguntar hasta que el cliente escriba de nuevo. Antes de mover la etapa,
      // para que el motor guarde la metadata con esta marca adentro.
      const contacto = await db.contact.findFirst({
        where: { id: conversacion.contactId, workspaceId },
        select: { metadata: true },
      });
      const metadata = leerMetadata(contacto?.metadata);
      metadata[CLAVE_LEIDO_POR_IA] = ultimoDelCliente.createdAt.toISOString();
      await db.contact.updateMany({
        where: { id: conversacion.contactId, workspaceId },
        data: { metadata: metadata as object },
      });

      const intencion = interpretarRespuestaDeLaIA(respuesta);
      if (!intencion) continue;
      const base = {
        workspaceId,
        source: "agent" as const,
        conversationId: conversacion.id,
        motivo: { tipo: "lectura" as const, porque: PORQUE_DE_LA_IA[intencion], metodo: "ia" as const },
      };
      let movida: CrmStage | null = null;
      if (intencion === "CALIENTE") {
        movida = await moverEtapaAutomatica({ ...base, destino: "NEGOCIACION" });
      } else if (intencion === "TIBIO") {
        movida = await moverEtapaAutomatica({
          ...base,
          destino: "PROPUESTA",
          recontactarEl: fechaDeRecontacto(ultimoDelCliente.content, ahora).fecha,
        });
      } else {
        movida = await moverEtapaAutomatica({ ...base, destino: "CALIFICADO", soloSiEstaVacio: true });
      }
      if (movida) movidos += 1;
    } catch (falla) {
      console.info(`[barrido-de-etapas] no leyó el chat conversationId=${conversacion.id} causa=${causaCorta(falla)}`);
    }
  }

  if (leidos > 0) await guardarContador(db, workspaceId, dia, usados + leidos);
  return { leidos, movidos };
}

/* ---------------------------------------------------------------------------------------------- */

/** Una vuelta del barrido para un negocio. NUNCA lanza. */
export async function barrerEtapas(workspaceId: string, deps: Dependencias = {}): Promise<ResultadoDelBarrido> {
  const resultado: ResultadoDelBarrido = { ganados: 0, leidosPorIA: 0, movidosPorIA: 0 };
  const db = deps.prisma ?? prismaReal;
  const ahora = deps.ahora ?? new Date();
  try {
    if (!(await etapaAutomaticaPrendida(workspaceId))) return resultado;
  } catch (falla) {
    console.info(`[barrido-de-etapas] no leyó el interruptor workspaceId=${workspaceId} causa=${causaCorta(falla)}`);
    return resultado;
  }
  try {
    resultado.ganados = await barrerGanados(db, workspaceId, ahora);
  } catch (falla) {
    console.info(`[barrido-de-etapas] Ganado de Gestión falló workspaceId=${workspaceId} causa=${causaCorta(falla)}`);
  }
  try {
    const ia = await barrerConIA(db, workspaceId, ahora, deps.ia ?? iaReal);
    resultado.leidosPorIA = ia.leidos;
    resultado.movidosPorIA = ia.movidos;
  } catch (falla) {
    console.info(`[barrido-de-etapas] la IA del barrido falló workspaceId=${workspaceId} causa=${causaCorta(falla)}`);
  }
  if (resultado.ganados || resultado.leidosPorIA) {
    console.info(
      `[barrido-de-etapas] workspaceId=${workspaceId} ganados=${resultado.ganados} leidosPorIA=${resultado.leidosPorIA} movidosPorIA=${resultado.movidosPorIA}`,
    );
  }
  return resultado;
}

/** Una vuelta para cada negocio con una línea de ventas. NUNCA lanza. */
export async function barrerEtapasDeTodos(deps: Dependencias = {}): Promise<void> {
  const db = deps.prisma ?? prismaReal;
  let negocios: string[] = [];
  try {
    const lineas = await db.whatsAppChannel.findMany({
      where: { purpose: "SALES" },
      distinct: ["workspaceId"],
      select: { workspaceId: true },
    });
    negocios = lineas.map((l) => l.workspaceId);
  } catch (falla) {
    console.info(`[barrido-de-etapas] no leyó los negocios causa=${causaCorta(falla)}`);
    return;
  }
  for (const workspaceId of negocios) await barrerEtapas(workspaceId, deps);
}
