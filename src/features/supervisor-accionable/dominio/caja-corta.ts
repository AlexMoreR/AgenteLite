/**
 * CAJA CORTA de una prioridad: lo que el dueño lee en 3 segundos sin abrir la alerta.
 * Código puro (sin base, sin Next). Solo cambia cómo se ve la pantalla del Supervisor: lee los
 * textos que la tarjeta ya trae y no toca ninguna regla de escalada ni de avisos.
 *
 * Si un dato no se puede leer de la tarjeta, queda en `null` y la línea no se muestra:
 * nunca se inventa un número.
 */
import type { Tarjeta } from "./reglas";

export type CajaCorta = {
  /** "🚨 CRÍTICO" / "⚠️ IMPORTANTE" / "👀 OBSERVACIÓN". */
  insignia: string;
  /** Clases de color de la insignia (rojo / amarillo / gris). */
  colorInsignia: string;
  /** Una frase sencilla, sin términos técnicos. */
  frase: string;
  leads: number | null;
  /** "Bot / sistema" o el nombre de la asesora. */
  responsable: string;
  /** "25-oct" (hora de Bogotá) o null si la fecha no sirve. */
  desde: string | null;
  /** Cuántas veces se le recordó a la asesora (null = no aplica, p. ej. el bot). */
  recordatorios: number | null;
};

const INSIGNIA: Record<Tarjeta["gravedad"], { texto: string; color: string }> = {
  CRITICO: { texto: "🚨 CRÍTICO", color: "bg-red-500/15 text-red-700 dark:text-red-400" },
  IMPORTANTE: { texto: "⚠️ IMPORTANTE", color: "bg-amber-500/20 text-amber-800 dark:text-amber-400" },
  OBSERVACION: { texto: "👀 OBSERVACIÓN", color: "bg-muted text-muted-foreground" },
};

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "2026-10-25T03:00:00Z" → "24-oct" (Bogotá es UTC-5, sin horario de verano). */
export function fechaCorta(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t - 5 * 3_600_000);
  return `${String(d.getUTCDate()).padStart(2, "0")}-${MESES[d.getUTCMonth()]}`;
}

/** Problemas del bot que ya se conocen: su frase de siempre, en palabras simples. */
const FRASES_CONOCIDAS: Array<[RegExp, string]> = [
  [/r[aá]fagas? de mensajes/i, "🤖 El bot habla demasiado en el primer contacto."],
  [/repitiendo la misma pregunta/i, "🤖 El bot repite la misma pregunta."],
  [/pregunta la ciudad/i, "🤖 El bot pregunta la ciudad cuando el cliente ya la dijo."],
  [/da precio o fotos antes/i, "🤖 El bot da el precio antes de saber qué necesita el cliente."],
  [/respuesta de los clientes viene cayendo/i, "📉 Menos clientes están contestando."],
];

/** Quita números de versión, "pts", siglas técnicas y paréntesis del título de un incidente. */
export function limpiarTitulo(titulo: string): string {
  const limpio = titulo
    .replace(/\([^)]*\)/g, " ")
    .replace(/libro V3/gi, "libro del bot")
    .replace(/\s+a la versión\s+\d+/gi, "")
    .replace(/\b(?:de la |la )?versi[oó]n\s+\d+/gi, "")
    .replace(/\bv\d+\b/gi, "")
    .replace(/\b\d+(?:[.,]\d+)?\s*pts\b/gi, "")
    .replace(/\bz\s*=\s*[\d.,-]+/gi, "")
    .replace(/\b(?:CUSUM|EWMA)\b/g, "")
    .replace(/\s+([:,.])/g, "$1")
    .replace(/[:,]\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return limpio;
}

function terminarEnPunto(texto: string): string {
  return /[.!?]$/.test(texto) ? texto : `${texto}.`;
}

function esPatron(t: Tarjeta): boolean {
  return t.chats !== undefined || /dejó vencer \d+ plazos/.test(t.quePaso);
}

function emojiDeIncidente(clave: string): string {
  if (clave.startsWith("BOT:")) return "🤖";
  if (clave.startsWith("EMBUDO:")) return "📉";
  if (clave.startsWith("ATENCION:")) return "👤";
  return "⚙️";
}

function fraseDe(t: Tarjeta): string {
  if (t.claveAlerta) {
    const conocida = FRASES_CONOCIDAS.find(([patron]) => patron.test(t.quePaso));
    if (conocida) return conocida[1];
    // El texto de la tarjeta es "<título>. <qué pasa>": se usa solo el título.
    const titulo = t.quePaso.split(/\.\s/)[0] ?? t.quePaso;
    const limpio = limpiarTitulo(titulo);
    return `${emojiDeIncidente(t.claveAlerta)} ${terminarEnPunto(limpio || "Hay un problema por revisar")}`;
  }
  // Alerta de una asesora: solo el motivo (sin "hace N min" ni la frase del cliente).
  const motivo = esPatron(t) ? t.quePaso : (t.quePaso.split(/\s+hace\s/)[0] ?? t.quePaso);
  return `👤 ${terminarEnPunto(limpiarTitulo(motivo) || "Hay un chat por atender")}`;
}

function leadsDe(t: Tarjeta): number | null {
  if (t.claveAlerta) {
    const m = /^(\d+)\s+lead\(s\)/.exec(t.cliente);
    return m ? Number(m[1]) : null;
  }
  if (esPatron(t)) {
    if (t.chats?.length) return t.chats.length;
    const m = /dejó vencer (\d+) plazos/.exec(t.quePaso);
    return m ? Number(m[1]) : null;
  }
  return 1;
}

function responsableDe(t: Tarjeta): string {
  if (/^Bot \/ sistema/.test(t.responsable)) return "Bot / sistema";
  return t.responsable.replace(/\s*\(.*$/, "").trim() || "Sin responsable";
}

function recordatoriosDe(t: Tarjeta): number | null {
  if (t.claveAlerta) return null;
  if (/segundo aviso/.test(t.intentos)) return 2;
  if (/^Aviso a /.test(t.intentos)) return 1;
  return null;
}

export function cajaCortaDe(t: Tarjeta): CajaCorta {
  const insignia = INSIGNIA[t.gravedad];
  return {
    insignia: insignia.texto,
    colorInsignia: insignia.color,
    frase: fraseDe(t),
    leads: leadsDe(t),
    responsable: responsableDe(t),
    desde: fechaCorta(t.desde),
    recordatorios: recordatoriosDe(t),
  };
}
