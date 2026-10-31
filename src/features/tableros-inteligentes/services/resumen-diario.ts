import { prisma } from "@/lib/prisma";
import { QUIEN_AUTOMATICO, aprobacionAutomaticaPrendida } from "./aprobacion-automatica";
import { resumenCorto, tituloCorto } from "./resumen-corto";
import { avisosPrendidos, enSilencioDeAvisos, enviarAlDueno } from "./avisos-al-dueno";
import { leerCuposDelDia, type CuposDelDia } from "./coordinador-en-vivo";
import { pendientesDelDueno, todoElNegocio } from "./tableros";

/*
  RESUMEN DIARIO del Tablero IA (22-oct-2026; formato corto el 26-oct-2026). Es el texto corto de 2 líneas que se
  ve en la caja "Resumen de hoy" y en la vista "Hoy" del tablero:
    Hoy: 4 listas ✅, 1 con problema ⚠️, 2 esperando tu sí 👆
    Ver: <link al tablero filtrado en lo de hoy>
  Si una cifra es 0, esa parte no sale. Sin commits, ramas, ids ni títulos largos.

  30-oct-2026 (Sistemas pasa a Emanuel; Alexander solo recibe esto): el resumen vuelve a salir por WhatsApp, UNA vez al
  día (entre las 6 y las 9 p. m. de Bogotá, por la línea Admin, con el silencio de la noche y el interruptor de los
  avisos), de MÁXIMO 4 líneas (6 desde el 31-oct, ver abajo): qué se arregló, qué falló y qué está pendiente. Sin links ni listas para revisar.
  Lo manda enviarResumenDiarioAlDueno desde el reloj (api/cron/follows). Esto CAMBIA lo del 26-oct ("ya no se manda").

  31-oct-2026 (cupos por sistema, parte 3): el resumen pasa de MÁXIMO 4 a MÁXIMO 6 líneas (lo pide la tarjeta: cambia la
  regla del 30-oct). Las 2 nuevas salen solo cuando hay datos: "🔁 Corriendo a la vez: X (máx.) / en fila: Y" (los máximos
  del día que guarda el latido, coordinador-en-vivo.ts) y la línea para el dueño "📈 Ahora corren hasta X tareas a la vez;
  antes se terminaban N por día (promedio de los 7 días antes del 31-oct) y hoy M". N es el promedio de las listas del 24 al
  30-oct, calculado una vez y guardado en AppSetting. Un día sin movimiento sigue sin mandar nada.

  26-oct-2026 (decisión del dueño: "WhatsApp solo cuando sea súper importante, lo demás lo miro en el tablero"):
  YA NO SE MANDA POR WHATSAPP. Los únicos avisos al dueño son los de avisos-al-dueno.ts (Sistemas detenido o
  que lo necesita). Todo sale del historial de las tarjetas (HistorialTarjeta) y de la lista "Te toca a ti",
  sin tablas nuevas.
*/

const MS_HORA = 3_600_000;
const BOGOTA_MS = 5 * MS_HORA;
const MAX_POR_GRUPO = 30;

/* ───────────────────────────────────────────────────────────────────── el día de Bogotá ── */

/** El día (AAAA-MM-DD) en Bogotá, que no tiene horario de verano (UTC-5 todo el año). */
export function diaDeBogota(ahora: Date): string {
  return new Date(ahora.getTime() - BOGOTA_MS).toISOString().slice(0, 10);
}

export function horaDeBogota(ahora: Date): number {
  return new Date(ahora.getTime() - BOGOTA_MS).getUTCHours();
}

/** Desde y hasta (sin incluirlo) de un día de Bogotá, en UTC. */
export function rangoDelDia(dia: string): { desde: Date; hasta: Date } {
  const desde = new Date(Date.parse(`${dia}T00:00:00Z`) + BOGOTA_MS);
  return { desde, hasta: new Date(desde.getTime() + 24 * MS_HORA) };
}

/* ───────────────────────────────────────────────────────────────────── armar el resumen ── */

/** Una fila del historial con el título de su tarjeta (lo único que el resumen necesita). */
export type FilaDelHistorial = {
  tarjetaId: string;
  titulo: string;
  accion: string;
  origen: string;
  quien: string;
  despues: unknown;
  creadoEn: Date;
  /** (Opcional) El resultado de la tarjeta hoy: su `error.motivo` sirve si la fila no trae el motivo. */
  resultado?: unknown;
  /** (Opcional) La última causa anotada en los intentos de la tarjeta (IntentoTarjeta). */
  ultimaCausa?: string | null;
};

export type ResumenDelDia = {
  dia: string;
  aprobadas: { tarjetaId: string; titulo: string; momento: string; motivo: string | null; cuando: string }[];
  subidas: { tarjetaId: string; titulo: string; commit: string | null; linkCommit: string | null; cuando: string; tresLineas?: TresLineasDeHoy }[];
  fallas: { tarjetaId: string; titulo: string; motivo: string; cuando: string }[];
  /** Las que el Coordinador cerró porque ya estaban en main (27-oct-2026): salen aparte, con su commit, y no cuentan como construidas ese día. */
  yaHechas: { tarjetaId: string; titulo: string; commit: string | null; cuando: string }[];
};

/** Las 3 líneas con que el agente cierra una tarea subida (26-oct-2026); cada una puede faltar. */
export type TresLineasDeHoy = { hizo?: string; ahora?: string; revisar?: string };

/** Las 3 líneas guardadas en la subida, o undefined si no hay ninguna (entonces el resumen se ve como antes). */
export function tresLineasDeLaSubida(subida: unknown): TresLineasDeHoy | undefined {
  const datos = comoObjeto(comoObjeto(subida).resumenTres);
  const hizo = texto(datos.hizo);
  const ahora = texto(datos.ahora);
  const revisar = texto(datos.revisar);
  if (!hizo && !ahora && !revisar) return undefined;
  return { ...(hizo ? { hizo } : {}), ...(ahora ? { ahora } : {}), ...(revisar ? { revisar } : {}) };
}

const comoObjeto = (valor: unknown): Record<string, unknown> =>
  valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {};
const texto = (valor: unknown) => (typeof valor === "string" && valor.trim() ? valor.trim() : null);

/**
 * El motivo de una falla: el de la fila del historial; si no trae, la nota de ese paso, el motivo guardado en el error de
 * la tarjeta y la última causa de sus intentos. Solo si no hay nada, "sin motivo".
 */
function motivoDeLaFalla(despues: Record<string, unknown>, fila: FilaDelHistorial): string {
  return (
    texto(despues.motivo) ??
    texto(despues.nota) ??
    texto(comoObjeto(comoObjeto(fila.resultado).error).motivo) ??
    texto(fila.ultimaCausa) ??
    "sin motivo"
  );
}

/** Arma el resumen de un día con las filas del historial: solo cuenta lo que pasó ese día de Bogotá. */
export function armarResumen(dia: string, filas: readonly FilaDelHistorial[]): ResumenDelDia {
  const { desde, hasta } = rangoDelDia(dia);
  const resumen: ResumenDelDia = { dia, aprobadas: [], subidas: [], fallas: [], yaHechas: [] };
  const delDia = filas
    .filter((fila) => fila.creadoEn.getTime() >= desde.getTime() && fila.creadoEn.getTime() < hasta.getTime())
    .sort((a, b) => a.creadoEn.getTime() - b.creadoEn.getTime());
  for (const fila of delDia) {
    const despues = comoObjeto(fila.despues);
    const cuando = fila.creadoEn.toISOString();
    if (fila.accion === "aprobar" && fila.quien === QUIEN_AUTOMATICO && despues.automatica === true) {
      resumen.aprobadas.push({
        tarjetaId: fila.tarjetaId,
        titulo: fila.titulo,
        momento: texto(despues.momento) ?? "tarea",
        motivo: texto(despues.motivo),
        cuando,
      });
    } else if (fila.origen === "TRABAJADOR" && fila.accion === "estado") {
      const subida = comoObjeto(despues.subida);
      const yaEstabaHecho = comoObjeto(despues.yaEstabaHecho);
      if (Object.keys(yaEstabaHecho).length) {
        resumen.yaHechas.push({ tarjetaId: fila.tarjetaId, titulo: fila.titulo, commit: texto(yaEstabaHecho.commit), cuando });
      } else if (Object.keys(subida).length) {
        resumen.subidas.push({
          tarjetaId: fila.tarjetaId,
          titulo: fila.titulo,
          commit: texto(subida.commit),
          linkCommit: texto(subida.linkCommit),
          cuando,
          ...(tresLineasDeLaSubida(subida) ? { tresLineas: tresLineasDeLaSubida(subida) } : {}),
        });
      } else if (despues.estado === "HECHO") {
        // Terminada sin subir a producción (tareas que no llevan repo): también es "lista".
        resumen.subidas.push({ tarjetaId: fila.tarjetaId, titulo: fila.titulo, commit: null, linkCommit: null, cuando });
      } else if (despues.estado === "ERROR") {
        resumen.fallas.push({ tarjetaId: fila.tarjetaId, titulo: fila.titulo, motivo: motivoDeLaFalla(despues, fila), cuando });
      }
    }
  }
  return resumen;
}

/**
 * Las cifras del mensaje. `chocaronConMain` (31-oct-2026, meta del dueño: cero por día) son las tarjetas distintas
 * que ese día chocaron con main (un IntentoTarjeta de categoría choca_con_main o choque_de_logica creado ese día).
 */
export type CifrasDelDia = {
  listas: number;
  conProblema: number;
  esperando: number;
  chocaronConMain: number;
  /** (31-oct-2026) El máximo del día de tareas corriendo a la vez y en fila, y los puestos disponibles (del latido). */
  corriendoMax?: number;
  enFilaMax?: number;
  cupos?: number;
  /** (31-oct-2026) Las HECHO por día antes del 31-oct (promedio del 24 al 30) y las de hoy (= listas). */
  basePorDia?: number;
  hoy?: number;
};

/** Lo de los cupos para el resumen (31-oct-2026): los máximos del día y la base de antes. Cada uno puede faltar. */
export type ExtrasDelResumen = { cuposDelDia?: CuposDelDia | null; basePorDia?: number | null };

/** Las categorías de IntentoTarjeta que cuentan como "choque con main" en el resumen. */
export const CATEGORIAS_DE_CHOQUE_CON_MAIN = ["choca_con_main", "choque_de_logica"] as const;

/**
 * Cuenta por tarjeta (no por evento): una que falló y después subió el mismo día cuenta una sola vez, como
 * lista. "Esperando tu sí" son las que hoy esperan al dueño (la lista de "Te toca a ti").
 */
export function cifrasDelDia(resumen: ResumenDelDia, esperando: number, chocaronConMain = 0, extras: ExtrasDelResumen = {}): CifrasDelDia {
  const listas = new Set(resumen.subidas.map((s) => s.tarjetaId));
  const conProblema = new Set(resumen.fallas.map((f) => f.tarjetaId).filter((id) => !listas.has(id)));
  const cupos = extras.cuposDelDia;
  const base = extras.basePorDia;
  return {
    listas: listas.size,
    conProblema: conProblema.size,
    esperando,
    chocaronConMain,
    ...(cupos ? { corriendoMax: cupos.corriendoMax, enFilaMax: cupos.enFilaMax, ...(cupos.cupos !== null ? { cupos: cupos.cupos } : {}) } : {}),
    ...(typeof base === "number" && Number.isFinite(base) ? { basePorDia: base, hoy: listas.size } : {}),
  };
}

export const haySinMovimiento = (cifras: CifrasDelDia) =>
  !cifras.listas && !cifras.conProblema && !cifras.esperando && !cifras.chocaronConMain;

/**
 * El texto que se manda por WhatsApp y se ve en la caja "Resumen de hoy": 4 líneas fijas (título, qué se arregló, qué
 * falló y qué está pendiente), sin links ni listas. Texto vacío si todas las cifras son 0 (entonces no se manda nada).
 * La línea "Falló" lleva siempre entre paréntesis cuántas tareas chocaron con main ese día, también cuando no falló nada.
 * 31-oct-2026: hasta 2 líneas más, solo con datos: los máximos de "corriendo a la vez / en fila" y la de antes y hoy.
 */
export function textoDelResumen(cifras: CifrasDelDia): string {
  if (haySinMovimiento(cifras)) return "";
  const cuantas = (n: number, uno: string, varias: string) => (n === 1 ? `1 ${uno}` : `${n} ${varias}`);
  return [
    "Resumen de Sistemas de hoy:",
    `✅ Se arregló: ${cifras.listas ? cuantas(cifras.listas, "tarea", "tareas") : "nada"}`,
    `⚠️ Falló: ${cifras.conProblema ? cuantas(cifras.conProblema, "tarea", "tareas") : "nada"} (${cifras.chocaronConMain} por choque con main)`,
    `👆 Pendiente: ${cifras.esperando ? cuantas(cifras.esperando, "tarea", "tareas") : "nada"}`,
    ...lineasDeCupos(cifras),
  ].join("\n");
}

/** Las 2 líneas de los cupos (31-oct-2026): cada una sale solo si hay sus datos. */
function lineasDeCupos(cifras: CifrasDelDia): string[] {
  const lineas: string[] = [];
  if (typeof cifras.corriendoMax === "number") lineas.push(`🔁 Corriendo a la vez: ${cifras.corriendoMax} (máx.) / en fila: ${cifras.enFilaMax ?? 0}`);
  const aLaVez = cifras.cupos ?? cifras.corriendoMax;
  if (typeof aLaVez === "number" && typeof cifras.basePorDia === "number") {
    lineas.push(`📈 Ahora corren hasta ${aLaVez} tareas a la vez; antes se terminaban ${cifras.basePorDia} por día (promedio de los 7 días antes del 31-oct) y hoy ${cifras.hoy ?? cifras.listas}`);
  }
  return lineas;
}

/* ───────────────────────────────────────────────────────────────────── la base ── */

/** Lo del historial del negocio en ese día: las aprobaciones automáticas y lo que hizo el Coordinador. */
export async function resumenDelDia(workspaceId: string, dia: string): Promise<ResumenDelDia> {
  const { desde, hasta } = rangoDelDia(dia);
  const filas = await prisma.historialTarjeta.findMany({
    where: {
      creadoEn: { gte: desde, lt: hasta },
      tarjeta: { tablero: { workspaceId } },
      OR: [{ accion: "aprobar", quien: QUIEN_AUTOMATICO }, { accion: "estado", origen: "TRABAJADOR" }],
    },
    orderBy: { creadoEn: "asc" },
    take: 1000,
    select: {
      tarjetaId: true,
      accion: true,
      origen: true,
      quien: true,
      despues: true,
      creadoEn: true,
      tarjeta: {
        select: { titulo: true, resultado: true, intentosDeTrabajo: { select: { causa: true }, orderBy: { numero: "desc" }, take: 1 } },
      },
    },
  });
  return armarResumen(
    dia,
    filas.map((fila) => ({
      ...fila,
      titulo: fila.tarjeta.titulo,
      resultado: fila.tarjeta.resultado,
      ultimaCausa: fila.tarjeta.intentosDeTrabajo?.[0]?.causa ?? null,
    })),
  );
}

/**
 * Cuántas tarjetas distintas del negocio chocaron con main ese día de Bogotá: las que tienen un IntentoTarjeta de
 * categoría choca_con_main o choque_de_logica creado ese día (las partes 1 a 3 del Coordinador los guardan así).
 */
export async function cuantasChocaronConMain(workspaceId: string, dia: string): Promise<number> {
  const { desde, hasta } = rangoDelDia(dia);
  const filas = await prisma.intentoTarjeta.findMany({
    where: {
      creadoEn: { gte: desde, lt: hasta },
      categoria: { in: [...CATEGORIAS_DE_CHOQUE_CON_MAIN] },
      tarjeta: { tablero: { workspaceId } },
    },
    distinct: ["tarjetaId"],
    select: { tarjetaId: true },
  });
  return new Set(filas.map((fila) => fila.tarjetaId)).size;
}

/* ───────────────────────────────────────────────────────────── la base de antes del 31-oct ── */

export const claveBaseAntesDel31Oct = (workspaceId: string) => `tablero:resumen-diario:base-antes-31oct:${workspaceId}`;
/** Los 7 días antes del 31-oct-2026 (cuando el Coordinador pasó a correr más tareas a la vez). */
export const DIAS_DE_LA_BASE = ["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"] as const;
const DIA_DEL_CAMBIO = "2026-10-31";

/** El promedio redondeado de las listas por día (pura). Sin días, null. */
export function promedioPorDia(listasPorDia: readonly number[]): number | null {
  return listasPorDia.length ? Math.round(listasPorDia.reduce((total, n) => total + n, 0) / listasPorDia.length) : null;
}

/**
 * Las HECHO por día antes del 31-oct (promedio del 24 al 30), del mismo `resumenDelDia`. Son días pasados y no cambian: se
 * calcula una vez y queda guardado. Antes del 31-oct no hay base (null). Nunca lanza: si falla, null y se intenta mañana.
 */
export async function basePorDiaAntesDel31Oct(workspaceId: string, hoy: string): Promise<number | null> {
  if (hoy < DIA_DEL_CAMBIO) return null;
  try {
    const key = claveBaseAntesDel31Oct(workspaceId);
    const guardada = await prisma.appSetting.findUnique({ where: { key }, select: { value: true } });
    const numero = Number(guardada?.value);
    if (guardada?.value && Number.isInteger(numero) && numero >= 0) return numero;
    const listasPorDia: number[] = [];
    for (const dia of DIAS_DE_LA_BASE) listasPorDia.push(cifrasDelDia(await resumenDelDia(workspaceId, dia), 0).listas);
    const base = promedioPorDia(listasPorDia);
    if (base === null) return null;
    await prisma.appSetting.upsert({ where: { key }, create: { key, value: String(base) }, update: { value: String(base) } });
    return base;
  } catch (error) {
    console.warn("[resumen-diario] no se pudo calcular la base de antes del 31-oct", error instanceof Error ? error.message : String(error));
    return null;
  }
}

/** Los máximos de hoy y la base de antes, para las líneas nuevas del resumen. Nunca lanza. */
async function extrasDelResumen(workspaceId: string, dia: string): Promise<ExtrasDelResumen> {
  const [cuposDelDia, basePorDia] = await Promise.all([leerCuposDelDia(workspaceId, dia), basePorDiaAntesDel31Oct(workspaceId, dia)]);
  return { cuposDelDia, basePorDia };
}

/** Cuántas tarjetas esperan en este momento al dueño (la misma lista de "Te toca a ti"). */
async function cuantasEsperan(workspaceId: string): Promise<number> {
  return (await pendientesDelDueno(todoElNegocio(workspaceId))).length;
}

/** Una línea de la vista "Hoy": el título corto y el resumen de una línea que ya se usa en la ficha. */
export type LineaDeHoy = { tarjetaId: string; titulo: string; resumen: string | null; tresLineas?: TresLineasDeHoy };

export type VistaDeHoy = {
  dia: string;
  listas: LineaDeHoy[];
  conProblema: LineaDeHoy[];
  teToca: LineaDeHoy[];
  /** "Ya estaban hechas": cerradas por el Coordinador con el commit donde ya estaban (no se confunden con lo construido hoy). */
  yaHechas: LineaDeHoy[];
};

const unaLinea = (valor: string | null) => (valor && valor.length > 140 ? `${valor.slice(0, 139).trimEnd()}…` : valor);

/** La vista "Hoy" del tablero: lo que terminó, falló o espera al dueño, una línea por tarjeta. */
export async function vistaDeHoy(workspaceId: string, ahora = new Date()): Promise<VistaDeHoy> {
  const dia = diaDeBogota(ahora);
  const [resumen, pendientes] = await Promise.all([resumenDelDia(workspaceId, dia), pendientesDelDueno(todoElNegocio(workspaceId))]);
  const idsListas = [...new Set(resumen.subidas.map((s) => s.tarjetaId))];
  const idsProblema = [...new Set(resumen.fallas.map((f) => f.tarjetaId))].filter((id) => !idsListas.includes(id));
  const ids = [...idsListas, ...idsProblema];
  const filas = ids.length
    ? await prisma.tarjetaTablero.findMany({
        where: { id: { in: ids }, borradoEn: null, tablero: { workspaceId } },
        select: { id: true, titulo: true, detalle: true, plan: true, resultado: true },
      })
    : [];
  const porId = new Map(filas.map((fila) => [fila.id, fila]));
  // Las 3 líneas de la última subida de cada tarjeta lista (el CRM las guarda con la subida; sin ellas, la línea queda como antes).
  const tresLineasPorTarjeta = new Map<string, TresLineasDeHoy>();
  for (const subida of resumen.subidas) if (subida.tresLineas) tresLineasPorTarjeta.set(subida.tarjetaId, subida.tresLineas);
  const linea = (id: string): LineaDeHoy | null => {
    const fila = porId.get(id);
    if (!fila) return null;
    const resultado = comoObjeto(fila.resultado);
    const corto = resumenCorto({ resultadoResumen: texto(resultado.resumen), plan: fila.plan, detalle: fila.detalle });
    const tresLineas = tresLineasPorTarjeta.get(id);
    return { tarjetaId: fila.id, titulo: tituloCorto(fila.titulo), resumen: unaLinea(corto?.texto ?? null), ...(tresLineas ? { tresLineas } : {}) };
  };
  const lineas = (lista: string[]) => lista.map(linea).filter((l): l is LineaDeHoy => l !== null).slice(0, MAX_POR_GRUPO);
  return {
    dia,
    listas: lineas(idsListas),
    conProblema: lineas(idsProblema),
    yaHechas: resumen.yaHechas
      .filter((ya, indice, todas) => todas.findIndex((otra) => otra.tarjetaId === ya.tarjetaId) === indice)
      .slice(0, MAX_POR_GRUPO)
      .map((ya) => ({ tarjetaId: ya.tarjetaId, titulo: tituloCorto(ya.titulo), resumen: ya.commit ? `ya estaba hecho (commit ${ya.commit.slice(0, 10)})` : "ya estaba hecho" })),
    teToca: pendientes.slice(0, MAX_POR_GRUPO).map((p) => ({
      tarjetaId: p.id,
      titulo: tituloCorto(p.titulo),
      resumen: unaLinea(resumenCorto({ resultadoResumen: p.resultado?.resumen, plan: p.plan, detalle: p.detalle })?.texto ?? null),
    })),
  };
}

/** La caja "Resumen de hoy" del tablero: lo de hoy hasta ahora y el interruptor de la aprobación automática. */
export async function resumenDeHoyParaLaPantalla(workspaceId: string, ahora = new Date()) {
  const dia = diaDeBogota(ahora);
  const [resumen, esperando, chocaron, prendida, extras] = await Promise.all([
    resumenDelDia(workspaceId, dia),
    cuantasEsperan(workspaceId),
    cuantasChocaronConMain(workspaceId, dia),
    aprobacionAutomaticaPrendida(workspaceId),
    extrasDelResumen(workspaceId, dia),
  ]);
  const cifras = cifrasDelDia(resumen, esperando, chocaron, extras);
  return {
    dia,
    cifras,
    // El texto corto del día; vacío si hoy no hay nada que contar.
    texto: textoDelResumen(cifras),
    aprobacionAutomatica: prendida,
  };
}

/* ───────────────────────────────────────────────────────────────────── el envío diario ── */

export const claveResumenEnviado = (workspaceId: string) => `tablero:resumen-diario:ultimo:${workspaceId}`;
export const claveInterruptorDelResumen = (workspaceId: string) => `tablero:resumen-diario:activo:${workspaceId}`;
const HORA_DEL_RESUMEN = 18;

/** ¿Ya es hora del resumen? De las 6 p. m. hasta que empiece el silencio (9 p. m.), hora de Bogotá. */
export function esHoraDelResumen(ahora: Date): boolean {
  return horaDeBogota(ahora) >= HORA_DEL_RESUMEN && !enSilencioDeAvisos(ahora);
}

/**
 * Manda el resumen del día al dueño si ya es la hora, no se mandó hoy y los avisos (y el interruptor del resumen,
 * prendido sin fila) lo permiten. Un día sin movimiento no manda nada y queda anotado. Nunca lanza por un negocio.
 */
export async function enviarResumenDiarioAlDueno(ahora: Date = new Date()): Promise<{ enviados: number }> {
  if (!esHoraDelResumen(ahora)) return { enviados: 0 };
  const dia = diaDeBogota(ahora);
  const negocios = await prisma.tableroInteligente.findMany({ distinct: ["workspaceId"], select: { workspaceId: true } });
  let enviados = 0;
  for (const { workspaceId } of negocios) {
    try {
      const [ultimo, interruptor] = await Promise.all([
        prisma.appSetting.findUnique({ where: { key: claveResumenEnviado(workspaceId) }, select: { value: true } }),
        prisma.appSetting.findUnique({ where: { key: claveInterruptorDelResumen(workspaceId) }, select: { value: true } }),
      ]);
      if (ultimo?.value === dia || interruptor?.value === "false" || !(await avisosPrendidos(workspaceId))) continue;
      const cifras = cifrasDelDia(
        await resumenDelDia(workspaceId, dia),
        await cuantasEsperan(workspaceId),
        await cuantasChocaronConMain(workspaceId, dia),
        await extrasDelResumen(workspaceId, dia),
      );
      const texto = textoDelResumen(cifras);
      if (texto) {
        // 31-oct-2026: hasta 6 líneas (las 4 de siempre y las 2 de los cupos).
        const envio = await enviarAlDueno(workspaceId, texto, 6);
        if (!envio.salio) continue; // se vuelve a intentar en el próximo minuto, hasta las 9 p. m.
        enviados += 1;
      }
      const key = claveResumenEnviado(workspaceId);
      await prisma.appSetting.upsert({ where: { key }, create: { key, value: dia }, update: { value: dia } });
    } catch (error) {
      console.error("[resumen-diario] no se pudo mandar el resumen", { workspaceId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { enviados };
}
