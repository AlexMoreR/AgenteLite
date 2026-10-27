import { prisma } from "@/lib/prisma";
import { QUIEN_AUTOMATICO, aprobacionAutomaticaPrendida } from "./aprobacion-automatica";
import { resumenCorto, tituloCorto } from "./resumen-corto";
import { linkDeHoy, pendientesDelDueno, todoElNegocio } from "./tableros";

/*
  RESUMEN DIARIO del Tablero IA (22-oct-2026; formato corto el 26-oct-2026). Es el texto corto de 2 líneas que se
  ve en la caja "Resumen de hoy" y en la vista "Hoy" del tablero:
    Hoy: 4 listas ✅, 1 con problema ⚠️, 2 esperando tu sí 👆
    Ver: <link al tablero filtrado en lo de hoy>
  Si una cifra es 0, esa parte no sale. Sin commits, ramas, ids ni títulos largos.

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
        resumen.fallas.push({ tarjetaId: fila.tarjetaId, titulo: fila.titulo, motivo: texto(despues.motivo) ?? "sin motivo", cuando });
      }
    }
  }
  return resumen;
}

/** Las tres cifras del mensaje. */
export type CifrasDelDia = { listas: number; conProblema: number; esperando: number };

/**
 * Cuenta por tarjeta (no por evento): una que falló y después subió el mismo día cuenta una sola vez, como
 * lista. "Esperando tu sí" son las que hoy esperan al dueño (la lista de "Te toca a ti").
 */
export function cifrasDelDia(resumen: ResumenDelDia, esperando: number): CifrasDelDia {
  const listas = new Set(resumen.subidas.map((s) => s.tarjetaId));
  const conProblema = new Set(resumen.fallas.map((f) => f.tarjetaId).filter((id) => !listas.has(id)));
  return { listas: listas.size, conProblema: conProblema.size, esperando };
}

export const haySinMovimiento = (cifras: CifrasDelDia) => !cifras.listas && !cifras.conProblema && !cifras.esperando;

/**
 * El texto que se manda por WhatsApp y se ve en la caja "Resumen de hoy": 2 líneas fijas. Texto vacío si
 * las tres cifras son 0 (entonces no se manda nada).
 */
export function textoDelResumen(cifras: CifrasDelDia, link: string = linkDeHoy()): string {
  const partes = [
    cifras.listas ? `${cifras.listas} ${cifras.listas === 1 ? "lista" : "listas"} ✅` : null,
    cifras.conProblema ? `${cifras.conProblema} con problema ⚠️` : null,
    cifras.esperando ? `${cifras.esperando} esperando tu sí 👆` : null,
  ].filter((parte): parte is string => parte !== null);
  if (!partes.length) return "";
  return `Hoy: ${partes.join(", ")}\nVer: ${link}`;
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
      tarjeta: { select: { titulo: true } },
    },
  });
  return armarResumen(
    dia,
    filas.map((fila) => ({ ...fila, titulo: fila.tarjeta.titulo })),
  );
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
  const [resumen, esperando, prendida] = await Promise.all([
    resumenDelDia(workspaceId, dia),
    cuantasEsperan(workspaceId),
    aprobacionAutomaticaPrendida(workspaceId),
  ]);
  const cifras = cifrasDelDia(resumen, esperando);
  return {
    dia,
    cifras,
    // El texto corto del día; vacío si hoy no hay nada que contar.
    texto: textoDelResumen(cifras),
    aprobacionAutomatica: prendida,
  };
}
