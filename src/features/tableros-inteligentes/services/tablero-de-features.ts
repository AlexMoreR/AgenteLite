/*
  Tablero IA, vista tipo tablero de Features (27-nov-2026, parte 1 de 3): lee, sin cambiar nada, todas las tarjetas que
  cuelgan del Área Features (T-736) a cualquier profundidad y las reparte en 10 columnas fijas por estado. Todavía no la
  llama ninguna pantalla (llega en las partes 2 y 3).

  - Las Áreas (carpetas: tipos sin estados) no salen como tarjeta, pero dan el «área» de cada una (filasDeTabla).
  - Entran las sin archivar (todas, aunque sean HECHO viejas: decisión del dueño) y, de las archivadas, solo las HECHO o
    FALLIDO que terminaron en los últimos 7 días.
  - Solo lee: no importa nada que cambie una tarjeta. Prueba: scripts/check-tablero-features-kanban.mjs.
*/
import { prisma } from "@/lib/prisma";

import { leerAreaFeatures } from "./coordinador-en-vivo";
import { codigoDeTarjeta, esEstado, type EstadoTarjetaTablero } from "./reglas";
import type { Prioridad } from "./reglas-trabajador";
import { SIN_AREA_FEATURES } from "./tablero-de-features-filtros";
import { filasDeTabla, prioridadDeLaTarjeta, type TarjetaDeVista, type TipoDeVista } from "./vistas-de-tabla";

// Lo puro (repo, filtros y el texto del error) vive en tablero-de-features-filtros.ts para que la pantalla (cliente) lo use sin traer prisma.
export { SIN_AREA_FEATURES, etiquetaDelRepo, filtrarTarjetas, type FiltrosDeFeatures } from "./tablero-de-features-filtros";

/* ------------------------------------------------------------------ columnas */

export const COLUMNAS_DE_FEATURES = [
  { clave: "por_aprobar", nombre: "Por aprobar" },
  { clave: "aprobado", nombre: "Aprobado (en fila)" },
  { clave: "planeando", nombre: "Planeando" },
  { clave: "plan_listo", nombre: "Plan listo" },
  { clave: "en_curso", nombre: "En curso" },
  { clave: "por_revisar", nombre: "Por revisar" },
  { clave: "subiendo", nombre: "Subiendo" },
  { clave: "error", nombre: "Error" },
  { clave: "hecho", nombre: "Hecho (últimos 7 días)" },
  { clave: "fallido", nombre: "Fallido" },
] as const;
export type ClaveDeColumnaDeFeatures = (typeof COLUMNAS_DE_FEATURES)[number]["clave"];

/** Cada estado del enum en una sola columna. IDEA va con POR_APROBAR (con la marca `esIdea`); APROBADO y PLAN_APROBADO juntos. */
const COLUMNA_POR_ESTADO: Record<EstadoTarjetaTablero, ClaveDeColumnaDeFeatures> = {
  IDEA: "por_aprobar",
  POR_APROBAR: "por_aprobar",
  APROBADO: "aprobado",
  PLAN_APROBADO: "aprobado",
  PLANEANDO: "planeando",
  PLAN_LISTO: "plan_listo",
  EN_CURSO: "en_curso",
  POR_REVISAR: "por_revisar",
  SUBIENDO: "subiendo",
  ERROR: "error",
  HECHO: "hecho",
  FALLIDO: "fallido",
};

export function columnaDelEstado(estado: EstadoTarjetaTablero): { clave: ClaveDeColumnaDeFeatures; esIdea: boolean } {
  return { clave: COLUMNA_POR_ESTADO[estado], esIdea: estado === "IDEA" };
}

/* ------------------------------------------------------------------ repo */

/* ------------------------------------------------------------------ la consulta */

/** Hasta cuántos días atrás entran las archivadas terminadas. */
export const DIAS_DE_HECHO = 7;
/** Tope de filas (carpetas incluidas) y de niveles del recorrido. */
export const TOPE_DE_TARJETAS = 500;

/**
 * Todo lo que cuelga del Área Features (a cualquier profundidad, sin pasar por borradas; hasta 50 niveles), Features
 * incluida (que tiene que ser de ESTE negocio: si no, no sale nada), de ESTE negocio y sin borradas. Las carpetas (tipos sin estados) salen siempre, para dar el área. Las tarjetas
 * sin archivar salen todas; de las archivadas, solo las HECHO o FALLIDO con `terminadaEn` desde $3. Primero las carpetas,
 * después las que no están terminadas y, dentro, la que se movió más reciente: así el tope de 500 deja fuera las viejas.
 * Solo lee. $1 = id del Área Features, $2 = workspaceId, $3 = desde cuándo (ISO; lo calcula el programa).
 */
export const SQL_TABLERO_DE_FEATURES = `
WITH RECURSIVE baja AS (
  SELECT h."id", 0 AS "nivel"
  FROM "TarjetaTablero" h
  JOIN "TableroInteligente" fb ON fb."id" = h."tableroId"
  WHERE h."id" = $1::text AND h."borradoEn" IS NULL AND fb."workspaceId" = $2::text
  UNION ALL
  SELECT h."id", s."nivel" + 1
  FROM baja s
  JOIN "TarjetaTablero" h ON h."padreId" = s."id" AND h."borradoEn" IS NULL
  WHERE s."nivel" < 50
)
SELECT c."id", c."numero", c."titulo", c."area", c."estado"::text AS "estado", c."tipoId", c."padreId", c."repo",
  c."urgente", c."prioridad", c."archivadaEn", c."terminadaEn", c."actualizadoEn",
  k."nombre" AS "tipoNombre", k."orden" AS "tipoOrden", k."requiereAprobacion", k."usaEstados"
FROM "TarjetaTablero" c
JOIN "TableroInteligente" b ON b."id" = c."tableroId"
JOIN "TipoTarjeta" k ON k."id" = c."tipoId"
WHERE c."id" IN (SELECT "id" FROM baja)
  AND b."workspaceId" = $2::text
  AND c."borradoEn" IS NULL
  AND (
    k."usaEstados" = false
    OR c."archivadaEn" IS NULL
    OR (c."estado" IN ('HECHO', 'FALLIDO') AND c."terminadaEn" >= ($3::timestamptz AT TIME ZONE 'UTC'))
  )
ORDER BY (k."usaEstados" = false) DESC, (c."estado" IN ('HECHO', 'FALLIDO')) ASC, c."actualizadoEn" DESC, c."numero" DESC
LIMIT ${TOPE_DE_TARJETAS}`;

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
  terminadaEn: Date | string | null;
  actualizadoEn: Date | string | null;
  tipoNombre: string;
  tipoOrden: number;
  requiereAprobacion: boolean;
  usaEstados: boolean;
};

/** El corte de las archivadas: hace DIAS_DE_HECHO días desde `ahora`. */
export function desdeCuando(ahora: Date = new Date()): Date {
  return new Date(ahora.getTime() - DIAS_DE_HECHO * 24 * 60 * 60 * 1000);
}

/* ------------------------------------------------------------------ las tarjetas */

export type TarjetaDeFeatures = {
  id: string;
  codigo: string;
  titulo: string;
  area: string | null;
  prioridad: Prioridad;
  esIdea: boolean;
  repo: string | null;
  archivada: boolean;
  estado: EstadoTarjetaTablero;
};

export type ColumnaConTarjetas = { clave: ClaveDeColumnaDeFeatures; nombre: string; tarjetas: TarjetaDeFeatures[] };

export type TableroDeFeatures = {
  areaFeaturesId: string | null;
  columnas: ColumnaConTarjetas[];
  /** Las áreas que tienen alguna tarjeta, en orden alfabético (para el filtro). */
  areas: string[];
  error?: string;
};

const COMPARAR_TEXTO = new Intl.Collator("es", { sensitivity: "base", numeric: true });

/**
 * Las filas de la consulta como tarjetas: las carpetas se quitan, pero antes dan el área (la misma regla de la Tabla,
 * filasDeTabla). Una fila con un estado que no se conoce se salta.
 */
export function tarjetasDeLasFilas(filas: readonly FilaDeFeatures[]): TarjetaDeFeatures[] {
  const tipos = new Map<string, TipoDeVista>();
  const deVista: TarjetaDeVista[] = [];
  const porId = new Map(filas.map((fila) => [fila.id, fila]));
  for (const fila of filas) {
    tipos.set(fila.tipoId, {
      id: fila.tipoId,
      nombre: fila.tipoNombre,
      requiereAprobacion: fila.requiereAprobacion,
      usaEstados: fila.usaEstados,
      orden: fila.tipoOrden,
    });
    deVista.push({
      id: fila.id,
      numero: fila.numero,
      codigo: codigoDeTarjeta(fila.numero),
      titulo: fila.titulo,
      detalle: "",
      area: fila.area,
      // Las carpetas también son IDEA en la base; si llega un estado raro, se marca y se salta abajo.
      estado: esEstado(fila.estado) ? fila.estado : "IDEA",
      fecha: null,
      tipoId: fila.tipoId,
      padreId: fila.padreId,
      repo: fila.repo,
      urgente: fila.urgente,
      prioridad: fila.prioridad,
      responsableId: null,
      responsableNombre: null,
    });
  }
  return filasDeTabla(deVista, [...tipos.values()])
    .filter((fila) => fila.usaEstados && esEstado(porId.get(fila.tarjeta.id)?.estado))
    .map(({ tarjeta, area }) => ({
      id: tarjeta.id,
      codigo: tarjeta.codigo,
      titulo: tarjeta.titulo,
      area,
      prioridad: prioridadDeLaTarjeta(tarjeta),
      esIdea: columnaDelEstado(tarjeta.estado).esIdea,
      repo: tarjeta.repo?.trim() || null,
      archivada: Boolean(porId.get(tarjeta.id)?.archivadaEn),
      estado: tarjeta.estado,
    }));
}

/** Reparte las tarjetas en las 10 columnas, en el orden fijo (las vacías salen igual, sin tarjetas). */
export function repartirEnColumnas(tarjetas: readonly TarjetaDeFeatures[]): ColumnaConTarjetas[] {
  const columnas = COLUMNAS_DE_FEATURES.map((columna) => ({ clave: columna.clave, nombre: columna.nombre, tarjetas: [] as TarjetaDeFeatures[] }));
  const porClave = new Map(columnas.map((columna) => [columna.clave, columna]));
  for (const tarjeta of tarjetas) porClave.get(columnaDelEstado(tarjeta.estado).clave)?.tarjetas.push(tarjeta);
  return columnas;
}

/** Las áreas distintas de las tarjetas, en orden alfabético (las sin área no cuentan). */
export function areasDeLasTarjetas(tarjetas: readonly TarjetaDeFeatures[]): string[] {
  return [...new Set(tarjetas.map((tarjeta) => tarjeta.area).filter((area): area is string => Boolean(area)))].sort(COMPARAR_TEXTO.compare);
}

/* ------------------------------------------------------------------ el Área Features */

/** El número de la tarjeta del Área Features (T-736), si el Coordinador todavía no mandó el id. */
export const NUMERO_DEL_AREA_FEATURES = 736;

/**
 * El id del Área Features de este negocio: el que guardó el Coordinador (leerAreaFeatures) si es una tarjeta sin borrar del
 * negocio; si no, la T-736 del negocio sin borrar; si tampoco, null. Nunca lanza.
 */
export async function idDeFeatures(negocioId: string): Promise<string | null> {
  try {
    const guardado = await leerAreaFeatures(negocioId);
    if (guardado) {
      const fila = await prisma.tarjetaTablero.findFirst({
        where: { id: guardado, borradoEn: null, tablero: { workspaceId: negocioId } },
        select: { id: true },
      });
      if (fila) return fila.id;
    }
    const t736 = await prisma.tarjetaTablero.findFirst({
      where: { numero: NUMERO_DEL_AREA_FEATURES, borradoEn: null, tablero: { workspaceId: negocioId } },
      select: { id: true },
    });
    return t736?.id ?? null;
  } catch {
    return null;
  }
}

/** El tablero de Features de este negocio, en columnas. Sin el Área Features, las columnas vacías y el error. */
export async function tableroDeFeatures(negocioId: string, ahora: Date = new Date()): Promise<TableroDeFeatures> {
  const vacias = () => repartirEnColumnas([]);
  const areaFeaturesId = await idDeFeatures(negocioId);
  if (!areaFeaturesId) return { areaFeaturesId: null, columnas: vacias(), areas: [], error: SIN_AREA_FEATURES };
  const filas = await prisma.$queryRawUnsafe<FilaDeFeatures[]>(
    SQL_TABLERO_DE_FEATURES,
    areaFeaturesId,
    negocioId,
    desdeCuando(ahora).toISOString(),
  );
  const tarjetas = tarjetasDeLasFilas(filas);
  return { areaFeaturesId, columnas: repartirEnColumnas(tarjetas), areas: areasDeLasTarjetas(tarjetas) };
}
