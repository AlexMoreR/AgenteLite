/*
  REGLAS DE RIESGO del Tablero IA (aprobación automática de tareas sencillas, 22-oct-2026, decisión de
  Alexander por voz: "las cosas básicas que ayudan al negocio y no tienen riesgo, hágalas sin pedirme
  permiso; lo súper importante sí me lo manda al tablero").

  Funciones puras, sin base ni Next (pruebas: npm run test:tableros). Cada tarjeta con repo es de riesgo
  BAJO o ALTO. Una tarjeta sin riesgo cuenta como ALTO, y ante la duda es ALTO.

  Es ALTO si cumple CUALQUIERA de estas:
  1. tiene zona protegida (CHATS, BOT_VENTAS, LIBRO_V3, META_ADS; ser ALTO no frena subir: BOT_VENTAS, META_ADS,
     LIBRO_V3 y CHATS suben solas desde el 24-oct-2026 (chats, 26-oct-2026), ver ZONAS_QUE_SUBEN_SOLAS en reglas-trabajador.ts);
  2. habla de dinero (abonos, saldos, nómina, comisiones, facturación, pagos);
  3. habla de permisos, usuarios, contraseñas, claves o credenciales;
  4. envía mensajes a clientes;
  5. toca el propio trabajador o las reglas de aprobación;
  6. su migración borra o cambia algo que ya existe (DROP, ALTER destructivo, RENAME, DELETE, UPDATE, TRUNCATE);
  7. sus archivos tocan una ruta de riesgo (lista fija de acá abajo).

  La revisión por palabras marca ALTO de más a propósito: es mejor pedirle permiso al dueño de más que de menos.
  Se revisa tres veces: al crear/editar la tarjeta (título, detalle, zonas), con el plan (su línea RIESGO,
  "TOCA ZONA PROTEGIDA", la migración y los archivos) y con los archivos que de verdad cambió el trabajador.
*/

export const RIESGOS = ["BAJO", "ALTO"] as const;
export type Riesgo = (typeof RIESGOS)[number];

/** Quién puso el riesgo que tiene la tarjeta. */
export const QUIENES_PONEN_RIESGO = ["CLAUDE", "TRABAJADOR", "DUENO"] as const;
export type QuienPoneRiesgo = (typeof QUIENES_PONEN_RIESGO)[number];

export const NOMBRE_DE_QUIEN_PONE_RIESGO: Record<QuienPoneRiesgo, string> = {
  CLAUDE: "Claude",
  TRABAJADOR: "el trabajador",
  DUENO: "el dueño",
};

export function esRiesgo(valor: unknown): valor is Riesgo {
  return typeof valor === "string" && (RIESGOS as readonly string[]).includes(valor);
}

export function esQuienPoneRiesgo(valor: unknown): valor is QuienPoneRiesgo {
  return typeof valor === "string" && (QUIENES_PONEN_RIESGO as readonly string[]).includes(valor);
}

/** riesgo como lo mandan: BAJO / ALTO (cualquier mayúscula), "" / null para quitarlo, undefined si no vino. */
export function riesgoDeEntrada(valor: unknown): Riesgo | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null || (typeof valor === "string" && valor.trim() === "")) return null;
  const limpio = typeof valor === "string" ? valor.trim().toUpperCase() : valor;
  if (!esRiesgo(limpio)) throw new Error("Ese riesgo no existe. Van: BAJO o ALTO.");
  return limpio;
}

/** El riesgo que cuenta: sin riesgo (null / desconocido) es ALTO. */
export function riesgoEfectivo(valor: unknown): Riesgo {
  return valor === "BAJO" ? "BAJO" : "ALTO";
}

/** El motivo de riesgo, limpio (una frase). */
export function motivoDeRiesgoDeEntrada(valor: unknown): string | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  if (typeof valor !== "string") throw new Error("motivo_riesgo va como texto.");
  return valor.replace(/\s+/g, " ").trim().slice(0, 300) || null;
}

/* ───────────────────────────────────────────────────────────────────── texto ── */

/** Minúsculas, sin tildes y con espacios simples, para buscar palabras. */
function normalizar(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

type ReglaDeTexto = { motivo: string; patron: RegExp };

/** Las palabras que vuelven ALTO una tarjeta (sobre el texto normalizado). */
const PALABRAS_DE_RIESGO: readonly ReglaDeTexto[] = [
  {
    motivo: "habla de dinero (abonos, saldos, nómina, comisiones, facturación o pagos)",
    patron:
      /\b(abono\w*|saldo\w*|nomina\w*|comision\w*|factura\w*|pago\w*|pagar\w*|cobr\w*|dinero|plata|tesoreria|reembols\w*|devolucion\w* de dinero|salario\w*|sueldo\w*|prestacion\w*|gasto\w*|cotizacion\w*|precio\w*|costo\w*|descuento\w*|banc\w*|transferencia\w*|wompi|stripe|mercado ?pago|balance\w*|ingreso\w*|ganancia\w*|deuda\w*|cartera|contabilidad|cuenta\w* (de )?cobro|contraentrega)\b/,
  },
  {
    motivo: "habla de permisos, usuarios, contraseñas, claves o credenciales",
    patron:
      /\b(permiso\w*|usuario\w*|contrasena\w*|password\w*|clave\w*|credencial\w*|login|inicio de sesion|sesion(es)?|autenticaci\w*|token\w*|secret\w*|rol(es)?|api key\w*|apikey\w*)\b/,
  },
  {
    motivo: "envía mensajes a clientes",
    patron:
      /\b(whatsapp|mensajer\w*|difusion\w*|e-?mail\w*|correo\w*|sms|telegram|messenger|instagram|seguimiento\w*|follow\w*|recordatorio\w*|plantilla\w* de (mensaje|whatsapp)|envi\w* (de )?(un |el |los |las )?(mensaje|correo|sms|aviso|notificacion)\w*|mand\w* (un |el |los |las )?(mensaje|correo|sms|aviso|notificacion)\w*|notific\w* a (los |las )?cliente\w*|(mensaje|correo|sms|aviso)\w* (a|para) (los |las |el |la )?(cliente|comprador|lead|contacto)\w*|recordatorio\w* a (los |las )?cliente\w*|campana\w*|chats?|conversacion\w*)\b/,
  },
  {
    motivo: "toca el propio trabajador o las reglas de aprobación",
    patron:
      /\b(trabajador|coordinador|aprobacion\w*|aprobar\w*|aprobad\w*|interruptor de aprobacion|zonas? protegida\w*|riesgo (bajo|alto)|reglas? de riesgo|tablero[- ]?ia|tableros inteligentes)\b/,
  },
  {
    motivo: "toca una zona protegida (chats, bot de ventas, libro V3 o Meta Ads)",
    patron: /\b(bot de ventas|agente v3|libro v3|meta ads|anuncio\w*|pixel|evolution api|webhook\w*|embudo\w*)\b/,
  },
];

/** Los motivos por los que un texto libre (título y detalle de la tarjeta) pide ALTO. */
export function motivosDelTexto(...textos: (string | null | undefined)[]): string[] {
  const todo = normalizar(textos.filter(Boolean).join("\n"));
  if (!todo) return [];
  return PALABRAS_DE_RIESGO.filter((regla) => regla.patron.test(todo)).map((regla) => regla.motivo);
}

/* ───────────────────────────────────────────────────────────────────── archivos ── */

/**
 * Las rutas de riesgo (lista fija: sumar una es cambiar el código). Son patrones sobre la ruta completa
 * desde la raíz del repo, sin mayúsculas ni tildes.
 */
const RUTAS_DE_RIESGO: readonly { motivo: string; patron: RegExp }[] = [
  { motivo: "toca el trabajador (trabajador-tablero/)", patron: /^trabajador-tablero\// },
  {
    motivo: "toca el trabajador o las reglas de aprobación del tablero",
    patron:
      /(^|\/)(reglas(-[a-z-]+)?|aprobacion-automatica|resumen-diario|trabajador|sql-trabajador|aviso-del-trabajador)\.(ts|tsx|mjs|js)$|^src\/app\/api\/trabajador\/|^scripts\/check-tablero/,
  },
  {
    motivo: "toca dinero (abonos, saldos, nómina, comisiones o facturación)",
    patron: /(abono|saldo|nomina|comision|factura|pago|payment|billing|tesoreria|reembols)/,
  },
  {
    motivo: "toca permisos, usuarios, login o credenciales",
    patron:
      /(^|\/)(auth\.ts|auth\.config\.ts|middleware\.ts)$|(login|permiso|permission|password|contrasena|credencial|secret|session|autenticacion|api-keys?|claves?)|^src\/app\/api\/auth\//,
  },
  {
    motivo: "toca las rutas de chats, del bot de ventas, del libro V3 o de Meta Ads",
    patron:
      /(^|\/)(chats?|conversaciones|whatsapp|evolution|webhooks?|agentes?|agente-v3|bot|bot-ventas|libro-v3|v3|meta-ads|metaads|ads|anuncios|embudos?|flujos?|mensajeria|difusion)(\/|[-.])|^src\/lib\/mcp\/(agente|v3|embudo)/,
  },
];

/** Los motivos por los que esta lista de archivos pide ALTO (cada motivo con un par de archivos de ejemplo). */
export function motivosDeLosArchivos(archivos: readonly string[]): string[] {
  const rutas = archivos.map((ruta) => normalizar(String(ruta).replace(/\\/g, "/")).replace(/^\.\//, ""));
  const motivos: string[] = [];
  for (const regla of RUTAS_DE_RIESGO) {
    const tocados = rutas.filter((ruta) => regla.patron.test(ruta));
    if (tocados.length) motivos.push(`${regla.motivo}: ${tocados.slice(0, 3).join(", ")}${tocados.length > 3 ? "…" : ""}`);
  }
  return motivos;
}

/* ───────────────────────────────────────────────────────────────────── migraciones ── */

/**
 * Las instrucciones de SQL que borran o cambian lo que ya existe. Se buscan en el SQL de la migración
 * (sin comentarios). ADD COLUMN / CREATE TABLE / CREATE INDEX no calzan.
 */
const SQL_DESTRUCTIVO: readonly { que: string; patron: RegExp }[] = [
  { que: "DROP", patron: /\bdrop\b/i },
  { que: "TRUNCATE", patron: /\btruncate\b/i },
  { que: "DELETE", patron: /\bdelete\b/i },
  { que: "UPDATE", patron: /\bupdate\b/i },
  { que: "RENAME", patron: /\brename\b/i },
  // Cambiar una columna que ya existe (tipo, NOT NULL, default). ALTER TYPE ... ADD VALUE y ADD COLUMN son aditivos.
  { que: "ALTER destructivo", patron: /\balter\s+table\b[^;]*\balter\s+column\b/i },
];

/**
 * Le quita los comentarios (-- y bloque), los textos entre comillas simples y las acciones de las llaves
 * foráneas (ON DELETE CASCADE / ON UPDATE CASCADE: Prisma las escribe en cada tabla nueva y no tocan datos).
 */
function sqlSinComentarios(sql: string) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/\bon\s+(?:delete|update)\s+(?:cascade|restrict|set\s+null|set\s+default|no\s+action)\b/gi, " ");
}

/** Qué tiene de destructivo un SQL de migración ([] si no tiene nada: solo aditiva o vacía). */
export function destructivoDelSql(sql: string | null | undefined): string[] {
  if (!sql) return [];
  const limpio = sqlSinComentarios(sql);
  const encontrados = SQL_DESTRUCTIVO.filter((regla) => regla.patron.test(limpio)).map((regla) => regla.que);
  return [...new Set(encontrados)];
}

/** ¿La ruta es el SQL de una migración de Prisma? */
export const esArchivoDeMigracion = (ruta: string) => /(^|\/)migrations\/[^/]+\/migration\.sql$/i.test(ruta.replace(/\\/g, "/"));

/* ───────────────────────────────────────────────────────────────────── el plan ── */

export type RiesgoDelPlan = {
  /** Lo que dice la línea "RIESGO: BAJO|ALTO — motivo"; null si el plan no la trae. */
  declarado: Riesgo | null;
  /** El motivo que trae esa línea. */
  motivoDeclarado: string | null;
  /** Por qué el CRM, al revisar el plan, pide ALTO (vacío = el plan no muestra riesgo alto). */
  motivosAlto: string[];
};

const LINEA_DE_RIESGO = /^[ \t>*_#-]*\**riesgo\**\s*:\s*\**\s*(bajo|alto)\b\**\s*(?:[—–:-]+\s*(.*))?$/im;

/** El texto de la parte de un plan (1. ... 2. ...) cuyo título calza con `titulo`, hasta la parte que sigue. */
export function parteDelPlan(plan: string, titulo: RegExp): string | null {
  const lineas = plan.replace(/\r\n/g, "\n").split("\n");
  const esTitulo = (linea: string) => /^\s*(?:#{1,6}\s*)?(?:\*\*)?(?:\d+\s*[.)]|parte\s+\d+)/i.test(linea) || /^\s*#{1,6}\s+\S/.test(linea);
  // Se juntan TODAS las partes cuyo título calza (no solo la primera): un título parecido más arriba
  // ("Qué se cambia en los archivos") no puede esconder la parte de verdad.
  const partes: string[] = [];
  for (let inicio = 0; inicio < lineas.length; inicio += 1) {
    if (!(esTitulo(lineas[inicio]) && titulo.test(normalizar(lineas[inicio])))) continue;
    let fin = lineas.length;
    for (let i = inicio + 1; i < lineas.length; i += 1) {
      if (esTitulo(lineas[i])) {
        fin = i;
        break;
      }
    }
    partes.push(lineas.slice(inicio, fin).join("\n"));
    inicio = fin - 1;
  }
  return partes.length ? partes.join("\n") : null;
}

/** Las rutas de archivo que nombra un texto (algo/otro.ext, con al menos una carpeta). */
export function rutasDelTexto(texto: string): string[] {
  const rutas = new Set<string>();
  for (const calce of texto.matchAll(/(?:^|[\s`"'(\[,])((?:[\w@.\-[\]()]+\/)+[\w@.\-[\]()*]+)/g)) {
    const ruta = calce[1].replace(/[.,;:)]+$/, "");
    if (/[\w\]]$/.test(ruta) && !/^https?:/i.test(ruta)) rutas.add(ruta);
  }
  return [...rutas];
}

const ZONA_EN_EL_PLAN = /(?<!\bno\s)toca zona protegida|espera tu s[ií]\s*\(toca/;

/**
 * Revisa el plan que escribió el trabajador: su línea de riesgo, si dice que toca zona protegida, la
 * parte de la migración y la lista de archivos. Un plan sin la línea de riesgo (un trabajador sin
 * actualizar) cuenta como ALTO.
 */
export function riesgoDelPlan(plan: string): RiesgoDelPlan {
  const texto = plan.replace(/\r\n/g, "\n");
  // Si el plan trae varias líneas RIESGO (por ejemplo una BAJO y otra ALTO), gana la ALTO: ante la duda, ALTO.
  const lineas = [...texto.matchAll(new RegExp(LINEA_DE_RIESGO.source, "gim"))];
  const linea = lineas.find((una) => una[1].toLowerCase() === "alto") ?? lineas[0] ?? null;
  const declarado = linea ? (linea[1].toUpperCase() as Riesgo) : null;
  const motivoDeclarado = linea?.[2]?.replace(/\*+/g, "").trim() || null;
  const motivosAlto: string[] = [];
  if (!declarado) motivosAlto.push("el plan no trae la línea RIESGO (si hay duda, es ALTO)");
  if (declarado === "ALTO") motivosAlto.push(`el trabajador dice RIESGO: ALTO${motivoDeclarado ? ` (${motivoDeclarado})` : ""}`);
  if (ZONA_EN_EL_PLAN.test(texto.toLowerCase())) motivosAlto.push("el plan dice que toca una zona protegida");

  const migracion = parteDelPlan(texto, /migracion/);
  if (migracion) {
    const destructivo = destructivoDelSql(migracion);
    if (destructivo.length) motivosAlto.push(`la migración del plan trae algo que borra o cambia lo que existe (${destructivo.join(", ")})`);
  }
  const archivos = parteDelPlan(texto, /archivos?/);
  // Las rutas de la parte de archivos y, además, cualquiera que el plan nombre en otra parte: ante la duda, ALTO.
  const rutas = [...new Set([...rutasDelTexto(archivos ?? ""), ...rutasDelTexto(texto)])];
  motivosAlto.push(...motivosDeLosArchivos(rutas));
  return { declarado, motivoDeclarado, motivosAlto };
}

/* ─────────────────────────────────────────────────────────── el sí del plan (regla 24-oct) ── */

/*
  Regla del dueño (24-oct-2026): aprobada la tarea, el plan pasa solo a construir. ÚNICA excepción: el plan
  espera el sí del dueño si toca dinero en Gestión o puede subir presupuesto, activar campañas o crear gasto
  en Meta Ads. Lo dice el Coordinador en la línea "APROBAR PLAN: SOLO" o "APROBAR PLAN: ESPERA TU SÍ — motivo"
  y el CRM lo revisa por su cuenta como respaldo (más estricto que el Coordinador).
*/

const LINEA_APROBAR_PLAN = /^[ \t>*_#-]*\**aprobar plan\**\s*:\s*\**\s*(solo|espera tu si)(?![a-z])(.*)$/;

/** Lo que dice el plan sobre su propio sí; null si no trae la línea. El motivo queda como lo escribió el Coordinador. */
export function lineaAprobarPlan(plan: string): { espera: boolean; motivo: string | null } | null {
  const encontradas: { espera: boolean; motivo: string | null }[] = [];
  for (const original of plan.replace(/\r\n/g, "\n").split("\n")) {
    const calce = LINEA_APROBAR_PLAN.exec(normalizar(original));
    if (!calce) continue;
    // El motivo se toma de la línea original (con tildes y mayúsculas): lo que sigue a SOLO / ESPERA TU SÍ y al guion.
    // Tolera "ESPERA TU SÍ.", "ESPERA TU SÍ (motivo)" y "ESPERA TU SÍ — motivo".
    let motivo = original.replace(/^.*?(?:solo|espera tu s[ií])(?![a-zA-Z])[\s*.—–:()-]*/i, "").replace(/\*+/g, "").trim();
    if (!motivo.includes("(")) motivo = motivo.replace(/\)\s*$/, "").trim();
    encontradas.push({ espera: calce[1] === "espera tu si", motivo: motivo || null });
  }
  if (!encontradas.length) return null;
  // Si trae varias líneas, gana la que espera: ante la duda, se pide el sí.
  return encontradas.find((una) => una.espera) ?? encontradas[0];
}

const PALABRAS_DE_DINERO_DE_GESTION = /\b(abono\w*|saldo\w*|nomina\w*|comision\w*|factura\w*|pago\w*|pagar\w*)\b/;

const PALABRAS_DE_GASTO_EN_META =
  /\b(presupuesto\w*|budget\w*|(activ\w*|encend\w*|prend\w*|lanz\w*|reanud\w*|publica\w*|cre[ao]\w*) (las |los |la |el |una |un |nuevas? |nuevos? )?(campan\w*|anuncio\w*|ads)|(subir|aumentar|subid\w*|aument\w*|crear|cree|crea) (el |un |nuevo )?gasto\w*|gasto\w* (en|de|con) (meta|anuncio\w*|publicidad|ads)|gastar en (meta|anuncio\w*|publicidad|ads))\b/;

/** La marca del plan para los cambios de Meta Ads que gastan plata (24-oct-2026): "GASTO EN META ADS: <qué>". */
export const MARCA_GASTO_EN_META_ADS = "GASTO EN META ADS";

const LINEA_GASTO_EN_META_ADS = /^[ \t>*_#-]*\**gasto en meta ads\**\s*[:.\u2014\u2013-]?\s*\**\s*(.*)$/;
const SIN_GASTO = /^(no|ninguno|ninguna|sin|n\/a|cero)(?![a-z])/;

/**
 * ¿El plan declara una línea "GASTO EN META ADS: ..."? Es la forma en que el Coordinador dice que el cambio sube
 * presupuesto, prende campañas, conjuntos o anuncios o crea gasto nuevo. "GASTO EN META ADS: no / ninguno" no cuenta.
 * Devuelve lo que dijo (o la marca sola), o null si no la trae.
 */
export function gastoDeclaradoEnElPlan(plan: string): string | null {
  for (const original of plan.replace(/\r\n/g, "\n").split("\n")) {
    const calce = LINEA_GASTO_EN_META_ADS.exec(normalizar(original));
    if (!calce) continue;
    if (SIN_GASTO.test(calce[1].trim())) continue;
    return calce[1].trim() ? `${MARCA_GASTO_EN_META_ADS}: ${original.replace(/^.*?gasto en meta ads[\s*:.\u2014\u2013-]*/i, "").replace(/\*+/g, "").trim()}` : MARCA_GASTO_EN_META_ADS;
  }
  return null;
}

/* ─────────────────────────────────────────────── preguntas abiertas del plan (29-oct-2026) ── */

/*
  Un plan con preguntas abiertas no se aprueba solo (tarjeta ykpl83z3: el plan decía "hay que confirmarlo" y "Antes de
  construir hay que revisar con el CRM…", se aprobó solo y se construyó 4 veces en la nube sin resultado). La instrucción
  de planear pide una sección final "PREGUNTAS ABIERTAS:" (o "ninguna"); además se buscan las frases que delatan una duda.
  ESPEJO de trabajador-tablero/lib/preguntas-abiertas.mjs: si cambia una regla acá, cambiarla allá igual.
*/

const ENCABEZADO_DE_PREGUNTAS = /^[\s>#*_-]*preguntas abiertas\**\s*:?\**\s*(.*)$/;
const SIN_PREGUNTAS = /^[\s*_.:\-—–]*(ninguna?s?|no hay( ninguna?)?|sin preguntas( abiertas)?|n\/a|-|—)[\s*_.!]*$/;
const FRASES_DE_DUDA = [
  /hay que confirmar/,
  // "queda pendiente" solo al final de la línea o antes de ":" (una venta "queda pendiente de pago" no es una duda).
  /quedan? pendientes?\s*(?::|$)/,
  /pendientes? de (?:confirmar|revisar|decidir|comprobar|definir)/,
  /no pude (?:comprobar|confirmar|verificar|revisar)/,
  /lo que no revise/,
  /antes de construir hay que/,
  /falta (?:decidir|confirmar|definir)/,
];

const lineaLimpia = (linea: string) =>
  linea
    .replace(/^[\s>*_#-]*(?:\d+[.)]\s*)?/, "")
    .replace(/\*+/g, "")
    .trim();

const esOtroEncabezadoDelPlan = (linea: string) =>
  /^\s*#{1,6}\s/.test(linea) || /^\s*\**\s*\d+[.)]\s+\**[A-ZÁÉÍÓÚ]/.test(linea) || /^\s*Plan escrito con:/i.test(linea);

/** Las preguntas abiertas del plan, en orden, cada una en una línea ([] si no tiene). */
export function preguntasAbiertasDelPlan(plan: string): string[] {
  const lineas = plan.replace(/\r\n/g, "\n").split("\n");
  const preguntas: string[] = [];
  const agregar = (texto: string) => {
    const una = lineaLimpia(texto).replace(/\s+/g, " ");
    if (una && !preguntas.includes(una)) preguntas.push(una);
  };
  for (let i = 0; i < lineas.length; i += 1) {
    const calce = ENCABEZADO_DE_PREGUNTAS.exec(normalizar(lineas[i]));
    if (!calce) continue;
    if (calce[1].trim() && !SIN_PREGUNTAS.test(calce[1])) agregar(lineas[i].replace(/^[\s>#*_-]*preguntas abiertas\**\s*:?\**\s*/i, ""));
    for (let j = i + 1; j < lineas.length; j += 1) {
      if (!lineas[j].trim()) continue;
      if (/^\s*#{1,6}\s/.test(lineas[j]) || /^\s*Plan escrito con:/i.test(lineas[j])) break;
      if (!SIN_PREGUNTAS.test(normalizar(lineas[j]))) agregar(lineas[j]);
    }
  }
  for (let i = 0; i < lineas.length; i += 1) {
    const texto = normalizar(lineas[i]);
    if (ENCABEZADO_DE_PREGUNTAS.test(texto) || !FRASES_DE_DUDA.some((frase) => frase.test(texto))) continue;
    let pregunta = lineaLimpia(lineas[i]);
    if (/:\s*$/.test(pregunta)) {
      const siguiente = lineas.slice(i + 1).find((linea) => linea.trim());
      if (siguiente && !esOtroEncabezadoDelPlan(siguiente)) pregunta = `${pregunta} ${lineaLimpia(siguiente)}`;
    }
    agregar(pregunta);
  }
  return preguntas;
}

/** El motivo para no aprobar solo un plan con preguntas abiertas ("el plan tiene preguntas abiertas: <la primera>"), o null. */
export function porQueElPlanTienePreguntas(plan: string): string | null {
  const [primera] = preguntasAbiertasDelPlan(plan);
  return primera ? `el plan tiene preguntas abiertas: ${primera}`.slice(0, 300) : null;
}

/**
 * ¿El plan espera el sí del dueño aunque la tarea ya esté aprobada? Devuelve el motivo en una línea, o null
 * si el plan pasa solo a construir. Sin base: se prueba con `npm run test:tableros`.
 */
export function porQueElPlanEsperaTuSi(plan: string): string | null {
  // 29-oct-2026: un plan con preguntas abiertas espera al dueño (lo que sea que diga su línea APROBAR PLAN).
  const preguntas = porQueElPlanTienePreguntas(plan);
  if (preguntas) return preguntas;
  const linea = lineaAprobarPlan(plan);
  if (linea?.espera) return `el trabajador dice que espera tu sí${linea.motivo ? `: ${linea.motivo}` : ""}`.slice(0, 300);
  const texto = plan.replace(/\r\n/g, "\n");
  const gasto = gastoDeclaradoEnElPlan(texto);
  if (gasto) return `el plan declara gasto en Meta Ads (${gasto})`.slice(0, 300);
  // Archivos de dinero: las mismas rutas que ya vuelven ALTO una tarjeta.
  const dinero = motivosDeLosArchivos(rutasDelTexto(texto)).find((motivo) => motivo.startsWith("toca dinero"));
  if (dinero) return `el plan ${dinero}`.slice(0, 300);
  const normal = normalizar(texto);
  if (PALABRAS_DE_GASTO_EN_META.test(normal)) return "el plan habla de presupuesto, de activar campañas o de gasto en Meta Ads";
  // Sin la línea (un trabajador sin actualizar) no hay quien diga que no toca dinero: se miran las palabras.
  if (!linea && PALABRAS_DE_DINERO_DE_GESTION.test(normal)) {
    return "el plan habla de dinero de Gestión (abonos, saldos, nómina, comisiones, facturación o pagos) y no trae la línea APROBAR PLAN";
  }
  return null;
}

/* ─────────────────────────────────────────────────────── el sí de la tarea (regla 25-oct) ── */

/**
 * Regla del dueño (25-oct-2026): toda tarea con repo que entra en POR_APROBAR pasa sola a APROBADO. ÚNICA
 * excepción: espera el sí del dueño si su título o detalle hablan de dinero de Gestión (abonos, saldos, nómina,
 * comisiones, facturación, pagos) o de subir presupuesto, activar campañas o crear gasto en Meta Ads (las mismas
 * palabras que frenan los planes), o si tiene una zona que no arranca sola (META_ADS, LIBRO_V3).
 * Devuelve el motivo en una línea, o null si la tarea arranca sola. Sin base: se prueba con `npm run test:tableros`.
 */
export function porQueLaTareaEsperaTuSi(datos: {
  titulo: string;
  detalle: string;
  zonaProtegida: readonly string[];
  /** Zonas que no arrancan solas (reglas-trabajador.ts); se pasan para que este archivo siga sin imports. */
  zonasQueEsperan: readonly string[];
}): string | null {
  if (datos.zonasQueEsperan.length) return `tiene zona protegida que espera tu sí (${datos.zonasQueEsperan.join(", ")})`;
  const normal = normalizar(`${datos.titulo}\n${datos.detalle}`);
  if (PALABRAS_DE_DINERO_DE_GESTION.test(normal)) {
    return "habla de dinero de Gestión (abonos, saldos, nómina, comisiones, facturación o pagos)";
  }
  if (PALABRAS_DE_GASTO_EN_META.test(normal)) return "habla de presupuesto, de activar campañas o de gasto en Meta Ads";
  return null;
}

/* ───────────────────────────────────────────────────────────────────── la tarjeta ── */

/** Lo que se sabe de una tarjeta para decidir su riesgo al crearla o editarla. */
export type DatosParaRiesgo = {
  titulo: string;
  detalle: string;
  repo: string | null;
  zonaProtegida: readonly string[];
};

/** Por qué esta tarjeta no puede ser BAJO (vacío = nada de riesgo alto a la vista). */
export function motivosDeRiesgoAlto(datos: DatosParaRiesgo): string[] {
  const motivos: string[] = [];
  if (!datos.repo) motivos.push("no tiene repo (no la ejecuta el trabajador)");
  if (datos.zonaProtegida.length) motivos.push(`tiene zona protegida (${datos.zonaProtegida.join(", ")})`);
  motivos.push(...motivosDelTexto(datos.titulo, datos.detalle));
  // Una migración destructiva escrita en el detalle (DROP, DELETE, UPDATE...) tampoco puede ser BAJO.
  const destructivo = destructivoDelSql(`${datos.titulo}\n${datos.detalle}`);
  if (destructivo.length) motivos.push(`el texto habla de una migración que borra o cambia lo que existe (${destructivo.join(", ")})`);
  return motivos;
}

/** Los motivos en una frase para decirle a la persona. */
export const frase = (motivos: readonly string[]) => motivos.join("; ");

export type PedidoDeRiesgo = {
  /** Quién lo pide. */
  quien: QuienPoneRiesgo;
  /** El riesgo que pide (undefined = no lo toca). */
  pedido: Riesgo | null | undefined;
  /** El riesgo que tiene la tarjeta hoy y quién lo puso. */
  actual: Riesgo | null;
  actualPor: string | null;
  datos: DatosParaRiesgo;
};

/**
 * ¿Se puede poner ese riesgo? BAJO solo si las reglas no encuentran nada de riesgo alto. Claude no puede
 * bajar a BAJO una tarjeta que el trabajador o el dueño dejaron en ALTO. Devuelve el error o null.
 */
export function problemaDelRiesgo(pedido: PedidoDeRiesgo): string | null {
  if (pedido.pedido !== "BAJO") return null;
  const motivos = motivosDeRiesgoAlto(pedido.datos);
  if (motivos.length) {
    return `No puede ser riesgo BAJO: ${frase(motivos)}. Queda para que el dueño la apruebe (riesgo ALTO).`;
  }
  if (pedido.quien === "CLAUDE" && pedido.actual === "ALTO" && (pedido.actualPor === "TRABAJADOR" || pedido.actualPor === "DUENO")) {
    return `Esta tarjeta quedó en riesgo ALTO por ${pedido.actualPor === "DUENO" ? "el dueño" : "el trabajador"}: Claude no la baja a BAJO. Lo cambia el dueño en la pantalla.`;
  }
  return null;
}

/**
 * ¿Una tarjeta se aprueba sola (la tarea o el plan)? Solo con el interruptor prendido, con repo, BAJO,
 * sin zona protegida y sin nada de riesgo alto a la vista. Devuelve el motivo de por qué NO, o null.
 */
export function porQueNoSeApruebaSola(datos: DatosParaRiesgo & { riesgo: string | null; prendido: boolean }): string | null {
  if (!datos.prendido) return "la aprobación automática está apagada";
  if (!datos.repo) return "no tiene repo";
  if (datos.riesgo !== "BAJO") return "no está marcada con riesgo BAJO";
  const motivos = motivosDeRiesgoAlto(datos);
  return motivos.length ? frase(motivos) : null;
}

/* ───────────────────────────────────────────────────────────────────── la revisión final ── */

/**
 * La última revisión, al terminar de construir: el trabajador manda los archivos que de verdad cambió y
 * si la migración trae algo destructivo. Devuelve los motivos de riesgo alto (vacío = sigue como estaba).
 * Si no manda la lista de archivos, no se puede revisar: es ALTO.
 */
export function motivosDelResultado(datos: {
  archivos: readonly string[] | null;
  migracionDestructiva: string[] | boolean | null;
  zonaProtegida: readonly string[];
}): string[] {
  const motivos: string[] = [];
  if (datos.zonaProtegida.length) motivos.push(`el cambio toca una zona protegida (${datos.zonaProtegida.join(", ")})`);
  if (datos.archivos === null) motivos.push("el trabajador no mandó la lista de archivos que cambió (si hay duda, es ALTO)");
  else motivos.push(...motivosDeLosArchivos(datos.archivos));
  const destructivo = Array.isArray(datos.migracionDestructiva) ? datos.migracionDestructiva : datos.migracionDestructiva ? ["algo"] : [];
  if (destructivo.length) motivos.push(`la migración borra o cambia lo que ya existe (${destructivo.join(", ")})`);
  // Cambió una migración y el trabajador no dijo si es destructiva: no se puede revisar, es ALTO.
  if (datos.migracionDestructiva === null && datos.archivos?.some(esArchivoDeMigracion)) {
    motivos.push("el cambio trae una migración y el trabajador no mandó si borra o cambia algo (si hay duda, es ALTO)");
  }
  return motivos;
}

/** La lista de archivos que manda el trabajador, limpia (hasta 300), o null si no vino. */
export function archivosDeEntrada(valor: unknown): string[] | null {
  if (!Array.isArray(valor)) return null;
  return valor
    .filter((ruta): ruta is string => typeof ruta === "string" && ruta.trim() !== "")
    .map((ruta) => ruta.trim().slice(0, 300))
    .slice(0, 300);
}

/** Lo destructivo de la migración que manda el trabajador: lista de palabras, true / false, o null si no vino. */
export function migracionDestructivaDeEntrada(valor: unknown): string[] | boolean | null {
  if (Array.isArray(valor)) {
    return valor.filter((algo): algo is string => typeof algo === "string").map((algo) => algo.slice(0, 40)).slice(0, 10);
  }
  if (typeof valor === "boolean") return valor;
  return null;
}
