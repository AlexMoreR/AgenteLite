/**
 * EMBUDO POR PASO (pantalla /cliente/direccion/embudo-por-paso y herramienta MCP `embudo_por_paso`),
 * en código puro: sin base ni Next. La pantalla y el MCP usan ESTAS funciones, así que nunca dan
 * números distintos. Se prueba con `npm run test:embudo-por-paso` (scripts/check-embudo-por-paso.mjs).
 *
 * QUÉ SE CUENTA (de la foto del lead, EmbudoLead):
 *  - Llegaron a un paso: el paso más alto que alcanzó el chat (`pasoMaximo`) es ese o uno posterior.
 *    Volver a un paso anterior NO suma otra vez: es un embudo, cada chat cuenta una vez por paso.
 *  - Se quedaron aquí: su paso actual es ese y lleva MÁS de 24 horas sin escribir. Se calcula al
 *    mirar (con `ahora`), así que nunca queda desactualizado; si el cliente vuelve a escribir, deja
 *    de contar. Quien ya compró no cuenta como "se quedó".
 *  - Tasa de paso a paso: llegaron al siguiente / llegaron a este.
 *  - Tiempo en cada paso: del historial corto (últimos 10 cambios), de cuando entró al paso a
 *    cuando entró al siguiente. El paso en que está ahora no tiene tiempo todavía.
 *
 * LOS 4 PASOS DEL REPORTE: Presentación, Producto, Objeciones y Cierre. Identificación (que el
 * registro también conoce) se cuenta dentro de Presentación: llegar a Identificación es haber
 * pasado Presentación, y quedarse en Identificación es seguir en la parte de conocer al cliente.
 *
 * DOS GRUPOS que no se mezclan: los chats que atendió solo el bot y los que tomó una asesora (IA en
 * pausa o chat asignado), porque en estos últimos el paso ya no lo mueve el bot.
 */

import { ordenDelPaso, type CambioDePaso } from "./eventos";
import { porcentaje, textoPct, type ClaveDeFamilia } from "./semanal";

/** Más de estas horas sin que el cliente escriba = "se quedó aquí". */
export const HORAS_PARA_QUEDARSE = 24;

/** Con menos chats que esto en un paso, el porcentaje engaña: sale "pocos datos". */
export const MINIMO_POR_PASO = 30;

export const PASOS_DEL_REPORTE = [
  { clave: "PRESENTACION", nombre: "Presentación" },
  { clave: "PRODUCTO", nombre: "Producto" },
  { clave: "OBJECIONES", nombre: "Objeciones" },
  { clave: "CIERRE", nombre: "Cierre" },
] as const;
export type ClaveDePasoDelReporte = (typeof PASOS_DEL_REPORTE)[number]["clave"];

/** Lo que se necesita de cada chat. La lectura de la base lo arma (servicios/leer-embudo-por-paso.ts). */
export type LeadPorPaso = {
  conversationId: string;
  entradaEn: Date | string;
  familia: ClaveDeFamilia;
  canalId: string | null;
  pasoActual: string | null;
  pasoMaximo: string | null;
  pasoAnterior: string | null;
  pasoDesde: Date | string | null;
  pasoHistorial: CambioDePaso[] | null;
  ultimoClienteEn: Date | string | null;
  /** Ya compró (Ganado en el CRM o EmbudoLead.ventaEn). */
  compro: boolean;
  /** Lo tomó una asesora: IA en pausa, chat asignado o ya le respondió una persona. */
  conAsesora: boolean;
};

const ms = (valor: Date | string) => (valor instanceof Date ? valor.getTime() : new Date(valor).getTime());

/** El paso del reporte que le toca a un paso del registro (Identificación cae en Presentación). */
export function pasoDelReporte(paso: string | null | undefined): ClaveDePasoDelReporte | null {
  if (!paso || ordenDelPaso(paso) < 0) return null;
  if (paso === "IDENTIFICACION") return "PRESENTACION";
  return PASOS_DEL_REPORTE.some((item) => item.clave === paso) ? (paso as ClaveDePasoDelReporte) : null;
}

/** Cuántas horas lleva el cliente sin escribir (desde que entró al paso si nunca se supo cuándo escribió). */
export function horasSinResponder(lead: Pick<LeadPorPaso, "ultimoClienteEn" | "pasoDesde">, ahora: Date): number | null {
  const referencia = lead.ultimoClienteEn ?? lead.pasoDesde;
  if (!referencia) return null;
  const tiempo = ms(referencia);
  return Number.isFinite(tiempo) ? (ahora.getTime() - tiempo) / 3_600_000 : null;
}

/** ¿Se quedó en su paso actual? Más de 24 h sin escribir, sin haber comprado. */
export function seQuedoAqui(lead: LeadPorPaso, ahora: Date): boolean {
  if (lead.compro || !pasoDelReporte(lead.pasoActual)) return false;
  const horas = horasSinResponder(lead, ahora);
  return horas !== null && horas > HORAS_PARA_QUEDARSE;
}

export type PasoDelEmbudoPorPaso = {
  clave: ClaveDePasoDelReporte;
  nombre: string;
  llegaron: number;
  /** Están en este paso, pero escribieron hace menos de 24 h: todavía no se sabe. */
  enCurso: number;
  seQuedaron: number;
  /** De los que llegaron, % que ya no está aquí por haberse quedado. */
  pctSeQuedaron: number | null;
  /** % de los que llegaron a este paso que llegaron al siguiente (null en el último). */
  tasaAlSiguiente: number | null;
  /** Hay menos de MINIMO_POR_PASO chats que llegaron: los % engañan. */
  pocosDatos: boolean;
  /** Horas promedio que pasaron en este paso, o null si no hay dato. */
  horasPromedio: number | null;
  /** Cuántos chats sirvieron para el promedio. */
  conTiempo: number;
};

export type CaidaMayorPorPaso = {
  desde: ClaveDePasoDelReporte;
  hacia: ClaveDePasoDelReporte;
  desdeNombre: string;
  haciaNombre: string;
  llegaronAlPaso: number;
  /** Los que llegaron al paso y no al siguiente. */
  noPasaron: number;
  tasa: number;
  pocosDatos: boolean;
};

export type GrupoPorPaso = {
  /** Chats del grupo (con o sin paso registrado). */
  chats: number;
  /** Chats del grupo con algún paso registrado. */
  conPaso: number;
  pasos: PasoDelEmbudoPorPaso[];
  mayorCaida: CaidaMayorPorPaso | null;
};

export type EmbudoPorPaso = {
  /** Chats que atendió solo el bot. */
  bot: GrupoPorPaso;
  /** Chats que tomó una asesora: aparte, para no mezclarlos. */
  asesora: GrupoPorPaso;
  total: number;
};

const indiceDelPaso = (clave: ClaveDePasoDelReporte) => PASOS_DEL_REPORTE.findIndex((item) => item.clave === clave);

/** Las horas que pasó cada lead en cada paso, del historial corto (de la entrada al paso a la entrada al siguiente). */
function duracionesDelLead(lead: LeadPorPaso): Array<{ paso: ClaveDePasoDelReporte; horas: number }> {
  const cambios = (lead.pasoHistorial ?? []).filter((cambio) => cambio && typeof cambio.en === "string");
  const duraciones: Array<{ paso: ClaveDePasoDelReporte; horas: number }> = [];
  for (let i = 0; i < cambios.length - 1; i += 1) {
    const paso = pasoDelReporte(cambios[i].paso);
    const horas = (ms(cambios[i + 1].en) - ms(cambios[i].en)) / 3_600_000;
    if (paso && Number.isFinite(horas) && horas >= 0) duraciones.push({ paso, horas });
  }
  return duraciones;
}

/** El mayor salto hacia abajo: la tasa de paso más baja entre los pasos que tienen chats. */
export function mayorCaidaDe(pasos: ReadonlyArray<PasoDelEmbudoPorPaso>): CaidaMayorPorPaso | null {
  let peor: CaidaMayorPorPaso | null = null;
  for (let i = 0; i < pasos.length - 1; i += 1) {
    const paso = pasos[i];
    if (!paso.llegaron || paso.tasaAlSiguiente === null) continue;
    if (peor === null || paso.tasaAlSiguiente < peor.tasa) {
      peor = {
        desde: paso.clave,
        hacia: pasos[i + 1].clave,
        desdeNombre: paso.nombre,
        haciaNombre: pasos[i + 1].nombre,
        llegaronAlPaso: paso.llegaron,
        noPasaron: paso.llegaron - pasos[i + 1].llegaron,
        tasa: paso.tasaAlSiguiente,
        pocosDatos: paso.pocosDatos,
      };
    }
  }
  return peor;
}

export function resumirGrupo(leads: ReadonlyArray<LeadPorPaso>, ahora: Date): GrupoPorPaso {
  const llegaron = new Array<number>(PASOS_DEL_REPORTE.length).fill(0);
  const seQuedaron = new Array<number>(PASOS_DEL_REPORTE.length).fill(0);
  const enCurso = new Array<number>(PASOS_DEL_REPORTE.length).fill(0);
  const sumaHoras = new Array<number>(PASOS_DEL_REPORTE.length).fill(0);
  const conTiempo = new Array<number>(PASOS_DEL_REPORTE.length).fill(0);
  let conPaso = 0;

  for (const lead of leads) {
    // Hasta dónde llegó: el más alto entre el máximo y el actual (una fila vieja puede traer solo uno).
    const actual = pasoDelReporte(lead.pasoActual);
    const maximo = pasoDelReporte(lead.pasoMaximo);
    if (!actual && !maximo) continue;
    conPaso += 1;
    const altura = Math.max(maximo ? indiceDelPaso(maximo) : 0, actual ? indiceDelPaso(actual) : 0);
    for (let i = 0; i <= altura; i += 1) llegaron[i] += 1;

    if (actual && !lead.compro) {
      if (seQuedoAqui(lead, ahora)) seQuedaron[indiceDelPaso(actual)] += 1;
      else enCurso[indiceDelPaso(actual)] += 1;
    }
    // Un chat puede pasar dos veces por el mismo paso: su tiempo en el paso es la suma.
    const porPaso = new Map<ClaveDePasoDelReporte, number>();
    for (const duracion of duracionesDelLead(lead)) porPaso.set(duracion.paso, (porPaso.get(duracion.paso) ?? 0) + duracion.horas);
    for (const [paso, horas] of porPaso) {
      sumaHoras[indiceDelPaso(paso)] += horas;
      conTiempo[indiceDelPaso(paso)] += 1;
    }
  }

  const pasos: PasoDelEmbudoPorPaso[] = PASOS_DEL_REPORTE.map((paso, i) => ({
    clave: paso.clave,
    nombre: paso.nombre,
    llegaron: llegaron[i],
    enCurso: enCurso[i],
    seQuedaron: seQuedaron[i],
    pctSeQuedaron: porcentaje(seQuedaron[i], llegaron[i]),
    tasaAlSiguiente: i < PASOS_DEL_REPORTE.length - 1 ? porcentaje(llegaron[i + 1], llegaron[i]) : null,
    pocosDatos: llegaron[i] < MINIMO_POR_PASO,
    horasPromedio: conTiempo[i] ? Math.round((sumaHoras[i] / conTiempo[i]) * 10) / 10 : null,
    conTiempo: conTiempo[i],
  }));
  return { chats: leads.length, conPaso, pasos, mayorCaida: mayorCaidaDe(pasos) };
}

/** Separa los chats del bot de los que tomó una asesora y arma el embudo de cada grupo. */
export function armarEmbudoPorPaso(leads: ReadonlyArray<LeadPorPaso>, ahora: Date): EmbudoPorPaso {
  return {
    bot: resumirGrupo(
      leads.filter((lead) => !lead.conAsesora),
      ahora,
    ),
    asesora: resumirGrupo(
      leads.filter((lead) => lead.conAsesora),
      ahora,
    ),
    total: leads.length,
  };
}

/** "3,5 h" o "2 días" para decir el tiempo promedio en un paso. */
export function textoDeHoras(horas: number | null): string {
  if (horas === null) return "sin dato";
  if (horas < 1) return `${Math.max(1, Math.round(horas * 60))} min`;
  if (horas < 48) return `${horas.toLocaleString("es-CO", { maximumFractionDigits: 1 })} h`;
  return `${(horas / 24).toLocaleString("es-CO", { maximumFractionDigits: 1 })} días`;
}

/** La frase corta para decir en la reunión de las 8:00. */
export function textoDelEmbudoPorPaso(input: { producto: string; desde: string; hasta: string; embudo: EmbudoPorPaso }): string {
  const { bot, asesora } = input.embudo;
  const encabezado = `${input.producto}, del ${input.desde} al ${input.hasta}`;
  if (!bot.conPaso) {
    return `${encabezado}: todavía no hay chats del bot con un paso registrado en ese rango.`;
  }
  const llegaron = bot.pasos.map((paso) => `${paso.nombre} ${paso.llegaron}`).join(", ");
  const partes = [`${encabezado}: ${bot.conPaso} chats del bot con paso. Llegaron: ${llegaron}.`];
  const caida = bot.mayorCaida;
  if (caida) {
    partes.push(
      `Donde más se cae es entre ${caida.desdeNombre} y ${caida.haciaNombre}: pasa el ${textoPct(caida.tasa)} (${caida.noPasaron} no pasaron).` +
        (caida.pocosDatos ? " Ojo: pocos datos." : ""),
    );
  }
  const mayorQuedada = [...bot.pasos].sort((a, b) => b.seQuedaron - a.seQuedaron)[0];
  if (mayorQuedada && mayorQuedada.seQuedaron > 0) {
    partes.push(`Llevan más de ${HORAS_PARA_QUEDARSE} h sin responder (se quedaron): ${mayorQuedada.seQuedaron} en ${mayorQuedada.nombre}.`);
  }
  if (asesora.chats) {
    partes.push(`Aparte, ${asesora.chats} chats los tomó una asesora y no se mezclan con estos.`);
  }
  return partes.join(" ");
}
