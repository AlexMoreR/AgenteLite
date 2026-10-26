import {
  AREA_MARKETING,
  AREA_VENTAS,
  AREAS_QUE_MANDAN,
  areaValida,
  lineaDeMarketingParaAlexander,
  fechaBogota,
  fechaValida,
  type TipoDeEnvio,
} from "@/features/agentes-de-area/dominio/reglas";
import { agenteActivo } from "@/features/agentes-de-area/servicios/config";
import { numerosDeMarketing } from "@/features/agentes-de-area/servicios/numeros-de-marketing";
import { mandarAlEquipo } from "@/features/agentes-de-area/servicios/envios";
import { medirSugeridosDeAyer, numerosDeVentas } from "@/features/agentes-de-area/servicios/numeros";
import { guardarResumenDelDia, leerEnviosDelDia, leerResumenesRecientes } from "@/features/agentes-de-area/servicios/resumenes";
import { puedeVerElSupervisor } from "@/lib/mcp/supervisor";

/*
  EL AGENTE DE VENTAS DESDE EL MCP (molde de "agentes de área").

  El agente corre en aizen1 (Claude Code) y el CRM NO piensa: solo da los datos, guarda el resumen y entrega
  los WhatsApp internos que el agente pide. Cuatro herramientas:
    - numeros_de_ventas (lee): los números de un día por asesora y cómo les fue a los sugeridos de ayer.
    - guardar_resumen_del_dia (escribe): el resumen del día y lo que entregó cada subagente.
    - mandar_whatsapp_al_equipo (escribe): un WhatsApp interno, SOLO a la lista del equipo, por la línea Admin.
    - agente_de_ventas (lee): para que Claude lo lea en voz alta.

  Reglas que NO dependen del agente (las pone el servidor, ver servicios/envios.ts): nunca a un cliente,
  nunca por una línea de ventas, nada si el interruptor está apagado y un solo mensaje por persona y por día.
  Las pueden usar las mismas personas que ven el Supervisor: dueño, administradores y supervisora.
*/

type Contexto = { workspaceId: string; userId: string };
type Argumentos = Record<string, unknown>;

const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const ESCRIBE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export const HERRAMIENTAS_MCP_AGENTES_DE_AREA = [
  {
    name: "numeros_de_ventas",
    title: "Números de ventas de un día",
    description:
      "Los números de un día POR ASESORA, ya calculados: chats atendidos (una persona escribió), chats con cliente, chats que llegaron a cotización o cierre, ventas, cierre y tiempo de respuesta (mediana, en minutos; el bot no cuenta). Trae también cómo les fue a los SUGERIDOS del día anterior (a cuáles les escribió la asesora, cuáles respondieron y cuáles compraron). Las ventas, abonos y saldos de dinero se leen del MCP de Gestión. Solo lectura.",
    inputSchema: {
      type: "object",
      properties: { fecha: { type: "string", description: "AAAA-MM-DD en hora de Colombia. Por defecto, AYER." } },
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
  {
    name: "guardar_resumen_del_dia",
    title: "Guardar el resumen del día del Agente de Ventas",
    description:
      "Guarda el resumen del día del Agente de Ventas: los números de ayer, la meta de hoy, lo que entregó CADA subagente por separado, los clientes sugeridos a cada asesora (para medirlos al día siguiente), el mensaje de las 7:30 para Alexander y si la corrida salió tarde. Si se guarda dos veces el mismo día se REEMPLAZA (no queda repetido). Si el interruptor está apagado, queda marcado como corrida de prueba. No manda ningún mensaje.",
    inputSchema: {
      type: "object",
      properties: {
        fecha: { type: "string", description: "AAAA-MM-DD del día que se corre (hoy, hora de Colombia). Por defecto, hoy." },
        numeros: { description: "Números de ayer por asesora y total (objeto libre; lo muestra la pantalla)." },
        meta: { description: "La meta de hoy (objeto libre)." },
        subagentes: {
          type: "object",
          description: "Lo que entregó cada subagente por su nombre: { cerrador: ..., cobrador: ..., 'analista-de-perdidos': ... }.",
        },
        sugeridos: {
          type: "array",
          description: "Cada cliente sugerido a una asesora, para medirlo mañana.",
          items: {
            type: "object",
            properties: {
              asesora_id: { type: "string" },
              asesora: { type: "string" },
              conversacion_id: { type: "string" },
              telefono: { type: "string" },
              cliente: { type: "string" },
            },
            required: ["asesora", "conversacion_id"],
          },
        },
        area: { type: "string", description: "'ventas' (por defecto) o 'marketing'. Marketing guarda su línea y su recomendación en 'meta' ({ linea, recomendaciones: [{ accion, anuncio, texto, dato }] }, máximo 1)." },
        texto_alexander: { type: "string", description: "El mensaje de las 7:30 para Alexander (para mostrarlo en la pantalla)." },
        salio_tarde: { type: "boolean", description: "true si la corrida salió después de las 7:30." },
        nota_tarde: { type: "string", description: "Por ejemplo: 'aizen1 prendió a las 07:42'." },
      },
      additionalProperties: false,
    },
    annotations: ESCRIBE,
  },
  {
    name: "numeros_de_marketing",
    title: "Números de marketing por anuncio",
    description:
      "Para el Agente de Marketing. Por anuncio de origen: conversaciones nuevas, cuántas llegaron a Tibio o Caliente (etapa de la asesora y temperatura del sistema), ventas (GANADO, con su cotización de Gestión), chats sin respuesta y mediana de la primera respuesta. Con dias=1 trae también los primeros mensajes cortos del cliente de cada conversación. Dice cuántas conversaciones NO tienen anuncio de origen (y su porcentaje). El CRM guarda el anuncio, no la campaña: la campaña se une leyendo Meta. Solo lectura.",
    inputSchema: {
      type: "object",
      properties: {
        fecha: { type: "string", description: "AAAA-MM-DD (el último día incluido, hora de Colombia). Por defecto, AYER." },
        dias: { type: "number", description: "1 = solo ese día (por defecto); 7 = ese día y los 6 anteriores (máximo 30)." },
      },
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
  {
    name: "agente_de_marketing",
    title: "Ver el Agente de Marketing",
    description:
      "Para leer en voz alta: si el interruptor del Agente de Marketing está prendido o apagado, el resumen de hoy (o del día pedido) con su línea y su recomendación, lo que entregó cada subagente y los últimos días. Solo lectura.",
    inputSchema: {
      type: "object",
      properties: {
        fecha: { type: "string", description: "AAAA-MM-DD. Por defecto, el último resumen guardado." },
        dias: { type: "number", description: "Cuántos días de historial (1 a 30, por defecto 7)." },
      },
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
  {
    name: "mandar_whatsapp_al_equipo",
    title: "Mandar un WhatsApp interno al equipo",
    description:
      "Manda UN WhatsApp interno desde la línea Admin, solo a un número de la lista del equipo (Mi empresa → Equipo). El servidor rechaza cualquier otro número (un cliente NO puede recibirlo nunca), no manda nada si el interruptor del Agente de Ventas está apagado, y deja pasar un solo mensaje por persona y por día ('ya se le mandó hoy'). Cada intento queda anotado, también los rechazados.",
    inputSchema: {
      type: "object",
      properties: {
        numero: { type: "string", description: "Número completo con indicativo, de la lista del equipo." },
        texto: { type: "string", description: "El mensaje." },
        nombre: { type: "string", description: "A quién es (para la pantalla). Opcional." },
        area: { type: "string", description: "Por defecto 'ventas'." },
      },
      required: ["numero", "texto"],
      additionalProperties: false,
    },
    annotations: ESCRIBE,
  },
  {
    name: "agente_de_ventas",
    title: "Ver el Agente de Ventas",
    description:
      "Para leer en voz alta: si el interruptor del Agente de Ventas está prendido o apagado, el resumen de hoy (o del día pedido), lo que entregó cada subagente, qué mensajes salieron o se bloquearon (y por qué) y los últimos días. Solo lectura.",
    inputSchema: {
      type: "object",
      properties: {
        fecha: { type: "string", description: "AAAA-MM-DD. Por defecto, el último resumen guardado." },
        dias: { type: "number", description: "Cuántos días de historial (1 a 30, por defecto 7)." },
      },
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
] as const;

const NOMBRES = new Set<string>(HERRAMIENTAS_MCP_AGENTES_DE_AREA.map((h) => h.name));

export function esHerramientaDeAgentesDeArea(nombre: string) {
  return NOMBRES.has(nombre);
}

function fechaPedida(args: Argumentos, porDefecto: string): string {
  const pedida = typeof args.fecha === "string" ? args.fecha.trim() : "";
  if (!pedida) return porDefecto;
  if (!fechaValida(pedida)) throw new Error("La fecha va como AAAA-MM-DD, por ejemplo 2026-10-22.");
  return pedida;
}

function areaPedida(args: Argumentos): string {
  const area = typeof args.area === "string" && args.area.trim() ? args.area.trim() : AREA_VENTAS;
  if (!areaValida(area)) throw new Error(`Esa área no existe. Las que hay: ${AREA_VENTAS}, ${AREA_MARKETING}.`);
  return area;
}

/** Solo Ventas manda WhatsApp: la línea de Marketing viaja dentro del mensaje de las 7:30 de Ventas. */
function areaQueManda(args: Argumentos): string {
  const area = areaPedida(args);
  if (!(AREAS_QUE_MANDAN as readonly string[]).includes(area)) {
    throw new Error("El Agente de Marketing no manda WhatsApp: su línea va dentro del mensaje de las 7:30 del Agente de Ventas.");
  }
  return area;
}

const AYER = () => fechaBogota(new Date(Date.now() - 24 * 3_600_000));

async function verNumeros(args: Argumentos, contexto: Contexto) {
  const fecha = fechaPedida(args, AYER());
  const [numeros, sugeridos] = await Promise.all([
    numerosDeVentas(contexto.workspaceId, fecha),
    medirSugeridosDeAyer(contexto.workspaceId, AREA_VENTAS, fecha).catch(() => null),
  ]);
  return { ...numeros, sugeridos_de_ayer: sugeridos };
}

async function verNumerosDeMarketing(args: Argumentos, contexto: Contexto) {
  const fecha = fechaPedida(args, AYER());
  const dias = Math.min(30, Math.max(1, Math.round(Number(args.dias)) || 1));
  return numerosDeMarketing(contexto.workspaceId, fecha, dias);
}

async function guardarResumen(args: Argumentos, contexto: Contexto) {
  const guardado = await guardarResumenDelDia({ workspaceId: contexto.workspaceId, area: areaPedida(args), args, hoy: fechaBogota(new Date()) });
  return {
    ...guardado,
    mensaje: guardado.esPrueba
      ? "Guardado como corrida de PRUEBA (el interruptor está apagado: no se manda ningún mensaje)."
      : "Guardado.",
  };
}

async function mandar(args: Argumentos, contexto: Contexto) {
  const area = areaQueManda(args);
  const resultado = await mandarAlEquipo({
    workspaceId: contexto.workspaceId,
    area,
    numero: args.numero,
    texto: args.texto,
    nombre: typeof args.nombre === "string" ? args.nombre : null,
  });
  return {
    enviado: resultado.enviado,
    estado: resultado.estado,
    ...(resultado.motivo ? { motivo: resultado.motivo } : {}),
    tipo: (resultado.tipo as TipoDeEnvio | null) ?? null,
  };
}

async function verAgenteDeMarketing(args: Argumentos, contexto: Contexto) {
  const dias = Math.min(30, Math.max(1, Math.round(Number(args.dias)) || 7));
  const [activo, recientes] = await Promise.all([
    agenteActivo(contexto.workspaceId, AREA_MARKETING),
    leerResumenesRecientes(contexto.workspaceId, AREA_MARKETING, dias),
  ]);
  const pedida = typeof args.fecha === "string" && args.fecha.trim() ? fechaPedida(args, "") : null;
  const dia = pedida ? recientes.find((r) => r.fecha === pedida) ?? null : (recientes[0] ?? null);
  const meta = dia?.meta && typeof dia.meta === "object" && !Array.isArray(dia.meta) ? (dia.meta as Record<string, unknown>) : null;
  return {
    interruptor: activo
      ? "PRENDIDO: su línea va en el mensaje de las 7:30 de Alexander"
      : "APAGADO: el agente genera y guarda su resumen, pero su línea NO va en el mensaje de las 7:30",
    dia: dia
      ? {
          fecha: dia.fecha,
          corrida_de_prueba: dia.esPrueba,
          salio_tarde: dia.salioTarde,
          nota_tarde: dia.notaTarde,
          tabla_por_campana_y_anuncio: dia.numeros,
          linea: meta?.linea ?? null,
          recomendacion: meta?.recomendacion ?? null,
          linea_para_alexander: lineaDeMarketingParaAlexander(meta),
          lo_que_entrego_cada_subagente: dia.subagentes,
        }
      : "Todavía no hay ningún resumen guardado.",
    ultimos_dias: recientes.map((r) => ({ fecha: r.fecha, prueba: r.esPrueba, salio_tarde: r.salioTarde })),
  };
}

async function verAgente(args: Argumentos, contexto: Contexto) {
  const dias = Math.min(30, Math.max(1, Math.round(Number(args.dias)) || 7));
  const [activo, recientes] = await Promise.all([
    agenteActivo(contexto.workspaceId, AREA_VENTAS),
    leerResumenesRecientes(contexto.workspaceId, AREA_VENTAS, dias),
  ]);
  const pedida = typeof args.fecha === "string" && args.fecha.trim() ? fechaPedida(args, "") : null;
  const dia = pedida ? recientes.find((r) => r.fecha === pedida) ?? null : (recientes[0] ?? null);
  const envios = dia ? await leerEnviosDelDia(contexto.workspaceId, AREA_VENTAS, dia.fecha) : [];
  return {
    interruptor: activo ? "PRENDIDO: el agente puede mandar sus mensajes" : "APAGADO: el agente solo genera el resumen, no manda nada",
    dia: dia
      ? {
          fecha: dia.fecha,
          corrida_de_prueba: dia.esPrueba,
          salio_tarde: dia.salioTarde,
          nota_tarde: dia.notaTarde,
          numeros: dia.numeros,
          meta: dia.meta,
          lo_que_entrego_cada_subagente: dia.subagentes,
          mensaje_para_alexander: dia.textoAlexander,
          clientes_sugeridos: Array.isArray(dia.sugeridos) ? dia.sugeridos.length : 0,
          mensajes: envios.map((e) => ({
            para: e.nombre ?? `…${e.numero.slice(-4)}`,
            tipo: e.tipo,
            estado: e.estado,
            motivo: e.motivo,
            texto: e.texto,
          })),
        }
      : "Todavía no hay ningún resumen guardado.",
    ultimos_dias: recientes.map((r) => ({ fecha: r.fecha, prueba: r.esPrueba, salio_tarde: r.salioTarde })),
  };
}

export async function ejecutarHerramientaMcpAgentesDeArea(nombre: string, argumentos: Argumentos, contexto: Contexto): Promise<unknown> {
  if (!(await puedeVerElSupervisor(contexto))) {
    throw new Error("Esta clave no puede ver el Agente de Ventas (solo dueño, administradores y supervisora).");
  }
  switch (nombre) {
    case "numeros_de_ventas":
      return verNumeros(argumentos, contexto);
    case "numeros_de_marketing":
      return verNumerosDeMarketing(argumentos, contexto);
    case "agente_de_marketing":
      return verAgenteDeMarketing(argumentos, contexto);
    case "guardar_resumen_del_dia":
      return guardarResumen(argumentos, contexto);
    case "mandar_whatsapp_al_equipo":
      return mandar(argumentos, contexto);
    case "agente_de_ventas":
      return verAgente(argumentos, contexto);
    default:
      throw new Error(`No existe la herramienta "${nombre}".`);
  }
}
