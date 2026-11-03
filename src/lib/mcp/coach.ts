import { Prisma } from "@prisma/client";

import { MOTIVO_YA_SE_MANDO } from "@/features/agentes-de-area/dominio/reglas";
import { leerEquipoDeAvisos } from "@/features/agentes-de-area/servicios/config";
import { ORIGEN_COACH, mandarWhatsAppAlEquipo } from "@/features/agentes-de-area/servicios/envios";
import { claveDeAlerta } from "@/features/alertas/dominio/reglas";
import { registrarAlerta } from "@/features/alertas/servicios/alertas";
import { numeroDeAvisosDeLaPersona } from "@/features/avisos-gravedad/servicios/enrutador";
import { diaEnBogota, limpiarDatosPersonales, normalizarMensajes, rangoDelDia, ultimos4, type MensajeCrudo } from "@/features/coach/reglas";
import { lineasParaDueno, textoParaAsesora, type DatosDeRevision } from "@/features/coach/revision-opus/reglas";
import {
  coachOpusActivo,
  esFechaValida,
  guardarRevision,
  marcarAvisada,
  registrarDiaSaltado,
  revisionesDelDia,
} from "@/features/coach/revision-opus/servicio";
import { chatsDelDia, medirChat, type ChatMedido } from "@/features/coach/servicios/generar-coach";
import { getPublicBaseUrl } from "@/lib/app-url";
import { puedeVerElSupervisor } from "@/lib/mcp/supervisor";
import { prisma } from "@/lib/prisma";

/*
  EL COACH CON OPUS DESDE EL MCP (parte 2, 3-nov-2026).

  Opus lee los chats en aizen1 (Claude Code) y el CRM solo da los datos, guarda la revisión y entrega los avisos
  INTERNOS. Cuatro herramientas:
    - coach_chats_del_dia (lee)      → por asesora, los chats del día (00:00 a 22:00, hora de Colombia) ya medidos,
                                       los más útiles primero y como mucho 25 por asesora.
    - coach_ver_chat (lee)           → los mensajes de un chat, con los audios transcritos y quién escribió cada uno.
    - coach_guardar_revision (escribe) → la revisión de una asesora en un día (modelo "opus").
    - coach_avisar_del_dia (escribe) → el WhatsApp a cada asesora por la línea Admin (área de envío "coach") y el
                                       resumen del dueño SOLO en la página de Alertas. O el aviso de "día saltado".

  Los textos de los avisos los arma el SERVIDOR (revision-opus/reglas.ts) con lo guardado: nada de texto libre de la IA.
  Con el interruptor `coach-opus:<negocio>` apagado, guardar y avisar responden "apagado" y no hacen nada.
  Del teléfono del cliente solo salen los últimos 4 dígitos. Nunca le escribe a un cliente.
*/

type Contexto = { workspaceId: string; userId: string };
type Argumentos = Record<string, unknown>;

const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const ESCRITURA = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

/** Cuántos chats por asesora devuelve coach_chats_del_dia. */
export const MAXIMO_CHATS_POR_ASESORA = 25;
/** La ventana del día: de 00:00 a 22:00 hora de Colombia. */
const HORAS_DE_LA_VENTANA = 22;
/** Cuántos mensajes (los últimos) devuelve coach_ver_chat. */
const MAXIMO_MENSAJES_DEL_CHAT = 300;

const ENLACE_POR_DEFECTO = "https://app.aizenbot.com";

const APAGADO = {
  apagado: true,
  mensaje: "El Coach con Opus está apagado (coach-opus:<negocio>): no se guardó ni se mandó nada.",
} as const;

export const HERRAMIENTAS_MCP_COACH = [
  {
    name: "coach_chats_del_dia",
    title: "Coach con Opus: chats del día por asesora",
    description:
      "Por cada asesora que atendió chats ese día (sale de los datos), los chats de 00:00 a 22:00 hora de Colombia con sus medidas (sin IA): primera respuesta, demoras y sin respuesta en horario, cotización, etapa, si se ganó hoy, cuántos mensajes de cada quien y cuántos audios quedaron sin transcribir. Van primero los más útiles para revisar y como mucho 25 por asesora. De cada chat sale su id (para coach_ver_chat) y el teléfono solo con los últimos 4 dígitos. Solo lectura.",
    inputSchema: {
      type: "object",
      properties: {
        fecha: { type: "string", description: "AAAA-MM-DD (hora de Colombia). Por defecto, hoy." },
      },
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
  {
    name: "coach_ver_chat",
    title: "Coach con Opus: ver un chat",
    description:
      "Los mensajes de un chat (los últimos 300), en orden, con quién escribió cada uno (cliente, asesora, bot o nota) y el texto de los audios ya transcritos. Un audio que no se transcribió (por ejemplo, de la API oficial) sale como '[audio sin transcribir]'. El teléfono sale solo con los últimos 4 dígitos y los números largos del texto salen tapados. Solo lectura.",
    inputSchema: {
      type: "object",
      properties: {
        chatId: { type: "string", description: "El id del chat, como lo da coach_chats_del_dia." },
      },
      required: ["chatId"],
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
  {
    name: "coach_guardar_revision",
    title: "Coach con Opus: guardar la revisión de una asesora",
    description:
      "Guarda (o reemplaza) la revisión del día de UNA asesora, con el modelo 'opus'. Como mucho 1 chat 'bien' y 2 'mejorable'; cada chat con chatId, tipo, quePaso, momentoCaida, mensajeModelo y causa (asesora, bot, politica o cliente_sin_intencion). Ningún teléfono en el texto (solo los últimos 4 dígitos). Si el Coach con Opus está apagado responde apagado y no guarda nada; si la revisión no pasa las reglas, devuelve los errores.",
    inputSchema: {
      type: "object",
      properties: {
        fecha: { type: "string", description: "AAAA-MM-DD (hora de Colombia) del día revisado." },
        userId: { type: "string", description: "El id de la asesora (asesoras[].userId de coach_chats_del_dia)." },
        nombre: { type: "string", description: "El nombre de la asesora." },
        resumen: { type: "string", description: "El resumen corto del día, para la asesora." },
        chats: {
          type: "array",
          items: {
            type: "object",
            properties: {
              chatId: { type: "string" },
              tipo: { type: "string", enum: ["bien", "mejorable"] },
              quePaso: { type: "string" },
              momentoCaida: { type: "string" },
              mensajeModelo: { type: "string" },
              causa: { type: "string", enum: ["asesora", "bot", "politica", "cliente_sin_intencion"] },
            },
            required: ["chatId", "tipo", "quePaso", "momentoCaida", "mensajeModelo", "causa"],
          },
        },
        chatsLeidos: { type: "integer", minimum: 0, description: "Cuántos chats de la asesora se leyeron." },
      },
      required: ["fecha", "userId", "nombre", "resumen", "chats", "chatsLeidos"],
      additionalProperties: false,
    },
    annotations: ESCRITURA,
  },
  {
    name: "coach_avisar_del_dia",
    title: "Coach con Opus: avisar las revisiones del día",
    description:
      "Le manda a cada asesora con revisión no avisada de ese día un WhatsApp corto (lo arma el servidor con su revisión, con el link) por la línea Admin, solo a números del equipo y una vez por persona y día, y la marca como avisada. El resumen del dueño va SOLO a la página de Alertas. Con prueba=true no manda ni guarda nada y devuelve los textos. Con saltado=true y motivo, anota el día como saltado y le avisa al dueño por WhatsApp (es el único WhatsApp que recibe el dueño). Si el Coach con Opus está apagado responde apagado y no hace nada.",
    inputSchema: {
      type: "object",
      properties: {
        fecha: { type: "string", description: "AAAA-MM-DD (hora de Colombia) del día revisado." },
        prueba: { type: "boolean", description: "true = no manda nada; devuelve los textos." },
        saltado: { type: "boolean", description: "true = ese día no se hizo la revisión (por ejemplo, por el uso de la suscripción)." },
        motivo: { type: "string", description: "Con saltado=true: por qué se saltó (corto)." },
      },
      required: ["fecha"],
      additionalProperties: false,
    },
    annotations: ESCRITURA,
  },
];

const NOMBRES = new Set(HERRAMIENTAS_MCP_COACH.map((herramienta) => herramienta.name));

export function esHerramientaDelCoach(nombre: string) {
  return NOMBRES.has(nombre);
}

async function exigirPermiso(contexto: Contexto) {
  if (!(await puedeVerElSupervisor(contexto))) {
    throw new Error("Esta clave no tiene permiso para el Coach: es solo del dueño, los administradores y la supervisora.");
  }
}

function leerFecha(valor: unknown, porDefecto?: string): string {
  if ((valor === undefined || valor === null || valor === "") && porDefecto) return porDefecto;
  if (typeof valor !== "string" || !esFechaValida(valor)) throw new Error('La fecha tiene que ir como AAAA-MM-DD.');
  return valor;
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor : "";
}

/* ------------------------------------------------------------------------------------------------
   coach_chats_del_dia
------------------------------------------------------------------------------------------------ */

const ETAPA_VISIBLE: Record<string, string> = {
  NUEVO: "Nuevo",
  CALIFICADO: "Frío",
  PROPUESTA: "Tibio",
  NEGOCIACION: "Caliente",
  GANADO: "Ganado",
  PERDIDO: "Descartado",
};

/**
 * Qué tan útil es un chat para que el Coach lo lea: primero donde hubo una venta o un error medido, después los que
 * llegaron a Tibio o Caliente o con cotización, y entre iguales los que tuvieron más conversación.
 */
export function utilidadParaRevisar(chat: {
  ganadoHoy: boolean;
  cotizacion: boolean;
  crmStage: string;
  erroresDuros: unknown[];
  mensajesDelDia: number;
  mensajesDeLaAsesora: number;
}) {
  let puntos = 0;
  if (chat.ganadoHoy) puntos += 50;
  puntos += Math.min(3, chat.erroresDuros.length) * 20;
  if (chat.crmStage === "NEGOCIACION" || chat.crmStage === "PROPUESTA") puntos += 25;
  if (chat.cotizacion) puntos += 15;
  if (chat.mensajesDeLaAsesora === 0) puntos -= 10;
  return puntos + Math.min(20, chat.mensajesDelDia);
}

function contarAutores(chat: ChatMedido, desde: Date) {
  const delDia = chat.mensajes.filter((m) => m.en >= desde);
  const cuenta = { cliente: 0, asesora: 0, bot: 0 };
  let audiosSinTranscribir = 0;
  for (const mensaje of delDia) {
    if (mensaje.autor === "cliente" || mensaje.autor === "asesora" || mensaje.autor === "bot") cuenta[mensaje.autor] += 1;
    if (mensaje.texto === "[audio sin transcribir]") audiosSinTranscribir += 1;
  }
  return { delDia: delDia.filter((m) => m.autor !== "sistema").length, cuenta, audiosSinTranscribir };
}

async function verChatsDelDia(args: Argumentos, contexto: Contexto) {
  await exigirPermiso(contexto);
  const fecha = leerFecha(args.fecha, diaEnBogota(new Date()));
  const { desde } = rangoDelDia(fecha);
  const hasta = new Date(desde.getTime() + HORAS_DE_LA_VENTANA * 3_600_000);
  const ahora = new Date();
  const corte = hasta < ahora ? hasta : ahora;

  const [workspace, miembros] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: contexto.workspaceId }, select: { ownerId: true } }),
    prisma.workspaceMember.findMany({
      where: { workspaceId: contexto.workspaceId, isActive: true },
      select: { userId: true, role: true, user: { select: { name: true, email: true } } },
    }),
  ]);
  // Igual que el Coach de siempre: todo el equipo menos la cuenta del dueño.
  const equipo = miembros.filter((m) => m.role !== "OWNER" && m.userId !== workspace?.ownerId);
  const nombres = new Map(equipo.map((m) => [m.userId, m.user?.name?.trim() || m.user?.email?.split("@")[0] || "Asesora"]));
  const asesoras = new Set(nombres.keys());

  // Los quietos (sin mensajes hoy) no se leen: el Coach revisa lo que pasó en el día.
  const chats = (await chatsDelDia(contexto.workspaceId, desde, corte))
    .filter((chat) => !chat.quieto)
    .map((chat) => medirChat(chat, asesoras, desde, corte));

  const porAsesora = new Map<string, Array<ReturnType<typeof fichaDelChat>>>();
  let sinAsesora = 0;
  for (const chat of chats) {
    if (!chat.asesoraId) {
      sinAsesora += 1;
      continue;
    }
    if (!porAsesora.has(chat.asesoraId)) porAsesora.set(chat.asesoraId, []);
    porAsesora.get(chat.asesoraId)!.push(fichaDelChat(chat, desde));
  }

  const lista = [...porAsesora.entries()]
    .map(([userId, fichas]) => {
      const ordenadas = fichas.sort((a, b) => b.utilidad - a.utilidad);
      return {
        userId,
        nombre: nombres.get(userId) ?? "Asesora",
        chats_del_dia: ordenadas.length,
        chats: ordenadas.slice(0, MAXIMO_CHATS_POR_ASESORA),
      };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  return {
    fecha,
    ventana: "00:00 a 22:00, hora de Colombia",
    coach_opus_activo: await coachOpusActivo(contexto.workspaceId).catch(() => false),
    asesoras: lista,
    chats_sin_asesora: sinAsesora,
    nota: `Como mucho ${MAXIMO_CHATS_POR_ASESORA} chats por asesora, los más útiles para revisar primero. Del teléfono solo salen los últimos 4 dígitos.`,
  };
}

function fichaDelChat(chat: ChatMedido, desde: Date) {
  const { delDia, cuenta, audiosSinTranscribir } = contarAutores(chat, desde);
  return {
    chatId: chat.id,
    ref: chat.ref,
    fuente: chat.fuente === "official" ? "api_oficial" : "whatsapp",
    telefono: chat.ultimos4,
    etapa: ETAPA_VISIBLE[chat.crmStage] ?? chat.crmStage,
    ganado_hoy: chat.ganadoHoy,
    nuevo_hoy: chat.creadoHoy,
    cotizacion: chat.cotizacion,
    atribucion_segura: chat.atribucionSegura,
    primera_respuesta_min: chat.esperas.primeraRespuestaMin,
    errores_medidos: chat.erroresDuros.map((error) => ({ tipo: error.tipo, detalle: error.detalle, minutos: error.minutos })),
    hechos: chat.hechos,
    mensajes: { ...cuenta, total: delDia },
    audios_sin_transcribir: audiosSinTranscribir,
    utilidad: utilidadParaRevisar({
      ganadoHoy: chat.ganadoHoy,
      cotizacion: chat.cotizacion,
      crmStage: chat.crmStage,
      erroresDuros: chat.erroresDuros,
      mensajesDelDia: delDia,
      mensajesDeLaAsesora: cuenta.asesora,
    }),
  };
}

/* ------------------------------------------------------------------------------------------------
   coach_ver_chat
------------------------------------------------------------------------------------------------ */

type FilaDeMensaje = {
  id: string;
  direction: string;
  type: string;
  content: string | null;
  transcripcion: string | null;
  createdAt: Date;
  isStatusBroadcast: boolean | null;
  deletedAt: Date | null;
  source: string | null;
  enviadoPorUserId: string | null;
  kind: string | null;
  actorUserId: string | null;
  assigneeUserId: string | null;
};

function aCrudo(fila: FilaDeMensaje): MensajeCrudo {
  return {
    id: fila.id,
    direction: fila.direction,
    type: fila.type,
    content: fila.content,
    transcripcion: fila.transcripcion,
    createdAt: fila.createdAt,
    isStatusBroadcast: fila.isStatusBroadcast,
    deletedAt: fila.deletedAt,
    rawPayload: {
      source: fila.source,
      enviadoPorUserId: fila.enviadoPorUserId,
      kind: fila.kind,
      actorUserId: fila.actorUserId,
      assigneeUserId: fila.assigneeUserId,
    },
  };
}

async function mensajesDelChat(fuente: "agent" | "official", chatId: string): Promise<{ filas: FilaDeMensaje[]; total: number }> {
  // El id llega como parámetro (nunca pegado al SQL) y el chat ya se comprobó del negocio de la clave.
  if (fuente === "agent") {
    const [filas, total] = await Promise.all([
      prisma.$queryRaw<FilaDeMensaje[]>(Prisma.sql`
        SELECT * FROM (
          SELECT m."id", m."direction"::text AS "direction", m."type"::text AS "type", m."content", m."transcripcion",
                 m."createdAt", m."isStatusBroadcast", m."deletedAt",
                 m."rawPayload"->>'source' AS "source", m."rawPayload"->>'enviadoPorUserId' AS "enviadoPorUserId",
                 m."rawPayload"->>'kind' AS "kind", m."rawPayload"->>'actorUserId' AS "actorUserId",
                 m."rawPayload"->>'assigneeUserId' AS "assigneeUserId"
          FROM "Message" m
          WHERE m."conversationId" = ${chatId}
          ORDER BY m."createdAt" DESC
          LIMIT ${MAXIMO_MENSAJES_DEL_CHAT}
        ) x ORDER BY x."createdAt" ASC
      `),
      prisma.message.count({ where: { conversationId: chatId } }),
    ]);
    return { filas, total };
  }
  const [filas, total] = await Promise.all([
    prisma.$queryRaw<FilaDeMensaje[]>(Prisma.sql`
      SELECT * FROM (
        SELECT m."id", m."direction"::text AS "direction", m."type"::text AS "type", m."content",
               NULLIF(m."rawPayload"->>'transcripcion', '') AS "transcripcion",
               m."createdAt", false AS "isStatusBroadcast", NULL::timestamp AS "deletedAt",
               m."rawPayload"->>'source' AS "source", m."rawPayload"->>'enviadoPorUserId' AS "enviadoPorUserId",
               m."rawPayload"->>'kind' AS "kind", m."rawPayload"->>'actorUserId' AS "actorUserId",
               m."rawPayload"->>'assigneeUserId' AS "assigneeUserId"
        FROM "OfficialApiMessage" m
        WHERE m."conversationId" = ${chatId}
        ORDER BY m."createdAt" DESC
        LIMIT ${MAXIMO_MENSAJES_DEL_CHAT}
      ) x ORDER BY x."createdAt" ASC
    `),
    prisma.officialApiMessage.count({ where: { conversationId: chatId } }),
  ]);
  return { filas, total };
}

const HORA_BOGOTA = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

async function verChat(args: Argumentos, contexto: Contexto) {
  await exigirPermiso(contexto);
  const chatId = texto(args.chatId).trim();
  if (!chatId) throw new Error('Falta "chatId".');

  // Siempre filtrado por el negocio de la clave: un chat de otro negocio no se encuentra.
  const viejo = await prisma.conversation.findFirst({
    where: { id: chatId, workspaceId: contexto.workspaceId },
    select: { id: true, numero: true, assignedToUserId: true, contact: { select: { phoneNumber: true, crmStage: true } } },
  });
  let fuente: "agent" | "official";
  let ficha: { numero: number | null; asignadaA: string | null; telefono: string | null; etapa: string | null };
  if (viejo) {
    fuente = "agent";
    ficha = { numero: viejo.numero, asignadaA: viejo.assignedToUserId, telefono: viejo.contact.phoneNumber, etapa: viejo.contact.crmStage };
  } else {
    const oficial = await prisma.officialApiConversation.findFirst({
      where: { id: chatId, config: { workspaceId: contexto.workspaceId } },
      select: { id: true, numero: true, assignedToUserId: true, contact: { select: { phoneNumber: true, waId: true, crmContactId: true } } },
    });
    if (!oficial) throw new Error("No existe ese chat en este negocio.");
    const crm = oficial.contact.crmContactId
      ? await prisma.contact.findFirst({
          where: { id: oficial.contact.crmContactId, workspaceId: contexto.workspaceId },
          select: { crmStage: true },
        })
      : null;
    fuente = "official";
    ficha = {
      numero: oficial.numero,
      asignadaA: oficial.assignedToUserId,
      telefono: oficial.contact.phoneNumber ?? oficial.contact.waId,
      etapa: crm?.crmStage ?? null,
    };
  }

  const { filas, total } = await mensajesDelChat(fuente, chatId);
  const mensajes = normalizarMensajes(filas.map(aCrudo));

  const ids = [...new Set([ficha.asignadaA, ...mensajes.map((m) => m.userId)].filter((id): id is string => Boolean(id)))];
  const personas = ids.length
    ? await prisma.workspaceMember.findMany({
        where: { workspaceId: contexto.workspaceId, userId: { in: ids } },
        select: { userId: true, user: { select: { name: true, email: true } } },
      })
    : [];
  const nombreDe = new Map(personas.map((p) => [p.userId, p.user?.name?.trim() || p.user?.email?.split("@")[0] || "Asesora"]));

  return {
    chatId,
    ref: ficha.numero ? `#${ficha.numero}` : `#${chatId.slice(-6)}`,
    fuente: fuente === "official" ? "api_oficial" : "whatsapp",
    telefono: ultimos4(ficha.telefono),
    etapa: ficha.etapa ? (ETAPA_VISIBLE[ficha.etapa] ?? ficha.etapa) : null,
    asignada_a: ficha.asignadaA ? (nombreDe.get(ficha.asignadaA) ?? null) : null,
    mensajes_en_total: total,
    ...(total > mensajes.length ? { nota: `Salen los últimos ${MAXIMO_MENSAJES_DEL_CHAT} mensajes.` } : {}),
    mensajes: mensajes.map((mensaje) => ({
      en: HORA_BOGOTA.format(mensaje.en),
      quien:
        mensaje.autor === "sistema"
          ? "nota"
          : mensaje.autor === "asesora" && mensaje.desdeCelular
            ? "asesora (desde el celular de la línea)"
            : mensaje.autor,
      ...(mensaje.autor === "asesora" && mensaje.userId && nombreDe.has(mensaje.userId) ? { asesora: nombreDe.get(mensaje.userId) } : {}),
      texto: limpiarDatosPersonales(mensaje.texto),
    })),
  };
}

/* ------------------------------------------------------------------------------------------------
   coach_guardar_revision
------------------------------------------------------------------------------------------------ */

async function guardar(args: Argumentos, contexto: Contexto) {
  await exigirPermiso(contexto);
  const fecha = texto(args.fecha).trim();
  const userId = texto(args.userId).trim();
  const datos = {
    nombre: args.nombre,
    modelo: "opus",
    resumen: args.resumen,
    chats: args.chats,
    chatsLeidos: args.chatsLeidos,
  } as unknown as DatosDeRevision;
  const resultado = await guardarRevision(contexto.workspaceId, fecha, userId, datos);
  if ("apagado" in resultado) return APAGADO;
  if (!resultado.ok) return { ok: false, errores: resultado.errores };
  const { revision } = resultado;
  return {
    ok: true,
    revision: { id: revision.id, fecha: revision.fecha, userId: revision.userId, nombre: revision.nombre, chats: revision.chats.length, chatsLeidos: revision.chatsLeidos },
  };
}

/* ------------------------------------------------------------------------------------------------
   coach_avisar_del_dia
------------------------------------------------------------------------------------------------ */

/** El aviso al dueño cuando el día se saltó (por el uso de la suscripción u otro motivo). */
export function textoDeDiaSaltado(fecha: string, motivo: string) {
  return `⏸️ Coach con Opus: el ${fecha} no se hizo la revisión (día saltado por uso).\nMotivo: ${motivo}`;
}

export function tituloDelResumenDelDueno(fecha: string, asesoras: number) {
  return `Coach con Opus del ${fecha}: ${asesoras === 1 ? "1 asesora revisada" : `${asesoras} asesoras revisadas`}`;
}

async function numeroDelDueno(workspaceId: string) {
  // El destino del administrador en Mi empresa → Equipo (el que no es "solo de" una asesora).
  const equipo = await leerEquipoDeAvisos(workspaceId);
  return equipo.find((persona) => persona.soloDe === null)?.numero ?? null;
}

async function avisarDiaSaltado(fecha: string, motivoCrudo: unknown, prueba: boolean, contexto: Contexto) {
  const motivoLimpio = texto(motivoCrudo).trim();
  if (prueba) {
    return { ok: true, prueba: true, saltado: true, fecha, texto_dueno: textoDeDiaSaltado(fecha, motivoLimpio.slice(0, 300) || "sin motivo") };
  }
  const anotado = await registrarDiaSaltado(contexto.workspaceId, fecha, motivoLimpio);
  const texto_dueno = textoDeDiaSaltado(fecha, anotado.motivo);
  const numero = await numeroDelDueno(contexto.workspaceId);
  if (!numero) {
    return { ok: false, saltado: true, fecha, anotado: true, motivo: "el dueño no tiene número en Mi empresa → Equipo: no se le avisó" };
  }
  const envio = await mandarWhatsAppAlEquipo({
    workspaceId: contexto.workspaceId,
    area: "coach",
    pedido: {
      tipo: "ALEXANDER",
      numero,
      destinatario: "Dueño",
      texto: texto_dueno,
      // Es el único WhatsApp del Coach para el dueño: sale aunque la página de Alertas deje solo las urgentes.
      prioridad: "URGENTE",
      titulo: `Coach con Opus: el ${fecha} se saltó por uso`,
    },
  });
  return { ok: envio.ok, saltado: true, fecha, anotado: true, envio: { estado: envio.estado, motivo: envio.motivo }, texto_dueno };
}

async function avisar(args: Argumentos, contexto: Contexto) {
  await exigirPermiso(contexto);
  const fecha = leerFecha(args.fecha);
  const prueba = args.prueba === true;
  if (!(await coachOpusActivo(contexto.workspaceId))) return APAGADO;

  if (args.saltado === true) return avisarDiaSaltado(fecha, args.motivo, prueba, contexto);

  const revisiones = await revisionesDelDia(contexto.workspaceId, fecha);
  const urlBase = getPublicBaseUrl() || ENLACE_POR_DEFECTO;
  const lineasDueno = lineasParaDueno(revisiones);
  const tituloDueno = tituloDelResumenDelDueno(fecha, lineasDueno.length);

  const asesoras: Array<{ userId: string; nombre: string; estado: string; motivo?: string | null; texto?: string }> = [];
  for (const revision of revisiones) {
    if (revision.avisadoEn) {
      asesoras.push({ userId: revision.userId, nombre: revision.nombre, estado: "ya_avisada" });
      continue;
    }
    const textoAsesora = textoParaAsesora(revision, urlBase);
    if (prueba) {
      asesoras.push({ userId: revision.userId, nombre: revision.nombre, estado: "prueba", texto: textoAsesora });
      continue;
    }
    const numero = await numeroDeAvisosDeLaPersona(contexto.workspaceId, revision.userId).catch(() => null);
    if (!numero) {
      asesoras.push({ userId: revision.userId, nombre: revision.nombre, estado: "sin_numero", motivo: "no tiene número en Mi empresa → Equipo" });
      continue;
    }
    const envio = await mandarWhatsAppAlEquipo({
      workspaceId: contexto.workspaceId,
      area: "coach",
      pedido: { tipo: "ASESORA", numero, destinatario: revision.nombre, texto: textoAsesora },
    });
    // "Ya se le mandó hoy" también cuenta como avisada: es una vez por persona y día.
    const avisada = envio.ok || envio.motivo === MOTIVO_YA_SE_MANDO;
    if (avisada) await marcarAvisada(revision.id);
    asesoras.push({ userId: revision.userId, nombre: revision.nombre, estado: envio.ok ? "enviado" : envio.estado.toLowerCase(), motivo: envio.motivo });
  }

  if (prueba) {
    return { ok: true, prueba: true, fecha, asesoras, dueno: { solo_en_alertas: true, titulo: tituloDueno, lineas: lineasDueno } };
  }

  // El resumen del dueño va SOLO a la página de Alertas (regla del 29-oct): sin `enviar`, no sale por WhatsApp.
  let alerta: { guardada: boolean } | null = null;
  if (lineasDueno.length) {
    const resultado = await registrarAlerta({
      workspaceId: contexto.workspaceId,
      clave: claveDeAlerta(ORIGEN_COACH, tituloDueno),
      prioridad: "MEDIA",
      titulo: tituloDueno,
      detalle: lineasDueno.join("\n"),
      origen: ORIGEN_COACH,
    });
    alerta = { guardada: Boolean(resultado.id) };
  }

  return {
    ok: true,
    fecha,
    asesoras,
    dueno: alerta ? { solo_en_alertas: true, ...alerta } : { solo_en_alertas: true, guardada: false, motivo: "no hay revisiones de ese día" },
  };
}

export async function ejecutarHerramientaMcpCoach(nombre: string, argumentos: Argumentos, contexto: Contexto): Promise<unknown> {
  switch (nombre) {
    case "coach_chats_del_dia":
      return verChatsDelDia(argumentos, contexto);
    case "coach_ver_chat":
      return verChat(argumentos, contexto);
    case "coach_guardar_revision":
      return guardar(argumentos, contexto);
    case "coach_avisar_del_dia":
      return avisar(argumentos, contexto);
    default:
      throw new Error(`No existe la herramienta "${nombre}".`);
  }
}
