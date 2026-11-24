import { prisma } from "@/lib/prisma";
import { claveDeNombre } from "./reglas";
import {
  borrarTarjeta,
  crearTarjeta,
  editarTarjeta,
  listarTipos,
  type ContextoTablero,
  type TipoVista,
} from "./tableros";

/*
  Tablero IA: ORGANIZAR ÁREAS (24-nov-2026), la lógica de la ventana «Organizar áreas» del menú de los 3 puntos.

  Un área es una tarjeta de un tipo SIN estados (usaEstados = false, la carpeta): nace con el tipo «Área» del
  tablero. Acá no se escribe nada a mano: crear, renombrar, mover, ordenar y borrar pasan por crearTarjeta,
  editarTarjeta y borrarTarjeta de services/tableros.ts, así que el historial, el alcance de la persona
  (un tablero ajeno responde "no existe"), el tablero archivado y los ciclos (puedeColgar) se revisan igual
  que siempre. Lo único propio de acá: que la tarjeta sea de verdad un área, el orden de las hermanas y que
  no se borre un área con tarjetas adentro.

  Quién borra (el dueño del negocio o el ADMIN de la plataforma, como «Eliminar tarjeta») lo revisa la acción
  de la pantalla (app/actions/tableros-inteligentes-actions.ts).
*/

const NO_BORRADA = { borradoEn: null } as const;

export const SIN_TIPO_AREA =
  "Este tablero no tiene un tipo Área (ni otro sin estados). Créalo en el panel Tipos y vuelve a intentar.";

/** Un área como la muestra la ventana: `hijasVivas` cuenta las hijas directas vivas de cualquier tipo. */
export type AreaVista = { id: string; titulo: string; padreId: string | null; orden: number; hijasVivas: number };

export type DireccionDeOrden = "subir" | "bajar";

/** El tipo con que se crean las áreas: el llamado «Área»; si no hay, el primero sin estados por `orden`; si no, null. */
export function tipoAreaDelTablero<T extends Pick<TipoVista, "id" | "nombre" | "usaEstados" | "orden">>(
  tipos: readonly T[],
): T | null {
  const ordenados = [...tipos].sort((a, b) => a.orden - b.orden);
  return (
    ordenados.find((tipo) => claveDeNombre(tipo.nombre) === "area") ??
    ordenados.find((tipo) => !tipo.usaEstados) ??
    null
  );
}

/** Los tipos cuyas tarjetas cuentan como área: los sin estados y el tipo Área del tablero. */
function idsDeTiposDeArea(tipos: readonly TipoVista[]): Set<string> {
  const ids = new Set(tipos.filter((tipo) => !tipo.usaEstados).map((tipo) => tipo.id));
  const area = tipoAreaDelTablero(tipos);
  if (area) ids.add(area.id);
  return ids;
}

/**
 * El orden nuevo de las hermanas al subir o bajar `id` un puesto: se cambia de lugar con la vecina y se numeran
 * 0, 1, 2… en ese orden. Devuelve SOLO las que cambian de `orden` (vacío si ya está de primera o de última).
 * `hermanas` viene en el orden en que se ven (orden y, si empatan, la más vieja primero).
 */
export function ordenAlMover(
  hermanas: readonly { id: string; orden: number }[],
  id: string,
  direccion: DireccionDeOrden,
): { id: string; orden: number }[] {
  const donde = hermanas.findIndex((hermana) => hermana.id === id);
  if (donde < 0) return [];
  const vecina = direccion === "subir" ? donde - 1 : donde + 1;
  if (vecina < 0 || vecina >= hermanas.length) return [];
  const nuevas = [...hermanas];
  [nuevas[donde], nuevas[vecina]] = [nuevas[vecina], nuevas[donde]];
  return nuevas.flatMap((hermana, orden) => (hermana.orden === orden ? [] : [{ id: hermana.id, orden }]));
}

/**
 * Las áreas vivas del tablero en el orden en que se ven, con sus hijas contadas. Un área cuya madre está borrada
 * o no es un área queda en la raíz (padreId null): así ya se ve suelta en el tablero.
 */
async function areasDelTablero(tableroId: string, tipos: readonly TipoVista[]): Promise<AreaVista[]> {
  const ids = [...idsDeTiposDeArea(tipos)];
  if (!ids.length) return [];
  const [filas, hijas] = await Promise.all([
    prisma.tarjetaTablero.findMany({
      where: { tableroId, tipoId: { in: ids }, ...NO_BORRADA },
      orderBy: [{ orden: "asc" }, { creadoEn: "asc" }],
      select: { id: true, titulo: true, padreId: true, orden: true },
    }),
    prisma.tarjetaTablero.groupBy({
      by: ["padreId"],
      where: { tableroId, padreId: { not: null }, ...NO_BORRADA },
      _count: { _all: true },
    }),
  ]);
  const cuantas = new Map(hijas.map((fila) => [fila.padreId, fila._count._all]));
  const areas = new Set(filas.map((fila) => fila.id));
  return filas.map((fila) => ({
    id: fila.id,
    titulo: fila.titulo,
    padreId: fila.padreId && areas.has(fila.padreId) ? fila.padreId : null,
    orden: fila.orden,
    hijasVivas: cuantas.get(fila.id) ?? 0,
  }));
}

/** Un área viva de ESTE negocio (en un tablero que la persona alcanza y no está archivado), o error. */
async function areaDelNegocio(contexto: ContextoTablero, areaId: unknown) {
  const id = typeof areaId === "string" ? areaId.trim() : "";
  const fila = id
    ? await prisma.tarjetaTablero.findFirst({
        where: {
          id,
          ...NO_BORRADA,
          tablero: contexto.soloDe
            ? { workspaceId: contexto.workspaceId, duenoUserId: contexto.soloDe }
            : { workspaceId: contexto.workspaceId },
        },
        select: { id: true, titulo: true, tipoId: true, tableroId: true },
      })
    : null;
  if (!fila) throw new Error("No existe esa área en este tablero (o está borrada).");
  // listarTipos vuelve a revisar el alcance y que el tablero no esté archivado.
  const { tipos } = await listarTipos(contexto, fila.tableroId);
  if (!idsDeTiposDeArea(tipos).has(fila.tipoId)) {
    throw new Error(`«${fila.titulo}» no es un área: se organiza desde el tablero.`);
  }
  return { area: fila, tipos };
}

/** El `orden` para dejar un área de última entre las áreas que cuelgan de `padreId` (null = la raíz). */
function ordenAlFinal(areas: readonly AreaVista[], padreId: string | null, salvo?: string) {
  const hermanas = areas.filter((area) => area.padreId === padreId && area.id !== salvo);
  return hermanas.length ? Math.max(...hermanas.map((area) => area.orden)) + 1 : 0;
}

/** Las áreas del tablero para la ventana, y el tipo con que se crean (null si el tablero no tiene). */
export async function listarAreas(contexto: ContextoTablero, tableroId: unknown) {
  const { tablero, tipos } = await listarTipos(contexto, tableroId);
  const tipo = tipoAreaDelTablero(tipos);
  return {
    tablero,
    tipoArea: tipo ? { id: tipo.id, nombre: tipo.nombre } : null,
    areas: await areasDelTablero(tablero.id, tipos),
  };
}

/** Crea un área (de última entre sus hermanas) en la raíz o dentro de otra área del mismo tablero. */
export async function crearArea(contexto: ContextoTablero, tableroId: unknown, titulo: unknown, padreId: unknown) {
  const { tablero, tipos } = await listarTipos(contexto, tableroId);
  const tipo = tipoAreaDelTablero(tipos);
  if (!tipo) throw new Error(SIN_TIPO_AREA);
  const madreId = typeof padreId === "string" && padreId.trim() ? padreId.trim() : null;
  if (madreId) {
    const { area: madre } = await areaDelNegocio(contexto, madreId);
    if (madre.tableroId !== tablero.id) throw new Error("El área madre tiene que ser del mismo tablero.");
  }
  const areas = await areasDelTablero(tablero.id, tipos);
  return crearTarjeta(contexto, {
    tableroId: tablero.id,
    titulo,
    tipo: tipo.id,
    padreId: madreId,
    orden: ordenAlFinal(areas, madreId),
  });
}

export async function renombrarArea(contexto: ContextoTablero, areaId: unknown, titulo: unknown) {
  const { area } = await areaDelNegocio(contexto, areaId);
  return editarTarjeta(contexto, area.id, { titulo });
}

/**
 * Cambia la madre de un área (otra área del tablero, o null para dejarla en la raíz) y la deja de última ahí.
 * Los permisos y los ciclos (meterla dentro de su propia hija) los revisa editarTarjeta con puedeColgar.
 */
export async function moverArea(contexto: ContextoTablero, areaId: unknown, padreId: unknown) {
  const { area, tipos } = await areaDelNegocio(contexto, areaId);
  const madreId = typeof padreId === "string" && padreId.trim() ? padreId.trim() : null;
  if (madreId) {
    const { area: madre } = await areaDelNegocio(contexto, madreId);
    if (madre.tableroId !== area.tableroId) throw new Error("El área madre tiene que ser del mismo tablero.");
  }
  const areas = await areasDelTablero(area.tableroId, tipos);
  const actual = areas.find((cual) => cual.id === area.id);
  if (actual && actual.padreId === madreId) throw new Error("No hay nada distinto para cambiar.");
  return editarTarjeta(contexto, area.id, { padreId: madreId, orden: ordenAlFinal(areas, madreId, area.id) });
}

/** Sube o baja un área un puesto entre sus hermanas; escribe (con editarTarjeta) solo las que cambian de orden. */
export async function ordenarArea(contexto: ContextoTablero, areaId: unknown, direccion: unknown) {
  if (direccion !== "subir" && direccion !== "bajar") throw new Error('La dirección va "subir" o "bajar".');
  const { area, tipos } = await areaDelNegocio(contexto, areaId);
  const areas = await areasDelTablero(area.tableroId, tipos);
  const padreId = areas.find((cual) => cual.id === area.id)?.padreId ?? null;
  const cambios = ordenAlMover(
    areas.filter((cual) => cual.padreId === padreId),
    area.id,
    direccion,
  );
  if (!cambios.length) throw new Error(direccion === "subir" ? "El área ya está de primera." : "El área ya está de última.");
  for (const cambio of cambios) await editarTarjeta(contexto, cambio.id, { orden: cambio.orden });
  return { cambios };
}

export const subirArea = (contexto: ContextoTablero, areaId: unknown) => ordenarArea(contexto, areaId, "subir");
export const bajarArea = (contexto: ContextoTablero, areaId: unknown) => ordenarArea(contexto, areaId, "bajar");

/**
 * Borra un área VACÍA (borrado suave de siempre, con su historial: se deshace como cualquier tarjeta). Si tiene
 * tarjetas adentro (de cualquier tipo, vivas) no se borra: primero hay que moverlas o borrarlas.
 */
export async function borrarArea(contexto: ContextoTablero, areaId: unknown) {
  const { area } = await areaDelNegocio(contexto, areaId);
  const hijas = await prisma.tarjetaTablero.count({ where: { padreId: area.id, ...NO_BORRADA } });
  if (hijas > 0) {
    throw new Error(
      `Tiene ${hijas} ${hijas === 1 ? "tarjeta" : "tarjetas"} adentro: muévelas a otra área o bórralas antes de borrar «${area.titulo}».`,
    );
  }
  return borrarTarjeta(contexto, area.id);
}
