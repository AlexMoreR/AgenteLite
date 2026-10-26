/**
 * ¿EL CLIENTE DEJÓ LA COMPRA EN PAUSA Y LA ASESORA YA LE RESPONDIÓ? (código puro, sin base ni IA).
 * Tarjeta 8vvb74p2, 26-10-2026.
 *
 * Falla real (26-oct, 573112022514, María Bautista): el cliente dijo «espero que me organicen el lugar
 * donde voy a trabajar», María respondió «quedamos al pendiente» y el Supervisor lo escaló como CRÍTICO
 * por «6 horas sin respuesta». No había nada que contestar: el cliente avisó que está esperando algo
 * suyo y la asesora ya respondió. Lo que corresponde es retomarlo más adelante con un mensaje de valor.
 *
 * Es PAUSA ACORDADA cuando se cumplen las tres:
 *  1. El cliente dijo que espera algo o que lo deja para después («estoy reuniendo la plata»,
 *     «organizando el local», «te aviso», «más adelante», «cuando tenga…»), en la última tanda suya
 *     antes de que una persona le respondiera, sin pregunta.
 *  2. Una persona del equipo le respondió después, sin preguntarle nada ni dejar una promesa sin cumplir.
 *  3. Lo que el cliente escribió DESPUÉS son acuses («ok», «gracias», 👍) o más de lo mismo («es que la obra
 *     no ha terminado»): ninguna pregunta, pedido, pago, datos ni señal de compra nueva.
 * Un «ya pagué», un comprobante, una promesa de pago o los datos de compra NUNCA son pausa: los manejan
 * otros detectores y se siguen alertando. Con la menor duda, null (= se alerta como hoy).
 *
 * Cuándo se retoma: la fecha que dio el cliente («a finales de noviembre», «el 15 te confirmo») o, si no
 * dio ninguna, 3 días después, en horario laboral.
 */

import { ORIGENES_AUTOMATICOS_DEL_TURNO, ORIGENES_HUMANOS, mandoSusDatos, type EventoDelChat } from "../../../lib/turno-de-la-conversacion";
import { normalizarParaCierre } from "../../../lib/cierre-de-conversacion";
import { detectarSenales, esSenalDeCompra } from "../../embudo/dominio/senales";
import { compromisoEnTexto } from "../../seguimiento-inteligente/dominio/compromiso";
import { detectarFechaFutura } from "../../seguimiento-inteligente/dominio/fecha-futura";
import { siguienteHoraLaboral, type Horario } from "../../seguimiento-inteligente/dominio/formulario";
import { promesaPendiente } from "../../seguimiento-inteligente/dominio/tras-asesora";
import { esSoloAcuse } from "./acuse-con-acuerdo";

export type FuenteDeLaPausa = "fecha_del_cliente" | "compromiso" | "sin_fecha";

export type PausaAcordada = {
  /** Lo que dijo el cliente (la tanda, recortada). */
  frase: string;
  /** Cuándo lo dijo (último mensaje de esa tanda). */
  dichoEn: Date;
  /** Cuándo le respondió por última vez una persona (después de lo que dijo). */
  respondioEn: Date;
  /** Cuándo se retoma (horario laboral). */
  retomarEn: Date;
  /** La fecha que dio el cliente, si dio una (null = se usaron los días por defecto). */
  fechaDelCliente: Date | null;
  /** De dónde sale la fecha de retomar. */
  fuente: FuenteDeLaPausa;
  /** La fecha dicha en palabras ("finales de noviembre", "el 15") o "sin fecha: a los 3 días". */
  como: string;
};

export const DIAS_DE_PAUSA_POR_DEFECTO = 3;
/** Una pausa cuya fecha de retomar pasó hace más de esto ya no es "acordada": vuelve a lo de siempre. */
const DIAS_DE_VIGENCIA_TRAS_LA_FECHA = 7;

const DIA = 86_400_000;
const HORA = 3_600_000;
const HORARIO_LABORAL: Horario = { desde: 8, hasta: 18, dias: [1, 2, 3, 4, 5, 6] };

/** Lo que dice el cliente cuando deja la compra en espera (sobre el texto normalizado: sin tildes ni signos). */
const ESPERA: RegExp[] = [
  /\b(estoy|ando|estamos|andamos|seguimos|sigo) (aun |todavia |ya )?(esperando|reuniendo|juntando|ahorrando|organizando|consiguiendo|arreglando|adecuando|cuadrando|gestionando|tramitando|montando)\b/,
  /\b(espero|esperamos) (a )?que\b/,
  /\b(estoy|estamos) (a la espera|pendiente de|pendientes de)\b/,
  /\b(me|nos) (falta|faltan) (reunir|juntar|completar|organizar|conseguir|arreglar)\b/,
  /\bcuando (tenga|tengamos|reuna|reunamos|junte|juntemos|me paguen|me llegue|nos llegue|este listo|este lista|estemos listos|termine|terminen|organice|organicemos|arreglen|adecuen|me desocupe)\b/,
  /\b(te|le|les|los) (aviso|avisare|avisaria|escribo|escribire|confirmo|confirmare|contacto|contactare|hablo|buscare)\b/,
  /\b(despues|luego) (te|le|les|nos) (aviso|escribo|confirmo|hablo|contacto)\b/,
  /\bmas adelante\b|\bmas adelantico\b/,
];

/** Un pago hecho o por hacer, o un comprobante: nunca es pausa. */
const PAGO = /\b(ya (pague|pagamos|transferi|consigne|envie|mande|hice)|comprobante|soporte de pago|pantallazo|consignacion|transferencia)\b/;

/** Pedidos y preguntas sin signo de interrogación: si aparecen después de la respuesta, el cliente espera algo de nosotros. */
const PIDE_ALGO = /\b(cuanto|cuanta|cuantos|cuantas|cual|cuales|quien|donde|necesito|quiero|me interesa|precio|valor|disponible|me (puedes|puede|podrias|podria|regalas|regala|envias|envia|manda|mandas|cotizas|cotiza|ayudas|ayuda|confirmas|confirma|dices|dice))\b/;

/**
 * Lo que el cliente escribió DESPUÉS de la respuesta de la persona y no pide nada: un acuse, o una frase más sobre
 * lo que espera. Una pregunta, un pedido, un pago, sus datos o una señal de compra la sacan de la pausa.
 */
function seguiaEnLoMismo(m: EventoDelChat): boolean {
  if (esSoloAcuse(m)) return true;
  if (m.tipo !== "TEXT" && m.tipo !== "AUDIO") return false;
  const texto = (m.texto ?? "").trim();
  if (!texto || texto.length > 200 || /[?¿]/.test(texto)) return false;
  const limpio = normalizarParaCierre(texto);
  if (PIDE_ALGO.test(limpio) || PAGO.test(limpio) || mandoSusDatos(texto) || compromisoEnTexto(texto)?.pago) return false;
  return !detectarSenales(texto).some(esSenalDeCompra);
}

const esPersona = (m: EventoDelChat) => m.direccion === "OUT" && m.tipo !== "SYSTEM" && ORIGENES_HUMANOS.includes(m.origen ?? "");
const esAutomatico = (m: EventoDelChat) => m.direccion === "OUT" && m.tipo !== "SYSTEM" && ORIGENES_AUTOMATICOS_DEL_TURNO.includes(m.origen ?? "");

function recortar(texto: string, maximo = 140): string {
  const t = texto.replace(/\s+/g, " ").trim();
  return t.length <= maximo ? t : `${t.slice(0, maximo - 1).trimEnd()}…`;
}

/** ¿El texto del cliente deja la compra en espera? */
export function dejaLaCompraEnEspera(texto: string | null | undefined): boolean {
  const limpio = normalizarParaCierre(texto ?? "");
  return Boolean(limpio) && ESPERA.some((re) => re.test(limpio));
}

/**
 * La pausa acordada de un chat, o null. `mensajes` son los últimos mensajes del chat (cualquier orden;
 * las notas SYSTEM se ignoran). `ahora` solo sirve para no revivir pausas cuya fecha pasó hace mucho.
 */
export function detectarPausaAcordada(input: { mensajes: EventoDelChat[]; ahora?: Date; horario?: Horario; dias?: number }): PausaAcordada | null {
  const horario = input.horario ?? HORARIO_LABORAL;
  const dias = input.dias ?? DIAS_DE_PAUSA_POR_DEFECTO;
  const lista = [...input.mensajes].filter((m) => m.tipo !== "SYSTEM").sort((a, b) => a.en.getTime() - b.en.getTime());
  if (!lista.length) return null;
  // Lo último que hizo una persona.
  let iPersona = -1;
  for (let i = lista.length - 1; i >= 0; i -= 1) {
    if (esPersona(lista[i])) {
      iPersona = i;
      break;
    }
  }
  if (iPersona < 0) return null;
  // 3. Después de la persona solo puede haber acuses del cliente (y automáticos nuestros).
  const despues = lista.slice(iPersona + 1);
  if (despues.some((m) => m.direccion === "OUT" && !esAutomatico(m))) return null;
  if (!despues.filter((m) => m.direccion === "IN").every(seguiaEnLoMismo)) return null;
  // La tanda de la persona (salientes seguidos hasta ese punto) y la del cliente justo antes.
  let i = iPersona;
  const tandaPersona: EventoDelChat[] = [];
  while (i >= 0 && lista[i].direccion === "OUT") {
    if (esPersona(lista[i])) tandaPersona.unshift(lista[i]);
    i -= 1;
  }
  // 2. La persona no le preguntó nada ni dejó una promesa sin cumplir (si no, el turno es del cliente / de ella).
  if (tandaPersona.some((m) => /[?¿]/.test(m.texto ?? ""))) return null;
  if (promesaPendiente(tandaPersona)) return null;
  const tandaCliente: EventoDelChat[] = [];
  while (i >= 0 && lista[i].direccion === "IN") {
    tandaCliente.unshift(lista[i]);
    i -= 1;
  }
  if (!tandaCliente.length) return null;
  // 1. Lo que dijo: espera algo o lo deja para después, sin pregunta, sin pago ni datos ni señal de compra nueva.
  const textos = tandaCliente.map((m) => (m.texto ?? "").trim()).filter(Boolean);
  const texto = textos.join(" / ");
  if (!texto || !dejaLaCompraEnEspera(texto)) return null;
  if (tandaCliente.some((m) => m.tipo !== "TEXT" && m.tipo !== "AUDIO")) return null; // foto / documento: puede ser un comprobante
  if (/[?¿]/.test(texto)) return null;
  const limpio = normalizarParaCierre(texto);
  if (PAGO.test(limpio) || mandoSusDatos(texto) || compromisoEnTexto(texto)?.pago) return null;
  if (detectarSenales(texto).some((s) => s.grupo === "fuerte")) return null;

  const dichoEn = tandaCliente[tandaCliente.length - 1].en;
  const respondioEn = lista[iPersona].en;
  // Cuándo se retoma: la fecha del cliente > el momento de su compromiso > los días por defecto.
  let retomar: Date;
  let fechaDelCliente: Date | null = null;
  let fuente: FuenteDeLaPausa;
  let como: string;
  const futura = textos.map((t) => detectarFechaFutura(t, dichoEn)).find(Boolean) ?? null;
  const compromiso = compromisoEnTexto(texto);
  if (futura) {
    fechaDelCliente = futura.fecha;
    retomar = futura.fecha;
    fuente = "fecha_del_cliente";
    como = futura.como;
  } else if (compromiso?.momento && !compromiso.momento.ambiguo) {
    fechaDelCliente = compromiso.momento.cuando(dichoEn, horario);
    retomar = fechaDelCliente;
    fuente = "compromiso";
    como = compromiso.momento.como;
  } else {
    retomar = new Date(dichoEn.getTime() + dias * DIA);
    fuente = "sin_fecha";
    como = `sin fecha: a los ${dias} días`;
  }
  // Nunca antes de 1 h después de lo dicho, y siempre en horario laboral.
  const minimo = new Date(dichoEn.getTime() + HORA);
  const retomarEn = siguienteHoraLaboral(retomar.getTime() < minimo.getTime() ? minimo : retomar, horario);
  // Una pausa cuya fecha pasó hace mucho no se sostiene: se trata como hoy.
  if (input.ahora && input.ahora.getTime() > retomarEn.getTime() + DIAS_DE_VIGENCIA_TRAS_LA_FECHA * DIA) return null;
  return { frase: recortar(texto), dichoEn, respondioEn, retomarEn, fechaDelCliente, fuente, como };
}

/**
 * El mensaje de valor, sin presión, para que la asesora retome el chat el día de la pausa. Es solo un texto
 * sugerido para ella: el sistema nunca se lo manda al cliente.
 */
export function mensajeDePausaAcordada(pausa: Pick<PausaAcordada, "frase">, nombre: string | null): string {
  const limpio = (nombre ?? "").trim().split(/\s+/)[0] ?? "";
  const saludo = limpio && /^[\p{L}]{2,20}$/u.test(limpio) ? `¡Hola, ${limpio[0].toUpperCase()}${limpio.slice(1).toLowerCase()}!` : "¡Hola!";
  const t = normalizarParaCierre(pausa.frase);
  let como: string;
  if (/\b(local|lugar|sitio|taller|oficina|negocio|espacio)\b/.test(t)) como = "¿Cómo vas con el local?";
  else if (/\b(plata|dinero|ahorr\w*|reun\w*|junt\w*|prima|pago)\b/.test(t)) como = "¿Cómo vas con lo que estabas organizando?";
  else como = "¿Cómo vas con lo que me comentabas?";
  return `${saludo} 😊 ${como} Te cuento que cuando lo tengas listo te ayudo con la información y las opciones que necesites, sin ningún afán. Aquí estoy para lo que se te ofrezca 🙌`;
}
