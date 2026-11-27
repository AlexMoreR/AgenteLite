/*
  TABLERO DE FEATURES (27-nov-2026, parte 1 de 3): lo que cuelga del Área Features (T-736) repartido en columnas por
  estado, para la vista tipo tablero que llega en las partes 2 y 3. Solo LEE: no cambia ninguna tarjeta ni importa nada
  que cambie estados. 'Gestión' y 'CRM' son solo etiquetas del campo `repo`.

  - Una consulta recursiva (como SQL_POR_PREPARAR_EN_FEATURES en sql-features.ts) baja por el árbol de Features a
    cualquier profundidad (tope 50 niveles y 500 filas), solo de este negocio y sin borradas. Las sin archivar entran
    todas; de las archivadas, solo las HECHO o FALLIDO terminadas en los últimos 7 días (el corte se calcula acá y va
    como dato: nada de funciones de Postgres 16).
  - Las Áreas (carpetas, tipos sin estados) no salen como tarjeta, pero dan el área de cada una con `filasDeTabla`, la
    misma lógica de la Tabla; la prioridad sale de `prioridadDeLaTarjeta`.
  - Las funciones puras (columnas, estado→columna, etiquetas, filtros, armar) se prueban sin base en
    scripts/check-tablero-features-kanban.mjs; la consulta, en PGlite.
*/
import { prisma } from "@/lib/prisma";
import { leerAreaFeatures } from "./coordinador-en-vivo";
import { codigoDeTarjeta, ESTADOS_TARJETA, type EstadoTarjetaTablero } from "./reglas";
import type { Prioridad } from "./reglas-trabajador";
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

/** En qué columna va cada estado del enum EstadoTarjeta (los 12 de ESTADOS_TARJETA, que coinciden con prisma/schema.prisma). */
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

/** La columna de un estado; la IDEA va en «Por aprobar» con la marca `esIdea`. Un estado desconocido da null. */
export function columnaDelEstado(estado: string): { clave: ClaveDeColumnaDeFeatures; esIdea: boolean } | null {
  if (!(ESTADOS_TARJETA as readonly string[]).includes(estado)) return null;
  return { clave: COLUMNA_POR_ESTADO[estado as EstadoTarjetaTablero], esIdea: estado === "IDEA" };
}

/* ------------------------------------------------------------------ etiquetas y filtros */

/** La etiqueta del repo: gestion → Gestión, aizencrm → CRM, vacío → Sin repo (otro valor, tal cual). */
export function etiquetaDelRepo(repo: string | null | undefined): string {
  const limpio = repo?.trim() ?? "";
  if (!limpio) return "Sin repo";
  if (limpio === "gestion") return "Gestión";
  if (limpio === "aizencrm") return "CRM";
  return limpio;
}

/** Una tarjeta del tablero de Features. `repo` es la etiqueta (Gestión, CRM o Sin repo). */
export type TarjetaDeFeatures = {
  id: string;
  codigo: string;
  titulo: string;
  area: string | null;
  prioridad: Prioridad;
  esIdea: boolean;
  repo: string;
  archivada: boolean;
  estado: EstadoTarjetaTablero;
};

export type ColumnaDeFeatures = { clave: ClaveDeColumnaDeFeatures; nombre: string; tarjetas: TarjetaDeFeatures[] };

export type FiltrosDeFeatures = { area?: string | null; repo?: string | null; prioridad?: string | null };

/** Filtra por área, repo (etiqueta) y prioridad; los que vienen se combinan (y). Vacío = sin filtro. */
export function filtrarTarjetas<T extends Pick<TarjetaDeFeatures, "area" | "repo" | "prioridad">>(
  tarjetas: readonly T[],
  filtros: FiltrosDeFeatures = {},
): T[] {
  const area = filtros.area?.trim() || null;
  const repo = filtros.repo?.trim() || null;
  const prioridad = filtros.prioridad?.trim() || null;
  return tarjetas.filter(
    (t) =>
      (!area || t.area === area) &&
      (!repo || t.repo === repo || t.repo === etiquetaDelRepo(repo)) &&
      (!prioridad || t.prioridad === prioridad),
  );
}

/* ------------------------------------------------------------------ la consulta */

export const DIAS_DE_HECHAS = 7;
export const TOPE_DE_TARJETAS = 500;

/** El corte de las archivadas: hace 7 días desde `ahora`, en ISO. */
export function corteDeArchivadas(ahora: Date = new Date()): string {
  return new Date(ahora.getTime() - DIAS_DE_HECHAS * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Lo que cuelga del Área Features ($1) en el negocio $2, a cualquier profundidad (sin pasar por borradas; hasta 50
 * niveles). Las carpetas (tipo sin estados) salen siempre, para calcular el área. Las sin archivar entran todas; de las
 * archivadas, las HECHO o FALLIDO con `terminadaEn` desde $3 (ISO). Primero las carpetas y las que se están moviendo,
 * después las más recientes; tope 500. Solo lectura.
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
SELECT c."id", c."numero", c."titulo", c."area", c."estado"::text AS "estado", c."tipoId", c."padreId", c."repo",
  c."urgente", c."prioridad", (c."archivadaEn" IS NOT NULL) AS "archivada",
  k."nombre" AS "tipoNombre", k."usaEstados", k."requiereAprobacion", k."orden" AS "tipoOrden"
FROM "TarjetaTablero" c
JOIN "TableroInteligente" b ON b."id" = c."tableroId"
JOIN "TipoTarjeta" k ON k."id" = c."tipoId"
WHERE c."id" IN (SELECT "id" FROM baja)
  AND b."workspaceId" = $2
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
  archivada: boolean;
  tipoNombre: string;
  usaEstados: boolean;
  requiereAprobacion: boolean;
  tipoOrden: number;
};

/**
 * Arma las columnas con las filas de la consulta y el Área Features (para que lo que cuelga directo de ella herede su
 * área). Las carpetas no salen como tarjeta. Devuelve también la lista de áreas (sin repetir, en orden alfabético).
 */
export function armarColumnas(
  filas: readonly FilaDeFeatures[],
  features?: { id: string; titulo: string; area: string | null; tipoId: string } | null,
): { columnas: ColumnaDeFeatures[]; areas: string[] } {
  type Base = TarjetaDeVista & { fila: FilaDeFeatures | null };
  const base = (f: FilaDeFeatures): Base => ({
    id: f.id,
    numero: f.numero,
    codigo: codigoDeTarjeta(f.numero),
    titulo: f.titulo,
    detalle: "",
    area: f.area,
    estado: f.estado as EstadoTarjetaTablero,
    fecha: null,
    tipoId: f.tipoId,
    padreId: f.padreId,
    repo: f.repo,
    urgente: Boolean(f.urgente),
    prioridad: f.prioridad,
    responsableId: null,
    responsableNombre: null,
    fila: f,
  });
  const tipos = new Map<string, TipoDeVista>();
  for (const f of filas) {
    tipos.set(f.tipoId, { id: f.tipoId, nombre: f.tipoNombre, requiereAprobacion: Boolean(f.requiereAprobacion), usaEstados: Boolean(f.usaEstados), orden: Number(f.tipoOrden) });
  }
  const todas: Base[] = filas.map(base);
  if (features && !filas.some((f) => f.id === features.id)) {
    // El Área Features es una carpeta: da su título como área a lo que cuelga directo de ella.
    const tipoDeFeatures = `__features__${features.tipoId}`;
    tipos.set(tipoDeFeatures, { id: tipoDeFeatures, nombre: "Área", requiereAprobacion: false, usaEstados: false, orden: 0 });
    todas.push({ ...base({ id: features.id, numero: null, titulo: features.titulo, area: features.area, estado: "IDEA", tipoId: tipoDeFeatures, padreId: null, repo: null, urgente: false, prioridad: null, archivada: false, tipoNombre: "Área", usaEstados: false, requiereAprobacion: false, tipoOrden: 0 }), fila: null });
  }
  const columnas: ColumnaDeFeatures[] = COLUMNAS_DE_FEATURES.map((c) => ({ clave: c.clave, nombre: c.nombre, tarjetas: [] }));
  const porClave = new Map(columnas.map((c) => [c.clave, c]));
  const areas = new Set<string>();
  for (const fila of filasDeTabla(todas, [...tipos.values()])) {
    const f = fila.tarjeta.fila;
    if (!f || !fila.usaEstados) continue;
    const columna = columnaDelEstado(f.estado);
    if (!columna) continue;
    if (fila.area) areas.add(fila.area);
    porClave.get(columna.clave)!.tarjetas.push({
      id: f.id,
      codigo: codigoDeTarjeta(f.numero),
      titulo: f.titulo,
      area: fila.area,
      prioridad: prioridadDeLaTarjeta(fila.tarjeta),
      esIdea: columna.esIdea,
      repo: etiquetaDelRepo(f.repo),
      archivada: Boolean(f.archivada),
      estado: f.estado as EstadoTarjetaTablero,
    });
  }
  return { columnas, areas: [...areas].sort((a, b) => a.localeCompare(b, "es")) };
}

/* ------------------------------------------------------------------ con la base */

/** El número de la tarjeta del Área Features cuando el Coordinador no dejó el id guardado. */
export const NUMERO_DE_FEATURES = 736;

/** El Área Features del negocio: la guardada por el Coordinador si es de este negocio; si no, la T-736; si no, null. */
export async function idDeFeatures(negocioId: string): Promise<string | null> {
  const guardada = await leerAreaFeatures(negocioId);
  if (guardada) {
    const existe = await prisma.tarjetaTablero.findFirst({
      where: { id: guardada, borradoEn: null, tablero: { workspaceId: negocioId } },
      select: { id: true },
    });
    if (existe) return existe.id;
  }
  const t736 = await prisma.tarjetaTablero.findFirst({
    where: { numero: NUMERO_DE_FEATURES, borradoEn: null, tablero: { workspaceId: negocioId } },
    select: { id: true },
  });
  return t736?.id ?? null;
}

export type TableroDeFeatures = {
  areaFeaturesId: string | null;
  columnas: ColumnaDeFeatures[];
  areas: string[];
  error?: string;
};

const columnasVacias = (): ColumnaDeFeatures[] => COLUMNAS_DE_FEATURES.map((c) => ({ clave: c.clave, nombre: c.nombre, tarjetas: [] }));

/** Las tarjetas de Features del negocio en sus 10 columnas. Solo lee. */
export async function tableroDeFeatures(negocioId: string, ahora: Date = new Date()): Promise<TableroDeFeatures> {
  const areaFeaturesId = await idDeFeatures(negocioId);
  if (!areaFeaturesId) return { areaFeaturesId: null, columnas: columnasVacias(), areas: [], error: "No se encontró el Área Features" };
  const [filas, features] = await Promise.all([
    prisma.$queryRawUnsafe<FilaDeFeatures[]>(SQL_TABLERO_DE_FEATURES, areaFeaturesId, negocioId, corteDeArchivadas(ahora)),
    prisma.tarjetaTablero.findFirst({
      where: { id: areaFeaturesId, borradoEn: null, tablero: { workspaceId: negocioId } },
      select: { id: true, titulo: true, area: true, tipoId: true },
    }),
  ]);
  const { columnas, areas } = armarColumnas(
    filas.map((f) => ({ ...f, numero: f.numero === null ? null : Number(f.numero) })),
    features,
  );
  return { areaFeaturesId, columnas, areas };
}
