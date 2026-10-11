import { sendEvolutionTextMessageWithReconnect } from "@/lib/evolution";
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/web-push";

import { CONFIG_GRAVEDAD_POR_DEFECTO } from "@/features/avisos-gravedad/dominio/reglas";
import {
  leerConfigGravedad,
  lineaInterna,
  numeroDeAvisosDeLaPersona,
  pushAAlexander,
  whatsAppAAlexander,
} from "@/features/avisos-gravedad/servicios/enrutador";
import type { Incidente } from "@/features/supervisor/dominio/alertas";
import type { ChatAbierto } from "@/features/supervisor/dominio/detectores-atencion";
import type { Hallazgo } from "@/features/supervisor/dominio/tipos";

import {
  ESTADOS_ACTIVOS,
  DOMINIO,
  avanzar,
  candidatasDeLaVuelta,
  estadoVacio,
  esperandoFueraDeHorario,
  idDeIncidente,
  leerConfigAccionableDeTexto,
  metricasDelDia,
  prioridadesDeAlexander,
  pushDeVariasTarjetas,
  pushParaLaAsesora,
  pushParaLaSupervisora,
  tarjetaDeAccion,
  tarjetaDeIncidente,
  textoParaLaAsesora,
  textoWhatsAppDeLaTarjeta,
  type Accion,
  type Atendidas,
  type ConfigAccionable,
  type EsperandoFueraDeHorario,
  type EstadoAccionable,
  type Evento,
  type ExtrasDelChat,
  type Persona,
  type Tarjeta,
} from "../dominio/reglas";

/**
 * EL SUPERVISOR ACCIONABLE (servicio). Las reglas están en ../dominio/reglas.ts.
 *
 * Interruptor: AppSetting `supervisor:accionable:<workspaceId>` = {"activo": true, ...}. Sin fila o
 * con "activo" en false, NADA cambia (ni se lee el estado ni se manda nada).
 *
 * Sin migraciones: el estado de las acciones vive en AppSetting
 *  - `supervisor:accionable:estado:<ws>`    acciones abiertas + cerradas de 24 h + historial de 8 días
 *  - `supervisor:accionable:atendidas:<ws>` lo que Alexander marcó "atendido" en la pantalla (solo
 *                                            lo escribe la pantalla; así no se pisa con el reloj)
 *
 * Nunca lanza hacia el chequeo: un aviso que falla no tumba la vuelta del Supervisor.
 */

export const claveConfigAccionable = (workspaceId: string) => `supervisor:accionable:${workspaceId}`;
export const claveEstadoAccionable = (workspaceId: string) => `supervisor:accionable:estado:${workspaceId}`;
export const claveAtendidas = (workspaceId: string) => `supervisor:accionable:atendidas:${workspaceId}`;

const cacheConfig = new Map<string, { config: ConfigAccionable; vence: number }>();

export async function leerConfigAccionable(workspaceId: string): Promise<ConfigAccionable> {
  const guardado = cacheConfig.get(workspaceId);
  if (guardado && guardado.vence > Date.now()) return guardado.config;
  const fila = await prisma.appSetting.findUnique({ where: { key: claveConfigAccionable(workspaceId) } }).catch(() => null);
  const config = leerConfigAccionableDeTexto(fila?.value);
  cacheConfig.set(workspaceId, { config, vence: Date.now() + 60_000 });
  return config;
}

export function olvidarConfigAccionable(workspaceId?: string) {
  if (workspaceId) cacheConfig.delete(workspaceId);
  else cacheConfig.clear();
}

async function leerJson<T>(key: string, vacio: () => T): Promise<T> {
  const fila = await prisma.appSetting.findUnique({ where: { key } }).catch(() => null);
  try {
    const leido = fila?.value ? (JSON.parse(fila.value) as T) : null;
    return leido && typeof leido === "object" ? leido : vacio();
  } catch {
    return vacio();
  }
}

async function guardarJson(key: string, valor: unknown) {
  const value = JSON.stringify(valor);
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export async function leerEstadoAccionable(workspaceId: string): Promise<EstadoAccionable> {
  const estado = await leerJson<EstadoAccionable>(claveEstadoAccionable(workspaceId), estadoVacio);
  return { acciones: estado.acciones && typeof estado.acciones === "object" ? estado.acciones : {}, historial: Array.isArray(estado.historial) ? estado.historial : [] };
}

export async function leerAtendidas(workspaceId: string): Promise<Atendidas> {
  return leerJson<Atendidas>(claveAtendidas(workspaceId), () => ({}));
}

/** "Marcar resuelto/atendido" desde la pantalla. La próxima vuelta la pasa a ATENDIDA_POR_ALEXANDER. */
export async function marcarAtendida(workspaceId: string, id: string, userId: string, ahora = new Date()): Promise<void> {
  const atendidas = await leerAtendidas(workspaceId);
  atendidas[id] = { en: ahora.toISOString(), por: userId };
  const limpias = Object.fromEntries(Object.entries(atendidas).filter(([, v]) => ahora.getTime() - Date.parse(v.en) < 8 * 86_400_000));
  await guardarJson(claveAtendidas(workspaceId), limpias);
}

/** La supervisora (para los chats sin dueña y la segunda oportunidad): la de la config o la primera de Equipo. */
async function supervisoraDelNegocio(workspaceId: string, config: ConfigAccionable): Promise<Persona | null> {
  let ids: string[] = config.supervisoraId ? [config.supervisoraId] : [];
  if (!ids.length) {
    const lista = await leerJson<unknown>(`equipo:supervisoras:${workspaceId}`, () => []);
    ids = Array.isArray(lista) ? lista.filter((id): id is string => typeof id === "string") : [];
  }
  for (const id of ids) {
    const miembro = await prisma.workspaceMember
      .findFirst({ where: { workspaceId, userId: id, isActive: true }, select: { user: { select: { name: true, email: true } } } })
      .catch(() => null);
    if (miembro) return { id, nombre: miembro.user?.name?.trim() || miembro.user?.email || "la supervisora" };
  }
  return null;
}

async function datosDeLosChats(workspaceId: string, ids: string[]): Promise<{ numeros: Map<string, number>; extras: Map<string, ExtrasDelChat> }> {
  const unicos = [...new Set(ids)].filter(Boolean);
  if (!unicos.length) return { numeros: new Map(), extras: new Map() };
  const [conversaciones, leads] = await Promise.all([
    prisma.conversation.findMany({ where: { workspaceId, id: { in: unicos } }, select: { id: true, numero: true } }).catch(() => []),
    prisma.embudoLead
      .findMany({ where: { workspaceId, conversationId: { in: unicos } }, select: { conversationId: true, cotizacionEn: true, anticipoEn: true } })
      .catch(() => []),
  ]);
  return {
    numeros: new Map(conversaciones.filter((c) => c.numero !== null).map((c) => [c.id, c.numero as number])),
    extras: new Map(leads.map((l) => [l.conversationId, { cotizacionEn: l.cotizacionEn, anticipoEn: l.anticipoEn }])),
  };
}

function enlaceAbsoluto(a: Accion): string {
  return a.numero ? `${DOMINIO}/c/${a.numero}` : `${DOMINIO}/cliente/chats?chatKey=${encodeURIComponent(`agent:${a.conversationId}`)}&assigned=all`;
}

/** WhatsApp a una persona del equipo por la línea INTERNA (nunca la de ventas). */
async function whatsAppAlEquipo(workspaceId: string, userId: string, texto: string): Promise<boolean> {
  const numero = await numeroDeAvisosDeLaPersona(workspaceId, userId).catch(() => null);
  if (!numero) return false;
  const gravedad = await leerConfigGravedad(workspaceId).catch(() => CONFIG_GRAVEDAD_POR_DEFECTO);
  const linea = await lineaInterna(workspaceId, gravedad).catch(() => null);
  if (!linea) return false;
  try {
    await sendEvolutionTextMessageWithReconnect({ instanceName: linea.instancia, phoneNumber: numero, text: texto });
    return true;
  } catch (error) {
    console.warn("[supervisor-accionable] no salió el WhatsApp a la asesora", {
      numero: `…${numero.slice(-4)}`,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function ejecutar(workspaceId: string, estado: EstadoAccionable, eventos: Evento[], config: ConfigAccionable, ahora: Date): Promise<number> {
  let enviados = 0;
  const gravedad = await leerConfigGravedad(workspaceId).catch(() => CONFIG_GRAVEDAD_POR_DEFECTO);
  const paraAlexander: Tarjeta[] = [];
  for (const evento of eventos) {
    try {
      if (evento.tipo === "avisar" || evento.tipo === "segundo_aviso") {
        const acciones = evento.accionIds.map((id) => estado.acciones[id]).filter(Boolean);
        if (!acciones.length) continue;
        const segundo = evento.tipo === "segundo_aviso";
        const nocturno = Boolean(evento.fueraDeHorario);
        const { title, body } = pushParaLaAsesora(acciones, segundo, nocturno);
        const url = acciones.length === 1 && acciones[0].conversationId ? `/cliente/chats?chatKey=agent:${acciones[0].conversationId}&assigned=all` : "/cliente/crm/mi-dia";
        enviados += await sendPushToUser({ userId: evento.responsableId, payload: { title, body, tag: `accionable:${evento.responsableId}`, url } }).catch(() => 0);
        if (config.asesoraWhatsApp) {
          const enlaces = new Map(acciones.map((a) => [a.id, enlaceAbsoluto(a)]));
          if (await whatsAppAlEquipo(workspaceId, evento.responsableId, textoParaLaAsesora({ acciones, enlaces, ahora, segundo, fueraDeHorario: nocturno }))) enviados += 1;
        }
        if (evento.tipo === "segundo_aviso" && evento.supervisoraId) {
          const aviso = pushParaLaSupervisora(acciones);
          enviados += await sendPushToUser({ userId: evento.supervisoraId, payload: { ...aviso, tag: `accionable:apoyo:${evento.responsableId}`, url: "/cliente/crm/supervisor" } }).catch(() => 0);
        }
        continue;
      }
      if (evento.tipo === "escalar") {
        const accion = estado.acciones[evento.accionId];
        if (!accion) continue;
        // OBSERVACION: solo la tarjeta en su pantalla (no lo interrumpe).
        if (evento.gravedad === "OBSERVACION") continue;
        const tarjeta = tarjetaDeAccion(accion, ahora);
        paraAlexander.push(tarjeta);
        if (evento.gravedad === "CRITICO" && (await whatsAppAAlexander({ workspaceId, config: gravedad, texto: textoWhatsAppDeLaTarjeta(tarjeta) }))) enviados += 1;
      }
      // resuelta_abajo / resuelta_tras_escalar: no se avisa a nadie (queda en las métricas).
    } catch (error) {
      console.warn("[supervisor-accionable] evento", evento.tipo, error instanceof Error ? error.message : error);
    }
  }
  // Las escaladas de la vuelta van en UN push a Alexander (no uno por chat).
  if (paraAlexander.length) {
    const push = pushDeVariasTarjetas(paraAlexander);
    const url = paraAlexander.length === 1 ? paraAlexander[0].enlace : "/cliente/crm/supervisor";
    enviados += await pushAAlexander(workspaceId, gravedad, { ...push, tag: paraAlexander.length === 1 ? `accionable:${paraAlexander[0].id}` : `accionable:vuelta:${ahora.getTime()}`, url }).catch(() => 0);
  }
  return enviados;
}

/**
 * Una vuelta del accionable (la llama el chequeo de atención cada 5 min, con el interruptor).
 * Lee el estado, avanza la máquina, manda los avisos y guarda.
 */
export async function gestionarAcciones(input: {
  workspaceId: string;
  hallazgos: Hallazgo[];
  chats: ChatAbierto[];
  ahora: Date;
  config: ConfigAccionable;
}): Promise<{ eventos: Evento[]; enviados: number }> {
  const { workspaceId, ahora, config } = input;
  try {
    const [previo, atendidas, supervisora] = await Promise.all([
      leerEstadoAccionable(workspaceId),
      leerAtendidas(workspaceId),
      supervisoraDelNegocio(workspaceId, config),
    ]);
    // Fuera de horario también los chats que no salen en las alertas (los calientes que ve el accionable).
    const idsDeChats = [...input.hallazgos.flatMap((h) => h.evidencia.chats), ...(config.fueraDeHorario?.activo ? input.chats.map((c) => c.conversationId) : [])];
    const { numeros, extras } = await datosDeLosChats(workspaceId, idsDeChats);
    const candidatas = candidatasDeLaVuelta({ hallazgos: input.hallazgos, chats: input.chats, ahora, supervisora, extras, config });
    const { estado, eventos } = avanzar({ estado: previo, candidatas, chats: input.chats, atendidas, ahora, config, supervisora, numeros });
    // Se guarda ANTES de mandar: si un envío se cuelga, la próxima vuelta no repite el aviso.
    await guardarJson(claveEstadoAccionable(workspaceId), estado);
    const enviados = await ejecutar(workspaceId, estado, eventos, config, ahora);
    return { eventos, enviados };
  } catch (error) {
    console.error("[supervisor-accionable]", workspaceId, error instanceof Error ? error.message : error);
    return { eventos: [], enviados: 0 };
  }
}

/** El WhatsApp de un incidente CRÍTICO (bot / embudo / sistema) con el formato completo. */
export function textoCriticoDeIncidente(inc: Incidente): string {
  return textoWhatsAppDeLaTarjeta(tarjetaDeIncidente(inc));
}

/* ------------------------------------------------------------------------------------------------
   LECTURAS PARA LAS PANTALLAS
------------------------------------------------------------------------------------------------ */

export type PanelAccionable = {
  prioridades: { visibles: Tarjeta[]; resto: Tarjeta[] };
  /** Lo que está en manos de las asesoras (abiertas y cerradas de las últimas 24 h), sin patrones. */
  enManos: Accion[];
  metricas: ReturnType<typeof metricasDelDia>;
  /** Fuera de horario: clientes calientes / con pregunta de precio esperando respuesta humana. */
  esperando: EsperandoFueraDeHorario[];
};

/**
 * La pantalla del Supervisor: Prioridades de Alexander (máx. 3, solo escaladas reales y críticos
 * del bot/embudo/sistema sin atender) + lo que está en manos de las asesoras + métricas del día.
 */
export async function leerPanelAccionable(
  workspaceId: string,
  incidentesAbiertos: Incidente[],
  ahora = new Date(),
  /** Los chats abiertos (solo hacen falta fuera de horario, para "clientes esperando fuera de horario"). */
  chats: ChatAbierto[] = [],
): Promise<PanelAccionable> {
  const [config, estado, atendidas] = await Promise.all([leerConfigAccionable(workspaceId), leerEstadoAccionable(workspaceId), leerAtendidas(workspaceId)]);
  const supervisora = chats.length ? await supervisoraDelNegocio(workspaceId, config).catch(() => null) : null;
  const esperando = chats.length ? esperandoFueraDeHorario({ chats, ahora, config, supervisora }) : [];
  const escaladas = Object.values(estado.acciones).filter((a) => a.estado === "ESCALADA" && !atendidas[a.id]);
  const criticos = incidentesAbiertos.filter(
    (inc) => inc.estado === "ABIERTA" && inc.familia !== "ATENCION" && inc.severidad === "CRITICO" && !atendidas[idDeIncidente(inc)],
  );
  const tarjetas = [...escaladas.map((a) => tarjetaDeAccion(a, ahora)), ...criticos.map((inc) => tarjetaDeIncidente(inc))];
  const enManos = Object.values(estado.acciones)
    .filter((a) => a.tipo !== "patron_dia" && a.tipo !== "patron_semana")
    .sort((a, b) => Number(ESTADOS_ACTIVOS.includes(b.estado)) - Number(ESTADOS_ACTIVOS.includes(a.estado)) || Date.parse(b.detectadaEn) - Date.parse(a.detectadaEn));
  return { prioridades: prioridadesDeAlexander(tarjetas, config.maxPrioridades), enManos, metricas: metricasDelDia(estado, ahora), esperando };
}

/** Mi Día: lo que el Supervisor le pidió a esta persona (y, si es la supervisora, lo que pasó a segundo aviso). */
export async function leerPedidosDelSupervisor(workspaceId: string, userId: string): Promise<Accion[] | null> {
  const config = await leerConfigAccionable(workspaceId).catch(() => null);
  if (!config?.activo) return null;
  const estado = await leerEstadoAccionable(workspaceId);
  const esSupervisora = (await supervisoraDelNegocio(workspaceId, config))?.id === userId;
  return Object.values(estado.acciones)
    .filter(
      (a) =>
        (a.estado === "AVISADA" || a.estado === "SEGUNDO_AVISO") &&
        a.conversationId &&
        (a.responsableId === userId || (esSupervisora && a.estado === "SEGUNDO_AVISO")),
    )
    .sort((a, b) => Date.parse(a.venceEn ?? a.detectadaEn) - Date.parse(b.venceEn ?? b.detectadaEn));
}
