/**
 * EL MOTOR DE "SIGUIENTE ACCIÓN" DEL SEGUIMIENTO INTELIGENTE (código puro).
 *
 * Recibe la ficha de un lead (sus mensajes y su estado) y decide UNA cosa:
 *
 *   excluir_exterior   teléfono de fuera de Colombia (solo vendemos en Colombia)
 *   no_insistir        no leyó, no le interesa, ya se le mandó lo útil, etapa cerrada…
 *   esperar            todavía no toca nada (con la hora en que se vuelve a mirar)
 *   dormido            dijo una fecha futura de compra: nada hasta unos días antes
 *   mensaje_util_producto  un Frío que LEYÓ y no respondió: 1 mensaje del producto que preguntó
 *   tarea_asesora      Tibio, Caliente, cotización, fecha cercana o toque de la cadencia
 *   descartar          3 toques después de la asesora sin respuesta (con su interruptor)
 *
 * Es la MISMA función para el reloj en vivo, el webhook y la simulación con datos reales: lo que
 * se simula es lo que haría.
 *
 * Las reglas (pedido de Alexander, 10-10-2026):
 *  - NO LEYÓ nuestro último mensaje → no insistir. Si vuelve a leer o escribir, se reactiva.
 *    APAGADO el 11-10-2026 (Alexander): el que no lee sigue igual que todos. Vuelve con el
 *    interruptor `noLeido.activo` del anti-bloqueo (config.motor.respetarNoLeido).
 *  - LEYÓ y no respondió (FRÍO) → máximo 1 mensaje útil del producto que preguntó, 8–20 h.
 *  - TIBIO (pregunta concreta) → tarea para la asesora con el mensaje sugerido (prioridad B).
 *  - CALIENTE → una persona en < 15 min: tarea A y NINGÚN automático encima.
 *  - COTIZACIÓN → tarea humana a las 24 h y 72 h con el mensaje listo.
 *  - PEDIDO DE DATOS (formulario de la asesora) sin respuesta → tarea a las 2 h, 24 h y 72 h en
 *    horario laboral (11-10-2026, interruptor `formulario.activo`); después, lo de siempre.
 *  - FECHA FUTURA → dormido; tarea X días antes de la fecha.
 *  - Después de la asesora: toques en los días 3, 4 y 7; Frío = mensaje útil, resto = tarea. Tras
 *    el último sin respuesta (sin fecha futura ni cotización vigente) → descartar.
 *
 * DE QUIÉN ES EL TURNO (12-10-2026, Alexander) manda sobre todo lo anterior y es la misma definición
 * del Supervisor (lib/turno-del-chat.ts):
 *  - Turno de MAGILUS (el cliente escribió y nadie le contestó, el bot pasó el chat a una persona,
 *    o hubo intención fuerte sin ninguna persona después) → la tarea de siempre.
 *  - Turno del CLIENTE (el bot o la asesora contestó bien y quedó esperando su respuesta) → NINGUNA
 *    tarea humana: solo la cadencia automática (seguimientos del V3 y del embudo, mensaje útil a un
 *    Frío) durante `cadencia.horasTurnoDelCliente` (72 h) y después el descarte con su interruptor.
 *    Las reglas de formulario, cotización y toques de los días 3/4/7 ya no crean tareas en este caso.
 */

import { dentroDelHorario, esMensajeHumano, reprogramarFueraDeHorario } from "../../../lib/anti-bloqueo/reglas";
import { ORIGENES_AUTOMATICOS as ORIGENES_DEL_TURNO, turnoDelChat, type MensajeDelTurno, type TurnoDelChat } from "../../../lib/turno-del-chat";
import type { ConfigSeguimientoInteligente } from "./config";
import { detectarFechaFutura, type FechaFutura } from "./fecha-futura";
import { mencionaColombia, type Pais } from "./exterior";
import { mensajeDeFechaFutura, mensajePorSenales, type ContextoDelMensaje } from "./mensajes";
import { familiaDelTexto, mensajeUtilPara, nombreDeFamilia, type MensajeUtil } from "./producto";
import { calificar, type Calificacion, type Temperatura } from "./temperatura";

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

/** Los `rawPayload.source` de lo que sale solo (igual que lib/freno-de-automaticos). */
export const ORIGENES_AUTOMATICOS = ORIGENES_DEL_TURNO;

export type MensajeCrudo = {
  direccion: "IN" | "OUT";
  tipo: string;
  texto: string | null;
  en: Date;
  leidoEn: Date | null;
  estado?: string | null;
  /** rawPayload.source: manual / instance = persona; follow / agente-v3-seguimiento = automático. */
  origen: string | null;
  media?: string | null;
};

export type FichaDelLead = {
  conversationId: string;
  nombre: string | null;
  etapaCrm: string | null;
  pausado: boolean;
  asignadaA: string | null;
  pais: Pais;
  marcaExterior: boolean;
  inicioDeLaCharla: Date | null;
  /** Familia del producto activo del V3 o del producto de entrada (anuncio). */
  familiaDelBot: string | null;
  flujosEnviados: string[];
  cotizacion: { en: Date | null; ref: string | null; total: string | null };
  mensajesUtiles: number;
  /** Del más viejo al más nuevo, sin notas del sistema. */
  mensajes: MensajeCrudo[];
  /**
   * Las notas del bot que cuentan para el turno (lib/turno-del-chat.ts): "El agente pide un
   * asesor…" (pasó el chat a una persona) y "Agente V3: Ganó «Red…: no se entendió…»".
   */
  notasDelBot?: Array<{ en: Date; texto: string }>;
};

export type Accion =
  | "excluir_exterior"
  | "no_insistir"
  | "esperar"
  | "dormido"
  | "mensaje_util_producto"
  | "tarea_asesora"
  | "descartar";

export type Prioridad = "A" | "B" | "C";

/**
 * Qué pasa con los seguimientos genéricos de hoy (V3 "solo me falta el color", embudo 1 día…):
 *  - siempre: no salen (tarea humana, caliente, dormido, exterior, no insistir, cadencia…);
 *  - reemplazo: Frío que maneja el motor; no salen solo si la convivencia dice "reemplazar";
 *  - ninguna: salen como hoy.
 */
export type Supresion = "siempre" | "reemplazo" | "ninguna";

export type Decision = {
  accion: Accion;
  motivo: string;
  prioridad: Prioridad | null;
  mensajeSugerido: string | null;
  /** Para cuándo es la tarea. */
  vence: Date | null;
  /** Cuándo vuelve a mirarlo el reloj. */
  revisarEn: Date;
  /** Para el mensaje útil: cuándo puede salir (siguiente apertura si es de noche). */
  programarPara: Date | null;
  mensajeUtil: MensajeUtil | null;
  supresion: Supresion;
  dormidoHasta: Date | null;
  fechaCompra: FechaFutura | null;
  /** Toque de la cadencia (día) o escalón de la cotización (horas), si aplica. */
  toque: string | null;
  /** Para no registrar dos veces la misma decisión. */
  clave: string;
};

export type Evaluacion = {
  calificacion: Calificacion;
  familia: string | null;
  decision: Decision;
};

function esHumano(m: MensajeCrudo, inicio: Date | null): boolean {
  return m.direccion === "OUT" && esMensajeHumano({ createdAt: m.en, origen: m.origen }, inicio);
}

function textoDelCliente(m: MensajeCrudo): string {
  return (m.texto ?? "").trim();
}

const COTIZACION_ENVIADA =
  /(te|le) (env[ií]o|mando|comparto|adjunto) la cotizaci|aqu[ií] (te|le) env[ií]o la cotizaci|datos de cotizaci|\bCOT-\d+/i;

/** Una cotización enviada por la asesora (mismo criterio que el candado de descarte del CRM). */
export function cotizacionEnLosMensajes(mensajes: MensajeCrudo[], inicio: Date | null): { en: Date; ref: string | null; total: string | null } | null {
  let hallada: { en: Date; ref: string | null; total: string | null } | null = null;
  for (const m of mensajes) {
    if (!esHumano(m, inicio)) continue;
    const texto = m.texto ?? "";
    const esDocumento = m.tipo === "DOCUMENT" && /(^|[^a-z])cot([^a-z]|iz)|cotizaci|proforma/i.test(texto);
    if (!COTIZACION_ENVIADA.test(texto) && !esDocumento) continue;
    const previa = hallada as { ref: string | null; total: string | null } | null;
    hallada = {
      en: m.en,
      ref: /\bCOT-\d+/i.exec(texto)?.[0]?.toUpperCase() ?? previa?.ref ?? null,
      total: /\$\s?\d{1,3}(?:[.,]\d{3})+/.exec(texto)?.[0] ?? previa?.total ?? null,
    };
  }
  return hallada;
}

function siguienteRevision(ahora: Date, minutos: number): Date {
  return new Date(ahora.getTime() + minutos * MIN);
}

/** La familia del producto: lo último que NOMBRÓ el cliente manda; si no, el producto del bot. */
export function familiaDelLead(ficha: Pick<FichaDelLead, "mensajes" | "familiaDelBot">): string | null {
  for (let i = ficha.mensajes.length - 1; i >= 0; i -= 1) {
    const m = ficha.mensajes[i];
    if (m.direccion !== "IN") continue;
    const familia = familiaDelTexto(textoDelCliente(m));
    if (familia) return familia;
  }
  return ficha.familiaDelBot;
}

export function evaluarLead(ficha: FichaDelLead, config: ConfigSeguimientoInteligente, ahora: Date): Evaluacion {
  const mensajes = ficha.mensajes.filter((m) => m.en.getTime() <= ahora.getTime());
  const inicio = ficha.inicioDeLaCharla ?? mensajes[0]?.en ?? null;
  const delCliente = mensajes.filter((m) => m.direccion === "IN");
  const conTexto = delCliente.filter((m) => textoDelCliente(m)).map((m) => ({ texto: textoDelCliente(m), en: m.en }));
  const familia = familiaDelLead({ mensajes, familiaDelBot: ficha.familiaDelBot });
  const cotizacion = ficha.cotizacion.en ? ficha.cotizacion : cotizacionEnLosMensajes(mensajes, inicio) ?? ficha.cotizacion;
  const calificacion = calificar({
    mensajes: conTexto,
    ahora,
    productoInteres: familia,
    cotizacionEn: cotizacion.en,
    etapaCrm: ficha.etapaCrm,
    caidaPorDia: config.calificacion.caidaPorDia,
    precioConProductoEsTibio: config.calificacion.precioConProductoEsTibio,
  });
  const decision = decidir({ ficha, mensajes, inicio, delCliente, familia, cotizacion, calificacion, config, ahora });
  return { calificacion, familia, decision };
}

type Contexto = {
  ficha: FichaDelLead;
  mensajes: MensajeCrudo[];
  inicio: Date | null;
  delCliente: MensajeCrudo[];
  familia: string | null;
  cotizacion: { en: Date | null; ref: string | null; total: string | null };
  calificacion: Calificacion;
  config: ConfigSeguimientoInteligente;
  ahora: Date;
};

function decidir(c: Contexto): Decision {
  const { ficha, mensajes, config, ahora, calificacion } = c;
  const producto = nombreDeFamilia(c.familia);
  const contextoDelMensaje: ContextoDelMensaje = {
    nombre: ficha.nombre,
    producto,
    senales: calificacion.senales,
    cotizacion: c.cotizacion.en ? { ref: c.cotizacion.ref, total: c.cotizacion.total } : null,
  };
  const base = (accion: Accion, motivo: string, extra: Partial<Decision> = {}): Decision => {
    const d: Decision = {
      accion,
      motivo,
      prioridad: null,
      mensajeSugerido: null,
      vence: null,
      revisarEn: siguienteRevision(ahora, 6 * 60),
      programarPara: null,
      mensajeUtil: null,
      supresion: "siempre",
      dormidoHasta: null,
      fechaCompra: null,
      toque: null,
      clave: "",
      ...extra,
    };
    d.clave = [d.accion, d.motivo, d.prioridad ?? "", d.toque ?? "", d.vence ? d.vence.toISOString().slice(0, 13) : ""].join("|");
    return d;
  };
  /*
    La tarea aparece recién cuando VENCE su plazo sin que una persona escriba: un cliente que
    pregunta y la asesora le contesta en 5 minutos no necesita una tarea (es la bandeja de siempre).
    Antes de vencer es "esperar" (sin automáticos encima) y el reloj vuelve a mirar al vencer.
  */
  const tarea = (prioridad: Prioridad, motivo: string, mensaje: string, vence: Date, toque: string | null = null): Decision =>
    vence.getTime() > ahora.getTime()
      ? base("esperar", motivo, { prioridad, vence, toque, revisarEn: vence })
      : base("tarea_asesora", motivo, {
          prioridad,
          mensajeSugerido: mensaje,
          vence,
          toque,
          // Se vuelve a mirar en 1 h para ver si alguien la hizo.
          revisarEn: siguienteRevision(ahora, 60),
        });

  // 1. Fuera de Colombia.
  // Un número extranjero que nombra una ciudad de Colombia es un cliente en Colombia (ver exterior.ts).
  const nombraColombia = c.delCliente.some((m) => mencionaColombia(m.texto));
  if (config.exterior.activo && !nombraColombia && (ficha.marcaExterior || ficha.pais === "EXTERIOR")) {
    return base("excluir_exterior", "telefono_fuera_de_colombia", { revisarEn: siguienteRevision(ahora, 7 * 24 * 60) });
  }
  // 2. Etapa cerrada.
  if (ficha.etapaCrm === "GANADO" || ficha.etapaCrm === "PERDIDO") {
    return base("no_insistir", "etapa_cerrada", { revisarEn: siguienteRevision(ahora, 24 * 60) });
  }
  // 3. Dijo que no.
  if (calificacion.noInteresa && calificacion.temperatura === "FRIO") {
    return base("no_insistir", "no_le_interesa", { revisarEn: siguienteRevision(ahora, 24 * 60) });
  }

  const ultimoCliente = c.delCliente.at(-1) ?? null;
  const ultimoOut = [...mensajes].reverse().find((m) => m.direccion === "OUT") ?? null;
  const turno = turnoDelLead(c);
  // El cliente escribió y nadie (ni el bot ni una persona) le contestó todavía.
  const clienteEsperando = turno.de === "MAGILUS" && turno.motivo === "cliente_escribio";
  const temperatura: Temperatura = calificacion.temperaturaBase;

  if (!ultimoCliente) {
    return base("no_insistir", "nunca_escribio", { revisarEn: siguienteRevision(ahora, 24 * 60) });
  }

  // 4. Fecha futura en lo último que dijo (la tanda después de nuestra última respuesta anterior).
  const ultimoOutAntesDelCliente = [...mensajes].reverse().find((m) => m.direccion === "OUT" && m.en.getTime() < ultimoCliente.en.getTime()) ?? null;
  const tanda = c.delCliente.filter((m) => !ultimoOutAntesDelCliente || m.en.getTime() > ultimoOutAntesDelCliente.en.getTime());
  let fechaFutura: FechaFutura | null = null;
  for (const m of [...tanda].reverse()) {
    fechaFutura = detectarFechaFutura(textoDelCliente(m), m.en);
    if (fechaFutura) break;
  }
  if (fechaFutura && turno.de !== "MAGILUS") {
    const tareaEn = new Date(fechaFutura.fecha.getTime() - config.fechaFutura.diasAntes * DIA);
    if (ahora.getTime() < tareaEn.getTime()) {
      return base("dormido", "fecha_futura", {
        dormidoHasta: fechaFutura.fecha,
        fechaCompra: fechaFutura,
        revisarEn: tareaEn,
      });
    }
    const hechaDespues = mensajes.some((m) => esHumano(m, c.inicio) && m.en.getTime() >= tareaEn.getTime());
    if (!hechaDespues) {
      return {
        ...tarea("B", "fecha_futura_cerca", mensajeDeFechaFutura({ ...contextoDelMensaje, fechaComo: fechaFutura.como }), tareaEn),
        fechaCompra: fechaFutura,
      };
    }
    // La asesora ya le escribió por la fecha: sigue el turno de siempre.
  }

  // 5. El cliente está esperando respuesta.
  if (clienteEsperando) {
    if (temperatura === "CALIENTE") {
      return tarea("A", "caliente_esperando", mensajePorSenales(contextoDelMensaje), new Date(ultimoCliente.en.getTime() + config.motor.minutosTareaA * MIN));
    }
    if (temperatura === "TIBIO") {
      return tarea("B", "tibio_esperando", mensajePorSenales(contextoDelMensaje), new Date(ultimoCliente.en.getTime() + config.motor.minutosTareaB * MIN));
    }
    if (ficha.pausado) {
      return tarea("B", "esperando_con_bot_pausado", mensajePorSenales(contextoDelMensaje), new Date(ultimoCliente.en.getTime() + config.motor.minutosTareaB * MIN));
    }
    return base("esperar", "el_bot_responde", { supresion: "reemplazo", revisarEn: siguienteRevision(ahora, 15) });
  }

  // 5c. Le toca a Magilus aunque el bot ya contestó: el bot pasó el chat a una persona o hubo
  //     intención fuerte de compra sin ninguna persona después. Una persona tiene que escribir.
  if (turno.de === "MAGILUS") {
    const desde = turno.desde ?? ultimoCliente.en;
    const fuerte = turno.motivo === "intencion_fuerte" || temperatura === "CALIENTE";
    return tarea(
      fuerte ? "A" : "B",
      turno.motivo === "intencion_fuerte" ? "intencion_fuerte_sin_persona" : "bot_paso_a_asesora",
      mensajePorSenales(contextoDelMensaje),
      new Date(desde.getTime() + (fuerte ? config.motor.minutosTareaA : config.motor.minutosTareaB) * MIN),
    );
  }

  // 5d. Turno del CLIENTE: Magilus ya respondió y quedó esperando. Sin tareas humanas.
  return turnoDelCliente(c, base, turno, ultimoOut, temperatura);
}

function mensajeUtilAFrio(
  c: Contexto,
  base: (accion: Accion, motivo: string, extra?: Partial<Decision>) => Decision,
  ultimoOut: MensajeCrudo | null,
  motivo: string,
  topeAlcanzado: boolean,
  toque: string | null = null,
): Decision {
  const { ficha, config, ahora } = c;
  const reemplazo: Partial<Decision> = { supresion: toque ? "siempre" : "reemplazo", toque };
  if (ficha.pausado && !toque) return base("no_insistir", "chat_pausado", { ...reemplazo, revisarEn: new Date(ahora.getTime() + 6 * HORA) });
  if (!ultimoOut) return base("no_insistir", "sin_mensaje_nuestro", reemplazo);
  // Solo con el interruptor del anti-bloqueo prendido (apagado desde el 11-10-2026).
  if (config.motor.respetarNoLeido && !ultimoOut.leidoEn && ultimoOut.estado !== "READ") {
    return base("no_insistir", "no_leyo", { ...reemplazo, revisarEn: new Date(ahora.getTime() + 2 * HORA) });
  }
  if (topeAlcanzado) return base("no_insistir", "ya_se_mando_el_mensaje_util", { ...reemplazo, revisarEn: new Date(ahora.getTime() + 24 * HORA) });
  const desde = ultimoOut.en.getTime();
  const listoEn = new Date(desde + (toque ? 0 : config.motor.minutosParaMensajeUtil * MIN));
  if (ahora.getTime() < listoEn.getTime()) return base("esperar", "frio_esperando_silencio", { ...reemplazo, revisarEn: listoEn });
  if (!toque && ahora.getTime() - desde > config.motor.horasMaximasMensajeUtil * HORA) {
    return base("no_insistir", "muy_tarde_para_el_mensaje_util", { ...reemplazo, revisarEn: new Date(ahora.getTime() + 24 * HORA) });
  }
  const util = mensajeUtilPara({
    familia: c.familia,
    recursos: config.recursos,
    flujosEnviados: ficha.flujosEnviados,
    mediasEnviadas: c.mensajes.filter((m) => m.direccion === "OUT" && m.media).map((m) => m.media as string),
  });
  if (!util) return base("no_insistir", "sin_mensaje_util_para_el_producto", { ...reemplazo, revisarEn: new Date(ahora.getTime() + 24 * HORA) });
  const horario = { desdeHora: config.motor.desdeHora, hastaHora: config.motor.hastaHora, desfaseMaxMinutos: 30 };
  // Mismo desfase por chat (determinista): lo que vence de noche se reparte en la primera media hora.
  let semilla = 0;
  for (const letra of ficha.conversationId) semilla = (semilla * 31 + letra.charCodeAt(0)) % 1000;
  const programarPara = dentroDelHorario(ahora, horario) ? ahora : reprogramarFueraDeHorario(ahora, horario, () => semilla / 1000);
  return base("mensaje_util_producto", motivo, { ...reemplazo, mensajeUtil: util, programarPara, revisarEn: new Date(ahora.getTime() + 2 * HORA) });
}

/** El turno del chat con la definición única (lib/turno-del-chat.ts), con las notas de pase del bot. */
export function turnoDelLead(c: Pick<Contexto, "ficha" | "mensajes" | "inicio" | "ahora">): TurnoDelChat {
  const mensajes: MensajeDelTurno[] = c.mensajes.map((m) => ({ direccion: m.direccion, tipo: m.tipo, texto: m.texto, en: m.en, origen: m.origen }));
  for (const nota of c.ficha.notasDelBot ?? []) {
    mensajes.push({ direccion: "OUT", tipo: "SYSTEM", texto: nota.texto, en: nota.en, origen: null });
  }
  mensajes.sort((a, b) => a.en.getTime() - b.en.getTime());
  return turnoDelChat(mensajes, { ahora: c.ahora, inicioDeLaCharla: c.inicio });
}

/**
 * TURNO DEL CLIENTE: Magilus ya respondió (el bot o una persona) y espera su respuesta. No hay
 * tareas humanas: los seguimientos automáticos de siempre siguen (supresión "ninguna"; el
 * anti-bloqueo los frena), al Frío que solo habló con el bot se le manda el mensaje útil, y pasadas
 * `horasTurnoDelCliente` sin respuesta se descarta (con su interruptor). Con cotización vigente no
 * se descarta nunca.
 */
function turnoDelCliente(
  c: Contexto,
  base: (accion: Accion, motivo: string, extra?: Partial<Decision>) => Decision,
  turno: TurnoDelChat,
  ultimoOut: MensajeCrudo | null,
  temperatura: Temperatura,
): Decision {
  const { config, ahora, mensajes } = c;
  const ultimoCliente = c.delCliente.at(-1) as MensajeCrudo;
  const desde = turno.desde ?? ultimoOut?.en ?? ultimoCliente.en;
  const automaticos: Partial<Decision> = { supresion: "ninguna" };
  const cot = c.cotizacion.en;
  const cotizacionVigente = Boolean(cot && cot.getTime() >= ultimoCliente.en.getTime() && ahora.getTime() - cot.getTime() < config.cotizacion.diasVigente * DIA);
  if (cotizacionVigente) {
    return base("esperar", "turno_del_cliente_cotizacion_vigente", { ...automaticos, revisarEn: new Date(ahora.getTime() + 24 * HORA) });
  }
  const descartarDesde = new Date(desde.getTime() + config.cadencia.horasTurnoDelCliente * HORA);
  if (ahora.getTime() >= descartarDesde.getTime()) {
    return base("descartar", "turno_del_cliente_sin_respuesta", { revisarEn: new Date(ahora.getTime() + 24 * HORA) });
  }
  // Un Frío que solo habló con el bot: lo de siempre (1 mensaje útil del producto, automático).
  const personaDespues = mensajes.some((m) => esHumano(m, c.inicio) && m.en.getTime() > ultimoCliente.en.getTime());
  if (temperatura === "FRIO" && !personaDespues) {
    const util = mensajeUtilAFrio(c, base, ultimoOut, "frio_leyo_sin_responder", c.ficha.mensajesUtiles >= config.motor.maxMensajesUtiles);
    return util.revisarEn.getTime() > descartarDesde.getTime() ? { ...util, revisarEn: descartarDesde } : util;
  }
  return base("esperar", "turno_del_cliente", { ...automaticos, revisarEn: descartarDesde });
}
