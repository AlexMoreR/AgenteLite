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
 *  - LEYÓ y no respondió (FRÍO) → máximo 1 mensaje útil del producto que preguntó, 8–20 h.
 *  - TIBIO (pregunta concreta) → tarea para la asesora con el mensaje sugerido (prioridad B).
 *  - CALIENTE → una persona en < 15 min: tarea A y NINGÚN automático encima.
 *  - COTIZACIÓN → tarea humana a las 24 h y 72 h con el mensaje listo.
 *  - FECHA FUTURA → dormido; tarea X días antes de la fecha.
 *  - Después de la asesora: toques en los días 3, 4 y 7; Frío = mensaje útil, resto = tarea. Tras
 *    el último sin respuesta (sin fecha futura ni cotización vigente) → descartar.
 */

import { dentroDelHorario, esMensajeHumano, reprogramarFueraDeHorario } from "../../../lib/anti-bloqueo/reglas";
import type { ConfigSeguimientoInteligente } from "./config";
import { detectarFechaFutura, type FechaFutura } from "./fecha-futura";
import { mencionaColombia, type Pais } from "./exterior";
import { mensajeDeCadencia, mensajeDeCotizacion, mensajeDeFechaFutura, mensajePorSenales, type ContextoDelMensaje } from "./mensajes";
import { familiaDelTexto, mensajeUtilPara, nombreDeFamilia, type MensajeUtil } from "./producto";
import { calificar, type Calificacion, type Temperatura } from "./temperatura";

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

/** Los `rawPayload.source` de lo que sale solo (igual que lib/freno-de-automaticos). */
export const ORIGENES_AUTOMATICOS = ["agente-v3-seguimiento", "agente-v3-seguimiento-ia", "follow", "automation_reactivation"];

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

function esAutomatico(m: MensajeCrudo): boolean {
  return m.direccion === "OUT" && Boolean(m.origen && ORIGENES_AUTOMATICOS.includes(m.origen));
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
  const clienteEsperando = Boolean(ultimoCliente && (!ultimoOut || ultimoCliente.en.getTime() > ultimoOut.en.getTime()));
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
  let inicioCadencia = ultimoCliente.en;
  if (fechaFutura && !clienteEsperando) {
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
    // La asesora ya le escribió por la fecha: desde ahí corre la cadencia.
    inicioCadencia = tareaEn;
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

  const humanosDespues = mensajes.filter((m) => esHumano(m, c.inicio) && m.en.getTime() > inicioCadencia.getTime());
  const salidosDespues = (desde: Date) => mensajes.filter((m) => m.direccion === "OUT" && (esHumano(m, c.inicio) || esAutomatico(m)) && m.en.getTime() >= desde.getTime());

  // 6. Cotización vigente sin respuesta: tareas a las 24 h y 72 h.
  const cot = c.cotizacion.en;
  const cotizacionVigente = Boolean(cot && cot.getTime() >= ultimoCliente.en.getTime() && ahora.getTime() - cot.getTime() < config.cotizacion.diasVigente * DIA);
  if (cot && cotizacionVigente) {
    let pendiente: number | null = null;
    let proxima: Date | null = null;
    for (const horas of config.cotizacion.horas) {
      const vence = new Date(cot.getTime() + horas * HORA);
      if (ahora.getTime() < vence.getTime()) {
        proxima = vence;
        break;
      }
      const hecha = salidosDespues(new Date(vence.getTime() - 2 * HORA)).some((m) => esHumano(m, c.inicio));
      pendiente = hecha ? null : horas;
    }
    if (pendiente !== null) {
      return tarea("A", "cotizacion_sin_respuesta", mensajeDeCotizacion(contextoDelMensaje, pendiente), new Date(cot.getTime() + pendiente * HORA), `cotizacion_${pendiente}h`);
    }
    if (proxima) {
      return base("esperar", "cotizacion_esperando_escalon", { revisarEn: proxima });
    }
  }

  // 7. La asesora ya escribió después del cliente: cadencia de toques (días 3, 4 y 7).
  if (humanosDespues.length) {
    return cadencia(c, { tarea, base, contextoDelMensaje, humanosDespues, temperatura, cotizacionVigente, fechaFutura, ultimoOut });
  }

  // 8. Solo el bot le habló.
  if (temperatura === "CALIENTE") {
    return tarea("A", "caliente_sin_asesora", mensajePorSenales(contextoDelMensaje), new Date(ultimoCliente.en.getTime() + config.motor.minutosTareaA * MIN));
  }
  if (temperatura === "TIBIO") {
    return tarea("B", "tibio_sin_asesora", mensajePorSenales(contextoDelMensaje), new Date(ultimoCliente.en.getTime() + config.motor.minutosTareaB * MIN));
  }
  if (ahora.getTime() - ultimoCliente.en.getTime() > config.motor.diasDeSeguimiento * DIA) {
    return base("no_insistir", "fuera_de_la_ventana", { revisarEn: siguienteRevision(ahora, 7 * 24 * 60) });
  }
  return mensajeUtilAFrio(c, base, ultimoOut, "frio_leyo_sin_responder", ficha.mensajesUtiles >= config.motor.maxMensajesUtiles);
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
  if (!ultimoOut.leidoEn && ultimoOut.estado !== "READ") {
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

function cadencia(
  c: Contexto,
  h: {
    tarea: (prioridad: Prioridad, motivo: string, mensaje: string, vence: Date, toque?: string | null) => Decision;
    base: (accion: Accion, motivo: string, extra?: Partial<Decision>) => Decision;
    contextoDelMensaje: ContextoDelMensaje;
    humanosDespues: MensajeCrudo[];
    temperatura: Temperatura;
    cotizacionVigente: boolean;
    fechaFutura: FechaFutura | null;
    ultimoOut: MensajeCrudo | null;
  },
): Decision {
  const { config, ahora, mensajes } = c;
  const inicioDeLaCadencia = h.humanosDespues[0].en;
  const dias = config.cadencia.dias;
  const frio = h.temperatura === "FRIO" && !h.cotizacionVigente;
  // Envíos automáticos desde el último mensaje del cliente hasta `hasta` (los del mismo minuto = uno).
  const desdeElCliente = c.delCliente.at(-1)?.en.getTime() ?? 0;
  const automaticosHasta = (hasta: number) => {
    let n = 0;
    let anterior = 0;
    for (const m of mensajes) {
      if (!esAutomatico(m) || m.en.getTime() <= desdeElCliente || m.en.getTime() > hasta) continue;
      if (m.en.getTime() - anterior > MIN) n += 1;
      anterior = m.en.getTime();
    }
    return n;
  };
  const sinMensajeUtil =
    frio &&
    !mensajeUtilPara({
      familia: c.familia,
      recursos: config.recursos,
      flujosEnviados: c.ficha.flujosEnviados,
      mediasEnviadas: mensajes.filter((m) => m.direccion === "OUT" && m.media).map((m) => m.media as string),
    });
  let pendiente: { dia: number; vence: Date; ultimo: boolean } | null = null;
  let proximo: Date | null = null;
  for (const [i, dia] of dias.entries()) {
    const vence = new Date(inicioDeLaCadencia.getTime() + dia * DIA);
    if (ahora.getTime() < vence.getTime()) {
      proximo = vence;
      break;
    }
    const desde = new Date(vence.getTime() - 2 * HORA);
    const hecho = mensajes.some((m) => m.direccion === "OUT" && m.en.getTime() >= desde.getTime() && (esHumano(m, c.inicio) || esAutomatico(m)));
    // Si lo último nuestro antes del toque no se leyó, el toque se salta (no se le insiste a quien no lee).
    const anterior = [...mensajes].reverse().find((m) => m.direccion === "OUT" && m.en.getTime() < vence.getTime()) ?? null;
    const noLeyo = Boolean(anterior && !anterior.leidoEn && anterior.estado !== "READ");
    // A un Frío que ya recibió el tope de automáticos en este silencio tampoco se le insiste: el
    // anti-bloqueo lo frenaría, y no vale una tarea humana. Cuenta como hecho para el descarte.
    const topeFrio = frio && (sinMensajeUtil || automaticosHasta(vence.getTime()) >= config.cadencia.maxAutomaticos);
    pendiente = hecho || noLeyo || topeFrio ? null : { dia, vence, ultimo: i === dias.length - 1 };
  }
  if (pendiente) {
    const toque = `dia_${pendiente.dia}`;
    if (frio) {
      // Frío: el toque es el mensaje útil automático (pasa por el anti-bloqueo). Si no hay uno que
      // mandar (sin recurso, no leyó), el toque se deja pasar: no se gasta tiempo humano en un Frío.
      const util = mensajeUtilAFrio(c, h.base, h.ultimoOut, "cadencia_frio", false, toque);
      if (util.accion === "mensaje_util_producto" || util.accion === "esperar") return util;
      return h.base("no_insistir", `cadencia_frio_${util.motivo}`, { toque, revisarEn: new Date(ahora.getTime() + 24 * HORA) });
    }
    return h.tarea(
      h.temperatura === "CALIENTE" || h.cotizacionVigente ? "A" : "B",
      "cadencia_sin_respuesta",
      mensajeDeCadencia(h.contextoDelMensaje, pendiente.dia, pendiente.ultimo),
      pendiente.vence,
      toque,
    );
  }
  if (proximo) {
    return h.base("esperar", "cadencia_proximo_toque", { revisarEn: proximo, toque: `dia_${dias.find((d) => inicioDeLaCadencia.getTime() + d * DIA === proximo.getTime()) ?? ""}` });
  }
  // Pasaron todos los toques sin respuesta.
  const ultimo = new Date(inicioDeLaCadencia.getTime() + dias[dias.length - 1] * DIA);
  const descartarDesde = new Date(ultimo.getTime() + config.cadencia.horasDeGracia * HORA);
  if (h.cotizacionVigente) return h.base("no_insistir", "cotizacion_vigente_no_se_descarta", { revisarEn: new Date(ahora.getTime() + 24 * HORA) });
  if (ahora.getTime() < descartarDesde.getTime()) return h.base("esperar", "gracia_antes_de_descartar", { revisarEn: descartarDesde });
  return h.base("descartar", "sin_respuesta_tras_3_seguimientos", { revisarEn: new Date(ahora.getTime() + 24 * HORA) });
}
