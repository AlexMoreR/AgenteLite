/**
 * ¿EL CHAT ESTÁ EN "PAUSA ACORDADA"? (código puro, sin base ni IA). Alexander, 26-10-2026.
 *
 * Falla real (26-oct, 573112022514, asesora María Bautista): el cliente dijo que espera que le
 * organicen el lugar donde va a trabajar, María respondió «quedamos al pendiente» y el Supervisor lo
 * escaló como CRÍTICO por "6 horas sin respuesta". No había nada pendiente: el cliente dejó la compra
 * en pausa y la asesora ya contestó bien.
 *
 * Hay pausa acordada cuando, en la charla reciente (no solo el último mensaje):
 *  1. el cliente dijo que ESPERA algo o que lo deja para después ("estoy reuniendo la plata",
 *     "organizando el local", "espero un pago", "te aviso", "más adelante", "cuando tenga…");
 *  2. una PERSONA del equipo le respondió después; y
 *  3. después de esa respuesta el cliente no hizo una pregunta ni mostró una señal nueva de compra:
 *     lo que escribió desde entonces (si algo) son solo acuses ("ok", "gracias", 👍).
 * Un "ya pagué" / comprobante nunca es pausa, y ante la duda NO es pausa (se alerta como siempre).
 *
 * Cuándo retomar: la fecha que dio el cliente (`detectarFechaFutura`: "a finales de noviembre"; o el
 * momento de `compromisoEnTexto`: "el 15", "la otra semana") y, si no dio ninguna, a los 3 días, en
 * horario laboral. Ese día la asesora recibe una tarea con un mensaje de valor, sin presión.
 */

import { ORIGENES_HUMANOS } from "../../../lib/turno-de-la-conversacion";
import { normalizarParaCierre } from "../../../lib/cierre-de-conversacion";
import { compromisoEnTexto } from "../../seguimiento-inteligente/dominio/compromiso";
import { detectarFechaFutura } from "../../seguimiento-inteligente/dominio/fecha-futura";
import { siguienteHoraLaboral, type Horario } from "../../seguimiento-inteligente/dominio/formulario";
import { esSoloAcuse } from "./acuse-con-acuerdo";

const HORA = 3_600_000;
const DIA = 24 * HORA;

/** Lo mínimo de un mensaje del chat (compatible con EventoDelChat y con MensajeCrudo del motor). */
export type MensajeDePausa = {
  direccion: "IN" | "OUT";
  tipo: string;
  texto: string | null;
  en: Date;
  /** rawPayload.source: manual / instance = persona. */
  origen: string | null;
};

export type OrigenDeLaFecha = "fecha_del_cliente" | "momento_del_cliente" | "tres_dias";

export type PausaAcordada = {
  /** Lo que dijo el cliente (recortado). */
  frase: string;
  /** Cuándo lo dijo. */
  dichoEn: Date;
  /** Cuándo le respondió una persona. */
  respondioEn: Date;
  /** Cuándo retomar (horario laboral). */
  retomarEn: Date;
  /** La fecha en palabras ("finales de noviembre", "el 15", "en 3 días"). */
  como: string;
  origen: OrigenDeLaFecha;
};

export const DIAS_POR_DEFECTO = 3;
export const HORARIO_DE_PAUSA: Horario = { desde: 8, hasta: 18, dias: [1, 2, 3, 4, 5, 6] };

/** El cliente espera algo o lo deja para después (sobre el texto normalizado, sin tildes). */
const ESPERA = new RegExp(
  [
    "\\b(estoy|ando|vamos|estamos) (reuniendo|juntando|ahorrando|consiguiendo|completando|organizando|arreglando|adecuando|montando|esperando|a la espera|pendiente de)\\b",
    "\\b(reuniendo|juntando|ahorrando|consiguiendo|completando) (la plata|el dinero|lo del|lo de|el anticipo|el pago|para)\\b",
    "\\b(organizando|arreglando|adecuando|montando|alistando) (el|la|mi|mis|un|una) (lugar|local|taller|espacio|negocio|consultorio|spa|salon|sitio|cuarto|casa|oficina|sede)\\b",
    "\\b(espero|esperamos|esperando|esperare) (a )?(que )?(me |nos |se )?(organicen|arreglen|adecuen|entreguen|paguen|pague|consignen|desocupen|salga|salgan|llegue|lleguen|terminen|termine|pase|pasen|den|dan|aprueben|apruebe|entre|entren|este|esten|tenga|tengamos|pueda|podamos)\\b",
    "\\b(espero|esperando|esperamos) (un|el|la|mi|lo de|a que me llegue) (pago|plata|dinero|quincena|prima|credito|prestamo|cesantias|desembolso|local|lugar|respuesta del banco)\\b",
    "\\b(yo )?(te|le|les) (aviso|escribo|busco|confirmo|contacto)\\b.*\\b(cuando|luego|despues|mas adelante|en unos dias|en estos dias)\\b",
    "\\b(yo )?(te|le|les) aviso\\b",
    "\\b(mas adelante|mas adelantico|despues te|luego te|por ahora no|ahora no puedo|en este momento no puedo|todavia no tengo|aun no tengo|todavia no puedo|aun no puedo|no tengo la plata|no tengo el dinero|no tengo como pagar)\\b",
    "\\bcuando (ya )?(tenga|reuna|junte|pueda|me paguen|me consignen|me desocupe|termine|organice|este listo|este lista|tengamos|logre|consiga|me llegue|me salga|me aprueben)\\b",
  ].join("|"),
);

/** Espera de ALGO DE NOSOTROS ("espero tu respuesta"): ahí el que debe actuar es el equipo. */
const ESPERA_DE_NOSOTROS =
  /\b(espero|esperando|esperamos|a la espera de) (tu|su|una|la|sus|tus) (respuesta|cotizacion|informacion|llamada|confirmacion|ayuda|foto|fotos|video|catalogo|precio)\b|\bespero que (me |nos )?(respondas|responda|respondan|escribas|escriba|confirmes|confirme|confirmen|digas|diga|envies|envie|envien|mandes|mande|manden|cotices|cotice|ayudes|ayude|ayuden|contestes|conteste|contesten|llames|llame|llamen|escriban|comuniques|comunique)\b/;

/** Ya pagó / mandó comprobante: lo maneja el detector de pagos, nunca es pausa. */
const PAGO_HECHO =
  /\b(ya (pague|page|transferi|consigne|cancele|abone|hice (el|la|mi) (pago|transferencia|consignacion|abono|deposito)|envie (el|la|mi) (comprobante|pago|transferencia|soporte))|comprobante|soporte de pago|pantallazo (del|de la) (pago|transferencia)|adjunto (el|la|mi) (pago|comprobante|transferencia|soporte))\b/;

const esPersona = (m: MensajeDePausa) => m.direccion === "OUT" && m.tipo !== "SYSTEM" && ORIGENES_HUMANOS.includes(m.origen ?? "");

function recortar(texto: string, maximo = 140): string {
  const t = texto.replace(/\s+/g, " ").trim();
  return t.length <= maximo ? t : `${t.slice(0, maximo - 1).trimEnd()}…`;
}

/** ¿Este texto del cliente dice que espera algo o que lo deja para después? (sin pregunta ni pago hecho) */
export function diceQueEspera(texto: string | null | undefined): boolean {
  const original = texto ?? "";
  if (!original.trim() || /[?¿]/.test(original)) return false;
  const limpio = normalizarParaCierre(original);
  if (!limpio || PAGO_HECHO.test(limpio) || ESPERA_DE_NOSOTROS.test(limpio)) return false;
  if (ESPERA.test(limpio)) return true;
  // "el 15 te confirmo", "la otra semana te escribo": un compromiso con momento que NO es de pago (el del
  // pago ya lo maneja el seguimiento por compromiso, con su propia tarea a esa hora).
  const compromiso = compromisoEnTexto(original);
  return Boolean(compromiso && compromiso.momento && !compromiso.pago);
}

/**
 * La pausa acordada del chat, o null. `ahora` se usa para no seguir tratándola como pausa cuando ya
 * llegó el día de retomar (desde ahí vuelve a valer lo de siempre y el motor crea la tarea).
 */
export function detectarPausaAcordada(
  chat: { mensajes?: MensajeDePausa[] | null },
  ahora: Date,
  opciones: { horario?: Horario; dias?: number } = {},
): PausaAcordada | null {
  const horario = opciones.horario ?? HORARIO_DE_PAUSA;
  const dias = opciones.dias ?? DIAS_POR_DEFECTO;
  const lista = [...(chat.mensajes ?? [])].filter((m) => m.tipo !== "SYSTEM").sort((a, b) => a.en.getTime() - b.en.getTime());
  if (!lista.length) return null;
  // 1. Lo último que el cliente dijo que espera algo.
  let iEspera = -1;
  for (let i = lista.length - 1; i >= 0; i -= 1) {
    if (lista[i].direccion === "IN" && diceQueEspera(lista[i].texto)) {
      iEspera = i;
      break;
    }
  }
  if (iEspera < 0) return null;
  const espera = lista[iEspera];
  // 2. Una persona le respondió después.
  const respondio = lista.slice(iEspera + 1).find(esPersona);
  if (!respondio) return null;
  // 3. Desde que dijo que espera, el cliente solo pudo acusar recibo (sin pregunta ni señal nueva).
  const despues = lista.slice(iEspera + 1).filter((m) => m.direccion === "IN");
  if (!despues.every(esSoloAcuse)) return null;
  // Fecha: la que dio el cliente; si no, `dias` días después, en horario laboral.
  const texto = (espera.texto ?? "").trim();
  const futura = detectarFechaFutura(texto, espera.en);
  const compromiso = futura ? null : compromisoEnTexto(texto);
  let bruta: Date;
  let como: string;
  let origen: OrigenDeLaFecha;
  if (futura) {
    bruta = futura.fecha;
    como = futura.como;
    origen = "fecha_del_cliente";
  } else if (compromiso?.momento && !compromiso.momento.ambiguo) {
    bruta = compromiso.momento.cuando(espera.en, horario);
    como = compromiso.momento.como;
    origen = "momento_del_cliente";
  } else {
    bruta = new Date(espera.en.getTime() + dias * DIA);
    como = `${dias} días`;
    origen = "tres_dias";
  }
  // Nunca antes de 1 h después de la respuesta de la persona.
  const minimo = new Date(respondio.en.getTime() + HORA);
  const retomarEn = siguienteHoraLaboral(bruta.getTime() < minimo.getTime() ? minimo : bruta, horario);
  // Llegó el día de retomar: ya no es pausa (lo de siempre vuelve a valer).
  if (ahora.getTime() >= retomarEn.getTime()) return null;
  return { frase: recortar(texto), dichoEn: espera.en, respondioEn: respondio.en, retomarEn, como, origen };
}

/**
 * El mensaje para la asesora el día de retomar: de valor y sin presionar. La asesora lo revisa y lo
 * manda ella; el sistema no le escribe al cliente.
 */
export function mensajeDePausa(pausa: Pick<PausaAcordada, "frase">, nombre: string | null): string {
  const limpio = (nombre ?? "").trim().split(/\s+/)[0] ?? "";
  const hola = limpio && /^[\p{L}]{2,20}$/u.test(limpio) ? `¡Hola, ${limpio[0].toUpperCase()}${limpio.slice(1).toLowerCase()}!` : "¡Hola!";
  const t = normalizarParaCierre(pausa.frase);
  let como: string;
  if (/\b(lugar|local|taller|espacio|negocio|consultorio|spa|salon|sitio|cuarto|casa|oficina|sede)\b/.test(t)) como = "¿Cómo vas con el lugar donde vas a trabajar?";
  else if (/\b(plata|dinero|pago|anticipo|quincena|prima|credito|prestamo|cesantias|ahorr\w*|junt\w*|reun\w*)\b/.test(t)) como = "¿Cómo vas con lo que estabas organizando?";
  else como = "¿Cómo vas con lo que me contaste?";
  return `${hola} 😊 ${como} Te escribo sin ningún afán: cuando lo tengas listo, te ayudo con la cotización y el envío a tu ciudad, y si te sirve te cuento cómo es el proceso para que lo vayas viendo.`;
}
