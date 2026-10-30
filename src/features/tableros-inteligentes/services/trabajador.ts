import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { esEstado, type EstadoTarjetaTablero } from "./reglas";
import {
  AL_TOMAR,
  ETAPA_DEL_ESTADO,
  MINUTOS_DE_GRACIA_DEL_LATIDO,
  MINUTOS_PARA_HUERFANA,
  MOTIVO_HUERFANA,
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
  TEXTO_APROBACION_HEREDADA,
  aprobacionDelDuenoEnElHistorial,
  planAprobadoPorElDuenoEnElHistorial,
  esGastoEnMetaAds,
  esperaSoloPorLaPruebaExtra,
  soloChatsOBot,
  porQueNoHeredaLaAprobacion,
  errorDeIntentoDeEntrada,
  decisionDeRecogerDeEntrada,
  dependenciaHaceCiclo,
  esperasSeguidas,
  esZona,
  estadoDeLasHijas,
  estadoTrasRecoger,
  etiquetaEsperando,
  lineaParaElDueno,
  puedeRecoger,
  recogidaDelResultado,
  estadoTrasReparar,
  estrategiaDeEntrada,
  etapaDeEntrada,
  detalleDeLaParte,
  linkDeEntrada,
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
  fraseDeLaVigilancia,
  resumenDeTresLineasDeEntrada,
  vigilanciaDeEntrada,
  resumenDeEscalada,
  reversionDeEntrada,
  tituloDeLaParte,
  unirZonas,
  vencimientoDelCandado,
  latidoDeEntrada,
  notaDeYaHecha,
  tituloDeLimpieza,
  zonasDeEntrada,
  zonasQueNoArrancanSolas,
  zonasQuePidenTuSi,
  type AccionDeIntento,
  type AccionDelTrabajador,
  type CategoriaDeIntento,
  type EtapaDelTrabajador,
  type PedidoDeTomar,
  ALCANCE_SISTEMAS,
} from "./reglas-trabajador";
import {
  archivosDeEntrada,
  frase,
  motivosDeLosArchivos,
  motivosDelResultado,
  porQueElPlanEsperaTuSi,
  porQueElPlanNuevoEsperaTuSi,
  porQueElPlanTienePreguntas,
  porQueFaltanCriterios,
  porQueLaTareaEsperaTuSi,
  porQueNoSeApruebaSola,
  porQueUnSupuestoEsDeNegocio,
  riesgoDelPlan,
} from "./reglas-riesgo";
import {
  anotarAprobacionAutomatica,
  aprobacionAutomaticaPrendida,
  aprobarPlanesSoloPrendido,
  motivoDeLaAprobacionAutomatica,
  registroDeAprobacionAutomatica,
} from "./aprobacion-automatica";
import {
  SQL_ARRANQUE,
  SQL_CANDADO_DEL_NEGOCIO,
  SQL_CANDIDATAS,
  SQL_ES_PARTE,
  SQL_MADRES_PARTIDAS,
  SQL_PASAR_HUERFANAS_A_ERROR,
  SQL_PASAR_VENCIDAS_A_ERROR,
  SQL_TOMAR_UNA,
  SQL_TRABAJANDO,
} from "./sql-trabajador";
import { QUIEN_TRABAJADOR, linkDeLaTarjeta } from "./tableros";
import { cerrarLaMadreDeLaParte, cerrarLaMadreSiToca as cerrarMadrePartida } from "./madre-partida";

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
  - /:id/latido corre el vencimiento (de a 5 min, hasta el tope de la etapa: 20 / 90 / 45 min; construyendo en la
    nube, 180 min). Construyendo trae { lugar, sesion }: se guarda en resultado.construccion (25-oct-2026).
  - /:id/subida acepta también resumenTres { hizo, ahora, revisar } (las 3 líneas del agente; se recortan y se descartan si vienen vacías).
  - /:id/plan, /resultado, /subida y /error la mueven de estado (reglas-trabajador.ts). /resultado
    pasa a SUBIENDO (sube sola) o a POR_REVISAR (espera el sí final) según destinoDelResultado.

  Cuando algo falla (24-oct-2026, "reparar"): el Coordinador diagnostica y cada paso deja una fila en
  IntentoTarjeta (el historial de intentos de la tarjeta):
  - /:id/reparar la devuelve a la fila SIN ERROR (PLANEANDO -> APROBADO; EN_CURSO y SUBIENDO ->
    PLAN_APROBADO) y suma una reparación (tope TOPE_DE_REPARACIONES; el 4.º aviso es un /error).
  - /:id/partir (desde PLANEANDO o EN_CURSO) crea de 2 a 4 tarjetas hijas, una tras otra (flechas de dependencia),
    y deja a la madre en su etapa sin candado ("partida, esperando a sus partes"). Se cierra sola cuando todas
    sus partes terminaron: HECHO si todas quedaron HECHO, FALLIDO si alguna quedó FALLIDO (madre-partida.ts).
  - /tomar (26-oct-2026) además cierra las madres colgadas y pasa a ERROR las HUÉRFANAS: PLANEANDO o EN_CURSO sin
    candado, sin cambios hace más de 30 min, que no esperan a sus partes (SUBIENDO pendiente no es huérfana).
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

/**
 * Agrega un miembro activo del negocio como aprobador (alcance DESARROLLO, TODO o SISTEMAS). SISTEMAS (Emanuel, periodo de
 * prueba) es idempotente: si ya es aprobador, solo le cambia el alcance y puede dar el sí final (el límite lo pone reglas-trabajador).
 */
export async function agregarAprobador(workspaceId: string, userId: unknown, alcance: unknown) {
  const id = typeof userId === "string" ? userId : "";
  const elAlcance = alcance === "TODO" ? "TODO" : alcance === ALCANCE_SISTEMAS ? ALCANCE_SISTEMAS : "DESARROLLO";
  const miembro = await prisma.workspaceMember.findFirst({ where: { workspaceId, userId: id, isActive: true }, select: { id: true } });
  if (!miembro) throw new Error("Esa persona no es miembro activo del negocio. Cuando tenga usuario, se agrega.");
  if (elAlcance === ALCANCE_SISTEMAS) {
    await prisma.aprobadorTablero.upsert({
      where: { workspaceId_userId: { workspaceId, userId: id } },
      create: { workspaceId, userId: id, alcance: ALCANCE_SISTEMAS, puedeSubir: true },
      update: { alcance: ALCANCE_SISTEMAS, puedeSubir: true },
    });
    return;
  }
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
  /** La última aprobación del plan la dio una persona (no la automática): un plan con preguntas abiertas igual se construye. */
  planAprobadoPorElDueno: boolean;
};

/** Los últimos 6 intentos (del más viejo al más nuevo), las esperas seguidas, el último error y si es una parte. */
async function datosDeIntentos(tx: Tx, fila: { id: string; tableroId: string }): Promise<DatosDeIntentos> {
  const [recientes, madre, aprobaciones] = await Promise.all([
    tx.intentoTarjeta.findMany({
      where: { tarjetaId: fila.id },
      orderBy: { numero: "desc" },
      take: 50,
      select: { numero: true, etapa: true, categoria: true, causa: true, error: true, accion: true, cuentaComoIntento: true },
    }),
    tx.$queryRawUnsafe<{ id: string }[]>(SQL_ES_PARTE, fila.tableroId, fila.id),
    tx.historialTarjeta.findMany({
      where: { tarjetaId: fila.id, accion: "aprobar", deshechoEn: null },
      orderBy: { creadoEn: "desc" },
      take: 20,
      select: { accion: true, despues: true },
    }),
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
    planAprobadoPorElDueno: planAprobadoPorElDuenoEnElHistorial(aprobaciones),
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
    planAprobadoPorElDueno: intentos.planAprobadoPorElDueno,
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
    // Las madres partidas cuyas partes ya terminaron (todas HECHO, o alguna FALLIDO) se cierran: antes del 26-oct
    // solo se cerraban si todas subían, y con una parte FALLIDO quedaban colgadas en su etapa, sin candado.
    const madresCerradas: string[] = [];
    const tablerosDeLasMadres: string[] = [];
    for (const { id } of await tx.$queryRawUnsafe<{ id: string }[]>(SQL_MADRES_PARTIDAS, contexto.workspaceId)) {
      const cerrada = await cerrarMadrePartida(tx, id);
      if (!cerrada) continue;
      await anotarTrabajador(tx, contexto, cerrada.id, { estado: cerrada.antes }, { estado: cerrada.estado, nota: cerrada.nota });
      madresCerradas.push(cerrada.id);
      tablerosDeLasMadres.push(cerrada.tableroId);
    }

    // Red de seguridad: las HUÉRFANAS (PLANEANDO o EN_CURSO sin candado, sin cambios hace más de
    // MINUTOS_PARA_HUERFANA, que no esperan a sus partes) pasan a ERROR: nadie las trabaja y nunca vencerían.
    // SUBIENDO pendiente no entra: esa sí espera, a propósito, sin candado.
    const huerfanas = await tx.$queryRawUnsafe<{ id: string; tableroId: string; antes: string }[]>(
      SQL_PASAR_HUERFANAS_A_ERROR,
      contexto.workspaceId,
      iso,
      MOTIVO_HUERFANA,
      iso,
      MINUTOS_PARA_HUERFANA,
    );
    for (const huerfana of huerfanas) {
      await anotarTrabajador(tx, contexto, huerfana.id, { estado: huerfana.antes }, { estado: "ERROR", motivo: MOTIVO_HUERFANA });
    }

    await tocarTableros(
      tx,
      [...vencidasODejadas.map((fila) => fila.tableroId), ...tablerosDeLasMadres, ...huerfanas.map((fila) => fila.tableroId)],
      ahora,
    );
    const avisos = {
      vencidas: vencidas.map((fila) => fila.id),
      sueltas: sueltas.map((fila) => fila.id),
      huerfanas: huerfanas.map((fila) => fila.id),
      madresCerradas,
    };

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

/**
 * Cuando una parte termina, la madre partida se cierra si ya no espera a ninguna (HECHO si todas quedaron HECHO,
 * FALLIDO si alguna quedó FALLIDO: madre-partida.ts). Deja su fila en el historial (origen TRABAJADOR).
 */
async function cerrarLaMadreSiToca(tx: Tx, contexto: ContextoTrabajador, hija: { id: string; tableroId: string }) {
  const cerrada = await cerrarLaMadreDeLaParte(tx, hija);
  if (cerrada) await anotarTrabajador(tx, contexto, cerrada.id, { estado: cerrada.antes }, { estado: cerrada.estado, nota: cerrada.nota });
}

/** POST /candidatas: las que /tomar podría tomar, sin tomarlas (con su repo, zonas y plan). */
export async function candidatasDelTrabajador(contexto: ContextoTrabajador) {
  const filas = await prisma.$queryRawUnsafe<
    { id: string; titulo: string; estado: string; repo: string; zonaProtegida: string[]; plan: string | null; desbloquea: number }[]
  >(SQL_CANDIDATAS, contexto.workspaceId, [...REPOS_DEL_TRABAJADOR]);
  return {
    candidatas: filas.map((fila) => ({
      ...fila,
      hacer: esEstado(fila.estado) ? (AL_TOMAR[fila.estado]?.etapa ?? null) : null,
    })),
  };
}

/**
 * POST /errores (26-oct-2026): las tarjetas que están en ERROR (con repo de la lista), las más viejas primero, con lo que
 * el Coordinador necesita para recogerlas una vez al día: si es una parte, cuántas veces se recogió, su último error y los
 * últimos intentos. Solo lee.
 */
export async function erroresDelTrabajador(contexto: ContextoTrabajador) {
  const filas = await prisma.tarjetaTablero.findMany({
    where: { estado: "ERROR", borradoEn: null, repo: { in: [...REPOS_DEL_TRABAJADOR] }, tablero: { workspaceId: contexto.workspaceId } },
    orderBy: { actualizadoEn: "asc" },
    take: 50,
    select: SELECT_PARA_TRABAJAR,
  });
  const tarjetas = [];
  for (const fila of filas) {
    const intentos = await datosDeIntentos(prisma, fila);
    const recogida = recogidaDelResultado(fila.resultado);
    const resultado = resultadoComoObjeto(fila.resultado);
    const error = resultadoComoObjeto(resultado.error);
    tarjetas.push({
      id: fila.id,
      titulo: fila.titulo,
      detalle: fila.detalle?.slice(0, 6000) ?? "",
      repo: fila.repo,
      tablero: fila.tablero.nombre,
      plan: fila.plan,
      zonaProtegida: fila.zonaProtegida,
      riesgo: fila.riesgo,
      riesgoMotivo: fila.riesgoMotivo,
      intentos: fila.intentos,
      reparaciones: fila.reparaciones,
      esParte: intentos.esParte,
      recogidas: recogida.veces,
      ultimaRecogida: recogida.ultima,
      lineaParaElDueno: recogida.linea,
      motivo: typeof error.motivo === "string" ? error.motivo : null,
      ultimoError: intentos.ultimoError,
      ultimosIntentos: intentos.ultimosIntentos,
    });
  }
  return { tarjetas };
}

/**
 * Las tarjetas POR_REVISAR que pasaron build y pruebas y a las que solo les faltaba la prueba extra de su zona (o que ya traen
 * un sí del dueño): el Coordinador las revisa de nuevo con el diff real (/:id/rescatar). Solo lee.
 * `{ tarjetas: [{ id, titulo, repo, plan, zonaProtegida, rama, base, commit, archivos, esperaPor, aprobadaPorElDueno }] }`.
 */
export async function porRevisarDelTrabajador(contexto: ContextoTrabajador) {
  const filas = await prisma.tarjetaTablero.findMany({
    where: { estado: "POR_REVISAR", borradoEn: null, repo: { in: [...REPOS_DEL_TRABAJADOR] }, tablero: { workspaceId: contexto.workspaceId } },
    orderBy: { actualizadoEn: "asc" },
    take: 50,
    select: SELECT_PARA_TRABAJAR,
  });
  const tarjetas = [];
  for (const fila of filas) {
    const resultado = resultadoComoObjeto(fila.resultado);
    const esperaPor = typeof resultado.esperaPor === "string" ? resultado.esperaPor : null;
    // Solo las que pasaron todo, sin zona que pida el sí y sin otro motivo para esperar que la prueba extra.
    if (resultado.paso !== true || zonasQuePidenTuSi(fila.zonaProtegida).length || (esperaPor && !esperaSoloPorLaPruebaExtra(esperaPor))) continue;
    const historial = await prisma.historialTarjeta.findMany({ where: { tarjetaId: fila.id, accion: "aprobar" }, select: { accion: true, despues: true }, take: 100 });
    const aprobada = aprobacionDelDuenoEnElHistorial(historial);
    // Sin sí del dueño y sin motivo de la prueba extra: espera su sí por otra causa (riesgo, repo que no sube solo): no se toca.
    if (!esperaPor && !aprobada) continue;
    tarjetas.push({
      id: fila.id,
      titulo: fila.titulo,
      detalle: fila.detalle?.slice(0, 6000) ?? "",
      repo: fila.repo,
      plan: fila.plan,
      zonaProtegida: fila.zonaProtegida,
      rama: typeof resultado.rama === "string" ? resultado.rama : null,
      base: typeof resultado.base === "string" ? resultado.base : null,
      commit: typeof resultado.commit === "string" ? resultado.commit : null,
      archivos: Array.isArray(resultado.archivos) ? resultado.archivos : [],
      esperaPor,
      aprobadaPorElDueno: aprobada,
      migracionDestructiva: Array.isArray(resultado.migracionDestructiva) ? resultado.migracionDestructiva : [],
      riesgo: fila.riesgo,
    });
  }
  return { tarjetas };
}

/**
 * POST /:id/rescatar (desde POR_REVISAR): el Coordinador volvió a mirar el cambio con el diff real. `sube: true` con su
 * `confirmacion` (la frase de la prueba extra que escribió él): pasa a SUBIENDO (pendiente), con la misma vigilancia de 30
 * minutos. `sube: false` con `motivo`: sigue POR_REVISAR y el motivo queda en el resultado (por ejemplo, un envío nuevo en chats).
 * El CRM vuelve a comprobar lo suyo: que haya pasado todo, que ninguna zona pida el sí, que no toque dinero ni gasto en Meta Ads.
 */
async function rescatarTarjeta(contexto: ContextoTrabajador, actual: FilaParaTrabajar, cuerpo: Record<string, unknown>, ahora: Date) {
  const previo = resultadoComoObjeto(actual.resultado);
  if (previo.paso !== true) throw new ErrorDelTrabajador("Solo se rescata una tarjeta que pasó build y pruebas.", 409);
  const zonaQuePide = zonasQuePidenTuSi(actual.zonaProtegida);
  if (zonaQuePide.length) throw new ErrorDelTrabajador(`La zona ${zonaQuePide.join(", ")} espera el sí del dueño.`, 409);
  const esperaPor = typeof previo.esperaPor === "string" ? previo.esperaPor : null;
  if (esperaPor && !esperaSoloPorLaPruebaExtra(esperaPor)) throw new ErrorDelTrabajador(`Espera el sí del dueño: ${esperaPor}.`, 409);

  if (cuerpo.sube !== true) {
    const motivo = motivoDeEntrada(cuerpo.motivo);
    return prisma.$transaction(async (tx) => {
      const hecho = await tx.tarjetaTablero.updateMany({
        where: { id: actual.id, estado: "POR_REVISAR", borradoEn: null },
        data: { resultado: { ...previo, esperaPor: motivo } as Prisma.InputJsonValue },
      });
      if (hecho.count !== 1) throw new ErrorDelTrabajador("La tarjeta cambió mientras tanto.", 409);
      await anotarTrabajador(tx, contexto, actual.id, { estado: actual.estado }, { estado: "POR_REVISAR", nota: `revisada de nuevo, sigue esperando tu sí (${motivo})` });
      await tocarTableros(tx, [actual.tableroId], ahora);
      return { ok: true, estado: "POR_REVISAR" as const, sube: false, link: linkDeLaTarjeta(actual.id) };
    });
  }

  const confirmacion = typeof cuerpo.confirmacion === "string" ? cuerpo.confirmacion.trim().slice(0, 300) : "";
  if (!confirmacion) throw new ErrorDelTrabajador("Falta la confirmación de la prueba extra.", 400);
  const migracion = Array.isArray(previo.migracionDestructiva) ? (previo.migracionDestructiva as unknown[]) : [];
  if (migracion.length) throw new ErrorDelTrabajador("La migración tiene cambios destructivos: espera el sí del dueño.", 409);
  const plan = porQueElPlanEsperaTuSi(actual.plan ?? "");
  if (plan) throw new ErrorDelTrabajador(`Espera el sí del dueño: ${plan}.`, 409);
  const dinero = motivosDeLosArchivos(Array.isArray(previo.archivos) ? (previo.archivos as string[]) : []).find((motivo) => motivo.startsWith("toca dinero"));
  if (dinero) throw new ErrorDelTrabajador(`Espera el sí del dueño: el cambio ${dinero}.`, 409);
  const tarea = porQueLaTareaEsperaTuSi({ titulo: actual.titulo, detalle: actual.detalle, zonaProtegida: [], zonasQueEsperan: [] });
  const historial = await prisma.historialTarjeta.findMany({ where: { tarjetaId: actual.id, accion: "aprobar" }, select: { accion: true, despues: true }, take: 100 });
  // Con dinero o gasto en Meta Ads en el texto de la tarea solo sube si el dueño ya dio su sí.
  if (tarea && !aprobacionDelDuenoEnElHistorial(historial)) throw new ErrorDelTrabajador(`Espera el sí del dueño: ${tarea}.`, 409);

  const { esperaPor: _quitada, ...sinEspera } = previo;
  void _quitada;
  const pruebas = typeof previo.pruebas === "string" ? previo.pruebas : "";
  return prisma.$transaction(async (tx) => {
    const hecho = await tx.tarjetaTablero.updateMany({
      where: { id: actual.id, estado: "POR_REVISAR", borradoEn: null },
      data: {
        estado: "SUBIENDO",
        trabajoVenceEn: null,
        resultado: { ...sinEspera, subeSolo: true, pruebas: `${pruebas}${pruebas ? "\n" : ""}${confirmacion}`.slice(0, 6000) } as Prisma.InputJsonValue,
      },
    });
    if (hecho.count !== 1) throw new ErrorDelTrabajador("La tarjeta cambió mientras tanto.", 409);
    await anotarTrabajador(tx, contexto, actual.id, { estado: actual.estado }, { estado: "SUBIENDO", nota: `revisada de nuevo por el Coordinador, sube sola (${confirmacion})` });
    await tocarTableros(tx, [actual.tableroId], ahora);
    return { ok: true, estado: "SUBIENDO" as const, sube: true, link: linkDeLaTarjeta(actual.id) };
  });
}

/**
 * POST /:id/revisar_de_nuevo (desde POR_REVISAR, 30-oct-2026): saca a una tarjeta de CHATS / BOT_VENTAS que ya esperaba el sí
 * del dueño. `subeSolo: true` -> SUBIENDO pendiente (sin candado, la toma enseguida y la vigila 30 min; sus zonasAprobadas
 * salen de sus zonas al tomarla); `subeSolo: false` -> ERROR con "construido, no sube: <motivo>". Solo vale si pasó la
 * construcción, todas sus zonas son CHATS o BOT_VENTAS y no espera por gasto en Meta Ads; si no, 409 y no cambia nada.
 */
async function revisarDeNuevo(contexto: ContextoTrabajador, actual: FilaParaTrabajar, cuerpo: Record<string, unknown>, ahora: Date) {
  if (typeof cuerpo.subeSolo !== "boolean") throw new ErrorDelTrabajador("Falta subeSolo (sí o no).", 400);
  const previo = resultadoComoObjeto(actual.resultado);
  if (previo.paso !== true) throw new ErrorDelTrabajador("Solo se revisa de nuevo una tarjeta que pasó build y pruebas.", 409);
  if (!soloChatsOBot(actual.zonaProtegida)) throw new ErrorDelTrabajador("Solo vale para tarjetas cuyas zonas son CHATS o BOT_VENTAS.", 409);
  const esperaPor = typeof previo.esperaPor === "string" ? previo.esperaPor : null;
  if (esGastoEnMetaAds(esperaPor)) throw new ErrorDelTrabajador(`Espera el sí del dueño: ${esperaPor}.`, 409);
  const pruebas = Array.isArray(cuerpo.pruebas)
    ? cuerpo.pruebas.filter((texto): texto is string => typeof texto === "string" && texto.trim().length > 0).slice(0, 20).map((texto) => texto.trim().slice(0, 300))
    : [];
  const sube = cuerpo.subeSolo;
  if (sube) {
    // Lo mismo que comprueba rescatar: el dinero de Gestión y los cambios destructivos siguen esperando el sí del dueño.
    const migracion = Array.isArray(previo.migracionDestructiva) ? (previo.migracionDestructiva as unknown[]) : [];
    if (migracion.length) throw new ErrorDelTrabajador("La migración tiene cambios destructivos: espera el sí del dueño.", 409);
    const plan = porQueElPlanEsperaTuSi(actual.plan ?? "");
    if (plan) throw new ErrorDelTrabajador(`Espera el sí del dueño: ${plan}.`, 409);
    const dinero = motivosDeLosArchivos(Array.isArray(previo.archivos) ? (previo.archivos as string[]) : []).find((m) => m.startsWith("toca dinero"));
    if (dinero) throw new ErrorDelTrabajador(`Espera el sí del dueño: el cambio ${dinero}.`, 409);
    const tarea = porQueLaTareaEsperaTuSi({ titulo: actual.titulo, detalle: actual.detalle, zonaProtegida: [], zonasQueEsperan: [] });
    if (tarea) {
      const historial = await prisma.historialTarjeta.findMany({ where: { tarjetaId: actual.id, accion: "aprobar" }, select: { accion: true, despues: true }, take: 100 });
      if (!aprobacionDelDuenoEnElHistorial(historial)) throw new ErrorDelTrabajador(`Espera el sí del dueño: ${tarea}.`, 409);
    }
  }
  const motivoDelCuerpo = typeof cuerpo.motivo === "string" && cuerpo.motivo.trim() ? cuerpo.motivo : null;
  const motivo = sube ? null : `construido, no sube: ${motivoDeEntrada(motivoDelCuerpo ?? esperaPor ?? "el Coordinador no la dejó subir sola")}`.slice(0, 600);
  const vuelve: EstadoTarjetaTablero = sube ? "SUBIENDO" : "ERROR";
  const resultado = sube
    ? (() => {
        const { esperaPor: _quitada, ...sinEspera } = previo;
        void _quitada;
        return { ...sinEspera, subeSolo: true };
      })()
    : { ...previo, error: { motivo, en: "POR_REVISAR", cuando: ahora.toISOString() } };
  return prisma.$transaction(async (tx) => {
    const hecho = await tx.tarjetaTablero.updateMany({
      where: { id: actual.id, estado: "POR_REVISAR", borradoEn: null },
      data: { estado: vuelve, trabajoVenceEn: null, resultado: resultado as Prisma.InputJsonValue },
    });
    if (hecho.count !== 1) throw new ErrorDelTrabajador("La tarjeta cambió mientras tanto.", 409);
    await anotarTrabajador(
      tx,
      contexto,
      actual.id,
      { estado: actual.estado },
      {
        estado: vuelve,
        nota: sube ? "revisada de nuevo por el Coordinador, sube sola (zona CHATS / BOT_VENTAS)" : motivo,
        ...(pruebas.length ? { pruebas } : {}),
      },
    );
    await tocarTableros(tx, [actual.tableroId], ahora);
    return { ok: true, estado: vuelve, sube, link: linkDeLaTarjeta(actual.id) };
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
    // Construyendo, el latido dice dónde (aizen1 o nube) y el link de la sesión de la nube. En la nube el tope es de
    // 180 min (no 90) y la tarjeta muestra "La está construyendo Claude en la nube… Ver la sesión".
    const { lugar, linkSesion } = latidoDeEntrada(cuerpo);
    const venceEn = vencimientoDelCandado(etapa, actual.trabajoIniciadoEn, ahora, etapa === "construir" ? lugar : null);
    const previo = resultadoComoObjeto(actual.resultado);
    const construccionAntes = resultadoComoObjeto(previo.construccion);
    const cambiaConstruccion = etapa === "construir" && lugar !== null && (construccionAntes.lugar !== lugar || (construccionAntes.linkSesion ?? null) !== linkSesion);
    const hecho = await prisma.tarjetaTablero.updateMany({
      where: { id: actual.id, estado: actual.estado, trabajoVenceEn: { gt: ahora } },
      data: {
        trabajoVenceEn: venceEn,
        ...(cambiaConstruccion ? { resultado: { ...previo, construccion: { lugar, linkSesion } } as Prisma.InputJsonValue } : {}),
      },
    });
    if (hecho.count !== 1) throw new ErrorDelTrabajador("La tarjeta cambió mientras tanto.", 409);
    // Lo único visible que cambia un latido: dónde se construye y el link de la sesión (una o dos veces por tarjeta).
    if (cambiaConstruccion) await prisma.tableroInteligente.updateMany({ where: { id: actual.tableroId }, data: { actualizadoEn: ahora } });
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
  if (accion === "depender") return ponerDependencias(contexto, actual, cuerpo, ahora);
  if (accion === "limpieza") return pedirLimpieza(contexto, actual, cuerpo, ahora);
  if (accion === "recoger") return recogerTarjeta(contexto, actual, cuerpo, ahora);
  if (accion === "rescatar") return rescatarTarjeta(contexto, actual, cuerpo, ahora);
  if (accion === "revisar_de_nuevo") return revisarDeNuevo(contexto, actual, cuerpo, ahora);

  let a = TRANSICIONES_DEL_TRABAJADOR[accion].a as EstadoTarjetaTablero;
  const previo = resultadoComoObjeto(actual.resultado);
  const datos: Prisma.TarjetaTableroUpdateManyMutationInput = { estado: a, trabajoVenceEn: null };
  const despues: Record<string, unknown> = { estado: a };
  // El plan de una tarjeta BAJO que se aprueba solo: se anota como una aprobación aparte (abajo).
  let aprobacionDelPlan: ReturnType<typeof registroDeAprobacionAutomatica> | null = null;
  // true si ese plan se aprobó por la regla del dueño (24-oct) y no por el riesgo BAJO.
  let reglaDelDueno = false;
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
      // Regla del dueño (24-oct): con "Aprobar planes solo" prendido, el plan espera su sí solo si toca dinero de Gestión
      // o gasto en Meta Ads. Una tarjeta con zona protegida también espera: /tomar exige que su plan se apruebe en la
      // pantalla, así que aprobarlo solo la dejaría parada en PLAN_APROBADO sin que nadie lo vea. Desde el 25-oct, CHATS y BOT_VENTAS
      // arrancan solas (ZONAS_QUE_ARRANCAN_SOLAS): su plan se aprueba solo igual que el de cualquier otra tarjeta.
      const planesSolos = await aprobarPlanesSoloPrendido(contexto.workspaceId);
      const esperaPorRegla = !planesSolos
        ? null
        : zonasQueNoArrancanSolas(actual.zonaProtegida).length
          ? `tiene zona protegida (${zonasQueNoArrancanSolas(actual.zonaProtegida).join(", ")}): su plan se aprueba en la pantalla`
          : porQueElPlanNuevoEsperaTuSi(plan);
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
          // 29-oct-2026: un plan con preguntas abiertas, sin criterios de aceptación o con un supuesto de negocio no se
          // aprueba solo, aunque sea BAJO.
          const preguntas = porQueElPlanTienePreguntas(plan) ?? porQueFaltanCriterios(plan) ?? porQueUnSupuestoEsDeNegocio(plan);
          if (preguntas) despues.nota = `plan listo, espera tu sí (${preguntas})`;
          if (!noSola && !esperaPorRegla && !preguntas) {
            const motivo = motivoDeLaAprobacionAutomatica(revision.motivoDeclarado ?? actual.riesgoMotivo);
            aprobacionDelPlan = registroDeAprobacionAutomatica({ estado: "PLAN_APROBADO", momento: "plan", motivo });
            a = "PLAN_APROBADO";
            datos.estado = a;
          }
        }
      }
      // Regla del dueño (24-oct): aprobada la tarea, el plan pasa solo a construir. Única excepción: el plan toca
      // dinero de Gestión o gasto en Meta Ads (queda PLAN_LISTO con el motivo). Con el interruptor apagado, todo
      // como antes.
      if (!aprobacionDelPlan && planesSolos) {
        if (esperaPorRegla) {
          despues.nota = `plan listo, espera tu sí (${esperaPorRegla})`;
          if (actual.riesgoPor !== "DUENO") {
            datos.riesgo = "ALTO";
            datos.riesgoMotivo = esperaPorRegla.slice(0, 300);
            datos.riesgoPor = "TRABAJADOR";
            despues.riesgo = "ALTO";
            despues.riesgoMotivo = datos.riesgoMotivo;
          }
        } else {
          aprobacionDelPlan = registroDeAprobacionAutomatica({
            estado: "PLAN_APROBADO",
            momento: "plan",
            motivo: "el plan no toca dinero de Gestión ni gasto en Meta Ads",
            regla: "dueno-24-oct",
          });
          reglaDelDueno = true;
          a = "PLAN_APROBADO";
          datos.estado = a;
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
      // Regla del dueño (27-oct): el sí que ya dio vale aunque la tarea se reconstruya. Salvo dinero, gasto en Meta Ads,
      // un motivo del Coordinador para esperar (envío nuevo en chats...) o un riesgo que subió a ALTO con este resultado.
      let aprobacionHeredada = false;
      if (resultado.paso && !subeSolo && datos.riesgo === undefined) {
        const historial = await prisma.historialTarjeta.findMany({ where: { tarjetaId: actual.id, accion: "aprobar" }, select: { accion: true, despues: true }, take: 100 });
        aprobacionHeredada =
          porQueNoHeredaLaAprobacion({
            historial,
            titulo: actual.titulo,
            detalle: actual.detalle,
            plan: actual.plan,
            esperaPor: resultado.esperaPor ?? null,
            migracionDestructiva: resultado.migracionDestructiva ?? null,
          }) === null;
      }
      // Sube sola (SUBIENDO pendiente, la toma enseguida) o espera el sí final del dueño (POR_REVISAR).
      a = destinoDelResultado({ paso: resultado.paso, subeSolo, zonaProtegida: zonas, aprobacionHeredada, esperaPor: resultado.esperaPor ?? null });
      datos.estado = a;
      despues.estado = a;
      // CHATS / BOT_VENTAS que construyó bien y no puede subir sola: ERROR con el motivo en una línea (no espera el sí del dueño).
      let motivoDeError: string | null = null;
      if (a === "ERROR") {
        motivoDeError = `construido, no sube: ${resultado.esperaPor || datos.riesgoMotivo || "el Coordinador no la dejó subir sola"}`.slice(0, 600);
      }
      // Lo que queda guardado dice lo que de verdad pasó: si el riesgo subió a ALTO, ya no "sube solo".
      if (a === "SUBIENDO" && aprobacionHeredada) {
        subeSolo = true;
        delete resultado.esperaPor;
      }
      resultado.subeSolo = subeSolo;
      // Mismo formato que deja /error: { motivo, en, cuando }.
      const resultadoGuardado = motivoDeError ? { ...resultado, error: { motivo: motivoDeError, en: estado, cuando: ahora.toISOString() } } : resultado;
      datos.resultado = resultadoGuardado as unknown as Prisma.InputJsonValue;
      despues.resultado = resultadoGuardado;
      const zonasQueSuben = zonas.filter((zona) => !zonasQuePidenTuSi([zona]).length);
      despues.nota =
        motivoDeError
          ? motivoDeError
          : a === "SUBIENDO" && aprobacionHeredada
          ? TEXTO_APROBACION_HEREDADA
          : a === "SUBIENDO"
          ? zonasQueSuben.length
            ? `construido, sube solo (zona ${zonasQueSuben.map((zona) => (esZona(zona) ? NOMBRE_DE_LA_ZONA[zona] : zona)).join(", ")})`
            : "construido, sube solo"
          : resultado.esperaPor
            ? `construido, espera tu sí (${resultado.esperaPor})`
            : zonas.length
              ? `construido, espera tu sí (zona ${zonas.map((zona) => (esZona(zona) ? NOMBRE_DE_LA_ZONA[zona] : zona)).join(", ")})`
              : "construido, espera tu sí";
    } else if (accion === "subida") {
      const resumenTres = resumenDeTresLineasDeEntrada(cuerpo.resumenTres);
      const subida = {
        commit: typeof cuerpo.commit === "string" ? cuerpo.commit.trim().slice(0, 80) : null,
        version: typeof cuerpo.version === "string" ? cuerpo.version.trim().slice(0, 120) : null,
        linkCommit: linkDeEntrada(cuerpo.linkCommit),
        cuando: ahora.toISOString(),
        // Las 3 líneas del agente (qué se hizo, qué se ve ahora, qué revisar juntos); sin ellas, la subida queda como antes.
        ...(resumenTres ? { resumenTres } : {}),
      };
      const { error: _errorViejo, ...sinError } = previo;
      void _errorViejo;
      datos.resultado = { ...sinError, subida } as Prisma.InputJsonValue;
      despues.subida = subida;
      // Las zonas que suben solas (bot, Meta Ads, libro V3) se vigilan 30 min: el Coordinador manda lo que vio.
      const vigilancia = vigilanciaDeEntrada(cuerpo.vigilancia);
      if (vigilancia) {
        datos.resultado = { ...sinError, subida: { ...subida, vigilancia, resumenVigilancia: fraseDeLaVigilancia(vigilancia) } } as Prisma.InputJsonValue;
        despues.vigilancia = vigilancia;
      }
      despues.nota = `subido a main, commit ${subida.commit?.slice(0, 10) ?? "?"}; en producción, versión ${subida.version?.slice(0, 10) ?? "?"}`;
    } else if (accion === "ya-hecha") {
      // Ya estaba en main (el Coordinador comprobó el commit con git): HECHO con la nota, sin pedirle nada al dueño.
      const commit = typeof cuerpo.commit === "string" ? cuerpo.commit.trim().slice(0, 40) : "";
      if (!/^[0-9a-f]{7,40}$/i.test(commit)) throw new ErrorDelTrabajador("Falta el commit de main donde ya estaba hecho.", 400);
      const motivo = typeof cuerpo.motivo === "string" ? cuerpo.motivo.trim().slice(0, 300) : "";
      const yaEstabaHecho = { commit, motivo, nota: notaDeYaHecha(commit), cuando: ahora.toISOString() };
      const { error: _errorViejo, ...sinError } = previo;
      void _errorViejo;
      datos.resultado = { ...sinError, yaEstabaHecho } as Prisma.InputJsonValue;
      despues.yaEstabaHecho = yaEstabaHecho;
      despues.nota = motivo ? `${yaEstabaHecho.nota}: ${motivo}` : yaEstabaHecho.nota;
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
        ...(aprobacionDelPlan ? { titulo: actual.titulo, detalle: actual.detalle, zonaProtegida: { equals: actual.zonaProtegida } } : {}),
      },
      data: datos,
    });
    if (hecho.count !== 1) throw new ErrorDelTrabajador("La tarjeta cambió mientras tanto.", 409);
    if (aprobacionDelPlan) {
      // El plan queda PLAN_LISTO un instante y se aprueba solo: quedan las dos filas en el historial.
      despues.estado = "PLAN_LISTO";
      despues.nota = reglaDelDueno ? "plan listo, se aprueba solo (regla del dueño 24-oct)" : "plan listo, se aprueba solo (riesgo BAJO)";
    }
    await anotarTrabajador(tx, contexto, actual.id, { estado }, despues);
    if (aprobacionDelPlan) await anotarAprobacionAutomatica(tx, actual.id, { estado: "PLAN_LISTO" }, aprobacionDelPlan);
    if (intentoPorGuardar) await anotarIntento(tx, actual.id, intentoPorGuardar, ahora);
    // Una parte que sube puede ser la última: entonces la madre se cierra (HECHO, o FALLIDO si otra parte quedó fallida).
    if (accion === "subida" || accion === "ya-hecha") await cerrarLaMadreSiToca(tx, contexto, actual);
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
 * candado (nadie la toma) y se cierra sola cuando terminan todas: HECHO, o FALLIDO si alguna falló (cerrarLaMadreSiToca).
 */
async function partirTarjeta(
  contexto: ContextoTrabajador,
  actual: FilaParaTrabajar,
  cuerpo: Record<string, unknown>,
  ahora: Date,
  desdeError = false,
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
  // Dónde queda la madre: donde estaba (PLANEANDO o EN_CURSO, sin candado). Una que estaba en ERROR (se recoge) vuelve a
  // EN_CURSO si ya tenía plan y a PLANEANDO si no: así las hijas quedan "por planear" o "por construir" según el caso.
  const estadoActual = actual.estado as EstadoTarjetaTablero;
  const estadoDeLaMadre: EstadoTarjetaTablero = desdeError ? (actual.plan?.trim() ? "EN_CURSO" : "PLANEANDO") : estadoActual;
  const estadoDeLasPartes = estadoDeLasHijas(estadoDeLaMadre);
  const intento: IntentoPorGuardar = {
    etapa: etapaDeEntrada(cuerpo.etapa, estadoDeLaMadre),
    categoria: categoriaDeEntrada(cuerpo.categoria) ?? "tarea_muy_grande",
    causa,
    error: errorDeIntentoDeEntrada(cuerpo.error),
    accion: "partir",
    cuentaComoIntento: false,
  };

  return prisma.$transaction(async (tx) => {
    const madre = await tx.tarjetaTablero.findFirst({
      where: { id: actual.id, estado: actual.estado, borradoEn: null },
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
          estado: estadoDeLasPartes,
          orden: madre.orden + numero,
          tipoId: madre.tipoId,
          padreId,
          repo: actual.repo,
          // Partida al planear: las hijas quedan "aprobadas, por planear", sin plan copiado (cada una se planea aparte).
          plan: estadoDeLasPartes === "PLAN_APROBADO" ? parte.detalle : null,
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
            estado: estadoDeLasPartes,
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
          antes: { estado: estadoDeLasPartes } as Prisma.InputJsonValue,
          despues: {
            ...(conZona
              ? registroDeAprobacion({
                  estado: estadoDeLasPartes,
                  momento: estadoDeLasPartes === "PLAN_APROBADO" ? "plan" : "tarea",
                  via: "pantalla",
                  quienNombre: "el dueño (en la tarjeta madre)",
                  userId: quienEs(contexto),
                  textoConfirmacion: null,
                })
              : { estado: estadoDeLasPartes, momento: estadoDeLasPartes === "PLAN_APROBADO" ? "plan" : "tarea" }),
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
      where: { id: actual.id, estado: actual.estado, borradoEn: null },
      data: {
        estado: estadoDeLaMadre,
        trabajoVenceEn: null,
        resultado: { ...previo, partida: { hijas, causa, cuando: ahora.toISOString() } } as Prisma.InputJsonValue,
      },
    });
    if (hecho.count !== 1) throw new ErrorDelTrabajador("La tarjeta cambió mientras tanto.", 409);
    await anotarTrabajador(
      tx,
      contexto,
      actual.id,
      { estado: actual.estado },
      { estado: estadoDeLaMadre, nota: `partida en ${partes.length} partes: ${causa}`, hijas },
    );
    await anotarIntento(tx, actual.id, intento, ahora);
    await tocarTableros(tx, [actual.tableroId], ahora);
    return { ok: true, estado: estadoDeLaMadre, hijas, link: linkDeLaTarjeta(actual.id) };
  });
}


/**
 * POST /:id/depender (26-oct-2026): al medir, el texto de la tarjeta nombra a otra como molde o requisito. Pone la flecha
 * de dependencia (la otra → esta) por cada referencia que exista en el mismo tablero (por id o por título exacto) y que no
 * haga un ciclo. Si alguna no está HECHO, la tarjeta vuelve a la fila (PLANEANDO → APROBADO) sin ERROR y sin gastar el intento:
 * queda "Esperando a «X»". Cada flecha queda en el historial y se quita con un clic desde el tablero.
 */
async function ponerDependencias(contexto: ContextoTrabajador, actual: FilaParaTrabajar, cuerpo: Record<string, unknown>, ahora: Date) {
  const referencias = Array.isArray(cuerpo.referencias)
    ? cuerpo.referencias.filter((valor): valor is string => typeof valor === "string" && valor.trim().length > 0).map((valor) => valor.trim()).slice(0, 5)
    : [];
  if (!referencias.length) throw new ErrorDelTrabajador("Faltan las referencias: manda los ids o títulos de las tarjetas de las que depende.", 400);

  return prisma.$transaction(async (tx) => {
    const candidatas = await tx.tarjetaTablero.findMany({
      where: { tableroId: actual.tableroId, borradoEn: null, id: { not: actual.id }, tipo: { usaEstados: true } },
      select: { id: true, titulo: true, estado: true },
    });
    const origenes = new Map<string, { id: string; titulo: string; estado: string }>();
    for (const referencia of referencias) {
      const buscada = referencia.toLowerCase();
      const encontrada = candidatas.find((tarjeta) => tarjeta.id === referencia) ?? candidatas.find((tarjeta) => tarjeta.titulo.trim().toLowerCase() === buscada);
      if (encontrada) origenes.set(encontrada.id, encontrada);
    }
    const dependencias = await tx.conexionTarjeta.findMany({ where: { tableroId: actual.tableroId, esDependencia: true }, select: { origenId: true, destinoId: true } });
    const creadas: string[] = [];
    for (const origen of origenes.values()) {
      if (dependencias.some((flecha) => flecha.origenId === origen.id && flecha.destinoId === actual.id)) continue;
      if (dependenciaHaceCiclo(dependencias, origen.id, actual.id)) continue;
      await tx.conexionTarjeta.create({ data: { tableroId: actual.tableroId, origenId: origen.id, destinoId: actual.id, esDependencia: true } });
      dependencias.push({ origenId: origen.id, destinoId: actual.id });
      creadas.push(origen.id);
      await anotarTrabajador(tx, contexto, actual.id, { estado: actual.estado }, { estado: actual.estado, nota: `depende de «${origen.titulo}» (el Coordinador lo vio en el texto de la tarjeta)` });
    }
    // De quién depende ahora (con lo de antes): si alguna no está HECHO, espera.
    const flechas = dependencias.filter((flecha) => flecha.destinoId === actual.id);
    const pendientes = candidatas.filter((tarjeta) => flechas.some((flecha) => flecha.origenId === tarjeta.id) && tarjeta.estado !== "HECHO");
    const etiqueta = etiquetaEsperando(pendientes);
    let estado = actual.estado as EstadoTarjetaTablero;
    // Con candado (PLANEANDO / EN_CURSO) vuelve a la fila sin ERROR ni intento gastado: PLANEANDO -> APROBADO, EN_CURSO -> PLAN_APROBADO.
    const vuelve: EstadoTarjetaTablero | null = estado === "PLANEANDO" ? "APROBADO" : estado === "EN_CURSO" ? "PLAN_APROBADO" : null;
    let soltada = false;
    if (etiqueta && vuelve) {
      const hecho = await tx.tarjetaTablero.updateMany({
        where: { id: actual.id, estado: actual.estado, borradoEn: null },
        data: { estado: vuelve, trabajoVenceEn: null, intentos: Math.max(0, actual.intentos - 1) },
      });
      if (hecho.count !== 1) throw new ErrorDelTrabajador("La tarjeta cambió mientras tanto.", 409);
      await anotarTrabajador(tx, contexto, actual.id, { estado: actual.estado }, { estado: vuelve, nota: etiqueta });
      await anotarIntento(
        tx,
        actual.id,
        { etapa: estado === "EN_CURSO" ? "construir" : "planear", categoria: "otra", causa: causaDeEntrada(etiqueta), error: null, accion: "esperar", cuentaComoIntento: false },
        ahora,
      );
      estado = vuelve;
      soltada = true;
    }
    if (creadas.length || soltada) await tocarTableros(tx, [actual.tableroId], ahora);
    return { ok: true, estado, creadas, esperando: etiqueta, soltada, link: linkDeLaTarjeta(actual.id) };
  });
}

/**
 * POST /:id/limpieza (27-oct-2026): main ya traía errores viejos (lint, tipos, pruebas) al verificar esta tarea. No se le culpa a la
 * tarea: el Coordinador pide UNA sola tarjeta de limpieza por repo ("Limpieza: main trae errores viejos (<repo>)"), en el mismo tablero y en
 * APROBADO, que sigue el camino normal. Si ya hay una abierta (ni HECHO ni FALLIDO), no crea otra: le agrega los errores que no tenía.
 * No mueve la tarjeta que la pidió. -> { creada, agregados, tarjetaId }
 */
async function pedirLimpieza(contexto: ContextoTrabajador, actual: FilaParaTrabajar, cuerpo: Record<string, unknown>, ahora: Date) {
  const repo = typeof cuerpo.repo === "string" && cuerpo.repo.trim() ? cuerpo.repo.trim() : (actual.repo ?? "");
  if (!(REPOS_DEL_TRABAJADOR as readonly string[]).includes(repo)) throw new ErrorDelTrabajador("Falta el repo de la limpieza (gestion o aizencrm).", 400);
  const errores = [
    ...new Set(
      (Array.isArray(cuerpo.errores) ? cuerpo.errores : [])
        .filter((valor): valor is string => typeof valor === "string" && valor.trim().length > 0)
        .map((valor) => valor.trim().replace(/\s+/g, " ").slice(0, 300)),
    ),
  ].slice(0, 60);
  if (!errores.length) throw new ErrorDelTrabajador("Faltan los errores viejos de main.", 400);
  const titulo = tituloDeLimpieza(repo);

  return prisma.$transaction(async (tx) => {
    const abierta = await tx.tarjetaTablero.findFirst({
      where: { tableroId: actual.tableroId, borradoEn: null, titulo, estado: { notIn: ["HECHO", "FALLIDO"] } },
      orderBy: { creadoEn: "asc" },
      select: { id: true, detalle: true },
    });
    if (abierta) {
      const nuevos = errores.filter((error) => !abierta.detalle.includes(error));
      if (!nuevos.length) return { ok: true, creada: false, agregados: 0, tarjetaId: abierta.id, link: linkDeLaTarjeta(abierta.id) };
      const detalle = `${abierta.detalle.trimEnd()}\n${nuevos.map((error) => `- ${error}`).join("\n")}`.slice(0, 20_000);
      await tx.tarjetaTablero.update({ where: { id: abierta.id }, data: { detalle } });
      await anotarTrabajador(tx, contexto, abierta.id, {}, { nota: `se agregaron ${nuevos.length} error(es) viejo(s) de main que encontró «${actual.titulo}»` });
      await tocarTableros(tx, [actual.tableroId], ahora);
      return { ok: true, creada: false, agregados: nuevos.length, tarjetaId: abierta.id, link: linkDeLaTarjeta(abierta.id) };
    }
    const origen = await tx.tarjetaTablero.findFirst({ where: { id: actual.id }, select: { tipoId: true, area: true, creadoPor: true, orden: true } });
    if (!origen) throw new ErrorDelTrabajador("La tarjeta cambió mientras tanto.", 409);
    const detalle = [
      `main de ${repo} ya trae errores que no son de ninguna tarea nueva: el Coordinador los encontró al verificar «${actual.titulo}» y dejó pasar la tarea porque no los empeoró.`,
      "Arréglalos sin cambiar lo que hace el sistema (solo lint, tipos o pruebas):",
      ...errores.map((error) => `- ${error}`),
    ]
      .join("\n")
      .slice(0, 20_000);
    const nueva = await tx.tarjetaTablero.create({
      data: { tableroId: actual.tableroId, titulo, detalle, area: origen.area, estado: "APROBADO", orden: origen.orden + 1, tipoId: origen.tipoId, repo, creadoPor: origen.creadoPor },
      select: { id: true },
    });
    await tx.historialTarjeta.create({
      data: {
        tarjetaId: nueva.id,
        quien: quienEs(contexto),
        origen: "TRABAJADOR",
        accion: "crear",
        despues: { titulo, estado: "APROBADO", nota: `limpieza pedida al verificar «${actual.titulo}»` } as Prisma.InputJsonValue,
      },
    });
    await tx.historialTarjeta.create({
      data: {
        tarjetaId: nueva.id,
        quien: quienEs(contexto),
        origen: "TRABAJADOR",
        accion: "aprobar",
        antes: { estado: "APROBADO" } as Prisma.InputJsonValue,
        despues: { estado: "APROBADO", momento: "tarea", como: "heredada", heredadaDe: actual.id } as Prisma.InputJsonValue,
      },
    });
    await tocarTableros(tx, [actual.tableroId], ahora);
    return { ok: true, creada: true, agregados: errores.length, tarjetaId: nueva.id, link: linkDeLaTarjeta(nueva.id) };
  });
}

/**
 * POST /:id/recoger (26-oct-2026, desde ERROR): lo que el Coordinador decidió al recoger una tarjeta vieja en ERROR.
 *  - reintentar: vuelve a la fila (PLAN_APROBADO con plan, si no APROBADO). Cuenta una recogida.
 *  - partir { partes }: la parte en 2 a 4 hijas (partirTarjeta) y la madre vuelve a su etapa sin candado. Cuenta una recogida.
 *  - dueno { linea }: sigue en ERROR; deja UNA línea para el dueño en resultado.recogida.linea (no cuenta como recogida).
 * Lo que hay que recordar (veces, última vez, línea) va en `resultado.recogida`: no hay migración.
 */
async function recogerTarjeta(contexto: ContextoTrabajador, actual: FilaParaTrabajar, cuerpo: Record<string, unknown>, ahora: Date) {
  const decision = decisionDeRecogerDeEntrada(cuerpo.decision);
  if (!decision) throw new ErrorDelTrabajador("Falta la decisión: reintentar, partir o dueno.", 400);
  const previo = resultadoComoObjeto(actual.resultado);
  const antes = recogidaDelResultado(previo);
  const causa = causaDeEntrada(cuerpo.causa, "El Coordinador recogió la tarjeta que estaba en ERROR.");

  if (decision === "dueno") {
    const linea = lineaParaElDueno(cuerpo.linea);
    if (!linea) throw new ErrorDelTrabajador("Falta la línea para el dueño.", 400);
    return prisma.$transaction(async (tx) => {
      const hecho = await tx.tarjetaTablero.updateMany({
        where: { id: actual.id, estado: "ERROR", borradoEn: null },
        data: { resultado: { ...previo, recogida: { ...antes, linea, ultima: ahora.toISOString() } } as Prisma.InputJsonValue },
      });
      if (hecho.count !== 1) throw new ErrorDelTrabajador("La tarjeta cambió mientras tanto.", 409);
      await anotarTrabajador(tx, contexto, actual.id, { estado: "ERROR" }, { estado: "ERROR", nota: `necesita al dueño: ${linea}` });
      await tocarTableros(tx, [actual.tableroId], ahora);
      return { ok: true, estado: "ERROR", linea, link: linkDeLaTarjeta(actual.id) };
    });
  }

  const tope = puedeRecoger(previo);
  if (tope) throw new ErrorDelTrabajador(tope, 409);
  const recogida = { veces: antes.veces + 1, ultima: ahora.toISOString(), linea: null };

  if (decision === "partir") {
    // Se marca la recogida antes de partir (si partir falla, la tarjeta sigue en ERROR pero ya gastó esta recogida).
    const hecho = await prisma.tarjetaTablero.updateMany({
      where: { id: actual.id, estado: "ERROR", borradoEn: null },
      data: { resultado: { ...previo, recogida } as Prisma.InputJsonValue },
    });
    if (hecho.count !== 1) throw new ErrorDelTrabajador("La tarjeta cambió mientras tanto.", 409);
    return partirTarjeta(contexto, { ...actual, resultado: { ...previo, recogida } as Prisma.JsonValue }, { ...cuerpo, categoria: cuerpo.categoria ?? "tarea_muy_grande" }, ahora, true);
  }

  const vuelve = estadoTrasRecoger(actual.plan);
  return prisma.$transaction(async (tx) => {
    const hecho = await tx.tarjetaTablero.updateMany({
      where: { id: actual.id, estado: "ERROR", borradoEn: null },
      data: { estado: vuelve, trabajoVenceEn: null, resultado: { ...previo, recogida } as Prisma.InputJsonValue },
    });
    if (hecho.count !== 1) throw new ErrorDelTrabajador("La tarjeta cambió mientras tanto.", 409);
    await anotarTrabajador(tx, contexto, actual.id, { estado: "ERROR" }, { estado: vuelve, nota: `recogida ${recogida.veces} de 2: se reintenta (${causa})` });
    await anotarIntento(
      tx,
      actual.id,
      {
        etapa: vuelve === "PLAN_APROBADO" ? "construir" : "planear",
        categoria: categoriaDeEntrada(cuerpo.categoria) ?? "otra",
        causa,
        error: errorDeIntentoDeEntrada(cuerpo.error),
        accion: "reparar",
        cuentaComoIntento: false,
      },
      ahora,
    );
    await tocarTableros(tx, [actual.tableroId], ahora);
    return { ok: true, estado: vuelve, recogidas: recogida.veces, link: linkDeLaTarjeta(actual.id) };
  });
}
