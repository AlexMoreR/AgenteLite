/*
  TABLERO DE FEATURES (27-nov-2026, parte 1 de 3 de «Tablero IA: vista tipo tablero (columnas por estado) de lo que cuelga de
  Features»): lee, SIN CAMBIAR NADA, todas las tarjetas que cuelgan del Área Features (T-736) a cualquier profundidad y las
  reparte en 10 columnas fijas por estado. Todavía no la llama ninguna pantalla (llega en las partes 2 y 3).

  - Las Áreas (carpetas: tipos sin estados) no salen como tarjeta, pero dan el «área» de cada tarjeta (filasDeTabla).
  - Las sin archivar entran todas. De las archivadas entran solo las HECHO o FALLIDO con `terminadaEn` de los últimos 7 días.
  - «Gestión» y «CRM» son solo etiquetas del campo `repo`.

  Prueba: npm run test:tablero-features-kanban (scripts/check-tablero-features-kanban.mjs).
*/
import { prisma } from "@/lib/prisma";

import { leerAreaFeatures } from "./coordinador-en-vivo";
import { ESTADOS_TARJETA, NOMBRE_DEL_ESTADO, codigoDeTarjeta, type EstadoTarjetaTablero } from "./reglas";
import type { Prioridad } from "./reglas-trabajador";
import { filasDeTabla, prioridadDeLaTarjeta, type TarjetaDeVista, type TipoDeVista } from "./vistas-de-tabla";

/* ------------------------------------------------------------------ columnas */

/** Las 10 columnas, en este orden. */
export const COLUMNAS_DE_FEATURES = [
  { clave: "POR_APROBAR", nombre: "Por aprobar" },
  { clave: "APROBADO", nombre: "Aprobado (en fila)" },
  { clave: "PLANEANDO", nombre: NOMBRE_DEL_ESTADO.PLANEANDO },
  { clave: "PLAN_LISTO", nombre: NOMBRE_DEL_ESTADO.PLAN_LISTO },
  { clave: "EN_CURSO", nombre: NOMBRE_DEL_ESTADO.EN_CURSO },
  { clave: "POR_REVISAR", nombre: NOMBRE_DEL_ESTADO.POR_REVISAR },
  { clave: "SUBIENDO", nombre: NOMBRE_DEL_ESTADO.SUBIENDO },
  { clave: "ERROR", nombre: NOMBRE_DEL_ESTADO.ERROR },
  { clave: "HECHO", nombre: "Hecho (últimos 7 días)" },
  { clave: "FALLIDO", nombre: NOMBRE_DEL_ESTADO.FALLIDO },
] as const;
export type ClaveDeColumnaDeFeatures = (typeof COLUMNAS_DE_FEATURES)[number]["clave"];

/** En qué columna va cada estado. IDEA va a «Por aprobar» con la marca `esIdea`; APROBADO y PLAN_APROBADO van juntos. */
const COLUMNA_POR_ESTADO: Record<EstadoTarjetaTablero, ClaveDeColumnaDeFeatures> = {
  IDEA: "POR_APROBAR",
  POR_APROBAR: "POR_APROBAR",
  APROBADO: "APROBADO",
  PLAN_APROBADO: "APROBADO",
  PLANEANDO: "PLANEANDO",
  PLAN_LISTO: "PLAN_LISTO",
  EN_CURSO: "EN_CURSO",
  POR_REVISAR: "POR_REVISAR",
  SUBIENDO: "SUBIENDO",
  ERROR: "ERROR",
  HECHO: "HECHO",
  FALLIDO: "FALLIDO",
};

export function columnaDelEstado(estado: EstadoTarjetaTablero): { clave: ClaveDeColumnaDeFeatures; esIdea: boolean } {
  return { clave: COLUMNA_POR_ESTADO[estado] ?? "POR_APROBAR", esIdea: estado === "IDEA" };
}

/* ------------------------------------------------------------------ repo */

/** gestion → «Gestión», aizencrm → «CRM», vacío → «Sin repo». Otro valor sale tal cual. */
export function etiquetaDelRepo(repo: string | null | undefined): string {
  const limpio = typeof repo === "string" ? repo.trim() : "";
  if (!limpio) return "Sin repo";
  if (limpio === "gestion") return "Gestión";
  if (limpio === "aizencrm") return "CRM";
  return limpio;
}

/* ------------------------------------------------------------------ tarjetas y filtros */

export type TarjetaDeFeatures = {
  id: string;
  /** T-xxx */
  codigo: string;
  titulo: string;
  area: string | null;
  prioridad: Prioridad;
  esIdea: boolean;
  /** La etiqueta: Gestión, CRM o Sin repo. */
  repo: string;
  archivada: boolean;
  estado: EstadoTarjetaTablero;
};

export type FiltrosDeFeatures = { area?: string | null; repo?: string | null; prioridad?: string | null };

/** Los filtros se combinan entre sí (y). Un filtro vacío no filtra. `repo` se compara con la etiqueta (Gestión, CRM, Sin repo). */
export function filtrarTarjetas<T extends Pick<TarjetaDeFeatures, "area" | "repo" | "prioridad">>(
  tarjetas: readonly T[],
  filtros: FiltrosDeFeatures = {},
): T[] {
  const area = filtros.area?.trim() || null;
  const repo = filtros.repo?.trim() || null;
  const prioridad = filtros.prioridad?.trim() || null;
  return tarjetas.filter(
    (t) => (!area || t.area === area) && (!repo || t.repo === repo || t.repo === etiquetaDelRepo(repo)) && (!prioridad || t.prioridad === prioridad),
  );
}

/* ------------------------------------------------------------------ la consulta */

export const DIAS_DE_HECHO = 7;
export const MAX_TARJETAS_DE_FEATURES = 500;

/**
 * Las de Features (solo de lectura). Baja desde el Área Features ($1) a cualquier profundidad, sin pasar por borradas (hasta 50
 * niveles), y solo de ESTE negocio ($2). Trae dos cosas:
 *  - las carpetas (tipos sin estados), con el Área Features misma, para calcular el área de cada tarjeta (no salen como tarjeta);
 *  - las tarjetas (tipos con estados): las sin archivar todas, y de las archivadas solo las HECHO o FALLIDO con `terminadaEn`
 *    desde $3 (el corte de 7 días, calculado en el programa). Tope de 500: primero las que se están moviendo, después lo más nuevo.
 */
export const SQL_TABLERO_DE_FEATURES = `
WITH RECURSIVE baja AS (
  SELECT h."id", 1 AS "nivel"
  FROM "TarjetaTablero" h
  WHERE h."padreId" = $1::text AND h."borradoEn" IS NULL
  UNION ALL
  SELECT h."id", s."nivel" + 1
  FROM baja s
  JOIN "TarjetaTablero" h ON h."padreId" = s."id" AND h."borradoEn" IS NULL
  WHERE s."nivel" < 50
)
(
  SELECT c."id", c."numero", c."titulo", c."area", c."estado"::text AS "estado", c."tipoId", c."padreId", c."repo", c."urgente",
         c."prioridad", c."archivadaEn", k."nombre" AS "tipoNombre", k."requiereAprobacion", k."usaEstados", k."orden" AS "tipoOrden"
  FROM "TarjetaTablero" c
  JOIN "TableroInteligente" b ON b."id" = c."tableroId"
  JOIN "TipoTarjeta" k ON k."id" = c."tipoId"
  WHERE (c."id" = $1::text OR c."id" IN (SELECT "id" FROM baja))
    AND b."workspaceId" = $2
    AND c."borradoEn" IS NULL
    AND k."usaEstados" = false
  LIMIT 500
)
UNION ALL
(
  SELECT c."id", c."numero", c."titulo", c."area", c."estado"::text AS "estado", c."tipoId", c."padreId", c."repo", c."urgente",
         c."prioridad", c."archivadaEn", k."nombre" AS "tipoNombre", k."requiereAprobacion", k."usaEstados", k."orden" AS "tipoOrden"
  FROM "TarjetaTablero" c
  JOIN "TableroInteligente" b ON b."id" = c."tableroId"
  JOIN "TipoTarjeta" k ON k."id" = c."tipoId"
  WHERE c."id" IN (SELECT "id" FROM baja)
    AND b."workspaceId" = $2
    AND c."borradoEn" IS NULL
    AND k."usaEstados" = true
    AND (
      c."archivadaEn" IS NULL
      OR (c."estado" IN ('HECHO', 'FALLIDO') AND c."terminadaEn" IS NOT NULL AND c."terminadaEn" >= $3)
    )
  ORDER BY (c."archivadaEn" IS NULL AND c."estado" NOT IN ('HECHO', 'FALLIDO')) DESC, c."actualizadoEn" DESC, c."numero" DESC
  LIMIT 500
)`;

/** Una fila de SQL_TABLERO_DE_FEATURES. */
export type FilaDeFeatures = {
  id: string;
  numero: number | null;
  titulo: string;
  area: string | null;
  estado: string;
  tipoId: string;
  padreId: string | null;
  repo: string | null;
  urgente: boolean;
  prioridad: string | null;
  archivadaEn: Date | string | null;
  tipoNombre: string;
  requiereAprobacion: boolean;
  usaEstados: boolean;
  tipoOrden: number;
};

/** El corte de «Hecho (últimos 7 días)»: ahora menos 7 días. */
export function corteDeHecho(ahora: Date = new Date()): Date {
  return new Date(ahora.getTime() - DIAS_DE_HECHO * 24 * 60 * 60 * 1000);
}

const esEstado = (valor: string): valor is EstadoTarjetaTablero => (ESTADOS_TARJETA as readonly string[]).includes(valor);

export type ColumnaConTarjetas = { clave: ClaveDeColumnaDeFeatures; nombre: string; tarjetas: TarjetaDeFeatures[] };

/**
 * Arma las tarjetas con su área (heredada de la carpeta más cercana, como filasDeTabla) y su prioridad (prioridadDeLaTarjeta), y
 * las reparte en las 10 columnas. Las carpetas no salen. Puro: lo usa tableroDeFeatures y la prueba.
 */
export function repartirEnColumnas(filas: readonly FilaDeFeatures[]): { columnas: ColumnaConTarjetas[]; areas: string[] } {
  const deVista: TarjetaDeVista[] = filas.map((f) => ({
    id: f.id,
    numero: f.numero,
    codigo: codigoDeTarjeta(f.numero),
    titulo: f.titulo,
    detalle: "",
    area: f.area,
    estado: (esEstado(f.estado) ? f.estado : "IDEA") as EstadoTarjetaTablero,
    fecha: null,
    tipoId: f.tipoId,
    padreId: f.padreId,
    repo: f.repo,
    urgente: Boolean(f.urgente),
    prioridad: f.prioridad,
    responsableId: null,
    responsableNombre: null,
  }));
  const tipos = new Map<string, TipoDeVista>();
  for (const f of filas) {
    tipos.set(f.tipoId, { id: f.tipoId, nombre: f.tipoNombre, requiereAprobacion: f.requiereAprobacion, usaEstados: f.usaEstados, orden: f.tipoOrden });
  }
  const archivada = new Map(filas.map((f) => [f.id, f.archivadaEn !== null && f.archivadaEn !== undefined]));

  const columnas: ColumnaConTarjetas[] = COLUMNAS_DE_FEATURES.map((c) => ({ clave: c.clave, nombre: c.nombre, tarjetas: [] }));
  const porClave = new Map(columnas.map((c) => [c.clave, c]));
  const areas = new Set<string>();
  for (const fila of filasDeTabla(deVista, [...tipos.values()])) {
    if (!fila.usaEstados) continue;
    const { tarjeta } = fila;
    const { clave, esIdea } = columnaDelEstado(tarjeta.estado);
    if (fila.area) areas.add(fila.area);
    porClave.get(clave)!.tarjetas.push({
      id: tarjeta.id,
      codigo: tarjeta.codigo,
      titulo: tarjeta.titulo,
      area: fila.area,
      prioridad: prioridadDeLaTarjeta(tarjeta),
      esIdea,
      repo: etiquetaDelRepo(tarjeta.repo),
      archivada: archivada.get(tarjeta.id) ?? false,
      estado: tarjeta.estado,
    });
  }
  return { columnas, areas: [...areas].sort((a, b) => a.localeCompare(b, "es")) };
}

/* ------------------------------------------------------------------ con la base */

/** El número de la tarjeta Features. */
export const NUMERO_DE_FEATURES = 736;

/** El id del Área Features: el que guardó el latido (leerAreaFeatures); si no hay, la T-736 del negocio; si tampoco, null. */
export async function idDeFeatures(negocioId: string): Promise<string | null> {
  const guardado = await leerAreaFeatures(negocioId);
  if (guardado) return guardado;
  const tarjeta = await prisma.tarjetaTablero.findFirst({
    where: { numero: NUMERO_DE_FEATURES, borradoEn: null, tablero: { workspaceId: negocioId } },
    select: { id: true },
  });
  return tarjeta?.id ?? null;
}

export type TableroDeFeatures = {
  areaFeaturesId: string | null;
  columnas: ColumnaConTarjetas[];
  areas: string[];
  error?: string;
};

export const SIN_AREA_FEATURES = "No se encontró el Área Features";

const columnasVacias = (): ColumnaConTarjetas[] => COLUMNAS_DE_FEATURES.map((c) => ({ clave: c.clave, nombre: c.nombre, tarjetas: [] }));

/** Las tarjetas de Features del negocio, repartidas en las 10 columnas. Solo lee. */
export async function tableroDeFeatures(negocioId: string, ahora: Date = new Date()): Promise<TableroDeFeatures> {
  const areaFeaturesId = await idDeFeatures(negocioId);
  if (!areaFeaturesId) return { areaFeaturesId: null, columnas: columnasVacias(), areas: [], error: SIN_AREA_FEATURES };
  const filas = await prisma.$queryRawUnsafe<FilaDeFeatures[]>(SQL_TABLERO_DE_FEATURES, areaFeaturesId, negocioId, corteDeHecho(ahora));
  return { areaFeaturesId, ...repartirEnColumnas(filas) };
}
