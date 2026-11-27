/*
  TABLERO DE FEATURES (27-nov-2026, parte 1 de 3 de «Tablero IA: vista tipo tablero de lo que cuelga de Features»): lee, sin
  cambiar nada, las tarjetas que cuelgan del Área Features (T-736) y las reparte en 10 columnas fijas por estado. Todavía no lo
  usa ninguna pantalla (llega en las partes 2 y 3). Prueba: scripts/check-tablero-features-kanban.mjs.

  - Las Áreas (carpetas, tipos sin estados) no salen como tarjeta, pero dan el «área» de cada tarjeta (la misma lógica de
    `filasDeTabla`, vistas-de-tabla.ts).
  - Las sin archivar entran todas. De las archivadas, solo las HECHO o FALLIDO con `terminadaEn` de los últimos 7 días.
  - "Gestión" es solo la etiqueta del campo `repo` (gestion → Gestión, aizencrm → CRM).
*/
import { prisma } from "@/lib/prisma";
import { leerAreaFeatures } from "./coordinador-en-vivo";
import { codigoDeTarjeta, type EstadoTarjetaTablero } from "./reglas";
import { type Prioridad } from "./reglas-trabajador";
import { filasDeTabla, prioridadDeLaTarjeta, type TarjetaDeVista, type TipoDeVista } from "./vistas-de-tabla";

/* ------------------------------------------------------------------ columnas */

/** Las 10 columnas, fijas y en este orden. */
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

/** En qué columna va cada estado del enum `EstadoTarjeta` (uno solo por estado). */
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

/** La columna del estado. La IDEA va en «Por aprobar» con la marca `esIdea`. */
export function columnaDelEstado(estado: EstadoTarjetaTablero): { clave: ClaveDeColumnaDeFeatures; esIdea: boolean } {
  return { clave: COLUMNA_POR_ESTADO[estado], esIdea: estado === "IDEA" };
}

/* ------------------------------------------------------------------ repo y filtros */

/** La etiqueta del repo: gestion → «Gestión», aizencrm → «CRM», vacío → «Sin repo». Otro, tal cual. */
export function etiquetaDelRepo(repo: string | null | undefined): string {
  const limpio = typeof repo === "string" ? repo.trim() : "";
  if (!limpio) return "Sin repo";
  const clave = limpio.toLowerCase();
  if (clave === "gestion") return "Gestión";
  if (clave === "aizencrm") return "CRM";
  return limpio;
}

export type TarjetaDeFeatures = {
  id: string;
  /** T-xxx (vacío si no tiene número). */
  codigo: string;
  titulo: string;
  /** La de la tarjeta o, si no tiene, la de la carpeta de la que cuelga. */
  area: string | null;
  prioridad: Prioridad;
  esIdea: boolean;
  repo: string | null;
  archivada: boolean;
  estado: EstadoTarjetaTablero;
};

/** Filtros del tablero; los que vienen se combinan entre sí (sin valor = no filtra). `repo` acepta la clave o la etiqueta. */
export type FiltrosDeFeatures = { area?: string | null; repo?: string | null; prioridad?: string | null };

const conValor = (valor: string | null | undefined): valor is string => typeof valor === "string" && valor.trim() !== "";

export function filtrarTarjetas<T extends Pick<TarjetaDeFeatures, "area" | "repo" | "prioridad">>(
  tarjetas: readonly T[],
  filtros: FiltrosDeFeatures = {},
): T[] {
  const { area, repo, prioridad } = filtros;
  return tarjetas.filter((tarjeta) => {
    if (conValor(area) && (tarjeta.area ?? "") !== area.trim()) return false;
    if (conValor(repo) && etiquetaDelRepo(tarjeta.repo) !== etiquetaDelRepo(repo) && etiquetaDelRepo(tarjeta.repo) !== repo.trim()) return false;
    if (conValor(prioridad) && tarjeta.prioridad !== prioridad.trim().toUpperCase()) return false;
    return true;
  });
}

/* ------------------------------------------------------------------ consultas (solo lectura) */

/**
 * El Área Features del negocio: la del id guardado si es de este negocio y no está borrada; si no, la T-736 del negocio.
 * $1 = id guardado (o null), $2 = workspaceId.
 */
export const SQL_AREA_FEATURES_DEL_NEGOCIO = `
SELECT c."id"
FROM "TarjetaTablero" c
JOIN "TableroInteligente" b ON b."id" = c."tableroId"
WHERE b."workspaceId" = $2::text
  AND c."borradoEn" IS NULL
  AND (c."id" = $1::text OR c."numero" = 736)
ORDER BY COALESCE(c."id" = $1::text, false) DESC
LIMIT 1`;

/**
 * Lo que cuelga de Features (a cualquier profundidad, sin pasar por borradas, hasta 50 niveles) de ESTE negocio, en la forma de
 * SQL_POR_PREPARAR_EN_FEATURES (sql-features.ts). Solo lee. Trae dos clases de fila:
 *  - `esTarjeta` = true: hasta 500 tarjetas de un tipo con estados. Las sin archivar todas; de las archivadas, solo las HECHO o
 *    FALLIDO con `terminadaEn` desde $3. Primero las que se mueven y después las terminadas, la más reciente primero.
 *  - `esTarjeta` = false: las madres del árbol (Features, sus carpetas y las tareas con partes) que no salieron como tarjeta.
 *    No se muestran: solo sirven para calcular el área heredada.
 * $1 = id del Área Features, $2 = workspaceId, $3 = el corte de 7 días (ISO, lo calcula el programa).
 */
export const SQL_TABLERO_DE_FEATURES = `
WITH RECURSIVE baja AS (
  SELECT h."id", h."padreId", 1 AS "nivel"
  FROM "TarjetaTablero" h
  WHERE h."padreId" = $1::text AND h."borradoEn" IS NULL
  UNION ALL
  SELECT h."id", h."padreId", s."nivel" + 1
  FROM baja s
  JOIN "TarjetaTablero" h ON h."padreId" = s."id" AND h."borradoEn" IS NULL
  WHERE s."nivel" < 50
),
tarjetas AS (
  SELECT c."id"
  FROM "TarjetaTablero" c
  JOIN "TableroInteligente" b ON b."id" = c."tableroId"
  JOIN "TipoTarjeta" k ON k."id" = c."tipoId"
  WHERE c."id" IN (SELECT "id" FROM baja)
    AND b."workspaceId" = $2::text
    AND c."borradoEn" IS NULL
    AND k."usaEstados" = true
    AND (
      c."archivadaEn" IS NULL
      OR (c."estado" IN ('HECHO', 'FALLIDO') AND c."terminadaEn" >= ($3::timestamptz AT TIME ZONE 'UTC'))
    )
  ORDER BY (c."estado" IN ('HECHO', 'FALLIDO')) ASC, c."actualizadoEn" DESC, c."numero" DESC
  LIMIT 500
),
madres AS (
  SELECT c."id"
  FROM "TarjetaTablero" c
  JOIN "TableroInteligente" b ON b."id" = c."tableroId"
  WHERE c."id" IN (SELECT "padreId" FROM baja)
    AND c."id" NOT IN (SELECT "id" FROM tarjetas)
    AND b."workspaceId" = $2::text
    AND c."borradoEn" IS NULL
  LIMIT 2000
),
elegidas AS (
  SELECT "id", true AS "esTarjeta" FROM tarjetas
  UNION ALL
  SELECT "id", false AS "esTarjeta" FROM madres
)
SELECT c."id", c."numero", c."titulo", c."area", c."estado"::text AS "estado", c."tipoId", c."padreId", c."repo",
  c."urgente", c."prioridad", (c."archivadaEn" IS NOT NULL) AS "archivada", e."esTarjeta",
  k."nombre" AS "tipoNombre", k."requiereAprobacion", k."usaEstados", k."orden" AS "tipoOrden"
FROM elegidas e
JOIN "TarjetaTablero" c ON c."id" = e."id"
JOIN "TipoTarjeta" k ON k."id" = c."tipoId"
ORDER BY e."esTarjeta" DESC, (c."estado" IN ('HECHO', 'FALLIDO')) ASC, c."actualizadoEn" DESC, c."numero" DESC`;

type FilaDeLaConsulta = {
  id: string;
  numero: number | null;
  titulo: string;
  area: string | null;
  estado: EstadoTarjetaTablero;
  tipoId: string;
  padreId: string | null;
  repo: string | null;
  urgente: boolean;
  prioridad: string | null;
  archivada: boolean;
  esTarjeta: boolean;
  tipoNombre: string;
  requiereAprobacion: boolean;
  usaEstados: boolean;
  tipoOrden: number;
};

/** Días que se ven las terminadas ya archivadas. */
export const DIAS_DE_TERMINADAS = 7;

/** El id del Área Features: el guardado por el Coordinador (leerAreaFeatures); si no sirve, la T-736 del negocio; si no, null. */
export async function idDeFeatures(negocioId: string): Promise<string | null> {
  const guardado = await leerAreaFeatures(negocioId);
  const filas = await prisma.$queryRawUnsafe<{ id: string }[]>(SQL_AREA_FEATURES_DEL_NEGOCIO, guardado, negocioId);
  return filas[0]?.id ?? null;
}

export type ColumnaConTarjetas = { clave: ClaveDeColumnaDeFeatures; nombre: string; tarjetas: TarjetaDeFeatures[] };
export type TableroDeFeatures = {
  areaFeaturesId: string | null;
  columnas: ColumnaConTarjetas[];
  /** Las áreas que tienen alguna tarjeta, en orden alfabético (para el filtro). */
  areas: string[];
  error?: string;
};

export const SIN_AREA_FEATURES = "No se encontró el Área Features";

const columnasVacias = (): ColumnaConTarjetas[] => COLUMNAS_DE_FEATURES.map((c) => ({ clave: c.clave, nombre: c.nombre, tarjetas: [] }));

/** Arma las columnas con las filas de la consulta (pura: la prueba la usa sin base). */
export function columnasDeLasFilas(filas: readonly FilaDeLaConsulta[]): Pick<TableroDeFeatures, "columnas" | "areas"> {
  const tipos = new Map<string, TipoDeVista>();
  for (const fila of filas) {
    tipos.set(fila.tipoId, {
      id: fila.tipoId,
      nombre: fila.tipoNombre,
      requiereAprobacion: fila.requiereAprobacion,
      usaEstados: fila.usaEstados,
      orden: fila.tipoOrden,
    });
  }
  const deVista = filas.map((fila) => ({
    ...fila,
    codigo: codigoDeTarjeta(fila.numero),
    detalle: "",
    fecha: null,
    responsableId: null,
    responsableNombre: null,
  })) satisfies (TarjetaDeVista & FilaDeLaConsulta)[];

  const columnas = columnasVacias();
  const porClave = new Map(columnas.map((c) => [c.clave, c]));
  const areas = new Set<string>();
  for (const { tarjeta, area } of filasDeTabla(deVista, [...tipos.values()])) {
    if (!tarjeta.esTarjeta || !tarjeta.usaEstados) continue;
    const { clave, esIdea } = columnaDelEstado(tarjeta.estado);
    const columna = porClave.get(clave);
    if (!columna) continue;
    if (area) areas.add(area);
    columna.tarjetas.push({
      id: tarjeta.id,
      codigo: tarjeta.codigo,
      titulo: tarjeta.titulo,
      area,
      prioridad: prioridadDeLaTarjeta(tarjeta),
      esIdea,
      repo: tarjeta.repo,
      archivada: tarjeta.archivada,
      estado: tarjeta.estado,
    });
  }
  return { columnas, areas: [...areas].sort((a, b) => a.localeCompare(b, "es")) };
}

/** El tablero de Features del negocio, en columnas. Solo lee. */
export async function tableroDeFeatures(negocioId: string, ahora: Date = new Date()): Promise<TableroDeFeatures> {
  const areaFeaturesId = await idDeFeatures(negocioId);
  if (!areaFeaturesId) return { areaFeaturesId: null, columnas: columnasVacias(), areas: [], error: SIN_AREA_FEATURES };
  const desde = new Date(ahora.getTime() - DIAS_DE_TERMINADAS * 24 * 60 * 60 * 1000).toISOString();
  const filas = await prisma.$queryRawUnsafe<FilaDeLaConsulta[]>(SQL_TABLERO_DE_FEATURES, areaFeaturesId, negocioId, desde);
  return { areaFeaturesId, ...columnasDeLasFilas(filas) };
}
