import { Prisma } from "@prisma/client";

import { ORIGEN_MENSAJES_PERDIDOS } from "@/features/alertas/dominio/reglas";
import { registrarAlerta } from "@/features/alertas/servicios/alertas";
import { intentarWhatsAppAAlexander, leerConfigGravedad } from "@/features/avisos-gravedad/servicios/enrutador";
import { estaResuelto } from "@/lib/chat-resuelto";
import { resolveConversationWithLock } from "@/lib/conversacion-por-contacto";
import { recordConversationActivity } from "@/lib/conversation-activity";
import { readGatewayConnection } from "@/lib/evolution";
import { prisma } from "@/lib/prisma";
import { autoAssignConversationToCollaborator } from "@/lib/reparto-de-leads";
import { telefonoDeUnLid } from "@/lib/waha";
import { sendPushToUser } from "@/lib/web-push";
import { buildLidContactMetadata, buildLinkedLidMetadata, CONTACT_LID_ID_METADATA_PATH } from "@/lib/whatsapp-lid";

import {
  claveDeLaAlerta,
  claveDeLidsDePrueba,
  claveDelUltimoAviso,
  decidirRevision,
  HOLGURA_DE_BUSQUEDA_MS,
  leerLidsDePrueba,
  MAXIMO_DE_INTENTOS,
  mismoNumero,
  origenDeLaNota,
  RECLAMO_MS,
  repartePorLinea,
  TEXTO_DE_LA_NOTA,
  textoDelAviso,
  tocaAvisar,
  type Decision,
  type Modo,
} from "../dominio/reglas";
import { leerModoDelNegocio } from "./registro";

/**
 * LA REVISIÓN A LOS 2 MINUTOS (la llama /api/cron/follows en cada vuelta).
 *
 * Toma de a 20 las filas vencidas (PENDIENTE con `revisarEn` cumplido, o REVISANDO trabadas hace 10
 * min), las aparta con `updateMany` para que dos vueltas no hagan lo mismo, y decide: llegó, es de la
 * propia línea, sombra o perdido. Un perdido deja el chat con la nota, lo reparte (solo línea de
 * ventas), deja la alerta y entra al WhatsApp agrupado a Alexander (uno cada 15 min como máximo).
 *
 * Nunca escribe un mensaje INBOUND: la nota es una actividad del sistema (OUTBOUND/SYSTEM), así ni el
 * bot, ni los seguimientos, ni los contadores de "sin responder" creen que el cliente escribió algo.
 */

const POR_VUELTA = 20;
const LIMITE_WHATSAPP_MS = 15_000;

type Fila = {
  id: string;
  workspaceId: string;
  channelId: string;
  idCrudo: string;
  lid: string;
  ocurridoEn: Date;
  estado: string;
  intentos: number;
  reclamadoEn: Date | null;
};

type Canal = {
  id: string;
  workspaceId: string;
  name: string;
  purpose: string;
  phoneNumber: string | null;
  agentId: string | null;
  evolutionInstanceName: string | null;
  metadata: Prisma.JsonValue;
};

export type ResultadoDeLaRevision = { revisados: number } & Partial<Record<Decision | "ERROR", number>> & { avisos: number };

export async function revisarMensajesIndescifrables(ahora = new Date()): Promise<ResultadoDeLaRevision> {
  const resultado: ResultadoDeLaRevision = { revisados: 0, avisos: 0 };
  const vencidas: Fila[] = await prisma.mensajeIndescifrable.findMany({
    where: {
      OR: [
        { estado: "PENDIENTE", revisarEn: { lte: ahora } },
        { estado: "REVISANDO", reclamadoEn: { lte: new Date(ahora.getTime() - RECLAMO_MS) } },
      ],
    },
    orderBy: { revisarEn: "asc" },
    take: POR_VUELTA,
    select: { id: true, workspaceId: true, channelId: true, idCrudo: true, lid: true, ocurridoEn: true, estado: true, intentos: true, reclamadoEn: true },
  });

  const lidsPorNegocio = new Map<string, Set<string>>();
  for (const fila of vencidas) {
    // Se aparta: si otra vuelta la tomó primero, no se toca.
    const apartada = await prisma.mensajeIndescifrable.updateMany({
      where: { id: fila.id, estado: fila.estado, reclamadoEn: fila.reclamadoEn },
      data: { estado: "REVISANDO", reclamadoEn: ahora, intentos: { increment: 1 } },
    });
    if (apartada.count === 0) continue;
    resultado.revisados += 1;

    if (fila.intentos >= MAXIMO_DE_INTENTOS) {
      await terminar(fila.id, "ERROR", ahora);
      resultado.ERROR = (resultado.ERROR ?? 0) + 1;
      await registrarAlerta({
        workspaceId: fila.workspaceId,
        clave: "mensaje-perdido:error",
        prioridad: "ALTA",
        titulo: "Un mensaje perdido no se pudo revisar",
        detalle: `Se intentó ${MAXIMO_DE_INTENTOS} veces y falló. Línea ${fila.channelId}, LID ${fila.lid}, id ${fila.idCrudo}. Mirar el log de [indescifrables].`,
        origen: ORIGEN_MENSAJES_PERDIDOS,
      });
      continue;
    }

    try {
      const modo = await leerModoDelNegocio(fila.workspaceId, ahora.getTime());
      if (!lidsPorNegocio.has(fila.workspaceId)) {
        const prueba = await prisma.appSetting.findUnique({ where: { key: claveDeLidsDePrueba(fila.workspaceId) }, select: { value: true } });
        lidsPorNegocio.set(fila.workspaceId, leerLidsDePrueba(prueba?.value));
      }
      const decision = await revisarUna(fila, modo, lidsPorNegocio.get(fila.workspaceId) as Set<string>, ahora);
      resultado[decision] = (resultado[decision] ?? 0) + 1;
    } catch (error) {
      // Queda en REVISANDO y se vuelve a tomar a los 10 minutos (hasta MAXIMO_DE_INTENTOS).
      console.error("[indescifrables] revisión falló", { id: fila.id, error: error instanceof Error ? error.message : String(error) });
    }
  }

  resultado.avisos = await avisarLosPendientes(ahora);
  if (resultado.revisados > 0) console.log("[indescifrables] revisión", resultado);
  return resultado;
}

async function terminar(id: string, estado: string, ahora: Date, extra: Prisma.MensajeIndescifrableUpdateInput = {}) {
  await prisma.mensajeIndescifrable.update({ where: { id }, data: { estado, resueltoEn: ahora, ...extra } });
}

async function revisarUna(fila: Fila, modo: Modo, lidsDePrueba: ReadonlySet<string>, ahora: Date): Promise<Decision> {
  if (modo === "APAGADO") {
    await terminar(fila.id, "DESCARTADO", ahora);
    return "DESCARTAR";
  }
  const canal: Canal | null = await prisma.whatsAppChannel.findUnique({
    where: { id: fila.channelId },
    select: { id: true, workspaceId: true, name: true, purpose: true, phoneNumber: true, agentId: true, evolutionInstanceName: true, metadata: true },
  });
  if (!canal) {
    await terminar(fila.id, "DESCARTADO", ahora);
    return "DESCARTAR";
  }

  const llego = await prisma.message.findFirst({
    where: {
      workspaceId: fila.workspaceId,
      createdAt: { gte: new Date(fila.ocurridoEn.getTime() - HOLGURA_DE_BUSQUEDA_MS) },
      externalId: { contains: fila.idCrudo },
    },
    select: { id: true },
  });
  const telefono = llego ? null : await telefonoDelLid(canal, fila.lid);
  const decision = decidirRevision({
    modo,
    lid: fila.lid,
    lidsDePrueba,
    llego: Boolean(llego),
    esLaPropiaLinea: mismoNumero(telefono, canal.phoneNumber),
  });

  if (decision === "LLEGO") await terminar(fila.id, "LLEGO", ahora);
  else if (decision === "IGNORAR") await terminar(fila.id, "IGNORADO", ahora, { telefono });
  else if (decision === "SOMBRA") {
    console.log("[indescifrables] sombra: se habría dado por perdido", { linea: canal.name, idCrudo: fila.idCrudo });
    await terminar(fila.id, "SOMBRA", ahora, { telefono });
  } else if (decision === "ACTUAR") {
    return await darPorPerdido(fila, canal, telefono, ahora);
  }
  return decision;
}

async function telefonoDelLid(canal: Canal, lid: string): Promise<string | null> {
  const conexion = readGatewayConnection(canal.metadata);
  if (!conexion?.apiToken || !canal.evolutionInstanceName || !lid) return null;
  return telefonoDeUnLid({
    connection: { baseUrl: conexion.baseUrl, apiToken: conexion.apiToken },
    sesion: canal.evolutionInstanceName,
    lid,
  });
}

const esDuplicado = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/**
 * La ficha del cliente: la que ya tiene este LID anotado, la de su teléfono o, si el LID no se pudo
 * traducir, una con el LID en el lugar del teléfono y `whatsappLid: true` (igual que el webhook).
 */
async function contactoDelPerdido(canal: Canal, lid: string, telefono: string | null) {
  const select = { id: true, name: true, phoneNumber: true, bloqueadoEn: true } as const;
  const conocida = await prisma.contact.findFirst({
    where: { workspaceId: canal.workspaceId, metadata: { path: CONTACT_LID_ID_METADATA_PATH, equals: lid } },
    select,
  });
  if (conocida) return conocida;
  const numero = telefono ?? lid;
  const porNumero = await prisma.contact.findFirst({
    where: { workspaceId: canal.workspaceId, phoneNumber: { in: telefono ? [telefono, lid] : [lid] } },
    orderBy: { createdAt: "asc" },
    select,
  });
  if (porNumero) return porNumero;
  try {
    return await prisma.contact.upsert({
      where: { workspaceId_phoneNumber: { workspaceId: canal.workspaceId, phoneNumber: numero } },
      update: {},
      create: {
        workspaceId: canal.workspaceId,
        phoneNumber: numero,
        ...(canal.purpose === "ADMIN" ? { excludedFromCrm: true } : {}),
        metadata: (telefono ? buildLinkedLidMetadata(null, lid) : buildLidContactMetadata()) as Prisma.InputJsonValue,
      },
      select,
    });
  } catch (error) {
    if (!esDuplicado(error)) throw error;
    return prisma.contact.findUnique({ where: { workspaceId_phoneNumber: { workspaceId: canal.workspaceId, phoneNumber: numero } }, select });
  }
}

async function darPorPerdido(fila: Fila, canal: Canal, telefono: string | null, ahora: Date): Promise<Decision> {
  const contacto = await contactoDelPerdido(canal, fila.lid, telefono);
  if (!contacto) throw new Error("no se pudo resolver la ficha del cliente");
  if (contacto.bloqueadoEn) {
    await terminar(fila.id, "IGNORADO", ahora, { telefono });
    return "IGNORAR";
  }
  const resuelta = await resolveConversationWithLock({
    workspaceId: canal.workspaceId,
    channelId: canal.id,
    contactId: contacto.id,
    agentId: canal.agentId ?? null,
  });
  if (!resuelta) throw new Error("no se pudo resolver la conversación");
  const conversationId = resuelta.id;

  // La nota, una sola vez por mensaje aunque la fila se revise de nuevo tras una caída.
  const origen = origenDeLaNota(fila.idCrudo);
  const buscarNota = () =>
    prisma.message.findFirst({ where: { conversationId, type: "SYSTEM", rawPayload: { path: ["origen"], equals: origen } }, select: { id: true } });
  if (!(await buscarNota())) {
    await recordConversationActivity({
      workspaceId: canal.workspaceId,
      conversationId,
      channelId: canal.id,
      contactId: contacto.id,
      kind: "note",
      origen,
      text: TEXTO_DE_LA_NOTA,
    });
    // recordConversationActivity se traga sus errores: sin la nota no se da por hecho.
    if (!(await buscarNota())) throw new Error("no se pudo escribir la nota");
  }

  // Que quede arriba en la bandeja; si estaba resuelto, vuelve (el cliente sí escribió).
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: ahora, ...(estaResuelto(resuelta.status) ? { status: "OPEN" as const, closedAt: null } : {}) },
  });

  const quien = contacto.name?.trim() || telefono || `LID ${fila.lid}`;
  let asesora: string | null = null;
  if (repartePorLinea(canal.purpose)) {
    const actual = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { assignedToUserId: true } });
    asesora =
      actual?.assignedToUserId ??
      (await autoAssignConversationToCollaborator({
        conversationId,
        channelId: canal.id,
        workspaceId: canal.workspaceId,
        avisarPorPush: false,
        ahora,
      }).catch((error) => {
        console.warn("[indescifrables] no se pudo repartir", error instanceof Error ? error.message : String(error));
        return null;
      }));
    if (asesora) {
      await sendPushToUser({
        userId: asesora,
        payload: {
          title: "Mensaje perdido, escríbele",
          body: `${quien} escribió y WhatsApp no dejó leer el mensaje.`,
          tag: `mensaje-perdido:${conversationId}`,
          url: `/cliente/chats?chatKey=agent:${conversationId}&assigned=all`,
        },
      }).catch(() => 0);
    }
  }

  await registrarAlerta({
    workspaceId: canal.workspaceId,
    clave: claveDeLaAlerta(conversationId),
    prioridad: "ALTA",
    titulo: `Mensaje perdido de ${quien} (${canal.name})`,
    detalle: [
      `WhatsApp no dejó leer un mensaje y no llegó en 2 minutos. El chat quedó en la bandeja con la nota «Mensaje perdido, escríbele».`,
      `Línea: ${canal.name}${repartePorLinea(canal.purpose) ? "" : " (administrativa: no se reparte)"}`,
      `Cliente: ${quien}${telefono ? ` · ${telefono}` : ` · solo LID ${fila.lid}`}`,
      `Ver el chat: /cliente/chats?chatKey=agent:${conversationId}&assigned=all`,
    ].join("\n"),
    origen: ORIGEN_MENSAJES_PERDIDOS,
  });

  await terminar(fila.id, "PERDIDO", ahora, { telefono, conversationId, resumen: `${quien} (${canal.name})` });
  console.log("[indescifrables] perdido", { linea: canal.name, conversationId, repartido: Boolean(asesora) });
  return "ACTUAR";
}

async function leerAjuste(clave: string): Promise<string | null> {
  const fila = await prisma.appSetting.findUnique({ where: { key: clave }, select: { value: true } });
  return fila?.value ?? null;
}

/** Mismo patrón que `apartar` de recibo-de-caja-envio.ts: dos vueltas a la vez, gana una. */
async function apartar(clave: string, anterior: string | null, nuevo: string): Promise<boolean> {
  if (anterior === null) {
    try {
      await prisma.appSetting.create({ data: { key: clave, value: nuevo } });
      return true;
    } catch (error) {
      if (esDuplicado(error)) return false;
      throw error;
    }
  }
  const { count } = await prisma.appSetting.updateMany({ where: { key: clave, value: anterior }, data: { value: nuevo } });
  return count === 1;
}

/**
 * El WhatsApp agrupado a Alexander, uno cada 15 minutos por negocio como máximo, con todos los perdidos
 * que todavía no salieron. Si no sale, quedan para la próxima ventana (no se reintenta cada minuto: la
 * línea interna no se martilla). Si el WhatsApp de avisos está apagado, se marcan igual: no se acumulan.
 */
async function avisarLosPendientes(ahora: Date): Promise<number> {
  const pendientes = await prisma.mensajeIndescifrable.findMany({
    where: { estado: "PERDIDO", avisadoEn: null },
    orderBy: { resueltoEn: "asc" },
    take: 200,
    select: { id: true, workspaceId: true, resumen: true },
  });
  let avisos = 0;
  for (const workspaceId of new Set(pendientes.map((fila) => fila.workspaceId))) {
    try {
      const delNegocio = pendientes.filter((fila) => fila.workspaceId === workspaceId);
      const clave = claveDelUltimoAviso(workspaceId);
      const anterior = await leerAjuste(clave);
      if (!tocaAvisar(anterior, ahora) || !(await apartar(clave, anterior, ahora.toISOString()))) continue;
      const config = await leerConfigGravedad(workspaceId);
      const envio = await intentarWhatsAppAAlexander({
        workspaceId,
        config,
        texto: textoDelAviso(delNegocio.map((fila) => fila.resumen ?? "Cliente")),
        limiteMs: LIMITE_WHATSAPP_MS,
      });
      if (envio.ok || envio.apagado) {
        await prisma.mensajeIndescifrable.updateMany({ where: { id: { in: delNegocio.map((fila) => fila.id) } }, data: { avisadoEn: ahora } });
        if (envio.ok) avisos += 1;
      }
      if (!envio.ok) console.warn("[indescifrables] el WhatsApp a Alexander no salió", { motivo: envio.motivo });
    } catch (error) {
      console.warn("[indescifrables] aviso agrupado falló", error instanceof Error ? error.message : String(error));
    }
  }
  return avisos;
}
