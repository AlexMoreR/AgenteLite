/**
 * COACH EN LINEA DE TIEMPO (Alex, 17-10-2026): la primera pagina del Coach muestra como va
 * mejorando cada asesora dia a dia, y cada una tiene su seccion con sus dias.
 *
 * Todo sale de los informes que YA guardo el Coach cada noche (CoachInforme / CoachAsesora). No se
 * recalcula nada con IA ni se lee ningun chat:
 *  - "Puntaje del dia" (0 a 10, mas es mejor): CoachAsesora.puntaje (rubrica sin "Resultado").
 *  - "Clientes sin respuesta" (menos es mejor): resumen.metricas.sinRespuesta.
 *  - "Demoras de mas de 15 min" (menos es mejor): resumen.metricas.demoras (POLITICA_COACH.demoraMaximaMin).
 *  - "Meta cumplida": la metrica de la habilidad del dia D medida en el informe del dia D+1, con la
 *    misma regla de "Acciones de hoy" (`medirMetrica` / `cumpleMeta`).
 *
 * Un dia sin informe (o sin dato) es un HUECO (null), nunca un cero.
 *
 * Puro: no toca la base ni la red. Solo imports relativos: lo prueba scripts/check-coach-linea.mjs
 * (npm run test:coach-linea).
 */

import { clasificarTexto, cumpleMeta, diaCorto, medirMetrica, moverDia, textoDeMeta, type ParteParaTarjeta } from "./acciones-de-hoy";
import { NOMBRE_DEL_TIPO } from "../habilidad";
import type { ProblemaDelEquipo } from "../tipos";

/* ------------------------------------------------------------------------------------------------
   Metricas
------------------------------------------------------------------------------------------------ */

export type ClaveDeMetrica = "puntaje" | "sinRespuesta" | "demoras";

export type MetricaDeLinea = {
  clave: ClaveDeMetrica;
  nombre: string;
  /** Para la pestaña y el badge. */
  corto: string;
  /** Una linea debajo del grafico. */
  ayuda: string;
  sentido: "subir" | "bajar";
};

export const METRICAS_DE_LINEA: MetricaDeLinea[] = [
  {
    clave: "puntaje",
    nombre: "Puntaje del día",
    corto: "Puntaje",
    ayuda: "Nota del Coach de 0 a 10. Más es mejor.",
    sentido: "subir",
  },
  {
    clave: "sinRespuesta",
    nombre: "Clientes sin respuesta al cierre",
    corto: "Sin respuesta",
    ayuda: "Clientes que quedaron esperando respuesta al cierre. Menos es mejor.",
    sentido: "bajar",
  },
  {
    clave: "demoras",
    nombre: "Demoras de más de 15 min",
    corto: "Demoras",
    ayuda: "Veces que un cliente esperó más de 15 min en horario. Menos es mejor.",
    sentido: "bajar",
  },
];

export const METRICA_POR_DEFECTO: ClaveDeMetrica = "puntaje";

export function metricaDe(valor: unknown): MetricaDeLinea {
  return METRICAS_DE_LINEA.find((m) => m.clave === valor) ?? METRICAS_DE_LINEA[0];
}

/* ------------------------------------------------------------------------------------------------
   Un dia de una asesora
------------------------------------------------------------------------------------------------ */

/** Lo minimo de un informe guardado. Las habilidades de informes viejos ya vienen completas. */
export type InformeParaLinea = {
  dia: string;
  problemasDelEquipo: ProblemaDelEquipo[];
  asesoras: ParteParaTarjeta[];
};

export type DiaDeAsesora = {
  dia: string;
  userId: string;
  nombre: string;
  chats: number;
  puntaje: number | null;
  sinRespuesta: number | null;
  demoras: number | null;
  habilidad: {
    clave: string;
    nombre: string;
    /** Que mide la meta ("clientes sin respuesta"). */
    metrica: string;
    /** La cifra de ESE dia. */
    hoy: number;
    meta: number;
    textoMeta: string;
    sentido: "subir" | "bajar";
  } | null;
  /** La meta de la habilidad medida en el informe del dia siguiente. null = todavia no se sabe. */
  meta: { dia: string; valor: number; cumple: boolean } | null;
  /** Tipos de error de ESE dia que son de la asesora (lo del sistema no cuenta). */
  errores: string[];
};

const numero = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Pasa los informes guardados a una fila por asesora y dia. Para la meta usa el informe del dia
 * siguiente si esta en la lista (por eso quien llama trae un dia mas al final del rango).
 */
export function diasDeLosInformes(informes: InformeParaLinea[]): DiaDeAsesora[] {
  const porDia = new Map(informes.map((i) => [i.dia, i]));
  const salida: DiaDeAsesora[] = [];
  for (const informe of [...informes].sort((a, b) => a.dia.localeCompare(b.dia))) {
    const siguiente = porDia.get(moverDia(informe.dia, 1)) ?? null;
    const tiposDelEquipo = new Set<string>((siguiente?.problemasDelEquipo ?? []).map((p) => p.tipo));
    for (const parte of informe.asesoras) {
      const h = parte.resumen?.habilidad ?? null;
      const m = parte.resumen?.metricas ?? null;
      let meta: DiaDeAsesora["meta"] = null;
      if (h && siguiente) {
        const valor = medirMetrica(
          h,
          siguiente.asesoras.find((p) => p.userId === parte.userId),
          tiposDelEquipo,
        );
        if (valor !== null) meta = { dia: siguiente.dia, valor, cumple: cumpleMeta(valor, h.metrica) };
      }
      salida.push({
        dia: informe.dia,
        userId: parte.userId,
        nombre: parte.nombre,
        chats: parte.chats,
        puntaje: numero(parte.puntaje),
        sinRespuesta: m ? numero(m.sinRespuesta) : null,
        demoras: m ? numero(m.demoras) : null,
        habilidad: h
          ? {
              clave: h.clave,
              nombre: h.nombre,
              metrica: h.metrica.nombre,
              hoy: h.metrica.hoy,
              meta: h.metrica.meta,
              textoMeta: textoDeMeta(h.metrica),
              sentido: h.metrica.sentido,
            }
          : null,
        meta,
        errores: parte.errores.filter((e) => !clasificarTexto(e.detalle ?? "").operativo).map((e) => e.tipo),
      });
    }
  }
  return salida;
}

export function valorDe(d: DiaDeAsesora | null | undefined, metrica: ClaveDeMetrica): number | null {
  if (!d) return null;
  return d[metrica];
}

/* ------------------------------------------------------------------------------------------------
   Rangos
------------------------------------------------------------------------------------------------ */

export type TipoDeRango = "ayer" | "7d" | "semana" | "mes" | "custom";

export type Rango = { tipo: TipoDeRango; desde: string; hasta: string };

/** Lo mas largo que se puede pedir (para que la consulta siga acotada). */
export const DIAS_MAXIMOS = 92;

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const esDia = (v: unknown): v is string => typeof v === "string" && DIA.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000);
}

/** Lunes de la semana de `dia` (semana de lunes a domingo). */
export function lunesDe(dia: string): string {
  const semana = new Date(`${dia}T12:00:00Z`).getUTCDay(); // 0 = domingo
  return moverDia(dia, -((semana + 6) % 7));
}

/**
 * El rango que se mira. Los informes salen en la noche, asi que "Semana" y "Mes" terminan AYER (el
 * ultimo dia cerrado): un lunes, "Semana" muestra la semana que acaba de terminar.
 */
export function resolverRango(
  pedido: { rango?: unknown; desde?: unknown; hasta?: unknown },
  hoy: string,
  defecto: TipoDeRango,
): Rango {
  const ayer = moverDia(hoy, -1);
  const tipo = (["ayer", "7d", "semana", "mes", "custom"] as const).find((t) => t === pedido.rango) ?? defecto;
  if (tipo === "ayer") return { tipo, desde: ayer, hasta: ayer };
  if (tipo === "7d") return { tipo, desde: moverDia(hoy, -7), hasta: ayer };
  if (tipo === "semana") return { tipo, desde: lunesDe(ayer), hasta: ayer };
  if (tipo === "mes") return { tipo, desde: `${ayer.slice(0, 8)}01`, hasta: ayer };
  // Personalizado: fechas validas, en orden, sin futuro y de maximo DIAS_MAXIMOS dias.
  if (!esDia(pedido.desde)) {
    const otro = defecto === "custom" ? "7d" : defecto;
    return resolverRango({ rango: otro }, hoy, otro);
  }
  let desde = pedido.desde;
  let hasta = esDia(pedido.hasta) ? pedido.hasta : desde;
  if (desde > hasta) [desde, hasta] = [hasta, desde];
  if (hasta > hoy) hasta = hoy;
  if (desde > hasta) desde = hasta;
  if (diasEntre(desde, hasta) >= DIAS_MAXIMOS) desde = moverDia(hasta, -(DIAS_MAXIMOS - 1));
  return { tipo, desde, hasta };
}

export const NOMBRE_DEL_RANGO: Record<TipoDeRango, string> = {
  ayer: "Ayer",
  "7d": "Últimos 7 días",
  semana: "Semana",
  mes: "Mes",
  custom: "Personalizado",
};

/** "10-oct – 16-oct", o "16-oct" si es un dia. */
export function textoDelRango(r: Pick<Rango, "desde" | "hasta">): string {
  return r.desde === r.hasta ? diaCorto(r.desde) : `${diaCorto(r.desde)} – ${diaCorto(r.hasta)}`;
}

/** Todos los dias del rango, en orden (maximo DIAS_MAXIMOS). */
export function diasDelRango(desde: string, hasta: string): string[] {
  const salida: string[] = [];
  for (let d = desde; d <= hasta && salida.length < DIAS_MAXIMOS; d = moverDia(d, 1)) salida.push(d);
  return salida;
}

/* ------------------------------------------------------------------------------------------------
   Serie del grafico
------------------------------------------------------------------------------------------------ */

export type AsesoraDeLaSerie = { userId: string; nombre: string; clave: string };

export type FilaDeSerie = { dia: string; etiqueta: string; [clave: string]: string | number | null };

/** Las asesoras que salen, por nombre. La clave (a0, a1, …) es la de recharts y del color. */
export function asesorasDe(dias: DiaDeAsesora[]): AsesoraDeLaSerie[] {
  const nombres = new Map<string, string>();
  for (const d of dias) nombres.set(d.userId, d.nombre);
  return [...nombres.entries()]
    .sort((a, b) => a[1].localeCompare(b[1], "es") || a[0].localeCompare(b[0]))
    .map(([userId, nombre], i) => ({ userId, nombre, clave: `a${i}` }));
}

/** Una fila por dia del rango; una columna por asesora. Sin dato = null (hueco en la linea). */
export function armarSerie(
  dias: DiaDeAsesora[],
  rango: Pick<Rango, "desde" | "hasta">,
  metrica: ClaveDeMetrica,
  asesoras: AsesoraDeLaSerie[] = asesorasDe(dias),
): FilaDeSerie[] {
  const indice = new Map(dias.map((d) => [`${d.dia}|${d.userId}`, d]));
  return diasDelRango(rango.desde, rango.hasta).map((dia) => {
    const fila: FilaDeSerie = { dia, etiqueta: diaCorto(dia) };
    for (const a of asesoras) fila[a.clave] = valorDe(indice.get(`${dia}|${a.userId}`), metrica);
    return fila;
  });
}

/* ------------------------------------------------------------------------------------------------
   Tendencia y tarjetas
------------------------------------------------------------------------------------------------ */

export type Tendencia = "mejoro" | "empeoro" | "igual";

export const NOMBRE_DE_TENDENCIA: Record<Tendencia, string> = { mejoro: "Mejoró", empeoro: "Empeoró", igual: "Igual" };

export function tendencia(actual: number | null, anterior: number | null, sentido: "subir" | "bajar"): Tendencia | null {
  if (actual === null || anterior === null) return null;
  if (actual === anterior) return "igual";
  const subio = actual > anterior;
  return subio === (sentido === "subir") ? "mejoro" : "empeoro";
}

export type ResumenParaTarjeta = {
  userId: string;
  nombre: string;
  /** Dia del ultimo informe de ella (normalmente ayer). null = no hay informe reciente. */
  dia: string | null;
  habilidad: DiaDeAsesora["habilidad"];
  /** Comparacion con su informe anterior, en la metrica elegida. */
  tendencia: { valor: Tendencia; actual: number; anterior: number; diaAnterior: string } | null;
};

/**
 * Una tarjeta por asesora para la primera pagina: lo del ultimo informe hasta `hasta` (ayer) y la
 * tendencia contra su informe anterior. `dias` debe traer al menos esos dos informes.
 */
export function resumenParaTarjetas(dias: DiaDeAsesora[], hasta: string, metrica: MetricaDeLinea): ResumenParaTarjeta[] {
  return asesorasDe(dias).map((a) => {
    const suyos = dias.filter((d) => d.userId === a.userId && d.dia <= hasta).sort((x, y) => y.dia.localeCompare(x.dia));
    const ultimo = suyos[0] ?? null;
    const anterior = suyos[1] ?? null;
    const actual = valorDe(ultimo, metrica.clave);
    const previo = valorDe(anterior, metrica.clave);
    const t = tendencia(actual, previo, metrica.sentido);
    return {
      userId: a.userId,
      nombre: a.nombre,
      dia: ultimo?.dia ?? null,
      habilidad: ultimo?.habilidad ?? null,
      tendencia: t && anterior && actual !== null && previo !== null ? { valor: t, actual, anterior: previo, diaAnterior: anterior.dia } : null,
    };
  });
}

/* ------------------------------------------------------------------------------------------------
   Resumen de un rango (seccion de una asesora)
------------------------------------------------------------------------------------------------ */

export type ResumenDelRango = {
  diasConInforme: number;
  metasMedidas: number;
  metasCumplidas: number;
  /** Los errores que mas se repiten (en cuantos dias salio cada uno). Maximo 3. */
  erroresRepetidos: Array<{ tipo: string; nombre: string; dias: number; veces: number }>;
  /** Del mas nuevo al mas viejo. */
  dias: DiaDeAsesora[];
};

export function resumenDelRango(dias: DiaDeAsesora[], userId: string, rango: Pick<Rango, "desde" | "hasta">): ResumenDelRango {
  const suyos = dias
    .filter((d) => d.userId === userId && d.dia >= rango.desde && d.dia <= rango.hasta)
    .sort((a, b) => b.dia.localeCompare(a.dia));
  const conteo = new Map<string, { dias: number; veces: number }>();
  for (const d of suyos) {
    for (const tipo of new Set(d.errores)) {
      const c = conteo.get(tipo) ?? { dias: 0, veces: 0 };
      c.dias += 1;
      conteo.set(tipo, c);
    }
    for (const tipo of d.errores) conteo.get(tipo)!.veces += 1;
  }
  const erroresRepetidos = [...conteo.entries()]
    .map(([tipo, c]) => ({ tipo, nombre: NOMBRE_DEL_TIPO[tipo] ?? tipo, ...c }))
    .sort((a, b) => b.dias - a.dias || b.veces - a.veces || a.nombre.localeCompare(b.nombre, "es"))
    .slice(0, 3);
  const medidas = suyos.filter((d) => d.meta);
  return {
    diasConInforme: suyos.length,
    metasMedidas: medidas.length,
    metasCumplidas: medidas.filter((d) => d.meta?.cumple).length,
    erroresRepetidos,
    dias: suyos,
  };
}
