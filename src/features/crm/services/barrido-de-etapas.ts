import { prisma as prismaDeLaApp } from "@/lib/prisma";
import {
  causaCorta,
  etapaAutomaticaPrendida,
  ganadoAutomaticoPrendido,
  marcarGanadoPorGestion,
  moverEtapaAutomatica,
} from "@/lib/etapa-automatica-crm";
import { fechaDeRecontacto, interpretarRespuestaDeLaIA, type IntencionDeLaIA } from "@/features/crm/domain/intencion-del-cliente";
import { variantesDeTelefono } from "@/features/pauta/dominio/reporte";
import type { CrmStage } from "@/features/crm/types";

/**
 * BARRIDO DE ETAPAS (parte 2 de "Etapas automáticas", 3-nov-2026). Corre cada 10 minutos desde el reloj
 * (api/cron/follows), en segundo plano, por negocio. Dos cosas:
 *
 * 1. GANADO DESDE GESTIÓN: las ventas pagadas de Gestión de los últimos 7 días (la tabla VentaDePauta,
 *    que llena la pauta una vez al día; las filas "CRM:..." salen del mismo CRM y se ignoran) se cruzan
 *    por teléfono, con y sin 57 (el mismo cruce de la pauta), y el contacto queda en Ganado con la
 *    cotización y la fecha del pago. Si hay dos fichas del mismo número gana la del chat más reciente; si
 *    el teléfono da con dos números distintos, no marca nada. Interruptor propio:
 *    `crm:etapa-automatica:ganado:<negocio>` = `off`. Solo lee de la base: nunca escribe en Gestión.
 *
 * 2. LA IA PARA LOS CHATS SIN ETAPA ("---"): de la línea de ventas, con un mensaje del cliente en los
 *    últimos 7 días. Se le pasan a la IA barata (la misma de etapa-por-lectura) los últimos 10 mensajes y
 *    solo puede contestar Frío, Tibio o Caliente: cualquier otra cosa (Descartado, Ganado) no cambia nada.
 *    Pasa por el motor de la etapa automática (la etapa puesta a mano nunca baja) y la nota del historial
 *    termina en "[ia]". Topes: 20 chats por vuelta y 300 al día por negocio (AppSetting). Cada chat leído
 *    guarda en Contact.metadata la fecha del último mensaje del cliente que se leyó: no se vuelve a leer
 *    hasta que el cliente escriba de nuevo.
 *
 * Todo con el interruptor general `crm:etapa-automatica:<negocio>`. NUNCA le escribe a un cliente ni
 * lanza un error: cada falla queda en el registro con una causa corta.
 */

/** El modelo barato que ya usa el CRM para leer conversaciones (el mismo de etapa-por-lectura). */
const MODELO = "gpt-4.1-mini";
const ESPERA_IA_MS = 10_000;
const DIAS_ATRAS = 7;
const MENSAJES_POR_CHAT = 10;
export const CHATS_POR_VUELTA = 20;
export const CHATS_POR_DIA = 300;
/** Donde queda, en Contact.metadata, la fecha (ISO) del último mensaje del cliente que leyó la IA. */
export const CLAVE_LEIDO_POR_EL_BARRIDO = "barridoDeEtapasLeidoHasta";

export function claveDelCupoDiario(workspaceId: string): string {
  return `crm:etapa-automatica:ia-del-dia:${workspaceId}`;
}

const SISTEMA = `Eres el clasificador del CRM de una tienda de mobiliario para estética (camillas, sillas, combos) en Colombia.
Lees los últimos mensajes de un chat de WhatsApp entre el CLIENTE y la TIENDA y contestas con UNA palabra sobre el cliente:
CALIENTE si quiere comprar ya: pregunta cómo pagar, pide datos para consignar, pide el total, elige color o modelo, dice su ciudad para el envío o manda sus datos.
TIBIO si muestra interés pero lo deja para después, duda o lo va a pensar.
FRIO si pregunta el precio o pide fotos.
NADA si solo saluda, pregunta información general o no se sabe.
Nunca contestes otra cosa.`;

export type MensajeParaLaIA = { deQuien: "cliente" | "tienda"; texto: string };
/** Devuelve el texto crudo que contestó la IA, o null si no hay IA (sin clave). Puede lanzar. */
export type PreguntarALaIA = (mensajes: MensajeParaLaIA[]) => Promise<string | null>;

async function preguntarALaIAPorDefecto(mensajes: MensajeParaLaIA[]): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const chat = mensajes.map((m) => `${m.deQuien === "cliente" ? "CLIENTE" : "TIENDA"}: ${m.texto.slice(0, 400)}`).join("\n");
  const respuesta = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODELO,
      temperature: 0,
      max_tokens: 3,
      messages: [
        { role: "system", content: SISTEMA },
        { role: "user", content: chat },
      ],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(ESPERA_IA_MS),
  });
  if (!respuesta.ok) throw new Error(`OpenAI respondió ${respuesta.status}`);
  const datos = (await respuesta.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return datos.choices?.[0]?.message?.content ?? null;
}

type Prisma = typeof prismaDeLaApp;

export type Dependencias = {
  prisma?: Prisma;
  preguntarALaIA?: PreguntarALaIA;
  ahora?: Date;
};

export type ResultadoDelBarrido = { ganados: number; leidos: number; movidos: number };

/* ---------------------------------------------------------------------------------------------- */
/* GANADO DESDE GESTIÓN */

/** El número sin el 57 de Colombia: con y sin 57 es el mismo teléfono. */
function numeroBase(telefono: string): string {
  const digitos = telefono.replace(/\D/g, "");
  return digitos.length === 12 && digitos.startsWith("57") ? digitos.slice(2) : digitos;
}

export type FichaCandidata = { id: string; phoneNumber: string; ultimoChat: Date | null };

/**
 * A qué contacto le toca la venta. Las fichas con y sin 57 son el mismo teléfono: gana la del chat más
 * reciente. Si el teléfono da con números distintos, no se sabe quién compró: null.
 */
export function elegirFichaDeLaVenta(fichas: FichaCandidata[]): string | null {
  if (fichas.length === 0) return null;
  if (new Set(fichas.map((f) => numeroBase(f.phoneNumber))).size > 1) return null;
  const ordenadas = [...fichas].sort((a, b) => (b.ultimoChat?.getTime() ?? 0) - (a.ultimoChat?.getTime() ?? 0));
  return ordenadas[0].id;
}

async function ganadosDeGestion(db: Prisma, workspaceId: string, ahora: Date): Promise<number> {
  if (!(await ganadoAutomaticoPrendido(workspaceId))) return 0;
  const desde = new Date(ahora.getTime() - DIAS_ATRAS * 86_400_000);
  const filas = await db.ventaDePauta.findMany({
    where: { workspaceId, pagadaEn: { gte: desde }, NOT: { ventaGestionId: { startsWith: "CRM:" } } },
    orderBy: { pagadaEn: "asc" },
    select: { ventaGestionId: true, cotizacion: true, telefono: true, pagadaEn: true },
  });
  // Las "CRM:..." son Ganados del mismo CRM (cuando Gestión no contestó): no son una venta nueva.
  const ventas = filas.filter((v) => !v.ventaGestionId.startsWith("CRM:"));
  const variantes = [...new Set(ventas.flatMap((v) => variantesDeTelefono(v.telefono)))];
  if (variantes.length === 0) return 0;

  const contactos = await db.contact.findMany({
    where: { workspaceId, phoneNumber: { in: variantes } },
    select: {
      id: true,
      phoneNumber: true,
      crmStage: true,
      conversations: { orderBy: { lastMessageAt: "desc" }, take: 1, select: { lastMessageAt: true } },
    },
  });
  const porTelefono = new Map<string, typeof contactos>();
  for (const c of contactos) porTelefono.set(c.phoneNumber, [...(porTelefono.get(c.phoneNumber) ?? []), c]);

  let ganados = 0;
  for (const venta of ventas) {
    const encontrados = [...new Map(variantesDeTelefono(venta.telefono).flatMap((t) => porTelefono.get(t) ?? []).map((c) => [c.id, c])).values()];
    const contactId = elegirFichaDeLaVenta(
      encontrados.map((c) => ({ id: c.id, phoneNumber: c.phoneNumber, ultimoChat: c.conversations[0]?.lastMessageAt ?? null })),
    );
    if (!contactId) {
      if (encontrados.length > 1) console.info(`[barrido-de-etapas] venta con varios contactos, no se marcó venta=${venta.ventaGestionId}`);
      continue;
    }
    const contacto = encontrados.find((c) => c.id === contactId);
    if (!contacto || (contacto.crmStage as CrmStage) === "GANADO") continue;
    const movido = await marcarGanadoPorGestion({ workspaceId, contactId, cotizacion: venta.cotizacion, fechaPago: venta.pagadaEn });
    if (movido) {
      ganados += 1;
      // Si dos ventas son del mismo cliente, la segunda ya lo encuentra en Ganado.
      contacto.crmStage = "GANADO";
    }
  }
  return ganados;
}

/* ---------------------------------------------------------------------------------------------- */
/* LA IA PARA LOS CHATS SIN ETAPA */

/** El día en Colombia (AAAA-MM-DD): el cupo de 300 se reinicia a la medianoche de Bogotá. */
function diaEnBogota(ahora: Date): string {
  return new Date(ahora.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
}

async function leerCupo(db: Prisma, workspaceId: string, dia: string): Promise<number> {
  const fila = await db.appSetting.findUnique({ where: { key: claveDelCupoDiario(workspaceId) }, select: { value: true } });
  try {
    const valor = JSON.parse(fila?.value ?? "{}") as { dia?: unknown; usados?: unknown };
    return valor.dia === dia && typeof valor.usados === "number" ? valor.usados : 0;
  } catch {
    return 0;
  }
}

async function guardarCupo(db: Prisma, workspaceId: string, dia: string, usados: number): Promise<void> {
  const value = JSON.stringify({ dia, usados });
  await db.appSetting.upsert({ where: { key: claveDelCupoDiario(workspaceId) }, create: { key: claveDelCupoDiario(workspaceId), value }, update: { value } });
}

function leerMetadata(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? { ...(valor as Record<string, unknown>) } : {};
}

/** ¿El cliente escribió después de la última lectura? */
function hayMensajeNuevo(metadata: unknown, ultimoDelCliente: Date): boolean {
  const leido = leerMetadata(metadata)[CLAVE_LEIDO_POR_EL_BARRIDO];
  const fecha = typeof leido === "string" ? new Date(leido) : null;
  return !fecha || Number.isNaN(fecha.getTime()) || ultimoDelCliente.getTime() > fecha.getTime();
}

type ChatSinEtapa = { contactId: string; conversationId: string; metadata: unknown; ultimoDelCliente: Date };

async function chatsSinEtapa(db: Prisma, workspaceId: string, desde: Date, tope: number): Promise<ChatSinEtapa[]> {
  // El chat más reciente de cada contacto en "---", de la línea de ventas, con un mensaje del cliente en
  // la ventana. Los ya leídos sin mensaje nuevo se saltan acá (las fechas de la base están en UTC y la
  // marca se guarda con toISOString, así que se comparan como texto) y se vuelven a mirar abajo.
  const filas = await db.$queryRaw<ChatSinEtapa[]>`
    SELECT * FROM (
    SELECT DISTINCT ON (c."id") c."id" AS "contactId", cv."id" AS "conversationId", c."metadata" AS "metadata",
           ult."ultimo" AS "ultimoDelCliente"
    FROM "Contact" c
    JOIN "Conversation" cv ON cv."contactId" = c."id" AND cv."workspaceId" = c."workspaceId"
    LEFT JOIN "WhatsAppChannel" ch ON ch."id" = cv."channelId"
    JOIN LATERAL (
      SELECT MAX(m."createdAt") AS "ultimo" FROM "Message" m
      WHERE m."conversationId" = cv."id" AND m."direction" = 'INBOUND' AND m."createdAt" >= ${desde}
    ) ult ON ult."ultimo" IS NOT NULL
    WHERE c."workspaceId" = ${workspaceId}
      AND c."crmStage"::text = 'NUEVO'
      AND c."excludedFromCrm" = false
      AND (ch."id" IS NULL OR ch."purpose" = 'SALES')
      AND (
        c."metadata"->>${CLAVE_LEIDO_POR_EL_BARRIDO} IS NULL
        OR c."metadata"->>${CLAVE_LEIDO_POR_EL_BARRIDO} < to_char(ult."ultimo", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      )
    ORDER BY c."id", ult."ultimo" DESC
    ) chats
    ORDER BY chats."ultimoDelCliente" DESC
    LIMIT ${tope * 5}
  `;
  return filas
    .map((f) => ({ ...f, ultimoDelCliente: new Date(f.ultimoDelCliente) }))
    .filter((f) => hayMensajeNuevo(f.metadata, f.ultimoDelCliente))
    .sort((a, b) => b.ultimoDelCliente.getTime() - a.ultimoDelCliente.getTime())
    .slice(0, tope);
}

/** Los últimos 10 mensajes del chat, del más viejo al más nuevo, sin las notas del sistema. */
async function ultimosMensajes(db: Prisma, workspaceId: string, conversationId: string): Promise<MensajeParaLaIA[]> {
  const mensajes = await db.message.findMany({
    where: { workspaceId, conversationId, type: { not: "SYSTEM" }, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: MENSAJES_POR_CHAT,
    select: { direction: true, content: true, transcripcion: true, type: true },
  });
  return mensajes
    .slice(0, MENSAJES_POR_CHAT)
    .reverse()
    .map((m) => ({
      deQuien: m.direction === "INBOUND" ? ("cliente" as const) : ("tienda" as const),
      texto: (m.content?.trim() || m.transcripcion?.trim() || `[${String(m.type).toLowerCase()}]`).slice(0, 400),
    }));
}

const PORQUE_DE_LA_IA: Record<IntencionDeLaIA, string> = {
  CALIENTE: "el cliente mostró intención de compra",
  TIBIO: "el cliente lo deja para después",
  INTERESADO: "el cliente pidió precio o fotos",
};

async function marcarLeido(db: Prisma, workspaceId: string, contactId: string, ultimoDelCliente: Date): Promise<void> {
  // Se lee de nuevo: si el motor acaba de mover la etapa, ya dejó su metadata (p. ej. la fecha de recontacto).
  const contacto = await db.contact.findFirst({ where: { id: contactId, workspaceId }, select: { metadata: true } });
  if (!contacto) return;
  const metadata = leerMetadata(contacto.metadata);
  metadata[CLAVE_LEIDO_POR_EL_BARRIDO] = ultimoDelCliente.toISOString();
  await db.contact.updateMany({ where: { id: contactId, workspaceId }, data: { metadata: metadata as object } });
}

async function leerChatsConLaIA(
  db: Prisma,
  workspaceId: string,
  ahora: Date,
  preguntar: PreguntarALaIA,
): Promise<{ leidos: number; movidos: number }> {
  const dia = diaEnBogota(ahora);
  const usados = await leerCupo(db, workspaceId, dia);
  const tope = Math.min(CHATS_POR_VUELTA, CHATS_POR_DIA - usados);
  if (tope <= 0) return { leidos: 0, movidos: 0 };

  const chats = await chatsSinEtapa(db, workspaceId, new Date(ahora.getTime() - DIAS_ATRAS * 86_400_000), tope);
  let leidos = 0;
  let movidos = 0;
  for (const chat of chats) {
    try {
      const mensajes = await ultimosMensajes(db, workspaceId, chat.conversationId);
      if (mensajes.length === 0) continue;
      leidos += 1;
      // El cupo se cuenta antes de preguntar: una pregunta que falla también se pagó.
      await guardarCupo(db, workspaceId, dia, usados + leidos);
      const crudo = await preguntar(mensajes.slice(-MENSAJES_POR_CHAT));
      // Sin clave de la IA no hay nada que hacer en este negocio por ahora.
      if (crudo === null) break;
      const intencion = interpretarRespuestaDeLaIA(crudo);
      if (intencion) {
        const motivo = { tipo: "lectura" as const, porque: PORQUE_DE_LA_IA[intencion], metodo: "ia" as const };
        const base = { workspaceId, source: "agent" as const, conversationId: chat.conversationId, motivo };
        const ultimoDelCliente = [...mensajes].reverse().find((m) => m.deQuien === "cliente")?.texto ?? "";
        const movida =
          intencion === "CALIENTE"
            ? await moverEtapaAutomatica({ ...base, destino: "NEGOCIACION" })
            : intencion === "TIBIO"
              ? await moverEtapaAutomatica({ ...base, destino: "PROPUESTA", recontactarEl: fechaDeRecontacto(ultimoDelCliente, ahora).fecha })
              : await moverEtapaAutomatica({ ...base, destino: "CALIFICADO", soloSiEstaVacio: true });
        if (movida) movidos += 1;
      }
      await marcarLeido(db, workspaceId, chat.contactId, chat.ultimoDelCliente);
    } catch (falla) {
      // Sin marcar como leído: se intenta en otra vuelta (el cupo del día lo frena si sigue fallando).
      console.info(`[barrido-de-etapas] no leyó el chat conversationId=${chat.conversationId} causa=${causaCorta(falla)}`);
    }
  }
  return { leidos, movidos };
}

/* ---------------------------------------------------------------------------------------------- */

/** Una vuelta del barrido para un negocio. Nunca lanza. */
export async function barrerEtapas(workspaceId: string, dependencias: Dependencias = {}): Promise<ResultadoDelBarrido> {
  const db = dependencias.prisma ?? prismaDeLaApp;
  const ahora = dependencias.ahora ?? new Date();
  const resultado: ResultadoDelBarrido = { ganados: 0, leidos: 0, movidos: 0 };
  try {
    if (!(await etapaAutomaticaPrendida(workspaceId))) return resultado;
  } catch (falla) {
    console.info(`[barrido-de-etapas] no leyó el interruptor workspaceId=${workspaceId} causa=${causaCorta(falla)}`);
    return resultado;
  }
  try {
    resultado.ganados = await ganadosDeGestion(db, workspaceId, ahora);
  } catch (falla) {
    console.info(`[barrido-de-etapas] no revisó las ventas de Gestión workspaceId=${workspaceId} causa=${causaCorta(falla)}`);
  }
  try {
    const ia = await leerChatsConLaIA(db, workspaceId, ahora, dependencias.preguntarALaIA ?? preguntarALaIAPorDefecto);
    resultado.leidos = ia.leidos;
    resultado.movidos = ia.movidos;
  } catch (falla) {
    console.info(`[barrido-de-etapas] no leyó los chats sin etapa workspaceId=${workspaceId} causa=${causaCorta(falla)}`);
  }
  return resultado;
}

/** Para el reloj: una vuelta por cada negocio, uno detrás del otro. Nunca lanza. */
export async function barrerEtapasDeTodos(dependencias: Dependencias = {}): Promise<void> {
  const db = dependencias.prisma ?? prismaDeLaApp;
  let negocios: Array<{ id: string }> = [];
  try {
    negocios = await db.workspace.findMany({ select: { id: true } });
  } catch (falla) {
    console.info(`[barrido-de-etapas] no leyó los negocios causa=${causaCorta(falla)}`);
    return;
  }
  for (const negocio of negocios) await barrerEtapas(negocio.id, dependencias);
}
