// Qué modelo de Claude usa el Coordinador en cada paso (23-oct-2026, pedido de Alexander).
// REGLAS FIJAS EN CÓDIGO: ninguna IA decide el modelo. Todo sale de datos que la tarjeta ya trae.
//
//   planear   -> Opus SOLO si la tarea es difícil (reglas de abajo); si no, Sonnet.
//   construir -> Sonnet.      revisar -> Sonnet.      subagentes -> Sonnet.      revisarSeguridad -> Opus.
//   Cambios con fecha (29-oct-2026): modelos.desde = [{ fecha, paso, modelo }] (p. ej. construir -> Opus desde el 30-oct).
//   leer      -> Haiku (pasos que solo leen o resumen: hoy, mirar el uso del plan con `claude -p /usage`).
//
// Los nombres de modelo se cambian en config.local.json -> modelos (ver MODELOS_POR_DEFECTO).
import { archivosDelPlan, moduloDe } from "./choques.mjs";

/**
 * `planear` = el modelo para tareas DIFÍCILES (por eso sigue llamándose igual que antes: una config vieja
 * con "planear": "opus" sigue funcionando). `planearSencillo` = el de las tareas sencillas.
 */
export const MODELOS_POR_DEFECTO = {
  planear: "opus",
  planearSencillo: "sonnet",
  construir: "sonnet",
  revisar: "sonnet",
  // 29-oct-2026 (como la Software Factory): el revisor de SEGURIDAD de la revisión de los 4 va en Opus; experiencia, diseño
  // y código usan `revisar`.
  revisarSeguridad: "opus",
  subagentes: "sonnet",
  leer: "haiku",
};

/** Los pasos que acepta `modelos.desde` (los de MODELOS_POR_DEFECTO). */
export const PASOS_CON_MODELO = Object.keys(MODELOS_POR_DEFECTO);

/**
 * Cambios de modelo CON FECHA (29-oct-2026): `modelos.desde: [{ fecha: "2026-10-30T12:00:00Z", paso: "construir", modelo: "opus" }]`.
 * Así un cambio entra solo a la hora pedida (p. ej. cuando se reinicia el uso semanal), sin que nadie edite la config.
 * Valida y normaliza: -> { desde: [{ fecha (ISO), paso, modelo }], errores: [...] }.
 */
export function cambiosDeModeloConFecha(valor) {
  const errores = [];
  if (valor === undefined || valor === null) return { desde: [], errores };
  if (!Array.isArray(valor)) return { desde: [], errores: ['modelos.desde: una lista de { "fecha", "paso", "modelo" }.'] };
  const desde = [];
  valor.forEach((entrada, i) => {
    const fecha = typeof entrada?.fecha === "string" && /^\d{4}-\d{2}-\d{2}T/.test(entrada.fecha) ? Date.parse(entrada.fecha) : NaN;
    const fechaBien = Number.isFinite(fecha);
    const pasoBien = PASOS_CON_MODELO.includes(entrada?.paso);
    const modeloBien = typeof entrada?.modelo === "string" && /^[\w.:-]+$/.test(entrada.modelo.trim());
    if (!fechaBien) errores.push(`modelos.desde[${i}].fecha: una fecha ISO con hora (p. ej. "2026-10-30T12:00:00Z").`);
    if (!pasoBien) errores.push(`modelos.desde[${i}].paso: uno de ${PASOS_CON_MODELO.join(", ")}.`);
    if (!modeloBien) errores.push(`modelos.desde[${i}].modelo: un nombre de modelo ("opus", "sonnet" o el id completo).`);
    if (fechaBien && pasoBien && modeloBien) desde.push({ fecha: new Date(fecha).toISOString(), paso: entrada.paso, modelo: entrada.modelo.trim() });
  });
  return { desde, errores };
}

/** Los modelos que valen AHORA: los de la config con, por paso, la entrada de `desde` más reciente cuya fecha ya pasó. */
export function modelosVigentes(config, ahora = Date.now()) {
  const modelos = { ...MODELOS_POR_DEFECTO, ...(config?.modelos ?? {}) };
  delete modelos.desde;
  const momento = ahora instanceof Date ? ahora.getTime() : Number(ahora);
  const vigentes = {};
  for (const entrada of Array.isArray(config?.modelos?.desde) ? config.modelos.desde : []) {
    const fecha = Date.parse(entrada?.fecha);
    if (!Number.isFinite(fecha) || fecha > momento || !entrada.paso || !entrada.modelo) continue;
    if (!vigentes[entrada.paso] || fecha >= vigentes[entrada.paso].fecha) vigentes[entrada.paso] = { fecha, modelo: entrada.modelo };
  }
  for (const [paso, { modelo }] of Object.entries(vigentes)) modelos[paso] = modelo;
  return modelos;
}

/** Cuántos caracteres de detalle hacen una tarea "larga". */
export const DETALLE_LARGO = 1200;
/** Cuántos módulos distintos (carpetas del código) nombrados hacen una tarea "de varios módulos". */
export const MODULOS_PARA_DIFICIL = 3;

/** Una marca puesta en el título o el detalle de la tarjeta: "#dificil", "[dificil]" o "[opus]". */
const MARCA_DIFICIL = /#dif[ií]cil\b|\[\s*dif[ií]cil\s*\]|\[\s*opus\s*\]/i;
/** Palabras que casi siempre son trabajo grande o delicado. */
const PALABRAS_DIFICILES =
  /\b(arquitectura|refactor\w*|rediseñ\w*|reescrib\w*|seguridad|autenticaci[oó]n|concurrencia)\b/i;

/**
 * ¿La tarea es difícil? Devuelve { dificil, motivos } con los motivos en palabras sencillas.
 * Reglas (basta UNA):
 *  1. Es un reintento (la tarjeta ya falló antes: intentos > 1).
 *  2. Tiene la marca #dificil, [dificil] o [opus] en el título o el detalle.
 *  3. Toca la base: nombra prisma/ o migraciones, o dice "migración", "prisma" o "esquema".
 *  4. Toca 3 módulos distintos o más (según las rutas que nombra), o los dos repos (gestion y aizencrm).
 *  5. El detalle es largo (más de 1200 caracteres).
 *  6. Trae una palabra de trabajo grande: arquitectura, refactor, rediseño, reescribir, seguridad,
 *     autenticación, concurrencia.
 */
export function dificultadDeLaTarea(tarjeta) {
  const titulo = String(tarjeta?.titulo ?? "");
  const detalle = String(tarjeta?.detalle ?? "");
  const texto = `${titulo}\n${detalle}`;
  const motivos = [];

  if (Number(tarjeta?.intentos) > 1) motivos.push(`es el intento ${tarjeta.intentos} (ya falló antes)`);
  if (MARCA_DIFICIL.test(texto)) motivos.push("trae la marca de difícil");

  const rutas = archivosDelPlan(texto);
  if (rutas.some((ruta) => /^(src\/)?prisma\b/.test(ruta) || /migrations?\b/.test(ruta)) || /\b(migraci[oó]n(?:es)?|prisma|esquema)\b/i.test(texto)) {
    motivos.push("toca la base de datos (prisma / migraciones)");
  }
  const modulos = new Set(rutas.map(moduloDe).filter(Boolean));
  if (modulos.size >= MODULOS_PARA_DIFICIL) motivos.push(`toca ${modulos.size} módulos distintos`);
  else if (/\baizencrm\b/i.test(texto) && /\bgestion\b/i.test(texto)) motivos.push("toca más de un repositorio");

  if (detalle.length > DETALLE_LARGO) motivos.push(`el detalle es largo (${detalle.length} caracteres)`);
  const palabra = texto.match(PALABRAS_DIFICILES)?.[1];
  if (palabra) motivos.push(`dice "${palabra.toLowerCase()}"`);

  return { dificil: motivos.length > 0, motivos };
}

/** El modelo de cada paso para esta tarjeta. `paso`: planear | construir | revisar | subagentes | leer. */
// Con `ahora`: respeta los cambios con fecha (`modelos.desde`) que ya entraron (construir -> Opus desde el 30-oct, p. ej.).
export function modeloDelPaso(config, paso, tarjeta = null, ahora = Date.now()) {
  const modelos = modelosVigentes(config, ahora);
  if (paso === "planear") return dificultadDeLaTarea(tarjeta).dificil ? modelos.planear : modelos.planearSencillo;
  return modelos[paso];
}

/** "opus" / "claude-sonnet-4-5" -> "Opus" / "Sonnet"; un nombre raro se deja como viene. */
export function nombreDelModelo(modelo) {
  const texto = String(modelo ?? "");
  const familia = texto.match(/opus|sonnet|haiku/i)?.[0]?.toLowerCase();
  return familia ? familia[0].toUpperCase() + familia.slice(1) : texto;
}
