/**
 * ¿EL CLIENTE SOLO ACUSA RECIBO DE ALGO QUE YA QUEDÓ ACORDADO? (código puro, sin base).
 * Alexander, 13-10-2026.
 *
 * Falla real (13-oct, Ventas 1, etapa Caliente): la clienta mandó sus "Datos de Cotización", dijo
 * «En la tarde / ella se llama Danna / apenas ella esta alla te enviaria la transferencia / es el
 * 50% / cierto»; María respondió (audio), la clienta «Mil gracias», María «Gracias a ti» 11:49. A las
 * 12:57 salió el automático "¿Pudiste ver lo que te envié?" y la clienta contestó 13:20 «Si señora
 * está bien». El Supervisor avisó a María, a Ingrid y escaló a Alexander "[IMPORTANTE] Cliente
 * caliente esperando respuesta hace 2 h" con "Te preparo la cotización… ¿Me confirmas la ciudad y la
 * cantidad?". No había nada pendiente.
 *
 * NO es tarea (ni caliente, ni señal fuerte, ni asignado, ni sin dueña) cuando:
 *  1. Lo que el cliente escribió DESPUÉS de la última respuesta de una persona son solo acuses o
 *     cortesías ("ok", "listo", "sí señora está bien", "mil gracias", 👍, sticker, reacción…: el
 *     mismo `esAcuseDelCliente` del compromiso), sin pregunta ni señal de compra nueva ("ok, ¿y el
 *     envío cuánto?" sigue siendo tarea; "de una" también: es aceptar).
 *  2. Lo último de la persona no fue una pregunta (un "sí" a "¿te separo el combo?" es una compra),
 *     salvo que después saliera un seguimiento automático (el "sí" contesta al automático).
 *  3. Y antes había un ACUERDO:
 *     - compromiso del cliente (seguimiento-inteligente/dominio/compromiso.ts: "te envío la
 *       transferencia en la tarde");
 *     - cierre de la charla (tras-asesora.ts `terminoEnCierre`: «Mil gracias» → «Gracias a ti»);
 *     - el cliente ya mandó sus datos de compra (`mandoSusDatos`) o prometió el pago; o
 *     - lo único que provocó el acuse fue un seguimiento automático (la persona ya había respondido
 *       todo y no dejó una promesa propia sin cumplir).
 * Los pagos ("ya pagué", comprobante) siguen siempre: los maneja otro detector y no se tocan aquí.
 */

import { ORIGENES_AUTOMATICOS_DEL_TURNO, ORIGENES_HUMANOS, mandoSusDatos, type EventoDelChat } from "../../../lib/turno-de-la-conversacion";
import { detectarSenales, esSenalDeCompra } from "../../embudo/dominio/senales";
import { compromisoEnTexto, detectarCompromiso, esAcuseDelCliente, mensajeDeCompromiso, type Compromiso } from "../../seguimiento-inteligente/dominio/compromiso";
import type { Horario } from "../../seguimiento-inteligente/dominio/formulario";
import { promesaPendiente, terminoEnCierre } from "../../seguimiento-inteligente/dominio/tras-asesora";

export type TipoDeAcuerdo = "compromiso" | "cierre" | "datos" | "promesa_de_pago" | "seguimiento_automatico";

export type AcuerdoPrevio = {
  tipo: TipoDeAcuerdo;
  /** Para auditar: qué lo decidió. */
  detalle: string;
  compromiso: Compromiso | null;
};

/** Lo mínimo de un chat que hace falta (compatible con ChatAbierto). */
export type ChatParaAcuse = {
  /** Los últimos mensajes y notas del chat (cualquier orden). Sin ellos no se decide nada (= tarea, como antes). */
  mensajes?: EventoDelChat[] | null;
  textosDelCliente?: string[];
  nombreCliente?: string | null;
};

const HORARIO_LABORAL: Horario = { desde: 8, hasta: 18, dias: [1, 2, 3, 4, 5, 6] };

const esPersona = (m: EventoDelChat) => m.direccion === "OUT" && m.tipo !== "SYSTEM" && ORIGENES_HUMANOS.includes(m.origen ?? "");
const esAutomatico = (m: EventoDelChat) => m.direccion === "OUT" && m.tipo !== "SYSTEM" && ORIGENES_AUTOMATICOS_DEL_TURNO.includes(m.origen ?? "");

function ordenados(chat: ChatParaAcuse): EventoDelChat[] {
  return [...(chat.mensajes ?? [])].filter((m) => m.tipo !== "SYSTEM").sort((a, b) => a.en.getTime() - b.en.getTime());
}

/** ¿Un mensaje del cliente es solo acuse / cortesía, sin pregunta ni señal de compra? */
export function esSoloAcuse(m: Pick<EventoDelChat, "tipo" | "texto">): boolean {
  if (!esAcuseDelCliente(m)) return false;
  const texto = m.texto ?? "";
  // "de una", "dale, lo quiero"… son un sí a la compra aunque sus palabras parezcan acuse.
  return !detectarSenales(texto).some(esSenalDeCompra);
}

/** Datos de compra o promesa de pago del cliente en un texto. */
function datosOPromesa(texto: string | null | undefined): "datos" | "promesa_de_pago" | null {
  if (mandoSusDatos(texto)) return "datos";
  const c = compromisoEnTexto(texto);
  if (c?.pago) return "promesa_de_pago";
  return null;
}

/**
 * Lo acordado en el chat (sin mirar si el cliente espera): compromiso del cliente, datos de compra o
 * promesa de pago. Con mensajes usa la charla; sin ellos, los últimos textos del cliente.
 */
export function acuerdoDeCompra(chat: ChatParaAcuse, horario: Horario = HORARIO_LABORAL): AcuerdoPrevio | null {
  const lista = ordenados(chat);
  if (lista.length) {
    const compromiso = detectarCompromiso({ mensajes: lista, horario });
    if (compromiso) return { tipo: "compromiso", detalle: compromiso.frase, compromiso };
  }
  const textos = lista.length ? lista.filter((m) => m.direccion === "IN").map((m) => m.texto) : (chat.textosDelCliente ?? []);
  for (const t of [...textos].reverse()) {
    const tipo = datosOPromesa(t);
    if (tipo) return { tipo, detalle: (t ?? "").replace(/\s+/g, " ").trim().slice(0, 140), compromiso: null };
  }
  return null;
}

/**
 * Si el cliente solo acusa recibo de algo ya acordado, el acuerdo (= NO es tarea); si no, null.
 * Sin mensajes del chat, null (no se sabe = sigue siendo tarea, como antes).
 */
export function soloAcusaReciboDeUnAcuerdo(chat: ChatParaAcuse, horario: Horario = HORARIO_LABORAL): AcuerdoPrevio | null {
  const lista = ordenados(chat);
  if (!lista.length) return null;
  let iPersona = -1;
  for (let i = lista.length - 1; i >= 0; i -= 1) {
    if (esPersona(lista[i])) {
      iPersona = i;
      break;
    }
  }
  if (iPersona < 0) return null;
  const despues = lista.slice(iPersona + 1);
  const pendientes = despues.filter((m) => m.direccion === "IN");
  if (!pendientes.length) return null;
  // 1. Solo acuses / cortesías.
  if (!pendientes.every(esSoloAcuse)) return null;
  // Entre la persona y el cliente solo pueden ir automáticos (si contestó el bot, lo decide el turno).
  const salientes = despues.filter((m) => m.direccion === "OUT");
  if (salientes.some((m) => !esAutomatico(m))) return null;
  const huboAutomatico = salientes.length > 0;
  // 2. La tanda final de la persona: un "sí" a su pregunta es una respuesta, no un acuse.
  const hasta = lista.slice(0, iPersona + 1);
  const tandaPersona: EventoDelChat[] = [];
  for (let i = iPersona; i >= 0 && hasta[i].direccion === "OUT"; i -= 1) if (esPersona(hasta[i])) tandaPersona.unshift(hasta[i]);
  const preguntoLaPersona = tandaPersona.some((m) => /[?¿]/.test(m.texto ?? ""));
  if (preguntoLaPersona && !huboAutomatico) return null;
  // 3. El acuerdo.
  const deCompra = acuerdoDeCompra({ ...chat, mensajes: lista }, horario);
  if (deCompra) return deCompra;
  if (terminoEnCierre(hasta, esPersona)) return { tipo: "cierre", detalle: "La charla terminó en cierre antes del acuse.", compromiso: null };
  if (huboAutomatico && !preguntoLaPersona && !promesaPendiente(tandaPersona)) {
    return { tipo: "seguimiento_automatico", detalle: "El acuse contesta a un seguimiento automático; la persona ya había respondido.", compromiso: null };
  }
  return null;
}

/**
 * El mensaje sugerido cuando ya hay un acuerdo de compra (nunca "te preparo la cotización / ¿me
 * confirmas ciudad y cantidad?" a quien ya mandó sus datos o prometió pagar).
 */
export function mensajeDelAcuerdo(acuerdo: AcuerdoPrevio, nombre: string | null): string | null {
  if (acuerdo.compromiso) return mensajeDeCompromiso(acuerdo.compromiso, nombre);
  const limpio = (nombre ?? "").trim().split(/\s+/)[0] ?? "";
  const hola = limpio && /^[\p{L}]{2,20}$/u.test(limpio) ? `¡Hola, ${limpio[0].toUpperCase()}${limpio.slice(1).toLowerCase()}!` : "¡Hola!";
  if (acuerdo.tipo === "promesa_de_pago") return `${hola} 😊 Te escribo por lo que quedamos del pago. ¿Te ayudo con algo para completarlo?`;
  if (acuerdo.tipo === "datos") return `${hola} 😊 Ya tengo tus datos del pedido ✅ Quedo atenta para seguir con lo que acordamos.`;
  return null;
}

