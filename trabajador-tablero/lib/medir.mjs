// MEDIR ANTES DE ARRANCAR (26-oct-2026, queja del dueño: "¿para qué tengo un coordinador si no sabe que si mandamos todos
// esos trabajos se van a bloquear?"). Puro: sin disco, red ni procesos.
//
// Antes de escribir el plan, el Coordinador mira la tarjeta y decide si es chica, mediana o grande. Con eso evita
// planear algo que no cabe en una sola sesión (las tarjetas "Reuniones", "Coordinador autónomo" y "GitHub Actions" se
// cortaron a los 18-19 min escribiendo el plan). Reglas fijas, sin IA:
//   - el largo del texto, cuántos puntos pide, y si menciona una migración, una pantalla o módulo nuevo, o un agente nuevo;
//   - si con eso no queda claro ("dudosa"), una consulta corta y barata a Haiku (etapas.mjs: consultarTamanoConClaude);
//   - si es GRANDE se parte en 2 a 4 tarjetas hijas, en orden, ANTES de planear (bucle.mjs: medirAntesDePlanear).
// Una tarjeta que ya es una parte, o que ya está partida, o que viene de una reparación, NO se vuelve a partir.
//
// También busca las tarjetas que la del texto nombra como molde o requisito (por su id): el Coordinador pone esa flecha
// de dependencia solo (Marketing y Sistemas dependían del molde del Agente de Ventas, que no existía).
import { archivosDelPlan } from "./choques.mjs";

/** Lo que viene por defecto en config.medir. */
export const MEDIR_POR_DEFECTO = {
  activo: true,
  // Caracteres de título + detalle: desde `textoMediano` suma 1 punto; desde `textoLargo`, 2.
  textoMediano: 1800,
  textoLargo: 3500,
  // Puntos: desde `puntosDudosa` no queda claro (se consulta a Haiku); desde `puntosGrande` es grande.
  puntosDudosa: 4,
  puntosGrande: 6,
  consultaHaiku: true,
  haikuMinutos: 2,
};

/** Una línea de lista: "- algo", "* algo", "1. algo", "2) algo". */
const LINEA_DE_PUNTO = /^\s*(?:[-*•]|\d{1,2}[.)])\s+\S/;

const NEGADO = "\\b(?:sin|no|ninguna?|cero)\\b[^\\n.]{0,25}";
const MIGRACION = new RegExp(`(?<!${NEGADO})\\b(?:migraci[oó]n(?:es)?|schema\\.prisma|tabla nueva|modelo nuevo|columna nueva)\\b`, "i");
const PANTALLA_NUEVA = /\b(?:(?:pantalla|m[oó]dulo|p[aá]gina|vista|pesta[ñn]a|panel)\s+(?:nuev[oa]|completa|aparte)|nuev[oa]\s+(?:pantalla|m[oó]dulo|p[aá]gina|vista|pesta[ñn]a|panel)|crear\s+(?:una?\s+|el\s+|la\s+)?(?:pantalla|m[oó]dulo))\b/i;
const AGENTE_NUEVO = /\b(?:agente\s+nuevo|nuevo\s+agente|crear\s+(?:un\s+|el\s+|al\s+)?agente)\b/i;

/**
 * Mide una tarjeta. -> { tamano: "chica" | "mediana" | "dudosa" | "grande", puntos, senales: [texto], omitida?: motivo }
 * `omitida`: no se mide (apagado, ya es una parte, ya está partida o viene de una reparación): nunca se parte.
 */
export function medirTarjeta(tarjeta, opciones = {}) {
  const topes = { ...MEDIR_POR_DEFECTO, ...opciones };
  if (!topes.activo) return { tamano: "chica", puntos: 0, senales: [], omitida: "apagado" };
  if (tarjeta?.esParte) return { tamano: "chica", puntos: 0, senales: [], omitida: "ya es una parte" };
  if (tarjeta?.resultado?.partida) return { tamano: "chica", puntos: 0, senales: [], omitida: "ya está partida" };
  if (Number(tarjeta?.reparaciones) > 0 || tarjeta?.reparacion) return { tamano: "chica", puntos: 0, senales: [], omitida: "viene de una reparación" };

  const titulo = String(tarjeta?.titulo ?? "");
  const detalle = String(tarjeta?.detalle ?? "");
  const texto = `${titulo}\n${detalle}`;
  const senales = [];
  let puntos = 0;
  const sumar = (cuantos, motivo) => {
    puntos += cuantos;
    senales.push(`${motivo} (+${cuantos})`);
  };

  if (texto.length > topes.textoLargo) sumar(2, `texto largo (${texto.length} caracteres)`);
  else if (texto.length > topes.textoMediano) sumar(1, `texto de largo medio (${texto.length} caracteres)`);

  const pedidos = detalle.split(/\r?\n/).filter((linea) => LINEA_DE_PUNTO.test(linea)).length;
  if (pedidos > 12) sumar(2, `pide ${pedidos} puntos`);
  else if (pedidos > 6) sumar(1, `pide ${pedidos} puntos`);

  if (MIGRACION.test(texto)) sumar(2, "menciona una migración de la base");
  if (PANTALLA_NUEVA.test(texto)) sumar(2, "pide una pantalla o módulo nuevo");
  if (AGENTE_NUEVO.test(texto)) sumar(2, "pide un agente nuevo");

  const archivos = archivosDelPlan(texto).length;
  if (archivos > 20) sumar(3, `nombra ${archivos} archivos`);
  else if (archivos > 8) sumar(1, `nombra ${archivos} archivos`);

  const tamano = puntos >= topes.puntosGrande ? "grande" : puntos >= topes.puntosDudosa ? "dudosa" : puntos >= 2 ? "mediana" : "chica";
  return { tamano, puntos, senales };
}

const ID_DE_TARJETA = /\bcm[a-z0-9]{20,30}\b/g;
/** Palabras que dicen "esta tarjeta necesita a la otra": molde, requisito, base, "depende de", "espera a". */
const PIDE_A_OTRA = /\b(?:molde|requisito|prerrequisito|plantilla|depende\s+de|dependiente\s+de|necesita|requiere|espera\s+a|despu[eé]s\s+de|parte\s+de\s+lo\s+que\s+deja|usa\s+(?:el|la))\b/i;

/**
 * Los ids de las tarjetas que el texto nombra como molde o requisito. Solo cuenta una línea que nombra UNA sola tarjeta y
 * dice que la necesita (una línea con varios ids suele ser un resumen de causas, no un requisito). Nunca la propia.
 */
export function dependenciasNombradas(tarjeta) {
  const propio = String(tarjeta?.id ?? "");
  const encontradas = new Set();
  for (const linea of `${tarjeta?.titulo ?? ""}\n${tarjeta?.detalle ?? ""}`.split(/\r?\n/)) {
    const ids = [...new Set(linea.match(ID_DE_TARJETA) ?? [])];
    if (ids.length !== 1 || !PIDE_A_OTRA.test(linea)) continue;
    if (ids[0] !== propio) encontradas.add(ids[0]);
  }
  return [...encontradas];
}

/** El prompt corto para que Haiku diga si una tarjeta dudosa cabe en una sola sesión. */
export function promptDeTamano(tarjeta) {
  return [
    "Eres el Coordinador del Tablero IA de Magilus. Decide si esta tarea cabe en UNA sola sesión de Claude Code (planear y construir en menos de 60 minutos, menos de 15 archivos de código). NO cambies nada ni corras comandos: solo lee el texto.",
    `Tarea: ${tarjeta.titulo}`,
    `Detalle:\n${String(tarjeta.detalle ?? "(sin detalle)").slice(0, 6000)}`,
    "Una tarea GRANDE mezcla varias cosas independientes (por ejemplo una migración, pantallas nuevas y automatizaciones a la vez). Una MANEJABLE tiene un solo objetivo claro.",
    "Contesta SOLO con una palabra: GRANDE o MANEJABLE.",
  ].join("\n\n");
}

/** Lo que contestó Haiku: "grande" | "manejable" | null si no se entiende. */
export function tamanoDeLaRespuesta(texto) {
  const palabra = String(texto ?? "").match(/\b(GRANDE|MANEJABLE)\b/i)?.[1]?.toLowerCase();
  return palabra ?? null;
}
