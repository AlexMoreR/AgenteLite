// MEDIR EL TAMAÑO ANTES DE PLANEAR (26-oct-2026, queja del dueño: "¿para qué tengo un coordinador si no sabe que si
// mandamos todos esos trabajos se van a bloquear?"). Puro: sin disco, red ni procesos.
//
// Hoy una tarjeta solo se parte cuando ya está construyendo y falla (o con el plan en la mano: reparto.mjs). Una tarea
// enorme se caía a los 19 min escribiendo el plan ("tardó más de 19 min en escribir el plan: se cortó"). Acá se mira la
// tarjeta ANTES de abrir la sesión de plan y se decide: chica (pasa a planear), grande (se parte en 2 a 4 hijas
// pequeñas, en orden) o dudosa (una consulta corta y barata con Haiku decide).
//
// El tamaño sale de puntos, con lo que dice el texto de la tarjeta: lo largo, cuántos puntos pide y si menciona una
// migración, una pantalla o módulo nuevo o un agente nuevo. Una tarjeta que ya es una parte, que ya está partida o que
// viene de una reparación NO se vuelve a partir (la regla es conservadora).
//
// También lee las dependencias: si el texto nombra otra tarjeta (su id) como molde o requisito, esa es una flecha
// de dependencia ("Esperando a «X»").

/** Lo que viene por defecto en config.medir. */
export const MEDIR_POR_DEFECTO = { activo: true, puntosGrande: 4, puntosDudosa: 2, consultaHaiku: true };

const cuenta = (texto, expresion) => (texto.match(expresion) ?? []).length;

/** Los puntos que pide el texto: líneas numeradas o con viñeta. */
function puntosPedidos(texto) {
  return cuenta(texto, /^[ \t]*(?:\d{1,2}[.)]|[-*•])[ \t]+\S/gm);
}

/**
 * Mide una tarjeta. -> { tamano: "chica" | "dudosa" | "grande", puntos, motivos: [...], razon? }
 * `razon` solo viene cuando no se mide porque no se puede partir (ya es una parte, ya está partida, viene de una reparación).
 */
export function medirTarjeta(tarjeta, opciones = {}) {
  const { puntosGrande, puntosDudosa } = { ...MEDIR_POR_DEFECTO, ...opciones };
  if (tarjeta?.esParte) return { tamano: "chica", puntos: 0, motivos: [], razon: "ya es una parte" };
  if (tarjeta?.resultado?.partida) return { tamano: "chica", puntos: 0, motivos: [], razon: "ya está partida" };
  if (Number(tarjeta?.reparaciones) > 0 || tarjeta?.reparacion) return { tamano: "chica", puntos: 0, motivos: [], razon: "viene de una reparación" };

  const texto = `${tarjeta?.titulo ?? ""}\n${tarjeta?.detalle ?? ""}`;
  const motivos = [];
  let puntos = 0;
  const sumar = (cantidad, motivo) => {
    puntos += cantidad;
    motivos.push(motivo);
  };

  const largo = texto.length;
  if (largo > 6000) sumar(3, `texto muy largo (${largo} letras)`);
  else if (largo > 3500) sumar(2, `texto largo (${largo} letras)`);
  else if (largo > 1800) sumar(1, `texto de ${largo} letras`);

  const lista = puntosPedidos(texto);
  if (lista >= 12) sumar(2, `pide ${lista} puntos`);
  else if (lista >= 6) sumar(1, `pide ${lista} puntos`);

  if (/migraci[oó]n|prisma\/migrations|schema\.prisma|tabla nueva|modelo nuevo|campo nuevo en la base/i.test(texto)) sumar(1, "menciona una migración");
  if (/(?:pantalla|m[oó]dulo|p[aá]gina|vista|pesta[nñ]a)\s+nuev[oa]|nuev[oa]\s+(?:pantalla|m[oó]dulo|p[aá]gina|vista|pesta[nñ]a)/i.test(texto)) sumar(1, "una pantalla o módulo nuevo");
  if (/agente\s+nuevo|nuevo\s+agente|crear\s+(?:un\s+)?agente/i.test(texto)) sumar(1, "un agente nuevo");
  const modulos = cuenta(texto, /\b(?:m[oó]dulo|pantalla|panel|bot|webhook|cron)\b/gi);
  if (modulos >= 6) sumar(1, `nombra ${modulos} módulos o pantallas`);

  const tamano = puntos >= puntosGrande ? "grande" : puntos >= puntosDudosa ? "dudosa" : "chica";
  return { tamano, puntos, motivos };
}

/** Una frase con el resultado de medir, para el log y la causa de la partida. */
export function textoDeLaMedida(medida) {
  if (medida.razon) return `no se mide: ${medida.razon}`;
  return `${medida.tamano} (${medida.puntos} punto${medida.puntos === 1 ? "" : "s"}${medida.motivos.length ? `: ${medida.motivos.join(", ")}` : ""})`;
}

/** Las palabras que anuncian que lo que sigue es otra tarjeta de la que se depende. */
const ANUNCIO = /molde|depende(?:n)? d[eé]|dependencia|requiere|requisito|necesita(?:n)? (?:primero|antes)|despu[eé]s de que|se apoya(?:n)? en|a partir de la tarjeta|sobre la tarjeta/i;
const ID_DE_TARJETA = /\bcm[a-z0-9]{20,28}\b/g;
const TITULO_ENTRE_COMILLAS = /[«"“]([^«»"“”\n]{4,120})[»"”]/g;

/**
 * Las tarjetas que el título, el detalle y el plan nombran como molde o requisito: { ids, titulos }. Solo cuenta lo que aparece CERCA de una palabra
 * que lo anuncia ("molde", "depende de", "requiere"…), dentro de la misma frase: un id nombrado como ejemplo o como causa de
 * un error ("Cerebro cmv…: build bloqueado") NO es una dependencia. Nunca incluye a la propia tarjeta.
 */
export function referenciasDeLaTarjeta(tarjeta) {
  // 27-oct-2026: también el título y el plan aprobado (antes solo el detalle: "Alertas de Tecnología" gastó 5 intentos porque su
  // dependencia estaba escrita en el plan y no en el detalle).
  const texto = [tarjeta?.titulo, tarjeta?.detalle, tarjeta?.plan].map((parte) => String(parte ?? "")).join("\n");
  const ids = new Set();
  const titulos = new Set();
  for (const frase of texto.split(/(?<=[.;:!?\n])\s+/)) {
    const anuncio = ANUNCIO.exec(frase);
    if (!anuncio) continue;
    const despues = frase.slice(anuncio.index, anuncio.index + 220);
    for (const id of despues.match(ID_DE_TARJETA) ?? []) if (id !== tarjeta?.id) ids.add(id);
    for (const coincidencia of despues.matchAll(TITULO_ENTRE_COMILLAS)) titulos.add(coincidencia[1].trim());
  }
  return { ids: [...ids].slice(0, 5), titulos: [...titulos].slice(0, 5) };
}

/** Las referencias de la tarjeta como una sola lista para /depender (ids primero), o [] si no nombra ninguna. */
export function referenciasParaDepender(tarjeta) {
  const { ids, titulos } = referenciasDeLaTarjeta(tarjeta);
  return [...ids, ...titulos].slice(0, 5);
}

/** Lo que contesta la consulta corta de Haiku: "grande" o "chica" (cualquier otra cosa = null, queda como chica). */
export function tamanoDeLaRespuesta(texto) {
  const primera = String(texto ?? "")
    .split(/\r?\n/)
    .map((linea) => linea.trim().toLowerCase())
    .find(Boolean);
  if (!primera) return null;
  if (/^[`"'*\s]*grande/.test(primera)) return "grande";
  if (/^[`"'*\s]*(?:chica|mediana|peque)/.test(primera)) return "chica";
  return null;
}
