// Caja corta de "Prioridades de Alexander": traduce una Tarjeta del Supervisor a lo mínimo que el dueño
// necesita para entender la alerta en 3 segundos. Solo afecta a la pantalla; no cambia la lógica del
// Supervisor ni los textos de los WhatsApp. Todo sale de lo que la Tarjeta ya trae.
import type { GravedadDeEscalada, Tarjeta } from "./reglas";

export type CajaCorta = {
  insignia: string;
  gravedad: GravedadDeEscalada;
  /** Frase sencilla, sin términos técnicos. */
  frase: string;
  /** null = no se sabe: la línea no se muestra (nunca un número inventado). */
  leads: number | null;
  responsable: string;
  /** "25-oct" (hora de Bogotá). */
  desde: string;
  /** null = no aplica (el bot) y la línea no se muestra. */
  recordatorios: number | null;
};

export const INSIGNIA_DE_GRAVEDAD: Record<GravedadDeEscalada, string> = {
  CRITICO: "🚨 CRÍTICO",
  IMPORTANTE: "⚠️ IMPORTANTE",
  OBSERVACION: "👀 OBSERVACIÓN",
};

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const CINCO_HORAS = 5 * 60 * 60 * 1000;

/** "25-oct" en hora de Bogotá (UTC-5, sin horario de verano). "" si la fecha no sirve. */
export function fechaCorta(fecha: string | Date | null | undefined): string {
  if (!fecha) return "";
  const t = (typeof fecha === "string" ? new Date(fecha) : fecha).getTime();
  if (Number.isNaN(t)) return "";
  const d = new Date(t - CINCO_HORAS);
  return `${d.getUTCDate()}-${MESES[d.getUTCMonth()]}`;
}

/** Problemas del bot ya conocidos → frase fija. Se busca en el título del incidente. */
const FRASES_CONOCIDAS: Array<[RegExp, string]> = [
  [/r[aá]fagas?/i, "🤖 El bot habla demasiado en el primer contacto."],
  [/repitiendo la misma pregunta/i, "🤖 El bot repite la misma pregunta."],
  [/pregunta la ciudad/i, "🤖 El bot pregunta la ciudad cuando el cliente ya la dijo."],
  [/da precio o fotos antes/i, "🤖 El bot da el precio antes de saber qué necesita el cliente."],
  [/respuesta de los clientes viene cayendo/i, "📉 Menos clientes están contestando."],
];

/** Quita versiones, "pts", siglas técnicas y paréntesis técnicos de un título. */
export function limpiarTitulo(titulo: string): string {
  return titulo
    .replace(/\([^)]*\)/g, " ")
    .replace(/\bv\d+(\.\d+)*\b/gi, " ")
    .replace(/\bversi[oó]n\s*\d*\b/gi, " ")
    .replace(/[+-]?\d+(?:[.,]\d+)?\s*(?:pts?|puntos?)\b/gi, " ")
    .replace(/\b(?:CUSUM|SPRT|EWMA|p95|p99)\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,:;])/g, "$1")
    .trim()
    .replace(/[.:;,\s]+$/, "");
}

const esDelBot = (t: Tarjeta) => Boolean(t.claveAlerta);
const esPatron = (t: Tarjeta) => !t.conversationId && !t.claveAlerta;

export function fraseSencilla(t: Tarjeta): string {
  if (esDelBot(t)) {
    // quePaso = "<título>. <qué pasó>": solo cuenta el título.
    const crudo = t.quePaso.split(/\.\s/)[0] ?? t.quePaso;
    for (const [patron, frase] of FRASES_CONOCIDAS) if (patron.test(crudo)) return frase;
    const titulo = limpiarTitulo(crudo);
    return titulo ? `🤖 ${titulo}.` : "🤖 Hay un problema con el bot.";
  }
  // Asesora: solo el motivo, sin "hace 1 h" ni la frase del cliente.
  const motivo = (t.quePaso.split(" hace ")[0] ?? t.quePaso)
    .replace(/\s*\(«.*$/, "")
    .replace(/esperando respuesta$/i, "sin respuesta")
    .replace(/[.\s]+$/, "")
    .trim();
  return `👤 ${motivo}.`;
}

export function leadsAfectados(t: Tarjeta): number | null {
  if (esDelBot(t)) {
    const m = /^(\d+)\s+lead/i.exec(t.cliente);
    return m ? Number(m[1]) : null;
  }
  if (esPatron(t)) return t.chats?.length ? t.chats.length : null;
  return 1;
}

export function responsableCorto(t: Tarjeta): string {
  if (esDelBot(t)) return /^Equipo/.test(t.responsable) ? "Equipo" : "Bot / sistema";
  return t.responsable.replace(/\s*\(.*\)\s*$/, "").trim() || "Nadie asignado";
}

/** "Ya se le recordó N veces": solo si el responsable es una asesora con aviso. */
export function recordatorios(t: Tarjeta): number | null {
  if (esDelBot(t) || t.responsable === "Nadie asignado" || /^No había a quién avisar/.test(t.intentos)) return null;
  return /segundo aviso/i.test(t.intentos) ? 2 : 1;
}

export function cajaCorta(t: Tarjeta): CajaCorta {
  return {
    insignia: INSIGNIA_DE_GRAVEDAD[t.gravedad],
    gravedad: t.gravedad,
    frase: fraseSencilla(t),
    leads: leadsAfectados(t),
    responsable: responsableCorto(t),
    desde: fechaCorta(t.desde),
    recordatorios: recordatorios(t),
  };
}

export function textoDeRecordatorios(n: number): string {
  return `🔁 Ya se le recordó ${n} ${n === 1 ? "vez" : "veces"}`;
}
