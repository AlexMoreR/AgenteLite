/**
 * AUTOMÁTICOS DESPUÉS DE QUE ESCRIBE LA ASESORA (código puro). Decisión de Alexander, 12-10-2026:
 * "sí siguen".
 *
 * Hoy, cuando una persona escribe, el chat se pausa (`automationPaused`) y ya no sale ningún
 * automático: ni el recordatorio del V3 ni los Follow. Con esto, si la asesora escribió y el cliente
 * se calla, salen los toques de `trasAsesora.horas` (1 h y al día siguiente) SIN despausar la IA (el
 * bot no le contesta al cliente: eso sigue siendo de la asesora).
 *
 * Sale solo si (todas):
 *  - el chat está pausado POR ESCRIBIR una persona (la pausa coincide, ±2 min, con un mensaje suyo).
 *    Una pausa a mano con el interruptor, o la que pone el bot al pasar a la asesora, no tiene un
 *    mensaje de una persona al lado: ahí no sale nada (la asesora decidió no seguir).
 *  - es turno del CLIENTE (lib/turno-de-la-conversacion: respondió una persona);
 *  - lo último de la persona no promete algo ("ya te envío…", "déjame confirmar…", "te llamo"):
 *    ahí el turno es nuestro y un "¿pudiste ver…?" la contradice;
 *  - etapa abierta, no dijo que no le interesa, no dio una fecha futura, no está pospuesto;
 *  - un toque por silencio de la persona; si se pasaron varios, solo el más avanzado.
 * El resto (horario, tope, espaciado, exterior, freno) lo pone el motor de seguimientos al enviar.
 */

import { esMensajeHumano } from "../../../lib/anti-bloqueo/reglas";
import { turnoDeLaConversacion } from "../../../lib/turno-de-la-conversacion";
import type { ConfigSeguimientoInteligente } from "./config";
import type { MensajeCrudo } from "./motor";

const MIN = 60_000;
const HORA = 60 * MIN;

export const PREFIJO_FOLLOW_TRAS_ASESORA = "Tras asesora: ";

/** La pausa "por escribir" cae a esta distancia de un mensaje de la persona. */
export const PAUSA_POR_ESCRIBIR_MS = 2 * MIN;

const ORIGENES_AUTOMATICOS = ["agente-v3-seguimiento", "agente-v3-seguimiento-ia", "follow", "automation_reactivation"];

/** Frases de la asesora que dejan el turno de NUESTRO lado (prometió algo). */
const PROMESA =
  /\b(ya|ahora|ahorita|en un (momento|rato|ratico)|ma[ñn]ana|m[aá]s tarde|en breve)\b[^.?!\n]{0,25}\b(te|le)\s+(env[ií]o|mando|paso|comparto|confirmo|aviso|cotizo|llamo|marco|escribo|consigo|averiguo)\b|\b(d[eé]jame|perm[ií]teme|dame|voy a)\s+(un\s+(momento|segundo|minuto)|verificar|confirmar|consultar|revisar|averiguar|preguntar|mirar|cotizar)|\bte\s+(confirmo|aviso|llamo|marco|escribo|env[ií]o|mando)\s+(en un|m[aá]s tarde|ma[ñn]ana|ahorita|ya|apenas|en cuanto|cuando)\b|\b(estoy|ando)\s+(verificando|confirmando|consultando|revisando|cotizando)\b/i;

export function asesoraPrometio(texto: string | null | undefined): boolean {
  return PROMESA.test(texto ?? "");
}

/** Lo que manda una persona que ya ENTREGA algo (fotos, catálogo, audio, ubicación). */
const TIPOS_QUE_ENTREGAN = ["IMAGE", "VIDEO", "DOCUMENT", "AUDIO", "LOCATION"];

/**
 * ¿Quedó una promesa SIN cumplir en la tanda de la persona?
 *
 * La promesa solo deja el turno de nuestro lado si después no llegó lo prometido. Caso real (12-oct,
 * 13 chats): la respuesta rápida "Ya te comparto las *fotos*, el precio el *989.000*" va seguida de
 * las fotos, el video y "¿En qué color lo quieres?"; el cliente se calla y, como la tanda tenía un
 * "ya te comparto", no salía ningún toque. Se cumple si después de la promesa la persona mandó un
 * adjunto, una pregunta o un texto de verdad (no otra promesa ni un "un momento").
 */
export function promesaPendiente(tanda: Array<Pick<MensajeCrudo, "tipo" | "texto">>): boolean {
  let pendiente = false;
  for (const m of tanda) {
    if (asesoraPrometio(m.texto)) {
      pendiente = true;
      continue;
    }
    if (!pendiente) continue;
    const texto = (m.texto ?? "").trim();
    if (TIPOS_QUE_ENTREGAN.includes(m.tipo) || texto.includes("?") || texto.length >= 25) pendiente = false;
  }
  return pendiente;
}

function primerNombre(nombre: string | null): string {
  const limpio = (nombre ?? "").trim().split(/\s+/)[0] ?? "";
  return limpio && /^[\p{L}]{2,20}$/u.test(limpio) ? `¡Hola, ${limpio[0].toUpperCase()}${limpio.slice(1).toLowerCase()}!` : "¡Hola!";
}

export function textoDelToque(plantilla: string, nombre: string | null): string {
  return plantilla.replace(/\{nombre\}/g, primerNombre(nombre)).replace(/\s+/g, " ").trim();
}

/** ¿La pausa del chat es la que pone escribir una persona? (no la del interruptor ni la del bot) */
export function pausaPorEscribir(pausadoEn: Date | null, humanos: Date[]): boolean {
  if (!pausadoEn) return false;
  return humanos.some((en) => Math.abs(en.getTime() - pausadoEn.getTime()) <= PAUSA_POR_ESCRIBIR_MS);
}

export type DecisionTrasAsesora =
  | { sale: false; motivo: string; revisarEn: Date | null }
  | { sale: true; toque: number; horas: number; nombreDelFollow: string; texto: string; ultimoHumanoEn: Date };

export function decidirTrasAsesora(input: {
  mensajes: MensajeCrudo[];
  notas?: MensajeCrudo[];
  inicio: Date | null;
  nombre: string | null;
  pausado: boolean;
  pausadoEn: Date | null;
  etapaCrm: string | null;
  noInteresa: boolean;
  dormido: boolean;
  pospuesto: boolean;
  caliente: boolean;
  config: ConfigSeguimientoInteligente["trasAsesora"];
  ahora: Date;
}): DecisionTrasAsesora {
  const { config, ahora } = input;
  const no = (motivo: string, revisarEn: Date | null = null): DecisionTrasAsesora => ({ sale: false, motivo, revisarEn });
  if (config.modo === "apagado" || !config.horas.length) return no("apagado");
  if (input.etapaCrm === "GANADO" || input.etapaCrm === "PERDIDO") return no("etapa_cerrada");
  // Sin pausa, los recordatorios son del reloj del V3 (como hoy): no se duplican.
  if (!input.pausado) return no("ia_activa");
  if (input.noInteresa) return no("no_le_interesa");
  if (input.dormido) return no("fecha_futura");
  if (input.pospuesto) return no("pospuesto");

  const mensajes = input.mensajes.filter((m) => m.tipo !== "SYSTEM" && m.en.getTime() <= ahora.getTime());
  const esHumano = (m: MensajeCrudo) => m.direccion === "OUT" && esMensajeHumano({ createdAt: m.en, origen: m.origen }, input.inicio);
  const ultimoCliente = [...mensajes].reverse().find((m) => m.direccion === "IN") ?? null;
  if (!ultimoCliente) return no("nunca_escribio");
  const ultimoHumano = [...mensajes].reverse().find(esHumano) ?? null;
  if (!ultimoHumano || ultimoHumano.en.getTime() <= ultimoCliente.en.getTime()) return no("sin_persona_despues_del_cliente");
  // Después de la persona solo pueden venir automáticos (un mensaje del bot = la IA no estaba pausada).
  if (mensajes.some((m) => m.direccion === "OUT" && m.en.getTime() > ultimoHumano.en.getTime() && !esHumano(m) && !ORIGENES_AUTOMATICOS.includes(m.origen ?? ""))) {
    return no("hablo_el_bot_despues");
  }
  if (!pausaPorEscribir(input.pausadoEn, mensajes.filter(esHumano).map((m) => m.en))) return no("pausa_manual");

  const eventos = [...mensajes, ...(input.notas ?? [])].map((m) => ({ direccion: m.direccion, tipo: m.tipo, origen: m.origen, texto: m.texto, en: m.en }));
  const turno = turnoDeLaConversacion(eventos, { caliente: input.caliente, asignada: true, tuvoContactoHumano: true });
  if (turno.de !== "CLIENTE") return no(`turno_de_magilus_${turno.motivo}`);
  // La tanda de la persona (lo último que escribió) no puede dejar una promesa sin cumplir.
  const tanda = mensajes.filter((m) => esHumano(m) && m.en.getTime() > ultimoCliente.en.getTime());
  if (promesaPendiente(tanda)) return no("asesora_prometio");

  // Envíos automáticos desde la persona (los del mismo minuto = uno).
  let enviados = 0;
  let anterior = 0;
  for (const m of mensajes) {
    if (m.direccion !== "OUT" || !ORIGENES_AUTOMATICOS.includes(m.origen ?? "") || m.en.getTime() <= ultimoHumano.en.getTime()) continue;
    if (m.en.getTime() - anterior > MIN) enviados += 1;
    anterior = m.en.getTime();
  }
  if (enviados >= config.horas.length) return no("toques_completos");
  const desde = ultimoHumano.en.getTime();
  const pendientes = config.horas.map((h, i) => ({ i, h, vence: desde + h * HORA })).slice(enviados);
  const vencidos = pendientes.filter((p) => p.vence <= ahora.getTime());
  if (!vencidos.length) return no("todavia_no", new Date(pendientes[0].vence));
  // Solo el más avanzado que venció; si ya se pasó de su gracia, no sale (ni los anteriores).
  const toque = vencidos[vencidos.length - 1];
  if (ahora.getTime() - toque.vence > config.horasDeGracia * HORA) {
    const siguiente = pendientes.find((p) => p.vence > ahora.getTime());
    return no("se_paso_la_gracia", siguiente ? new Date(siguiente.vence) : null);
  }
  return {
    sale: true,
    toque: toque.i,
    horas: toque.h,
    nombreDelFollow: `${PREFIJO_FOLLOW_TRAS_ASESORA}${toque.h} h`,
    texto: textoDelToque(config.textos[toque.i] ?? config.textos[config.textos.length - 1] ?? "{nombre}", input.nombre),
    ultimoHumanoEn: ultimoHumano.en,
  };
}
