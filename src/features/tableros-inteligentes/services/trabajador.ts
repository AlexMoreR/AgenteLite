import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { esEstado, type EstadoTarjetaTablero } from "./reglas";
import {
  ETAPA_DEL_ESTADO,
  MINUTOS_DE_GRACIA_DEL_LATIDO,
  MOTIVO_VENCIDA,
  REPOS_DEL_TRABAJADOR,
  TRANSICIONES_DEL_TRABAJADOR,
  motivoDeEntrada,
  planDeEntrada,
  puedeElTrabajador,
  resultadoDeEntrada,
  unirZonas,
  vencimientoDelCandado,
  zonasDeEntrada,
  type AccionDelTrabajador,
  type EtapaDelTrabajador,
} from "./reglas-trabajador";
import { SQL_CANDADO_DEL_NEGOCIO, SQL_HAY_UNA_TRABAJANDO, SQL_PASAR_VENCIDAS_A_ERROR, SQL_TOMAR_UNA } from "./sql-trabajador";
import { QUIEN_TRABAJADOR, linkDeLaTarjeta } from "./tableros";

/*
  EL TRABAJADOR del Tablero IA (fase 2, 20-oct-2026): lo que hace la API /api/trabajador/tablero/*.

  El trabajador es un PC aparte ("aizen1", siempre encendido) que pregunta cada minuto por HTTPS si
  hay algo que hacer: sin webhook ni puertos abiertos, y NADA corre en el servidor de producción.
  Entra con una CLAVE DE TRABAJADOR (Bearer aizen_trab_...) que define el negocio: solo ve y mueve
  tarjetas de ese negocio. De la clave se guarda solo la huella sha256; se muestra una vez al crearla.

  - /tomar: primero pasa a ERROR las que se le vencieron (sin latido); después, si no tiene otra en
    las manos (el candado del negocio: ninguna PLANEANDO / EN_CURSO / SUBIENDO con trabajoVenceEn
    vigente), toma UNA (la que más espera) de forma atómica (sql-trabajador.ts).
  - /:id/latido corre el vencimiento (de a 5 min, hasta el tope de la etapa: 20 / 90 / 30 min).
  - /:id/plan, /resultado, /subida y /error la mueven de estado (reglas-trabajador.ts).

  Cada cambio deja su fila en HistorialTarjeta con origen TRABAJADOR (quien = "trabajador:<clave>")
  y toca TableroInteligente.actualizadoEn (el refresco de la pantalla). El latido no: no cambia nada
  que se vea y llenaría el historial (uno por minuto).
*/

const PREFIJO_CLAVE = "aizen_trab_";

const huella = (clave: string) => createHash("sha256").update(clave).digest("hex");

/** Un error con su código HTTP, para que la ruta conteste bien al trabajador. */
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

// ── La API del trabajador ──────────────────────────────────────────────────────────────────

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

/** Lo que el trabajador necesita de la tarjeta para hacer su etapa. */
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
  intentos: true,
  trabajoIniciadoEn: true,
  trabajoVenceEn: true,
  actualizadoEn: true,
  tablero: { select: { nombre: true } },
} as const;

type FilaParaTrabajar = Prisma.TarjetaTableroGetPayload<{ select: typeof SELECT_PARA_TRABAJAR }>;

function paraElTrabajador(fila: FilaParaTrabajar) {
  return {
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
    intentos: fila.intentos,
    venceEn: fila.trabajoVenceEn ? fila.trabajoVenceEn.toISOString() : null,
    link: linkDeLaTarjeta(fila.id),
  };
}

export type TarjetaParaTrabajar = ReturnType<typeof paraElTrabajador>;

/**
 * POST /tomar. Devuelve `{ tarjeta: null, motivo }` si no hay nada (u otra está en curso), o la tarjeta
 * con `hacer` = planear | construir | subir. Todo en UNA transacción con el candado del negocio.
 */
export async function tomarTarjeta(contexto: ContextoTrabajador, ahora = new Date()) {
  const iso = ahora.toISOString();
  const vence = new Date(ahora.getTime() + MINUTOS_DE_GRACIA_DEL_LATIDO * 60_000).toISOString();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(SQL_CANDADO_DEL_NEGOCIO, contexto.workspaceId);

    const vencidas = await tx.$queryRawUnsafe<{ id: string; tableroId: string; antes: string }[]>(
      SQL_PASAR_VENCIDAS_A_ERROR,
      contexto.workspaceId,
      iso,
      MOTIVO_VENCIDA,
      iso,
    );
    for (const vencida of vencidas) {
      await anotarTrabajador(tx, contexto, vencida.id, { estado: vencida.antes }, { estado: "ERROR", motivo: MOTIVO_VENCIDA });
    }
    await tocarTableros(tx, vencidas.map((fila) => fila.tableroId), ahora);
    const avisos = { vencidas: vencidas.map((fila) => fila.id) };

    const ocupada = await tx.$queryRawUnsafe<{ id: string }[]>(SQL_HAY_UNA_TRABAJANDO, contexto.workspaceId, iso);
    if (ocupada.length) {
      return { tarjeta: null, motivo: "ocupado" as const, enCurso: ocupada[0].id, ...avisos };
    }

    const [tomada] = await tx.$queryRawUnsafe<{ id: string; tableroId: string; antes: string; estado: string }[]>(
      SQL_TOMAR_UNA,
      contexto.workspaceId,
      iso,
      [...REPOS_DEL_TRABAJADOR],
      vence,
    );
    if (!tomada) return { tarjeta: null, motivo: "nada" as const, ...avisos };

    await anotarTrabajador(tx, contexto, tomada.id, { estado: tomada.antes }, { estado: tomada.estado, venceEn: vence });
    await tocarTableros(tx, [tomada.tableroId], ahora);
    const fila = await tx.tarjetaTablero.findUniqueOrThrow({ where: { id: tomada.id }, select: SELECT_PARA_TRABAJAR });
    const hacer = esEstado(tomada.estado) ? ETAPA_DEL_ESTADO[tomada.estado] : undefined;
    return { tarjeta: paraElTrabajador(fila), hacer: hacer as EtapaDelTrabajador, ...avisos };
  });
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
 * POST /:id/<accion>. `cuerpo` es el JSON que mandó el trabajador. Cada acción mueve la tarjeta solo
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

  const a = TRANSICIONES_DEL_TRABAJADOR[accion].a as EstadoTarjetaTablero;
  const previo = resultadoComoObjeto(actual.resultado);
  const datos: Prisma.TarjetaTableroUpdateManyMutationInput = { estado: a, trabajoVenceEn: null };
  const despues: Record<string, unknown> = { estado: a };

  try {
    if (accion === "plan") {
      const plan = planDeEntrada(cuerpo.plan);
      datos.plan = plan;
      // Un plan nuevo deja atrás el resultado (y el error) de un intento anterior.
      datos.resultado = Prisma.DbNull;
      despues.plan = plan;
    } else if (accion === "resultado") {
      const resultado = resultadoDeEntrada(cuerpo);
      datos.resultado = resultado as unknown as Prisma.InputJsonValue;
      despues.resultado = resultado;
    } else if (accion === "subida") {
      const subida = {
        commit: typeof cuerpo.commit === "string" ? cuerpo.commit.trim().slice(0, 80) : null,
        version: typeof cuerpo.version === "string" ? cuerpo.version.trim().slice(0, 120) : null,
        cuando: ahora.toISOString(),
      };
      const { error: _errorViejo, ...sinError } = previo;
      void _errorViejo;
      datos.resultado = { ...sinError, subida } as Prisma.InputJsonValue;
      despues.subida = subida;
    } else if (accion === "error") {
      const motivo = motivoDeEntrada(cuerpo.motivo);
      const error = { motivo, en: estado, cuando: ahora.toISOString() };
      datos.resultado = { ...previo, error } as Prisma.InputJsonValue;
      despues.motivo = motivo;
      // Si el cambio toca una zona protegida, el trabajador la marca: se aprueba solo en la pantalla.
      const zonas = zonasDeEntrada(cuerpo.zonaProtegida);
      if (zonas?.length) {
        const final = unirZonas(actual.zonaProtegida, zonas);
        datos.zonaProtegida = final;
        despues.zonaProtegida = final;
      }
    }
  } catch (fallo) {
    if (fallo instanceof ErrorDelTrabajador) throw fallo;
    throw new ErrorDelTrabajador(fallo instanceof Error ? fallo.message : "Datos inválidos.", 400);
  }

  return prisma.$transaction(async (tx) => {
    const hecho = await tx.tarjetaTablero.updateMany({ where: { id: actual.id, estado: actual.estado, borradoEn: null }, data: datos });
    if (hecho.count !== 1) throw new ErrorDelTrabajador("La tarjeta cambió mientras tanto.", 409);
    await anotarTrabajador(tx, contexto, actual.id, { estado }, despues);
    await tocarTableros(tx, [actual.tableroId], ahora);
    return { ok: true, estado: a, link: linkDeLaTarjeta(actual.id) };
  });
}
