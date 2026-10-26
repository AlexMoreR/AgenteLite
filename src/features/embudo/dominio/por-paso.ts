/**
 * EMBUDO POR PASO: dónde se cae la gente dentro del bot (Presentación → Producto → Objeciones → Cierre).
 *
 * Código puro —sin base, sin Next—: lo usan la pantalla, la herramienta del MCP y la prueba
 * (scripts/check-embudo-por-paso.mjs). Solo cuenta; no decide nada del bot.
 *
 * - "Llegaron" a un paso: su paso más alto (pasoMaximo) es ese o uno posterior. Volver a un paso
 *   anterior no suma otra vez.
 * - "Se quedaron" en un paso: es su paso actual y llevan más de 24 horas sin escribir. Se calcula
 *   al mirar, así que no hay reloj y nunca queda desactualizado; si el cliente vuelve a escribir,
 *   deja de contar.
 * - Los chats que tomó una asesora (IA en pausa o chat asignado) van en un grupo aparte.
 */

import { ordenDelPaso, type CambioDePaso } from "./eventos";

export const PASOS_DEL_BOT = [
  { clave: "PRESENTACION", nombre: "Presentación" },
  { clave: "PRODUCTO", nombre: "Producto" },
  { clave: "OBJECIONES", nombre: "Objeciones" },
  { clave: "CIERRE", nombre: "Cierre" },
] as const;

export type ClaveDePasoDelBot = (typeof PASOS_DEL_BOT)[number]["clave"];

/** Horas sin escribir para decir que "se quedó aquí". */
export const HORAS_PARA_QUEDARSE = 24;

/** Con menos clientes que esto en un paso, los porcentajes llevan el aviso "pocos datos". */
export const MINIMO_PARA_PORCENTAJE = 30;

export type LeadPorPaso = {
  conversationId: string;
  pasoActual: string | null;
  pasoMaximo: string | null;
  pasoDesde: Date | null;
  entradaEn: Date;
  ultimoClienteEn: Date | null;
  historial: CambioDePaso[] | null;
  /** IA en pausa o chat asignado: lo atendió una persona. */
  conAsesora: boolean;
};

/** ¿Se quedó en su paso actual? (más de 24 h sin escribir). */
export function seQuedoAqui(lead: Pick<LeadPorPaso, "pasoDesde" | "entradaEn" | "ultimoClienteEn">, ahora: Date): boolean {
  const ultimo = lead.ultimoClienteEn ?? lead.pasoDesde ?? lead.entradaEn;
  return ahora.getTime() - ultimo.getTime() > HORAS_PARA_QUEDARSE * 3_600_000;
}

export type PasoMedido = {
  clave: ClaveDePasoDelBot;
  nombre: string;
  llegaron: number;
  seQuedaron: number;
  /** % de los que llegaron al paso anterior y también llegaron a este. null = no hay base. */
  pasaDesdeAnterior: number | null;
  /** Promedio de horas que pasaron en este paso (solo cambios ya hechos). null = sin datos. */
  horasPromedio: number | null;
  pocosDatos: boolean;
};

export type CaidaDelEmbudo = { desde: string; hasta: string; pctQuePasa: number; seCaen: number };

export type GrupoPorPaso = {
  chats: number;
  pasos: PasoMedido[];
  mayorCaida: CaidaDelEmbudo | null;
};

export function pct(parte: number, base: number): number | null {
  return base > 0 ? Math.round((parte / base) * 100) : null;
}

function horasEnCadaPaso(leads: ReadonlyArray<LeadPorPaso>): Map<string, { suma: number; n: number }> {
  const mapa = new Map<string, { suma: number; n: number }>();
  for (const lead of leads) {
    const lista = [...(lead.historial ?? [])].sort((a, b) => a.en.localeCompare(b.en));
    for (let i = 0; i < lista.length - 1; i += 1) {
      const horas = (new Date(lista[i + 1].en).getTime() - new Date(lista[i].en).getTime()) / 3_600_000;
      if (!Number.isFinite(horas) || horas < 0) continue;
      const acumulado = mapa.get(lista[i].paso) ?? { suma: 0, n: 0 };
      acumulado.suma += horas;
      acumulado.n += 1;
      mapa.set(lista[i].paso, acumulado);
    }
  }
  return mapa;
}

export function medirGrupo(leads: ReadonlyArray<LeadPorPaso>, ahora: Date): GrupoPorPaso {
  const horas = horasEnCadaPaso(leads);
  const pasos: PasoMedido[] = PASOS_DEL_BOT.map((paso, indice) => {
    const orden = ordenDelPaso(paso.clave);
    const llegaron = leads.filter((lead) => ordenDelPaso(lead.pasoMaximo) >= orden).length;
    const seQuedaron = leads.filter((lead) => lead.pasoActual === paso.clave && seQuedoAqui(lead, ahora)).length;
    const anterior = indice > 0 ? leads.filter((lead) => ordenDelPaso(lead.pasoMaximo) >= ordenDelPaso(PASOS_DEL_BOT[indice - 1].clave)).length : 0;
    const tiempo = horas.get(paso.clave);
    return {
      clave: paso.clave,
      nombre: paso.nombre,
      llegaron,
      seQuedaron,
      pasaDesdeAnterior: indice === 0 ? null : pct(llegaron, anterior),
      horasPromedio: tiempo && tiempo.n > 0 ? Math.round((tiempo.suma / tiempo.n) * 10) / 10 : null,
      pocosDatos: (indice === 0 ? llegaron : anterior) < MINIMO_PARA_PORCENTAJE,
    };
  });
  return { chats: leads.length, pasos, mayorCaida: mayorCaidaDe(pasos) };
}

/** El salto de paso a paso con el menor % que pasa. Prefiere los que tienen datos suficientes. */
export function mayorCaidaDe(pasos: ReadonlyArray<PasoMedido>): CaidaDelEmbudo | null {
  const saltos = pasos
    .map((paso, i) => ({ paso, anterior: i > 0 ? pasos[i - 1] : null }))
    .filter((x): x is { paso: PasoMedido; anterior: PasoMedido } => x.anterior !== null && x.paso.pasaDesdeAnterior !== null);
  if (!saltos.length) return null;
  const confiables = saltos.filter((x) => !x.paso.pocosDatos);
  const lista = confiables.length ? confiables : saltos;
  const peor = lista.reduce((a, b) => ((b.paso.pasaDesdeAnterior ?? 101) < (a.paso.pasaDesdeAnterior ?? 101) ? b : a));
  return {
    desde: peor.anterior.nombre,
    hasta: peor.paso.nombre,
    pctQuePasa: peor.paso.pasaDesdeAnterior ?? 0,
    seCaen: peor.anterior.llegaron - peor.paso.llegaron,
  };
}

export type EmbudoPorPaso = {
  soloBot: GrupoPorPaso;
  conAsesora: GrupoPorPaso;
  total: number;
};

export function armarEmbudoPorPaso(leads: ReadonlyArray<LeadPorPaso>, ahora: Date): EmbudoPorPaso {
  return {
    soloBot: medirGrupo(leads.filter((lead) => !lead.conAsesora), ahora),
    conAsesora: medirGrupo(leads.filter((lead) => lead.conAsesora), ahora),
    total: leads.length,
  };
}

/** Frase corta para decir en voz alta (reunión de las 8:00). */
export function textoPorPaso(embudo: EmbudoPorPaso, nombreProducto: string): string {
  const bot = embudo.soloBot;
  if (bot.chats === 0) {
    return `No hay chats del bot de ${nombreProducto} en ese rango.`;
  }
  const llegadas = bot.pasos.map((paso) => `${paso.nombre} ${paso.llegaron}`).join(", ");
  const partes = [`${nombreProducto}, solo el bot (${bot.chats} chats): llegaron a ${llegadas}.`];
  if (bot.mayorCaida) {
    const c = bot.mayorCaida;
    partes.push(`Donde más se cae es de ${c.desde} a ${c.hasta}: pasa el ${c.pctQuePasa} % (se caen ${c.seCaen}).`);
  }
  if (bot.pasos.some((paso) => paso.pocosDatos)) {
    partes.push("Ojo: pocos datos en algún paso, los porcentajes pueden cambiar.");
  }
  if (embudo.conAsesora.chats > 0) {
    partes.push(`Aparte, ${embudo.conAsesora.chats} chats los tomó una asesora.`);
  }
  return partes.join(" ");
}
