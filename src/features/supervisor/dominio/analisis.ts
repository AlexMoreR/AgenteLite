/**
 * EL ANÁLISIS DEL SUPERVISOR (código puro): junta los detectores.
 *
 * - `analizarHora`: el análisis agregado de cada hora (bot + embudo + asesoras + vigilancia
 *   post-cambio), por producto, contra la línea base.
 * - `hallazgoDelCambioDelLibro`: lo que se registra apenas cambia la versión del libro (diff +
 *   Change Guardian). Si el Guardian FALLA es CRÍTICO desde el minuto cero.
 *
 * El mismo código corre en vivo (servicios/vueltas.ts) y en la simulación histórica
 * (scripts/supervisor-simulacion.mjs): lo que se midió es lo que hace.
 */

import { pct } from "./estadistica";
import { detectarCambioDeReglaGanadora, detectarComportamiento } from "./detectores-bot";
import { INDICADORES_DEL_EMBUDO, detectarCusumRespuesta, detectarIndicador, detectarPorAsesora, type SupuestosComerciales } from "./detectores-embudo";
import { compararAntesYDespues, distribucionDeReglas, type FiltroDeLeads } from "./linea-base";
import { NOMBRE_DEL_INDICADOR, type FichaDelLead } from "./lead";
import type { DiffDelLibro } from "./libro-diff";
import type { InformeDelGuardian } from "./guardian";
import type { CambioDelLibro, Hallazgo, Severidad } from "./tipos";
import type { Incidente } from "./alertas";

const HORA = 3_600_000;

export type ProductoVigilado = { clave: string; nombre?: string; filtro?: FiltroDeLeads };

export function analizarHora(input: {
  fichas: FichaDelLead[];
  ahora: Date;
  cambios: CambioDelLibro[];
  productos: ProductoVigilado[];
  nombresDeAsesoras?: Record<string, string>;
  supuestos?: SupuestosComerciales;
  /** Leads mínimos tras un cambio para la vigilancia post-cambio. */
  minimoPostCambio?: number;
}): Hallazgo[] {
  const salida: Hallazgo[] = [];
  for (const producto of input.productos) {
    const filtro: FiltroDeLeads = producto.filtro ?? ((f) => f.producto === producto.clave);
    const base = { fichas: input.fichas, ahora: input.ahora, producto: producto.clave, filtro, cambios: input.cambios };

    const regla = detectarCambioDeReglaGanadora(base);
    if (regla) salida.push(regla);
    for (const indicador of ["rafaga_inicial", "precio_o_fotos_antes_de_identificar", "pregunta_repetida_24h", "ciudad_repetida_24h"] as const) {
      const h = detectarComportamiento({ ...base, indicador });
      if (h) salida.push(h);
    }
    for (const indicador of INDICADORES_DEL_EMBUDO) {
      const h = detectarIndicador({ ...base, indicador, supuestos: input.supuestos });
      if (h) salida.push(h);
    }
    if (!salida.some((h) => h.clave === `EMBUDO:respondio_2h:${producto.clave}`)) {
      const cusum = detectarCusumRespuesta(base);
      if (cusum) salida.push(cusum);
    }
    salida.push(...detectarPorAsesora({ ...base, nombres: input.nombresDeAsesoras }));

    for (const cambio of input.cambios.filter((c) => input.ahora.getTime() - c.en.getTime() <= 7 * 24 * HORA && c.en <= input.ahora)) {
      const h = vigilanciaPostCambio({
        fichas: input.fichas,
        ahora: input.ahora,
        cambio,
        cambios: input.cambios,
        producto: producto.clave,
        filtro,
        minimo: input.minimoPostCambio,
      });
      if (h) salida.push(h);
    }
  }
  return salida;
}

/**
 * VIGILANCIA POST-CAMBIO: las primeras N conversaciones después de un cambio del libro contra los
 * 14 días anteriores. Dice si empeoró (IMPORTANTE), si mejoró o si no hubo efecto (OBSERVACIÓN).
 */
export function vigilanciaPostCambio(input: {
  fichas: FichaDelLead[];
  ahora: Date;
  cambio: CambioDelLibro;
  /** Todos los cambios: el "antes" empieza en el cambio anterior y el "después" termina en el siguiente. */
  cambios?: CambioDelLibro[];
  producto: string;
  filtro: FiltroDeLeads;
  minimo?: number;
}): Hallazgo | null {
  const minimo = input.minimo ?? 20;
  const regla = { minimoObservado: minimo, minimoBase: 20, zMinimo: 3, puntosMinimos: 10 };
  const otros = (input.cambios ?? []).filter((c) => c.version !== input.cambio.version);
  const previo = otros.filter((c) => c.en < input.cambio.en).sort((a, b) => b.en.getTime() - a.en.getTime())[0] ?? null;
  const siguiente = otros.filter((c) => c.en > input.cambio.en).sort((a, b) => a.en.getTime() - b.en.getTime())[0] ?? null;
  let limites = { antesDesde: previo?.en ?? null, despuesHasta: siguiente?.en ?? null };
  let respuesta = compararAntesYDespues(input.fichas, "respondio_2h", input.ahora, input.cambio.en, input.filtro, regla, limites);
  /*
    Si el cambio anterior fue hace muy poco (no hay 50 leads entre los dos), el "antes" se estira
    de a un cambio hacia atrás, NO directo a 14 días: si no, un problema que viene de un cambio
    anterior (todavía abierto) se le atribuiría al cambio nuevo, que no lo causó. Lo vio la
    simulación del 7-oct con la v188.
  */
  let previoUsado: CambioDelLibro | null = previo;
  const anteriores = otros.filter((c) => c.en < input.cambio.en).sort((a, b) => b.en.getTime() - a.en.getTime());
  for (let i = 1; respuesta && respuesta.esperado.total < 50 && i <= anteriores.length; i += 1) {
    previoUsado = anteriores[i] ?? null;
    limites = { antesDesde: previoUsado?.en ?? null, despuesHasta: limites.despuesHasta };
    respuesta = compararAntesYDespues(input.fichas, "respondio_2h", input.ahora, input.cambio.en, input.filtro, regla, limites);
  }
  if (!respuesta || respuesta.observado.total < minimo || respuesta.esperado.total < 20) return null;
  const rafaga = compararAntesYDespues(input.fichas, "rafaga_inicial", input.ahora, input.cambio.en, input.filtro, { ...regla, puntosMinimos: 20 }, limites);
  const reglas = distribucionDeReglas(input.fichas, input.ahora, input.filtro, 5, input.cambio.en);

  const empeoro = (respuesta.significativo && respuesta.direccion === "baja") || (rafaga?.significativo && rafaga.direccion === "sube");
  const mejoro = (respuesta.significativo && respuesta.direccion === "sube") || (rafaga?.significativo && rafaga.direccion === "baja");
  const severidad: Severidad = empeoro ? "IMPORTANTE" : "OBSERVACION";
  const veredicto = empeoro ? "EMPEORÓ" : mejoro ? "MEJORÓ" : "sin cambio claro";
  const hechos = [
    `Respuesta en 2 h: ${pct(respuesta.tasaObservada)} (${respuesta.observado.exitos}/${respuesta.observado.total}) con la versión ${input.cambio.version} vs ${pct(respuesta.tasaEsperada)} (${respuesta.esperado.exitos}/${respuesta.esperado.total}) ${previoUsado ? `desde la versión ${previoUsado.version} hasta este cambio` : "en los 14 días anteriores"} (z = ${respuesta.z.toFixed(1)}).`,
  ];
  if (rafaga) hechos.push(`Ráfaga inicial (>3 mensajes en 5 min): ${pct(rafaga.tasaObservada)} vs ${pct(rafaga.tasaEsperada)} antes.`);
  if (reglas?.modaObservada.clave) {
    hechos.push(
      `Regla del primer mensaje desde el cambio: "${reglas.modaObservada.clave.slice(0, 70)}" (${pct(reglas.modaObservada.participacion)}); antes: "${(reglas.modaBase.clave ?? "—").slice(0, 70)}" (${pct(reglas.modaBase.participacion)}).`,
    );
  }
  return {
    clave: `CAMBIO:post-cambio:v${input.cambio.version}:${input.producto}`,
    familia: "CAMBIO",
    severidad,
    titulo: `Vigilancia post-cambio del libro v${input.cambio.version}: ${veredicto}`,
    que: `Primeros ${respuesta.observado.total} leads maduros después del cambio del libro a la versión ${input.cambio.version}: ${veredicto.toLowerCase()} frente a ${previoUsado ? `lo atendido desde la versión ${previoUsado.version}` : "los 14 días anteriores"}.`,
    desde: input.cambio.en,
    producto: input.producto,
    leadsAfectados: respuesta.observado.total,
    evidencia: { chats: respuesta.chatsDespues.slice(0, 5), reglas: reglas?.modaObservada.clave ? [reglas.modaObservada.clave] : [], versiones: [input.cambio.version] },
    metrica: NOMBRE_DEL_INDICADOR.respondio_2h,
    esperado: pct(respuesta.tasaEsperada),
    observado: pct(respuesta.tasaObservada),
    hechos,
    hipotesis: empeoro ? [`El cambio "${input.cambio.resumen ?? ""}" afectó el primer turno.`] : [],
    causaPosible: `Cambio del libro (${input.cambio.autor ?? "?"}): ${input.cambio.resumen ?? "sin resumen"}.`,
    impacto: empeoro ? "Ver el incidente del embudo para la estimación." : "—",
    recomendacion: empeoro
      ? `Comparar con el Change Guardian la versión ${input.cambio.anterior ?? input.cambio.version - 1} contra la ${input.cambio.version} y, si se confirma, volver a la versión anterior o corregir la regla.`
      : "Seguir midiendo hasta tener 2 días completos.",
    queCambiar: empeoro ? "Libro V3 (volver a la versión anterior o corregir la regla)." : "Nada.",
    riesgo: empeoro ? "Bajo: volver a una versión se hace con un clic y deja la actual guardada." : "—",
    comoMedir: "Respuesta en 2 h y ráfaga inicial vuelven a la línea base.",
    tocaProduccion: Boolean(empeoro),
    valores: { veredicto },
  };
}

/**
 * Junta los cambios del libro que pasaron casi juntos (5 min): el chequeo de cada 5 minutos los ve
 * como uno solo (por ejemplo 178 → 181 el 7-oct, tres versiones en 30 segundos).
 */
export function agruparCambios(cambios: CambioDelLibro[], ventanaMin = 5): CambioDelLibro[] {
  const orden = [...cambios].sort((a, b) => a.en.getTime() - b.en.getTime());
  const salida: CambioDelLibro[] = [];
  for (const c of orden) {
    const ultimo = salida.at(-1);
    if (ultimo && c.en.getTime() - ultimo.en.getTime() <= ventanaMin * 60_000) {
      salida[salida.length - 1] = { ...c, anterior: ultimo.anterior, resumen: [ultimo.resumen, c.resumen].filter(Boolean).join(" · ") };
    } else {
      salida.push({ ...c });
    }
  }
  return salida;
}

/** Lo que se registra al ver una versión nueva del libro: diff + Guardian. */
export function hallazgoDelCambioDelLibro(input: {
  cambio: CambioDelLibro;
  diff: DiffDelLibro;
  informe: InformeDelGuardian;
  producto: string | null;
}): Hallazgo {
  const { cambio, diff, informe } = input;
  const falla = informe.veredicto === "FALLA";
  const hechos = [
    `Versión ${diff.versionAnterior} → ${diff.versionNueva} (${cambio.autor ?? "autor desconocido"}): ${diff.resumen}.`,
    `Change Guardian: ${informe.resumen}.`,
    ...informe.regresiones.map((r) => `REGRESIÓN${r.critico ? " CRÍTICA" : ""} en "${r.nombre}": antes ganaba "${(r.antes ?? "—").slice(0, 60)}", ahora "${(r.ahora ?? "—").slice(0, 60)}" → ${r.fallas.join("; ")}.`),
  ];
  if (diff.recreadas.length) hechos.push(`Reglas recreadas (pierden su lugar en el desempate): ${diff.recreadas.map((r) => `"${r.nombre.slice(0, 50)}" ${r.desde} → ${r.hasta}`).join(", ")}.`);
  const avisos = informe.yaFallaban.map((r) => `"${r.nombre}"`);
  return {
    clave: `CAMBIO:libro:v${cambio.version}`,
    familia: "CAMBIO",
    severidad: falla ? "CRITICO" : "OBSERVACION",
    titulo: falla
      ? `El cambio del libro V3 a la versión ${cambio.version} rompe ${informe.regresiones.length} escenario(s) dorado(s)`
      : `Cambio del libro V3 a la versión ${cambio.version}: ${informe.veredicto === "PASA" ? "pasa el Guardian" : "pasa el Guardian con avisos"}`,
    que: falla
      ? `Con la versión ${cambio.version}, ${informe.regresiones.map((r) => `"${r.nombre}"`).join(", ")} deja(n) de cumplir lo esperado (ver hechos).`
      : `Se registró el cambio y se vigilarán las primeras conversaciones.${avisos.length ? ` Problemas que ya existían: ${avisos.join(", ")}.` : ""}`,
    desde: cambio.en,
    producto: input.producto,
    leadsAfectados: 0,
    evidencia: { chats: [], reglas: informe.regresiones.map((r) => r.ahora ?? "").filter(Boolean), versiones: [cambio.version] },
    metrica: "Escenarios dorados del Change Guardian",
    esperado: `${informe.resultados.length} escenarios sin regresiones`,
    observado: informe.resumen,
    hechos,
    hipotesis: falla ? ["Los leads que lleguen con estos mensajes recibirán la respuesta equivocada desde ya."] : [],
    causaPosible: cambio.resumen ?? "Cambio del libro.",
    impacto: falla ? "Afecta a cada lead nuevo que escriba como en los escenarios que fallan, desde el minuto del cambio." : "—",
    recomendacion: falla
      ? `Volver a la versión ${diff.versionAnterior} (v3_volver_a_version) o corregir el orden/frases de la regla culpable, y volver a correr el Guardian hasta que PASE.`
      : "Nada urgente. La vigilancia post-cambio compara las primeras conversaciones.",
    queCambiar: falla ? "Libro V3 (producción)." : "Nada.",
    riesgo: falla ? "Bajo: volver a una versión deja la actual guardada en el historial." : "—",
    comoMedir: "Guardian en PASA y, con datos, regla del primer mensaje y respuesta en 2 h iguales a la base.",
    tocaProduccion: falla,
    valores: { veredicto: informe.veredicto, regresiones: informe.regresiones.map((r) => r.id).join("|") || null },
  };
}

/**
 * Cuando una versión nueva ARREGLA las regresiones de un incidente abierto (el Guardian vuelve a
 * pasar esos escenarios), el hallazgo del cambio culpable se reemplaza por una OBSERVACIÓN "arreglado
 * en el libro". El incidente sigue abierto hasta que los DATOS vuelvan a la línea base: arreglar el
 * libro no es lo mismo que comprobar que los clientes volvieron a responder.
 */
export function hallazgosDeArreglo(input: {
  abiertos: Incidente[];
  cambio: CambioDelLibro;
  informe: InformeDelGuardian;
}): Hallazgo[] {
  const salida: Hallazgo[] = [];
  const pasanAhora = new Set(input.informe.resultados.filter((r) => r.pasa).map((r) => r.id));
  for (const inc of input.abiertos) {
    if (inc.estado !== "ABIERTA") continue;
    for (const h of inc.hallazgos) {
      const ids = typeof h.valores?.regresiones === "string" ? h.valores.regresiones.split("|").filter(Boolean) : [];
      if (!h.clave.startsWith("CAMBIO:libro:v") || h.severidad === "OBSERVACION" || ids.length === 0) continue;
      if (!ids.every((id) => pasanAhora.has(id))) continue;
      salida.push({
        ...h,
        severidad: "OBSERVACION",
        titulo: `Arreglado en el libro por la versión ${input.cambio.version} (falta confirmarlo con datos)`,
        que: `Con la versión ${input.cambio.version} el Change Guardian vuelve a pasar ${ids.length} escenario(s) que rompió el cambio anterior. El incidente se cierra solo cuando la respuesta y la regla del primer mensaje vuelvan a la línea base.`,
        observado: `Con la versión ${input.cambio.version}: ${input.informe.resumen}`,
        hechos: [`Versión ${input.cambio.version} (${input.cambio.en.toISOString()}): ${input.informe.resumen}.`, ...h.hechos],
        hipotesis: [],
        recomendacion: "Nada en el libro. Revisar la vigilancia post-cambio con al menos 2 días de datos.",
        queCambiar: "Nada.",
        tocaProduccion: false,
        evidencia: { ...h.evidencia, versiones: [...h.evidencia.versiones, input.cambio.version] },
        valores: { ...h.valores, arregladoPor: input.cambio.version },
      });
    }
  }
  return salida;
}
