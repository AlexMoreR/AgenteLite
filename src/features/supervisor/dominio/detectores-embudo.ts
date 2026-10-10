/**
 * DETECTORES DEL EMBUDO (código puro): los indicadores comerciales contra su línea base, por
 * producto, por asesora y antes/después de cada versión del libro.
 */

import { comparar, cusumBaja, mediana, pct, tasa, type ReglaDeSignificancia } from "./estadistica";
import { compararAntesYDespues, compararConBase, NOMBRE_DE_FRANJA, franja, type FiltroDeLeads, type IndicadorDeTasa } from "./linea-base";
import { MALO_SI_SUBE, NOMBRE_DEL_INDICADOR, disponible, valorDelIndicador, type FichaDelLead } from "./lead";
import { cambioMasExplicativo, cambioSospechoso, respuestaSegunRafaga } from "./detectores-bot";
import type { CambioDelLibro, Hallazgo, Severidad } from "./tipos";

const HORA = 3_600_000;

export const INDICADORES_DEL_EMBUDO: IndicadorDeTasa[] = [
  "respondio_2h",
  "conversa_3_24h",
  "senal_24h",
  "a_asesora_24h",
  "asesora_sin_senal_24h",
  "senal_sin_asesora_1h",
  "insistencia_72h",
];

/** Supuestos para estimar el impacto en plata. Son ESTIMACIONES, se dicen como tales. */
export type SupuestosComerciales = {
  ticket: number;
  /** Ventas sobre leads que responden (aprox. 5 ventas / 1.018 leads del combo, con ~66 % de respuesta). */
  cierreSobreRespondidos: number;
};

export const SUPUESTOS_POR_DEFECTO: SupuestosComerciales = { ticket: 989_000, cierreSobreRespondidos: 0.0075 };

function pesos(valor: number): string {
  return `$${Math.round(valor).toLocaleString("es-CO")}`;
}

function leadsPorDia(fichas: FichaDelLead[], filtro: FiltroDeLeads, ahora: Date): number {
  const desde = ahora.getTime() - 7 * 24 * HORA;
  return fichas.filter((f) => filtro(f) && f.entradaEn.getTime() >= desde && f.entradaEn.getTime() <= ahora.getTime()).length / 7;
}

const RECOMENDACION: Partial<Record<IndicadorDeTasa, { recomendacion: string; queCambiar: string; tocaProduccion: boolean }>> = {
  respondio_2h: {
    recomendacion: "Revisar qué recibe el cliente en el primer turno (regla ganadora, ráfagas, precio de entrada) y compararlo con la versión anterior del libro.",
    queCambiar: "Libro V3 (primer turno) o el anuncio, según la causa.",
    tocaProduccion: true,
  },
  conversa_3_24h: {
    recomendacion: "Ver en qué paso se detienen (abandono por paso) y qué pregunta hace el bot ahí.",
    queCambiar: "Regla del paso donde se cae la charla.",
    tocaProduccion: true,
  },
  senal_24h: {
    recomendacion: "Ver si cambió el anuncio o el público, o si el bot dejó de invitar a preguntar (precio, envío, color).",
    queCambiar: "Anuncio o libro V3.",
    tocaProduccion: true,
  },
  a_asesora_24h: {
    recomendacion: "Revisar el reparto y los avisos del bot (avisar_asesor).",
    queCambiar: "Reparto / reglas que avisan a la asesora.",
    tocaProduccion: true,
  },
  asesora_sin_senal_24h: {
    recomendacion: "Pasar a asesora solo cuando hay señal de compra (F3 del diseño del embudo, en sombra primero).",
    queCambiar: "Regla del reparto (código, F3).",
    tocaProduccion: true,
  },
  senal_sin_asesora_1h: {
    recomendacion: "Que la asesora atienda primero los chats con señal (Mi Día / avisos) y que el aviso se repita si no hay respuesta en 15 min.",
    queCambiar: "Prioridad de atención del equipo; aviso repetido (código).",
    tocaProduccion: false,
  },
  insistencia_72h: {
    recomendacion: "Tope de 2 seguimientos automáticos EN TOTAL a quien nunca respondió y horario de 7 a. m. a 9 p. m.",
    queCambiar: "Seguimientos del V3 y del V2 (código/configuración).",
    tocaProduccion: true,
  },
};

/**
 * Severidad con confirmación por PERÍODO EQUIVALENTE (misma franja horaria y mismo día de la
 * semana). La primera simulación (21-sep a 6-oct) mostró que los indicadores de operación humana
 * (pasar a asesora, responder a tiempo) bajan solos los domingos y en la noche: sin esta
 * confirmación eran 20+ avisos falsos en dos semanas.
 *
 * - Respuesta del cliente: CRÍTICO con ≥ 20 pts y confirmado contra franja y día; si no, IMPORTANTE.
 * - Indicadores de operación: OBSERVACIÓN (se ven en la pantalla, no se avisan) salvo ≥ 20 pts
 *   confirmados contra franja y día → IMPORTANTE.
 */
function severidadDe(indicador: IndicadorDeTasa, c: { puntos: number; mismaFranja: { z: number } | null; mismoDia: { z: number } | null }): Severidad {
  const abs = Math.abs(c.puntos);
  const confirma = (x: { z: number } | null) => x !== null && Math.abs(x.z) >= 2.5;
  const confirmado = confirma(c.mismaFranja) && confirma(c.mismoDia);
  if (indicador === "respondio_2h") return abs >= 20 && confirmado ? "CRITICO" : "IMPORTANTE";
  return abs >= 20 && confirmado ? "IMPORTANTE" : "OBSERVACION";
}

/** Para la respuesta del cliente se pide más muestra: es el indicador que más avisa. */
const REGLA_RESPUESTA: ReglaDeSignificancia = { minimoObservado: 30, minimoBase: 50, zMinimo: 3, puntosMinimos: 15 };

/** Un indicador del embudo contra su base (y, si hay, contra el antes de un cambio del libro). */
export function detectarIndicador(input: {
  fichas: FichaDelLead[];
  ahora: Date;
  producto: string;
  filtro: FiltroDeLeads;
  indicador: IndicadorDeTasa;
  cambios: CambioDelLibro[];
  regla?: ReglaDeSignificancia;
  supuestos?: SupuestosComerciales;
  asesora?: { id: string; nombre?: string | null } | null;
}): Hallazgo | null {
  const regla = input.regla ?? (input.indicador === "respondio_2h" ? REGLA_RESPUESTA : undefined);
  const c = compararConBase(input.fichas, input.indicador, input.ahora, input.filtro, regla);
  if (!c || !c.significativo) return null;
  const malo = MALO_SI_SUBE.has(input.indicador) ? c.direccion === "sube" : c.direccion === "baja";
  if (!malo) return null;

  let severidad = severidadDe(input.indicador, c);
  const hipotesis: string[] = [];
  // Período equivalente: si contra la MISMA franja horaria no es distinto, puede ser la hora.
  if (c.mismaFranja && Math.abs(c.mismaFranja.z) < 2) {
    severidad = "OBSERVACION";
    hipotesis.push(`Contra la misma franja horaria la diferencia no es clara (${pct(c.mismaFranja.tasaEsperada)}): puede ser efecto de la hora del día.`);
  }

  const observados = input.fichas.filter((f) => c.chatsObservados.includes(f.conversationId));
  const primero = [...observados].sort((a, b) => a.entradaEn.getTime() - b.entradaEn.getTime())[0];
  const indicador = input.indicador;
  const peor = MALO_SI_SUBE.has(indicador);
  const culpable = cambioMasExplicativo({
    fichas: input.fichas,
    ahora: input.ahora,
    cambios: input.cambios,
    filtro: input.filtro,
    malo: (f) => {
      if (!disponible(f, indicador, input.ahora)) return null;
      const v = valorDelIndicador(f, indicador);
      return v === null ? null : peor ? v : !v;
    },
  });
  const inicio = culpable?.en ?? primero?.entradaEn ?? c.observadaDesde;
  const cambio = culpable ?? cambioSospechoso(input.cambios, c.observadaDesde);
  const hechos = [
    `${NOMBRE_DEL_INDICADOR[input.indicador]}: ${pct(c.tasaObservada)} (${c.observado.exitos}/${c.observado.total}) en las últimas ${c.ventanaHoras} h con leads maduros, contra ${pct(c.tasaEsperada)} (${c.esperado.exitos}/${c.esperado.total}) en los 14 días anteriores. Diferencia ${c.puntos > 0 ? "+" : ""}${c.puntos.toFixed(1)} pts, z = ${c.z.toFixed(1)}.`,
  ];
  if (c.mismaFranja) hechos.push(`Misma franja horaria en la base: ${pct(c.mismaFranja.tasaEsperada)} (z = ${c.mismaFranja.z.toFixed(1)}).`);
  if (c.mismoDia) hechos.push(`Mismo día de la semana en la base: ${pct(c.mismoDia.tasaEsperada)} (z = ${c.mismoDia.z.toFixed(1)}).`);
  if (cambio) {
    const ad = compararAntesYDespues(input.fichas, input.indicador, input.ahora, cambio.en, input.filtro, regla);
    if (ad) hechos.push(`Desde la versión ${cambio.version} del libro: ${pct(ad.tasaObservada)} (${ad.observado.exitos}/${ad.observado.total}) vs ${pct(ad.tasaEsperada)} antes.`);
    hipotesis.push(`Lo causó el cambio del libro a la versión ${cambio.version}.`);
  }
  if (input.indicador === "respondio_2h") {
    const r = respuestaSegunRafaga(input.fichas, input.ahora, input.filtro);
    if (r.conMuestra) {
      hechos.push(`Últimos 7 días: respondieron ${pct(r.tasaObservada)} de los que recibieron ráfaga (>3 mensajes en 5 min) y ${pct(r.tasaEsperada)} de los que no (${r.observado.total} y ${r.esperado.total} leads).`);
      if (r.significativo && r.direccion === "baja") hipotesis.push("La ráfaga de mensajes del bot espanta al cliente (correlación, no prueba de causa).");
    }
  }

  let impacto = "Sin estimación.";
  if (input.indicador === "respondio_2h") {
    const porDia = leadsPorDia(input.fichas, input.filtro, input.ahora);
    const menos = (porDia * Math.abs(c.puntos)) / 100;
    const s = input.supuestos ?? SUPUESTOS_POR_DEFECTO;
    impacto = `ESTIMACIÓN: entran ~${porDia.toFixed(0)} leads/día; ≈ ${menos.toFixed(0)} clientes menos responden por día. Con ~${(s.cierreSobreRespondidos * 100).toFixed(2)} % de cierre sobre los que responden y ticket de ${pesos(s.ticket)}, ≈ ${pesos(menos * s.cierreSobreRespondidos * s.ticket)} por día en riesgo (≈ ${pesos(menos * s.cierreSobreRespondidos * s.ticket * 30)} al mes).`;
  } else if (input.indicador === "senal_sin_asesora_1h") {
    impacto = `${c.observado.exitos} leads con señal de compra esperaron más de 1 h o no tuvieron respuesta humana.`;
  }

  const textos = RECOMENDACION[input.indicador];
  const quien = input.asesora ? ` (${input.asesora.nombre ?? input.asesora.id})` : "";
  return {
    clave: `EMBUDO:${input.indicador}:${input.producto}${input.asesora ? `:${input.asesora.id}` : ""}`,
    familia: "EMBUDO",
    severidad,
    titulo: `${NOMBRE_DEL_INDICADOR[input.indicador]}${quien}: ${c.direccion === "baja" ? "bajó" : "subió"} ${Math.abs(c.puntos).toFixed(0)} pts`,
    que: `${NOMBRE_DEL_INDICADOR[input.indicador]}${quien} pasó de ${pct(c.tasaEsperada)} a ${pct(c.tasaObservada)}.`,
    desde: inicio,
    producto: input.producto,
    asesoraId: input.asesora?.id ?? null,
    leadsAfectados: MALO_SI_SUBE.has(input.indicador) ? c.observado.exitos : c.observado.total - c.observado.exitos,
    evidencia: { chats: c.chatsObservados.slice(0, 8), reglas: [], versiones: cambio ? [cambio.version] : [] },
    metrica: NOMBRE_DEL_INDICADOR[input.indicador],
    esperado: `${pct(c.tasaEsperada)} (base 14 días; intervalo de confianza aplicado con z ≥ ${(regla?.zMinimo ?? 3).toFixed(0)})`,
    observado: `${pct(c.tasaObservada)} (${c.observado.exitos}/${c.observado.total}, últimas ${c.ventanaHoras} h)`,
    hechos,
    hipotesis,
    causaPosible: cambio ? `Cambio del libro V3 a la versión ${cambio.version}.` : "Por confirmar (anuncio, público, horario o atención).",
    impacto,
    recomendacion: textos?.recomendacion ?? "Revisar los chats de ejemplo.",
    queCambiar: textos?.queCambiar ?? "Por definir.",
    riesgo: "Medio: cualquier cambio de libro o reparto afecta a todos los leads nuevos; probar antes en el simulador o en sombra.",
    comoMedir: `${NOMBRE_DEL_INDICADOR[input.indicador]} vuelve a ~${pct(c.tasaEsperada)} con al menos ${c.observado.total} leads maduros.`,
    tocaProduccion: textos?.tocaProduccion ?? true,
    valores: { z: Number(c.z.toFixed(2)), puntos: Number(c.puntos.toFixed(1)), n: c.observado.total, ventanaHoras: c.ventanaHoras },
  };
}

/**
 * CUSUM de la respuesta lead por lead (últimas 48 h): avisa antes que la prueba de proporciones
 * cuando la caída es grande, con pocos leads. Solo OBSERVACIÓN/IMPORTANTE: no reemplaza la prueba.
 */
export function detectarCusumRespuesta(input: { fichas: FichaDelLead[]; ahora: Date; producto: string; filtro: FiltroDeLeads }): Hallazgo | null {
  const maduros = input.fichas
    .filter((f) => input.filtro(f) && disponible(f, "respondio_2h", input.ahora))
    .sort((a, b) => a.entradaEn.getTime() - b.entradaEn.getTime());
  const corte = input.ahora.getTime() - 48 * HORA;
  const base = maduros.filter((f) => f.entradaEn.getTime() < corte - 24 * HORA && f.entradaEn.getTime() >= corte - 15 * 24 * HORA);
  const recientes = maduros.filter((f) => f.entradaEn.getTime() >= corte);
  if (base.length < 100 || recientes.length < 10) return null;
  const p0 = base.filter((f) => valorDelIndicador(f, "respondio_2h")).length / base.length;
  const serie = recientes.map((f) => (valorDelIndicador(f, "respondio_2h") ? 1 : 0) as 0 | 1);
  const cusum = cusumBaja(serie, p0, 0.075, 5);
  if (cusum.alarmaEn === null) return null;
  const desdeLead = recientes[Math.max(0, cusum.serie.findIndex((v) => v > 0))];
  const tramo = recientes.slice(recientes.indexOf(desdeLead));
  const obs = { exitos: tramo.filter((f) => valorDelIndicador(f, "respondio_2h")).length, total: tramo.length };
  const c = comparar(obs, { exitos: Math.round(p0 * base.length), total: base.length }, { minimoObservado: 10, minimoBase: 100, zMinimo: 2.5, puntosMinimos: 15 });
  if (!c.significativo || c.direccion !== "baja") return null;
  return {
    clave: `EMBUDO:respondio_2h_cusum:${input.producto}`,
    familia: "EMBUDO",
    // Alarma temprana: se ve en la pantalla, no se avisa (en la simulación sonaba también de noche).
    severidad: "OBSERVACION",
    titulo: "Alarma temprana: la respuesta de los clientes viene cayendo (CUSUM)",
    que: `Desde el lead del ${desdeLead.entradaEn.toISOString().slice(0, 16)} UTC la respuesta en 2 h es ${pct(tasa(obs))} contra ${pct(p0)} de la base.`,
    desde: desdeLead.entradaEn,
    producto: input.producto,
    leadsAfectados: obs.total - obs.exitos,
    evidencia: { chats: tramo.filter((f) => !valorDelIndicador(f, "respondio_2h")).slice(0, 8).map((f) => f.conversationId), reglas: [], versiones: [] },
    metrica: NOMBRE_DEL_INDICADOR.respondio_2h,
    esperado: pct(p0),
    observado: `${pct(tasa(obs))} (${obs.exitos}/${obs.total})`,
    hechos: [`CUSUM (k = 0,075, h = 5) superó el umbral en el lead ${cusum.alarmaEn + 1} de ${recientes.length} de las últimas 48 h.`],
    hipotesis: ["Es una alarma temprana con pocos leads: se confirma o se descarta en las próximas horas."],
    causaPosible: "Por confirmar.",
    impacto: "Ver el detector de respuesta cuando haya muestra suficiente.",
    recomendacion: "Mirar los chats de ejemplo y el primer turno del bot.",
    queCambiar: "Nada todavía.",
    riesgo: "—",
    comoMedir: "Que el CUSUM vuelva a 0.",
    tocaProduccion: false,
    valores: { p0: Number(p0.toFixed(3)) },
  };
}

/** Por asesora: señal sin respuesta humana en 1 h y mediana de espera tras la señal. */
export function detectarPorAsesora(input: {
  fichas: FichaDelLead[];
  ahora: Date;
  producto: string;
  filtro: FiltroDeLeads;
  nombres?: Record<string, string>;
}): Hallazgo[] {
  const salida: Hallazgo[] = [];
  const asesoras = new Set(input.fichas.filter((f) => f.asesoraId).map((f) => f.asesoraId as string));
  for (const id of asesoras) {
    const h = detectarIndicador({
      fichas: input.fichas,
      ahora: input.ahora,
      producto: input.producto,
      filtro: (f) => input.filtro(f) && f.asesoraId === id,
      indicador: "senal_sin_asesora_1h",
      cambios: [],
      regla: { minimoObservado: 10, minimoBase: 30, zMinimo: 3, puntosMinimos: 15 },
      asesora: { id, nombre: input.nombres?.[id] },
    });
    if (h) {
      const esperas = input.fichas
        .filter((f) => f.asesoraId === id && f.minutosSenalARespuestaHumana !== null && f.entradaEn.getTime() >= input.ahora.getTime() - 7 * 24 * HORA)
        .map((f) => f.minutosSenalARespuestaHumana as number);
      const m = mediana(esperas);
      if (m !== null) h.hechos.push(`Mediana de espera tras la señal (7 días): ${m.toFixed(0)} min.`);
      // Sigue en la familia EMBUDO (lo calcula la vuelta de cada hora, no el chequeo de 5 min).
      // Por asesora es para la pantalla y el informe del día, no para despertar a nadie.
      h.severidad = "OBSERVACION";
      salida.push(h);
    }
  }
  return salida;
}

/** Dónde se quedan los leads (paso máximo), si la ficha lo trae (EmbudoLead / relleno). */
export function abandonoPorPaso(fichas: FichaDelLead[], ahora: Date, filtro: FiltroDeLeads, desde: Date, hasta: Date) {
  const maduros = fichas.filter(
    (f) => filtro(f) && f.pasoMaximo !== undefined && ahora.getTime() - f.entradaEn.getTime() >= 72 * HORA && f.entradaEn >= desde && f.entradaEn < hasta,
  );
  const conteo: Record<string, number> = {};
  for (const f of maduros) conteo[f.pasoMaximo ?? "SIN_PASO"] = (conteo[f.pasoMaximo ?? "SIN_PASO"] ?? 0) + 1;
  return { total: maduros.length, conteo };
}

export { NOMBRE_DE_FRANJA, franja };
