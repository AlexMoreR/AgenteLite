/**
 * PEDIDO DE DATOS DE LA ASESORA (código puro).
 *
 * Alexander, 11-10-2026 (caso cv3a2aa2b2f953c5543ccca57e): cuando la asesora manda el formulario
 * ("Nombre y Apellido / NIT / C.C / Correo / Dirección / Ciudad…") o pide los datos para cotizar o
 * separar y el cliente NO responde: tarea a las 2 h, 24 h y 72 h (horario laboral). Después sigue la
 * lógica de siempre (cotización / cadencia / descarte). Si el cliente responde, se cancela todo.
 */

const HORA = 3_600_000;

/** Campos del formulario: con 3 o más distintos en un mismo mensaje es un pedido de datos. */
const CAMPOS: RegExp[] = [
  /\bnombres?\b/i,
  /\bapellidos?\b/i,
  /\bc\.?\s?c\b|c[eé]dula|\bnit\b|\bdocumento\b/i,
  /direcci[oó]n/i,
  /\bciudad\b/i,
  /\bbarrio\b/i,
  /\bdepartamento\b/i,
  /\bcorreo\b|\be-?mail\b/i,
  /tel[eé]fono|\bcelular\b/i,
];

/** Frases de pedido de datos (cuando no viene el formulario completo). */
const FRASES =
  /(?:me\s+(?:regalas?|regalar[ií]as|compartes?|env[ií]as?|pasas?|confirmas?|dices|das|mandas?)|reg[aá]lame|comp[aá]rteme|env[ií]ame|p[aá]same|m[aá]ndame|conf[ií]rmame|necesito|requiero)\s+(?:por\s+favor\s+)?(?:tus|sus|los|unos)\s+datos|datos\s+(?:para|de)\s+(?:la\s+|el\s+|tu\s+|su\s+)?(?:cotizaci|factur|separ|apart|env[ií]o|despacho|gu[ií]a|pedido|orden)|(?:completa|completar|completes|diligencia|diligenciar|llena|llenar|llenes)\s+(?:por\s+favor\s+)?(?:(?:estos|los\s+siguientes|tus|sus|los)\s+datos|(?:el\s+|este\s+)?formulario)/i;

/** Lo que NO es pedir datos: somos nosotros dando los datos para pagar. */
const NOSOTROS_DAMOS = /consign|transfer|cuenta\s+de\s+ahorros|bancolombia|nequi|daviplata|te\s+(?:paso|env[ií]o|comparto)\s+(?:los\s+)?datos/i;

/** Un rótulo vacío del formulario: "Dirección:" seguido de nada (o solo emojis/espacios) hasta el renglón siguiente. */
const ROTULO_VACIO = /:[^\S\n]*(?:[^\p{L}\p{N}\n]{0,6})(?:\n|$)/gu;

export function esPedidoDeDatos(texto: string | null | undefined): boolean {
  const t = (texto ?? "").trim();
  if (t.length < 12) return false;
  if (!NOSOTROS_DAMOS.test(t) && FRASES.test(t)) return true;
  const campos = CAMPOS.filter((r) => r.test(t)).length;
  if (campos < 3) return false;
  // Los campos con sus valores ya escritos (nuestra dirección, los datos de una guía) no piden nada:
  // o vienen los rótulos vacíos, o no hay números de teléfono / NIT / dirección.
  const vacios = (t.match(ROTULO_VACIO) ?? []).length;
  return vacios >= 3 || !/\d{6,}|#\s?\d/.test(t);
}

/* ---------------------------------------------------------------------------------------------- */
/* Horario laboral (el mismo del Supervisor: lunes a sábado, 8 a. m. a 6 p. m. de Bogotá, UTC-5). */

export type Horario = { desde: number; hasta: number; dias: number[] };

function enBogota(fecha: Date): Date {
  return new Date(fecha.getTime() - 5 * HORA);
}

export function dentroDelHorarioLaboral(fecha: Date, h: Horario): boolean {
  const b = enBogota(fecha);
  const hora = b.getUTCHours() + b.getUTCMinutes() / 60;
  return h.dias.includes(b.getUTCDay()) && hora >= h.desde && hora < h.hasta;
}

/** La fecha tal cual si cae en horario; si no, la siguiente apertura (8:00 del próximo día hábil). */
export function siguienteHoraLaboral(fecha: Date, h: Horario): Date {
  if (dentroDelHorarioLaboral(fecha, h)) return fecha;
  const b = enBogota(fecha);
  // Hoy a la hora de apertura (en Bogotá) y, si ya pasó, los días siguientes.
  for (let d = 0; d < 8; d += 1) {
    const dia = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate() + d, h.desde, 0, 0));
    const real = new Date(dia.getTime() + 5 * HORA);
    if (real.getTime() >= fecha.getTime() && h.dias.includes(dia.getUTCDay())) return real;
  }
  return fecha;
}

/* ---------------------------------------------------------------------------------------------- */

const COLORES = [
  "palo de rosa",
  "vino tinto",
  "rosa pastel",
  "negro",
  "blanco",
  "lila",
  "morado",
  "rosado",
  "fucsia",
  "gris",
  "beige",
  "café",
  "cafe",
  "rojo",
  "azul",
  "verde",
  "dorado",
  "plateado",
  "nude",
  "crema",
  "champaña",
  "menta",
  "turquesa",
  "amarillo",
  "naranja",
];

/** El color que eligió el cliente (lo último que nombró), si lo dijo. "Lila, que no sea morado" = lila. */
export function colorDelCliente(textos: string[]): string | null {
  for (let i = textos.length - 1; i >= 0; i -= 1) {
    const t = textos[i].toLowerCase();
    let mejor: { color: string; pos: number } | null = null;
    for (const color of COLORES) {
      const m = new RegExp(`(?<![\\p{L}])${color}(?![\\p{L}])`, "u").exec(t);
      if (!m) continue;
      // "que no sea morado": ese no es el elegido.
      if (/no\s+(?:sea|en|el|lo)?\s*$/.test(t.slice(Math.max(0, m.index - 12), m.index))) continue;
      if (!mejor || m.index < mejor.pos) mejor = { color, pos: m.index };
    }
    if (mejor) return mejor.color === "cafe" ? "café" : mejor.color;
  }
  return null;
}
