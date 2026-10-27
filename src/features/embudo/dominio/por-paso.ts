/**
 * EL EMBUDO POR PASO DEL BOT (código puro: sin base ni Next).
 *
 * Responde "¿en qué paso del bot se cae la gente?" con los 4 pasos del combo: Presentación,
 * Producto, Objeciones y Cierre. Lo usan la pantalla /cliente/crm/embudo-por-paso y la herramienta
 * MCP `embudo_por_paso`, y se prueba con `npm run test:embudo-por-paso`.
 *
 * - LLEGARON a un paso: el paso más alto que alcanzó el chat (pasoMaximo) es ese o uno posterior.
 *   Volver a un paso anterior no suma otra vez. IDENTIFICACION no es una barra: cuenta en el paso
 *   que ya había alcanzado (Presentación) y quien llegó más lejos la salta.
 * - SE QUEDARON en un paso: es su paso actual y llevan MÁS de 24 horas sin escribir (desde su
 *   último mensaje, o desde que entraron al paso si no hay mensaje). Si compró, no se quedó.
 * - Los chats de una asesora (IA en pausa o chat asignado) van aparte de los del bot.
 */

import type { CambioDePaso } from "./eventos";

export const HORAS_PARA_QUEDARSE = 24;
/** Con menos chats que esto en un paso, los porcentajes llevan el aviso "pocos datos". */
export const MINIMO_POR_PASO = 30;

export const PASOS_DEL_BOT = [
  { clave: "PRESENTACION", nombre: "Presentación" },
  { clave: "PRODUCTO", nombre: "Producto" },
  { clave: "OBJECIONES", nombre: "Objeciones" },
  { clave: "CIERRE", nombre: "Cierre" },
] as const;

export type ClaveDePasoDelBot = (typeof PASOS_DEL_BOT)[number]["clave"];

export type LeadPorPaso = {
  pasoActual: string | null;
  pasoMaximo: string | null;
  pasoDesde: Date | null;
  ultimoClienteEn: Date | null;
  entradaEn: Date;
  pasoHistorial: CambioDePaso[] | null;
  /** IA en pausa o chat asignado a una asesora. */
  conAsesora: boolean;
  compro: boolean;
};

export type PasoCalculado = {
  clave: ClaveDePasoDelBot;
  nombre: string;
  llegaron: number;
  seQuedaron: number;
  /** % de los que llegaron que pasó al siguiente paso. null en el último o si no llegó nadie. */
  tasaAlSiguiente: number | null;
  /** Horas promedio que duró en este paso (solo cambios cerrados del historial). null = sin dato. */
  horasPromedio: number | null;
  pocosDatos: boolean;
};

export type MayorCaida = {
  desde: ClaveDePasoDelBot;
  desdeNombre: string;
  haciaNombre: string;
  /** Cuántos no pasaron al siguiente paso. */
  quedaron: number;
  pctQuedaron: number;
};

export type GrupoPorPaso = {
  chats: number;
  pasos: PasoCalculado[];
  mayorCaida: MayorCaida | null;
};

export type EmbudoPorPaso = { bot: GrupoPorPaso; asesora: GrupoPorPaso };

/** Los 4 pasos visibles: IDENTIFICACION cuenta en Presentación. */
function indiceVisible(paso: string | null | undefined): number {
  if (paso === "IDENTIFICACION") return 0;
  return PASOS_DEL_BOT.findIndex((visible) => visible.clave === paso);
}

/** ¿Se quedó en su paso actual? Más de 24 horas sin escribir, y sin haber comprado. */
export function seQuedoAqui(lead: Pick<LeadPorPaso, "pasoActual" | "ultimoClienteEn" | "pasoDesde" | "entradaEn" | "compro">, ahora: Date): boolean {
  if (!lead.pasoActual || lead.compro) return false;
  const referencia = lead.ultimoClienteEn ?? lead.pasoDesde ?? lead.entradaEn;
  return ahora.getTime() - referencia.getTime() > HORAS_PARA_QUEDARSE * 3_600_000;
}

function porcentaje(parte: number, total: number): number | null {
  return total > 0 ? Math.round((parte / total) * 100) : null;
}

function calcularGrupo(leads: LeadPorPaso[], ahora: Date): GrupoPorPaso {
  const llegaron = PASOS_DEL_BOT.map(() => 0);
  const quedaron = PASOS_DEL_BOT.map(() => 0);
  const sumaHoras = PASOS_DEL_BOT.map(() => 0);
  const cambios = PASOS_DEL_BOT.map(() => 0);

  for (const lead of leads) {
    const maximo = indiceVisible(lead.pasoMaximo ?? lead.pasoActual);
    // pasoMaximo en IDENTIFICACION alcanza Presentación pero no Producto.
    for (let i = 0; i <= maximo; i += 1) llegaron[i] += 1;
    const actual = indiceVisible(lead.pasoActual);
    if (actual >= 0 && seQuedoAqui(lead, ahora)) quedaron[actual] += 1;

    const historial = lead.pasoHistorial ?? [];
    for (let i = 0; i + 1 < historial.length; i += 1) {
      const paso = indiceVisible(historial[i].paso);
      const horas = (Date.parse(historial[i + 1].en) - Date.parse(historial[i].en)) / 3_600_000;
      if (paso >= 0 && Number.isFinite(horas) && horas >= 0) {
        sumaHoras[paso] += horas;
        cambios[paso] += 1;
      }
    }
  }

  const pasos: PasoCalculado[] = PASOS_DEL_BOT.map((paso, i) => ({
    clave: paso.clave,
    nombre: paso.nombre,
    llegaron: llegaron[i],
    seQuedaron: quedaron[i],
    tasaAlSiguiente: i + 1 < PASOS_DEL_BOT.length ? porcentaje(llegaron[i + 1], llegaron[i]) : null,
    horasPromedio: cambios[i] > 0 ? Math.round((sumaHoras[i] / cambios[i]) * 10) / 10 : null,
    pocosDatos: llegaron[i] < MINIMO_POR_PASO,
  }));

  // El paso donde más gente no pasó al siguiente (en cantidad). Empata el primero.
  let mayorCaida: MayorCaida | null = null;
  for (let i = 0; i + 1 < pasos.length; i += 1) {
    const perdidos = pasos[i].llegaron - pasos[i + 1].llegaron;
    if (perdidos > 0 && (!mayorCaida || perdidos > mayorCaida.quedaron)) {
      mayorCaida = {
        desde: pasos[i].clave,
        desdeNombre: pasos[i].nombre,
        haciaNombre: pasos[i + 1].nombre,
        quedaron: perdidos,
        pctQuedaron: porcentaje(perdidos, pasos[i].llegaron) ?? 0,
      };
    }
  }
  return { chats: leads.length, pasos, mayorCaida };
}

/** Separa los chats del bot de los que tomó una asesora y calcula cada grupo. */
export function calcularEmbudoPorPaso(leads: LeadPorPaso[], ahora: Date = new Date()): EmbudoPorPaso {
  return {
    bot: calcularGrupo(
      leads.filter((lead) => !lead.conAsesora),
      ahora,
    ),
    asesora: calcularGrupo(
      leads.filter((lead) => lead.conAsesora),
      ahora,
    ),
  };
}

/** La frase corta para decir en la reunión de las 8:00. */
export function textoDeEmbudoPorPaso(embudo: EmbudoPorPaso, producto: string): string {
  const { bot } = embudo;
  if (!bot.pasos[0].llegaron) return `Todavía no hay chats del bot de ${producto} con paso registrado en ese rango.`;
  const llegaron = bot.pasos.map((paso) => `${paso.nombre} ${paso.llegaron}`).join(", ");
  const caida = bot.mayorCaida
    ? ` La mayor caída es entre ${bot.mayorCaida.desdeNombre} y ${bot.mayorCaida.haciaNombre}: ${bot.mayorCaida.quedaron} no pasaron (${bot.mayorCaida.pctQuedaron} %).`
    : " No hay caída que señalar.";
  const poco = bot.pasos.some((paso) => paso.pocosDatos) ? " Ojo: hay pasos con pocos datos (menos de 30 chats)." : "";
  const asesora = embudo.asesora.chats > 0 ? ` Aparte, ${embudo.asesora.chats} chats los tomó una asesora.` : "";
  return `En ${producto}, solo el bot, llegaron: ${llegaron}.${caida}${poco}${asesora}`;
}
