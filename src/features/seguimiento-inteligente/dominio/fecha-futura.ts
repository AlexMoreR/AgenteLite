/**
 * FECHA FUTURA DE COMPRA en lo que escribe el cliente (código puro).
 *
 * Caso real (cv167d3ad7d922c01f61b9fe3c, 7-oct): "Finales de noviembre tal vez". Ese lead no está
 * frío ni perdido: está DORMIDO hasta noviembre. Insistirle antes cansa; olvidarlo pierde la venta.
 * El motor lo deja sin automáticos ni alertas y, unos días antes de la fecha, le crea una tarea a
 * la asesora con el mensaje listo.
 *
 * Por palabras, sin IA. Las fechas se calculan desde el momento del MENSAJE (no desde hoy) y en
 * hora de Bogotá. Las preguntas ("¿cuánto se demora?", "¿en cuántos días llega?") no cuentan.
 */

import { normalizarConservando } from "../../embudo/dominio/senales";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MES = "(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)";
const NUMEROS: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, ocho: 8, diez: 10, quince: 15, veinte: 20 };

const DESFASE_BOGOTA_MS = -5 * 3_600_000;
const DIA_MS = 86_400_000;

/** Una fecha a las 9:00 de Bogotá. */
function fechaBogota(anio: number, mes0: number, dia: number): Date {
  return new Date(Date.UTC(anio, mes0, dia, 9, 0, 0) - DESFASE_BOGOTA_MS);
}

function partesBogota(fecha: Date): { anio: number; mes0: number; dia: number } {
  const local = new Date(fecha.getTime() + DESFASE_BOGOTA_MS);
  return { anio: local.getUTCFullYear(), mes0: local.getUTCMonth(), dia: local.getUTCDate() };
}

function indiceDeMes(nombre: string): number {
  return nombre === "setiembre" ? 8 : MESES.indexOf(nombre);
}

/** El mes nombrado, en el próximo año que todavía no pasó (desde el día del mensaje). */
function enElMes(mes0: number, dia: number, desde: Date): Date {
  const hoy = partesBogota(desde);
  let anio = hoy.anio;
  if (mes0 < hoy.mes0 || (mes0 === hoy.mes0 && dia < hoy.dia)) anio += 1;
  return fechaBogota(anio, mes0, dia);
}

export type FechaFutura = {
  fecha: Date;
  /** El pedazo del mensaje donde se vio. */
  fragmento: string;
  /** Cómo se dijo, en palabras ("finales de noviembre"). */
  como: string;
};

/** Lo que indica que NO es una fecha de compra: preguntas de entrega o fabricación. */
const NO_ES_COMPRA = /\?|\b(cuanto|cuanta|cuantos|cuantas|demora\w*|tarda\w*|se demoran?|llegaria|llega el pedido|tiempo de (entrega|fabricacion))\b/;

const MINIMO_DIAS = 4;

/**
 * La fecha futura de compra que dice un mensaje, o null. Solo cuenta si queda a 4 días o más del
 * mensaje: "mañana te confirmo" es una decisión cercana (señal fuerte), no un lead dormido.
 */
export function detectarFechaFutura(texto: string | null | undefined, cuando: Date): FechaFutura | null {
  const original = (texto ?? "").slice(0, 600);
  if (!original.trim()) return null;
  const normal = normalizarConservando(original).replace(/\s+/g, " ");
  if (NO_ES_COMPRA.test(normal)) return null;
  const hoy = partesBogota(cuando);
  const candidatos: Array<{ re: RegExp; fecha: (m: RegExpExecArray) => Date | null; como: (m: RegExpExecArray) => string }> = [
    {
      re: new RegExp(`\\b(\\d{1,2}) de ${MES}\\b`),
      fecha: (m) => {
        const dia = Number(m[1]);
        return dia >= 1 && dia <= 31 ? enElMes(indiceDeMes(m[2]), dia, cuando) : null;
      },
      como: (m) => `el ${m[1]} de ${m[2]}`,
    },
    {
      re: new RegExp(`\\b(finales|fin|final|ultimos dias|ultima semana) de(l mes de)? ${MES}\\b`),
      fecha: (m) => enElMes(indiceDeMes(m[3]), 25, cuando),
      como: (m) => `finales de ${m[3]}`,
    },
    {
      re: new RegExp(`\\b(principios|inicios|comienzos|primeros dias|primera semana) de(l mes de)? ${MES}\\b`),
      fecha: (m) => enElMes(indiceDeMes(m[3]), 3, cuando),
      como: (m) => `principios de ${m[3]}`,
    },
    {
      re: new RegExp(`\\b(mediados|la mitad|quincena) de(l mes de)? ${MES}\\b`),
      fecha: (m) => enElMes(indiceDeMes(m[3]), 15, cuando),
      como: (m) => `mediados de ${m[3]}`,
    },
    {
      re: new RegExp(`\\b(en|para|el|pal|hasta|desde|como en|a) (el mes de |mes de )?${MES}\\b`),
      fecha: (m) => enElMes(indiceDeMes(m[3]), 1, cuando),
      como: (m) => `en ${m[3]}`,
    },
    {
      re: /\b(el|al|para el) (otro|proximo|siguiente) mes\b|\bel mes que viene\b/,
      fecha: () => fechaBogota(hoy.mes0 === 11 ? hoy.anio + 1 : hoy.anio, (hoy.mes0 + 1) % 12, 1),
      como: () => "el otro mes",
    },
    {
      re: /\b(dentro de|en|como en|unos) (\d{1,2}|un|una|dos|tres|cuatro|cinco|seis|ocho|diez|quince|veinte) (dias|semanas|meses|mes|semana)\b/,
      fecha: (m) => {
        const n = /^\d+$/.test(m[2]) ? Number(m[2]) : NUMEROS[m[2]] ?? 0;
        const unidad = m[3].startsWith("dia") ? 1 : m[3].startsWith("semana") ? 7 : 30;
        return n > 0 ? new Date(cuando.getTime() + n * unidad * DIA_MS) : null;
      },
      como: (m) => `en ${m[2]} ${m[3]}`,
    },
    {
      re: /\b(la|para la) (otra|proxima|siguiente) semana\b|\bla semana que viene\b/,
      fecha: () => new Date(cuando.getTime() + 7 * DIA_MS),
      como: () => "la otra semana",
    },
    {
      re: /\b(despues de|cuando (me )?(paguen|salga|llegue)|con) la prima\b/,
      // La prima se paga hasta el 30 de junio y el 20 de diciembre.
      fecha: () => {
        const junio = enElMes(5, 30, cuando);
        const diciembre = enElMes(11, 20, cuando);
        return junio.getTime() < diciembre.getTime() ? junio : diciembre;
      },
      como: () => "después de la prima",
    },
    {
      re: /\b(el|para el) (otro|proximo) ano\b|\bel ano que viene\b|\b(para|a) (inicio|principios|comienzos) (de|del) ano\b/,
      fecha: () => fechaBogota(hoy.anio + 1, 0, 15),
      como: () => "el otro año",
    },
    {
      re: /\b(fin|final|finales) de ano\b/,
      fecha: () => enElMes(11, 10, cuando),
      como: () => "fin de año",
    },
  ];
  for (const candidato of candidatos) {
    const m = candidato.re.exec(normal);
    if (!m) continue;
    const fecha = candidato.fecha(m);
    if (!fecha) continue;
    if (fecha.getTime() - cuando.getTime() < MINIMO_DIAS * DIA_MS) continue;
    const desde = Math.max(0, m.index - 20);
    const hasta = Math.min(original.length, m.index + m[0].length + 20);
    return { fecha, fragmento: original.slice(desde, hasta).replace(/\s+/g, " ").trim(), como: candidato.como(m) };
  }
  return null;
}
