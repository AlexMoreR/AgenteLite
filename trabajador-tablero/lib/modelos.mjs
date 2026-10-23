// Qué modelo de Claude usa el Coordinador en cada paso (23-oct-2026, pedido de Alexander).
// REGLAS FIJAS EN CÓDIGO: ninguna IA decide el modelo. Todo sale de datos que la tarjeta ya trae.
//
//   planear   -> Opus SOLO si la tarea es difícil (reglas de abajo); si no, Sonnet.
//   construir -> Sonnet.      revisar -> Sonnet.      subagentes -> Sonnet.
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
  subagentes: "sonnet",
  leer: "haiku",
};

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
export function modeloDelPaso(config, paso, tarjeta = null) {
  const modelos = { ...MODELOS_POR_DEFECTO, ...(config?.modelos ?? {}) };
  if (paso === "planear") return dificultadDeLaTarea(tarjeta).dificil ? modelos.planear : modelos.planearSencillo;
  return modelos[paso];
}

/** "opus" / "claude-sonnet-4-5" -> "Opus" / "Sonnet"; un nombre raro se deja como viene. */
export function nombreDelModelo(modelo) {
  const texto = String(modelo ?? "");
  const familia = texto.match(/opus|sonnet|haiku/i)?.[0]?.toLowerCase();
  return familia ? familia[0].toUpperCase() + familia.slice(1) : texto;
}
