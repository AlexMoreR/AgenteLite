import { prisma } from "@/lib/prisma";
import { ORIGENES_AUTOMATICOS } from "@/lib/freno-de-automaticos";
import { puedeVerElSupervisor } from "@/lib/mcp/supervisor";
import {
  DIAS_SIN_REPETIR,
  hablaDelCombo,
  medirChat,
  normalizarParaComparar,
  type MensajeMedido,
} from "@/features/seguimientos/dominio/compuerta-de-envio";
import { nombreDeArchivo } from "@/features/seguimientos/services/compuerta-de-envio";

/*
  SEGUIMIENTOS REPETIDOS DESDE CLAUDE (solo lectura; tarjeta yp8xzwvm, 4-nov-2026).

  Para medir el arreglo de los seguimientos: en los últimos N días (7 por defecto, hasta 30), cuántas veces
  un chat recibió el MISMO texto automático otra vez (sin respuesta de la clienta entre los dos, o con
  respuesta de por medio) y cuántos automáticos hablaron del combo en un chat que ya iba de otro producto.
  Trae los ids de los chats para revisarlos con `ver_conversacion`.

  No escribe nada, no manda mensajes y no toca el bot. El negocio sale de la clave, nunca de un argumento.
  La pueden usar el dueño, los administradores y la supervisora (como el embudo por paso).
*/

type Contexto = { workspaceId: string; userId: string };
type Argumentos = Record<string, unknown>;

const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

const DIAS_POR_DEFECTO = 7;
const DIAS_MAXIMOS = 30;
/** Topes para que una consulta no se coma la base. */
const AUTOMATICOS_MAXIMOS = 20_000;
const CHATS_MAXIMOS = 500;
const MENSAJES_POR_CHAT = 300;
/** Chats que se listan por grupo en la respuesta. */
const CHATS_EN_LA_RESPUESTA = 50;

export const HERRAMIENTAS_MCP_SEGUIMIENTOS_REPETIDOS = [
  {
    name: "seguimientos_repetidos",
    title: "Seguimientos repetidos",
    description:
      "Mide los seguimientos automaticos que salieron repetidos o fuera de lugar en los ultimos N dias (7 por defecto, hasta 30). Cuenta: 'repetidos_seguidos' = el mismo texto automatico otra vez al mismo chat SIN que la clienta escribiera entre los dos (incluye los que salieron dos veces en el mismo minuto); 'repetidos_con_respuesta' = el mismo texto otra vez despues de que la clienta respondio; 'combo_en_chat_de_otro_producto' = un automatico que habla del combo o de las camillas en un chat que ya iba de otro producto (la clienta lo pidio o le mandamos su catalogo). Trae los ids de los chats (conversation_id) para revisarlos con ver_conversacion. Solo lectura: no cambia nada ni manda mensajes.",
    inputSchema: {
      type: "object",
      properties: {
        dias: { type: "number", description: `Dias hacia atras, de 1 a ${DIAS_MAXIMOS}. Por defecto ${DIAS_POR_DEFECTO}.` },
      },
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
] as const;

const NOMBRES = new Set<string>(HERRAMIENTAS_MCP_SEGUIMIENTOS_REPETIDOS.map((herramienta) => herramienta.name));

export function esHerramientaDeSeguimientosRepetidos(nombre: string) {
  return NOMBRES.has(nombre);
}

function leerDias(valor: unknown): number {
  if (valor === undefined || valor === null || valor === "") return DIAS_POR_DEFECTO;
  const dias = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isInteger(dias) || dias < 1 || dias > DIAS_MAXIMOS) {
    throw new Error(`dias debe ser un número entero de 1 a ${DIAS_MAXIMOS}.`);
  }
  return dias;
}

const DE_LOS_AUTOMATICOS = ORIGENES_AUTOMATICOS.map((source) => ({ rawPayload: { path: ["source"], equals: source } }));

function origenDe(rawPayload: unknown): string | null {
  const source = (rawPayload as { source?: unknown } | null)?.source;
  return typeof source === "string" ? source : null;
}

async function seguimientosRepetidos(args: Argumentos, contexto: Contexto) {
  if (!(await puedeVerElSupervisor(contexto))) {
    throw new Error("Esta clave no tiene permiso para ver los seguimientos repetidos: es solo del dueño, los administradores y la supervisora.");
  }
  const dias = leerDias(args.dias);
  const ahora = new Date();
  const desde = new Date(ahora.getTime() - dias * 24 * 3_600_000);
  // Lo de los 7 días antes sirve para comparar (un texto que ya había salido) y para saber el producto.
  const desdeLectura = new Date(desde.getTime() - DIAS_SIN_REPETIR * 24 * 3_600_000);

  // 1. Los automáticos del periodo (y de los 7 días antes), para elegir los chats candidatos.
  const automaticos = await prisma.message.findMany({
    where: {
      workspaceId: contexto.workspaceId,
      direction: "OUTBOUND",
      deletedAt: null,
      createdAt: { gte: desdeLectura, lte: ahora },
      OR: DE_LOS_AUTOMATICOS,
    },
    orderBy: { createdAt: "desc" },
    take: AUTOMATICOS_MAXIMOS,
    select: { conversationId: true, content: true, createdAt: true },
  });
  const porChat = new Map<string, { textos: Set<string>; repite: boolean; combo: boolean; enElPeriodo: boolean }>();
  for (const fila of automaticos) {
    const chat = porChat.get(fila.conversationId) ?? { textos: new Set<string>(), repite: false, combo: false, enElPeriodo: false };
    const clave = normalizarParaComparar(fila.content);
    if (clave && chat.textos.has(clave)) chat.repite = true;
    if (clave) chat.textos.add(clave);
    if (fila.createdAt >= desde) {
      chat.enElPeriodo = true;
      if (hablaDelCombo(fila.content)) chat.combo = true;
    }
    porChat.set(fila.conversationId, chat);
  }
  const candidatos = [...porChat.entries()]
    .filter(([, chat]) => chat.enElPeriodo && (chat.repite || chat.combo))
    .map(([id]) => id);
  const revisados = candidatos.slice(0, CHATS_MAXIMOS);

  // 2. Cada chat candidato completo (en la ventana), para medirlo.
  const seguidos: Array<Record<string, unknown>> = [];
  const conRespuesta: Array<Record<string, unknown>> = [];
  const combo: Array<Record<string, unknown>> = [];
  const chatsCon = { seguidos: new Set<string>(), conRespuesta: new Set<string>(), combo: new Set<string>() };
  for (const conversationId of revisados) {
    const filas = await prisma.message.findMany({
      where: {
        workspaceId: contexto.workspaceId,
        conversationId,
        type: { not: "SYSTEM" },
        deletedAt: null,
        createdAt: { gte: desdeLectura, lte: ahora },
      },
      orderBy: { createdAt: "desc" },
      take: MENSAJES_POR_CHAT,
      select: { direction: true, type: true, content: true, transcripcion: true, rawPayload: true, createdAt: true },
    });
    const mensajes: MensajeMedido[] = filas.map((fila) => ({
      direccion: fila.direction === "INBOUND" ? "IN" : "OUT",
      tipo: fila.type,
      texto: fila.type === "AUDIO" ? fila.transcripcion?.trim() || null : fila.content,
      nombreDeArchivo: nombreDeArchivo(fila),
      en: fila.createdAt,
      automatico:
        fila.direction === "OUTBOUND" && (ORIGENES_AUTOMATICOS as readonly string[]).includes(origenDe(fila.rawPayload) ?? ""),
    }));
    const medicion = medirChat(mensajes, desde);
    for (const hallazgo of medicion.seguidos) {
      chatsCon.seguidos.add(conversationId);
      seguidos.push({ conversation_id: conversationId, texto: hallazgo.texto.slice(0, 160), en: hallazgo.en.toISOString(), anterior_en: hallazgo.anteriorEn.toISOString() });
    }
    for (const hallazgo of medicion.conRespuesta) {
      chatsCon.conRespuesta.add(conversationId);
      conRespuesta.push({ conversation_id: conversationId, texto: hallazgo.texto.slice(0, 160), en: hallazgo.en.toISOString(), anterior_en: hallazgo.anteriorEn.toISOString() });
    }
    for (const hallazgo of medicion.comboEnOtroProducto) {
      chatsCon.combo.add(conversationId);
      combo.push({ conversation_id: conversationId, producto_del_chat: hallazgo.producto, por_que: hallazgo.senal, texto: hallazgo.texto.slice(0, 160), en: hallazgo.en.toISOString() });
    }
  }

  const grupo = (lista: Array<Record<string, unknown>>, chats: Set<string>) => ({
    veces: lista.length,
    chats: chats.size,
    ids_de_los_chats: [...chats].slice(0, CHATS_EN_LA_RESPUESTA),
    ejemplos: lista.slice(0, CHATS_EN_LA_RESPUESTA),
  });
  return {
    dias,
    desde: desde.toISOString(),
    hasta: ahora.toISOString(),
    automaticos_leidos: automaticos.length,
    chats_revisados: revisados.length,
    incompleto:
      automaticos.length >= AUTOMATICOS_MAXIMOS || candidatos.length > CHATS_MAXIMOS
        ? `Se llegó al tope de lectura (${AUTOMATICOS_MAXIMOS} automáticos o ${CHATS_MAXIMOS} chats): pide menos días para la cifra completa.`
        : null,
    repetidos_seguidos: grupo(seguidos, chatsCon.seguidos),
    repetidos_con_respuesta: grupo(conRespuesta, chatsCon.conRespuesta),
    combo_en_chat_de_otro_producto: grupo(combo, chatsCon.combo),
    resumen_para_decir:
      `En los últimos ${dias} días: ${seguidos.length} seguimientos repetidos seguidos sin respuesta (${chatsCon.seguidos.size} chats), ` +
      `${conRespuesta.length} repetidos con respuesta de por medio (${chatsCon.conRespuesta.size} chats) y ` +
      `${combo.length} seguimientos del combo en chats de otro producto (${chatsCon.combo.size} chats).`,
  };
}

export async function ejecutarHerramientaMcpSeguimientosRepetidos(nombre: string, argumentos: Argumentos, contexto: Contexto): Promise<unknown> {
  switch (nombre) {
    case "seguimientos_repetidos":
      return seguimientosRepetidos(argumentos, contexto);
    default:
      throw new Error(`No existe la herramienta "${nombre}".`);
  }
}
