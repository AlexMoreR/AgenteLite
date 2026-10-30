import { leerConfigDeAvisos, numeroDeAvisosDe } from "@/features/agente-v3/servicios/avisos";
import { linkDeLaAlerta, type Prioridad } from "@/features/alertas/dominio/reglas";
import { registrarAlerta } from "@/features/alertas/servicios/alertas";
import { sendEvolutionTextMessageWithReconnect } from "@/lib/evolution";
import { prisma } from "@/lib/prisma";

import {
  enSilencioDeAvisos,
  leerEstadoDeAvisos,
  lineaAdmin,
  normalizarTelefono,
  porQueNecesitaAlDueno,
  telefonoGuardado,
  textoDeEsperaPor,
  textoDelError,
  validarTelefonoDelDueno,
} from "./avisos-al-dueno";
import { linkDeLaTarjeta } from "./tableros";

/*
  AVISOS AL EQUIPO por WhatsApp (27-oct-2026). Decisión del dueño: que la gente se entere sin abrir el tablero.
  Un revisor que corre cada minuto con el reloj del servidor (api/cron/follows) mira las tarjetas del Tablero IA y
  manda un WhatsApp corto desde la línea Admin en 4 casos:
    1. asignada      alguien quedó como responsable de la tarjeta (al crearla o al cambiarla).
    2. urgente       la tarjeta asignada quedó marcada urgente (botón, MCP o título que empieza por URGENTE).
    3. necesita      la tarjeta cayó en ERROR o espera algo de una persona (permiso, clave, VPS, el sí del dueño):
                     le llega al responsable y, si no tiene, al dueño.
    4. recordatorio  una tarjeta asignada lleva 24 horas sin ningún movimiento en su historial: uno solo.

  Reglas:
  - SOLO a personas ACTIVAS del negocio con número en Mi empresa → Equipo (la lista de avisos de siempre). Un número
    que no esté ahí no recibe nada, así que nunca le llega a un cliente. El dueño, sin responsable, usa su número de
    Mi empresa → Claude (validado como en los avisos al dueño; no se escribe a mano acá).
  - Siempre por la línea Admin; si no está, no sale (jamás se cambia a una línea de ventas).
  - Un aviso por tarjeta y por motivo: la fila de AvisoTarjetaEquipo con índice único (tarjetaId, motivo) lo garantiza
    aunque el reloj corra dos veces a la vez. Si cambia el responsable, la persona nueva sí recibe el suyo.
  - Silencio de 9 p. m. a 7 a. m. (Bogotá), salvo lo URGENTE; lo que cae de noche sale a las 7 a. m. si todavía aplica.
  - Cada persona lo apaga en su perfil (`tablero:avisos-equipo:persona:<userId>` = "false"; prendido por defecto).
  - Interruptor general `tablero:avisos-equipo:<ws>` = {"activo": true}; EMPIEZA APAGADO. Al prenderlo, lo que ya
    estaba asignado se anota YA_VISTO y no se avisa (no sale una ola de mensajes).
  - Si la línea falla, se reintenta hasta 3 veces en los minutos siguientes y queda FALLIDO.
  - Sin responsable, si el aviso de siempre al dueño ya le mandó esa misma tarjeta, este no sale (no duplicar).
  - La tabla AvisoTarjetaEquipo la comparte el aviso "terminada" al dueño (avisos-de-terminadas.ts, motivo "terminada"). Esas
    filas NO son de este revisor: su resumen, su "último aviso", su reinicio al prender el interruptor y cualquier consulta
    de esta tabla las ignoran (motivo: { not: "terminada" }).
*/

/** El motivo de las filas del aviso "terminada" al dueño (avisos-de-terminadas.ts): no son de este revisor. */
const MOTIVO_AJENO = "terminada";

export const claveInterruptorDelEquipo = (workspaceId: string) => `tablero:avisos-equipo:${workspaceId}`;
export const clavePersonaDelEquipo = (userId: string) => `tablero:avisos-equipo:persona:${userId}`;
/** Existe mientras el interruptor general está prendido y ya se anotó lo que había antes de prenderlo. */
const claveBase = (workspaceId: string) => `tablero:avisos-equipo:base:${workspaceId}`;

export const TIPOS_DE_AVISO_AL_EQUIPO = ["asignada", "urgente", "necesita", "recordatorio"] as const;
export type TipoDeAvisoAlEquipo = (typeof TIPOS_DE_AVISO_AL_EQUIPO)[number];

const MS_HORA = 3_600_000;
const HORAS_SIN_MOVERSE = 24;
const MAXIMO_INTENTOS = 3;
/** Tope de mensajes por vuelta y negocio: si algo sale mal, no es una ola; el resto sale en el minuto siguiente. */
const MAXIMO_POR_VUELTA = 10;

const ESTADOS_QUE_ESPERAN = ["ERROR", "POR_APROBAR", "PLAN_LISTO", "POR_REVISAR"] as const;
const ESTADOS_TERMINADOS = ["HECHO", "FALLIDO"] as const;
/** En manos del Coordinador: nadie le debe nada a una persona, así que no hay recordatorio. */
const ESTADOS_DEL_COORDINADOR = ["PLANEANDO", "EN_CURSO", "SUBIENDO", "APROBADO", "PLAN_APROBADO"];

const PIDE_INFRAESTRUCTURA = /\b(vps|portainer|docker|servidor|dns|dominio)\b/i;
const EMPIEZA_URGENTE = /^\s*urgente\b/i;

/* ───────────────────────────────────────────────────────────────────── las reglas (puras) ── */

export type TarjetaParaAvisar = {
  id: string;
  titulo: string;
  detalle: string;
  estado: string;
  urgente: boolean;
  responsableId: string | null;
  repo: string | null;
  plan: string | null;
  zonaProtegida: string[];
  error: string | null;
  esperaPor: string | null;
  /** El último cambio de su historial (o cuándo se creó, si no tiene). */
  ultimoMovimiento: Date;
};

export type AvisoAlEquipo = {
  tarjeta: TarjetaParaAvisar;
  tipo: TipoDeAvisoAlEquipo;
  /** La clave del aviso por tarjeta: `asignada:<userId>`, `urgente:<userId>`, `necesita:<estado>`, `recordatorio:<userId>`. */
  motivo: string;
  /** A quién le toca (null = al dueño, porque la tarjeta no tiene responsable). */
  userId: string | null;
  /** Solo en "necesita": lo que hace falta, en una frase. */
  razon?: string;
  /** "asignada" que ya la dice el aviso urgente: se anota YA_VISTO y no se manda dos veces lo mismo. */
  cubierta?: boolean;
};

export const esUrgente = (tarjeta: Pick<TarjetaParaAvisar, "urgente" | "titulo">) => tarjeta.urgente || EMPIEZA_URGENTE.test(tarjeta.titulo);

const unaLinea = (valor: string, maximo: number) => {
  const limpio = valor.replace(/\s+/g, " ").trim();
  return limpio.length > maximo ? `${limpio.slice(0, maximo - 1).trimEnd()}…` : limpio;
};

/** Qué le hace falta a la persona para que la tarjeta siga, en una frase. Null = la tarjeta no espera nada de nadie. */
export function queNecesitaLaTarjeta(tarjeta: TarjetaParaAvisar): string | null {
  const esperando = {
    id: tarjeta.id,
    titulo: tarjeta.titulo,
    detalle: tarjeta.detalle,
    estado: tarjeta.estado,
    plan: tarjeta.plan,
    zonaProtegida: tarjeta.zonaProtegida,
    error: tarjeta.error,
    esperaPor: tarjeta.esperaPor,
  };
  const regla = porQueNecesitaAlDueno(esperando);
  if (tarjeta.estado === "ERROR") {
    if (regla) return regla;
    if (tarjeta.error && PIDE_INFRAESTRUCTURA.test(tarjeta.error)) return "hay que configurar algo en el VPS o en Portainer";
    return tarjeta.error ? `quedó en error (${unaLinea(tarjeta.error, 100)})` : "quedó en error y el Coordinador no pudo repararlo";
  }
  if (regla) return unaLinea(regla, 120);
  if (tarjeta.estado === "POR_REVISAR" && tarjeta.esperaPor && PIDE_INFRAESTRUCTURA.test(tarjeta.esperaPor)) return unaLinea(tarjeta.esperaPor, 120);
  return null;
}

/** Los avisos que hoy corresponden (sin mirar lo ya avisado, el silencio, los números ni el interruptor). */
export function calcularAvisosAlEquipo(tarjetas: readonly TarjetaParaAvisar[], ahora: Date): AvisoAlEquipo[] {
  const avisos: AvisoAlEquipo[] = [];
  for (const tarjeta of tarjetas) {
    const terminada = (ESTADOS_TERMINADOS as readonly string[]).includes(tarjeta.estado);
    const responsable = tarjeta.responsableId;
    if (responsable && !terminada) {
      const urgente = esUrgente(tarjeta);
      avisos.push({ tarjeta, tipo: "asignada", motivo: `asignada:${responsable}`, userId: responsable, ...(urgente ? { cubierta: true } : {}) });
      if (urgente) avisos.push({ tarjeta, tipo: "urgente", motivo: `urgente:${responsable}`, userId: responsable });
      const enManosDelCoordinador = Boolean(tarjeta.repo) && ESTADOS_DEL_COORDINADOR.includes(tarjeta.estado);
      if (!enManosDelCoordinador && ahora.getTime() - tarjeta.ultimoMovimiento.getTime() >= HORAS_SIN_MOVERSE * MS_HORA) {
        avisos.push({ tarjeta, tipo: "recordatorio", motivo: `recordatorio:${responsable}`, userId: responsable });
      }
    }
    if ((ESTADOS_QUE_ESPERAN as readonly string[]).includes(tarjeta.estado)) {
      const razon = queNecesitaLaTarjeta(tarjeta);
      if (razon) avisos.push({ tarjeta, tipo: "necesita", motivo: `necesita:${tarjeta.estado}`, userId: responsable, razon });
    }
  }
  return avisos;
}

/** El título sin el "URGENTE" del principio (el aviso ya lo dice). */
const tituloSinUrgente = (titulo: string) => titulo.replace(/^\s*urgente\b[\s:.\-–—]*/i, "").trim() || titulo;

/** El mensaje corto de cada caso, con el link a la tarjeta. `nombre` es el primer nombre de quien lo recibe. */
export function textoDelAviso(aviso: AvisoAlEquipo, nombre: string | null, linkDeLaAlertaDelAviso?: string | null): string {
  const titulo = unaLinea(aviso.tarjeta.titulo, 120);
  // El link va a la alerta de la persona (ahí está el de la tarjeta); si la alerta no se pudo guardar, a la tarjeta.
  const link = linkDeLaAlertaDelAviso || linkDeLaTarjeta(aviso.tarjeta.id);
  const saludo = nombre ? `${nombre}, ` : "";
  switch (aviso.tipo) {
    case "asignada":
      return `${saludo}${nombre ? "tienes" : "Tienes"} una tarea nueva: ${titulo}. ${link}`;
    case "urgente":
      return `URGENTE: ${saludo}${nombre ? "esta" : "Esta"} tarea es urgente: ${unaLinea(tituloSinUrgente(aviso.tarjeta.titulo), 120)}. ${link}`;
    case "necesita":
      return `${saludo}${nombre ? "el" : "El"} Coordinador necesita algo para seguir con "${titulo}": ${aviso.razon ?? "revisar la tarjeta"}. ${link}`;
    case "recordatorio":
      return `${saludo}${nombre ? "recordatorio" : "Recordatorio"}: "${titulo}" lleva más de ${HORAS_SIN_MOVERSE} horas sin moverse. ${link}`;
  }
}

/* ───────────────────────────────────────────────────────────────────── los ajustes ── */

async function leerAjuste(key: string): Promise<string | null> {
  const fila = await prisma.appSetting.findUnique({ where: { key }, select: { value: true } });
  return fila?.value ?? null;
}

async function guardarAjuste(key: string, value: string) {
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/** El interruptor general. Empieza APAGADO: solo es verdad con {"activo": true}. */
export async function avisosAlEquipoPrendidos(workspaceId: string): Promise<boolean> {
  try {
    return (JSON.parse((await leerAjuste(claveInterruptorDelEquipo(workspaceId))) ?? "{}") as { activo?: unknown }).activo === true;
  } catch {
    return false;
  }
}

/**
 * El interruptor general desde la pantalla (solo el dueño; el permiso lo mira la acción). Al PRENDERLO se borra la base
 * para que la vuelta siguiente del reloj anote todo lo ya asignado como YA_VISTO (sin ola de mensajes), y lo que quedó
 * PENDIENTE de antes de apagarlo tampoco sale. Al APAGARLO no sale nada más (el revisor corta al empezar la vuelta).
 */
export async function ponerAvisosAlEquipo(workspaceId: string, activo: boolean) {
  if (activo) {
    await prisma.appSetting.deleteMany({ where: { key: claveBase(workspaceId) } });
    await prisma.avisoTarjetaEquipo.updateMany({
      where: { workspaceId, estado: "PENDIENTE", motivo: { not: MOTIVO_AJENO } },
      data: { estado: "YA_VISTO", detalle: "quedó pendiente con los avisos apagados" },
    });
  }
  await guardarAjuste(claveInterruptorDelEquipo(workspaceId), JSON.stringify({ activo }));
  if (!activo) await prisma.appSetting.deleteMany({ where: { key: claveBase(workspaceId) } });
}

/**
 * Los nombres de las personas activas del negocio sin número de avisos en Mi empresa → Equipo (a ellas no les llega
 * nada). El dueño no sale si tiene su número en Mi empresa → Claude, que es el que se usa para él.
 */
export async function equipoSinNumeroDeAvisos(workspaceId: string): Promise<string[]> {
  const [miembros, config, negocio, telefonoDelDueno] = await Promise.all([
    prisma.workspaceMember.findMany({ where: { workspaceId, isActive: true }, select: { userId: true, user: { select: { name: true } } } }),
    leerConfigDeAvisos(workspaceId).catch(() => null),
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { ownerId: true } }),
    telefonoGuardado(workspaceId).catch(() => null),
  ]);
  const ownerId = negocio?.ownerId ?? null;
  return miembros
    .filter((miembro) => !normalizarTelefono(numeroDeAvisosDe(config, miembro.userId)))
    .filter((miembro) => !(miembro.userId === ownerId && telefonoDelDueno))
    .map((miembro) => miembro.user?.name?.trim() || "Sin nombre")
    .sort((a, b) => a.localeCompare(b, "es"));
}

/** La casilla del perfil: prendida salvo que la persona la haya apagado. */
export async function personaRecibeAvisos(userId: string): Promise<boolean> {
  return (await leerAjuste(clavePersonaDelEquipo(userId))) !== "false";
}

export async function guardarAvisosDeLaPersona(userId: string, activo: boolean) {
  await guardarAjuste(clavePersonaDelEquipo(userId), activo ? "true" : "false");
}

/* ───────────────────────────────────────────────────────────────────── a quién y cómo ── */

type Destino = { ok: true; numero: string; nombre: string | null; userId: string } | { ok: false; motivo: string };

const primerNombre = (nombre: string | null | undefined) => nombre?.trim().split(/\s+/)[0] || null;

/** Lo que hace falta para decidir a quién se le manda, leído una vez por vuelta. */
async function conocerAlNegocio(workspaceId: string) {
  const [miembros, config, negocio] = await Promise.all([
    prisma.workspaceMember.findMany({ where: { workspaceId, isActive: true }, select: { userId: true, user: { select: { name: true } } } }),
    leerConfigDeAvisos(workspaceId).catch(() => null),
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { ownerId: true } }),
  ]);
  const nombres = new Map(miembros.map((miembro) => [miembro.userId, miembro.user?.name ?? null]));
  const ownerId = negocio?.ownerId ?? null;
  const personas = new Map<string, boolean>();
  let numeroDelDueno: Awaited<ReturnType<typeof validarTelefonoDelDueno>> | null = null;

  const quiereAvisos = async (userId: string) => {
    if (!personas.has(userId)) personas.set(userId, await personaRecibeAvisos(userId));
    return personas.get(userId) as boolean;
  };
  const duenoValidado = async () => {
    if (!numeroDelDueno) {
      const guardado = await telefonoGuardado(workspaceId);
      numeroDelDueno = guardado ? await validarTelefonoDelDueno(workspaceId, guardado) : { ok: false, error: "falta su número en Mi empresa → Claude" };
    }
    return numeroDelDueno;
  };

  /** A quién se le manda (`userId` null = el dueño) y por qué no, si no se puede. */
  async function destinoDe(userId: string | null): Promise<Destino> {
    const id = userId ?? ownerId;
    if (!id) return { ok: false, motivo: "la tarjeta no tiene responsable y el negocio no tiene dueño" };
    const esElDueno = id === ownerId;
    // El dueño es persona activa del negocio aunque no figure como miembro.
    if (!nombres.has(id) && !esElDueno) return { ok: false, motivo: "la persona ya no está activa en el negocio" };
    if (!(await quiereAvisos(id))) return { ok: false, motivo: "apagó los avisos del Tablero IA en su perfil" };
    const nombre = primerNombre(nombres.get(id) ?? (esElDueno ? await nombreDeUsuario(id) : null));
    const delEquipo = normalizarTelefono(numeroDeAvisosDe(config, id));
    if (delEquipo) return { ok: true, numero: delEquipo, nombre, userId: id };
    if (esElDueno) {
      const dueno = await duenoValidado();
      return dueno.ok ? { ok: true, numero: dueno.numero, nombre, userId: id } : { ok: false, motivo: dueno.error };
    }
    return { ok: false, motivo: "no tiene número de avisos en Mi empresa → Equipo" };
  }

  return { destinoDe, ownerId };
}

async function nombreDeUsuario(userId: string): Promise<string | null> {
  const usuario = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  return usuario?.name ?? null;
}

const PRIORIDAD_DEL_AVISO: Record<TipoDeAvisoAlEquipo, Prioridad> = { urgente: "URGENTE", necesita: "ALTA", asignada: "MEDIA", recordatorio: "BAJA" };

/**
 * Deja el aviso también como alerta PERSONAL de quien lo recibe (la ve en /cliente/alertas) y devuelve el link directo
 * a esa alerta. No manda WhatsApp (eso lo hace este revisor) y no lanza: sin alerta guardada devuelve null.
 */
async function guardarAlertaDelAviso(workspaceId: string, aviso: AvisoAlEquipo, destinatarioId: string, textoSinLink: string): Promise<string | null> {
  const resultado = await registrarAlerta({
    workspaceId,
    clave: `auto:equipo:${aviso.tarjeta.id}:${aviso.motivo}`,
    prioridad: PRIORIDAD_DEL_AVISO[aviso.tipo],
    titulo: textoSinLink,
    detalle: `Tarjeta: ${linkDeLaTarjeta(aviso.tarjeta.id)}`,
    origen: "Tablero IA",
    destinatarioId,
    refrescar: false,
  });
  return resultado.id ? linkDeLaAlerta(resultado.id) : null;
}

/** Manda por la línea Admin. Nunca lanza y nunca usa otra línea. */
async function enviarPorLaLineaAdmin(workspaceId: string, numero: string, texto: string): Promise<{ salio: boolean; motivo: string | null }> {
  const linea = await lineaAdmin(workspaceId);
  if (!linea) return { salio: false, motivo: "no hay línea Admin conectada" };
  try {
    await sendEvolutionTextMessageWithReconnect({ instanceName: linea.instancia, phoneNumber: numero, text: texto });
    return { salio: true, motivo: null };
  } catch (error) {
    console.warn("[avisos-al-equipo] no salió el WhatsApp", { numero: `…${numero.slice(-4)}`, error: error instanceof Error ? error.message : String(error) });
    return { salio: false, motivo: "la línea Admin no pudo enviar el mensaje" };
  }
}

/* ───────────────────────────────────────────────────────────────────── la base ── */

async function leerTarjetas(workspaceId: string): Promise<TarjetaParaAvisar[]> {
  const filas = await prisma.tarjetaTablero.findMany({
    where: {
      borradoEn: null,
      tablero: { workspaceId },
      OR: [{ responsableId: { not: null }, estado: { notIn: [...ESTADOS_TERMINADOS] } }, { estado: { in: [...ESTADOS_QUE_ESPERAN] } }],
    },
    select: {
      id: true,
      titulo: true,
      detalle: true,
      estado: true,
      urgente: true,
      responsableId: true,
      repo: true,
      plan: true,
      zonaProtegida: true,
      resultado: true,
      creadoEn: true,
    },
  });
  if (!filas.length) return [];
  const ultimos = await prisma.historialTarjeta.groupBy({ by: ["tarjetaId"], where: { tarjetaId: { in: filas.map((fila) => fila.id) } }, _max: { creadoEn: true } });
  const movimiento = new Map(ultimos.map((fila) => [fila.tarjetaId, fila._max.creadoEn]));
  return filas.map((fila) => ({
    id: fila.id,
    titulo: fila.titulo,
    detalle: fila.detalle,
    estado: fila.estado,
    urgente: fila.urgente,
    responsableId: fila.responsableId,
    repo: fila.repo,
    plan: fila.plan,
    zonaProtegida: fila.zonaProtegida,
    error: textoDelError(fila.resultado),
    esperaPor: textoDeEsperaPor(fila.resultado),
    ultimoMovimiento: movimiento.get(fila.id) ?? fila.creadoEn,
  }));
}

const clavePar = (tarjetaId: string, motivo: string) => `${tarjetaId}|${motivo}`;
const esChoqueDeUnico = (error: unknown) => (error as { code?: string } | null)?.code === "P2002";

/** ¿El aviso de siempre al dueño ya le mandó por WhatsApp esta misma tarjeta? (sus claves llevan el id de la tarjeta) */
async function yaSeLoAvisoElDueno(workspaceId: string, tarjetaId: string): Promise<boolean> {
  const estado = await leerEstadoDeAvisos(workspaceId);
  return Object.keys(estado.avisados).some((clave) => clave.startsWith("auto:") && clave.includes(`:${tarjetaId}:`));
}

/** La revisión de un negocio. Devuelve lo que mandó. */
export async function revisarAvisosDelEquipoDelNegocio(workspaceId: string, ahora: Date): Promise<{ enviados: number }> {
  if (!(await avisosAlEquipoPrendidos(workspaceId))) {
    // Apagado: al volver a prenderlo se anota de nuevo lo que haya, sin avisar.
    await prisma.appSetting.deleteMany({ where: { key: claveBase(workspaceId) } });
    return { enviados: 0 };
  }
  const primeraVuelta = (await leerAjuste(claveBase(workspaceId))) === null;
  const tarjetas = await leerTarjetas(workspaceId);
  const calculados = calcularAvisosAlEquipo(tarjetas, ahora);

  const existentes = calculados.length
    ? await prisma.avisoTarjetaEquipo.findMany({
        where: { workspaceId, motivo: { not: MOTIVO_AJENO }, tarjetaId: { in: [...new Set(calculados.map((aviso) => aviso.tarjeta.id))] } },
        select: { id: true, tarjetaId: true, motivo: true, estado: true, intentos: true },
      })
    : [];
  const filas = new Map(existentes.map((fila) => [clavePar(fila.tarjetaId, fila.motivo), fila]));

  // Una tarjeta con el título que empieza por URGENTE queda marcada (la marca es la que se ve y se pone a mano).
  for (const tarjeta of tarjetas) {
    if (!tarjeta.urgente && EMPIEZA_URGENTE.test(tarjeta.titulo)) {
      await prisma.tarjetaTablero.updateMany({ where: { id: tarjeta.id, urgente: false }, data: { urgente: true } });
    }
  }

  if (!calculados.length) {
    if (primeraVuelta) await guardarAjuste(claveBase(workspaceId), ahora.toISOString());
    return { enviados: 0 };
  }
  const negocio = await conocerAlNegocio(workspaceId);
  const noche = enSilencioDeAvisos(ahora);
  let enviados = 0;

  const anotar = async (aviso: AvisoAlEquipo, estado: string, detalle: string | null, extra: { numero?: string | null; userId?: string | null } = {}) => {
    try {
      await prisma.avisoTarjetaEquipo.create({
        data: { workspaceId, tarjetaId: aviso.tarjeta.id, motivo: aviso.motivo, userId: extra.userId ?? aviso.userId, numero: extra.numero ?? null, estado, detalle },
      });
    } catch (error) {
      if (!esChoqueDeUnico(error)) throw error;
    }
  };

  for (const aviso of calculados) {
    const existente = filas.get(clavePar(aviso.tarjeta.id, aviso.motivo));
    if (existente && existente.estado !== "PENDIENTE") continue;
    if (!existente && primeraVuelta) {
      await anotar(aviso, "YA_VISTO", "ya estaba así antes de prender los avisos");
      continue;
    }
    if (!existente && aviso.cubierta) {
      await anotar(aviso, "YA_VISTO", "la dice el aviso urgente");
      continue;
    }
    // De noche solo sale lo urgente; lo demás espera (sin anotar) y sale a las 7 a. m. si todavía aplica.
    if (noche && aviso.tipo !== "urgente") continue;
    if (enviados >= MAXIMO_POR_VUELTA) break;

    const destino = await negocio.destinoDe(aviso.userId);
    if (!destino.ok) {
      if (existente) {
        await prisma.avisoTarjetaEquipo.updateMany({ where: { id: existente.id, estado: "PENDIENTE" }, data: { estado: "FALLIDO", detalle: `no salió: ${destino.motivo}` } });
      } else {
        await anotar(aviso, "FALLIDO", `no salió: ${destino.motivo}`);
      }
      continue;
    }
    if (aviso.tipo === "necesita" && !aviso.userId && (await yaSeLoAvisoElDueno(workspaceId, aviso.tarjeta.id))) {
      if (existente) await prisma.avisoTarjetaEquipo.updateMany({ where: { id: existente.id, estado: "PENDIENTE" }, data: { estado: "YA_VISTO", detalle: "el aviso de siempre al dueño ya la mandó" } });
      else await anotar(aviso, "YA_VISTO", "el aviso de siempre al dueño ya la mandó");
      continue;
    }

    // Se reserva el aviso ANTES de mandarlo: crear la fila (o subir sus intentos) solo le sale bien a una vuelta.
    let id: string;
    let intentos: number;
    if (existente) {
      if (existente.intentos >= MAXIMO_INTENTOS) {
        await prisma.avisoTarjetaEquipo.updateMany({ where: { id: existente.id, estado: "PENDIENTE" }, data: { estado: "FALLIDO" } });
        continue;
      }
      const tomado = await prisma.avisoTarjetaEquipo.updateMany({
        where: { id: existente.id, estado: "PENDIENTE", intentos: existente.intentos },
        data: { intentos: existente.intentos + 1 },
      });
      if (!tomado.count) continue;
      id = existente.id;
      intentos = existente.intentos + 1;
    } else {
      try {
        const creada = await prisma.avisoTarjetaEquipo.create({
          data: { workspaceId, tarjetaId: aviso.tarjeta.id, motivo: aviso.motivo, userId: aviso.userId, numero: `…${destino.numero.slice(-4)}`, estado: "PENDIENTE", intentos: 1 },
          select: { id: true },
        });
        id = creada.id;
        intentos = 1;
      } catch (error) {
        if (esChoqueDeUnico(error)) continue;
        throw error;
      }
    }

    const sinLink = textoDelAviso(aviso, destino.nombre, "").replace(/\s*https?:\/\/\S+$/, "");
    const linkDeLaAlertaDelAviso = await guardarAlertaDelAviso(workspaceId, aviso, destino.userId, sinLink);
    const envio = await enviarPorLaLineaAdmin(workspaceId, destino.numero, textoDelAviso(aviso, destino.nombre, linkDeLaAlertaDelAviso));
    if (envio.salio) {
      enviados += 1;
      await prisma.avisoTarjetaEquipo.updateMany({ where: { id }, data: { estado: "ENVIADO", enviadoEn: new Date(), detalle: null } });
    } else {
      await prisma.avisoTarjetaEquipo.updateMany({
        where: { id },
        data: { estado: intentos >= MAXIMO_INTENTOS ? "FALLIDO" : "PENDIENTE", detalle: `no salió (intento ${intentos}): ${envio.motivo}` },
      });
    }
  }

  if (primeraVuelta) await guardarAjuste(claveBase(workspaceId), ahora.toISOString());
  return { enviados };
}

/** La vuelta del reloj (cada minuto): revisa cada negocio con tableros. Nunca lanza por un negocio. */
export async function revisarAvisosAlEquipo(ahora = new Date()): Promise<{ enviados: number }> {
  const negocios = await prisma.tableroInteligente.findMany({ distinct: ["workspaceId"], select: { workspaceId: true } });
  let enviados = 0;
  for (const { workspaceId } of negocios) {
    try {
      enviados += (await revisarAvisosDelEquipoDelNegocio(workspaceId, ahora)).enviados;
    } catch (error) {
      console.error("[avisos-al-equipo] no se pudo revisar el negocio", { workspaceId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { enviados };
}

/* ───────────────────────────────────────────────────────────────────── la marca urgente ── */

type ContextoUrgente = { workspaceId: string; userId: string; origen: "MCP" | "PANTALLA" | "TRABAJADOR"; soloDe?: string | null };

/**
 * Marca la tarjeta como urgente (si no lo estaba) y lo deja en su historial. Quien solo ve sus tableros
 * (`soloDe`) la marca únicamente en un tablero suyo. No cambia el estado ni la aprobación. El aviso lo manda el
 * revisor del minuto siguiente.
 */
export async function marcarUrgente(contexto: ContextoUrgente, tarjetaId: unknown): Promise<{ yaEstaba: boolean }> {
  const id = typeof tarjetaId === "string" ? tarjetaId.trim() : "";
  const tarjeta = id
    ? await prisma.tarjetaTablero.findFirst({
        where: { id, borradoEn: null, tablero: contexto.soloDe ? { workspaceId: contexto.workspaceId, duenoUserId: contexto.soloDe } : { workspaceId: contexto.workspaceId } },
        select: { id: true, urgente: true },
      })
    : null;
  if (!tarjeta) throw new Error("Esa tarjeta no existe en el tablero.");
  if (tarjeta.urgente) return { yaEstaba: true };
  await prisma.$transaction([
    prisma.tarjetaTablero.update({ where: { id: tarjeta.id }, data: { urgente: true } }),
    prisma.historialTarjeta.create({
      data: { tarjetaId: tarjeta.id, quien: contexto.userId, origen: contexto.origen, accion: "editar", antes: { urgente: false }, despues: { urgente: true } },
    }),
  ]);
  return { yaEstaba: false };
}

/* ───────────────────────────────────────────────────────────────────── para la herramienta del MCP ── */

/** El estado de la automatización: prendida o apagada y el último aviso enviado (lo muestra que_es_esta_aplicacion). */
export async function resumenDeAvisosAlEquipo(workspaceId: string) {
  const [activo, ultimo, fallidos] = await Promise.all([
    avisosAlEquipoPrendidos(workspaceId),
    prisma.avisoTarjetaEquipo.findFirst({ where: { workspaceId, estado: "ENVIADO", motivo: { not: MOTIVO_AJENO } }, orderBy: { enviadoEn: "desc" }, select: { motivo: true, enviadoEn: true } }),
    prisma.avisoTarjetaEquipo.findFirst({ where: { workspaceId, estado: "FALLIDO", motivo: { not: MOTIVO_AJENO } }, orderBy: { creadoEn: "desc" }, select: { motivo: true, detalle: true } }),
  ]);
  return { activo, ultimo, ultimoFallido: fallidos };
}
