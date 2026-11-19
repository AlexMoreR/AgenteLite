import { textoDeConfirmacionValido } from "@/features/tableros-inteligentes/services/reglas-trabajador";
import {
  calcularCambioDeAsignacion,
  escribirCambioDeAsignacion,
  leerAsignacionDelNegocio,
  type FotoDeAsignacion,
  type PedidoDeCambioDeAsignacion,
} from "@/lib/asignacion-del-negocio";
import { MINUTOS_MAXIMOS, MINUTOS_MINIMOS } from "@/lib/demora-de-asesora-ajuste";
import { anotarCambioMcp } from "@/lib/mcp/cambios";
import { prisma } from "@/lib/prisma";
import type { ConfigDeAsignacion } from "@/lib/reparto-cuando-lo-necesita";

/*
  LA ASIGNACIÓN DE CHATS POR MCP (T-772, parte 4). Lo mismo que Mi empresa > Equipo > Asignación:
  cuándo se le asigna un chat a una asesora (4 interruptores), quién está en el reparto de cada línea
  de ventas (`pausedAssignmentIds`) y los minutos de la regla de demora (avisar y pasar a otra).

  ver_asignacion solo lee. cambiar_asignacion va en dos pasos: sin confirmado=true NO guarda y muestra
  el antes y el después; con confirmado=true pide el texto de lo que dijo la persona («sí, apruebo»),
  y solo el dueño o un administrador guarda. Cada cambio queda en listar_cambios con la foto del antes,
  y deshacer_cambio lo deja como estaba. La lógica es la misma de la pantalla (asignacion-del-negocio.ts).
*/

type Contexto = { workspaceId: string; userId: string };
type Argumentos = Record<string, unknown>;

const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const ESCRIBE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

/** Los nombres del MCP (snake_case) y los de la config. */
const INTERRUPTORES: Array<{ mcp: string; clave: keyof ConfigDeAsignacion; que: string }> = [
  {
    mcp: "agente_pide",
    clave: "agentePide",
    que: "El agente pide asesora o la IA del chat está pausada: se asigna siempre.",
  },
  {
    mcp: "clienta_pregunta_plata_o_entrega",
    clave: "clientaPreguntaPlataOEntrega",
    que: "La clienta pregunta precio, pago, envío o contraentrega, o dice su ciudad (con las fotos ya mandadas).",
  },
  {
    mcp: "asesora_escribe",
    clave: "asesoraEscribe",
    que: "Una asesora escribe en un chat sin dueña: se lo queda.",
  },
  {
    mcp: "como_antes",
    clave: "comoAntes",
    que: "Como antes: se asigna apenas la clienta responde la bienvenida, y nada más (los otros tres no cuentan).",
  },
];

const AVISO_UN_MINUTO = "El reparto toma el cambio en hasta 1 minuto (guarda lo leído un minuto).";

export const HERRAMIENTAS_MCP_ASIGNACION = [
  {
    name: "ver_asignacion",
    title: "Ver cuándo y a quién se asignan los chats",
    description:
      "Lo mismo que Mi empresa > Equipo > Asignación: los 4 interruptores de cuándo se le asigna un chat a una asesora, " +
      "por cada línea de ventas sus asesoras (en el reparto o fuera; fuera no la saca de la línea, solo deja de recibir " +
      "chats nuevos) y los minutos de la regla de demora (avisar y pasar a otra). Solo lectura. Leer antes de cambiar_asignacion.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: SOLO_LECTURA,
  },
  {
    name: "cambiar_asignacion",
    title: "Cambiar cuándo y a quién se asignan los chats",
    description:
      "Cambia los interruptores, quién está en el reparto de una línea y los minutos de la regla de demora; lo que no se mande " +
      "queda como está. Sin confirmado=true NO guarda: devuelve el antes y el después para leérselos a la persona. Con " +
      "confirmado=true y texto_confirmacion (lo que dijo la persona, tal cual: tiene que decir «sí» y «apruebo») guarda. " +
      "Usar confirmado=true solo si la persona dijo que sí en esta conversación. Cambia a quién le llegan los chats en vivo. " +
      `${AVISO_UN_MINUTO} Queda en listar_cambios y se deshace con deshacer_cambio. Solo dueño o administrador. ` +
      "No prende ni apaga la regla de demora (eso sigue en Equipo).",
    inputSchema: {
      type: "object",
      properties: {
        interruptores: {
          type: "object",
          description: "Solo los que cambian, cada uno true o false.",
          properties: Object.fromEntries(INTERRUPTORES.map((i) => [i.mcp, { type: "boolean", description: i.que }])),
          additionalProperties: false,
        },
        lineas: {
          type: "array",
          description: "Por línea de ventas, quiénes quedan FUERA del reparto; las demás asesoras de esa línea quedan dentro.",
          items: {
            type: "object",
            properties: {
              linea_id: { type: "string", description: "El id de la línea (ver_asignacion)." },
              fuera: {
                type: "array",
                items: { type: "string" },
                description: "Ids de las asesoras que quedan fuera (lista vacía = todas dentro).",
              },
            },
            required: ["linea_id", "fuera"],
            additionalProperties: false,
          },
        },
        minutos_avisar: {
          type: "number",
          description: `Minutos sin respuesta para avisarle a la asesora, de ${MINUTOS_MINIMOS} a ${MINUTOS_MAXIMOS}.`,
        },
        minutos_pasar_a_otra: {
          type: "number",
          description: `Minutos sin respuesta para pasar el chat a otra asesora, de ${MINUTOS_MINIMOS} a ${MINUTOS_MAXIMOS} y más que los de avisar.`,
        },
        confirmado: { type: "boolean", description: "true solo después de leerle el antes y el después y que diga que sí." },
        texto_confirmacion: {
          type: "string",
          description: "Con confirmado=true: lo que dijo la persona, tal cual (por ejemplo «sí, apruebo»).",
        },
      },
      additionalProperties: false,
    },
    annotations: ESCRIBE,
  },
] as const;

const NOMBRES = new Set<string>(HERRAMIENTAS_MCP_ASIGNACION.map((herramienta) => herramienta.name));

export function esHerramientaDeAsignacion(nombre: string) {
  return NOMBRES.has(nombre);
}

/** Quien cambia: solo el dueño o un administrador del negocio de la clave. Devuelve su nombre. */
async function quienPuedeCambiar(contexto: Contexto): Promise<string> {
  const miembro = await prisma.workspaceMember.findFirst({
    where: { workspaceId: contexto.workspaceId, userId: contexto.userId, isActive: true },
    select: { role: true, user: { select: { role: true, name: true } }, workspace: { select: { ownerId: true } } },
  });
  const puede =
    !!miembro &&
    (miembro.user?.role === "ADMIN" ||
      miembro.role === "OWNER" ||
      miembro.role === "ADMIN" ||
      miembro.workspace?.ownerId === contexto.userId);
  if (!miembro || !puede) {
    throw new Error("Solo el dueño o un administrador del negocio puede cambiar la asignación de chats. No se guardó nada.");
  }
  return miembro.user?.name?.trim() || "Dueño o administrador";
}

function interruptoresParaMcp(config: ConfigDeAsignacion) {
  return Object.fromEntries(INTERRUPTORES.map((i) => [i.mcp, config[i.clave]]));
}

/** Cuándo se asigna hoy, en una frase (también la usa que_es_esta_aplicacion). */
export function cuandoSeAsigna(config: ConfigDeAsignacion): string {
  if (config.comoAntes) return "como antes: apenas la clienta responde la bienvenida";
  const partes = [
    config.agentePide ? "el agente pide asesora o pausa la IA" : null,
    config.clientaPreguntaPlataOEntrega ? "la clienta pregunta precio, pago, envío o contraentrega, o dice su ciudad" : null,
    config.asesoraEscribe ? "una asesora escribe en el chat" : null,
  ].filter(Boolean);
  if (!partes.length) return "nunca sola: todos los interruptores apagados (solo a mano o por la regla de demora)";
  return `cuando lo necesita: ${partes.join("; ")}`;
}

async function ver(contexto: Contexto) {
  const datos = await leerAsignacionDelNegocio(contexto.workspaceId);
  return {
    cuando_se_asigna: cuandoSeAsigna(datos.interruptores),
    interruptores: interruptoresParaMcp(datos.interruptores),
    que_es_cada_interruptor: Object.fromEntries(INTERRUPTORES.map((i) => [i.mcp, i.que])),
    lineas: datos.lineas.map((linea) => ({
      linea_id: linea.id,
      nombre: linea.nombre,
      ...(linea.abierta
        ? { abierta: "Sin colaboradoras: la ve todo el equipo y su reparto se arma en Conexión, no aquí." }
        : {}),
      asesoras: linea.asesoras.map((asesora) => ({
        id: asesora.id,
        nombre: asesora.nombre,
        reparto: asesora.enElReparto ? "en el reparto" : "fuera",
      })),
    })),
    demora: {
      minutos_avisar: datos.minutosAviso,
      minutos_pasar_a_otra: datos.minutosReasignar,
      regla: datos.demoraPrendida ? "prendida" : "apagada (se prende en Equipo; aquí solo se cambian los minutos)",
    },
    ojo: [
      "Fuera del reparto no saca a la asesora de la línea: sigue viendo y atendiendo sus chats, solo no recibe chats nuevos.",
      AVISO_UN_MINUTO,
      "Para cambiar: cambiar_asignacion (primero sin confirmado, para mostrar el antes y el después).",
    ],
  };
}

/** Lo que manda Claude, pasado al pedido de asignacion-del-negocio.ts. Lo que no sirve, error. */
function aPedido(args: Argumentos): PedidoDeCambioDeAsignacion {
  const pedido: PedidoDeCambioDeAsignacion = {};

  if (args.interruptores !== undefined) {
    if (!args.interruptores || typeof args.interruptores !== "object" || Array.isArray(args.interruptores)) {
      throw new Error("interruptores tiene que ser un objeto, por ejemplo {\"como_antes\": false}. No se guardó nada.");
    }
    const crudo = args.interruptores as Record<string, unknown>;
    const interruptores: Partial<ConfigDeAsignacion> = {};
    for (const [nombre, valor] of Object.entries(crudo)) {
      const interruptor = INTERRUPTORES.find((i) => i.mcp === nombre);
      if (!interruptor) {
        throw new Error(`No existe el interruptor «${nombre}» (son: ${INTERRUPTORES.map((i) => i.mcp).join(", ")}). No se guardó nada.`);
      }
      if (typeof valor !== "boolean") throw new Error(`El interruptor «${nombre}» tiene que ser true o false. No se guardó nada.`);
      interruptores[interruptor.clave] = valor;
    }
    pedido.interruptores = interruptores;
  }

  if (args.lineas !== undefined) {
    if (!Array.isArray(args.lineas)) throw new Error("lineas tiene que ser una lista. No se guardó nada.");
    const vistas = new Set<string>();
    pedido.lineas = args.lineas.map((linea) => {
      const l = (linea ?? {}) as Record<string, unknown>;
      if (typeof l.linea_id !== "string" || !l.linea_id.trim()) throw new Error("Cada línea necesita su linea_id. No se guardó nada.");
      if (vistas.has(l.linea_id)) throw new Error(`La línea ${l.linea_id} viene dos veces. No se guardó nada.`);
      vistas.add(l.linea_id);
      if (!Array.isArray(l.fuera)) throw new Error(`La línea ${l.linea_id}: «fuera» tiene que ser una lista de ids. No se guardó nada.`);
      return { id: l.linea_id, fuera: l.fuera };
    });
  }

  const minutos = (valor: unknown, nombre: string) => {
    if (valor === undefined) return undefined;
    if (typeof valor !== "number" || !Number.isInteger(valor) || valor < MINUTOS_MINIMOS || valor > MINUTOS_MAXIMOS) {
      throw new Error(`${nombre} tiene que ser un número entero de ${MINUTOS_MINIMOS} a ${MINUTOS_MAXIMOS}. No se guardó nada.`);
    }
    return valor;
  };
  pedido.minutosAviso = minutos(args.minutos_avisar, "minutos_avisar");
  pedido.minutosReasignar = minutos(args.minutos_pasar_a_otra, "minutos_pasar_a_otra");
  return pedido;
}

/** La foto en palabras: los nombres de las asesoras en vez de los ids. */
function fotoEnPalabras(foto: FotoDeAsignacion, nombres: Map<string, string>) {
  return {
    cuando_se_asigna: cuandoSeAsigna(foto.interruptores),
    interruptores: interruptoresParaMcp(foto.interruptores),
    lineas: foto.lineas.map((linea) => ({
      linea_id: linea.id,
      nombre: linea.nombre,
      fuera_del_reparto: linea.pausados.map((id) => nombres.get(id) ?? id),
    })),
    minutos_avisar: foto.minutosAviso,
    minutos_pasar_a_otra: foto.minutosReasignar,
  };
}

/** Qué cambia, en una línea (el título en listar_cambios). */
function resumenDelCambio(antes: FotoDeAsignacion, despues: FotoDeAsignacion) {
  const partes: string[] = [];
  if (cuandoSeAsigna(antes.interruptores) !== cuandoSeAsigna(despues.interruptores)) partes.push("cuándo se asigna");
  if (despues.lineas.length) partes.push(`reparto de ${despues.lineas.map((l) => l.nombre).join(", ")}`);
  if (antes.minutosAviso !== despues.minutosAviso || antes.minutosReasignar !== despues.minutosReasignar) {
    partes.push(`minutos ${antes.minutosAviso}/${antes.minutosReasignar} → ${despues.minutosAviso}/${despues.minutosReasignar}`);
  }
  return `Asignación de chats: ${partes.join("; ") || "interruptores"}`;
}

async function cambiar(args: Argumentos, contexto: Contexto) {
  const quien = await quienPuedeCambiar(contexto);
  const pedido = aPedido(args);
  const calculado = await calcularCambioDeAsignacion(contexto.workspaceId, pedido, { estricto: true });
  if ("error" in calculado) throw new Error(`${calculado.error} No se guardó nada.`);
  const { cambio } = calculado;
  if (!cambio.cambiaAlgo) throw new Error("Ya está así: no hay nada que cambiar. No se guardó nada.");

  const datos = await leerAsignacionDelNegocio(contexto.workspaceId);
  const nombres = new Map(datos.lineas.flatMap((linea) => linea.asesoras.map((a) => [a.id, a.nombre] as const)));
  const vista = {
    antes: fotoEnPalabras(cambio.antes, nombres),
    despues: fotoEnPalabras(cambio.despues, nombres),
  };

  if (args.confirmado !== true) {
    return {
      guardado: false,
      ...vista,
      para_guardar:
        "Léele a la persona el antes y el después. Si dice que sí («sí, apruebo»), llama otra vez con lo mismo, " +
        "confirmado=true y texto_confirmacion = lo que dijo, tal cual.",
    };
  }

  const veredicto = textoDeConfirmacionValido(args.texto_confirmacion);
  if (veredicto) throw new Error(`No se guardó nada: ${veredicto}`);

  await escribirCambioDeAsignacion(contexto.workspaceId, cambio, { id: contexto.userId, nombre: `${quien} (por Claude)` });
  const anotado = await anotarCambioMcp(contexto.workspaceId, {
    titulo: resumenDelCambio(cambio.antes, cambio.despues),
    tabla: "Asignacion",
    filaId: contexto.workspaceId,
    accion: "editar",
    antes: cambio.antes as unknown as Record<string, unknown>,
    despues: cambio.despues as unknown as Record<string, unknown>,
  });
  return {
    guardado: true,
    cambio_id: anotado.id,
    ...vista,
    aviso: `${AVISO_UN_MINUTO} Los chats que ya tienen asesora no cambian.`,
    para_deshacer: `deshacer_cambio con cambio_id=${anotado.id} lo deja como estaba.`,
  };
}

export async function ejecutarHerramientaMcpAsignacion(nombre: string, args: Argumentos, contexto: Contexto) {
  switch (nombre) {
    case "ver_asignacion":
      return ver(contexto);
    case "cambiar_asignacion":
      return cambiar(args, contexto);
    default:
      throw new Error(`No existe la herramienta "${nombre}".`);
  }
}
