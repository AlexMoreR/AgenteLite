import { Prisma, type EstadoTarjeta } from "@prisma/client";

import { leerAreasDeTarjetas } from "@/features/alertas/servicios/alertas";
import { prisma } from "@/lib/prisma";
import {
  TIPOS_POR_DEFECTO,
  claveDeNombre,
  colorDeEntrada,
  elegirMiembro,
  elegirTipo,
  esEstado,
  estadoAlCrear,
  estadoPermitidoParaTipo,
  estadoTrasCambiarTipo,
  estadoTrasEditar,
  fechaDeEntrada,
  hijasQueQuedanMal,
  iconoDeEntrada,
  linkDeEntrada,
  personaPuedeAprobar,
  puedeBorrarTarjeta,
  puedeBorrarTipo,
  puedeCambiarAprobacionDelTipo,
  puedeCambiarEstadosDelTipo,
  puedeCambiarEstado,
  puedeColgar,
  puedeDeshacer,
  puedeEditarTarjeta,
  sePuedeMarcarHechoAMano,
  soloCambiaResponsable,
  tieneAprobacion,
  ESTADOS_CON_APROBACION,
  codigoDeTarjeta,
  problemaDelNombreDeTablero,
  textoLimpio,
  type AccionCambio,
  type EstadoTarjetaTablero,
  type MadresPermitidas,
  type MiembroDelNegocio,
  type OrigenCambio,
} from "./reglas";
import {
  dependenciaHaceCiclo,
  esDuenoDelNegocio,
  esHechoAMano,
  esperaASusPartes,
  esRepo,
  estadoAlPonerRepo,
  motivoNoEsDueno,
  partidaDelResultado,
  puedeAprobarMomento,
  ALCANCE_SISTEMAS,
  puedeCerrarComoFallida,
  puedeCambiarZonas,
  puedeMarcarHechoAMano,
  registroDeAprobacion,
  registroDeCierreComoFallida,
  registroDeHechoAMano,
  repoDeEntrada,
  textoDeAprobarEnPantalla,
  textoDeConfirmacionParaBorrar,
  unirZonas,
  zonasDeEntrada,
  zonasQueEsperanLaPantalla,
  type CuentaQueAprueba,
  type MomentoDeAprobacion,
  type PersonaQueAprueba,
  type ViaDeAprobacion,
} from "./reglas-trabajador";
import {
  frase,
  motivoDeRiesgoDeEntrada,
  motivosDeRiesgoAlto,
  problemaDelRiesgo,
  riesgoDeEntrada,
  type QuienPoneRiesgo,
} from "./reglas-riesgo";
import { cerrarLaMadreDeLaParte } from "./madre-partida";
import { NOMBRE_AUTOMATICO, QUIEN_AUTOMATICO, aprobarSolaLaTarea, type ResultadoDeAprobarSola } from "./aprobacion-automatica";
import { contadoresDelConteo, type Contadores } from "./niveles";

/*
  TABLERO IA (tableros inteligentes): la lógica compartida entre el MCP (Claude) y la pantalla (el dueño).

  Tres cosas en cada escritura, en UNA transacción:
  1. la tarjeta (o la conexión, o el tipo),
  2. su fila en HistorialTarjeta (quién, cuándo, desde dónde, antes y después),
  3. `TableroInteligente.actualizadoEn`, que es lo único que lee el refresco de 5 s de la pantalla.

  El negocio sale SIEMPRE del contexto (la clave MCP o la sesión), nunca de un argumento: cada id que
  llega se busca dentro de ese negocio. Las reglas de qué se puede están en reglas.ts.

  Tipos de tarjeta: cada tablero tiene los suyos (nace con Área, Idea y Tarea). Una tarjeta tiene un
  tipo, puede colgar de una tarjeta madre (padreId) y puede llevar un link.

  Borrado SUAVE: borrar_tarjeta marca `borradoEn` (el historial tiene ON DELETE CASCADE a la
  tarjeta: un borrado físico lo perdería) y quita sus flechas guardándolas en el historial para
  poder deshacerlo. TODA lectura de tarjetas filtra `borradoEn: null` (NO_BORRADA), salvo el
  historial y el deshacer.

  Fase 2 (20-oct-2026): el Coordinador (services/trabajador.ts, con su clave) toma las tarjetas con repo
  y las lleva por PLANEANDO -> PLAN_LISTO -> EN_CURSO -> POR_REVISAR -> SUBIENDO -> HECHO (o ERROR).
  Aprobar (la tarea, el plan o el sí final) pasa SIEMPRE por `aprobarTarjeta` con su momento; quién
  puede y desde qué estado lo dice reglas-trabajador.ts. Cada tarjeta lleva repo, plan, resultado,
  zona protegida y el candado del Coordinador (trabajoIniciadoEn / trabajoVenceEn).
*/

/*
  Tableros POR CUENTA (20-oct-2026): cada tablero tiene dueño (duenoUserId). Una persona ve los suyos;
  el dueño del negocio y el ADMIN de la plataforma (personaPuedeAprobar) ven todos, y el MCP también
  (su clave es del negocio). `soloDe` lleva el userId cuando la persona ve solo los suyos, o null.
  El Coordinador no pasa por acá: toma tarjetas de todos los tableros del negocio.
*/
export type Alcance = { workspaceId: string; soloDe: string | null };

export type ContextoTablero = Alcance & { userId: string; origen: OrigenCambio };

/** El alcance de una persona en la pantalla (el userId y el permiso salen de la sesión). */
export function alcanceDe(acceso: { workspaceId: string; userId: string; isOwner: boolean; role: string }): Alcance {
  return { workspaceId: acceso.workspaceId, soloDe: personaPuedeAprobar(acceso) ? null : acceso.userId };
}

/** Todo el negocio: el MCP y quien ya se sabe que ve todo. */
export const todoElNegocio = (workspaceId: string): Alcance => ({ workspaceId, soloDe: null });

/** El filtro de los tableros que alcanza: los del negocio y, si `soloDe`, solo los de esa persona. */
function dondeTablero(alcance: Alcance): Prisma.TableroInteligenteWhereInput {
  return alcance.soloDe
    ? { workspaceId: alcance.workspaceId, duenoUserId: alcance.soloDe }
    : { workspaceId: alcance.workspaceId };
}

export const LIMITE_TABLEROS = 50;
export const LIMITE_TARJETAS = 300;
export const LIMITE_TIPOS = 30;
const MAX_TITULO = 200;
const MAX_DETALLE = 5000;
const MAX_AREA = 60;
const MAX_NOMBRE_TIPO = 40;
const MAX_LINK_TEXTO = 80;

const URL_APP = "https://app.aizenbot.com";
export const RUTA_TABLEROS = "/cliente/tablero-ia";

/** Abre el tablero de la tarjeta, en el nivel de su madre, con su ficha a la vista. */
export function linkDeLaTarjeta(tarjetaId: string) {
  return `${URL_APP}${RUTA_TABLEROS}?tarjeta=${encodeURIComponent(tarjetaId)}`;
}

/** Abre el tablero ya filtrado en lo de hoy (lo que terminó, falló o espera al dueño): el link de los avisos. */
export function linkDeHoy() {
  return `${URL_APP}${RUTA_TABLEROS}?vista=hoy`;
}

/** Abre el tablero en la pestaña "Coordinador en vivo". */
export function linkDelCoordinador() {
  return `${URL_APP}${RUTA_TABLEROS}?vista=coordinador`;
}

export function linkDelTablero(tableroId: string) {
  return `${URL_APP}${RUTA_TABLEROS}?tablero=${encodeURIComponent(tableroId)}`;
}

const NO_BORRADA = { borradoEn: null } as const;

/** Lo que la pantalla necesita de cada tarjeta (también es lo que viaja en el refresco). */
export type TarjetaVista = {
  id: string;
  /** Número corto de la tarjeta y su código ("T-123"); vacío si no tiene número. */
  numero: number | null;
  codigo: string;
  titulo: string;
  detalle: string;
  area: string | null;
  estado: EstadoTarjetaTablero;
  orden: number;
  fecha: string | null;
  tipoId: string;
  padreId: string | null;
  link: string | null;
  linkTexto: string | null;
  actualizadoEn: string;
  /** Fase 2: en qué repo trabaja el Coordinador (null = no la ejecuta el Coordinador). */
  repo: string | null;
  plan: string | null;
  resultado: ResultadoVista | null;
  zonaProtegida: string[];
  /** BAJO | ALTO (sin riesgo cuenta como ALTO), el motivo en una frase y quién lo puso (CLAUDE | TRABAJADOR | DUENO). */
  riesgo: string | null;
  riesgoMotivo: string | null;
  riesgoPor: string | null;
  intentos: number;
  /** Reparaciones seguidas (tope 3): "Reparación N de 3" mientras espera en la fila. */
  reparaciones: number;
  trabajoVenceEn: string | null;
  /** A quién se le asignó (un miembro activo del negocio) y su nombre; null si no tiene responsable. */
  responsableId: string | null;
  responsableNombre: string | null;
};

/** El resultado del Coordinador como lo ve la pantalla (todo opcional: lo escribe el Coordinador). */
export type ResultadoVista = {
  resumen?: string;
  pruebas?: string;
  paso?: boolean;
  rama?: string | null;
  linkRama?: string | null;
  commit?: string | null;
  migracion?: string | null;
  /** El Coordinador la quiso subir sola (subirSolo prendido). */
  subeSolo?: boolean;
  /** Por qué espera tu sí aunque su zona suba sola (p. ej. "gasto en Meta Ads"). */
  esperaPor?: string;
  /** Qué modelo hizo cada paso (plan, construir, revisar, subagentes). */
  modelo?: Partial<Record<"plan" | "construir" | "revisar" | "subagentes", string>>;
  /** Dónde se construyó (25-oct-2026): "aizen1" o "nube" (`claude --cloud`), y el link de la sesión de la nube. */
  construidoEn?: "aizen1" | "nube";
  linkSesion?: string | null;
  /** La corrida de GitHub Actions que probó la rama (github.com) y dónde se compiló y probó. */
  linkWorkflow?: string | null;
  verificadoEn?: "github-actions" | "aizen1" | "nube";
  /** Mientras se construye (EN_CURSO): dónde y la sesión, como lo avisa el latido. */
  construccion?: { lugar?: "aizen1" | "nube"; linkSesion?: string | null };
  subida?: {
    commit?: string | null;
    version?: string | null;
    linkCommit?: string | null;
    cuando?: string;
    /** Zona que sube sola: lo que vigiló el Coordinador después de subir ("Subió sola (zona X) — vigilancia 30 min OK"). */
    vigilancia?: { zona?: string; minutos?: number; ok?: boolean };
    resumenVigilancia?: string;
  };
  /** Si el Coordinador la partió: las tarjetas hijas (ids), la causa y cuándo. */
  partida?: { hijas?: string[]; causa?: string; cuando?: string };
  error?: {
    motivo?: string;
    en?: string;
    cuando?: string;
    /** Si el Coordinador escaló después de reparar: la categoría y la causa en una línea. */
    categoria?: string;
    causa?: string;
    /** El despliegue falló después de subir: el Coordinador hizo revert del commit en main. */
    reversion?: { commit?: string | null; revert?: string | null; ok?: boolean };
  };
};

/** `esDependencia`: el destino depende del origen y no se toma hasta que el origen esté HECHO. */
export type ConexionVista = { id: string; origenId: string; destinoId: string; esDependencia: boolean };

/** Un tipo de tarjeta con sus madres permitidas (ids de tipo). */
export type TipoVista = {
  id: string;
  nombre: string;
  color: string;
  icono: string | null;
  requiereAprobacion: boolean;
  /** false = carpeta (Área): sus tarjetas no tienen estado. */
  usaEstados: boolean;
  orden: number;
  padres: string[];
};

/** Lo que muestra el selector de tableros de la barra superior. */
export type TableroResumen = {
  id: string;
  nombre: string;
  porAprobar: number;
  /** Todas las tarjetas vivas del tablero (también las carpetas, como Área). */
  tarjetas: number;
  duenoUserId: string | null;
  /** El nombre del dueño ("Emanuel Diaz"), o null si no tiene. */
  duenoNombre: string | null;
};

/** Un tablero en la página de inicio de Tablero IA: lo del selector, los contadores y la última actividad. */
export type TableroDelInicio = TableroResumen & { contadores: Contadores; actualizadoEn: string };

/** El numerito del selector: lo que espera una aprobación (la tarea, el plan o el sí final). */
export function porAprobarDe(porEstado: Partial<Record<string, number>>) {
  return (porEstado.POR_APROBAR ?? 0) + (porEstado.PLAN_LISTO ?? 0) + (porEstado.POR_REVISAR ?? 0);
}

const SELECT_TARJETA = {
  id: true,
  numero: true,
  titulo: true,
  detalle: true,
  area: true,
  estado: true,
  orden: true,
  fecha: true,
  tipoId: true,
  padreId: true,
  link: true,
  linkTexto: true,
  actualizadoEn: true,
  repo: true,
  plan: true,
  resultado: true,
  zonaProtegida: true,
  riesgo: true,
  riesgoMotivo: true,
  riesgoPor: true,
  intentos: true,
  reparaciones: true,
  trabajoVenceEn: true,
  responsableId: true,
  responsable: { select: { name: true, email: true } },
} as const;

type FilaTarjeta = Prisma.TarjetaTableroGetPayload<{ select: typeof SELECT_TARJETA }>;

function aVista(fila: FilaTarjeta): TarjetaVista {
  return {
    id: fila.id,
    numero: fila.numero ?? null,
    codigo: codigoDeTarjeta(fila.numero),
    titulo: fila.titulo,
    detalle: fila.detalle,
    area: fila.area,
    estado: fila.estado,
    orden: fila.orden,
    fecha: fila.fecha ? fila.fecha.toISOString() : null,
    tipoId: fila.tipoId,
    padreId: fila.padreId,
    link: fila.link,
    linkTexto: fila.linkTexto,
    actualizadoEn: fila.actualizadoEn.toISOString(),
    repo: fila.repo,
    plan: fila.plan,
    resultado: fila.resultado && typeof fila.resultado === "object" && !Array.isArray(fila.resultado)
      ? (fila.resultado as ResultadoVista)
      : null,
    zonaProtegida: fila.zonaProtegida,
    riesgo: fila.riesgo,
    riesgoMotivo: fila.riesgoMotivo,
    riesgoPor: fila.riesgoPor,
    intentos: fila.intentos,
    reparaciones: fila.reparaciones,
    trabajoVenceEn: fila.trabajoVenceEn ? fila.trabajoVenceEn.toISOString() : null,
    responsableId: fila.responsableId,
    responsableNombre: fila.responsable ? nombreDePersona(fila.responsable) : null,
  };
}

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

async function anotar(
  tx: Tx,
  contexto: ContextoTablero,
  tarjetaId: string,
  accion: AccionCambio,
  antes: Record<string, unknown> | null,
  despues: Record<string, unknown> | null,
) {
  return tx.historialTarjeta.create({
    data: {
      tarjetaId,
      quien: contexto.userId,
      origen: contexto.origen,
      accion,
      antes: antes === null ? Prisma.DbNull : (antes as Prisma.InputJsonValue),
      despues: despues === null ? Prisma.DbNull : (despues as Prisma.InputJsonValue),
    },
    select: { id: true },
  });
}

async function tocarTablero(tx: Tx, tableroId: string) {
  await tx.tableroInteligente.update({ where: { id: tableroId }, data: { actualizadoEn: new Date() } });
}

/** Un tablero de ESTE negocio que la persona alcanza, o error. */
async function tableroDelNegocio(alcance: Alcance, tableroId: unknown) {
  const id = typeof tableroId === "string" ? tableroId.trim() : "";
  const tablero = id
    ? await prisma.tableroInteligente.findFirst({ where: { id, ...dondeTablero(alcance) }, select: SELECT_REFERENCIA })
    : null;
  if (!tablero) {
    throw new Error("No existe ese tablero en este negocio. Ver listar_tableros para los ids.");
  }
  return aReferencia(tablero);
}

/** Lo que se dice de un tablero en cada respuesta del MCP: id, nombre y de quién es. */
const SELECT_REFERENCIA = { id: true, nombre: true, dueno: { select: { name: true, email: true } } } as const;

function aReferencia(fila: Prisma.TableroInteligenteGetPayload<{ select: typeof SELECT_REFERENCIA }>): TableroDeReferencia {
  return { id: fila.id, nombre: fila.nombre, duenoNombre: fila.dueno ? nombreDePersona(fila.dueno) : null };
}

const nombreDePersona = (persona: { name: string | null; email: string }) => persona.name?.trim() || persona.email;

/**
 * Una tarjeta (no borrada) de ESTE negocio (por su tablero, que la persona alcanza), o error.
 * `comoResponsable` es SOLO para leer (ficha, historial, intentos): deja ver también la tarjeta que le
 * asignaron a la persona en un tablero que no es suyo. Para escribir nunca se usa: el responsable no edita.
 */
async function tarjetaDelNegocio(
  alcance: Alcance,
  tarjetaId: unknown,
  { incluirBorradas = false, comoResponsable = false } = {},
) {
  const id = typeof tarjetaId === "string" ? tarjetaId.trim() : "";
  const donde: Prisma.TarjetaTableroWhereInput =
    comoResponsable && alcance.soloDe
      ? {
          OR: [
            { tablero: dondeTablero(alcance) },
            { responsableId: alcance.soloDe, tablero: { workspaceId: alcance.workspaceId } },
          ],
        }
      : { tablero: dondeTablero(alcance) };
  const tarjeta = id
    ? await prisma.tarjetaTablero.findFirst({
        where: { id, ...donde, ...(incluirBorradas ? {} : NO_BORRADA) },
        select: { ...SELECT_TARJETA, tableroId: true, borradoEn: true },
      })
    : null;
  if (!tarjeta) {
    throw new Error("No existe esa tarjeta en este negocio. Ver ver_tablero para los ids.");
  }
  return tarjeta;
}

/** Fecha en JSON del historial (ISO) para poder restaurarla. */
const isoONull = (fecha: Date | null | undefined) => (fecha ? fecha.toISOString() : null);

// ── Tipos: lectura y ayudas ─────────────────────────────────────────────────────────────────

const SELECT_TIPO = {
  id: true,
  nombre: true,
  color: true,
  icono: true,
  requiereAprobacion: true,
  usaEstados: true,
  orden: true,
  padres: { select: { tipoPadreId: true } },
} as const;

type FilaTipo = Prisma.TipoTarjetaGetPayload<{ select: typeof SELECT_TIPO }>;

function tipoAVista(fila: FilaTipo): TipoVista {
  return {
    id: fila.id,
    nombre: fila.nombre,
    color: fila.color,
    icono: fila.icono,
    requiereAprobacion: fila.requiereAprobacion,
    usaEstados: fila.usaEstados,
    orden: fila.orden,
    padres: fila.padres.map((padre) => padre.tipoPadreId),
  };
}

async function tiposDelTablero(db: Db, tableroId: string): Promise<TipoVista[]> {
  const filas = await db.tipoTarjeta.findMany({
    where: { tableroId },
    orderBy: [{ orden: "asc" }, { creadoEn: "asc" }],
    select: SELECT_TIPO,
  });
  return filas.map(tipoAVista);
}

function madresPermitidas(tipos: TipoVista[]): MadresPermitidas {
  return new Map(tipos.map((tipo) => [tipo.id, new Set(tipo.padres)]));
}

const nombresDeTipos = (tipos: TipoVista[]) => new Map(tipos.map((tipo) => [tipo.id, tipo.nombre]));

/** El padreId de cada tarjeta viva del tablero (para buscar ciclos). */
async function madresDelTablero(tableroId: string) {
  const filas = await prisma.tarjetaTablero.findMany({
    where: { tableroId, ...NO_BORRADA },
    select: { id: true, padreId: true },
  });
  return new Map(filas.map((fila) => [fila.id, fila.padreId]));
}

/** Una madre viva del mismo tablero, o error. */
async function madreDelTablero(tableroId: string, padreId: string) {
  const madre = await prisma.tarjetaTablero.findFirst({
    where: { id: padreId, tableroId, ...NO_BORRADA },
    select: { id: true, tipoId: true, tableroId: true, titulo: true },
  });
  if (!madre) {
    throw new Error("No existe esa tarjeta madre en este tablero (o está borrada). Ver ver_tablero para los ids.");
  }
  return madre;
}

/** padre_id como lo manda Claude: id, o "" / null para quitarla. Undefined = no vino. */
function padreDeEntrada(valor: unknown): string | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  if (typeof valor !== "string") throw new Error("padre_id va como texto: el id de la tarjeta madre.");
  return valor.trim() || null;
}

/** Revisa que `hija` (con su tipo final) pueda colgar de `padreId`. */
async function revisarMadre(
  hija: { id: string; tipoId: string; tableroId: string },
  padreId: string,
  tipos: TipoVista[],
) {
  const madre = await madreDelTablero(hija.tableroId, padreId);
  const veredicto = puedeColgar(
    hija,
    madre,
    madresPermitidas(tipos),
    hija.id ? await madresDelTablero(hija.tableroId) : new Map(),
    nombresDeTipos(tipos),
  );
  if (veredicto) throw new Error(veredicto);
  return madre;
}

/** Revisa que las hijas vivas de la tarjeta sigan pudiendo colgar de ella con el tipo nuevo. */
async function revisarHijas(tarjetaId: string, tipoNuevoId: string, tipos: TipoVista[]) {
  const hijas = await prisma.tarjetaTablero.findMany({
    where: { padreId: tarjetaId, ...NO_BORRADA },
    select: { id: true, tipoId: true, titulo: true },
  });
  const veredicto = hijasQueQuedanMal(tipoNuevoId, hijas, madresPermitidas(tipos));
  if (veredicto) throw new Error(veredicto);
}

// ── Lectura ─────────────────────────────────────────────────────────────────────────────────

/** Los tableros que la persona alcanza, con su dueño y sus contadores. */
export async function listarTableros(alcance: Alcance) {
  const filas = await prisma.tableroInteligente.findMany({
    where: dondeTablero(alcance),
    orderBy: { creadoEn: "asc" },
    select: {
      id: true,
      nombre: true,
      creadoEn: true,
      actualizadoEn: true,
      duenoUserId: true,
      dueno: { select: { name: true, email: true } },
    },
  });
  const tableros = filas.map(({ dueno, ...tablero }) => ({
    ...tablero,
    duenoNombre: dueno ? nombreDePersona(dueno) : null,
  }));
  if (!tableros.length) {
    return [];
  }
  const ids = tableros.map((tablero) => tablero.id);
  const [conteos, todas, tipos] = await Promise.all([
    prisma.tarjetaTablero.groupBy({
      by: ["tableroId", "estado", "tipoId"],
      // Las carpetas (tipos sin estados, como Área) no cuentan en los estados.
      where: { tableroId: { in: ids }, ...NO_BORRADA, tipo: { usaEstados: true } },
      _count: { _all: true },
    }),
    prisma.tarjetaTablero.groupBy({
      by: ["tableroId"],
      where: { tableroId: { in: ids }, ...NO_BORRADA },
      _count: { _all: true },
    }),
    // Para los contadores: un POR_APROBAR solo "te toca" si su tipo pide aprobación.
    prisma.tipoTarjeta.findMany({
      where: { tableroId: { in: ids } },
      select: { id: true, usaEstados: true, requiereAprobacion: true },
    }),
  ]);
  const tarjetasDe = new Map(todas.map((fila) => [fila.tableroId, fila._count._all]));
  return tableros.map((tablero) => {
    const porEstado: Partial<Record<EstadoTarjetaTablero, number>> = {};
    let total = 0;
    const filas = conteos.filter((fila) => fila.tableroId === tablero.id);
    for (const fila of filas) {
      porEstado[fila.estado] = (porEstado[fila.estado] ?? 0) + fila._count._all;
      total += fila._count._all;
    }
    // Los mismos contadores que los chips del diagrama en la raíz (página de inicio).
    const contadores = contadoresDelConteo(
      filas.map((fila) => ({ estado: fila.estado, tipoId: fila.tipoId, cantidad: fila._count._all })),
      tipos,
    );
    return { ...tablero, total, porEstado, contadores, tarjetas: tarjetasDe.get(tablero.id) ?? 0 };
  });
}

/** Un tablero de listarTableros como lo muestran el inicio y el selector (también viaja en el refresco). */
export function aTableroDelInicio(tablero: Awaited<ReturnType<typeof listarTableros>>[number]): TableroDelInicio {
  return {
    id: tablero.id,
    nombre: tablero.nombre,
    porAprobar: porAprobarDe(tablero.porEstado),
    tarjetas: tablero.tarjetas,
    duenoUserId: tablero.duenoUserId,
    duenoNombre: tablero.duenoNombre,
    contadores: tablero.contadores,
    actualizadoEn: tablero.actualizadoEn.toISOString(),
  };
}

/**
 * La firma de la lista de tableros: la hora del último cambio y cuántos son. Cambia con cualquier
 * escritura en un tablero (todas tocan su actualizadoEn), con uno nuevo y con uno que se va.
 */
function armarFirma(ultimoCambio: Date | null, cuantos: number) {
  return `${ultimoCambio ? ultimoCambio.toISOString() : "-"}|${cuantos}`;
}

/** La firma de una lista ya leída (listarTableros): la que lleva la pantalla al cargarse. */
export function firmaDeLaLista(tableros: { actualizadoEn: Date }[]) {
  const ultimo = tableros.reduce<Date | null>(
    (ultima, tablero) => (!ultima || tablero.actualizadoEn > ultima ? tablero.actualizadoEn : ultima),
    null,
  );
  return armarFirma(ultimo, tableros.length);
}

/** Lo único que lee el refresco de 5 s de la lista cuando no cambió nada: un agregado indexado por negocio. */
export async function firmaDeLosTableros(alcance: Alcance) {
  const fila = await prisma.tableroInteligente.aggregate({
    where: dondeTablero(alcance),
    _max: { actualizadoEn: true },
    _count: { _all: true },
  });
  return armarFirma(fila._max.actualizadoEn, fila._count._all);
}

/** Tarjetas (vivas), conexiones y tipos de un tablero que ya se sabe que es del negocio. */
export async function contenidoDelTablero(tableroId: string) {
  const [tarjetas, conexiones, tipos] = await Promise.all([
    prisma.tarjetaTablero.findMany({
      where: { tableroId, ...NO_BORRADA },
      orderBy: [{ orden: "asc" }, { creadoEn: "asc" }],
      select: SELECT_TARJETA,
    }),
    prisma.conexionTarjeta.findMany({
      where: { tableroId },
      orderBy: { creadoEn: "asc" },
      select: { id: true, origenId: true, destinoId: true, esDependencia: true },
    }),
    tiposDelTablero(prisma, tableroId),
  ]);
  // Las flechas de una borrada se quitan al borrar; este filtro es por si acaso.
  const vivas = new Set(tarjetas.map((tarjeta) => tarjeta.id));
  return {
    tarjetas: tarjetas.map(aVista),
    conexiones: (conexiones as ConexionVista[]).filter((c) => vivas.has(c.origenId) && vivas.has(c.destinoId)),
    tipos,
  };
}

export async function verTablero(alcance: Alcance, tableroId: unknown) {
  const tablero = await tableroDelNegocio(alcance, tableroId);
  return { tablero, ...(await contenidoDelTablero(tablero.id)) };
}

export async function listarTipos(alcance: Alcance, tableroId: unknown) {
  const tablero = await tableroDelNegocio(alcance, tableroId);
  const [tipos, usos] = await Promise.all([
    tiposDelTablero(prisma, tablero.id),
    prisma.tarjetaTablero.groupBy({ by: ["tipoId"], where: { tableroId: tablero.id, ...NO_BORRADA }, _count: { _all: true } }),
  ]);
  const cuantas = new Map(usos.map((fila) => [fila.tipoId, fila._count._all]));
  return { tablero, tipos: tipos.map((tipo) => ({ ...tipo, tarjetas: cuantas.get(tipo.id) ?? 0 })) };
}

/** Lo único que lee el refresco de 5 s: una fila por clave primaria. */
export async function firmaDelTablero(alcance: Alcance, tableroId: string) {
  const fila = await prisma.tableroInteligente.findFirst({
    where: { id: tableroId, ...dondeTablero(alcance) },
    select: { actualizadoEn: true },
  });
  return fila?.actualizadoEn ?? null;
}

export type TableroDeReferencia = { id: string; nombre: string; duenoNombre: string | null };

/*
  A qué tablero pertenece algo (para que el MCP diga el nombre del tablero y de quién es en cada
  respuesta, y Claude no confunda dos tableros por voz). Incluyen las tarjetas borradas; null si no es
  de este negocio (o la persona no lo alcanza).
*/
export async function tableroDeLaTarjeta(alcance: Alcance, tarjetaId: unknown): Promise<TableroDeReferencia | null> {
  const id = typeof tarjetaId === "string" ? tarjetaId.trim() : "";
  if (!id) return null;
  const fila = await prisma.tarjetaTablero.findFirst({
    where: { id, tablero: dondeTablero(alcance) },
    select: { tablero: { select: SELECT_REFERENCIA } },
  });
  return fila ? aReferencia(fila.tablero) : null;
}

/**
 * Si lo que llega es el código de una tarjeta ("T-123", en mayúscula o minúscula), devuelve su id real; todo lo
 * demás (un id, vacío, un código que no existe en el negocio) vuelve igual para que falle o siga como siempre.
 */
export async function idDeTarjetaPorCodigo(alcance: Alcance, valor: unknown): Promise<unknown> {
  const texto = typeof valor === "string" ? valor.trim() : "";
  const partes = /^T-(\d{1,9})$/i.exec(texto);
  if (!partes) return valor;
  const fila = await prisma.tarjetaTablero.findFirst({
    where: { numero: Number(partes[1]), tablero: dondeTablero(alcance) },
    select: { id: true },
  });
  return fila ? fila.id : valor;
}

/** El código ("T-123") de una tarjeta por su id, para las respuestas que no traen la tarjeta; "" si no tiene. */
export async function codigoDeLaTarjeta(alcance: Alcance, tarjetaId: unknown): Promise<string> {
  const id = typeof tarjetaId === "string" ? tarjetaId.trim() : "";
  if (!id) return "";
  const fila = await prisma.tarjetaTablero.findFirst({
    where: { id, tablero: dondeTablero(alcance) },
    select: { numero: true },
  });
  return fila ? codigoDeTarjeta(fila.numero) : "";
}

export async function tableroDelTipo(alcance: Alcance, tipoId: unknown): Promise<TableroDeReferencia | null> {
  const id = typeof tipoId === "string" ? tipoId.trim() : "";
  if (!id) return null;
  const fila = await prisma.tipoTarjeta.findFirst({
    where: { id, tablero: dondeTablero(alcance) },
    select: { tablero: { select: SELECT_REFERENCIA } },
  });
  return fila ? aReferencia(fila.tablero) : null;
}

export async function tableroDelCambio(alcance: Alcance, cambioId: unknown): Promise<TableroDeReferencia | null> {
  const id = typeof cambioId === "string" ? cambioId.trim() : "";
  if (!id) return null;
  const fila = await prisma.historialTarjeta.findFirst({
    where: { id, tarjeta: { tablero: dondeTablero(alcance) } },
    select: { tarjeta: { select: { tablero: { select: SELECT_REFERENCIA } } } },
  });
  return fila ? aReferencia(fila.tarjeta.tablero) : null;
}

/** Incluye las borradas: así se encuentra el cambio "borrar" para deshacerlo. */
export async function historialDeTarjeta(alcance: Alcance, tarjetaId: unknown) {
  const tarjeta = await tarjetaDelNegocio(alcance, tarjetaId, { incluirBorradas: true, comoResponsable: true });
  const filas = await prisma.historialTarjeta.findMany({
    where: { tarjetaId: tarjeta.id },
    orderBy: { creadoEn: "desc" },
    take: 100,
    select: { id: true, quien: true, origen: true, accion: true, antes: true, despues: true, deshechoEn: true, creadoEn: true },
  });
  const nombre = await nombresDeQuien(filas.map((fila) => fila.quien));
  return {
    tarjeta: aVista(tarjeta),
    borrada: Boolean(tarjeta.borradoEn),
    cambios: filas.map((fila) => ({ ...fila, quienNombre: nombre.get(fila.quien) ?? "Alguien" })),
  };
}

/** Prefijo de `HistorialTarjeta.quien` cuando el cambio lo hizo el Coordinador (sigue el id de su clave). */
export const QUIEN_TRABAJADOR = "trabajador:";

/** El nombre de cada `quien` del historial: una persona, o "Coordinador (<nombre de la clave>)". */
async function nombresDeQuien(quienes: string[]) {
  const unicos = [...new Set(quienes)];
  const claves = unicos.filter((quien) => quien.startsWith(QUIEN_TRABAJADOR)).map((quien) => quien.slice(QUIEN_TRABAJADOR.length));
  const ids = unicos.filter((quien) => !quien.startsWith(QUIEN_TRABAJADOR) && quien !== QUIEN_AUTOMATICO);
  const [personas, trabajadores] = await Promise.all([
    ids.length ? prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [],
    claves.length ? prisma.claveTrabajador.findMany({ where: { id: { in: claves } }, select: { id: true, nombre: true } }) : [],
  ]);
  return new Map([
    ...personas.map((persona) => [persona.id, persona.name?.trim() || persona.email || "Alguien"] as const),
    ...trabajadores.map((clave) => [`${QUIEN_TRABAJADOR}${clave.id}`, `Coordinador (${clave.nombre})`] as const),
    [QUIEN_AUTOMATICO, NOMBRE_AUTOMATICO] as const,
  ]);
}

/** Las aprobaciones de una tarjeta (del historial): quién aprobó qué, cuándo y por dónde. */
export type AprobacionVista = {
  momento: string;
  via: string;
  quien: string;
  cuando: string;
  textoConfirmacion: string | null;
  estado: string | null;
  /** Aprobada sola por la regla de bajo riesgo, y el motivo que quedó anotado. */
  automatica: boolean;
  motivo: string | null;
};

function aprobacionesDelHistorial(
  filas: { accion: string; despues: unknown; creadoEn: Date; quienNombre: string; deshechoEn: Date | null }[],
): AprobacionVista[] {
  return filas
    .filter((fila) => fila.accion === "aprobar" && !fila.deshechoEn)
    .map((fila) => {
      const despues = (fila.despues ?? {}) as Record<string, unknown>;
      return {
        // Las de la fase 1 no tenían momento ni via: eran la tarea, en la pantalla.
        momento: typeof despues.momento === "string" ? despues.momento : "tarea",
        via: typeof despues.via === "string" ? despues.via : "pantalla",
        quien: typeof despues.quienNombre === "string" ? despues.quienNombre : fila.quienNombre,
        cuando: fila.creadoEn.toISOString(),
        textoConfirmacion: typeof despues.textoConfirmacion === "string" ? despues.textoConfirmacion : null,
        estado: typeof despues.estado === "string" ? despues.estado : null,
        automatica: despues.automatica === true,
        motivo: typeof despues.motivo === "string" ? despues.motivo : null,
      };
    });
}

/** Un intento de la tarjeta (algo falló, esperó, se partió o se escaló), como lo ve la pantalla y el MCP. */
export type IntentoVista = {
  numero: number;
  etapa: string;
  categoria: string;
  causa: string;
  /** El error técnico completo (solo para "Detalles técnicos"). */
  error: string | null;
  accion: string;
  cuentaComoIntento: boolean;
  cuando: string;
};

/** Los intentos de una tarjeta, del más viejo al más nuevo (los últimos 50). */
export async function intentosDeLaTarjeta(alcance: Alcance, tarjetaId: unknown): Promise<IntentoVista[]> {
  const tarjeta = await tarjetaDelNegocio(alcance, tarjetaId, { incluirBorradas: true, comoResponsable: true });
  const filas = await prisma.intentoTarjeta.findMany({
    where: { tarjetaId: tarjeta.id },
    orderBy: { numero: "desc" },
    take: 50,
    select: { numero: true, etapa: true, categoria: true, causa: true, error: true, accion: true, cuentaComoIntento: true, creadoEn: true },
  });
  return filas.reverse().map(({ creadoEn, ...fila }) => ({ ...fila, cuando: creadoEn.toISOString() }));
}

/** Una tarjeta asignada a una persona, con el tablero donde está (sección "Asignadas a mí"). */
export type AsignadaVista = {
  id: string;
  titulo: string;
  estado: EstadoTarjetaTablero;
  /** false = carpeta (Área): no tiene estado que mostrar. */
  usaEstados: boolean;
  tipoNombre: string;
  tableroId: string;
  tableroNombre: string;
  /** El link "ir al tablero" solo se muestra si la persona alcanza ese tablero. */
  puedeVerElTablero: boolean;
  actualizadoEn: string;
};

/** Cuántas tarjetas asignadas se muestran como máximo. */
const LIMITE_ASIGNADAS = 100;

/**
 * Las tarjetas vivas del negocio asignadas a esta persona, en cualquier tablero, las que cambiaron
 * hace poco primero. Las que ya están HECHAS no salen: ya no hay nada que trabajar.
 */
export async function asignadasA(alcance: Alcance, userId: string): Promise<AsignadaVista[]> {
  const filas = await prisma.tarjetaTablero.findMany({
    where: {
      responsableId: userId,
      tablero: { workspaceId: alcance.workspaceId },
      ...NO_BORRADA,
      estado: { not: "HECHO" },
    },
    orderBy: { actualizadoEn: "desc" },
    take: LIMITE_ASIGNADAS,
    select: {
      id: true,
      titulo: true,
      estado: true,
      actualizadoEn: true,
      tipo: { select: { nombre: true, usaEstados: true } },
      tablero: { select: { id: true, nombre: true, duenoUserId: true } },
    },
  });
  return filas.map((fila) => ({
    id: fila.id,
    titulo: fila.titulo,
    estado: fila.estado,
    usaEstados: fila.tipo.usaEstados,
    tipoNombre: fila.tipo.nombre,
    tableroId: fila.tablero.id,
    tableroNombre: fila.tablero.nombre,
    puedeVerElTablero: !alcance.soloDe || fila.tablero.duenoUserId === alcance.soloDe,
    actualizadoEn: fila.actualizadoEn.toISOString(),
  }));
}

/**
 * La ficha de una tarjeta que le asignaron a la persona en un tablero que NO alcanza: solo ESA tarjeta
 * y los tipos de su tablero (para dibujarla), nunca el resto del tablero. null si no es suya.
 */
export async function tarjetaAsignada(workspaceId: string, userId: string, tarjetaId: string) {
  const fila = await prisma.tarjetaTablero.findFirst({
    where: { id: tarjetaId, responsableId: userId, tablero: { workspaceId }, ...NO_BORRADA },
    select: { ...SELECT_TARJETA, tablero: { select: { id: true, nombre: true } } },
  });
  if (!fila) return null;
  const { tablero, ...tarjeta } = fila;
  return { tarjeta: aVista(tarjeta), tablero, tipos: await tiposDelTablero(prisma, tablero.id) };
}

/** ver_plan_y_resultado (MCP) y la ficha: estado, repo, plan, resultado, intentos y quién aprobó qué y cuándo. */
export async function planYResultado(alcance: Alcance, tarjetaId: unknown) {
  const { tarjeta, cambios } = await historialDeTarjeta(alcance, tarjetaId);
  const intentos = await intentosDeLaTarjeta(alcance, tarjeta.id);
  // Si la tarjeta está HECHO porque el dueño la marcó a mano, no la subió el Coordinador: se dice.
  const marca = tarjeta.estado === "HECHO" ? cambios.find((cambio) => !cambio.deshechoEn && esHechoAMano(cambio)) : undefined;
  const despues = (marca?.despues ?? {}) as Record<string, unknown>;
  const hechoAMano = marca
    ? {
        nota: typeof despues.nota === "string" ? despues.nota : "",
        commit: typeof despues.commit === "string" ? despues.commit : null,
        quien: typeof despues.quienNombre === "string" ? despues.quienNombre : marca.quienNombre,
        via: typeof despues.via === "string" ? despues.via : "pantalla",
        cuando: marca.creadoEn.toISOString(),
      }
    : null;
  return { tarjeta, aprobaciones: aprobacionesDelHistorial(cambios), hechoAMano, intentos };
}

/** Una tarjeta que espera al dueño ("Te toca a ti"), de cualquier tablero del negocio. */
export type PendienteVista = TarjetaVista & {
  tableroId: string;
  tableroNombre: string;
  tipoNombre: string;
  tipoColor: string;
  tipoIcono: string | null;
  requiereAprobacion: boolean;
};

/**
 * "Te toca a ti": lo que espera una decisión del dueño en TODOS los tableros que la persona alcanza.
 * Las POR_APROBAR (de tipos con aprobación), las del Coordinador que esperan al dueño (PLAN_LISTO,
 * POR_REVISAR, ERROR) y las FALLIDO, de la más vieja a la más nueva.
 */
export async function pendientesDelDueno(alcance: Alcance): Promise<PendienteVista[]> {
  const filas = await prisma.tarjetaTablero.findMany({
    where: {
      ...NO_BORRADA,
      tablero: dondeTablero(alcance),
      OR: [
        { estado: { in: ["POR_APROBAR", "PLAN_LISTO", "POR_REVISAR", "ERROR"] }, tipo: { requiereAprobacion: true, usaEstados: true } },
        { estado: "FALLIDO", tipo: { usaEstados: true } },
      ],
    },
    orderBy: [{ actualizadoEn: "asc" }],
    take: 200,
    select: {
      ...SELECT_TARJETA,
      tablero: { select: { id: true, nombre: true } },
      tipo: { select: { nombre: true, color: true, icono: true, requiereAprobacion: true } },
    },
  });
  return filas.map((fila) => ({
    ...aVista(fila),
    tableroId: fila.tablero.id,
    tableroNombre: fila.tablero.nombre,
    tipoNombre: fila.tipo.nombre,
    tipoColor: fila.tipo.color,
    tipoIcono: fila.tipo.icono,
    requiereAprobacion: fila.tipo.requiereAprobacion,
  }));
}

// ── Escritura: tableros ─────────────────────────────────────────────────────────────────────

/** Los 3 tipos por defecto (Área, Idea, Tarea) y sus madres permitidas, dentro de una transacción. */
async function crearTiposPorDefecto(tx: Tx, tableroId: string) {
  const ids = new Map<string, string>();
  for (const tipo of TIPOS_POR_DEFECTO) {
    const creado = await tx.tipoTarjeta.create({
      data: {
        tableroId,
        nombre: tipo.nombre,
        color: tipo.color,
        icono: tipo.icono,
        requiereAprobacion: tipo.requiereAprobacion,
        usaEstados: tipo.usaEstados,
        orden: tipo.orden,
      },
      select: { id: true },
    });
    ids.set(tipo.nombre, creado.id);
  }
  const padres = TIPOS_POR_DEFECTO.flatMap((tipo) =>
    tipo.padres.map((padre) => ({ tipoId: ids.get(tipo.nombre)!, tipoPadreId: ids.get(padre)! })),
  );
  if (padres.length) await tx.tipoTarjetaPadre.createMany({ data: padres });
}

/** El nombre limpio, o un error si está vacío, es muy largo o ya es de otro tablero del negocio. */
function nombreDeTablero(valor: unknown, existentes: { id: string; nombre: string }[], salvo?: string) {
  const problema = problemaDelNombreDeTablero(valor, existentes, salvo);
  if (problema) {
    throw new Error(problema);
  }
  return String(valor).trim();
}

/** Quién puede ser dueño de un tablero: los miembros activos del negocio. */
export async function miembrosDelNegocio(workspaceId: string): Promise<MiembroDelNegocio[]> {
  const filas = await prisma.workspaceMember.findMany({
    where: { workspaceId, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { userId: true, user: { select: { name: true, email: true } } },
  });
  return filas.map((fila) => ({ userId: fila.userId, nombre: nombreDePersona(fila.user), email: fila.user.email }));
}

const SOLO_EL_DUENO_ELIGE = "De quién es un tablero lo elige solo el dueño del negocio.";

/** El userId del dueño pedido (id, nombre o email de un miembro activo), o undefined si no vino. */
async function duenoDeEntrada(contexto: ContextoTablero, pedido: unknown): Promise<string | undefined> {
  if (pedido === undefined || pedido === null || (typeof pedido === "string" && !pedido.trim())) return undefined;
  // Quien ve solo sus tableros no los regala ni toma los de otro.
  if (contexto.soloDe) throw new Error(SOLO_EL_DUENO_ELIGE);
  const elegido = elegirMiembro(await miembrosDelNegocio(contexto.workspaceId), pedido);
  if ("error" in elegido) throw new Error(elegido.error);
  return elegido.miembro.userId;
}

/**
 * El responsable pedido para una tarjeta: undefined si no vino (no cambia), null si vino vacío (se quita)
 * o la persona (id, nombre o email de un miembro ACTIVO del negocio). Un nombre repetido da error.
 * Asignar lo puede quien edita el tablero: eso ya lo decide `tarjetaDelNegocio` con el alcance.
 */
async function responsableDeEntrada(
  workspaceId: string,
  pedido: unknown,
): Promise<{ userId: string; nombre: string } | null | undefined> {
  if (pedido === undefined) return undefined;
  if (pedido === null || (typeof pedido === "string" && !pedido.trim())) return null;
  const elegido = elegirMiembro(await miembrosDelNegocio(workspaceId), pedido, "responsable");
  if ("error" in elegido) throw new Error(elegido.error);
  return { userId: elegido.miembro.userId, nombre: elegido.miembro.nombre };
}

/**
 * Crea un tablero. Es de quien lo crea, salvo que el dueño del negocio (o el ADMIN, o el MCP) elija
 * otro dueño entre los miembros activos. El nombre no se repite en el negocio (aunque el otro no se vea).
 */
export async function crearTablero(contexto: ContextoTablero, nombre: unknown, dueno?: unknown) {
  const existentes = await prisma.tableroInteligente.findMany({
    where: { workspaceId: contexto.workspaceId },
    select: { id: true, nombre: true },
  });
  const limpio = nombreDeTablero(nombre, existentes);
  if (existentes.length >= LIMITE_TABLEROS) {
    throw new Error(`Este negocio ya tiene ${LIMITE_TABLEROS} tableros, que es el máximo.`);
  }
  const duenoUserId = (await duenoDeEntrada(contexto, dueno)) ?? contexto.userId;
  return prisma.$transaction(async (tx) => {
    const tablero = await tx.tableroInteligente.create({
      data: { workspaceId: contexto.workspaceId, nombre: limpio, duenoUserId },
      select: SELECT_REFERENCIA,
    });
    await crearTiposPorDefecto(tx, tablero.id);
    return aReferencia(tablero);
  });
}

/**
 * Cambia el nombre de un tablero que la persona alcanza (mismas reglas que al crearlo) y, si lo pide
 * el dueño del negocio (o el ADMIN, o el MCP), también de quién es.
 */
export async function renombrarTablero(contexto: ContextoTablero, tableroId: unknown, nombre: unknown, dueno?: unknown) {
  const id = typeof tableroId === "string" ? tableroId.trim() : "";
  const [existentes, actual] = await Promise.all([
    prisma.tableroInteligente.findMany({ where: { workspaceId: contexto.workspaceId }, select: { id: true, nombre: true } }),
    id
      ? prisma.tableroInteligente.findFirst({
          where: { id, ...dondeTablero(contexto) },
          select: { ...SELECT_REFERENCIA, duenoUserId: true },
        })
      : null,
  ]);
  if (!actual) {
    throw new Error("Ese tablero no existe en este negocio (ver listar_tableros).");
  }
  const limpio = nombre === undefined ? actual.nombre : nombreDeTablero(nombre, existentes, actual.id);
  const duenoNuevo = await duenoDeEntrada(contexto, dueno);
  const antes = aReferencia(actual);
  const cambia: Prisma.TableroInteligenteUncheckedUpdateInput = {};
  if (limpio !== actual.nombre) cambia.nombre = limpio;
  if (duenoNuevo !== undefined && duenoNuevo !== actual.duenoUserId) cambia.duenoUserId = duenoNuevo;
  if (!Object.keys(cambia).length) {
    return { ...antes, antes: antes.nombre, duenoAntes: antes.duenoNombre };
  }
  const tablero = await prisma.tableroInteligente.update({
    where: { id: actual.id },
    // La hora también: así el refresco de la lista (inicio y selector) ve el nombre o el dueño nuevo.
    data: { ...cambia, actualizadoEn: new Date() },
    select: SELECT_REFERENCIA,
  });
  return { ...aReferencia(tablero), antes: antes.nombre, duenoAntes: antes.duenoNombre };
}

// ── Escritura: tipos ────────────────────────────────────────────────────────────────────────

type DatosTipo = {
  nombre?: unknown;
  color?: unknown;
  icono?: unknown;
  requiereAprobacion?: unknown;
  usaEstados?: unknown;
  orden?: unknown;
  padres?: unknown;
};

/** Como elegirTipo, pero sin valor por defecto: vacío = error. */
function elegirTipoExplicito(tipos: TipoVista[], pedido: unknown) {
  if (typeof pedido !== "string" || !pedido.trim()) {
    throw new Error("Falta el tipo: su nombre o su id (ver listar_tipos).");
  }
  return elegirTipo(tipos, pedido);
}

/** Marca del propio tipo en la lista de madres (un tipo puede colgar de sí mismo: Área dentro de Área). */
const PROPIO = "__propio__";

/**
 * Ids de tipos madre a partir de nombres o ids del mismo tablero. El propio tipo (por su id o por su
 * nombre, también el nombre nuevo) vuelve como PROPIO.
 */
function padresDeEntrada(
  valor: unknown,
  tipos: TipoVista[],
  propio: { id: string | null; nombres: string[] },
): string[] | undefined {
  if (valor === undefined) return undefined;
  if (valor === null) return [];
  if (!Array.isArray(valor)) throw new Error('padres va como lista de nombres (o ids) de tipos: ["Área"].');
  const claves = new Set(propio.nombres.map(claveDeNombre));
  const ids = new Set<string>();
  for (const pedido of valor) {
    if (typeof pedido === "string" && (pedido.trim() === propio.id || claves.has(claveDeNombre(pedido)))) {
      ids.add(PROPIO);
      continue;
    }
    ids.add(elegirTipoExplicito(tipos, pedido).id);
  }
  return [...ids];
}

function nombreDeTipo(valor: unknown, tipos: TipoVista[], propioId: string | null): string | undefined {
  if (valor === undefined) return undefined;
  const limpio = textoLimpio(valor, MAX_NOMBRE_TIPO);
  if (!limpio) throw new Error("El nombre del tipo no puede quedar vacío.");
  const igual = tipos.find((tipo) => tipo.id !== propioId && claveDeNombre(tipo.nombre) === claveDeNombre(limpio));
  if (igual) throw new Error(`Ya existe el tipo "${igual.nombre}" en este tablero.`);
  return limpio;
}

function ordenDeEntrada(valor: unknown): number | undefined {
  if (valor === undefined) return undefined;
  if (typeof valor !== "number" || !Number.isFinite(valor)) throw new Error("El orden va como número.");
  return Math.trunc(valor);
}

function booleanoDeEntrada(valor: unknown, campo: string): boolean | undefined {
  if (valor === undefined) return undefined;
  if (typeof valor !== "boolean") throw new Error(`${campo} va como true o false.`);
  return valor;
}

const YA_EXISTE_EL_TIPO = "Ya existe un tipo con ese nombre en este tablero.";

/** "APROBADAS o EN_CURSO" para las reglas de los tipos: lo aprobado, lo EN_CURSO y todo lo del Coordinador. */
const ESTADOS_EN_USO: EstadoTarjeta[] = [...ESTADOS_CON_APROBACION, "EN_CURSO"];

export async function crearTipo(contexto: ContextoTablero, tableroId: unknown, datos: DatosTipo) {
  const tablero = await tableroDelNegocio(contexto, tableroId);
  const tipos = await tiposDelTablero(prisma, tablero.id);
  if (tipos.length >= LIMITE_TIPOS) throw new Error(`El tablero ya tiene ${LIMITE_TIPOS} tipos, que es el máximo.`);
  const nombre = nombreDeTipo(datos.nombre ?? "", tipos, null)!;
  const color = colorDeEntrada(datos.color) ?? "#71717a";
  const icono = iconoDeEntrada(datos.icono) ?? null;
  const requiereAprobacion = booleanoDeEntrada(datos.requiereAprobacion, "requiere_aprobacion") ?? false;
  const usaEstados = booleanoDeEntrada(datos.usaEstados, "usa_estados") ?? true;
  if (!usaEstados && requiereAprobacion) {
    throw new Error("Un tipo sin estados (una carpeta, como Área) no puede pedir aprobación.");
  }
  const orden = ordenDeEntrada(datos.orden) ?? Math.max(-1, ...tipos.map((tipo) => tipo.orden)) + 1;
  const padres = padresDeEntrada(datos.padres, tipos, { id: null, nombres: [nombre] }) ?? [];
  try {
    return await prisma.$transaction(async (tx) => {
      const creado = await tx.tipoTarjeta.create({
        data: { tableroId: tablero.id, nombre, color, icono, requiereAprobacion, usaEstados, orden },
        select: { id: true },
      });
      if (padres.length) {
        await tx.tipoTarjetaPadre.createMany({
          data: padres.map((id) => ({ tipoId: creado.id, tipoPadreId: id === PROPIO ? creado.id : id })),
        });
      }
      await tocarTablero(tx, tablero.id);
      const tipo = await tx.tipoTarjeta.findUniqueOrThrow({ where: { id: creado.id }, select: SELECT_TIPO });
      return { tipo: tipoAVista(tipo), tablero };
    });
  } catch (fallo) {
    if (fallo instanceof Prisma.PrismaClientKnownRequestError && fallo.code === "P2002") throw new Error(YA_EXISTE_EL_TIPO);
    throw fallo;
  }
}

/** Un tipo de ESTE negocio (de un tablero que la persona alcanza), o error. */
async function tipoDelNegocio(alcance: Alcance, tipoId: unknown) {
  const id = typeof tipoId === "string" ? tipoId.trim() : "";
  const tipo = id
    ? await prisma.tipoTarjeta.findFirst({
        where: { id, tablero: dondeTablero(alcance) },
        select: { ...SELECT_TIPO, tableroId: true },
      })
    : null;
  if (!tipo) throw new Error("No existe ese tipo en este negocio. Ver listar_tipos para los ids.");
  return tipo;
}

/**
 * Editar un tipo. Claude puede cambiar todo menos QUITARLE la aprobación (eso solo el dueño en la
 * pantalla, y nunca con tarjetas APROBADAS o EN_CURSO). Si se la quita el dueño, las POR_APROBAR de
 * ese tipo vuelven a IDEA (cada una con su fila de historial). No se quita una madre permitida que
 * está en uso.
 */
export async function editarTipo(contexto: ContextoTablero, tipoId: unknown, datos: DatosTipo) {
  const actual = await tipoDelNegocio(contexto, tipoId);
  const tipos = await tiposDelTablero(prisma, actual.tableroId);
  const nombre = nombreDeTipo(datos.nombre, tipos, actual.id);
  const color = colorDeEntrada(datos.color);
  const icono = iconoDeEntrada(datos.icono);
  const orden = ordenDeEntrada(datos.orden);
  const requiereAprobacion = booleanoDeEntrada(datos.requiereAprobacion, "requiere_aprobacion");
  const usaEstados = booleanoDeEntrada(datos.usaEstados, "usa_estados");
  const padres = padresDeEntrada(datos.padres, tipos, {
    id: actual.id,
    nombres: [actual.nombre, ...(nombre ? [nombre] : [])],
  })?.map((id) => (id === PROPIO ? actual.id : id));

  const cambia: Prisma.TipoTarjetaUpdateInput = {};
  if (nombre !== undefined && nombre !== actual.nombre) cambia.nombre = nombre;
  if (color !== undefined && color !== actual.color) cambia.color = color;
  if (icono !== undefined && icono !== actual.icono) cambia.icono = icono;
  if (orden !== undefined && orden !== actual.orden) cambia.orden = orden;
  if (requiereAprobacion !== undefined && requiereAprobacion !== actual.requiereAprobacion) {
    const enUso = requiereAprobacion
      ? 0
      : await prisma.tarjetaTablero.count({ where: { tipoId: actual.id, estado: { in: ESTADOS_EN_USO } } });
    const veredicto = puedeCambiarAprobacionDelTipo(contexto.origen, actual.requiereAprobacion, requiereAprobacion, enUso);
    if (veredicto) throw new Error(veredicto);
    cambia.requiereAprobacion = requiereAprobacion;
  }
  const requiereFinal = (cambia.requiereAprobacion as boolean | undefined) ?? actual.requiereAprobacion;
  if (usaEstados !== undefined && usaEstados !== actual.usaEstados) {
    const [aprobadasOEnCurso, noIdea] = usaEstados
      ? [0, 0]
      : await Promise.all([
          prisma.tarjetaTablero.count({ where: { tipoId: actual.id, estado: { in: ESTADOS_EN_USO } } }),
          prisma.tarjetaTablero.count({ where: { tipoId: actual.id, estado: { not: "IDEA" } } }),
        ]);
    const veredicto = puedeCambiarEstadosDelTipo(
      contexto.origen,
      actual.usaEstados,
      usaEstados,
      { aprobadasOEnCurso, noIdea },
      requiereFinal,
    );
    if (veredicto) throw new Error(veredicto);
    cambia.usaEstados = usaEstados;
  } else if (requiereFinal && !actual.usaEstados) {
    throw new Error("Un tipo sin estados (una carpeta, como Área) no puede pedir aprobación. Primero dale estados (usa_estados).");
  }
  const antesPadres = new Set(actual.padres.map((padre) => padre.tipoPadreId));
  const quitados = padres ? [...antesPadres].filter((id) => !padres.includes(id)) : [];
  const agregados = padres ? padres.filter((id) => !antesPadres.has(id)) : [];
  if (quitados.length) {
    const colgadas = await prisma.tarjetaTablero.count({
      where: { tipoId: actual.id, ...NO_BORRADA, padre: { tipoId: { in: quitados }, ...NO_BORRADA } },
    });
    if (colgadas) {
      const nombres = nombresDeTipos(tipos);
      throw new Error(
        `Hay ${colgadas} tarjeta(s) de tipo ${actual.nombre} colgadas de una ${quitados
          .map((id) => nombres.get(id) ?? id)
          .join(" o ")}: primero muévelas o cámbiales el tipo.`,
      );
    }
  }
  if (!Object.keys(cambia).length && !quitados.length && !agregados.length) {
    throw new Error("No hay nada distinto para cambiar.");
  }

  try {
    return await prisma.$transaction(async (tx) => {
      if (Object.keys(cambia).length) await tx.tipoTarjeta.update({ where: { id: actual.id }, data: cambia });
      if (quitados.length) {
        await tx.tipoTarjetaPadre.deleteMany({ where: { tipoId: actual.id, tipoPadreId: { in: quitados } } });
      }
      if (agregados.length) {
        await tx.tipoTarjetaPadre.createMany({
          data: agregados.map((tipoPadreId) => ({ tipoId: actual.id, tipoPadreId })),
          skipDuplicates: true,
        });
      }
      let volvieronAIdea = 0;
      // Sin aprobación no hay POR_APROBAR; sin estados, todo queda IDEA (interno). Cada una con su historial.
      const aIdea: EstadoTarjeta[] | null =
        cambia.usaEstados === false
          ? ["POR_APROBAR", "EN_CURSO", "HECHO", "FALLIDO"]
          : cambia.requiereAprobacion === false
            ? ["POR_APROBAR"]
            : null;
      if (aIdea) {
        const motivo = cambia.usaEstados === false ? "el tipo ya no tiene estados" : "el tipo ya no pide aprobación";
        const afectadas = await tx.tarjetaTablero.findMany({
          where: { tipoId: actual.id, estado: { in: aIdea } },
          select: { id: true, estado: true },
        });
        for (const tarjeta of afectadas) {
          const hecho = await tx.tarjetaTablero.updateMany({
            where: { id: tarjeta.id, estado: tarjeta.estado },
            data: { estado: "IDEA" },
          });
          if (hecho.count === 1) {
            await anotar(tx, contexto, tarjeta.id, "estado", { estado: tarjeta.estado }, { estado: "IDEA", motivo });
            volvieronAIdea += 1;
          }
        }
      }
      await tocarTablero(tx, actual.tableroId);
      const tipo = await tx.tipoTarjeta.findUniqueOrThrow({ where: { id: actual.id }, select: SELECT_TIPO });
      return { tipo: tipoAVista(tipo), volvieronAIdea };
    });
  } catch (fallo) {
    if (fallo instanceof Prisma.PrismaClientKnownRequestError && fallo.code === "P2002") throw new Error(YA_EXISTE_EL_TIPO);
    throw fallo;
  }
}

/** Borrar un tipo: solo la pantalla, y solo si ninguna tarjeta (ni borrada) lo usa. */
export async function borrarTipo(contexto: ContextoTablero, tipoId: unknown) {
  const actual = await tipoDelNegocio(contexto, tipoId);
  const usos = await prisma.tarjetaTablero.count({ where: { tipoId: actual.id } });
  const veredicto = puedeBorrarTipo(contexto.origen, usos);
  if (veredicto) throw new Error(veredicto);
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.tipoTarjeta.delete({ where: { id: actual.id } });
      await tocarTablero(tx, actual.tableroId);
      return { nombre: actual.nombre };
    });
  } catch (fallo) {
    // Alguien creó una tarjeta de ese tipo justo ahora (la FK es RESTRICT).
    if (fallo instanceof Prisma.PrismaClientKnownRequestError && (fallo.code === "P2003" || fallo.code === "P2014")) {
      throw new Error("Ese tipo se empezó a usar mientras tanto: no se borró.");
    }
    throw fallo;
  }
}

// ── Escritura: tarjetas ─────────────────────────────────────────────────────────────────────

/** link_texto: texto, o "" / null para quitarlo. Undefined = no vino. */
function linkTextoDeEntrada(valor: unknown): string | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  if (typeof valor !== "string") throw new Error("link_texto va como texto.");
  return textoLimpio(valor, MAX_LINK_TEXTO) ?? null;
}

export async function crearTarjeta(
  contexto: ContextoTablero,
  datos: {
    tableroId: unknown;
    titulo: unknown;
    detalle?: unknown;
    area?: unknown;
    estado?: unknown;
    fecha?: unknown;
    orden?: unknown;
    conectarCon?: unknown;
    tipo?: unknown;
    padreId?: unknown;
    link?: unknown;
    linkTexto?: unknown;
    repo?: unknown;
    zonaProtegida?: unknown;
    riesgo?: unknown;
    motivoRiesgo?: unknown;
    responsable?: unknown;
  },
) {
  const tablero = await tableroDelNegocio(contexto, datos.tableroId);
  const titulo = textoLimpio(datos.titulo, MAX_TITULO);
  if (!titulo) {
    throw new Error("Hace falta el título de la tarjeta.");
  }
  const tipos = await tiposDelTablero(prisma, tablero.id);
  const tipo = elegirTipo(tipos, datos.tipo);
  const estado = estadoAlCrear(datos.estado, tipo.requiereAprobacion, tipo.usaEstados);
  const fecha = fechaDeEntrada(datos.fecha) ?? null;
  const orden = typeof datos.orden === "number" && Number.isFinite(datos.orden) ? Math.trunc(datos.orden) : 0;
  const link = linkDeEntrada(datos.link) ?? null;
  const linkTexto = link ? (linkTextoDeEntrada(datos.linkTexto) ?? null) : null;
  const padreId = padreDeEntrada(datos.padreId) ?? null;
  const repo = repoDeEntrada(datos.repo) ?? null;
  const zonaProtegida = zonasDeEntrada(datos.zonaProtegida) ?? [];
  if (repo) revisarRepoParaTipo(tipo);
  // El riesgo (BAJO / ALTO) lo propone quien crea; BAJO solo si las reglas no ven nada de riesgo alto.
  const detalle = textoLimpio(datos.detalle, MAX_DETALLE) ?? "";
  const riesgo = riesgoDeEntrada(datos.riesgo) ?? null;
  const riesgoPor = quienPoneElRiesgo(contexto.origen);
  if (riesgo && !repo) throw new Error("El riesgo va solo en tarjetas con repo (las que ejecuta el trabajador).");
  const problemaDeRiesgo = problemaDelRiesgo({
    quien: riesgoPor,
    pedido: riesgo,
    actual: null,
    actualPor: null,
    datos: { titulo, detalle, repo, zonaProtegida },
  });
  if (problemaDeRiesgo) throw new Error(problemaDeRiesgo);
  const riesgoMotivo = riesgo ? (motivoDeRiesgoDeEntrada(datos.motivoRiesgo) ?? null) : null;
  const responsable = (await responsableDeEntrada(contexto.workspaceId, datos.responsable)) ?? null;
  const conectarCon = Array.isArray(datos.conectarCon)
    ? [...new Set(datos.conectarCon.filter((id): id is string => typeof id === "string" && id.trim() !== ""))]
    : [];

  const cuantas = await prisma.tarjetaTablero.count({ where: { tableroId: tablero.id, ...NO_BORRADA } });
  if (cuantas >= LIMITE_TARJETAS) {
    throw new Error(`El tablero ya tiene ${LIMITE_TARJETAS} tarjetas, que es el máximo. Conviene crear otro tablero.`);
  }
  if (conectarCon.length) {
    const delTablero = await prisma.tarjetaTablero.count({
      where: { id: { in: conectarCon }, tableroId: tablero.id, ...NO_BORRADA },
    });
    if (delTablero !== conectarCon.length) {
      throw new Error("Alguna tarjeta de conectar_con no es de este tablero (o está borrada). Ver ver_tablero para los ids.");
    }
  }
  if (padreId) {
    // Una tarjeta nueva no puede cerrar un ciclo: solo se revisa el tipo y el tablero.
    await revisarMadre({ id: "", tipoId: tipo.id, tableroId: tablero.id }, padreId, tipos);
  }

  const creada = await prisma.$transaction(async (tx) => {
    const tarjeta = await tx.tarjetaTablero.create({
      data: {
        tableroId: tablero.id,
        titulo,
        detalle,
        area: textoLimpio(datos.area, MAX_AREA) ?? null,
        estado: estado as EstadoTarjeta,
        orden,
        fecha,
        tipoId: tipo.id,
        padreId,
        link,
        linkTexto,
        repo,
        zonaProtegida,
        riesgo,
        riesgoMotivo,
        riesgoPor: riesgo ? riesgoPor : null,
        responsableId: responsable?.userId ?? null,
        creadoPor: contexto.userId,
      },
      select: SELECT_TARJETA,
    });
    const cambio = await anotar(tx, contexto, tarjeta.id, "crear", null, {
      titulo: tarjeta.titulo,
      detalle: tarjeta.detalle,
      area: tarjeta.area,
      estado: tarjeta.estado,
      orden: tarjeta.orden,
      fecha: isoONull(tarjeta.fecha),
      tipoId: tarjeta.tipoId,
      padreId: tarjeta.padreId,
      link: tarjeta.link,
      linkTexto: tarjeta.linkTexto,
      repo: tarjeta.repo,
      zonaProtegida: tarjeta.zonaProtegida,
      riesgo: tarjeta.riesgo,
      riesgoMotivo: tarjeta.riesgoMotivo,
      riesgoPor: tarjeta.riesgoPor,
      // Sin responsable no se anota nada: el historial de antes de este campo queda igual.
      ...(responsable ? { responsableId: responsable.userId, responsableNombre: responsable.nombre } : {}),
    });
    // Cada flecha es su propio cambio: así se puede deshacer una sin tocar la tarjeta.
    for (const destinoId of conectarCon) {
      const conexion = await tx.conexionTarjeta.create({
        data: { tableroId: tablero.id, origenId: tarjeta.id, destinoId },
        select: { id: true },
      });
      await anotar(tx, contexto, tarjeta.id, "conectar", null, { conexionId: conexion.id, origenId: tarjeta.id, destinoId });
    }
    await tocarTablero(tx, tablero.id);
    return { tarjeta: aVista(tarjeta), cambioId: cambio.id, tablero, tipo };
  });
  // Una tarea con repo que nace POR_APROBAR se aprueba sola (regla del dueño 25-oct; salvo dinero o Meta Ads).
  const aprobacion = await aprobarSiCorresponde(creada.tarjeta);
  return { ...creada, tarjeta: aprobacion.tarjeta, aprobacionAutomatica: aprobacion.resultado };
}

/** Quién pone el riesgo según de dónde viene el cambio: la pantalla es el dueño; el MCP, Claude. */
function quienPoneElRiesgo(origen: OrigenCambio): QuienPoneRiesgo {
  return origen === "PANTALLA" ? "DUENO" : origen === "TRABAJADOR" ? "TRABAJADOR" : "CLAUDE";
}

/**
 * Si la tarjeta quedó POR_APROBAR con repo, intenta aprobarla sola (regla del dueño 25-oct: cualquier riesgo salvo
 * dinero o Meta Ads; con el interruptor apagado, solo las BAJO). Devuelve la tarjeta como quedó (si se aprobó,
 * ya APROBADO) y el resultado, o null si no correspondía intentarlo.
 */
async function aprobarSiCorresponde(tarjeta: TarjetaVista): Promise<{ tarjeta: TarjetaVista; resultado: ResultadoDeAprobarSola | null }> {
  if (tarjeta.estado !== "POR_APROBAR" || !tarjeta.repo) return { tarjeta, resultado: null };
  const resultado = await aprobarSolaLaTarea(tarjeta.id);
  if (!resultado.aprobada) return { tarjeta, resultado };
  const fila = await prisma.tarjetaTablero.findUnique({ where: { id: tarjeta.id }, select: SELECT_TARJETA });
  return { tarjeta: fila ? aVista(fila) : { ...tarjeta, estado: "APROBADO" }, resultado };
}

/** El Coordinador ejecuta solo tarjetas de un tipo con aprobación (y con estados): solo esas llevan repo. */
function revisarRepoParaTipo(tipo: { nombre: string; requiereAprobacion: boolean; usaEstados: boolean }) {
  if (!tipo.requiereAprobacion || !tipo.usaEstados) {
    throw new Error(
      `Las tarjetas de tipo ${tipo.nombre} no pasan por aprobación: el Coordinador no las ejecuta, así que no llevan repo. Usa un tipo con aprobación (como Tarea).`,
    );
  }
}

/** Cuando dos escrituras chocan (el dueño aprobó mientras Claude editaba), se avisa en vez de pisar. */
const CAMBIO_EN_EL_MEDIO = "La tarjeta cambió mientras tanto (quizás el dueño la aprobó). Vuelve a leerla e intenta de nuevo.";

type CamposEditables = {
  titulo?: string;
  detalle?: string;
  area?: string | null;
  orden?: number;
  fecha?: Date | null;
  tipoId?: string;
  padreId?: string | null;
  link?: string | null;
  linkTexto?: string | null;
  repo?: string | null;
  zonaProtegida?: string[];
  riesgo?: string | null;
  riesgoMotivo?: string | null;
  riesgoPor?: string | null;
  responsableId?: string | null;
};

export async function editarTarjeta(
  contexto: ContextoTablero,
  tarjetaId: unknown,
  cambios: {
    titulo?: unknown;
    detalle?: unknown;
    area?: unknown;
    orden?: unknown;
    fecha?: unknown;
    tipo?: unknown;
    padreId?: unknown;
    link?: unknown;
    linkTexto?: unknown;
    repo?: unknown;
    zonaProtegida?: unknown;
    riesgo?: unknown;
    motivoRiesgo?: unknown;
    responsable?: unknown;
  },
) {
  const actual = await tarjetaDelNegocio(contexto, tarjetaId);
  // Asignar a alguien no toca el texto ni el trabajo: se puede aunque el Coordinador tenga la tarjeta.
  const soloAsigna =
    cambios.responsable !== undefined &&
    Object.entries(cambios).every(([campo, valor]) => campo === "responsable" || valor === undefined);
  const enManos = soloAsigna ? null : puedeEditarTarjeta(actual.estado, Boolean(actual.repo));
  if (enManos) throw new Error(enManos);

  const nuevo: CamposEditables = {};
  const responsable = await responsableDeEntrada(contexto.workspaceId, cambios.responsable);
  if (responsable !== undefined && (responsable?.userId ?? null) !== actual.responsableId) {
    nuevo.responsableId = responsable?.userId ?? null;
  }
  const repo = repoDeEntrada(cambios.repo);
  if (repo !== undefined && repo !== actual.repo) nuevo.repo = repo;
  // La zona protegida: Claude (y el Coordinador) la pueden poner, no quitar. Quitarla es de la pantalla.
  const zonas = zonasDeEntrada(cambios.zonaProtegida);
  if (zonas !== undefined) {
    const final = contexto.origen === "PANTALLA" ? zonas : unirZonas(actual.zonaProtegida, zonas);
    const veredicto = puedeCambiarZonas(contexto.origen, actual.zonaProtegida, final, false);
    if (veredicto) throw new Error(veredicto);
    if (final.join(",") !== actual.zonaProtegida.join(",")) nuevo.zonaProtegida = final;
  }
  if (cambios.titulo !== undefined) {
    const titulo = textoLimpio(cambios.titulo, MAX_TITULO);
    if (!titulo) throw new Error("El título no puede quedar vacío.");
    if (titulo !== actual.titulo) nuevo.titulo = titulo;
  }
  if (cambios.detalle !== undefined) {
    const detalle = typeof cambios.detalle === "string" ? cambios.detalle.trim().slice(0, MAX_DETALLE) : "";
    if (detalle !== actual.detalle) nuevo.detalle = detalle;
  }
  if (cambios.area !== undefined) {
    const area = textoLimpio(cambios.area, MAX_AREA) ?? null;
    if (area !== actual.area) nuevo.area = area;
  }
  if (cambios.orden !== undefined) {
    if (typeof cambios.orden !== "number" || !Number.isFinite(cambios.orden)) throw new Error("El orden va como número.");
    const orden = Math.trunc(cambios.orden);
    if (orden !== actual.orden) nuevo.orden = orden;
  }
  if (cambios.fecha !== undefined) {
    const fecha = fechaDeEntrada(cambios.fecha) ?? null;
    if (isoONull(fecha) !== isoONull(actual.fecha)) nuevo.fecha = fecha;
  }
  const link = linkDeEntrada(cambios.link);
  if (link !== undefined && link !== actual.link) nuevo.link = link;
  const linkTexto = linkTextoDeEntrada(cambios.linkTexto);
  if (linkTexto !== undefined && linkTexto !== actual.linkTexto) nuevo.linkTexto = linkTexto;
  // Sin link no queda texto de link suelto.
  if (nuevo.link === null && actual.linkTexto !== null && nuevo.linkTexto === undefined) nuevo.linkTexto = null;

  const tipos = await tiposDelTablero(prisma, actual.tableroId);
  if (cambios.tipo !== undefined) {
    const tipo = elegirTipoExplicito(tipos, cambios.tipo);
    if (tipo.id !== actual.tipoId) nuevo.tipoId = tipo.id;
  }
  const padreId = padreDeEntrada(cambios.padreId);
  if (padreId !== undefined && padreId !== actual.padreId) nuevo.padreId = padreId;

  // Jerarquía: con el tipo y la madre como quedarían.
  const tipoFinal = tipos.find((tipo) => tipo.id === (nuevo.tipoId ?? actual.tipoId));
  if (!tipoFinal) throw new Error("El tipo de la tarjeta no existe en el tablero.");
  const padreFinal = nuevo.padreId !== undefined ? nuevo.padreId : actual.padreId;
  if (padreFinal && (nuevo.padreId !== undefined || nuevo.tipoId !== undefined)) {
    const madreViva = await prisma.tarjetaTablero.count({ where: { id: padreFinal, ...NO_BORRADA } });
    // Si solo cambia el tipo y la madre está borrada, la tarjeta ya se ve suelta: no se revisa.
    if (madreViva || nuevo.padreId !== undefined) {
      await revisarMadre({ id: actual.id, tipoId: tipoFinal.id, tableroId: actual.tableroId }, padreFinal, tipos);
    }
  }
  if (nuevo.tipoId) await revisarHijas(actual.id, nuevo.tipoId, tipos);
  const repoFinal = nuevo.repo !== undefined ? nuevo.repo : actual.repo;
  if (repoFinal && (nuevo.repo !== undefined || nuevo.tipoId)) revisarRepoParaTipo(tipoFinal);

  // Riesgo: BAJO solo si las reglas no ven nada de riesgo alto con la tarjeta como quedaría. Si queda BAJO
  // y el texto o las zonas cambiaron a algo de riesgo alto, pasa a ALTO sola (y no se aprueba sola).
  const riesgoPedido = riesgoDeEntrada(cambios.riesgo);
  const motivoPedido = motivoDeRiesgoDeEntrada(cambios.motivoRiesgo);
  const quienRiesgo = quienPoneElRiesgo(contexto.origen);
  const datosDeRiesgo = {
    titulo: nuevo.titulo ?? actual.titulo,
    detalle: nuevo.detalle ?? actual.detalle,
    repo: repoFinal,
    zonaProtegida: nuevo.zonaProtegida ?? actual.zonaProtegida,
  };
  let avisoDeRiesgo: string | null = null;
  if (riesgoPedido !== undefined) {
    if (riesgoPedido && !repoFinal) throw new Error("El riesgo va solo en tarjetas con repo (las que ejecuta el trabajador).");
    const problema = problemaDelRiesgo({
      quien: quienRiesgo,
      pedido: riesgoPedido,
      actual: actual.riesgo === "BAJO" || actual.riesgo === "ALTO" ? actual.riesgo : null,
      actualPor: actual.riesgoPor,
      datos: datosDeRiesgo,
    });
    if (problema) throw new Error(problema);
    const motivo = riesgoPedido ? (motivoPedido ?? (riesgoPedido === actual.riesgo ? actual.riesgoMotivo : null)) : null;
    const por = riesgoPedido ? quienRiesgo : null;
    if (riesgoPedido !== actual.riesgo) nuevo.riesgo = riesgoPedido;
    if (motivo !== actual.riesgoMotivo) nuevo.riesgoMotivo = motivo;
    if (nuevo.riesgo !== undefined || nuevo.riesgoMotivo !== undefined) {
      if (por !== actual.riesgoPor) nuevo.riesgoPor = por;
    }
  } else if (motivoPedido !== undefined && actual.riesgo && motivoPedido !== actual.riesgoMotivo) {
    nuevo.riesgoMotivo = motivoPedido;
  }
  // Asignar a alguien nunca toca el riesgo (ni el estado): el recálculo automático es solo si cambia otra cosa.
  if (!soloAsigna && nuevo.riesgo === undefined && actual.riesgo === "BAJO") {
    const motivos = motivosDeRiesgoAlto(datosDeRiesgo);
    if (motivos.length) {
      nuevo.riesgo = "ALTO";
      nuevo.riesgoMotivo = frase(motivos).slice(0, 300);
      nuevo.riesgoPor = quienRiesgo;
      avisoDeRiesgo = `El riesgo pasó a ALTO porque ahora ${frase(motivos)}.`;
    }
  }
  if (!Object.keys(nuevo).length) {
    throw new Error("No hay nada distinto para cambiar.");
  }

  // Cambiar solo el responsable no reinicia la aprobación: la tarjeta sigue en el estado en que estaba.
  const estado = soloCambiaResponsable(Object.keys(nuevo))
    ? actual.estado
    : nuevo.tipoId
      ? estadoTrasCambiarTipo(tipoFinal.requiereAprobacion, tipoFinal.usaEstados)
      : estadoAlPonerRepo(estadoTrasEditar(contexto.origen, actual.estado), actual.repo, repoFinal);
  const antes: Record<string, unknown> = {};
  const despues: Record<string, unknown> = {};
  for (const campo of Object.keys(nuevo) as (keyof CamposEditables)[]) {
    antes[campo] = campo === "fecha" ? isoONull(actual.fecha) : actual[campo];
    despues[campo] = campo === "fecha" ? isoONull(nuevo.fecha) : nuevo[campo];
  }
  if (nuevo.responsableId !== undefined) {
    // El historial dice el nombre ("asignó a Emanuel"), no solo el id.
    antes.responsableNombre = actual.responsable ? nombreDePersona(actual.responsable) : null;
    despues.responsableNombre = responsable?.nombre ?? null;
  }
  if (estado !== actual.estado) {
    antes.estado = actual.estado;
    despues.estado = estado;
  }

  const editada = await prisma.$transaction(async (tx) => {
    const hecho = await tx.tarjetaTablero.updateMany({
      where: { id: actual.id, estado: actual.estado, ...NO_BORRADA },
      data: { ...nuevo, estado },
    });
    if (hecho.count !== 1) throw new Error(CAMBIO_EN_EL_MEDIO);
    const cambio = await anotar(tx, contexto, actual.id, "editar", antes, despues);
    await tocarTablero(tx, actual.tableroId);
    const tarjeta = await tx.tarjetaTablero.findUniqueOrThrow({ where: { id: actual.id }, select: SELECT_TARJETA });
    return {
      tarjeta: aVista(tarjeta),
      cambioId: cambio.id,
      volvioAPorAprobar: estado === "POR_APROBAR" && actual.estado !== "POR_APROBAR",
      perdioAprobacion: tieneAprobacion(actual.estado) && !tieneAprobacion(estado),
      cambioDeTipo: Boolean(nuevo.tipoId),
      tipo: tipoFinal,
    };
  });
  // Si quedó POR_APROBAR con repo, se aprueba sola otra vez (si corresponde por las reglas de aprobación automática).
  // Asignar a alguien no aprueba nada: ahí el estado se queda como estaba.
  const aprobacion = soloCambiaResponsable(Object.keys(nuevo))
    ? { tarjeta: editada.tarjeta, resultado: null }
    : await aprobarSiCorresponde(editada.tarjeta);
  return { ...editada, tarjeta: aprobacion.tarjeta, aprobacionAutomatica: aprobacion.resultado, avisoDeRiesgo };
}

/** Un `depende`: verdadero o falso (si no vino, falso); cualquier otra cosa se rechaza. */
function dependeDeEntrada(valor: unknown): boolean {
  if (valor === undefined || valor === null || valor === "") return false;
  if (typeof valor === "boolean") return valor;
  throw new Error('"depende" es verdadero o falso.');
}

/** Si poner origen -> destino como dependencia haría un ciclo, error claro (ninguna de las dos se podría tomar). */
async function revisarCicloDeDependencias(tableroId: string, origenId: string, destinoId: string, salvoConexionId?: string) {
  const dependencias = await prisma.conexionTarjeta.findMany({
    where: { tableroId, esDependencia: true, ...(salvoConexionId ? { id: { not: salvoConexionId } } : {}) },
    select: { origenId: true, destinoId: true },
  });
  if (dependenciaHaceCiclo(dependencias, origenId, destinoId)) {
    throw new Error("Eso haría un ciclo de dependencias: la otra tarjeta ya depende (directa o indirectamente) de esta, y ninguna de las dos se podría tomar.");
  }
}

/**
 * Conecta dos tarjetas con una flecha. Con `depende` la flecha es una dependencia: el DESTINO no se toma
 * hasta que el ORIGEN esté HECHO (se rechaza si haría un ciclo).
 */
export async function conectarTarjetas(contexto: ContextoTablero, origenId: unknown, destinoId: unknown, depende?: unknown) {
  const origen = await tarjetaDelNegocio(contexto, origenId);
  const destino = await tarjetaDelNegocio(contexto, destinoId);
  const esDependencia = dependeDeEntrada(depende);
  if (origen.id === destino.id) {
    throw new Error("Una tarjeta no se conecta consigo misma.");
  }
  if (origen.tableroId !== destino.tableroId) {
    throw new Error("Las dos tarjetas tienen que ser del mismo tablero.");
  }
  if (esDependencia) await revisarCicloDeDependencias(origen.tableroId, origen.id, destino.id);
  const ya = await prisma.conexionTarjeta.findUnique({
    where: { origenId_destinoId: { origenId: origen.id, destinoId: destino.id } },
    select: { id: true },
  });
  if (ya) {
    throw new Error("Esas dos tarjetas ya están conectadas en ese sentido.");
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const conexion = await tx.conexionTarjeta.create({
        data: { tableroId: origen.tableroId, origenId: origen.id, destinoId: destino.id, esDependencia },
        select: { id: true, origenId: true, destinoId: true, esDependencia: true },
      });
      const cambio = await anotar(tx, contexto, origen.id, "conectar", null, {
        conexionId: conexion.id,
        origenId: origen.id,
        destinoId: destino.id,
        ...(esDependencia ? { esDependencia } : {}),
      });
      await tocarTablero(tx, origen.tableroId);
      return { conexion, cambioId: cambio.id, origen: origen.titulo, destino: destino.titulo };
    });
  } catch (fallo) {
    if (fallo instanceof Prisma.PrismaClientKnownRequestError && fallo.code === "P2002") {
      throw new Error("Esas dos tarjetas ya están conectadas en ese sentido.");
    }
    throw fallo;
  }
}

/**
 * Marca (o desmarca) una flecha como dependencia: el destino no se toma hasta que el origen esté HECHO.
 * Se rechaza si haría un ciclo. Queda en el historial del origen como un "editar" con la flecha (deshacer lo
 * revierte).
 */
export async function marcarDependencia(contexto: ContextoTablero, conexionId: unknown, esDependencia: unknown) {
  const id = typeof conexionId === "string" ? conexionId.trim() : "";
  const quiere = dependeDeEntrada(esDependencia);
  const conexion = id
    ? await prisma.conexionTarjeta.findFirst({
        where: { id, tablero: dondeTablero(contexto) },
        select: { id: true, tableroId: true, origenId: true, destinoId: true, esDependencia: true },
      })
    : null;
  if (!conexion) throw new Error("No existe esa flecha en este negocio.");
  if (conexion.esDependencia === quiere) {
    return { conexion, cambioId: null, aviso: quiere ? "Esa flecha ya era una dependencia." : "Esa flecha ya no era una dependencia." };
  }
  if (quiere) await revisarCicloDeDependencias(conexion.tableroId, conexion.origenId, conexion.destinoId, conexion.id);
  return prisma.$transaction(async (tx) => {
    const hecho = await tx.conexionTarjeta.updateMany({
      where: { id: conexion.id, esDependencia: conexion.esDependencia },
      data: { esDependencia: quiere },
    });
    if (hecho.count !== 1) throw new Error(CAMBIO_EN_EL_MEDIO);
    const cambio = await anotar(
      tx,
      contexto,
      conexion.origenId,
      "editar",
      { conexionId: conexion.id, esDependencia: conexion.esDependencia },
      { conexionId: conexion.id, origenId: conexion.origenId, destinoId: conexion.destinoId, esDependencia: quiere },
    );
    await tocarTablero(tx, conexion.tableroId);
    return {
      conexion: { ...conexion, esDependencia: quiere },
      cambioId: cambio.id,
      aviso: quiere ? "Listo: la segunda tarjeta espera a que la primera esté hecha." : "Listo: esa flecha ya no es una dependencia.",
    };
  });
}

async function reglasDelTipo(tipoId: string) {
  const tipo = await prisma.tipoTarjeta.findUnique({
    where: { id: tipoId },
    select: { requiereAprobacion: true, usaEstados: true },
  });
  return { requiereAprobacion: tipo?.requiereAprobacion ?? true, usaEstados: tipo?.usaEstados ?? true };
}

/** Los datos extra de un HECHO a mano que pide Claude por voz (cambiar_estado_tarjeta). */
export type DatosDeHechoAMano = { textoConfirmacion?: unknown; nota?: unknown; commit?: unknown };

export async function cambiarEstadoTarjeta(
  contexto: ContextoTablero,
  tarjetaId: unknown,
  estado: unknown,
  hechoAMano: DatosDeHechoAMano = {},
) {
  if (!esEstado(estado)) {
    throw new Error("Estado desconocido. Van: IDEA, POR_APROBAR, EN_CURSO, HECHO o FALLIDO.");
  }
  const actual = await tarjetaDelNegocio(contexto, tarjetaId);
  // HECHO de una tarjeta con repo que quedó en ERROR, FALLIDO o POR_REVISAR: es "marcar hecho a mano",
  // una regla aparte que exige al dueño (reglas-trabajador.ts). Lo demás sigue por las reglas de siempre.
  if (estado === "HECHO" && actual.repo && sePuedeMarcarHechoAMano(actual.estado)) {
    const marcada = await marcarHechoAMano(contexto, actual.id, { via: "voz", ...hechoAMano });
    return { cambioId: marcada.cambioId, antes: marcada.antes, ahora: marcada.ahora, titulo: marcada.titulo, aprobacionAutomatica: null };
  }
  const tipo = await reglasDelTipo(actual.tipoId);
  const veredicto = puedeCambiarEstado(actual.estado, estado, tipo.requiereAprobacion, tipo.usaEstados, Boolean(actual.repo));
  if (veredicto) {
    throw new Error(veredicto);
  }
  const cambiado = await prisma.$transaction(async (tx) => {
    const hecho = await tx.tarjetaTablero.updateMany({
      // Condicionado también al repo: si se lo pusieron un instante antes, valen las reglas del Coordinador.
      where: { id: actual.id, estado: actual.estado, tipoId: actual.tipoId, repo: actual.repo, ...NO_BORRADA },
      data: { estado },
    });
    if (hecho.count !== 1) throw new Error(CAMBIO_EN_EL_MEDIO);
    const cambio = await anotar(tx, contexto, actual.id, "estado", { estado: actual.estado }, { estado });
    // Una parte que termina (HECHO o FALLIDO) puede ser la última de una tarjeta partida: la madre se cierra.
    if (estado === "HECHO" || estado === "FALLIDO") await cerrarLaMadreConHistorial(tx, contexto, actual);
    await tocarTablero(tx, actual.tableroId);
    return { cambioId: cambio.id, antes: actual.estado, ahora: estado as EstadoTarjetaTablero, titulo: actual.titulo };
  });
  // POR_APROBAR con repo: se aprueba sola si corresponde (regla del dueño 25-oct; con el interruptor apagado, solo BAJO).
  if (estado !== "POR_APROBAR" || !actual.repo) return { ...cambiado, aprobacionAutomatica: null };
  const aprobacion = await aprobarSolaLaTarea(actual.id);
  return { ...cambiado, ahora: aprobacion.aprobada ? ("APROBADO" as EstadoTarjetaTablero) : cambiado.ahora, aprobacionAutomatica: aprobacion };
}

/** Cómo llega un HECHO a mano: por dónde, la nota, el commit y (voz) lo que dijo el dueño o (pantalla) lo que vio. */
export type PedidoDeMarcarHecho = DatosDeHechoAMano & {
  via: ViaDeAprobacion;
  /** El actualizadoEn de la tarjeta que tenía la pantalla: se marca lo que se leyó. */
  vistaEn?: string;
};

/**
 * Marcar HECHO a mano una tarjeta con repo en ERROR, FALLIDO o POR_REVISAR cuyo cambio se terminó por
 * fuera del Coordinador. Quién puede y con qué datos lo decide `puedeMarcarHechoAMano`
 * (reglas-trabajador.ts). Se guarda solo si la tarjeta sigue igual que cuando se leyó (si el
 * Coordinador la tomó un instante antes, no se hace). El historial deja la nota, el commit, la vía y el
 * texto exacto del dueño. Lo que dejó el Coordinador (plan, rama, error) no se borra.
 */
export async function marcarHechoAMano(contexto: ContextoTablero, tarjetaId: unknown, pedido: PedidoDeMarcarHecho) {
  const actual = await tarjetaDelNegocio(contexto, tarjetaId);
  const [tipo, persona] = await Promise.all([
    reglasDelTipo(actual.tipoId),
    personaQueAprueba(contexto.workspaceId, contexto.userId),
  ]);
  const veredicto = puedeMarcarHechoAMano({
    via: pedido.via,
    origen: contexto.origen,
    estado: actual.estado,
    usaEstados: tipo.usaEstados,
    repo: actual.repo && esRepo(actual.repo) ? actual.repo : null,
    textoConfirmacion: pedido.textoConfirmacion,
    nota: pedido.nota,
    commit: pedido.commit,
    persona,
  });
  if ("error" in veredicto) throw new Error(veredicto.error);
  if (pedido.vistaEn && pedido.vistaEn !== actual.actualizadoEn.toISOString()) {
    throw new Error("La tarjeta cambió mientras la mirabas. Revísala de nuevo antes de marcarla hecha.");
  }
  const texto = typeof pedido.textoConfirmacion === "string" ? pedido.textoConfirmacion.trim().slice(0, 500) : null;
  const registro = registroDeHechoAMano({
    via: pedido.via,
    quienNombre: persona.nombre,
    userId: contexto.userId,
    nota: veredicto.nota,
    commit: veredicto.commit,
    textoConfirmacion: pedido.via === "voz" ? texto || null : null,
  });
  return prisma.$transaction(async (tx) => {
    // Condicionado al estado y al momento en que se leyó, al tipo y al repo: si el Coordinador la tomó
    // o alguien la editó un instante antes, no se marca.
    const hecho = await tx.tarjetaTablero.updateMany({
      where: {
        id: actual.id,
        estado: actual.estado,
        actualizadoEn: actual.actualizadoEn,
        tipoId: actual.tipoId,
        repo: actual.repo,
        ...NO_BORRADA,
      },
      data: { estado: "HECHO", trabajoVenceEn: null },
    });
    if (hecho.count !== 1) throw new Error(CAMBIO_EN_EL_MEDIO);
    const cambio = await anotar(tx, contexto, actual.id, "estado", { estado: actual.estado }, registro);
    // Si es la última parte de una tarjeta partida, la madre (en su etapa, sin candado) se cierra; si no, se quedaría ahí para siempre.
    await cerrarLaMadreConHistorial(tx, contexto, actual);
    await tocarTablero(tx, actual.tableroId);
    return {
      cambioId: cambio.id,
      titulo: actual.titulo,
      antes: actual.estado,
      ahora: "HECHO" as EstadoTarjetaTablero,
      quien: persona.nombre,
      nota: veredicto.nota,
      commit: veredicto.commit,
    };
  });
}

/** Si `parte` es una parte de una tarjeta partida y ya no queda ninguna en camino, cierra a la madre (con su historial). */
async function cerrarLaMadreConHistorial(tx: Tx, contexto: ContextoTablero, parte: { id: string; tableroId: string }) {
  const cerrada = await cerrarLaMadreDeLaParte(tx, parte);
  if (cerrada) await anotar(tx, contexto, cerrada.id, "estado", { estado: cerrada.antes }, { estado: cerrada.estado, nota: cerrada.nota });
}

/**
 * "Cerrar como fallida" desde la pantalla (26-oct-2026): el dueño o el ADMIN de la plataforma abandonan una tarjeta
 * con repo en ERROR o huérfana (PLANEANDO o EN_CURSO sin el candado vigente del Coordinador). La regla es
 * puedeCerrarComoFallida (reglas-trabajador.ts). Se guarda solo si la tarjeta sigue como se leyó (si el
 * Coordinador la tomó un instante antes, no se hace) y deja su fila en el historial (origen PANTALLA, quién).
 * Si era la última parte de una tarjeta partida, la madre se cierra también.
 */
export async function cerrarComoFallida(contexto: ContextoTablero, tarjetaId: unknown, vistaEn?: string) {
  const actual = await tarjetaDelNegocio(contexto, tarjetaId);
  const [tipo, persona, fila] = await Promise.all([
    reglasDelTipo(actual.tipoId),
    personaQueAprueba(contexto.workspaceId, contexto.userId),
    prisma.tarjetaTablero.findUnique({ where: { id: actual.id }, select: { trabajoVenceEn: true, resultado: true } }),
  ]);
  const partida = partidaDelResultado(fila?.resultado);
  const hijasVivas = partida
    ? await prisma.tarjetaTablero.findMany({ where: { id: { in: partida.hijas }, ...NO_BORRADA }, select: { estado: true } })
    : [];
  const ahora = new Date();
  const veredicto = puedeCerrarComoFallida({
    origen: contexto.origen,
    estado: actual.estado,
    usaEstados: tipo.usaEstados,
    repo: actual.repo,
    trabajoVenceEn: fila?.trabajoVenceEn ?? null,
    ahora,
    esperaPartes: esperaASusPartes(fila?.resultado, hijasVivas),
    persona,
  });
  if (veredicto) throw new Error(veredicto);
  if (vistaEn && vistaEn !== actual.actualizadoEn.toISOString()) {
    throw new Error("La tarjeta cambió mientras la mirabas. Revísala de nuevo antes de cerrarla.");
  }
  const registro = registroDeCierreComoFallida({
    quienNombre: persona.nombre,
    userId: contexto.userId,
    antes: actual.estado,
    esDueno: persona.esDueno,
  });
  return prisma.$transaction(async (tx) => {
    // Condicionado al estado, al momento en que se leyó, al repo y a que el Coordinador no tenga el candado vigente.
    const hecho = await tx.tarjetaTablero.updateMany({
      where: {
        id: actual.id,
        estado: actual.estado,
        actualizadoEn: actual.actualizadoEn,
        tipoId: actual.tipoId,
        repo: actual.repo,
        OR: [{ trabajoVenceEn: null }, { trabajoVenceEn: { lte: ahora } }],
        ...NO_BORRADA,
      },
      data: { estado: "FALLIDO", trabajoVenceEn: null },
    });
    if (hecho.count !== 1) throw new Error(CAMBIO_EN_EL_MEDIO);
    const cambio = await anotar(tx, contexto, actual.id, "estado", { estado: actual.estado }, registro);
    await cerrarLaMadreConHistorial(tx, contexto, actual);
    await tocarTablero(tx, actual.tableroId);
    return { cambioId: cambio.id, titulo: actual.titulo, antes: actual.estado, ahora: "FALLIDO" as EstadoTarjetaTablero, quien: persona.nombre };
  });
}

/**
 * Quién es esta persona para las aprobaciones del Tablero IA de este negocio: dueña (esDuenoDelNegocio:
 * la cuenta dueña registrada del negocio, aunque sea ADMIN, o una CLIENTE con rol OWNER; siempre
 * miembro activa), ADMIN de la plataforma y su fila de AprobadorTablero. Se lee de la base: el userId
 * sale de la sesión o de la clave MCP (la cuenta que creó la clave), nunca de un argumento.
 */
export async function personaQueAprueba(
  workspaceId: string,
  userId: string,
): Promise<PersonaQueAprueba & { nombre: string; correo: string | null }> {
  const [usuario, miembro, negocio, aprobador, hastaGuardado] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true, role: true } }),
    prisma.workspaceMember.findFirst({ where: { workspaceId, userId, isActive: true }, select: { role: true } }),
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { ownerId: true, owner: { select: { name: true, email: true } } },
    }),
    prisma.aprobadorTablero.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { alcance: true, puedeSubir: true },
    }),
    prisma.appSetting.findUnique({ where: { key: claveSistemasHasta(workspaceId) }, select: { value: true } }),
  ]);
  const nombre = usuario?.name?.trim() || usuario?.email || "Alguien";
  const cuenta: CuentaQueAprueba = {
    nombre,
    correo: usuario?.email ?? null,
    tipoCuenta: usuario?.role ?? null,
    miembroActivo: Boolean(miembro),
    rolEnNegocio: miembro?.role ?? null,
    esDuenaRegistrada: Boolean(negocio?.ownerId) && negocio?.ownerId === userId,
    duena: negocio?.owner
      ? { nombre: negocio.owner.name?.trim() || negocio.owner.email || "sin nombre", correo: negocio.owner.email ?? null }
      : null,
  };
  return {
    nombre,
    correo: cuenta.correo,
    esDueno: esDuenoDelNegocio(cuenta),
    esAdminPlataforma: usuario?.role === "ADMIN",
    cuenta,
    // Un aprobador que ya no es miembro activo del negocio no aprueba.
    aprobador: aprobador && miembro ? aprobador : null,
    // Prorrogar la prueba de Sistemas sin desplegar: el último día (AAAA-MM-DD) del ajuste manda sobre la constante.
    ...(/^\d{4}-\d{2}-\d{2}$/.test(hastaGuardado?.value?.trim() ?? "") ? { sistemasHasta: hastaGuardado!.value.trim() } : {}),
  };
}

/** AppSetting con el último día del permiso de prueba del aprobador de Sistemas (opcional; sin fila vale PRUEBA_SISTEMAS_HASTA). */
export const claveSistemasHasta = (workspaceId: string) => `tablero:aprobador-sistemas:hasta:${workspaceId}`;

/** Cómo llega una aprobación: el momento, por dónde, el texto de la persona (voz) y lo que vio (pantalla). */
export type PedidoDeAprobar = {
  momento: MomentoDeAprobacion | string;
  via: ViaDeAprobacion;
  textoConfirmacion?: unknown;
  /** El actualizadoEn de la tarjeta que tenía la pantalla: se aprueba lo que se leyó. */
  vistaEn?: string;
};

const CAMBIO_MIENTRAS_MIRABAS = "La tarjeta cambió mientras la mirabas. Revísala de nuevo antes de aprobar.";

/** La vía de la última aprobación vigente (sin deshacer) de la tarjeta, como la lee el filtro de /tomar: '' si no hay. */
async function viaDeLaUltimaAprobacion(tarjetaId: string): Promise<string> {
  const fila = await prisma.historialTarjeta.findFirst({
    where: { tarjetaId, accion: "aprobar", deshechoEn: null },
    orderBy: { creadoEn: "desc" },
    select: { despues: true },
  });
  const via = (fila?.despues as { via?: unknown } | null)?.via;
  return typeof via === "string" ? via : "";
}

/**
 * La ficha (28-oct-2026): si la tarjeta está APROBADO / PLAN_APROBADO y el Coordinador no la toma SOLO por la vía de su
 * aprobación (toca LIBRO_V3 o META_ADS y se aprobó por voz u otra vía), la línea que lo dice y el momento que se vuelve
 * a aprobar en la pantalla. null si no espera nada de eso.
 */
export async function esperaLaPantallaDeLaTarjeta(
  alcance: Alcance,
  tarjetaId: unknown,
): Promise<{ texto: string; zonas: string[]; via: string; momento: MomentoDeAprobacion } | null> {
  const tarjeta = await tarjetaDelNegocio(alcance, tarjetaId, { comoResponsable: true });
  if (!tarjeta.zonaProtegida.length || !tarjeta.repo) return null;
  if (tarjeta.estado !== "APROBADO" && !(tarjeta.estado === "PLAN_APROBADO" && tarjeta.plan?.trim())) return null;
  const via = await viaDeLaUltimaAprobacion(tarjeta.id);
  const zonas = zonasQueEsperanLaPantalla(tarjeta.zonaProtegida, via);
  if (!zonas.length) return null;
  return { texto: textoDeAprobarEnPantalla(tarjeta.titulo, zonas, via), zonas, via, momento: tarjeta.estado === "APROBADO" ? "tarea" : "plan" };
}

/**
 * Aprobar: la tarea (POR_APROBAR -> APROBADO), el plan (PLAN_LISTO -> PLAN_APROBADO), o el sí final
 * (POR_REVISAR -> SUBIENDO, solo el dueño). Reintentar desde ERROR es aprobar la tarea o el plan otra
 * vez. Quién puede, desde qué estado, por qué vía y con qué texto lo decide `puedeAprobarMomento`
 * (reglas-trabajador.ts); acá se lee la persona de la base y se escribe condicionado a lo que había,
 * con su fila de historial (nombre, momento, vía y el texto exacto).
 */
export async function aprobarTarjeta(contexto: ContextoTablero, tarjetaId: unknown, pedido: PedidoDeAprobar) {
  const actual = await tarjetaDelNegocio(contexto, tarjetaId);
  // Solo hace falta mirarla si ya está en la fila con zona (puede estar esperando la pantalla, 28-oct-2026).
  const mirarLaVia = actual.zonaProtegida.length > 0 && (actual.estado === "APROBADO" || actual.estado === "PLAN_APROBADO");
  const [tipo, persona, viaAnterior] = await Promise.all([
    reglasDelTipo(actual.tipoId),
    personaQueAprueba(contexto.workspaceId, contexto.userId),
    mirarLaVia ? viaDeLaUltimaAprobacion(actual.id) : Promise.resolve(undefined),
  ]);
  const resultado = (actual.resultado ?? {}) as { paso?: unknown };
  // Solo el aprobador de Sistemas necesita el área de la tarjeta (sube por las madres): a los demás no se les gasta la consulta.
  const esSistemas = !persona.esDueno && persona.aprobador?.alcance === ALCANCE_SISTEMAS;
  const tarjetaParaSistemas = esSistemas
    ? {
        titulo: actual.titulo,
        detalle: actual.detalle,
        plan: actual.plan,
        area: (await leerAreasDeTarjetas(contexto.workspaceId, [actual.id])).get(actual.id) ?? null,
      }
    : null;
  const veredicto = puedeAprobarMomento({
    momento: pedido.momento,
    via: pedido.via,
    origen: contexto.origen,
    estado: actual.estado,
    requiereAprobacion: tipo.requiereAprobacion,
    usaEstados: tipo.usaEstados,
    repo: actual.repo && esRepo(actual.repo) ? actual.repo : null,
    zonaProtegida: actual.zonaProtegida,
    tienePlan: Boolean(actual.plan?.trim()),
    resultadoPaso: resultado.paso === true,
    textoConfirmacion: pedido.textoConfirmacion,
    persona,
    tarjeta: tarjetaParaSistemas,
    ...(viaAnterior !== undefined ? { viaDeLaUltimaAprobacion: viaAnterior } : {}),
  });
  if ("error" in veredicto) throw new Error(veredicto.error);
  if (pedido.vistaEn && pedido.vistaEn !== actual.actualizadoEn.toISOString()) {
    throw new Error(CAMBIO_MIENTRAS_MIRABAS);
  }
  const texto = typeof pedido.textoConfirmacion === "string" ? pedido.textoConfirmacion.trim().slice(0, 500) : null;
  const registro = registroDeAprobacion({
    estado: veredicto.a,
    momento: veredicto.momento,
    via: pedido.via,
    quienNombre: persona.nombre,
    userId: contexto.userId,
    textoConfirmacion: texto || null,
    // Toda aprobación de Emanuel queda marcada como "periodo de prueba".
    ...(esSistemas ? { periodoDePrueba: true as const } : {}),
  });
  return prisma.$transaction(async (tx) => {
    // Condicionado al estado, al momento en que se leyó, al tipo y al repo: si Claude la editó o el
    // Coordinador la movió un instante antes, no se aprueba algo que la persona no vio.
    const hecho = await tx.tarjetaTablero.updateMany({
      where: {
        id: actual.id,
        estado: actual.estado,
        actualizadoEn: actual.actualizadoEn,
        tipoId: actual.tipoId,
        repo: actual.repo,
        tipo: { requiereAprobacion: true, usaEstados: true },
        ...NO_BORRADA,
      },
      // SUBIENDO queda "pendiente" (sin candado) hasta que el Coordinador la tome; reintentar suelta el candado.
      // Reintentar (desde ERROR) también devuelve las reparaciones a 0: empiezan otras 3.
      data: { estado: veredicto.a, trabajoVenceEn: null, ...(actual.estado === "ERROR" ? { reparaciones: 0 } : {}) },
    });
    if (hecho.count !== 1) {
      throw new Error(CAMBIO_MIENTRAS_MIRABAS);
    }
    const cambio = await anotar(tx, contexto, actual.id, "aprobar", { estado: actual.estado }, registro);
    await tocarTablero(tx, actual.tableroId);
    return {
      cambioId: cambio.id,
      titulo: actual.titulo,
      antes: actual.estado,
      ahora: veredicto.a,
      momento: veredicto.momento,
      quien: persona.nombre,
      quienCorreo: persona.correo,
    };
  });
}

/**
 * La pantalla cambia las zonas protegidas de una tarjeta. Agregar puede cualquiera que apruebe;
 * QUITAR solo el dueño. No mientras el Coordinador la tiene.
 */
export async function cambiarZonasEnPantalla(contexto: ContextoTablero, tarjetaId: unknown, zonas: unknown) {
  if (contexto.origen !== "PANTALLA") throw new Error("Las zonas protegidas se quitan solo en la pantalla.");
  const actual = await tarjetaDelNegocio(contexto, tarjetaId);
  const enManos = puedeEditarTarjeta(actual.estado, Boolean(actual.repo));
  if (enManos) throw new Error(enManos);
  const final = zonasDeEntrada(zonas) ?? [];
  const persona = await personaQueAprueba(contexto.workspaceId, contexto.userId);
  const veredicto = puedeCambiarZonas("PANTALLA", actual.zonaProtegida, final, persona.esDueno);
  if (veredicto) throw new Error(veredicto);
  if (final.join(",") === actual.zonaProtegida.join(",")) throw new Error("No hay nada distinto para cambiar.");
  return prisma.$transaction(async (tx) => {
    const hecho = await tx.tarjetaTablero.updateMany({
      where: { id: actual.id, estado: actual.estado, ...NO_BORRADA },
      data: { zonaProtegida: final },
    });
    if (hecho.count !== 1) throw new Error(CAMBIO_EN_EL_MEDIO);
    const cambio = await anotar(tx, contexto, actual.id, "editar", { zonaProtegida: actual.zonaProtegida }, { zonaProtegida: final });
    await tocarTablero(tx, actual.tableroId);
    return { cambioId: cambio.id };
  });
}

/** Una flecha como queda guardada en el historial de un borrado. */
type FlechaGuardada = { id: string; origenId: string; destinoId: string; esDependencia?: boolean };

/**
 * Borrar una tarjeta (borrado suave): se marca borradoEn y se quitan TODAS sus flechas (salientes y
 * entrantes), que quedan guardadas en el historial para deshacerlo. Sus hijas no se tocan: se ven
 * sueltas hasta que se deshaga.
 *
 * Por voz (MCP con `textoConfirmacion`, lo que dijo la persona): PLAN_LISTO o ERROR se borran solo si
 * la cuenta de la clave es la dueña del negocio (personaQueAprueba). El historial guarda quién, el
 * texto exacto y la marca "borrado por voz por <nombre>"; con esa marca, deshacer la trae de vuelta.
 */
export async function borrarTarjeta(contexto: ContextoTablero, tarjetaId: unknown, textoConfirmacion?: unknown) {
  const actual = await tarjetaDelNegocio(contexto, tarjetaId);
  const porVoz = contexto.origen === "MCP" && textoConfirmacion !== undefined && textoConfirmacion !== null;
  const persona = porVoz ? await personaQueAprueba(contexto.workspaceId, contexto.userId) : null;
  const confirmacion = persona
    ? {
        problemaDelTexto: textoDeConfirmacionParaBorrar(textoConfirmacion),
        problemaDeLaCuenta: persona.cuenta ? motivoNoEsDueno(persona.cuenta, "voz") : null,
      }
    : undefined;
  const veredicto = puedeBorrarTarjeta(contexto.origen, actual.estado, actual.zonaProtegida, confirmacion);
  if (veredicto) throw new Error(veredicto);
  const registroDeVoz = persona
    ? {
        via: "voz",
        quienNombre: persona.nombre,
        userId: contexto.userId,
        textoConfirmacion: String(textoConfirmacion).trim().slice(0, 500),
        como: `borrado por voz por ${persona.nombre}`,
      }
    : {};
  return prisma.$transaction(async (tx) => {
    const flechas: FlechaGuardada[] = await tx.conexionTarjeta.findMany({
      where: { tableroId: actual.tableroId, OR: [{ origenId: actual.id }, { destinoId: actual.id }] },
      select: { id: true, origenId: true, destinoId: true, esDependencia: true },
    });
    const ahora = new Date();
    // Condicionado al estado que se leyó (si el Coordinador la tomó un instante antes, no se borra) y,
    // desde Claude, a que siga sin zona protegida.
    const hecho = await tx.tarjetaTablero.updateMany({
      where: {
        id: actual.id,
        estado: actual.estado,
        ...(contexto.origen === "PANTALLA" ? {} : { zonaProtegida: { isEmpty: true } }),
        ...NO_BORRADA,
      },
      data: { borradoEn: ahora },
    });
    if (hecho.count !== 1) throw new Error(CAMBIO_EN_EL_MEDIO);
    if (flechas.length) await tx.conexionTarjeta.deleteMany({ where: { id: { in: flechas.map((f) => f.id) } } });
    const hijas = await tx.tarjetaTablero.count({ where: { padreId: actual.id, ...NO_BORRADA } });
    const cambio = await anotar(
      tx,
      contexto,
      actual.id,
      "borrar",
      { estado: actual.estado, borradoEn: null, conexiones: flechas },
      { borradoEn: ahora.toISOString(), ...registroDeVoz },
    );
    await tocarTablero(tx, actual.tableroId);
    return {
      cambioId: cambio.id,
      titulo: actual.titulo,
      estado: actual.estado,
      flechas: flechas.length,
      hijas,
      como: persona ? `borrado por voz por ${persona.nombre}` : null,
    };
  });
}

export async function deshacerCambioTarjeta(contexto: ContextoTablero, cambioId: unknown) {
  const id = typeof cambioId === "string" ? cambioId.trim() : "";
  const cambio = id
    ? await prisma.historialTarjeta.findFirst({
        where: { id, tarjeta: { tablero: dondeTablero(contexto) } },
        select: {
          id: true,
          tarjetaId: true,
          accion: true,
          origen: true,
          antes: true,
          despues: true,
          deshechoEn: true,
          creadoEn: true,
          tarjeta: { select: { ...SELECT_TARJETA, tableroId: true, borradoEn: true } },
        },
      })
    : null;
  if (!cambio) {
    throw new Error("No existe ese cambio en este negocio. Ver ver_historial_tarjeta para los ids.");
  }
  const tarjeta = cambio.tarjeta;
  const posteriores = await prisma.historialTarjeta.findMany({
    where: { tarjetaId: cambio.tarjetaId, creadoEn: { gte: cambio.creadoEn }, NOT: { id: cambio.id } },
    select: { id: true, accion: true, origen: true, antes: true, despues: true, deshechoEn: true, creadoEn: true },
  });
  const veredicto = puedeDeshacer(cambio, posteriores, tarjeta.estado);
  if (veredicto) {
    throw new Error(veredicto);
  }
  if (tarjeta.borradoEn && cambio.accion !== "borrar") {
    throw new Error("La tarjeta está borrada. Primero hay que deshacer el borrado (ver ver_historial_tarjeta).");
  }

  if (cambio.accion === "borrar") {
    if (!tarjeta.borradoEn) throw new Error("La tarjeta no está borrada.");
    const tipos = await tiposDelTablero(prisma, tarjeta.tableroId);
    const tipo = tipos.find((uno) => uno.id === tarjeta.tipoId);
    const estadoMalo = tipo ? estadoPermitidoParaTipo(tarjeta.estado, tipo.requiereAprobacion, tipo.usaEstados) : null;
    if (estadoMalo) {
      throw new Error(`No se puede devolver tal como estaba: ${estadoMalo} Pídele al dueño que lo revise.`);
    }
    const guardadas = ((cambio.antes ?? {}) as { conexiones?: FlechaGuardada[] }).conexiones ?? [];
    const otraPunta = (f: FlechaGuardada) => (f.origenId === tarjeta.id ? f.destinoId : f.origenId);
    const vivas = new Set(
      (
        await prisma.tarjetaTablero.findMany({
          where: { id: { in: [...new Set(guardadas.map(otraPunta))] }, tableroId: tarjeta.tableroId, ...NO_BORRADA },
          select: { id: true },
        })
      ).map((fila) => fila.id),
    );
    const volver = guardadas.filter((f) => vivas.has(otraPunta(f)));
    return prisma.$transaction(async (tx) => {
      const hecho = await tx.tarjetaTablero.updateMany({
        where: { id: tarjeta.id, borradoEn: { not: null } },
        data: { borradoEn: null },
      });
      if (hecho.count !== 1) throw new Error(CAMBIO_EN_EL_MEDIO);
      if (volver.length) {
        // Con sus mismos ids: así el "conectar" del historial de la otra tarjeta sigue sirviendo.
        await tx.conexionTarjeta.createMany({
          data: volver.map((f) => ({
            id: f.id,
            tableroId: tarjeta.tableroId,
            origenId: f.origenId,
            destinoId: f.destinoId,
            esDependencia: f.esDependencia === true,
          })),
          skipDuplicates: true,
        });
      }
      await tx.historialTarjeta.update({ where: { id: cambio.id }, data: { deshechoEn: new Date() } });
      const nuevo = await anotar(
        tx,
        contexto,
        tarjeta.id,
        "deshacer",
        { borradoEn: isoONull(tarjeta.borradoEn), deshace: cambio.id },
        { borradoEn: null, conexiones: volver },
      );
      await tocarTablero(tx, tarjeta.tableroId);
      const perdidas = guardadas.length - volver.length;
      return {
        cambioId: nuevo.id,
        aviso: `Listo: "${tarjeta.titulo}" volvió al tablero con ${volver.length} flecha(s)${
          perdidas ? ` (${perdidas} no, porque la otra tarjeta está borrada)` : ""
        }.`,
      };
    });
  }

  if (cambio.accion === "crear") {
    // Una flecha que llega desde otra tarjeta queda en el historial de ESA tarjeta: se revisa aparte.
    const [conexiones, hijas] = await Promise.all([
      prisma.conexionTarjeta.count({ where: { OR: [{ origenId: tarjeta.id }, { destinoId: tarjeta.id }] } }),
      prisma.tarjetaTablero.count({ where: { padreId: tarjeta.id, ...NO_BORRADA } }),
    ]);
    if (conexiones) {
      throw new Error("La tarjeta tiene flechas. Primero hay que deshacer esas conexiones.");
    }
    if (hijas) {
      throw new Error(`La tarjeta tiene ${hijas} hija(s). Primero hay que moverlas o deshacerlas (o usar borrar_tarjeta).`);
    }
    return prisma.$transaction(async (tx) => {
      // Se borra con su historial (no queda nada de una tarjeta que nunca debió existir).
      const borrada = await tx.tarjetaTablero.deleteMany({ where: { id: tarjeta.id, estado: tarjeta.estado, ...NO_BORRADA } });
      if (borrada.count !== 1) throw new Error(CAMBIO_EN_EL_MEDIO);
      await tocarTablero(tx, tarjeta.tableroId);
      return { aviso: `Listo: la tarjeta "${tarjeta.titulo}" se sacó del tablero.` };
    });
  }

  if (cambio.accion === "conectar") {
    const datos = (cambio.despues ?? {}) as { conexionId?: string; origenId?: string; destinoId?: string };
    const existe = await prisma.conexionTarjeta.count({ where: { id: datos.conexionId ?? "", tableroId: tarjeta.tableroId } });
    if (!existe) {
      throw new Error("Esa flecha ya no está (se borró una de las dos tarjetas). Si se deshace ese borrado, vuelve.");
    }
    return prisma.$transaction(async (tx) => {
      await tx.conexionTarjeta.deleteMany({ where: { id: datos.conexionId ?? "", tableroId: tarjeta.tableroId } });
      await tx.historialTarjeta.update({ where: { id: cambio.id }, data: { deshechoEn: new Date() } });
      const nuevo = await anotar(tx, contexto, tarjeta.id, "deshacer", { ...datos, deshace: cambio.id }, null);
      await tocarTablero(tx, tarjeta.tableroId);
      return { cambioId: nuevo.id, aviso: "Listo: se quitó esa flecha." };
    });
  }

  // Marcar una flecha como dependencia (o quitarlo): se vuelve a lo de antes.
  const flechaAntes = (cambio.antes ?? {}) as { conexionId?: unknown; esDependencia?: unknown };
  if (cambio.accion === "editar" && typeof flechaAntes.conexionId === "string" && typeof flechaAntes.esDependencia === "boolean") {
    const conexionId = flechaAntes.conexionId;
    const vuelve = flechaAntes.esDependencia;
    const conexion = await prisma.conexionTarjeta.findFirst({
      where: { id: conexionId, tableroId: tarjeta.tableroId },
      select: { id: true, origenId: true, destinoId: true, esDependencia: true },
    });
    if (!conexion) throw new Error("Esa flecha ya no está (se borró una de las dos tarjetas).");
    if (vuelve) await revisarCicloDeDependencias(tarjeta.tableroId, conexion.origenId, conexion.destinoId, conexion.id);
    return prisma.$transaction(async (tx) => {
      await tx.conexionTarjeta.updateMany({ where: { id: conexion.id }, data: { esDependencia: vuelve } });
      await tx.historialTarjeta.update({ where: { id: cambio.id }, data: { deshechoEn: new Date() } });
      const nuevo = await anotar(tx, contexto, tarjeta.id, "deshacer", { esDependencia: conexion.esDependencia, deshace: cambio.id }, { esDependencia: vuelve });
      await tocarTablero(tx, tarjeta.tableroId);
      return { cambioId: nuevo.id, aviso: vuelve ? "Listo: la flecha volvió a ser una dependencia." : "Listo: la flecha ya no es una dependencia." };
    });
  }

  // editar | estado: se restaura el "antes" campo por campo.
  const antes = (cambio.antes ?? {}) as Record<string, unknown>;
  const datos: Prisma.TarjetaTableroUncheckedUpdateManyInput = {};
  const ahora: Record<string, unknown> = { deshace: cambio.id };
  if (typeof antes.titulo === "string") {
    datos.titulo = antes.titulo;
    ahora.titulo = tarjeta.titulo;
  }
  if (typeof antes.detalle === "string") {
    datos.detalle = antes.detalle;
    ahora.detalle = tarjeta.detalle;
  }
  if ("area" in antes) {
    datos.area = typeof antes.area === "string" ? antes.area : null;
    ahora.area = tarjeta.area;
  }
  if (typeof antes.orden === "number") {
    datos.orden = antes.orden;
    ahora.orden = tarjeta.orden;
  }
  if ("fecha" in antes) {
    datos.fecha = typeof antes.fecha === "string" ? new Date(antes.fecha) : null;
    ahora.fecha = isoONull(tarjeta.fecha);
  }
  if ("link" in antes) {
    datos.link = typeof antes.link === "string" ? antes.link : null;
    ahora.link = tarjeta.link;
  }
  if ("linkTexto" in antes) {
    datos.linkTexto = typeof antes.linkTexto === "string" ? antes.linkTexto : null;
    ahora.linkTexto = tarjeta.linkTexto;
  }
  const tipoRestaurado = typeof antes.tipoId === "string" ? antes.tipoId : undefined;
  if (tipoRestaurado) {
    datos.tipoId = tipoRestaurado;
    ahora.tipoId = tarjeta.tipoId;
  }
  const padreRestaurado = "padreId" in antes ? (typeof antes.padreId === "string" ? antes.padreId : null) : undefined;
  if (padreRestaurado !== undefined) {
    datos.padreId = padreRestaurado;
    ahora.padreId = tarjeta.padreId;
  }
  if ("repo" in antes) {
    datos.repo = typeof antes.repo === "string" ? antes.repo : null;
    ahora.repo = tarjeta.repo;
  }
  if (Array.isArray(antes.zonaProtegida)) {
    const vuelven = antes.zonaProtegida.filter((zona): zona is string => typeof zona === "string");
    // Deshacer el agregado de una zona protegida sería QUITARLA: eso es solo del dueño en la pantalla.
    if (tarjeta.zonaProtegida.some((zona) => !vuelven.includes(zona))) {
      throw new Error("Deshacer eso quitaría una zona protegida, y eso lo hace solo el dueño en la pantalla.");
    }
    datos.zonaProtegida = vuelven;
    ahora.zonaProtegida = tarjeta.zonaProtegida;
  }
  if ("riesgo" in antes) {
    // Deshacer nunca deja una tarjeta en BAJO: BAJO se pone con editar_tarjeta, que revisa las reglas.
    if (antes.riesgo === "BAJO") {
      throw new Error("Deshacer eso dejaría la tarjeta en riesgo BAJO. Se pone de nuevo con editar_tarjeta, que revisa las reglas de riesgo.");
    }
    datos.riesgo = typeof antes.riesgo === "string" ? antes.riesgo : null;
    ahora.riesgo = tarjeta.riesgo;
  }
  if ("riesgoMotivo" in antes) {
    datos.riesgoMotivo = typeof antes.riesgoMotivo === "string" ? antes.riesgoMotivo : null;
    ahora.riesgoMotivo = tarjeta.riesgoMotivo;
  }
  if ("riesgoPor" in antes) {
    datos.riesgoPor = typeof antes.riesgoPor === "string" ? antes.riesgoPor : null;
    ahora.riesgoPor = tarjeta.riesgoPor;
  }
  if ("responsableId" in antes) {
    const anterior = typeof antes.responsableId === "string" ? antes.responsableId : null;
    // Solo se devuelve a alguien que sigue siendo una persona activa del negocio.
    if (anterior) {
      const sigue = await prisma.workspaceMember.count({
        where: { workspaceId: contexto.workspaceId, userId: anterior, isActive: true },
      });
      if (!sigue) {
        throw new Error("Quien era responsable antes ya no es una persona activa del negocio: no se puede deshacer. Asigna a alguien con editar_tarjeta.");
      }
    }
    datos.responsableId = anterior;
    ahora.responsableId = tarjeta.responsableId;
    ahora.responsableNombre = tarjeta.responsable ? nombreDePersona(tarjeta.responsable) : null;
  }
  const estadoRestaurado = esEstado(antes.estado) ? antes.estado : undefined;
  if (estadoRestaurado) {
    datos.estado = estadoRestaurado;
    ahora.estado = tarjeta.estado;
  }
  const enManos = puedeEditarTarjeta(tarjeta.estado, Boolean(tarjeta.repo));
  if (enManos) throw new Error(enManos);

  // Lo restaurado tiene que cumplir las reglas de hoy: tipo existente, estado válido para el tipo,
  // madre permitida y sin ciclos, hijas que sigan pudiendo colgar.
  if (tipoRestaurado || padreRestaurado !== undefined || estadoRestaurado) {
    const tipos = await tiposDelTablero(prisma, tarjeta.tableroId);
    const tipoFinal = tipos.find((tipo) => tipo.id === (tipoRestaurado ?? tarjeta.tipoId));
    if (!tipoFinal) {
      throw new Error("El tipo que tenía antes ya no existe en el tablero: no se puede deshacer. Edita la tarjeta a mano.");
    }
    const estadoMalo = estadoPermitidoParaTipo(
      estadoRestaurado ?? tarjeta.estado,
      tipoFinal.requiereAprobacion,
      tipoFinal.usaEstados,
    );
    if (estadoMalo) throw new Error(`No se puede deshacer: ${estadoMalo}`);
    const padreFinal = padreRestaurado !== undefined ? padreRestaurado : tarjeta.padreId;
    if (padreFinal && (padreRestaurado !== undefined || tipoRestaurado)) {
      const madreViva = await prisma.tarjetaTablero.count({ where: { id: padreFinal, ...NO_BORRADA } });
      // Si la madre de antes está borrada, vuelve a apuntarle y se ve suelta (como sus hermanas).
      if (madreViva) {
        await revisarMadre({ id: tarjeta.id, tipoId: tipoFinal.id, tableroId: tarjeta.tableroId }, padreFinal, tipos);
      }
    }
    if (tipoRestaurado && tipoRestaurado !== tarjeta.tipoId) await revisarHijas(tarjeta.id, tipoFinal.id, tipos);
  }
  const restaurado = { ...antes };

  return prisma.$transaction(async (tx) => {
    const hecho = await tx.tarjetaTablero.updateMany({
      where: { id: tarjeta.id, estado: tarjeta.estado, ...NO_BORRADA },
      data: datos,
    });
    if (hecho.count !== 1) throw new Error(CAMBIO_EN_EL_MEDIO);
    await tx.historialTarjeta.update({ where: { id: cambio.id }, data: { deshechoEn: new Date() } });
    const nuevo = await anotar(tx, contexto, tarjeta.id, "deshacer", ahora, restaurado);
    await tocarTablero(tx, tarjeta.tableroId);
    return { cambioId: nuevo.id, aviso: `Listo: "${tarjeta.titulo}" quedó como estaba antes de ese cambio.` };
  });
}
