import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { esEstado, type EstadoTarjetaTablero } from "./reglas";
import {
  AL_TOMAR,
  ETAPA_DEL_ESTADO,
  MINUTOS_DE_GRACIA_DEL_LATIDO,
  MOTIVO_VENCIDA,
  NOMBRE_DE_LA_ZONA,
  REPOS_DEL_TRABAJADOR,
  TOPE_DE_ESPERAS_SEGUIDAS,
  TOPE_DE_REPARACIONES,
  TRANSICIONES_DEL_TRABAJADOR,
  categoriaDeEntrada,
  causaConEstrategia,
  causaDeEntrada,
  destinoDelResultado,
  errorDeIntentoDeEntrada,
  esperasSeguidas,
  esZona,
  estadoTrasReparar,
  estrategiaDeEntrada,
  etapaDeEntrada,
  detalleDeLaParte,
  linkDeEntrada,
  madreSeCierra,
  opcionesDeTomar,
  motivoDeEntrada,
  partesDeEntrada,
  partidaDelResultado,
  planDeEntrada,
  puedeElTrabajador,
  puedePartir,
  puedeReparar,
  registroDeAprobacion,
  resultadoDeEntrada,
  resumenDeEscalada,
  reversionDeEntrada,
  tituloDeLaParte,
  unirZonas,
  vencimientoDelCandado,
  zonasDeEntrada,
  type AccionDeIntento,
  type AccionDelTrabajador,
  type CategoriaDeIntento,
  type EtapaDelTrabajador,
  type PedidoDeTomar,
} from "./reglas-trabajador";
import { archivosDeEntrada, frase, motivosDelResultado, porQueNoSeApruebaSola, riesgoDelPlan } from "./reglas-riesgo";
import {
  anotarAprobacionAutomatica,
  aprobacionAutomaticaPrendida,
  motivoDeLaAprobacionAutomatica,
  registroDeAprobacionAutomatica,
} from "./aprobacion-automatica";
import {
  SQL_ARRANQUE,
  SQL_CANDADO_DEL_NEGOCIO,
  SQL_CANDIDATAS,
  SQL_ES_PARTE,
  SQL_PASAR_VENCIDAS_A_ERROR,
  SQL_TOMAR_UNA,
  SQL_TRABAJANDO,
} from "./sql-trabajador";
import { QUIEN_TRABAJADOR, linkDeLaTarjeta } from "./tableros";

/*
  EL TRABAJADOR del Tablero IA (fase 2, 20-oct-2026): lo que hace la API /api/trabajador/tablero/*.

  El Coordinador es un PC aparte ("aizen1", siempre encendido) que pregunta cada minuto por HTTPS si
  hay algo que hacer: sin webhook ni puertos abiertos, y NADA corre en el servidor de producción.
  Entra con una CLAVE DE TRABAJADOR (Bearer aizen_trab_...) que define el negocio: solo ve y mueve
  tarjetas de ese negocio. De la clave se guarda solo la huella sha256; se muestra una vez al crearla.

  - /tomar: primero pasa a ERROR las que se le vencieron (sin latido); después, si tiene en las manos
    menos de `maxParalelo` (PLANEANDO / EN_CURSO / SUBIENDO con trabajoVenceEn vigente; 1 si no lo
    manda, como antes del 22-oct-2026), toma UNA (la que más espera, salvo las de `excluir`) de forma
    atómica, con el candado del negocio (sql-trabajador.ts).
    Una SUBIENDO pendiente va primero: la que acaba de construir y sube sola se toma enseguida.
  - /candidatas: las que tomaría, sin tomarlas. El Coordinador las mira para no juntar en paralelo dos
    del mismo repo que tocan la misma zona o módulo, ni dos subidas del mismo repo (van en `excluir`).
  - /:id/soltar la devuelve sin ERROR ni contar el intento (Claude llegó a su límite de uso, o choca con
    otra que corre): PLANEANDO -> APROBADO, EN_CURSO -> PLAN_APROBADO, SUBIENDO -> SUBIENDO pendiente.
  - /:id/latido corre el vencimiento (de a 5 min, hasta el tope de la etapa: 20 / 90 / 45 min).
  - /:id/plan, /resultado, /subida y /error la mueven de estado (reglas-trabajador.ts). /resultado
    pasa a SUBIENDO (sube sola) o a POR_REVISAR (espera el sí final) según destinoDelResultado.

  Cuando algo falla (24-oct-2026, "reparar"): el Coordinador diagnostica y cada paso deja una fila en
  IntentoTarjeta (el historial de intentos de la tarjeta):
  - /:id/reparar la devuelve a la fila SIN ERROR (PLANEANDO -> APROBADO; EN_CURSO y SUBIENDO ->
    PLAN_APROBADO) y suma una reparación (tope TOPE_DE_REPARACIONES; el 4.º aviso es un /error).
  - /:id/partir (desde EN_CURSO) crea de 2 a 4 tarjetas hijas, una tras otra (flechas de dependencia), y
    deja a la madre EN_CURSO sin candado. La madre pasa a HECHO cuando su última hija sube (/subida).
  - /:id/soltar con `categoria` (esperar) y /:id/error con `categoria` (escalar) también dejan su fila.
  - /arranque (ruta aparte): lo que el negocio tenía en PLANEANDO o EN_CURSO con candado vuelve a la fila.
  - Las vencidas sin latido vuelven a la fila (SQL_PASAR_VENCIDAS_A_ERROR) en vez de ERROR, salvo las que
    se pasaron del tope de su etapa, las SUBIENDO o las que ya esperaron TOPE_DE_ESPERAS_SEGUIDAS veces.
  - /tomar no toma una tarjeta con una dependencia sin terminar (sql-trabajador.ts).

  Cada cambio deja su fila en HistorialTarjeta con origen TRABAJADOR (quien = "trabajador:<clave>")
  y toca TableroInteligente.actualizadoEn (el refresco de la pantalla). El latido no: no cambia nada
  que se vea y llenaría el historial (uno por minuto).
*/

const PREFIJO_CLAVE = "aizen_trab_";

const huella = (clave: string) => createHash("sha256").update(clave).digest("hex");

/** Un error con su código HTTP, para que la ruta conteste bien al Coordinador. */
export class ErrorDelTrabajador extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// ── Claves ─────────────────────────────────────────────────────────────────────────────────

/** Crea una clave y la devuelve UNA vez. Después solo queda su huella. Lo llama la pantalla (dueño). */
export async function crearClaveTrabajador(workspaceId: string, nombre: unknown) {
  const limpio = (typeof nombre === "string" ? nombre.trim() : "").slice(0, 60) || "aizen1";
  const clave = `${PREFIJO_CLAVE}${randomBytes(32).toString("hex")}`;
  const fila = await prisma.claveTrabajador.create({
    data: { workspaceId, nombre: limpio, hash: huella(clave) },
    select: { id: true, nombre: true },
  });
  return { ...fila, clave };
}

export async function listarClavesTrabajador(workspaceId: string) {
  return prisma.claveTrabajador.findMany({
    where: { workspaceId },
    orderBy: { creadoEn: "desc" },
    take: 20,
    select: { id: true, nombre: true, creadoEn: true, ultimoUsoEn: true, revocadaEn: true },
  });
}

/** Revocar = marcar revocadaEn (la fila queda: el historial la nombra). */
export async function revocarClaveTrabajador(workspaceId: string, id: unknown) {
  const hecho = await prisma.claveTrabajador.updateMany({
    where: { id: typeof id === "string" ? id : "", workspaceId, revocadaEn: null },
    data: { revocadaEn: new Date() },
  });
  if (hecho.count !== 1) throw new Error("No existe esa clave (o ya estaba revocada).");
}

export type ContextoTrabajador = { claveId: string; workspaceId: string; nombre: string };

/** A qué negocio pertenece la clave, o null si no existe o fue revocada. Anota el último uso (cada 30 s como mucho). */
export async function validarClaveTrabajador(clave: string | null | undefined): Promise<ContextoTrabajador | null> {
  if (!clave || !clave.startsWith(PREFIJO_CLAVE) || clave.length > 200) return null;
  const fila = await prisma.claveTrabajador.findUnique({
    where: { hash: huella(clave) },
    select: { id: true, workspaceId: true, nombre: true, revocadaEn: true, ultimoUsoEn: true },
  });
  if (!fila || fila.revocadaEn) return null;
  if (!fila.ultimoUsoEn || Date.now() - fila.ultimoUsoEn.getTime() > 30_000) {
    await prisma.claveTrabajador
      .update({ where: { id: fila.id }, data: { ultimoUsoEn: new Date() } })
      .catch(() => undefined);
  }
  return { claveId: fila.id, workspaceId: fila.workspaceId, nombre: fila.nombre };
}

// ── Aprobadores ────────────────────────────────────────────────────────────────────────────

export async function listarAprobadores(workspaceId: string) {
  const [aprobadores, miembros, negocio] = await Promise.all([
    prisma.aprobadorTablero.findMany({
      where: { workspaceId },
      orderBy: { creadoEn: "asc" },
      select: { id: true, userId: true, alcance: true, puedeSubir: true, user: { select: { name: true, email: true } } },
    }),
    prisma.workspaceMember.findMany({
      where: { workspaceId, isActive: true },
      orderBy: { createdAt: "asc" },
      select: { userId: true, role: true, user: { select: { name: true, email: true } } },
    }),
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { ownerId: true } }),
  ]);
  const nombre = (user: { name: string | null; email: string }) => user.name?.trim() || user.email;
  const ya = new Set(aprobadores.map((fila) => fila.userId));
  return {
    aprobadores: aprobadores.map((fila) => ({
      id: fila.id,
      userId: fila.userId,
      nombre: nombre(fila.user),
      alcance: fila.alcance,
      puedeSubir: fila.puedeSubir,
    })),
    // A quién se puede agregar: miembros activos que no son el dueño ni ya aprobadores.
    candidatos: miembros
      .filter((miembro) => miembro.role !== "OWNER" && miembro.userId !== negocio?.ownerId && !ya.has(miembro.userId))
      .map((miembro) => ({ userId: miembro.userId, nombre: nombre(miembro.user) })),
  };
}

/** Agrega un miembro activo del negocio como aprobador (alcance DESARROLLO o TODO). */
export async function agregarAprobador(workspaceId: string, userId: unknown, alcance: unknown) {
  const id = typeof userId === "string" ? userId : "";
  const elAlcance = alcance === "TODO" ? "TODO" : "DESARROLLO";
  const miembro = await prisma.workspaceMember.findFirst({ where: { workspaceId, userId: id, isActive: true }, select: { id: true } });
  if (!miembro) throw new Error("Esa persona no es miembro activo del negocio. Cuando tenga usuario, se agrega.");
  try {
    await prisma.aprobadorTablero.create({ data: { workspaceId, userId: id, alcance: elAlcance } });
  } catch (fallo) {
    if (fallo instanceof Prisma.PrismaClientKnownRequestError && fallo.code === "P2002") throw new Error("Ya es aprobador.");
    throw fallo;
  }
}

export async function quitarAprobador(workspaceId: string, id: unknown) {
  const hecho = await prisma.aprobadorTablero.deleteMany({ where: { id: typeof id === "string" ? id : "", workspaceId } });
  if (hecho.count !== 1) throw new Error("No existe ese aprobador.");
}

// ── La API del Coordinador ──────────────────────────────────────────────────────────────────

type Tx = Prisma.TransactionClient;

const quienEs = (contexto: ContextoTrabajador) => `${QUIEN_TRABAJADOR}${contexto.claveId}`;

async function anotarTrabajador(
  tx: Tx,
  contexto: ContextoTrabajador,
  tarjetaId: string,
  antes: Record<string, unknown>,
  despues: Record<string, unknown>,
) {
  await tx.historialTarjeta.create({
    data: {
      tarjetaId,
      quien: quienEs(contexto),
      origen: "TRABAJADOR",
      accion: "estado",
      antes: antes as Prisma.InputJsonValue,
      despues: despues as Prisma.InputJsonValue,
    },
  });
}

async function tocarTableros(tx: Tx, tableroIds: string[], ahora: Date) {
  const ids = [...new Set(tableroIds)];
  if (ids.length) await tx.tableroInteligente.updateMany({ where: { id: { in: ids } }, data: { actualizadoEn: ahora } });
}

/** Lo que el Coordinador necesita de la tarjeta para hacer su etapa. */
const SELECT_PARA_TRABAJAR = {
  id: true,
  tableroId: true,
  titulo: true,
  detalle: true,
  estado: true,
  repo: true,
  plan: true,
  resultado: true,
  zonaProtegida: true,
  riesgo: true,
  riesgoMotivo: true,
  riesgoPor: true,
  intentos: true,
  reparaciones: true,
  trabajoIniciadoEn: true,
  trabajoVenceEn: true,
  actualizadoEn: true,
  tablero: { select: { nombre: true } },
} as const;

type FilaParaTrabajar = Prisma.TarjetaTableroGetPayload<{ select: typeof SELECT_PARA_TRABAJAR }>;

/** Lo que el Coordinador necesita saber de los intentos de una tarjeta (protocolo de reparación). */
type DatosDeIntentos = {
  esperasSeguidas: number;
  esParte: boolean;
  ultimosIntentos: {
    numero: number;
    etapa: string;
    categoria: string;
    causa: string;
    accion: string;
    cuentaComoIntento: boolean;
  }[];
  ultimoError: string | null;
};

/** Los últimos 6 intentos (del más viejo al más nuevo), las esperas seguidas, el último error y si es una parte. */
async function datosDeIntentos(tx: Tx, fila: { id: string; tableroId: string }): Promise<DatosDeIntentos> {
  const [recientes, madre] = await Promise.all([
    tx.intentoTarjeta.findMany({
      where: { tarjetaId: fila.id },
      orderBy: { numero: "desc" },
      take: 50,
      select: { numero: true, etapa: true, categoria: true, causa: true, error: true, accion: true, cuentaComoIntento: true },
    }),
    tx.$queryRawUnsafe<{ id: string }[]>(SQL_ES_PARTE, fila.tableroId, fila.id),
  ]);
  const viejoANuevo = [...recientes].reverse();
  return {
    esperasSeguidas: esperasSeguidas(viejoANuevo),
    esParte: madre.length > 0,
    ultimosIntentos: viejoANuevo.slice(-6).map(({ error: _error, ...intento }) => {
      void _error;
      return intento;
    }),
    ultimoError: recientes.find((intento) => intento.error)?.error ?? null,
  };
}

function paraElTrabajador(fila: FilaParaTrabajar, intentos: DatosDeIntentos) {
  return {
    reparaciones: fila.reparaciones,
    topeReparaciones: TOPE_DE_REPARACIONES,
    esperasSeguidas: intentos.esperasSeguidas,
    esParte: intentos.esParte,
    ultimosIntentos: intentos.ultimosIntentos,
    ultimoError: intentos.ultimoError,
    id: fila.id,
    titulo: fila.titulo,
    detalle: fila.detalle,
    tablero: fila.tablero.nombre,
    estado: fila.estado,
    repo: fila.repo,
    plan: fila.plan,
    resultado: fila.resultado,
    // Las zonas que ya tiene la tarjeta son las que el dueño aprobó en la pantalla (/tomar no toma una
    // con zona si su última aprobación no fue en la pantalla): el cambio puede tocar esas, no otras.
    zonasAprobadas: fila.zonaProtegida,
    // El riesgo que lleva la tarjeta (BAJO / ALTO / null): el trabajador lo recalcula al planear.
    riesgo: fila.riesgo,
    riesgoMotivo: fila.riesgoMotivo,
    intentos: fila.intentos,
    venceEn: fila.trabajoVenceEn ? fila.trabajoVenceEn.toISOString() : null,
    link: linkDeLaTarjeta(fila.id),
  };
}

export type TarjetaParaTrabajar = ReturnType<typeof paraElTrabajador>;

/**
 * POST /tomar. Devuelve `{ tarjeta: null, motivo }` si no hay nada (o ya tiene `maxParalelo` en las
 * manos: "ocupado"), o la tarjeta con `hacer` = planear | construir | subir. Todo en UNA transacción
 * con el candado del negocio.
 */
export async function tomarTarjeta(contexto: ContextoTrabajador, pedido: PedidoDeTomar = {}, ahora = new Date()) {
  const { maxParalelo, excluir } = opcionesDeTomar(pedido);
  const iso = ahora.toISOString();
  const vence = new Date(ahora.getTime() + MINUTOS_DE_GRACIA_DEL_LATIDO * 60_000).toISOString();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(SQL_CANDADO_DEL_NEGOCIO, contexto.workspaceId);

    // Las vencidas sin latido vuelven a la fila (sueltas) o, si se pasaron del tope, esperaron mucho o
    // estaban subiendo, pasan a ERROR (con su fila en IntentoTarjeta).
    const vencidasODejadas = await tx.$queryRawUnsafe<{ id: string; tableroId: string; antes: string; estado: string }[]>(
      SQL_PASAR_VENCIDAS_A_ERROR,
      contexto.workspaceId,
      iso,
      MOTIVO_VENCIDA,
      iso,
      TOPE_DE_ESPERAS_SEGUIDAS,
    );
    const vencidas = vencidasODejadas.filter((fila) => fila.estado === "ERROR");
    const sueltas = vencidasODejadas.filter((fila) => fila.estado !== "ERROR");
    for (const vencida of vencidas) {
      await anotarTrabajador(tx, contexto, vencida.id, { estado: vencida.antes }, { estado: "ERROR", motivo: MOTIVO_VENCIDA });
    }
    for (const suelta of sueltas) {
      await anotarTrabajador(
        tx,
        contexto,
        suelta.id,
        { estado: suelta.antes },
        { estado: suelta.estado, nota: "el Coordinador dejó de dar señales: vuelve a la fila, sin error" },
      );
    }
    await tocarTableros(tx, vencidasODejadas.map((fila) => fila.tableroId), ahora);
    const avisos = { vencidas: vencidas.map((fila) => fila.id), sueltas: sueltas.map((fila) => fila.id) };

    const enCurso = (await tx.$queryRawUnsafe<{ id: string }[]>(SQL_TRABAJANDO, contexto.workspaceId, iso)).map((fila) => fila.id);
    if (enCurso.length >= maxParalelo) {
      return { tarjeta: null, motivo: "ocupado" as const, enCurso: enCurso[0], enLasManos: enCurso, ...avisos };
    }

    const [tomada] = await tx.$queryRawUnsafe<{ id: string; tableroId: string; antes: string; estado: string }[]>(
      SQL_TOMAR_UNA,
      contexto.workspaceId,
      iso,
      [...REPOS_DEL_TRABAJADOR],
      vence,
      excluir,
    );
    if (!tomada) return { tarjeta: null, motivo: "nada" as const, ...avisos };

    await anotarTrabajador(tx, contexto, tomada.id, { estado: tomada.antes }, { estado: tomada.estado, venceEn: vence });
    await tocarTableros(tx, [tomada.tableroId], ahora);
    const fila = await tx.tarjetaTablero.findUniqueOrThrow({ where: { id: tomada.id }, select: SELECT_PARA_TRABAJAR });
    const hacer = esEstado(tomada.estado) ? ETAPA_DEL_ESTADO[tomada.estado] : undefined;
    return { tarjeta: paraElTrabajador(fila, await datosDeIntentos(tx, fila)), hacer: hacer as EtapaDelTrabajador, ...avisos };
  });
}

/**
 * POST /arranque: el Coordinador acaba de arrancar; lo que el negocio tenía en PLANEANDO o EN_CURSO con
 * candado lo tenía el proceso anterior, que murió. Vuelve a la fila (sin ERROR, sin gastar el intento) con su
 * fila en IntentoTarjeta. SUBIENDO no se toca: pudo haber empujado a main. Con el candado del negocio.
 */
export async function arranqueDelTrabajador(contexto: ContextoTrabajador, ahora = new Date()) {
  const iso = ahora.toISOString();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(SQL_CANDADO_DEL_NEGOCIO, contexto.workspaceId);
    const filas = await tx.$queryRawUnsafe<{ id: string; tableroId: string; antes: string }[]>(SQL_ARRANQUE, contexto.workspaceId, iso);
    for (const fila of filas) {
      await anotarTrabajador(
        tx,
        contexto,
        fila.id,
        { estado: fila.antes },
        { estado: estadoTrasReparar(fila.antes as EstadoTarjetaTablero), nota: "el Coordinador arrancó de nuevo: vuelve a la fila, sin error" },
      );
    }
    await tocarTableros(tx, filas.map((fila) => fila.tableroId), ahora);
    return { ok: true, sueltas: filas.map((fila) => fila.id) };
  });
}

/** Guarda una fila de IntentoTarjeta (el número es consecutivo por tarjeta). */
async function anotarIntento(
  tx: Tx,
  tarjetaId: string,
  datos: {
    etapa: EtapaDelTrabajador;
    categoria: CategoriaDeIntento;
    causa: string;
    error: string | null;
    accion: AccionDeIntento;
    cuentaComoIntento: boolean;
  },
  ahora: Date,
) {
  const numero = (await tx.intentoTarjeta.count({ where: { tarjetaId } })) + 1;
  await tx.intentoTarjeta.create({ data: { tarjetaId, numero, ...datos, creadoEn: ahora } });
}

type IntentoPorGuardar = Parameters<typeof anotarIntento>[2];

/** Cuando la última hija de una madre partida sube, la madre queda HECHO (si ya no falta ninguna). */
async function cerrarLaMadreSiToca(tx: Tx, contexto: ContextoTrabajador, hija: { id: string; tableroId: string }, ahora: Date) {
  const [fila] = await tx.$queryRawUnsafe<{ id: string }[]>(SQL_ES_PARTE, hija.tableroId, hija.id);
  if (!fila) return;
  const madre = await tx.tarjetaTablero.findUnique({
    where: { id: fila.id },
    select: { id: true, estado: true, resultado: true, borradoEn: true },
  });
  const partida = partidaDelResultado(madre?.resultado);
  if (!madre || !partida || madre.borradoEn || madre.estado !== "EN_CURSO") return;
  const hijas = await tx.tarjetaTablero.findMany({ where: { id: { in: partida.hijas }, borradoEn: null }, select: { estado: true } });
  if (!madreSeCierra(hijas)) return;
  const hecho = await tx.tarjetaTablero.updateMany({
    where: { id: madre.id, estado: "EN_CURSO", borradoEn: null },
    data: { estado: "HECHO", trabajoVenceEn: null },
  });
  if (hecho.count !== 1) return;
  await anotarTrabajador(tx, contexto, madre.id, { estado: "EN_CURSO" }, { estado: "HECHO", nota: `terminada: sus ${hijas.length} partes están hechas` });
}

/** POST /candidatas: las que /tomar podría tomar, sin tomarlas (con su repo, zonas y plan). */
export async function candidatasDelTrabajador(contexto: ContextoTrabajador) {
  const filas = await prisma.$queryRawUnsafe<
    { id: string; titulo: string; estado: string; repo: string; zonaProtegida: string[]; plan: string | null }[]
  >(SQL_CANDIDATAS, contexto.workspaceId, [...REPOS_DEL_TRABAJADOR]);
  return {
    candidatas: filas.map((fila) => ({
      ...fila,
      hacer: esEstado(fila.estado) ? (AL_TOMAR[fila.estado]?.etapa ?? null) : null,
    })),
  };
}

/** Una tarjeta de ESTE negocio, o 404. */
async function tarjetaDelTrabajador(contexto: ContextoTrabajador, tarjetaId: string) {
  const fila = await prisma.tarjetaTablero.findFirst({
    where: { id: tarjetaId, tablero: { workspaceId: contexto.workspaceId }, borradoEn: null },
    select: SELECT_PARA_TRABAJAR,
  });
  if (!fila) throw new ErrorDelTrabajador("No existe esa tarjeta en este negocio.", 404);
  return fila;
}

const resultadoComoObjeto = (valor: unknown) =>
  valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {};

/**
 * POST /:id/<accion>. `cuerpo` es el JSON que mandó el Coordinador. Cada acción mueve la tarjeta solo
 * desde su estado (si no, 409) y condicionada a ese estado (dos llamadas a la vez no pisan nada).
 */
export async function accionDelTrabajador(
  contexto: ContextoTrabajador,
  tarjetaId: string,
  accion: AccionDelTrabajador,
  cuerpo: Record<string, unknown>,
  ahora = new Date(),
) {
  if (!(accion in TRANSICIONES_DEL_TRABAJADOR)) throw new ErrorDelTrabajador("Esa acción no existe.", 404);
  const actual = await tarjetaDelTrabajador(contexto, tarjetaId);
  const estado = actual.estado as EstadoTarjetaTablero;
  const veredicto = puedeElTrabajador(accion, estado);
  if (veredicto) throw new ErrorDelTrabajador(veredicto, 409);

  if (accion === "latido") {
    const etapa = ETAPA_DEL_ESTADO[estado];
    if (!etapa || !actual.trabajoVenceEn || actual.trabajoVenceEn.getTime() <= ahora.getTime() || !actual.trabajoIniciadoEn) {
      throw new ErrorDelTrabajador("El candado de esta tarjeta ya venció: no sigas (el próximo /tomar la pasa a ERROR).", 409);
    }
    const venceEn = vencimientoDelCandado(etapa, actual.trabajoIniciadoEn, ahora);
    const hecho = await prisma.tarjetaTablero.updateMany({
      where: { id: actual.id, estado: actual.estado, trabajoVenceEn: { gt: ahora } },
      data: { trabajoVenceEn: venceEn },
    });
    if (hecho.count !== 1) throw new ErrorDelTrabajador("La tarjeta cambió mientras tanto.", 409);
    return { ok: true, venceEn: venceEn.toISOString(), topeAlcanzado: venceEn.getTime() < ahora.getTime() + MINUTOS_DE_GRACIA_DEL_LATIDO * 60_000 };
  }

  if (accion === "soltar") {
    // Claude llegó a su límite de uso o choca con otra que corre: vuelve a esperar su turno, sin ERROR y
    // sin gastar el intento (una SUBIENDO queda pendiente, como recién aprobada).
    const vuelve: EstadoTarjetaTablero = estado === "PLANEANDO" ? "APROBADO" : estado === "EN_CURSO" ? "PLAN_APROBADO" : "SUBIENDO";
    const motivo = motivoDeEntrada(cuerpo.motivo ?? "El Coordinador la soltó para reintentarla después.");
    // Con `categoria` queda una fila de intentos: esperar (no cuenta como intento).
    const categoria = categoriaDeEntrada(cuerpo.categoria);
    const intento: IntentoPorGuardar | null = categoria
      ? {
          etapa: etapaDeEntrada(cuerpo.etapa, estado),
          categoria,
          causa: causaDeEntrada(cuerpo.causa, causaDeEntrada(motivo)),
          error: errorDeIntentoDeEntrada(cuerpo.error),
          accion: "esperar",
          cuentaComoIntento: false,
        }
      : null;
    return prisma.$transaction(async (tx) => {
      const hecho = await tx.tarjetaTablero.updateMany({
        where: { id: actual.id, estado: actual.estado, borradoEn: null },
        data: { estado: vuelve, trabajoVenceEn: null, intentos: Math.max(0, actual.intentos - 1) },
      });
      if (hecho.count !== 1) throw new ErrorDelTrabajador("La tarjeta cambió mientras tanto.", 409);
      await anotarTrabajador(tx, contexto, actual.id, { estado }, { estado: vuelve, nota: `soltada sin error: ${motivo}` });
      if (intento) await anotarIntento(tx, actual.id, intento, ahora);
      await tocarTableros(tx, [actual.tableroId], ahora);
      return { ok: true, estado: vuelve, link: linkDeLaTarjeta(actual.id) };
    });
  }

  if (accion === "reparar") {
    // Algo falló y el Coordinador sabe la causa: vuelve a la fila sin ERROR y suma una reparación.
    const tope = puedeReparar(actual.reparaciones);
    if (tope) throw new ErrorDelTrabajador(tope, 409);
    const vuelve = estadoTrasReparar(estado);
    const intento: IntentoPorGuardar = {
      etapa: etapaDeEntrada(cuerpo.etapa, estado),
      categoria: categoriaDeEntrada(cuerpo.categoria) ?? "otra",
      causa: causaConEstrategia(causaDeEntrada(cuerpo.causa), estrategiaDeEntrada(cuerpo.estrategia)),
      error: errorDeIntentoDeEntrada(cuerpo.error),
      accion: "reparar",
      cuentaComoIntento: true,
    };
    return prisma.$transaction(async (tx) => {
      const hecho = await tx.tarjetaTablero.updateMany({
        where: { id: actual.id, estado: actual.estado, reparaciones: actual.reparaciones, borradoEn: null },
        data: { estado: vuelve, trabajoVenceEn: null, reparaciones: { increment: 1 } },
      });
      if (hecho.count !== 1) throw new ErrorDelTrabajador("La tarjeta cambió mientras tanto.", 409);
      const reparaciones = actual.reparaciones + 1;
      await anotarTrabajador(
        tx,
        contexto,
        actual.id,
        { estado },
        { estado: vuelve, nota: `reparación ${reparaciones} de ${TOPE_DE_REPARACIONES}: ${intento.causa}`, categoria: intento.categoria },
      );
      await anotarIntento(tx, actual.id, intento, ahora);
      await tocarTableros(tx, [actual.tableroId], ahora);
      return { ok: true, estado: vuelve, reparaciones, link: linkDeLaTarjeta(actual.id) };
    });
  }

  if (accion === "partir") return partirTarjeta(contexto, actual, cuerpo, ahora);

  let a = TRANSICIONES_DEL_TRABAJADOR[accion].a as EstadoTarjetaTablero;
  const previo = resultadoComoObjeto(actual.resultado);
  const datos: Prisma.TarjetaTableroUpdateManyMutationInput = { estado: a, trabajoVenceEn: null };
  const despues: Record<string, unknown> = { estado: a };
  // El plan de una tarjeta BAJO que se aprueba solo: se anota como una aprobación aparte (abajo).
  let aprobacionDelPlan: ReturnType<typeof registroDeAprobacionAutomatica> | null = null;
  // La fila de intentos que deja una escalada (/error con categoria).
  let intentoPorGuardar: IntentoPorGuardar | null = null;
  // Las zonas protegidas que marca el Coordinador (el cambio toca esas rutas): se suman, nunca se quitan.
  const marcarZonas = () => {
    const zonas = zonasDeEntrada(cuerpo.zonaProtegida);
    const final = zonas?.length ? unirZonas(actual.zonaProtegida, zonas) : actual.zonaProtegida;
    if (zonas?.length) {
      datos.zonaProtegida = final;
      despues.zonaProtegida = final;
    }
    return final;
  };

  try {
    if (accion === "plan") {
      const plan = planDeEntrada(cuerpo.plan);
      datos.plan = plan;
      // Un plan nuevo deja atrás el resultado (y el error) de un intento anterior.
      datos.resultado = Prisma.DbNull;
      despues.plan = plan;
      // Segunda revisión de riesgo: el CRM lee el plan (su línea RIESGO, la zona, la migración y los archivos).
      // Una tarjeta BAJO sigue BAJO solo si el plan lo confirma; si no, sube a ALTO y espera al dueño.
      const revision = riesgoDelPlan(plan);
      if (actual.riesgo === "BAJO") {
        const motivos = revision.motivosAlto;
        if (motivos.length) {
          datos.riesgo = "ALTO";
          datos.riesgoMotivo = frase(motivos).slice(0, 300);
          datos.riesgoPor = "TRABAJADOR";
          despues.riesgo = "ALTO";
          despues.riesgoMotivo = datos.riesgoMotivo;
          despues.nota = `plan listo: el riesgo subió a ALTO, espera tu sí (${datos.riesgoMotivo})`;
        } else {
          if (revision.motivoDeclarado) {
            datos.riesgoMotivo = revision.motivoDeclarado.slice(0, 300);
            datos.riesgoPor = "TRABAJADOR";
          }
          // Sigue BAJO y sin zona protegida: el plan se aprueba solo (con el interruptor prendido).
          // También se repasa el texto de la tarjeta (título y detalle) por si cambió desde que se marcó BAJO.
          const prendido = await aprobacionAutomaticaPrendida(contexto.workspaceId);
          const noSola = porQueNoSeApruebaSola({
            titulo: actual.titulo,
            detalle: actual.detalle,
            repo: actual.repo,
            zonaProtegida: actual.zonaProtegida,
            riesgo: actual.riesgo,
            prendido,
          });
          if (!noSola) {
            const motivo = motivoDeLaAprobacionAutomatica(revision.motivoDeclarado ?? actual.riesgoMotivo);
            aprobacionDelPlan = registroDeAprobacionAutomatica({ estado: "PLAN_APROBADO", momento: "plan", motivo });
            a = "PLAN_APROBADO";
            datos.estado = a;
          }
        }
      }
    } else if (accion === "resultado") {
      const resultado = resultadoDeEntrada(cuerpo);
      const zonas = marcarZonas();
      // Última revisión de riesgo: los archivos que de verdad cambió y su migración. Una tarjeta BAJO que
      // toca algo de riesgo alto pasa a ALTO y no sube sola (espera el sí del dueño).
      let subeSolo = resultado.subeSolo;
      if (actual.riesgo === "BAJO") {
        const motivos = motivosDelResultado({
          // La lista completa del cuerpo (hasta 300): lo que se guarda en el resultado se recorta a 100.
          archivos: archivosDeEntrada(cuerpo.archivos),
          migracionDestructiva: resultado.migracionDestructiva ?? null,
          zonaProtegida: zonas,
        });
        if (motivos.length) {
          subeSolo = false;
          datos.riesgo = "ALTO";
          datos.riesgoMotivo = frase(motivos).slice(0, 300);
          datos.riesgoPor = "TRABAJADOR";
          despues.riesgo = "ALTO";
          despues.riesgoMotivo = datos.riesgoMotivo;
        }
      }
      // Sube sola (SUBIENDO pendiente, la toma enseguida) o espera el sí final del dueño (POR_REVISAR).
      a = destinoDelResultado({ paso: resultado.paso, subeSolo, zonaProtegida: zonas });
      datos.estado = a;
      despues.estado = a;
      // Lo que queda guardado dice lo que de verdad pasó: si el riesgo subió a ALTO, ya no "sube solo".
      resultado.subeSolo = subeSolo;
      datos.resultado = resultado as unknown as Prisma.InputJsonValue;
      despues.resultado = resultado;
      despues.nota =
        a === "SUBIENDO"
          ? "construido, sube solo"
          : zonas.length
            ? `construido, espera tu sí (zona ${zonas.map((zona) => (esZona(zona) ? NOMBRE_DE_LA_ZONA[zona] : zona)).join(", ")})`
            : "construido, espera tu sí";
    } else if (accion === "subida") {
      const subida = {
        commit: typeof cuerpo.commit === "string" ? cuerpo.commit.trim().slice(0, 80) : null,
        version: typeof cuerpo.version === "string" ? cuerpo.version.trim().slice(0, 120) : null,
        linkCommit: linkDeEntrada(cuerpo.linkCommit),
        cuando: ahora.toISOString(),
      };
      const { error: _errorViejo, ...sinError } = previo;
      void _errorViejo;
      datos.resultado = { ...sinError, subida } as Prisma.InputJsonValue;
      despues.subida = subida;
      despues.nota = `subido a main, commit ${subida.commit?.slice(0, 10) ?? "?"}; en producción, versión ${subida.version?.slice(0, 10) ?? "?"}`;
    } else if (accion === "error") {
      // Con `categoria` es una escalada del protocolo de reparación: el motivo es el resumen de máximo 3 líneas
      // para el dueño, y queda una fila de intentos (escalar, cuenta como intento) con el error técnico.
      const categoria = categoriaDeEntrada(cuerpo.categoria);
      const motivo = categoria ? resumenDeEscalada(cuerpo.motivo ?? cuerpo.resumen) : motivoDeEntrada(cuerpo.motivo);
      const reversion = reversionDeEntrada(cuerpo.reversion);
      const causa = categoria ? causaDeEntrada(cuerpo.causa, causaDeEntrada(motivo)) : null;
      const error = {
        motivo,
        en: estado,
        cuando: ahora.toISOString(),
        ...(categoria ? { categoria, causa } : {}),
        ...(reversion ? { reversion } : {}),
      };
      datos.resultado = { ...previo, error } as Prisma.InputJsonValue;
      if (categoria && causa) {
        intentoPorGuardar = {
          etapa: etapaDeEntrada(cuerpo.etapa, estado),
          categoria,
          causa,
          error: errorDeIntentoDeEntrada(cuerpo.error),
          accion: "escalar",
          cuentaComoIntento: true,
        };
      }
      despues.motivo = motivo;
      if (reversion) despues.reversion = reversion;
      // Si el cambio toca una zona protegida, el Coordinador la marca: se aprueba solo en la pantalla.
      marcarZonas();
    }
  } catch (fallo) {
    if (fallo instanceof ErrorDelTrabajador) throw fallo;
    throw new ErrorDelTrabajador(fallo instanceof Error ? fallo.message : "Datos inválidos.", 400);
  }

  return prisma.$transaction(async (tx) => {
    const hecho = await tx.tarjetaTablero.updateMany({
      // Condicionado también al riesgo que se leyó: si el dueño lo cambió un instante antes, no se pisa.
      where: {
        id: actual.id,
        estado: actual.estado,
        riesgo: actual.riesgo,
        borradoEn: null,
        // Si el plan se aprueba solo, que nadie haya tocado el texto ni las zonas desde que se revisó.
        ...(aprobacionDelPlan ? { titulo: actual.titulo, detalle: actual.detalle, zonaProtegida: { isEmpty: true } } : {}),
      },
      data: datos,
    });
    if (hecho.count !== 1) throw new ErrorDelTrabajador("La tarjeta cambió mientras tanto.", 409);
    if (aprobacionDelPlan) {
      // El plan queda PLAN_LISTO un instante y se aprueba solo: quedan las dos filas en el historial.
      despues.estado = "PLAN_LISTO";
      despues.nota = "plan listo, se aprueba solo (riesgo BAJO)";
    }
    await anotarTrabajador(tx, contexto, actual.id, { estado }, despues);
    if (aprobacionDelPlan) await anotarAprobacionAutomatica(tx, actual.id, { estado: "PLAN_LISTO" }, aprobacionDelPlan);
    if (intentoPorGuardar) await anotarIntento(tx, actual.id, intentoPorGuardar, ahora);
    // Una parte que sube puede ser la última: entonces la madre queda HECHO.
    if (accion === "subida") await cerrarLaMadreSiToca(tx, contexto, actual, ahora);
    await tocarTableros(tx, [actual.tableroId], ahora);
    return { ok: true, estado: a, link: linkDeLaTarjeta(actual.id) };
  });
}

/**
 * POST /:id/partir (desde EN_CURSO): la tarjeta es muy grande y el Coordinador la divide en 2 a 4 partes.
 * Crea una hija por parte (mismo tablero, tipo, repo, área, zona protegida y riesgo; PLAN_APROBADO, con el
 * detalle de la parte como plan), unidas en orden por flechas de dependencia (parte 1 -> parte 2 -> ...).
 * Cuelgan de la madre si su tipo lo permite y, si no, del mismo padre de la madre. Heredan la aprobación
 * (con zona protegida, /tomar exige una aprobación hecha en la pantalla). La madre queda EN_CURSO sin
 * candado (nadie la toma) y pasa a HECHO cuando suben todas (cerrarLaMadreSiToca).
 */
async function partirTarjeta(
  contexto: ContextoTrabajador,
  actual: FilaParaTrabajar,
  cuerpo: Record<string, unknown>,
  ahora: Date,
) {
  let partes: ReturnType<typeof partesDeEntrada>;
  try {
    partes = partesDeEntrada(cuerpo.partes);
  } catch (fallo) {
    throw new ErrorDelTrabajador(fallo instanceof Error ? fallo.message : "Partes inválidas.", 400);
  }
  const [esParte] = await prisma.$queryRawUnsafe<{ id: string }[]>(SQL_ES_PARTE, actual.tableroId, actual.id);
  const veredicto = puedePartir({ yaPartida: Boolean(partidaDelResultado(actual.resultado)), esParte: Boolean(esParte) });
  if (veredicto) throw new ErrorDelTrabajador(veredicto, 409);
  const causa = causaDeEntrada(cuerpo.causa);
  const intento: IntentoPorGuardar = {
    etapa: etapaDeEntrada(cuerpo.etapa, "EN_CURSO"),
    categoria: categoriaDeEntrada(cuerpo.categoria) ?? "tarea_muy_grande",
    causa,
    error: errorDeIntentoDeEntrada(cuerpo.error),
    accion: "partir",
    cuentaComoIntento: false,
  };

  return prisma.$transaction(async (tx) => {
    const madre = await tx.tarjetaTablero.findFirst({
      where: { id: actual.id, estado: "EN_CURSO", borradoEn: null },
      select: { tipoId: true, area: true, padreId: true, creadoPor: true, orden: true, resultado: true },
    });
    if (!madre) throw new ErrorDelTrabajador("La tarjeta cambió mientras tanto.", 409);
    // ¿Su tipo deja que una tarjeta del mismo tipo cuelgue de ella? Si no, las hijas cuelgan del padre de la madre.
    const puedeColgarDeLaMadre = Boolean(
      await tx.tipoTarjetaPadre.findUnique({
        where: { tipoId_tipoPadreId: { tipoId: madre.tipoId, tipoPadreId: madre.tipoId } },
        select: { tipoId: true },
      }),
    );
    const padreId = puedeColgarDeLaMadre ? actual.id : madre.padreId;
    // Con zona protegida, /tomar solo toma una tarjeta cuya última aprobación fue en la pantalla.
    const conZona = actual.zonaProtegida.length > 0;

    const hijas: string[] = [];
    for (const [indice, parte] of partes.entries()) {
      const numero = indice + 1;
      const hija = await tx.tarjetaTablero.create({
        data: {
          tableroId: actual.tableroId,
          titulo: tituloDeLaParte(actual.titulo, numero, parte.titulo),
          detalle: detalleDeLaParte(actual.titulo, numero, partes.length, parte.detalle),
          area: madre.area,
          estado: "PLAN_APROBADO",
          orden: madre.orden + numero,
          tipoId: madre.tipoId,
          padreId,
          repo: actual.repo,
          plan: parte.detalle,
          zonaProtegida: actual.zonaProtegida,
          riesgo: actual.riesgo,
          riesgoMotivo: actual.riesgoMotivo,
          riesgoPor: actual.riesgoPor,
          creadoPor: madre.creadoPor,
        },
        select: { id: true, titulo: true },
      });
      hijas.push(hija.id);
      await tx.historialTarjeta.create({
        data: {
          tarjetaId: hija.id,
          quien: quienEs(contexto),
          origen: "TRABAJADOR",
          accion: "crear",
          despues: {
            titulo: hija.titulo,
            estado: "PLAN_APROBADO",
            parteDe: actual.id,
            nota: `parte ${numero} de ${partes.length} de «${actual.titulo}»`,
          } as Prisma.InputJsonValue,
        },
      });
      // Hereda la aprobación de la madre (tarea y plan ya estaban aprobados).
      await tx.historialTarjeta.create({
        data: {
          tarjetaId: hija.id,
          quien: quienEs(contexto),
          origen: "TRABAJADOR",
          accion: "aprobar",
          antes: { estado: "PLAN_APROBADO" } as Prisma.InputJsonValue,
          despues: {
            ...(conZona
              ? registroDeAprobacion({
                  estado: "PLAN_APROBADO",
                  momento: "plan",
                  via: "pantalla",
                  quienNombre: "el dueño (en la tarjeta madre)",
                  userId: quienEs(contexto),
                  textoConfirmacion: null,
                })
              : { estado: "PLAN_APROBADO", momento: "plan" }),
            como: "heredada",
            heredadaDe: actual.id,
          } as Prisma.InputJsonValue,
        },
      });
      if (indice > 0) {
        await tx.conexionTarjeta.create({
          data: { tableroId: actual.tableroId, origenId: hijas[indice - 1], destinoId: hija.id, esDependencia: true },
        });
      }
    }

    const previo = resultadoComoObjeto(madre.resultado);
    const hecho = await tx.tarjetaTablero.updateMany({
      where: { id: actual.id, estado: "EN_CURSO", borradoEn: null },
      data: {
        trabajoVenceEn: null,
        resultado: { ...previo, partida: { hijas, causa, cuando: ahora.toISOString() } } as Prisma.InputJsonValue,
      },
    });
    if (hecho.count !== 1) throw new ErrorDelTrabajador("La tarjeta cambió mientras tanto.", 409);
    await anotarTrabajador(
      tx,
      contexto,
      actual.id,
      { estado: "EN_CURSO" },
      { estado: "EN_CURSO", nota: `partida en ${partes.length} partes: ${causa}`, hijas },
    );
    await anotarIntento(tx, actual.id, intento, ahora);
    await tocarTableros(tx, [actual.tableroId], ahora);
    return { ok: true, estado: "EN_CURSO", hijas, link: linkDeLaTarjeta(actual.id) };
  });
}
