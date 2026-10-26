/**
 * EL EMBUDO POR PASO DEL BOT: en qué paso se queda cada cliente (Presentación, Producto,
 * Objeciones, Cierre). Código puro —sin base, sin Next—: lo usan la pantalla
 * /cliente/crm/embudo-por-paso, la herramienta MCP `embudo_por_paso` y las pruebas
 * (scripts/check-embudo-por-paso.mjs). Solo mide: no cambia lo que el bot responde.
 *
 * Definiciones:
 *  - "Llegó" a un paso: su paso más alto (pasoMaximo) es ese o uno posterior. Volver a un paso
 *    anterior no lo cuenta dos veces.
 *  - "Se quedó aquí": el paso actual es ese, no compró y el cliente lleva MÁS de 24 horas sin
 *    escribir. Se calcula al mirar (nunca queda desactualizado); si el cliente vuelve a escribir,
 *    deja de contar.
 *  - Identificación (solo la usa el V2) se cuenta dentro de Presentación: el reporte tiene los
 *    4 pasos del combo.
 *  - "Solo el bot" vs "lo tomó una asesora" (IA en pausa o chat asignado): dos grupos separados.
 */

import type { CambioDePaso } from "./eventos";

export { agregarAlHistorialDePasos, MAXIMO_DE_PASOS_EN_HISTORIAL, type CambioDePaso } from "./eventos";

export const PASOS_DEL_REPORTE = [
  { clave: "PRESENTACION", nombre: "Presentación" },
  { clave: "PRODUCTO", nombre: "Producto" },
  { clave: "OBJECIONES", nombre: "Objeciones" },
  { clave: "CIERRE", nombre: "Cierre" },
] as const;

export type ClaveDePasoDelReporte = (typeof PASOS_DEL_REPORTE)[number]["clave"];

/** Más de estas horas sin que el cliente escriba = "se quedó aquí". */
export const HORAS_PARA_QUEDARSE = 24;

/** Con menos clientes que esto en un paso, los porcentajes salen con el aviso "pocos datos". */
export const MINIMO_DE_CLIENTES_POR_PASO = 30;

const HORA_MS = 3_600_000;

/** El índice (0 a 3) del paso dentro del reporte; null si no es un paso. Identificación = Presentación. */
export function indiceDelPasoDelReporte(paso: string | null | undefined): number | null {
  if (!paso) return null;
  if (paso === "IDENTIFICACION") return 0;
  const indice = PASOS_DEL_REPORTE.findIndex((item) => item.clave === paso);
  return indice >= 0 ? indice : null;
}

const instante = (valor: Date | string | null | undefined): number | null => {
  if (!valor) return null;
  const ms = valor instanceof Date ? valor.getTime() : new Date(valor).getTime();
  return Number.isFinite(ms) ? ms : null;
};

/**
 * ¿Se quedó en su paso? Lleva MÁS de 24 horas sin escribir (23 h no cuenta, 24 h justas tampoco).
 * Sin fecha del último mensaje del cliente no se puede saber: no cuenta. Quien compró no "se
 * quedó": terminó.
 */
export function seQuedoAqui(input: { ultimoClienteEn: Date | string | null | undefined; ahora: Date; compro?: boolean }): boolean {
  if (input.compro) return false;
  const ultimo = instante(input.ultimoClienteEn);
  if (ultimo === null) return false;
  return input.ahora.getTime() - ultimo > HORAS_PARA_QUEDARSE * HORA_MS;
}

/* ------------------------------------------------------------------------------------ cuentas */

export type LeadPorPaso = {
  conversationId: string;
  pasoActual: string | null;
  pasoMaximo: string | null;
  ultimoClienteEn: Date | string | null;
  compro: boolean;
  /** La IA está en pausa o el chat está asignado a una asesora. */
  tomadaPorAsesora: boolean;
  pasoHistorial?: CambioDePaso[] | null;
};

export type PasoDelGrupo = {
  clave: ClaveDePasoDelReporte;
  nombre: string;
  /** Cuántos clientes llegaron a este paso (o a uno posterior). */
  llegaron: number;
  /** Cuántos se quedaron aquí (paso actual + más de 24 h sin escribir). */
  seQuedaron: number;
  /** % de los clientes del grupo que llegaron a este paso. */
  pctDelTotal: number | null;
  /** % de los que llegaron aquí que pasaron al siguiente paso (null en el último). */
  tasaAlSiguiente: number | null;
  /** Horas promedio que duraron en este paso (según el historial corto); null sin datos. */
  horasPromedio: number | null;
  /** Menos de 30 clientes aquí: no confiar en los porcentajes. */
  pocosDatos: boolean;
};

export type CaidaDelEmbudo = {
  desde: ClaveDePasoDelReporte;
  desdeNombre: string;
  hacia: ClaveDePasoDelReporte;
  haciaNombre: string;
  /** % que NO pasó de `desde` a `hacia`. */
  pctQueNoPaso: number;
  quedaron: number;
};

export type GrupoPorPaso = {
  total: number;
  pasos: PasoDelGrupo[];
  mayorCaida: CaidaDelEmbudo | null;
};

export type EmbudoPorPaso = {
  soloBot: GrupoPorPaso;
  conAsesora: GrupoPorPaso;
};

export function porcentaje(parte: number, base: number): number | null {
  if (!base) return null;
  return Math.round((parte / base) * 1000) / 10;
}

/** Horas promedio por paso, según el historial corto de cada cliente. El último paso (abierto) no suma. */
function horasPorPaso(leads: ReadonlyArray<LeadPorPaso>): Array<number | null> {
  const sumas = PASOS_DEL_REPORTE.map(() => ({ horas: 0, n: 0 }));
  for (const lead of leads) {
    const historial = (lead.pasoHistorial ?? [])
      .map((cambio) => ({ indice: indiceDelPasoDelReporte(cambio.paso), en: instante(cambio.en) }))
      .filter((cambio): cambio is { indice: number; en: number } => cambio.indice !== null && cambio.en !== null)
      .sort((a, b) => a.en - b.en);
    for (let i = 0; i < historial.length - 1; i += 1) {
      const horas = (historial[i + 1].en - historial[i].en) / HORA_MS;
      if (horas < 0) continue;
      sumas[historial[i].indice].horas += horas;
      sumas[historial[i].indice].n += 1;
    }
  }
  return sumas.map((suma) => (suma.n ? Math.round((suma.horas / suma.n) * 10) / 10 : null));
}

/** La caída más grande entre dos pasos seguidos (la de mayor % que no pasó). Ante empate, la primera. */
export function mayorCaidaDe(pasos: ReadonlyArray<PasoDelGrupo>): CaidaDelEmbudo | null {
  let mejor: CaidaDelEmbudo | null = null;
  for (let i = 0; i < pasos.length - 1; i += 1) {
    const actual = pasos[i];
    const siguiente = pasos[i + 1];
    if (!actual.llegaron || actual.tasaAlSiguiente === null) continue;
    const pctQueNoPaso = Math.round((100 - actual.tasaAlSiguiente) * 10) / 10;
    if (mejor === null || pctQueNoPaso > mejor.pctQueNoPaso) {
      mejor = {
        desde: actual.clave,
        desdeNombre: actual.nombre,
        hacia: siguiente.clave,
        haciaNombre: siguiente.nombre,
        pctQueNoPaso,
        quedaron: actual.llegaron - siguiente.llegaron,
      };
    }
  }
  return mejor && mejor.pctQueNoPaso > 0 ? mejor : null;
}

/** Las cuentas de UN grupo de clientes. */
export function armarGrupoPorPaso(leads: ReadonlyArray<LeadPorPaso>, ahora: Date): GrupoPorPaso {
  const maximos = leads.map((lead) => indiceDelPasoDelReporte(lead.pasoMaximo) ?? indiceDelPasoDelReporte(lead.pasoActual));
  const llegaron = PASOS_DEL_REPORTE.map((_, i) => maximos.filter((max) => max !== null && max >= i).length);
  const seQuedaron = PASOS_DEL_REPORTE.map(
    (_, i) =>
      leads.filter(
        (lead) =>
          indiceDelPasoDelReporte(lead.pasoActual) === i &&
          seQuedoAqui({ ultimoClienteEn: lead.ultimoClienteEn, ahora, compro: lead.compro }),
      ).length,
  );
  const horas = horasPorPaso(leads);
  const total = leads.length;
  const pasos: PasoDelGrupo[] = PASOS_DEL_REPORTE.map((paso, i) => ({
    clave: paso.clave,
    nombre: paso.nombre,
    llegaron: llegaron[i],
    seQuedaron: seQuedaron[i],
    pctDelTotal: porcentaje(llegaron[i], total),
    tasaAlSiguiente: i < PASOS_DEL_REPORTE.length - 1 ? porcentaje(llegaron[i + 1], llegaron[i]) : null,
    horasPromedio: horas[i],
    pocosDatos: llegaron[i] < MINIMO_DE_CLIENTES_POR_PASO,
  }));
  return { total, pasos, mayorCaida: mayorCaidaDe(pasos) };
}

/** Separa a los clientes (solo el bot / lo tomó una asesora) y arma el embudo de cada grupo. */
export function armarEmbudoPorPaso(leads: ReadonlyArray<LeadPorPaso>, ahora: Date): EmbudoPorPaso {
  return {
    soloBot: armarGrupoPorPaso(leads.filter((lead) => !lead.tomadaPorAsesora), ahora),
    conAsesora: armarGrupoPorPaso(leads.filter((lead) => lead.tomadaPorAsesora), ahora),
  };
}

/* ------------------------------------------------------------------------------------- textos */

const coma = (valor: number) => valor.toLocaleString("es-CO", { maximumFractionDigits: 1 });

/** "60 %" (o "—" sin dato). */
export function textoPct(valor: number | null): string {
  return valor === null ? "—" : `${coma(valor)} %`;
}

/** "3,5 h", "2 días" o "Sin dato". */
export function textoDeHoras(horas: number | null): string {
  if (horas === null) return "Sin dato";
  if (horas >= 48) return `${coma(Math.round((horas / 24) * 10) / 10)} días`;
  return `${coma(horas)} h`;
}

/** La frase corta para decir en voz alta (reunión de las 8:00) sobre el grupo del bot. */
export function textoDelEmbudoPorPaso(input: { producto: string; desde: string; hasta: string; grupo: GrupoPorPaso }): string {
  const { grupo } = input;
  const encabezado = `${input.producto}, del ${input.desde} al ${input.hasta}`;
  if (!grupo.total) return `${encabezado}: no hay clientes que atendió solo el bot en ese rango.`;
  const primero = grupo.pasos[0];
  const llegadas = grupo.pasos.map((paso) => `${paso.llegaron} a ${paso.nombre}`).join(", ");
  const partes = [`${encabezado}, de ${grupo.total} clientes que atendió solo el bot llegaron ${llegadas}.`];
  const caida = grupo.mayorCaida;
  if (caida) {
    const pasoDe = grupo.pasos.find((paso) => paso.clave === caida.desde);
    partes.push(
      `Donde más se cae es entre ${caida.desdeNombre} y ${caida.haciaNombre}: pasa el ${textoPct(pasoDe?.tasaAlSiguiente ?? null)} y se quedan ${caida.quedaron}.`,
    );
  }
  if (primero.pocosDatos) partes.push("Ojo: hay pocos datos (menos de 30 clientes en Presentación), los porcentajes son orientativos.");
  return partes.join(" ");
}
