import {
  ETIQUETA_DE_AREA,
  diaAnterior,
  esArea,
  fechaValida,
  hoyEnBogota,
  leerPedidoDeEnvio,
  leerResumenAGuardar,
  type Area,
} from "@/features/agentes-de-area/dominio/reglas";
import { agenteActivo } from "@/features/agentes-de-area/servicios/config";
import { mandarWhatsAppAlEquipo } from "@/features/agentes-de-area/servicios/envios";
import { numerosDeMarketing } from "@/features/agentes-de-area/servicios/numeros-de-marketing";
import { avisosDelSupervisor, medirLosSugeridosDe, numerosDelDia } from "@/features/agentes-de-area/servicios/numeros";
import {
  guardarResumenDelDia,
  leerEnviosDelDia,
  leerResumenDelDia,
  leerUltimosResumenes,
} from "@/features/agentes-de-area/servicios/resumenes";
import { puedeVerElSupervisor } from "@/lib/mcp/supervisor";

/*
  EL AGENTE DE VENTAS DESDE EL MCP.

  El agente piensa en aizen1 (Claude Code); el CRM solo da los datos, guarda el resumen, entrega los
  WhatsApp INTERNOS y los muestra en la pantalla. Cuatro herramientas:
    - numeros_de_ventas (lee)       → los números de un día por asesora y los sugeridos de ayer.
    - guardar_resumen_del_dia (escribe) → un resumen por día (se reemplaza si se guarda dos veces).
    - mandar_whatsapp_al_equipo (escribe) → SOLO a números del equipo, por la línea Admin, con el
      interruptor prendido y una vez por persona y por día. Todo se valida en el servidor.
    - agente_de_ventas (lee)        → el estado, el resumen de hoy, los mensajes y los últimos días.

  El Agente de Marketing (segunda área, mismo molde) agrega dos más:
    - numeros_de_marketing (lee)   → conversaciones por anuncio de origen: Tibio/Caliente, ventas, sin respuesta.
    - agente_de_marketing (lee)    → el estado, el resumen de hoy, su línea y su recomendación.
  Su resumen se guarda con guardar_resumen_del_dia (area = "marketing"). Marketing NO manda WhatsApp: su línea
  va dentro del mensaje de las 7:30 que arma Ventas. Solo LEE Meta Ads (eso lo traba aizen1, no el CRM).

  Nunca le escribe a un cliente. No toca el bot, el libro V3, los flujos ni Meta Ads.
*/

type Contexto = { workspaceId: string; userId: string };
type Argumentos = Record<string, unknown>;

const AREA: Area = "ventas";

const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const ESCRITURA = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export const HERRAMIENTAS_MCP_AGENTES_DE_AREA = [
  {
    name: "numeros_de_ventas",
    title: "Números de ventas del día",
    description:
      "Los números de UN día (por defecto ayer, hora de Colombia) POR ASESORA: chats atendidos, chats que llegaron a cotización o cierre, ventas, tasa de cierre y tiempo de respuesta (mediana en minutos), más los avisos que detectó el Supervisor ese día. También MIDE los sugeridos del último resumen guardado: a cuáles les escribió el equipo, cuáles respondieron y cuáles compraron. Así el agente no abre los chats uno por uno. Las ventas, abonos y saldos de dinero NO salen de aquí: se leen en el MCP de Gestión. Solo lectura.",
    inputSchema: {
      type: "object",
      properties: {
        fecha: { type: "string", description: "AAAA-MM-DD (hora de Colombia). Por defecto, ayer." },
        sugeridos_de: { type: "string", description: "AAAA-MM-DD del resumen cuyos sugeridos se miden. Por defecto, el último resumen anterior a hoy que tenga sugeridos." },
      },
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
  {
    name: "guardar_resumen_del_dia",
    title: "Guardar el resumen del día del Agente de Ventas",
    description:
      "Guarda el resumen del día: números de ayer, meta de hoy, lo que entregó cada subagente (objeto con una clave por subagente: cerrador, cobrador, analista-de-perdidos), los clientes sugeridos a cada asesora (para medirlos mañana: asesora, conversacionId, numero, cliente), los mensajes que quedan listos para mandar y si la corrida salió tarde. Si ya hay un resumen de ese día, se REEMPLAZA. No manda ningún mensaje. Con es_prueba=true queda marcado como corrida de prueba. Con area=\"marketing\" guarda el resumen del Agente de Marketing: la tabla por campaña y anuncio va en numeros, y se agregan linea (UNA línea para Alexander) y recomendacion (máximo UNA: subir, bajar o cambiar un anuncio, con el dato que la sustenta; nunca pausar para que reaprenda).",
    inputSchema: {
      type: "object",
      properties: {
        area: { type: "string", enum: ["ventas", "marketing"], description: "Por defecto, ventas." },
        linea: { type: "string", description: "Solo marketing: UNA línea de marketing para el mensaje de las 7:30." },
        recomendacion: {
          type: "object",
          description: "Solo marketing: máximo UNA recomendación concreta.",
          properties: {
            accion: { type: "string", enum: ["subir", "bajar", "cambiar"] },
            texto: { type: "string" },
            dato: { type: "string", description: "El dato que sustenta la recomendación." },
          },
          required: ["accion", "texto", "dato"],
        },
        fecha: { type: "string", description: "AAAA-MM-DD (hora de Colombia). Por defecto, hoy." },
        es_prueba: { type: "boolean", description: "true = corrida de prueba." },
        salio_tarde: { type: "boolean", description: "true si la corrida arrancó después de las 7:00 a. m." },
        nota_de_retraso: { type: "string", description: "Ej. 'aizen1 prendió a las 8:12'." },
        numeros: { description: "Números de ayer por asesora y totales (objeto libre)." },
        meta: { description: "Meta de hoy (objeto libre)." },
        subagentes: { type: "object", description: "Lo que entregó cada subagente, una clave por subagente." },
        sugeridos: {
          type: "array",
          description: "Clientes sugeridos a cada asesora.",
          items: {
            type: "object",
            properties: {
              asesora: { type: "string" },
              conversacionId: { type: "string" },
              numero: { type: "string" },
              cliente: { type: "string" },
            },
            required: ["asesora"],
          },
        },
        mensajes: {
          type: "array",
          description: "Los WhatsApp internos que quedan listos: uno a Alexander y uno por asesora.",
          items: {
            type: "object",
            properties: {
              tipo: { type: "string", enum: ["alexander", "asesora"] },
              numero: { type: "string" },
              destinatario: { type: "string" },
              texto: { type: "string" },
            },
            required: ["tipo", "numero", "texto"],
          },
        },
        resumen: { type: "string", description: "Texto del resumen para leer en la pantalla." },
      },
      additionalProperties: false,
    },
    annotations: ESCRITURA,
  },
  {
    name: "mandar_whatsapp_al_equipo",
    title: "Mandar un WhatsApp interno al equipo",
    description:
      "Manda UN WhatsApp interno desde la línea Admin, SOLO a un número de la lista del equipo (Mi empresa → Equipo). El servidor lo valida: un número que no es del equipo se rechaza ('ese número no es del equipo'), con el interruptor del Agente de Ventas apagado no sale nada ('interruptor apagado: no se mandó') y a cada persona le sale un solo mensaje por día ('ya se le mandó hoy'). Nunca a clientes. Cada intento queda anotado en la pantalla Agente de Ventas.",
    inputSchema: {
      type: "object",
      properties: {
        tipo: { type: "string", enum: ["alexander", "asesora"], description: "A quién va: Alexander (7:30) o una asesora (su lista del día)." },
        numero: { type: "string", description: "Número de WhatsApp con indicativo (solo dígitos)." },
        texto: { type: "string", description: "El mensaje, completo." },
        destinatario: { type: "string", description: "Nombre de la persona (solo para la pantalla)." },
      },
      required: ["tipo", "numero", "texto"],
      additionalProperties: false,
    },
    annotations: ESCRITURA,
  },
  {
    name: "numeros_de_marketing",
    title: "Números de marketing por anuncio",
    description:
      "Las conversaciones NUEVAS por ANUNCIO de origen de UN día (por defecto ayer, hora de Colombia) o de los últimos 7 días (dias=7): cuántas llegaron, cuántas quedaron en Tibio/Caliente (temperatura del sistema y etapa de la asesora), cuántas son venta (GANADO, con su cotización de Gestión), cuántas NO tuvieron respuesta y en cuánto se respondió la primera vez, y cuántas son de fuera de Colombia. Con un solo día trae además los primeros mensajes cortos de cada cliente (precio, ciudad, envío) para separar clientes reales de curiosos. Dice cuántas conversaciones NO tienen anuncio de origen y el porcentaje. El CRM guarda el anuncio, no la campaña: la campaña se une leyendo Meta. El gasto sale de Meta, no de aquí. Solo lectura.",
    inputSchema: {
      type: "object",
      properties: {
        fecha: { type: "string", description: "AAAA-MM-DD (hora de Colombia): último día del rango. Por defecto, ayer." },
        dias: { type: "number", enum: [1, 7], description: "1 = solo ese día (con primeros mensajes); 7 = los últimos 7 días. Por defecto, 1." },
      },
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
  {
    name: "agente_de_marketing",
    title: "Ver el Agente de Marketing",
    description:
      "Para leer en voz alta: si el interruptor del Agente de Marketing está prendido o apagado, el resumen de hoy (o de la fecha pedida) con su línea para Alexander y su recomendación, la tabla por campaña y anuncio, lo que entregó cada subagente y los últimos días. El Agente de Ventas lo lee para saber qué campañas traen clientes calientes. Solo lectura.",
    inputSchema: {
      type: "object",
      properties: { fecha: { type: "string", description: "AAAA-MM-DD (hora de Colombia). Por defecto, hoy." } },
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
  {
    name: "agente_de_ventas",
    title: "Ver el Agente de Ventas",
    description:
      "Para leer en voz alta: si el interruptor del Agente de Ventas está prendido o apagado, el resumen de hoy (o de la fecha pedida), lo que entregó cada subagente, qué mensajes salieron o se bloquearon (con el motivo) y los últimos días. Solo lectura.",
    inputSchema: {
      type: "object",
      properties: { fecha: { type: "string", description: "AAAA-MM-DD (hora de Colombia). Por defecto, hoy." } },
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
] as const;

const NOMBRES = new Set<string>(HERRAMIENTAS_MCP_AGENTES_DE_AREA.map((herramienta) => herramienta.name));

export function esHerramientaDeAgentesDeArea(nombre: string) {
  return NOMBRES.has(nombre);
}

async function exigirPermiso(contexto: Contexto) {
  if (!(await puedeVerElSupervisor(contexto))) {
    throw new Error("Esta clave no tiene permiso para los agentes de área: es solo del dueño, los administradores y la supervisora.");
  }
}

function leerFecha(args: Argumentos, clave: string, porDefecto: string): string {
  const valor = args[clave];
  if (valor === undefined || valor === null || valor === "") return porDefecto;
  if (!fechaValida(valor)) throw new Error(`La fecha "${clave}" tiene que ir como AAAA-MM-DD.`);
  return valor;
}

async function verNumeros(args: Argumentos, contexto: Contexto) {
  await exigirPermiso(contexto);
  const hoy = hoyEnBogota();
  const fecha = leerFecha(args, "fecha", diaAnterior(hoy));
  const noSePudoLeer: string[] = [];
  const intentar = async <T>(nombre: string, leer: () => Promise<T>, vacio: T): Promise<T> => {
    try {
      return await leer();
    } catch (error) {
      noSePudoLeer.push(`${nombre}: ${error instanceof Error ? error.message : String(error)}`);
      return vacio;
    }
  };
  const porAsesora = await intentar("números por asesora", () => numerosDelDia(contexto.workspaceId, fecha), []);
  const supervisor = await intentar("avisos del Supervisor", () => avisosDelSupervisor(contexto.workspaceId, fecha), null);
  const sugeridosDe = args.sugeridos_de !== undefined && args.sugeridos_de !== "" ? leerFecha(args, "sugeridos_de", hoy) : null;
  const sugeridos = await intentar(
    "sugeridos de ayer",
    async () => {
      if (sugeridosDe) return medirLosSugeridosDe(contexto.workspaceId, AREA, sugeridosDe);
      let dia = diaAnterior(hoy);
      for (let i = 0; i < 7; i += 1) {
        const medida = await medirLosSugeridosDe(contexto.workspaceId, AREA, dia);
        if (medida) return medida;
        dia = diaAnterior(dia);
      }
      return null;
    },
    null,
  );
  const total = porAsesora.reduce(
    (suma, fila) => ({ chatsAtendidos: suma.chatsAtendidos + fila.chatsAtendidos, cotizaciones: suma.cotizaciones + fila.cotizaciones, ventas: suma.ventas + fila.ventas }),
    { chatsAtendidos: 0, cotizaciones: 0, ventas: 0 },
  );
  return {
    fecha,
    por_asesora: porAsesora,
    total,
    avisos_del_supervisor: supervisor,
    sugeridos_medidos: sugeridos,
    advertencias: [
      "Las ventas aquí son cambios de etapa a GANADO en el CRM; el dinero (ventas, abonos, saldos) se lee en el MCP de Gestión.",
      "Chats atendidos = chats con al menos un mensaje saliente humano ese día, por la asesora a la que están asignados HOY.",
    ],
    ...(noSePudoLeer.length ? { no_se_pudo_leer: noSePudoLeer } : {}),
  };
}

async function guardarResumen(args: Argumentos, contexto: Contexto) {
  await exigirPermiso(contexto);
  const pedida = args.area === undefined || args.area === null || args.area === "" ? AREA : args.area;
  if (!esArea(pedida)) throw new Error('El área tiene que ser "ventas" o "marketing".');
  const area: Area = pedida;
  const resumen = leerResumenAGuardar(args, hoyEnBogota(), area);
  const guardado = await guardarResumenDelDia(contexto.workspaceId, area, resumen);
  return {
    area,
    guardado: true,
    fecha: resumen.fecha,
    id: guardado.id,
    es_prueba: resumen.esPrueba,
    subagentes: Object.keys(resumen.subagentes),
    sugeridos: resumen.sugeridos.length,
    mensajes_listos: resumen.mensajes.length,
    nota: "No se mandó ningún mensaje: para mandar usar mandar_whatsapp_al_equipo.",
  };
}

async function mandarAlEquipo(args: Argumentos, contexto: Contexto) {
  await exigirPermiso(contexto);
  const leido = leerPedidoDeEnvio(args);
  if (!leido.ok) throw new Error(leido.error);
  const resultado = await mandarWhatsAppAlEquipo({ workspaceId: contexto.workspaceId, area: AREA, pedido: leido.pedido });
  return {
    se_mando: resultado.ok,
    estado: resultado.estado,
    ...(resultado.motivo ? { motivo: resultado.motivo } : {}),
    mensaje: resultado.ok ? "Mensaje enviado." : resultado.motivo,
  };
}

async function verNumerosDeMarketing(args: Argumentos, contexto: Contexto) {
  await exigirPermiso(contexto);
  const fecha = leerFecha(args, "fecha", diaAnterior(hoyEnBogota()));
  const dias = args.dias === 7 || args.dias === "7" ? 7 : 1;
  return numerosDeMarketing(contexto.workspaceId, fecha, dias);
}

/** La línea para Alexander y la recomendación viajan dentro de `meta` del resumen de marketing. */
function lineaYRecomendacion(meta: unknown) {
  const datos = meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};
  return { linea_para_alexander: datos.linea ?? null, recomendacion: datos.recomendacion ?? null };
}

async function verAgente(args: Argumentos, contexto: Contexto, area: Area = "ventas") {
  await exigirPermiso(contexto);
  const ws = contexto.workspaceId;
  const fecha = leerFecha(args, "fecha", hoyEnBogota());
  const [activo, resumen, envios, ultimos] = await Promise.all([
    agenteActivo(area, ws),
    leerResumenDelDia(ws, area, fecha),
    leerEnviosDelDia(ws, area, fecha),
    leerUltimosResumenes(ws, area, 14),
  ]);
  return {
    agente: ETIQUETA_DE_AREA[area],
    interruptor: activo ? "prendido" : "apagado",
    fecha,
    resumen_del_dia: resumen
      ? {
          es_prueba: resumen.esPrueba,
          salio_tarde: resumen.salioTarde,
          nota_de_retraso: resumen.notaDeRetraso,
          resumen: resumen.resumen,
          numeros: resumen.numeros,
          meta: resumen.meta,
          ...(area === "marketing" ? lineaYRecomendacion(resumen.meta) : {}),
          subagentes: resumen.subagentes,
          sugeridos: resumen.sugeridos,
          guardado_en: resumen.actualizadoEn,
        }
      : null,
    mensajes: envios.map((envio) => ({
      tipo: envio.tipo,
      destinatario: envio.destinatario,
      estado: envio.estado,
      motivo: envio.motivo,
      texto: envio.texto,
      en: envio.creadoEn,
    })),
    ultimos_dias: ultimos.map((dia) => ({ fecha: dia.fecha, es_prueba: dia.esPrueba, salio_tarde: dia.salioTarde, resumen: dia.resumen })),
    advertencias:
      area === "marketing"
        ? [
            "El Agente de Marketing corre en aizen1 y solo LEE Meta Ads: no pausa, prende, edita ni crea nada.",
            "Si falta el anuncio de origen en muchos chats, el costo por venta sale incompleto.",
            ...(activo ? [] : ["Con el interruptor apagado el agente genera el resumen, pero su línea NO va en el mensaje de las 7:30."]),
          ]
        : [
            "El Agente de Ventas corre en aizen1: si aizen1 está apagado, no hay resumen.",
            ...(activo ? [] : ["Con el interruptor apagado el agente genera el resumen pero el servidor no deja salir ningún WhatsApp."]),
          ],
  };
}

export async function ejecutarHerramientaMcpAgentesDeArea(nombre: string, argumentos: Argumentos, contexto: Contexto): Promise<unknown> {
  switch (nombre) {
    case "numeros_de_ventas":
      return verNumeros(argumentos, contexto);
    case "guardar_resumen_del_dia":
      return guardarResumen(argumentos, contexto);
    case "mandar_whatsapp_al_equipo":
      return mandarAlEquipo(argumentos, contexto);
    case "numeros_de_marketing":
      return verNumerosDeMarketing(argumentos, contexto);
    case "agente_de_marketing":
      return verAgente(argumentos, contexto, "marketing");
    case "agente_de_ventas":
      return verAgente(argumentos, contexto);
    default:
      throw new Error(`No existe la herramienta "${nombre}".`);
  }
}
