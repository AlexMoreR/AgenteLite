import { Prisma, type EstadoTarjeta } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  ESTADOS_AL_CREAR,
  esEstado,
  estadoTrasEditar,
  fechaDeEntrada,
  puedeAprobar,
  puedeCambiarEstado,
  puedeDeshacer,
  textoLimpio,
  type AccionCambio,
  type EstadoTarjetaTablero,
  type OrigenCambio,
} from "./reglas";

/*
  TABLEROS INTELIGENTES: la lógica compartida entre el MCP (Claude) y la pantalla (el dueño).

  Tres cosas en cada escritura, en UNA transacción:
  1. la tarjeta (o la conexión),
  2. su fila en HistorialTarjeta (quién, cuándo, desde dónde, antes y después),
  3. `TableroInteligente.actualizadoEn`, que es lo único que lee el refresco de 5 s de la pantalla.

  El negocio sale SIEMPRE del contexto (la clave MCP o la sesión), nunca de un argumento: cada id que
  llega se busca dentro de ese negocio. Las reglas de qué se puede están en reglas.ts.

  Fase 2 (no implementada): el trabajador que ejecuta lo APROBADO llamará `cambiarEstadoTarjeta` con
  origen TRABAJADOR, y aprobar por WhatsApp llamará `aprobarTarjeta` con su propia comprobación de
  dueño. El link de cada tarjeta ya existe: `linkDeLaTarjeta`.
*/

export type ContextoTablero = { workspaceId: string; userId: string; origen: OrigenCambio };

export const LIMITE_TABLEROS = 50;
export const LIMITE_TARJETAS = 300;
const MAX_TITULO = 200;
const MAX_DETALLE = 5000;
const MAX_AREA = 60;
const MAX_NOMBRE = 80;

const URL_APP = "https://app.aizenbot.com";
export const RUTA_TABLEROS = "/cliente/tableros-inteligentes";

export function linkDeLaTarjeta(tarjetaId: string) {
  return `${URL_APP}${RUTA_TABLEROS}?tarjeta=${encodeURIComponent(tarjetaId)}`;
}

export function linkDelTablero(tableroId: string) {
  return `${URL_APP}${RUTA_TABLEROS}?tablero=${encodeURIComponent(tableroId)}`;
}

/** Lo que la pantalla necesita de cada tarjeta (también es lo que viaja en el refresco). */
export type TarjetaVista = {
  id: string;
  titulo: string;
  detalle: string;
  area: string | null;
  estado: EstadoTarjetaTablero;
  orden: number;
  fecha: string | null;
  actualizadoEn: string;
};

export type ConexionVista = { id: string; origenId: string; destinoId: string };

export type TableroResumen = { id: string; nombre: string };

const SELECT_TARJETA = {
  id: true,
  titulo: true,
  detalle: true,
  area: true,
  estado: true,
  orden: true,
  fecha: true,
  actualizadoEn: true,
} as const;

type FilaTarjeta = Prisma.TarjetaTableroGetPayload<{ select: typeof SELECT_TARJETA }>;

function aVista(fila: FilaTarjeta): TarjetaVista {
  return {
    id: fila.id,
    titulo: fila.titulo,
    detalle: fila.detalle,
    area: fila.area,
    estado: fila.estado,
    orden: fila.orden,
    fecha: fila.fecha ? fila.fecha.toISOString() : null,
    actualizadoEn: fila.actualizadoEn.toISOString(),
  };
}

type Tx = Prisma.TransactionClient;

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

/** Un tablero de ESTE negocio, o error. */
async function tableroDelNegocio(workspaceId: string, tableroId: unknown) {
  const id = typeof tableroId === "string" ? tableroId.trim() : "";
  const tablero = id
    ? await prisma.tableroInteligente.findFirst({ where: { id, workspaceId }, select: { id: true, nombre: true } })
    : null;
  if (!tablero) {
    throw new Error("No existe ese tablero en este negocio. Ver listar_tableros para los ids.");
  }
  return tablero;
}

/** Una tarjeta de ESTE negocio (por su tablero), o error. */
async function tarjetaDelNegocio(workspaceId: string, tarjetaId: unknown) {
  const id = typeof tarjetaId === "string" ? tarjetaId.trim() : "";
  const tarjeta = id
    ? await prisma.tarjetaTablero.findFirst({
        where: { id, tablero: { workspaceId } },
        select: { ...SELECT_TARJETA, tableroId: true },
      })
    : null;
  if (!tarjeta) {
    throw new Error("No existe esa tarjeta en este negocio. Ver ver_tablero para los ids.");
  }
  return tarjeta;
}

/** Fecha en JSON del historial (ISO) para poder restaurarla. */
const isoONull = (fecha: Date | null | undefined) => (fecha ? fecha.toISOString() : null);

// ── Lectura ─────────────────────────────────────────────────────────────────────────────────

export async function listarTableros(workspaceId: string) {
  const tableros = await prisma.tableroInteligente.findMany({
    where: { workspaceId },
    orderBy: { creadoEn: "asc" },
    select: { id: true, nombre: true, creadoEn: true, actualizadoEn: true },
  });
  if (!tableros.length) {
    return [];
  }
  const conteos = await prisma.tarjetaTablero.groupBy({
    by: ["tableroId", "estado"],
    where: { tableroId: { in: tableros.map((tablero) => tablero.id) } },
    _count: { _all: true },
  });
  return tableros.map((tablero) => {
    const porEstado: Partial<Record<EstadoTarjetaTablero, number>> = {};
    let total = 0;
    for (const fila of conteos) {
      if (fila.tableroId === tablero.id) {
        porEstado[fila.estado] = fila._count._all;
        total += fila._count._all;
      }
    }
    return { ...tablero, total, porEstado };
  });
}

/** Tarjetas y conexiones de un tablero que ya se sabe que es del negocio. */
export async function contenidoDelTablero(tableroId: string) {
  const [tarjetas, conexiones] = await Promise.all([
    prisma.tarjetaTablero.findMany({
      where: { tableroId },
      orderBy: [{ orden: "asc" }, { creadoEn: "asc" }],
      select: SELECT_TARJETA,
    }),
    prisma.conexionTarjeta.findMany({
      where: { tableroId },
      orderBy: { creadoEn: "asc" },
      select: { id: true, origenId: true, destinoId: true },
    }),
  ]);
  return { tarjetas: tarjetas.map(aVista), conexiones: conexiones as ConexionVista[] };
}

export async function verTablero(workspaceId: string, tableroId: unknown) {
  const tablero = await tableroDelNegocio(workspaceId, tableroId);
  return { tablero, ...(await contenidoDelTablero(tablero.id)) };
}

/** Lo único que lee el refresco de 5 s: una fila por clave primaria. */
export async function firmaDelTablero(workspaceId: string, tableroId: string) {
  const fila = await prisma.tableroInteligente.findFirst({
    where: { id: tableroId, workspaceId },
    select: { actualizadoEn: true },
  });
  return fila?.actualizadoEn ?? null;
}

export async function historialDeTarjeta(workspaceId: string, tarjetaId: unknown) {
  const tarjeta = await tarjetaDelNegocio(workspaceId, tarjetaId);
  const filas = await prisma.historialTarjeta.findMany({
    where: { tarjetaId: tarjeta.id },
    orderBy: { creadoEn: "desc" },
    take: 100,
    select: { id: true, quien: true, origen: true, accion: true, antes: true, despues: true, deshechoEn: true, creadoEn: true },
  });
  const ids = [...new Set(filas.map((fila) => fila.quien))];
  const personas = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } })
    : [];
  const nombre = new Map(personas.map((persona) => [persona.id, persona.name?.trim() || persona.email || "Alguien"]));
  return {
    tarjeta: aVista(tarjeta),
    cambios: filas.map((fila) => ({ ...fila, quienNombre: nombre.get(fila.quien) ?? "Alguien" })),
  };
}

// ── Escritura ───────────────────────────────────────────────────────────────────────────────

export async function crearTablero(contexto: ContextoTablero, nombre: unknown) {
  const limpio = textoLimpio(nombre, MAX_NOMBRE);
  if (!limpio) {
    throw new Error("Hace falta el nombre del tablero.");
  }
  const existentes = await prisma.tableroInteligente.findMany({
    where: { workspaceId: contexto.workspaceId },
    select: { id: true, nombre: true },
  });
  const igual = existentes.find((tablero) => tablero.nombre.toLowerCase() === limpio.toLowerCase());
  if (igual) {
    throw new Error(`Ya existe un tablero "${igual.nombre}" (id ${igual.id}). Usa ese o elige otro nombre.`);
  }
  if (existentes.length >= LIMITE_TABLEROS) {
    throw new Error(`Este negocio ya tiene ${LIMITE_TABLEROS} tableros, que es el máximo.`);
  }
  return prisma.tableroInteligente.create({
    data: { workspaceId: contexto.workspaceId, nombre: limpio },
    select: { id: true, nombre: true },
  });
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
  },
) {
  const tablero = await tableroDelNegocio(contexto.workspaceId, datos.tableroId);
  const titulo = textoLimpio(datos.titulo, MAX_TITULO);
  if (!titulo) {
    throw new Error("Hace falta el título de la tarjeta.");
  }
  const estado = datos.estado === undefined ? "IDEA" : datos.estado;
  if (!(ESTADOS_AL_CREAR as readonly unknown[]).includes(estado)) {
    throw new Error("Una tarjeta nueva queda IDEA o POR_APROBAR. Aprobar lo hace solo el dueño en la pantalla.");
  }
  const fecha = fechaDeEntrada(datos.fecha) ?? null;
  const orden = typeof datos.orden === "number" && Number.isFinite(datos.orden) ? Math.trunc(datos.orden) : 0;
  const conectarCon = Array.isArray(datos.conectarCon)
    ? [...new Set(datos.conectarCon.filter((id): id is string => typeof id === "string" && id.trim() !== ""))]
    : [];

  const cuantas = await prisma.tarjetaTablero.count({ where: { tableroId: tablero.id } });
  if (cuantas >= LIMITE_TARJETAS) {
    throw new Error(`El tablero ya tiene ${LIMITE_TARJETAS} tarjetas, que es el máximo. Conviene crear otro tablero.`);
  }
  if (conectarCon.length) {
    const delTablero = await prisma.tarjetaTablero.count({ where: { id: { in: conectarCon }, tableroId: tablero.id } });
    if (delTablero !== conectarCon.length) {
      throw new Error("Alguna tarjeta de conectar_con no es de este tablero. Ver ver_tablero para los ids.");
    }
  }

  return prisma.$transaction(async (tx) => {
    const tarjeta = await tx.tarjetaTablero.create({
      data: {
        tableroId: tablero.id,
        titulo,
        detalle: textoLimpio(datos.detalle, MAX_DETALLE) ?? "",
        area: textoLimpio(datos.area, MAX_AREA) ?? null,
        estado: estado as EstadoTarjeta,
        orden,
        fecha,
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
    return { tarjeta: aVista(tarjeta), cambioId: cambio.id, tablero };
  });
}

/** Cuando dos escrituras chocan (el dueño aprobó mientras Claude editaba), se avisa en vez de pisar. */
const CAMBIO_EN_EL_MEDIO = "La tarjeta cambió mientras tanto (quizás el dueño la aprobó). Vuelve a leerla e intenta de nuevo.";

export async function editarTarjeta(
  contexto: ContextoTablero,
  tarjetaId: unknown,
  cambios: { titulo?: unknown; detalle?: unknown; area?: unknown; orden?: unknown; fecha?: unknown },
) {
  const actual = await tarjetaDelNegocio(contexto.workspaceId, tarjetaId);

  const nuevo: { titulo?: string; detalle?: string; area?: string | null; orden?: number; fecha?: Date | null } = {};
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
  if (!Object.keys(nuevo).length) {
    throw new Error("No hay nada distinto para cambiar.");
  }

  const estado = estadoTrasEditar(contexto.origen, actual.estado);
  const antes: Record<string, unknown> = {};
  const despues: Record<string, unknown> = {};
  for (const campo of Object.keys(nuevo) as (keyof typeof nuevo)[]) {
    antes[campo] = campo === "fecha" ? isoONull(actual.fecha) : actual[campo];
    despues[campo] = campo === "fecha" ? isoONull(nuevo.fecha) : nuevo[campo];
  }
  if (estado !== actual.estado) {
    antes.estado = actual.estado;
    despues.estado = estado;
  }

  return prisma.$transaction(async (tx) => {
    const hecho = await tx.tarjetaTablero.updateMany({
      where: { id: actual.id, estado: actual.estado },
      data: { ...nuevo, estado },
    });
    if (hecho.count !== 1) throw new Error(CAMBIO_EN_EL_MEDIO);
    const cambio = await anotar(tx, contexto, actual.id, "editar", antes, despues);
    await tocarTablero(tx, actual.tableroId);
    const tarjeta = await tx.tarjetaTablero.findUniqueOrThrow({ where: { id: actual.id }, select: SELECT_TARJETA });
    return { tarjeta: aVista(tarjeta), cambioId: cambio.id, volvioAPorAprobar: estado !== actual.estado };
  });
}

export async function conectarTarjetas(contexto: ContextoTablero, origenId: unknown, destinoId: unknown) {
  const origen = await tarjetaDelNegocio(contexto.workspaceId, origenId);
  const destino = await tarjetaDelNegocio(contexto.workspaceId, destinoId);
  if (origen.id === destino.id) {
    throw new Error("Una tarjeta no se conecta consigo misma.");
  }
  if (origen.tableroId !== destino.tableroId) {
    throw new Error("Las dos tarjetas tienen que ser del mismo tablero.");
  }
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
        data: { tableroId: origen.tableroId, origenId: origen.id, destinoId: destino.id },
        select: { id: true, origenId: true, destinoId: true },
      });
      const cambio = await anotar(tx, contexto, origen.id, "conectar", null, {
        conexionId: conexion.id,
        origenId: origen.id,
        destinoId: destino.id,
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

export async function cambiarEstadoTarjeta(contexto: ContextoTablero, tarjetaId: unknown, estado: unknown) {
  if (!esEstado(estado)) {
    throw new Error("Estado desconocido. Van: IDEA, POR_APROBAR, EN_CURSO, HECHO o FALLIDO.");
  }
  const actual = await tarjetaDelNegocio(contexto.workspaceId, tarjetaId);
  const veredicto = puedeCambiarEstado(actual.estado, estado);
  if (veredicto) {
    throw new Error(veredicto);
  }
  return prisma.$transaction(async (tx) => {
    const hecho = await tx.tarjetaTablero.updateMany({
      where: { id: actual.id, estado: actual.estado },
      data: { estado },
    });
    if (hecho.count !== 1) throw new Error(CAMBIO_EN_EL_MEDIO);
    const cambio = await anotar(tx, contexto, actual.id, "estado", { estado: actual.estado }, { estado });
    await tocarTablero(tx, actual.tableroId);
    return { cambioId: cambio.id, antes: actual.estado, ahora: estado, titulo: actual.titulo };
  });
}

/**
 * Aprobar. Quien llama ya comprobó que la persona puede aprobar (dueño o ADMIN de la plataforma);
 * acá se comprueba el estado (solo desde POR_APROBAR) y que no venga del MCP.
 */
export async function aprobarTarjeta(contexto: ContextoTablero, tarjetaId: unknown, vistaEn?: string) {
  const actual = await tarjetaDelNegocio(contexto.workspaceId, tarjetaId);
  const veredicto = puedeAprobar(contexto.origen, actual.estado);
  if (veredicto) {
    throw new Error(veredicto);
  }
  // vistaEn = el actualizadoEn de la tarjeta que tenía la pantalla: se aprueba lo que se leyó.
  if (vistaEn && vistaEn !== actual.actualizadoEn.toISOString()) {
    throw new Error("La tarjeta cambió mientras la mirabas. Revísala de nuevo antes de aprobar.");
  }
  return prisma.$transaction(async (tx) => {
    // Condicionado al estado: si Claude la editó o la movió un instante antes, no se aprueba algo
    // que el dueño no vio.
    const hecho = await tx.tarjetaTablero.updateMany({
      where: { id: actual.id, estado: "POR_APROBAR", actualizadoEn: actual.actualizadoEn },
      data: { estado: "APROBADO" },
    });
    if (hecho.count !== 1) {
      throw new Error("La tarjeta cambió mientras la mirabas. Revísala de nuevo antes de aprobar.");
    }
    const cambio = await anotar(tx, contexto, actual.id, "aprobar", { estado: actual.estado }, { estado: "APROBADO" });
    await tocarTablero(tx, actual.tableroId);
    return { cambioId: cambio.id, titulo: actual.titulo };
  });
}

export async function deshacerCambioTarjeta(contexto: ContextoTablero, cambioId: unknown) {
  const id = typeof cambioId === "string" ? cambioId.trim() : "";
  const cambio = id
    ? await prisma.historialTarjeta.findFirst({
        where: { id, tarjeta: { tablero: { workspaceId: contexto.workspaceId } } },
        select: {
          id: true,
          tarjetaId: true,
          accion: true,
          origen: true,
          antes: true,
          despues: true,
          deshechoEn: true,
          creadoEn: true,
          tarjeta: { select: { ...SELECT_TARJETA, tableroId: true } },
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

  if (cambio.accion === "crear") {
    // Una flecha que llega desde otra tarjeta queda en el historial de ESA tarjeta: se revisa aparte.
    const conexiones = await prisma.conexionTarjeta.count({
      where: { OR: [{ origenId: tarjeta.id }, { destinoId: tarjeta.id }] },
    });
    if (conexiones) {
      throw new Error("La tarjeta tiene flechas. Primero hay que deshacer esas conexiones.");
    }
    return prisma.$transaction(async (tx) => {
      // Se borra con su historial (no queda nada de una tarjeta que nunca debió existir).
      const borrada = await tx.tarjetaTablero.deleteMany({ where: { id: tarjeta.id, estado: tarjeta.estado } });
      if (borrada.count !== 1) throw new Error(CAMBIO_EN_EL_MEDIO);
      await tocarTablero(tx, tarjeta.tableroId);
      return { aviso: `Listo: la tarjeta "${tarjeta.titulo}" se sacó del tablero.` };
    });
  }

  if (cambio.accion === "conectar") {
    const datos = (cambio.despues ?? {}) as { conexionId?: string; origenId?: string; destinoId?: string };
    return prisma.$transaction(async (tx) => {
      await tx.conexionTarjeta.deleteMany({ where: { id: datos.conexionId ?? "", tableroId: tarjeta.tableroId } });
      await tx.historialTarjeta.update({ where: { id: cambio.id }, data: { deshechoEn: new Date() } });
      const nuevo = await anotar(tx, contexto, tarjeta.id, "deshacer", { ...datos, deshace: cambio.id }, null);
      await tocarTablero(tx, tarjeta.tableroId);
      return { cambioId: nuevo.id, aviso: "Listo: se quitó esa flecha." };
    });
  }

  // editar | estado: se restaura el "antes" campo por campo.
  const antes = (cambio.antes ?? {}) as Record<string, unknown>;
  const datos: Prisma.TarjetaTableroUpdateManyMutationInput = {};
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
  if (esEstado(antes.estado)) {
    datos.estado = antes.estado;
    ahora.estado = tarjeta.estado;
  }
  const restaurado = { ...antes };

  return prisma.$transaction(async (tx) => {
    const hecho = await tx.tarjetaTablero.updateMany({ where: { id: tarjeta.id, estado: tarjeta.estado }, data: datos });
    if (hecho.count !== 1) throw new Error(CAMBIO_EN_EL_MEDIO);
    await tx.historialTarjeta.update({ where: { id: cambio.id }, data: { deshechoEn: new Date() } });
    const nuevo = await anotar(tx, contexto, tarjeta.id, "deshacer", ahora, restaurado);
    await tocarTablero(tx, tarjeta.tableroId);
    return { cambioId: nuevo.id, aviso: `Listo: "${tarjeta.titulo}" quedó como estaba antes de ese cambio.` };
  });
}
