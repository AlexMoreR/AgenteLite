/**
 * DETECTORES DEL BOT (código puro): miran CÓMO se comporta el agente V3 con los leads recientes,
 * contra su línea base.
 *
 * - Cambio de la regla que gana el primer mensaje (Jensen-Shannon + cambio de la regla modal), o
 *   una regla nueva que se queda con el tráfico de otra.
 * - Ráfagas (> 3 mensajes del bot en los primeros 5 min).
 * - Precio o fotos antes de identificar al cliente.
 * - Preguntas repetidas y pregunta de ciudad cuando ya la dijo.
 *
 * Los conflictos de reglas y el diff del libro los cubre el Change Guardian (guardian.ts,
 * libro-diff.ts), que corre sobre el libro y no sobre los chats.
 */

import { comparar, pct, type ReglaDeSignificancia } from "./estadistica";
import {
  compararAntesYDespues,
  compararConBase,
  distribucionDeReglas,
  NOMBRE_DE_FRANJA,
  franja,
  type ComparacionConBase,
  type FiltroDeLeads,
} from "./linea-base";
import { NOMBRE_DEL_INDICADOR, disponible, valorDelIndicador, type FichaDelLead } from "./lead";
import { ESPERANDO_AUTORIZACION, type CambioDelLibro, type Hallazgo } from "./tipos";

const HORA = 3_600_000;

export const UMBRALES_BOT = {
  /** Leads mínimos con regla conocida en la ventana observada. */
  minimoReglas: 10,
  minimoBaseReglas: 30,
  /** Leads mínimos DESPUÉS de un cambio del libro para comparar contra lo de antes. */
  minimoTrasCambio: 6,
  /** Distancia de Jensen-Shannon a partir de la cual la mezcla de reglas cambió de verdad. */
  jsMinimo: 0.25,
  /** Comportamientos fuertes (ráfaga, precio/fotos): efectos grandes, muestra chica. */
  comportamiento: { minimoObservado: 10, minimoBase: 50, zMinimo: 3, puntosMinimos: 20 } as ReglaDeSignificancia,
};

function corto(texto: string | null, largo = 70): string {
  if (!texto) return "(ninguna)";
  return texto.length > largo ? `${texto.slice(0, largo - 1)}…` : texto;
}

function hhmm(fecha: Date): string {
  const b = new Date(fecha.getTime() - 5 * HORA);
  return `${b.toISOString().slice(0, 10)} ${b.toISOString().slice(11, 16)} (Bogotá)`;
}

/** El cambio del libro más reciente que pudo causar algo que empezó en `desde` (hasta 48 h antes). */
export function cambioSospechoso(cambios: CambioDelLibro[], desde: Date): CambioDelLibro | null {
  const candidatos = cambios
    .filter((c) => c.en.getTime() <= desde.getTime() + 5 * 60_000 && c.en.getTime() >= desde.getTime() - 48 * HORA)
    .sort((a, b) => b.en.getTime() - a.en.getTime());
  return candidatos[0] ?? null;
}

/**
 * El cambio del libro (últimos 7 días) que MEJOR explica un cambio en una señal por lead: el que
 * tiene el salto antes/después más fuerte en la dirección mala. Así un problema que sigue igual
 * después de otros cambios se le atribuye al que lo causó y no al último.
 */
export function cambioMasExplicativo(input: {
  fichas: FichaDelLead[];
  ahora: Date;
  cambios: CambioDelLibro[];
  filtro: FiltroDeLeads;
  /** Valor malo por lead (true = le pasó lo malo), o null si no aplica / no maduró. */
  malo: (f: FichaDelLead) => boolean | null;
}): CambioDelLibro | null {
  let mejor: { cambio: CambioDelLibro; z: number } | null = null;
  for (const cambio of input.cambios) {
    if (cambio.en > input.ahora || input.ahora.getTime() - cambio.en.getTime() > 7 * 24 * HORA) continue;
    const t = cambio.en.getTime();
    const contar = (lista: FichaDelLead[]) => {
      let exitos = 0;
      let total = 0;
      for (const f of lista) {
        const v = input.malo(f);
        if (v === null) continue;
        total += 1;
        if (v) exitos += 1;
      }
      return { exitos, total };
    };
    const delFiltro = input.fichas.filter(input.filtro);
    // El "después" de cada cambio llega hasta el cambio siguiente: así cada versión responde solo
    // por los leads que atendió ella.
    const siguiente = input.cambios
      .filter((c) => c.en.getTime() > t && c.en <= input.ahora)
      .sort((a, b) => a.en.getTime() - b.en.getTime())[0];
    const fin = siguiente ? siguiente.en.getTime() : input.ahora.getTime();
    const despues = contar(delFiltro.filter((f) => f.entradaEn.getTime() >= t && f.entradaEn.getTime() < fin));
    const antes = contar(delFiltro.filter((f) => f.entradaEn.getTime() < t && f.entradaEn.getTime() >= t - 14 * 24 * HORA));
    const c = comparar(despues, antes, { minimoObservado: 5, minimoBase: 20, zMinimo: 3, puntosMinimos: 10 });
    if (c.significativo && c.direccion === "sube" && (!mejor || c.z > mejor.z)) mejor = { cambio, z: c.z };
  }
  return mejor?.cambio ?? null;
}

/** El cambio del libro más reciente de las últimas 48 h (o null). */
export function ultimoCambio(cambios: CambioDelLibro[], ahora: Date): CambioDelLibro | null {
  return (
    cambios
      .filter((c) => c.en.getTime() <= ahora.getTime() && ahora.getTime() - c.en.getTime() <= 48 * HORA)
      .sort((a, b) => b.en.getTime() - a.en.getTime())[0] ?? null
  );
}

function disparaCambioDeRegla(dist: NonNullable<ReturnType<typeof distribucionDeReglas>>, minimo: number): boolean {
  const nObs = dist.modaObservada.total;
  const nBase = dist.modaBase.total;
  if (nObs < minimo || nBase < UMBRALES_BOT.minimoBaseReglas) return false;
  const cambioModa = dist.modaObservada.clave !== dist.modaBase.clave;
  const participacionAhoraDeLaVieja = dist.modaBase.clave ? (dist.observado[dist.modaBase.clave] ?? 0) / nObs : 0;
  const caidaDeLaVieja = dist.modaBase.participacion - participacionAhoraDeLaVieja;
  // La regla nueva tiene que ganar en al menos 5 leads y en la mayoría: con 6 leads, 2 "Hola"
  // sueltos no pueden pasar por un cambio de regla.
  const ganesDeLaNueva = Math.round(dist.modaObservada.participacion * nObs);
  const fuerte = ganesDeLaNueva >= 5 && dist.modaObservada.participacion >= 0.5;
  return dist.js >= UMBRALES_BOT.jsMinimo && fuerte && (cambioModa || caidaDeLaVieja >= 0.3);
}

export function detectarCambioDeReglaGanadora(input: {
  fichas: FichaDelLead[];
  ahora: Date;
  producto: string;
  filtro: FiltroDeLeads;
  cambios: CambioDelLibro[];
}): Hallazgo | null {
  /*
    Dos miradas: la ventana adaptativa de siempre y, si el libro cambió en las últimas 48 h, SOLO
    los leads posteriores al cambio contra los de antes. De noche entran pocos leads y la ventana
    adaptativa se estira a 12 h mezclando antes y después del cambio; la mirada "desde el cambio"
    no se diluye y avisa con menos leads.
  */
  const reciente = ultimoCambio(input.cambios, input.ahora);
  const candidatas = [
    distribucionDeReglas(input.fichas, input.ahora, input.filtro, UMBRALES_BOT.minimoReglas),
    reciente ? distribucionDeReglas(input.fichas, input.ahora, input.filtro, UMBRALES_BOT.minimoTrasCambio, reciente.en) : null,
  ];
  const dist = candidatas.find((d) => d && disparaCambioDeRegla(d, d === candidatas[1] ? UMBRALES_BOT.minimoTrasCambio : UMBRALES_BOT.minimoReglas));
  if (!dist) return null;
  const nueva = dist.modaObservada.clave;
  // ¿Qué cambio del libro lo explica? El que más subió la participación de la regla nueva.
  const maduro = (f: FichaDelLead) => input.ahora.getTime() - f.entradaEn.getTime() >= 10 * 60_000;
  const culpable = cambioMasExplicativo({
    fichas: input.fichas,
    ahora: input.ahora,
    cambios: input.cambios,
    filtro: input.filtro,
    malo: (f) => (f.reglaPrimerMensaje && maduro(f) ? f.reglaPrimerMensaje === nueva : null),
  });
  // Con culpable, las cifras son "desde el cambio" contra "los 14 días antes del cambio" (sin
  // contaminar la base con los días que ya venían mal).
  const vista = (culpable && distribucionDeReglas(input.fichas, input.ahora, input.filtro, 1, culpable.en)) || dist;
  const nObs = vista.modaObservada.total;
  const nBase = vista.modaBase.total;
  const vieja = vista.modaBase.clave;
  const participacionBaseDeLaNueva = nueva ? (vista.base[nueva] ?? 0) / Math.max(1, nBase) : 0;
  const participacionNueva = nueva ? (vista.observado[nueva] ?? 0) / Math.max(1, nObs) : 0;

  const conLaNueva = input.fichas
    .filter(
      (f) =>
        input.filtro(f) &&
        f.reglaPrimerMensaje === nueva &&
        f.entradaEn.getTime() <= input.ahora.getTime() &&
        f.entradaEn.getTime() >= (culpable ? culpable.en.getTime() : input.ahora.getTime() - 48 * HORA),
    )
    .sort((a, b) => a.entradaEn.getTime() - b.entradaEn.getTime());
  const primero = conLaNueva[0];
  const desde = culpable?.en ?? primero?.entradaEn ?? dist.observadaDesde;
  const cambio = culpable ?? cambioSospechoso(input.cambios, primero?.entradaEn ?? desde);
  const capturada = participacionBaseDeLaNueva < 0.05;

  const ventana = culpable ? `desde el cambio a la versión ${culpable.version}` : `ventana de ${vista.ventanaHoras} h`;
  const participacionVieja = vista.modaBase.participacion;
  const hechos = [
    `En ${nObs} leads con primer mensaje (${ventana}) ganó "${corto(nueva)}" en ${pct(participacionNueva)}; en la línea base (${nBase} leads, 14 días${culpable ? " antes del cambio" : ""}) ganaba "${corto(vieja)}" en ${pct(participacionVieja)}.`,
    `"${corto(nueva)}" ganaba solo el ${pct(participacionBaseDeLaNueva)} de los primeros mensajes en la base.`,
    `Última ventana: ${dist.modaObservada.total} leads, "${corto(dist.modaObservada.clave)}" en ${pct(dist.modaObservada.participacion)}. Distancia entre mezclas de reglas (Jensen-Shannon): ${vista.js.toFixed(2)} (0 = iguales, 1 = nada en común).`,
  ];
  if (cambio) {
    hechos.push(`El libro V3 cambió a la versión ${cambio.version} el ${hhmm(cambio.en)}${cambio.resumen ? `: ${cambio.resumen}` : ""}.`);
  }

  return {
    clave: `BOT:regla-primer-mensaje:${input.producto}`,
    familia: "BOT",
    severidad: "IMPORTANTE",
    titulo: capturada
      ? `Una regla nueva se quedó con el primer mensaje del ${input.producto}`
      : `Cambió la regla que contesta el primer mensaje del ${input.producto}`,
    que: `El primer mensaje de los leads ahora lo contesta "${corto(nueva)}" (${pct(participacionNueva)}) en vez de "${corto(vieja)}" (${pct(participacionVieja)} antes).`,
    desde,
    producto: input.producto,
    leadsAfectados: conLaNueva.length || (vista.observado[nueva ?? ""] ?? 0),
    evidencia: {
      chats: [...new Set([primero?.conversationId, vista.ejemplo[nueva ?? ""], ...dist.chats].filter((x): x is string => Boolean(x)))].slice(0, 8),
      reglas: [nueva, vieja].filter((x): x is string => Boolean(x)),
      versiones: cambio ? [cambio.version] : [],
    },
    metrica: NOMBRE_DEL_INDICADOR.regla_primer_mensaje,
    esperado: `"${corto(vieja)}" en ~${pct(participacionVieja)} de los primeros mensajes`,
    observado: `"${corto(nueva)}" en ${pct(participacionNueva)} (${vista.observado[nueva ?? ""] ?? 0} de ${nObs})`,
    hechos,
    hipotesis: cambio
      ? [`El cambio a la versión ${cambio.version} del libro movió el desempate entre reglas (mismo peso, gana la que está primero).`]
      : ["Cambió el texto con el que llegan los leads (anuncio nuevo) o una regla se editó sin dejar versión."],
    causaPosible: cambio
      ? `Cambio del libro V3 a la versión ${cambio.version} (${hhmm(cambio.en)}).`
      : "Sin cambio de libro cercano: revisar si cambió el anuncio o el texto que manda el cliente.",
    impacto: "La primera respuesta define si el cliente sigue la conversación. Ver el detector de respuesta para la cifra.",
    recomendacion: `Probar el texto del anuncio en el simulador (v3_probar_mensaje) y comparar contra la versión anterior con el Change Guardian; si "${corto(nueva, 40)}" no debe contestar el anuncio, volver a dejar primero la regla que lo hacía o crear una regla exacta del anuncio.`,
    queCambiar: "El orden o las frases de las reglas del libro V3 (cambio en producción).",
    riesgo: "Bajo si se prueba antes en el simulador; un libro mal ordenado afecta a todos los leads nuevos al instante.",
    comoMedir: `% de primeros mensajes que gana "${corto(vieja, 40)}" (volver a ~${pct(participacionVieja)}) y % de clientes que responden en 2 h.`,
    tocaProduccion: true,
    valores: { js: Number(vista.js.toFixed(3)), observados: nObs, base: nBase },
  };
}

type IndicadorDeComportamiento = "rafaga_inicial" | "precio_o_fotos_antes_de_identificar" | "pregunta_repetida_24h" | "ciudad_repetida_24h";

const TEXTOS_DE_COMPORTAMIENTO: Record<IndicadorDeComportamiento, { titulo: string; recomendacion: string; queCambiar: string }> = {
  rafaga_inicial: {
    titulo: "El bot está soltando ráfagas de mensajes al entrar",
    recomendacion: "Revisar qué regla manda el flujo de fotos/catálogo en el primer turno y limitarlo a 3 mensajes; probar en el simulador.",
    queCambiar: "La regla o el flujo que se dispara en el primer turno (libro V3 / Flujos).",
  },
  precio_o_fotos_antes_de_identificar: {
    titulo: "El bot da precio o fotos antes de saber qué necesita el cliente",
    recomendacion: "Volver a calificar primero (preguntar qué servicios va a ofrecer) y mandar fotos y precio después.",
    queCambiar: "La regla que gana el primer mensaje (libro V3).",
  },
  pregunta_repetida_24h: {
    titulo: "El bot está repitiendo la misma pregunta",
    recomendacion: "Buscar la regla o el seguimiento que repite la pregunta (ver chats de ejemplo) y cambiar su texto o su condición.",
    queCambiar: "Texto o condición de la regla / seguimiento (libro V3).",
  },
  ciudad_repetida_24h: {
    titulo: "El bot pregunta la ciudad cuando el cliente ya la dijo",
    recomendacion: "Hacer que la regla de envío gane sobre la de precio cuando el mensaje trae la ciudad, y no volver a preguntarla.",
    queCambiar: "Orden/frases de las reglas de precio y envío (libro V3).",
  },
};

export function detectarComportamiento(input: {
  fichas: FichaDelLead[];
  ahora: Date;
  producto: string;
  filtro: FiltroDeLeads;
  indicador: IndicadorDeComportamiento;
  cambios: CambioDelLibro[];
}): Hallazgo | null {
  const regla = input.indicador === "rafaga_inicial" || input.indicador === "precio_o_fotos_antes_de_identificar"
    ? UMBRALES_BOT.comportamiento
    : { minimoObservado: 20, minimoBase: 50, zMinimo: 3, puntosMinimos: 15 };
  const general = compararConBase(input.fichas, input.indicador, input.ahora, input.filtro, regla);
  let c: ComparacionConBase | null = general && general.significativo && general.direccion === "sube" ? general : null;
  // Mirada "desde el último cambio del libro" (ver detectarCambioDeReglaGanadora): pocos leads,
  // pero sin mezclar antes y después del cambio.
  const reciente = ultimoCambio(input.cambios, input.ahora);
  if (!c && reciente) {
    const tras = compararAntesYDespues(input.fichas, input.indicador, input.ahora, reciente.en, input.filtro, {
      ...regla,
      minimoObservado: UMBRALES_BOT.minimoTrasCambio,
      puntosMinimos: Math.max(regla.puntosMinimos, 30),
    });
    if (tras && tras.significativo && tras.direccion === "sube") {
      c = {
        ...tras,
        indicador: input.indicador,
        ventanaHoras: Math.round((input.ahora.getTime() - reciente.en.getTime()) / HORA),
        observadaDesde: reciente.en,
        observadaHasta: input.ahora,
        chatsObservados: tras.chatsDespues,
        mismaFranja: null,
        mismoDia: null,
      };
    }
  }
  if (!c) return null;
  const textos = TEXTOS_DE_COMPORTAMIENTO[input.indicador];
  const desde = c.observadaDesde;
  const primeros = input.fichas
    .filter((f) => c.chatsObservados.includes(f.conversationId))
    .sort((a, b) => a.entradaEn.getTime() - b.entradaEn.getTime());
  const indicador = input.indicador;
  const culpable = cambioMasExplicativo({
    fichas: input.fichas,
    ahora: input.ahora,
    cambios: input.cambios,
    filtro: input.filtro,
    malo: (f) => (disponible(f, indicador, input.ahora) ? valorDelIndicador(f, indicador) : null),
  });
  const inicio = culpable?.en ?? primeros[0]?.entradaEn ?? desde;
  const cambio = culpable ?? cambioSospechoso(input.cambios, inicio);
  const ejemploRegla = primeros.find((f) => f.reglaPrimerMensaje)?.reglaPrimerMensaje ?? null;
  return {
    clave: `BOT:${input.indicador}:${input.producto}`,
    familia: "BOT",
    // Preguntas repetidas y ciudad repetida: OBSERVACIÓN salvo un salto grande (≥ 25 pts).
    severidad:
      input.indicador === "rafaga_inicial" || input.indicador === "precio_o_fotos_antes_de_identificar" || c.puntos >= 25
        ? "IMPORTANTE"
        : "OBSERVACION",
    titulo: textos.titulo,
    que: `${NOMBRE_DEL_INDICADOR[input.indicador]}: ${pct(c.tasaObservada)} en las últimas ${c.ventanaHoras} h contra ${pct(c.tasaEsperada)} de la línea base.`,
    desde: inicio,
    producto: input.producto,
    leadsAfectados: c.observado.exitos,
    evidencia: { chats: c.chatsObservados.slice(0, 8), reglas: ejemploRegla ? [ejemploRegla] : [], versiones: cambio ? [cambio.version] : [] },
    metrica: NOMBRE_DEL_INDICADOR[input.indicador],
    esperado: `${pct(c.tasaEsperada)} (${c.esperado.exitos}/${c.esperado.total}, 14 días)`,
    observado: `${pct(c.tasaObservada)} (${c.observado.exitos}/${c.observado.total})`,
    hechos: [
      `${c.observado.exitos} de ${c.observado.total} leads recientes vs ${c.esperado.exitos} de ${c.esperado.total} en la base (z = ${c.z.toFixed(1)}, ${c.puntos > 0 ? "+" : ""}${c.puntos.toFixed(1)} pts).`,
      ...(c.mismaFranja ? [`Contra la misma franja horaria (${[...new Set(primeros.map((f) => NOMBRE_DE_FRANJA[franja(f.entradaEn)]))].join(", ")}): ${pct(c.mismaFranja.tasaEsperada)}.`] : []),
      ...(ejemploRegla ? [`Regla del primer mensaje en esos leads: "${corto(ejemploRegla)}".`] : []),
    ],
    hipotesis: cambio ? [`Coincide con el cambio del libro a la versión ${cambio.version}.`] : [],
    causaPosible: cambio ? `Cambio del libro V3 a la versión ${cambio.version}.` : "Una regla o un flujo que se dispara antes de tiempo.",
    impacto: "Muchos mensajes seguidos o el precio de entrada hacen que el cliente deje de contestar (ver detector de respuesta).",
    recomendacion: textos.recomendacion,
    queCambiar: textos.queCambiar,
    riesgo: "Bajo si se prueba antes en el simulador y con el Change Guardian.",
    comoMedir: `${NOMBRE_DEL_INDICADOR[input.indicador]} vuelve a ~${pct(c.tasaEsperada)}.`,
    tocaProduccion: true,
    valores: { z: Number(c.z.toFixed(2)), puntos: Number(c.puntos.toFixed(1)) },
  };
}

/**
 * ¿Respondieron menos los leads a los que el bot les soltó una ráfaga? (hipótesis, no prueba
 * causal: los dos grupos pueden ser distintos por otras razones).
 */
export function respuestaSegunRafaga(fichas: FichaDelLead[], ahora: Date, filtro: FiltroDeLeads, dias = 7) {
  const desde = ahora.getTime() - dias * 24 * HORA;
  const maduros = fichas.filter(
    (f) => filtro(f) && f.entradaEn.getTime() >= desde && ahora.getTime() - f.entradaEn.getTime() >= 2 * HORA,
  );
  const con = maduros.filter((f) => f.botPrimeros5Min > 3);
  const sin = maduros.filter((f) => f.botPrimeros5Min <= 3);
  const respondieron = (lista: FichaDelLead[]) => ({ exitos: lista.filter((f) => f.minutosHastaRespuesta !== null).length, total: lista.length });
  return comparar(respondieron(con), respondieron(sin), { minimoObservado: 15, minimoBase: 15, zMinimo: 2.5, puntosMinimos: 10 });
}

export { ESPERANDO_AUTORIZACION };
