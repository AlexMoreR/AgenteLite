import { ORIGEN_DEL_COACH, fechaValida, hoyEnBogota } from "@/features/agentes-de-area/dominio/reglas";
import { leerEquipoDeAvisos } from "@/features/agentes-de-area/servicios/config";
import { mandarWhatsAppAlEquipo } from "@/features/agentes-de-area/servicios/envios";
import { registrarAlerta } from "@/features/alertas/servicios/alertas";
import { limpiarDatosPersonales, normalizarMensajes, primerNombre, rangoDelDia, type MensajeCrudo } from "@/features/coach/reglas";
import { lineasParaDueno, taparTelefonos, textoParaAsesora, ultimos4, type DatosDeRevision } from "@/features/coach/revision-opus/reglas";
import {
  coachOpusActivo,
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

  Opus corre en aizen1 cada noche, lee los chats del día de cada asesora y deja una revisión corta. El CRM
  solo da los datos, guarda la revisión y entrega los WhatsApp INTERNOS. Cuatro herramientas:
    - coach_chats_del_dia (lee)      → por asesora, los chats de 00:00 a 22:00 (Colombia) ya medidos, máximo 25.
    - coach_ver_chat (lee)           → los mensajes de un chat, con los audios ya transcritos y quién escribió.
    - coach_guardar_revision (escribe) → la revisión de una asesora en un día (modelo "opus").
    - coach_avisar_del_dia (escribe) → el WhatsApp a cada asesora (textos armados AQUÍ, sin texto libre de la IA)
                                       y el resumen del dueño SOLO en la página de Alertas. O el aviso de día saltado.

  Con el interruptor del Coach con Opus apagado, guardar y avisar responden "apagado" y no hacen nada.
  Nunca le escribe a un cliente: los envíos van por mandarWhatsAppAlEquipo (solo números del equipo, por la línea
  Admin, una vez por persona y día). No toca la transcripción de audios: solo lee lo que ya está guardado.
*/

type Contexto = { workspaceId: string; userId: string };
type Argumentos = Record<string, unknown>;

const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const ESCRITURA = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

/** Máximo de chats por asesora que se le dan a Opus. */
export const MAXIMO_CHATS_POR_ASESORA = 25;
/** La revisión mira de 00:00 a 22:00 hora de Colombia: lo que llega después se cuenta al otro día. */
const HORAS_DEL_DIA_REVISADO = 22;
const MENSAJES_POR_DEFECTO = 200;
const MENSAJES_MAXIMO = 400;
const APAGADO = "apagado";

export const HERRAMIENTAS_MCP_COACH = [
  {
    name: "coach_chats_del_dia",
    title: "Coach: chats del día por asesora",
    description:
      "Para el Coach con Opus. Por cada asesora que atendió chats ese día (sale de los datos), los chats de las líneas de ventas de 00:00 a 22:00 hora de Colombia, ya medidos sin IA: primera respuesta, demoras y clientes sin respuesta en horario, cotización, ganado hoy, descartes antes de 72 h. Vienen ordenados con los más útiles para revisar primero y como máximo 25 por asesora. Cada chat trae su chatId (para coach_ver_chat) y el teléfono solo con los últimos 4 dígitos. Solo lectura.",
    inputSchema: {
      type: "object",
      properties: { fecha: { type: "string", description: "AAAA-MM-DD (hora de Colombia). Por defecto, hoy." } },
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
  {
    name: "coach_ver_chat",
    title: "Coach: ver un chat",
    description:
      "Los mensajes de un chat (canal viejo o API oficial), del más viejo al más nuevo, con quién escribió cada uno (cliente, asesora, bot o sistema) y los audios con su texto ya transcrito; si el audio no tiene transcripción sale \"[audio sin transcribir]\" (los de la API oficial hoy no se transcriben). Teléfonos tapados: solo los últimos 4 dígitos. Solo chats de este negocio. Solo lectura.",
    inputSchema: {
      type: "object",
      properties: {
        chatId: { type: "string", description: "El chatId que da coach_chats_del_dia." },
        fecha: { type: "string", description: "AAAA-MM-DD opcional: solo los mensajes hasta el final de ese día." },
        limite: { type: "number", description: `Cuántos mensajes, los últimos (por defecto ${MENSAJES_POR_DEFECTO}, máximo ${MENSAJES_MAXIMO}).` },
      },
      required: ["chatId"],
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
  {
    name: "coach_guardar_revision",
    title: "Coach: guardar la revisión de una asesora",
    description:
      "Guarda (o reemplaza) la revisión del día de UNA asesora, con el modelo \"opus\". Máximo 1 chat \"bien\" y 2 \"mejorable\"; la causa de cada chat es asesora, bot, politica o cliente_sin_intencion; nada de teléfonos en el texto (solo los últimos 4 dígitos). Si la revisión no pasa, devuelve los errores y no guarda. Si el Coach con Opus está apagado responde \"apagado\" y no guarda nada. No manda ningún mensaje.",
    inputSchema: {
      type: "object",
      properties: {
        fecha: { type: "string", description: "AAAA-MM-DD (hora de Colombia) del día revisado." },
        userId: { type: "string", description: "El id de la asesora (asesoras[].userId de coach_chats_del_dia)." },
        nombre: { type: "string", description: "El nombre de la asesora." },
        resumen: { type: "string", description: "2 o 3 frases para la asesora: qué hizo bien y qué mejorar. Enseña, no castiga." },
        chats: {
          type: "array",
          description: "Los chats elegidos: máximo 1 \"bien\" y 2 \"mejorable\".",
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
        chatsLeidos: { type: "number", description: "Cuántos chats leyó para hacer la revisión." },
      },
      required: ["fecha", "userId", "nombre", "resumen", "chats", "chatsLeidos"],
      additionalProperties: false,
    },
    annotations: ESCRITURA,
  },
  {
    name: "coach_avisar_del_dia",
    title: "Coach: avisar las revisiones del día",
    description:
      "Manda a cada asesora con revisión sin avisar su WhatsApp corto por la línea Admin (el texto lo arma el CRM con la revisión guardada, no la IA) y deja el resumen del dueño SOLO en la página de Alertas. Solo números del equipo, una vez por persona y día. Con prueba=true no manda ni guarda nada y devuelve los textos. Con saltado=true y motivo, anota el día como saltado y le avisa al dueño por WhatsApp (es el único WhatsApp que recibe el dueño). Si el Coach con Opus está apagado responde \"apagado\" y no hace nada.",
    inputSchema: {
      type: "object",
      properties: {
        fecha: { type: "string", description: "AAAA-MM-DD (hora de Colombia) del día revisado." },
        prueba: { type: "boolean", description: "true = no manda nada; devuelve los textos." },
        saltado: { type: "boolean", description: "true = ese día no se hizo la revisión (por ejemplo, por el uso de la suscripción)." },
        motivo: { type: "string", description: "Con saltado=true: por qué se saltó el día." },
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

function texto(valor: unknown) {
  return typeof valor === "string" ? valor.trim() : "";
}

function leerFecha(valor: unknown, porDefecto?: string): string {
  if ((valor === undefined || valor === null || valor === "") && porDefecto) return porDefecto;
  if (!fechaValida(valor)) throw new Error('La fecha tiene que ir como AAAA-MM-DD.');
  return valor;
}

/** Las asesoras del negocio (todo el equipo activo menos la cuenta del dueño) con su nombre. */
async function leerAsesoras(workspaceId: string) {
  const [workspace, miembros] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { ownerId: true } }),
    prisma.workspaceMember.findMany({
      where: { workspaceId, isActive: true },
      select: { userId: true, role: true, user: { select: { name: true, email: true } } },
    }),
  ]);
  const nombres = new Map<string, string>();
  for (const miembro of miembros) {
    if (miembro.role === "OWNER" || miembro.userId === workspace?.ownerId) continue;
    nombres.set(miembro.userId, miembro.user?.name?.trim() || miembro.user?.email?.split("@")[0] || "Asesora");
  }
  return { nombres, ownerId: workspace?.ownerId ?? null };
}

/* ------------------------------------------------------------------------------------------------
   coach_chats_del_dia
------------------------------------------------------------------------------------------------ */

/**
 * Qué tan útil es un chat para revisar: primero los que tienen errores de reloj (sin respuesta, demoras,
 * descartes antes de 72 h), luego los que tuvieron cotización o se ganaron, y los que tienen más conversación
 * de la asesora. Los quietos (sin mensajes hoy) van al final.
 */
export function utilidadParaRevisar(chat: ChatMedido, desde: Date): number {
  if (chat.quieto) return -1;
  const deHoy = chat.mensajes.filter((mensaje) => mensaje.en >= desde);
  const deLaAsesora = deHoy.filter((mensaje) => mensaje.autor === "asesora").length;
  const delCliente = deHoy.filter((mensaje) => mensaje.autor === "cliente").length;
  return (
    chat.erroresDuros.length * 30 +
    (chat.cotizacion ? 20 : 0) +
    (chat.ganadoHoy ? 20 : 0) +
    (chat.atribucionSegura ? 5 : 0) +
    Math.min(deLaAsesora, 10) * 2 +
    Math.min(delCliente, 10)
  );
}

/** Ordena de más a menos útil (a igual utilidad, el de más mensajes del día) y corta en el máximo. */
export function ordenarParaRevisar(chats: ChatMedido[], desde: Date, maximo = MAXIMO_CHATS_POR_ASESORA): ChatMedido[] {
  const delDia = (chat: ChatMedido) => chat.mensajes.filter((mensaje) => mensaje.en >= desde).length;
  return chats
    .map((chat) => ({ chat, utilidad: utilidadParaRevisar(chat, desde), mensajes: delDia(chat) }))
    .sort((a, b) => b.utilidad - a.utilidad || b.mensajes - a.mensajes || a.chat.id.localeCompare(b.chat.id))
    .slice(0, maximo)
    .map(({ chat }) => chat);
}

function chatParaOpus(chat: ChatMedido, desde: Date) {
  const deHoy = chat.mensajes.filter((mensaje) => mensaje.en >= desde);
  const contar = (autor: string) => deHoy.filter((mensaje) => mensaje.autor === autor).length;
  return {
    chatId: chat.id,
    fuente: chat.fuente === "official" ? "api_oficial" : "canal_viejo",
    ref: chat.ref,
    telefono: ultimos4(chat.telefono),
    cliente: primerNombre(chat.nombre) || null,
    etapa: chat.crmStage,
    ganado_hoy: chat.ganadoHoy,
    quieto: chat.quieto,
    creado_hoy: chat.creadoHoy,
    cotizacion: chat.cotizacion,
    primera_respuesta_min: chat.esperas.primeraRespuestaMin,
    atribucion_segura: chat.atribucionSegura,
    mensajes_de_hoy: { cliente: contar("cliente"), asesora: contar("asesora"), bot: contar("bot") },
    hechos: chat.hechos.map((hecho) => limpiarDatosPersonales(hecho)),
    errores_de_reloj: chat.erroresDuros.map((error) => ({ tipo: error.tipo, detalle: error.detalle, minutos: error.minutos })),
  };
}

async function verChatsDelDia(args: Argumentos, contexto: Contexto) {
  await exigirPermiso(contexto);
  const fecha = leerFecha(args.fecha, hoyEnBogota());
  const { desde } = rangoDelDia(fecha);
  const hasta = new Date(desde.getTime() + HORAS_DEL_DIA_REVISADO * 3_600_000);
  const ahora = new Date();
  const corte = hasta < ahora ? hasta : ahora;

  const { nombres } = await leerAsesoras(contexto.workspaceId);
  const asesoras = new Set(nombres.keys());
  const chats = (await chatsDelDia(contexto.workspaceId, desde, hasta)).map((chat) => medirChat(chat, asesoras, desde, corte));

  const porAsesora = new Map<string, ChatMedido[]>();
  let sinAsesora = 0;
  for (const chat of chats) {
    if (!chat.asesoraId) {
      sinAsesora += 1;
      continue;
    }
    if (!porAsesora.has(chat.asesoraId)) porAsesora.set(chat.asesoraId, []);
    porAsesora.get(chat.asesoraId)!.push(chat);
  }

  const lista = [...porAsesora.entries()]
    .map(([userId, suyos]) => {
      const elegidos = ordenarParaRevisar(suyos, desde);
      return {
        userId,
        nombre: nombres.get(userId) ?? "Asesora",
        chats_del_dia: suyos.length,
        chats_devueltos: elegidos.length,
        chats: elegidos.map((chat) => chatParaOpus(chat, desde)),
      };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  return {
    fecha,
    ventana: "de 00:00 a 22:00 hora de Colombia",
    activo: await coachOpusActivo(contexto.workspaceId).catch(() => false),
    asesoras: lista,
    chats_sin_asesora: sinAsesora,
    nota: `Máximo ${MAXIMO_CHATS_POR_ASESORA} chats por asesora, los más útiles primero. Para leer un chat: coach_ver_chat con su chatId. Teléfonos solo con los últimos 4 dígitos: no los escribas completos en la revisión.`,
  };
}

/* ------------------------------------------------------------------------------------------------
   coach_ver_chat
------------------------------------------------------------------------------------------------ */

type FilaParaLeer = {
  id: string;
  direction: string;
  type: string;
  content: string | null;
  transcripcion: string | null;
  createdAt: Date;
  rawPayload: unknown;
  isStatusBroadcast?: boolean | null;
  deletedAt?: Date | null;
};

async function verChat(args: Argumentos, contexto: Contexto) {
  await exigirPermiso(contexto);
  const chatId = texto(args.chatId);
  if (!chatId) throw new Error('Falta "chatId".');
  const fecha = args.fecha === undefined || args.fecha === null || args.fecha === "" ? null : leerFecha(args.fecha);
  const hasta = fecha ? rangoDelDia(fecha).hasta : undefined;
  const pedido = Number(args.limite);
  const limite = Number.isFinite(pedido) && pedido >= 1 ? Math.min(Math.floor(pedido), MENSAJES_MAXIMO) : MENSAJES_POR_DEFECTO;
  const cuando = hasta ? { createdAt: { lt: hasta } } : {};

  let fuente: "canal_viejo" | "api_oficial";
  let telefono: string | null;
  let cliente: string | null;
  let asignadaA: string | null;
  let filas: FilaParaLeer[];

  // Siempre filtrado por el negocio de la clave: un chatId de otro negocio no existe.
  const viejo = await prisma.conversation.findFirst({
    where: { id: chatId, workspaceId: contexto.workspaceId },
    select: { id: true, assignedToUserId: true, contact: { select: { name: true, phoneNumber: true } } },
  });
  if (viejo) {
    fuente = "canal_viejo";
    telefono = viejo.contact.phoneNumber;
    cliente = viejo.contact.name;
    asignadaA = viejo.assignedToUserId;
    filas = await prisma.message.findMany({
      where: { conversationId: viejo.id, deletedAt: null, ...cuando },
      orderBy: { createdAt: "desc" },
      take: limite,
      select: { id: true, direction: true, type: true, content: true, transcripcion: true, createdAt: true, rawPayload: true, isStatusBroadcast: true, deletedAt: true },
    });
  } else {
    const oficial = await prisma.officialApiConversation.findFirst({
      where: { id: chatId, config: { workspaceId: contexto.workspaceId } },
      select: { id: true, assignedToUserId: true, contact: { select: { name: true, phoneNumber: true, waId: true } } },
    });
    if (!oficial) throw new Error("No existe ese chat en este negocio. Usa los chatId de coach_chats_del_dia.");
    fuente = "api_oficial";
    telefono = oficial.contact.phoneNumber ?? oficial.contact.waId;
    cliente = oficial.contact.name;
    asignadaA = oficial.assignedToUserId;
    // La API oficial no guarda la transcripción de los audios: salen como "[audio sin transcribir]".
    const oficiales = await prisma.officialApiMessage.findMany({
      where: { conversationId: oficial.id, ...cuando },
      orderBy: { createdAt: "desc" },
      take: limite,
      select: { id: true, direction: true, type: true, content: true, createdAt: true, rawPayload: true },
    });
    filas = oficiales.map((fila) => ({ ...fila, transcripcion: null }));
  }

  const { nombres } = await leerAsesoras(contexto.workspaceId);
  const crudos: MensajeCrudo[] = filas.map((fila) => ({
    id: fila.id,
    direction: String(fila.direction),
    type: String(fila.type),
    content: fila.content,
    transcripcion: fila.transcripcion,
    createdAt: fila.createdAt,
    rawPayload: fila.rawPayload,
    isStatusBroadcast: fila.isStatusBroadcast ?? false,
    deletedAt: fila.deletedAt ?? null,
  }));
  const mensajes = normalizarMensajes(crudos).map((mensaje) => ({
    en: mensaje.en.toISOString(),
    autor: mensaje.autor,
    ...(mensaje.autor === "asesora"
      ? { asesora: mensaje.userId ? (nombres.get(mensaje.userId) ?? "otra persona del equipo") : mensaje.desdeCelular ? "celular de la línea" : null }
      : {}),
    tipo: mensaje.tipo,
    texto: limpiarDatosPersonales(mensaje.texto),
  }));

  return {
    chatId,
    fuente,
    telefono: ultimos4(telefono),
    cliente: primerNombre(cliente ?? "") || null,
    asignada_a: asignadaA ? (nombres.get(asignadaA) ?? "otra persona del equipo") : null,
    mensajes,
    audios_sin_transcribir: mensajes.filter((mensaje) => mensaje.texto === "[audio sin transcribir]").length,
    nota: `Los últimos ${limite} mensajes como máximo${fecha ? ` hasta el final del ${fecha}` : ""}. Autor: cliente, asesora, bot o sistema.`,
  };
}

/* ------------------------------------------------------------------------------------------------
   coach_guardar_revision
------------------------------------------------------------------------------------------------ */

async function guardar(args: Argumentos, contexto: Contexto) {
  await exigirPermiso(contexto);
  const resultado = await guardarRevision(contexto.workspaceId, texto(args.fecha), texto(args.userId), {
    nombre: args.nombre as string,
    modelo: "opus",
    resumen: args.resumen as string,
    chats: args.chats as DatosDeRevision["chats"],
    chatsLeidos: args.chatsLeidos as number,
  });
  if ("apagado" in resultado) {
    return { estado: APAGADO, guardado: false, nota: "El Coach con Opus está apagado: no se guardó nada." };
  }
  if (!resultado.ok) return { estado: "con_errores", guardado: false, errores: resultado.errores };
  return {
    estado: "guardado",
    guardado: true,
    id: resultado.revision.id,
    fecha: resultado.revision.fecha,
    userId: resultado.revision.userId,
    nota: "No se mandó ningún mensaje: para avisar usar coach_avisar_del_dia.",
  };
}

/* ------------------------------------------------------------------------------------------------
   coach_avisar_del_dia
------------------------------------------------------------------------------------------------ */

async function avisar(args: Argumentos, contexto: Contexto) {
  await exigirPermiso(contexto);
  const workspaceId = contexto.workspaceId;
  const fecha = leerFecha(args.fecha);
  const prueba = args.prueba === true;
  if (!(await coachOpusActivo(workspaceId))) {
    return { estado: APAGADO, se_mando: 0, nota: "El Coach con Opus está apagado: no se mandó ni se guardó nada." };
  }

  const equipo = await leerEquipoDeAvisos(workspaceId);
  const numeroDe = (userId: string | null) => (userId ? (equipo.find((persona) => persona.userId === userId)?.numero ?? null) : null);

  // Día saltado: se anota y se le avisa al dueño (su único WhatsApp del Coach).
  if (args.saltado === true) {
    const motivo = texto(args.motivo) || "sin motivo";
    const titulo = `Coach: día ${fecha} saltado por uso`;
    const avisoDe = (porQue: string) => `El Coach con Opus no revisó los chats del ${fecha}. Motivo: ${porQue}`;
    if (prueba) {
      return { estado: "prueba", saltado: true, titulo, texto_dueno: avisoDe(taparTelefonos(motivo).slice(0, 300)), nota: "Prueba: no se anotó ni se mandó nada." };
    }
    const anotado = await registrarDiaSaltado(workspaceId, fecha, motivo);
    const { ownerId } = await leerAsesoras(workspaceId);
    const numero = numeroDe(ownerId);
    if (!numero) {
      return { estado: "saltado", saltado: anotado, se_mando: 0, motivo: "el dueño no está en la lista del equipo (Mi empresa → Equipo): no se mandó" };
    }
    const resultado = await mandarWhatsAppAlEquipo({
      workspaceId,
      area: "coach",
      pedido: {
        tipo: "ALEXANDER",
        numero,
        destinatario: "Dueño",
        // Urgente para que salga por WhatsApp (corto, con el link a Alertas) aunque las alertas sean solo-urgentes.
        prioridad: "URGENTE",
        titulo,
        texto: avisoDe(anotado.motivo),
      },
    });
    return {
      estado: "saltado",
      saltado: anotado,
      se_mando: resultado.ok ? 1 : 0,
      ...(resultado.motivo ? { motivo: resultado.motivo } : {}),
    };
  }

  const revisiones = await revisionesDelDia(workspaceId, fecha);
  if (!revisiones.length) return { estado: "sin_revisiones", se_mando: 0, nota: `No hay revisiones guardadas del ${fecha}: no se mandó nada.` };

  const urlBase = getPublicBaseUrl();
  const lineasDueno = lineasParaDueno(revisiones);
  const pendientes = revisiones.filter((revision) => !revision.avisadoEn);

  if (prueba) {
    return {
      estado: "prueba",
      fecha,
      asesoras: pendientes.map((revision) => ({
        userId: revision.userId,
        nombre: revision.nombre,
        tiene_numero: Boolean(numeroDe(revision.userId)),
        texto: textoParaAsesora(revision, urlBase),
      })),
      ya_avisadas: revisiones.length - pendientes.length,
      alerta_dueno: lineasDueno,
      nota: "Prueba: no se mandó ni se guardó nada.",
    };
  }

  const resultados: Array<{ userId: string; nombre: string; se_mando: boolean; motivo?: string }> = [];
  for (const revision of pendientes) {
    const numero = numeroDe(revision.userId);
    if (!numero) {
      resultados.push({ userId: revision.userId, nombre: revision.nombre, se_mando: false, motivo: "no está en la lista del equipo (Mi empresa → Equipo)" });
      continue;
    }
    const envio = await mandarWhatsAppAlEquipo({
      workspaceId,
      area: "coach",
      pedido: { tipo: "ASESORA", numero, destinatario: revision.nombre.slice(0, 120), texto: textoParaAsesora(revision, urlBase) },
    });
    if (envio.ok) await marcarAvisada(revision.id);
    resultados.push({ userId: revision.userId, nombre: revision.nombre, se_mando: envio.ok, ...(envio.motivo ? { motivo: envio.motivo } : {}) });
  }

  // El resumen del dueño va SOLO a la página de Alertas (regla del 29-oct): prioridad media, no sale por WhatsApp.
  const alerta = await registrarAlerta({
    workspaceId,
    clave: `coach-opus:${fecha}`,
    prioridad: "MEDIA",
    titulo: `Coach con Opus: revisión del ${fecha}`,
    detalle: lineasDueno.join("\n"),
    origen: ORIGEN_DEL_COACH,
  });

  return {
    estado: "avisado",
    fecha,
    se_mando: resultados.filter((resultado) => resultado.se_mando).length,
    asesoras: resultados,
    ya_avisadas: revisiones.length - pendientes.length,
    alerta_dueno_guardada: Boolean(alerta.id),
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
