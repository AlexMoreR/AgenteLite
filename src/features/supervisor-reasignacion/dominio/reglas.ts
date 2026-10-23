/**
 * SUPERVISOR: AVISOS POR WHATSAPP Y REASIGNACIÓN AUTOMÁTICA (reglas puras, sin base de datos).
 *
 * Decisión del dueño (22-10-2026): en las chequeos de 2:00 y 6:00 se reasignaba a mano. Ahora, en
 * horario laboral y sobre los chats abiertos de las líneas de ventas (las del V3):
 *  - a los `avisoMin` (5) minutos laborales sin respuesta de la asesora (el cliente escribió último),
 *    un WhatsApp corto a su número personal;
 *  - a los `reasignarMin` (30) el chat pasa a otra asesora activa, la que tenga menos chats esperando,
 *    y se les avisa a las dos. El cliente es de quien lo atiende;
 *  - un chat Caliente con `calienteHoras` (24) sin mensaje de su asesora: un aviso;
 *  - el bot pidió pasar a asesora y nadie contestó: el mismo aviso de los 5 minutos.
 * Fuera de horario no avisa ni reasigna; el reloj cuenta solo minutos laborales (arranca al abrir).
 *
 * Nada de esto le escribe al cliente: los avisos salen por la línea Admin al número del equipo.
 */

import {
  esCaliente,
  estadoDeEspera,
  type ChatAbierto,
  type HorarioLaboral,
} from "../../supervisor/dominio/detectores-atencion";
import { motivoDeExclusion } from "../../supervisor/dominio/exclusiones";
import { diaSemanaBogota, horaBogota } from "../../supervisor/dominio/linea-base";

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;
/** Bogotá no tiene horario de verano: UTC−5 fijo (igual que el resto del Supervisor). */
const DESFASE_BOGOTA = -5 * HORA;

/** La línea Admin de Magilus: de ahí salen los avisos si no se configura otra. */
export const LINEA_ADMIN_POR_DEFECTO = "cmt06kiob00lw2hk2mgllstsb";
export const DOMINIO = "https://app.aizenbot.com";

export const TIPOS_DE_AVISO = ["AVISO", "REASIGNACION", "CALIENTE_24H", "BOT_PIDIO_ASESORA", "SIN_CANDIDATA"] as const;
export type TipoDeAviso = (typeof TIPOS_DE_AVISO)[number];

/* ------------------------------------------------------------------------------------------------
   CONFIGURACIÓN: AppSetting `supervisor:reasignacion:<workspaceId>` (JSON). Sin fila o JSON roto =
   los dos interruptores APAGADOS y los tiempos de siempre.
------------------------------------------------------------------------------------------------ */

export type ConfigReasignacion = {
  /** Interruptor de los avisos por WhatsApp (5 min, Caliente 24 h, bot pidió asesora). */
  avisosActivos: boolean;
  /** Interruptor aparte de la reasignación automática. */
  reasignacionActiva: boolean;
  avisoMin: number;
  reasignarMin: number;
  calienteHoras: number;
  horario: HorarioLaboral;
  /** La línea (administrativa) por la que salen los avisos. */
  canalId: string;
  /**
   * Cuándo se prendió cada interruptor (lo pone la acción de guardar, no la pantalla). El reloj no
   * cuenta desde antes: al prenderlo no sale de golpe todo lo que ya estaba atrasado.
   */
  avisosDesde: Date | null;
  reasignacionDesde: Date | null;
};

export const CONFIG_REASIGNACION_POR_DEFECTO: ConfigReasignacion = {
  avisosActivos: false,
  reasignacionActiva: false,
  avisoMin: 5,
  reasignarMin: 30,
  calienteHoras: 24,
  horario: { desde: 8, hasta: 18, dias: [1, 2, 3, 4, 5, 6] },
  canalId: LINEA_ADMIN_POR_DEFECTO,
  avisosDesde: null,
  reasignacionDesde: null,
};

export const claveConfigReasignacion = (workspaceId: string) => `supervisor:reasignacion:${workspaceId}`;

function entero(valor: unknown, min: number, max: number, porDefecto: number): number {
  const n = typeof valor === "number" ? valor : typeof valor === "string" && valor.trim() ? Number(valor) : NaN;
  if (!Number.isFinite(n)) return porDefecto;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function siNo(valor: unknown): boolean {
  return valor === true || valor === "true";
}

function fechaONada(valor: unknown): Date | null {
  if (!(valor instanceof Date) && typeof valor !== "string") return null;
  const fecha = new Date(valor);
  return Number.isFinite(fecha.getTime()) ? fecha : null;
}

/** Lee la config de un objeto cualquiera (lo guardado o lo que manda la pantalla), con topes. */
export function normalizarConfigReasignacion(crudo: Record<string, unknown>): ConfigReasignacion {
  const d = CONFIG_REASIGNACION_POR_DEFECTO;
  const avisoMin = entero(crudo.avisoMin, 1, 240, d.avisoMin);
  // La reasignación siempre después del aviso (si no, el aviso nunca saldría).
  const reasignarMin = Math.max(avisoMin + 1, entero(crudo.reasignarMin, 2, 600, d.reasignarMin));
  const horarioCrudo = (crudo.horario && typeof crudo.horario === "object" ? crudo.horario : {}) as Record<string, unknown>;
  const dias = Array.isArray(horarioCrudo.dias)
    ? [...new Set(horarioCrudo.dias.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6))].sort()
    : d.horario.dias;
  let desde = entero(horarioCrudo.desde, 0, 23, d.horario.desde);
  let hasta = entero(horarioCrudo.hasta, 1, 24, d.horario.hasta);
  if (hasta <= desde) {
    desde = d.horario.desde;
    hasta = d.horario.hasta;
  }
  const canalId = typeof crudo.canalId === "string" && crudo.canalId.trim() ? crudo.canalId.trim() : d.canalId;
  return {
    avisosActivos: siNo(crudo.avisosActivos),
    reasignacionActiva: siNo(crudo.reasignacionActiva),
    avisoMin,
    reasignarMin,
    calienteHoras: entero(crudo.calienteHoras, 1, 168, d.calienteHoras),
    horario: { desde, hasta, dias },
    canalId,
    avisosDesde: fechaONada(crudo.avisosDesde),
    reasignacionDesde: fechaONada(crudo.reasignacionDesde),
  };
}

/**
 * Las marcas de "desde cuándo está prendido": al pasar de apagado a prendido, ahora; si sigue
 * prendido, la de antes; apagado, ninguna. Lo que mande la pantalla en esos campos no cuenta.
 */
export function conMarcasDeActivacion(nueva: ConfigReasignacion, anterior: ConfigReasignacion, ahora: Date): ConfigReasignacion {
  const marca = (prendido: boolean, antes: boolean, previa: Date | null) => (!prendido ? null : antes && previa ? previa : ahora);
  return {
    ...nueva,
    avisosDesde: marca(nueva.avisosActivos, anterior.avisosActivos, anterior.avisosDesde),
    reasignacionDesde: marca(nueva.reasignacionActiva, anterior.reasignacionActiva, anterior.reasignacionDesde),
  };
}

export function leerConfigReasignacionDeTexto(texto: string | null | undefined): ConfigReasignacion {
  try {
    const valor = texto ? JSON.parse(texto) : null;
    return normalizarConfigReasignacion(valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {});
  } catch {
    return normalizarConfigReasignacion({});
  }
}

/* ------------------------------------------------------------------------------------------------
   EL RELOJ LABORAL
------------------------------------------------------------------------------------------------ */

export function enHorarioLaboral(fecha: Date, horario: HorarioLaboral): boolean {
  const h = horaBogota(fecha);
  return horario.dias.includes(diaSemanaBogota(fecha)) && h >= horario.desde && h < horario.hasta;
}

/**
 * Minutos entre `desde` y `hasta` contados SOLO dentro del horario laboral (exacto al minuto, por
 * tramos de día; máximo 7 días). Un cliente que escribió el sábado a las 7 p. m. lleva 0 minutos
 * hasta el lunes a las 8:00.
 */
export function minutosLaborales(desde: Date, hasta: Date, horario: HorarioLaboral): number {
  const a = desde.getTime() + DESFASE_BOGOTA;
  const b = Math.min(hasta.getTime(), desde.getTime() + 7 * DIA) + DESFASE_BOGOTA;
  if (b <= a) return 0;
  let total = 0;
  for (let dia = Math.floor(a / DIA) * DIA; dia < b; dia += DIA) {
    if (!horario.dias.includes(new Date(dia).getUTCDay())) continue;
    const abre = dia + horario.desde * HORA;
    const cierra = dia + horario.hasta * HORA;
    total += Math.max(0, Math.min(cierra, b) - Math.max(abre, a));
  }
  return Math.floor(total / MIN);
}

/* ------------------------------------------------------------------------------------------------
   QUÉ TOCA EN CADA CHAT
------------------------------------------------------------------------------------------------ */

/** El chat es tarea: ni PERDIDO/GANADO, ni resuelto, ni del exterior, ni dormido. */
function esTarea(chat: ChatAbierto, ahora: Date): boolean {
  const motivo = motivoDeExclusion({ ...chat, textos: [...(chat.textosDelCliente ?? []), ...chat.textosPendientes] }, ahora);
  return motivo === null || motivo === "ya_respondio";
}

/** ¿El cliente espera respuesta de una persona? (mismos filtros del Supervisor: cierres, auto-respuestas, turno). */
export function esperaRespuesta(chat: ChatAbierto, ahora: Date, horario: HorarioLaboral): boolean {
  if (!esTarea(chat, ahora)) return false;
  const estado = estadoDeEspera(chat, ahora, horario);
  return estado.esperando && !estado.cierre;
}

const ORIGENES_HUMANOS = ["manual", "instance"];

/** El primer mensaje del cliente después del último mensaje nuestro que cumpla `corta`. */
function primerMensajeDespuesDe(chat: ChatAbierto, corta: (origen: string | null) => boolean): Date | null {
  if (!chat.ultimoClienteEn) return null;
  const eventos = [...(chat.mensajes ?? [])]
    .filter((e) => e.tipo !== "SYSTEM" && e.en.getTime() <= (chat.ultimoClienteEn as Date).getTime())
    .sort((x, y) => x.en.getTime() - y.en.getTime());
  let inicio: Date | null = null;
  for (let i = eventos.length - 1; i >= 0; i -= 1) {
    if (eventos[i].direccion === "OUT" && corta(eventos[i].origen)) break;
    if (eventos[i].direccion === "IN") inicio = eventos[i].en;
  }
  return inicio ?? chat.ultimoClienteEn;
}

/**
 * Desde cuándo espera el cliente una respuesta DE UNA PERSONA: el primer mensaje suyo después de la
 * última respuesta humana, no el último (si no, un cliente que insiste nunca llegaría a los 5
 * minutos). Las respuestas del bot no reinician el reloj: un caliente al que solo le contesta el bot
 * sigue sin respuesta de su asesora. Es el episodio de la reasignación.
 */
export function inicioDeLaEspera(chat: ChatAbierto): Date | null {
  return primerMensajeDespuesDe(chat, (origen) => Boolean(origen && ORIGENES_HUMANOS.includes(origen)));
}

/**
 * El primer mensaje de la tanda actual del cliente (después de CUALQUIER respuesta nuestra, bot
 * incluido). La reasignación pide que esta tanda lleve al menos `avisoMin`: así la asesora siempre
 * tiene ese margen desde que el chat vuelve a esperarla (si el bot lo tuvo resuelto un rato).
 */
export function inicioDeLaTanda(chat: ChatAbierto): Date | null {
  return primerMensajeDespuesDe(chat, () => true);
}

const masNueva = (...fechas: Array<Date | null | undefined>): Date | null => {
  const validas = fechas.filter((f): f is Date => Boolean(f));
  return validas.length ? new Date(Math.max(...validas.map((f) => f.getTime()))) : null;
};

export type Decision = {
  tipo: TipoDeAviso;
  chat: ChatAbierto;
  /** La asesora actual del chat (la avisada o a la que se le quita). */
  asesoraId: string;
  episodio: Date;
  minutos: number;
  /** En SIN_CANDIDATA: "ya_reasignado" (no se vuelve a pasar) o "sin_asesora" (no hay a quién). */
  motivo?: "ya_reasignado" | "sin_asesora";
};

export const claveDelEpisodio = (conversationId: string, tipo: TipoDeAviso, episodio: Date) => `${conversationId}|${tipo}|${episodio.getTime()}`;

/**
 * Lo que toca en esta vuelta. `yaAnotados` son las claves (claveDelEpisodio) que ya están en el
 * registro: nada se decide dos veces. La base igual lo impide con su regla única.
 */
export function decidirLaVuelta(input: {
  chats: ChatAbierto[];
  ahora: Date;
  config: ConfigReasignacion;
  yaAnotados: Set<string>;
}): Decision[] {
  const { chats, ahora, config, yaAnotados } = input;
  if (!config.avisosActivos && !config.reasignacionActiva) return [];
  // Fuera de horario no avisa ni reasigna.
  if (!enHorarioLaboral(ahora, config.horario)) return [];
  const anotado = (c: ChatAbierto, tipo: TipoDeAviso, episodio: Date) => yaAnotados.has(claveDelEpisodio(c.conversationId, tipo, episodio));
  const salida: Decision[] = [];
  for (const chat of chats) {
    const asesoraId = chat.asesoraId;
    if (!asesoraId || !esTarea(chat, ahora)) continue;

    if (esperaRespuesta(chat, ahora, config.horario)) {
      const inicio = inicioDeLaEspera(chat);
      if (inicio) {
        // Para la asesora actual el reloj arranca cuando le llegó el chat (si le llegó después), y
        // nunca antes de prender el interruptor (si no, al prenderlo saldría todo lo atrasado de golpe).
        const base = masNueva(inicio, chat.asignadaEn) as Date;
        // "El bot pidió asesora y nadie contestó en 5 minutos": ese aviso cuenta desde que lo pidió.
        const botPidio = chat.turno?.de === "MAGILUS" && chat.turno.motivo === "bot_pidio_asesora";
        const desdeAviso = masNueva(base, config.avisosDesde, botPidio ? chat.turno?.respondioEn : null) as Date;
        const minutosAviso = minutosLaborales(desdeAviso, ahora, config.horario);
        const minutosReasignar = minutosLaborales(masNueva(base, config.reasignacionDesde) as Date, ahora, config.horario);
        const tanda = masNueva(inicioDeLaTanda(chat), chat.asignadaEn) ?? base;
        const minutosDeLaTanda = minutosLaborales(tanda, ahora, config.horario);
        if (config.reasignacionActiva && minutosReasignar >= config.reasignarMin && minutosDeLaTanda >= config.avisoMin) {
          // Una sola reasignación por cada mensaje del cliente: la segunda vez, aviso al dueño.
          if (!anotado(chat, "REASIGNACION", inicio)) {
            salida.push({ tipo: "REASIGNACION", chat, asesoraId, episodio: inicio, minutos: minutosReasignar });
          } else if (!anotado(chat, "SIN_CANDIDATA", base)) {
            salida.push({ tipo: "SIN_CANDIDATA", chat, asesoraId, episodio: base, minutos: minutosReasignar, motivo: "ya_reasignado" });
          }
        } else if (config.avisosActivos && minutosAviso >= config.avisoMin) {
          const tipo: TipoDeAviso = botPidio ? "BOT_PIDIO_ASESORA" : "AVISO";
          if (!anotado(chat, tipo, desdeAviso)) salida.push({ tipo, chat, asesoraId, episodio: desdeAviso, minutos: minutosAviso });
        }
      }
    }

    // Caliente sin mensaje de su asesora: horas de reloj desde el último mensaje de una persona o
    // desde que le llegó el chat, lo que sea más nuevo (si no hay ninguno, desde que el cliente la
    // espera). Nunca desde antes de prender los avisos. Sale solo en horario (la vuelta ya lo exige).
    if (config.avisosActivos && esCaliente(chat)) {
      const ultimaMarca = masNueva(chat.ultimaRespuestaHumanaEn, chat.asignadaEn) ?? inicioDeLaEspera(chat);
      const referencia = ultimaMarca ? (masNueva(ultimaMarca, config.avisosDesde) as Date) : null;
      if (referencia && ahora.getTime() - referencia.getTime() >= config.calienteHoras * HORA && !anotado(chat, "CALIENTE_24H", referencia)) {
        const minutos = Math.floor((ahora.getTime() - referencia.getTime()) / MIN);
        salida.push({ tipo: "CALIENTE_24H", chat, asesoraId, episodio: referencia, minutos });
      }
    }
  }
  return salida;
}

/** Cuántos chats esperan respuesta de cada asesora (para elegir a quién pasarle uno). */
export function pendientesPorAsesora(chats: ChatAbierto[], ahora: Date, horario: HorarioLaboral): Map<string, number> {
  const cuenta = new Map<string, number>();
  for (const chat of chats) {
    if (!chat.asesoraId || !esperaRespuesta(chat, ahora, horario)) continue;
    cuenta.set(chat.asesoraId, (cuenta.get(chat.asesoraId) ?? 0) + 1);
  }
  return cuenta;
}

/** La asesora activa con menos chats esperando (a igualdad, la primera de la lista). Nunca la anterior. */
export function elegirAsesora(candidatas: string[], pendientes: Map<string, number>, anterior: string): string | null {
  let mejor: string | null = null;
  for (const id of candidatas) {
    if (id === anterior) continue;
    if (mejor === null || (pendientes.get(id) ?? 0) < (pendientes.get(mejor) ?? 0)) mejor = id;
  }
  return mejor;
}

/* ------------------------------------------------------------------------------------------------
   LOS TEXTOS (cortos: un solo mensaje por persona y vuelta)
------------------------------------------------------------------------------------------------ */

const ETAPAS: Record<string, string> = {
  NUEVO: "Nuevo",
  CALIFICADO: "Calificado",
  PROPUESTA: "Propuesta",
  NEGOCIACION: "Caliente",
  GANADO: "Ganado",
  PERDIDO: "Perdido",
};

export function etiquetaDeEtapa(etapa: string | null | undefined): string {
  return (etapa && ETAPAS[etapa]) || "Sin etapa";
}

/** El nombre del cliente o, si no hay, el teléfono tapado (•••• 4567). */
export function clienteDelChat(chat: Pick<ChatAbierto, "nombreCliente" | "telefono">): string {
  const nombre = (chat.nombreCliente ?? "").trim();
  if (nombre && !/^\+?\d[\d\s-]{6,}$/.test(nombre)) return nombre;
  const digitos = (chat.telefono ?? nombre).replace(/\D/g, "");
  return digitos.length >= 4 ? `•••• ${digitos.slice(-4)}` : "cliente sin nombre";
}

export function enlaceDelChat(numero: number | null | undefined, conversationId: string): string {
  return numero ? `${DOMINIO}/c/${numero}` : `${DOMINIO}/cliente/chats?chatKey=${encodeURIComponent(`agent:${conversationId}`)}&assigned=all`;
}

function duracion(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  return horas < 48 ? `${horas} h` : `${Math.floor(horas / 24)} días`;
}

export type LineaDeAviso = {
  tipo: TipoDeAviso | "REASIGNADO_A_TI" | "TE_LO_QUITARON";
  cliente: string;
  etapa: string;
  minutos: number;
  enlace: string;
  /** El nombre de la otra asesora (en las reasignaciones) o de la dueña del chat (aviso al dueño). */
  otra?: string | null;
  motivo?: Decision["motivo"];
};

export function lineaDeAviso(l: LineaDeAviso): string {
  const quien = `${l.cliente} · ${l.etapa}`;
  switch (l.tipo) {
    case "AVISO":
      return `⏰ ${quien} · ${duracion(l.minutos)} esperando tu respuesta\n${l.enlace}`;
    case "BOT_PIDIO_ASESORA":
      return `🙋 El bot pidió asesora: ${quien} · ${duracion(l.minutos)} esperando\n${l.enlace}`;
    case "CALIENTE_24H":
      return `🔥 Caliente sin mensaje tuyo hace ${duracion(l.minutos)}: ${quien}\n${l.enlace}`;
    case "REASIGNADO_A_TI":
      return `➡️ Te pasaron este chat${l.otra ? ` (era de ${l.otra})` : ""}: ${quien} · ${duracion(l.minutos)} esperando. Atiéndelo ya\n${l.enlace}`;
    case "TE_LO_QUITARON":
      return `↪️ Se le pasó a ${l.otra ?? "otra asesora"} el chat de ${l.cliente}: ${duracion(l.minutos)} sin tu respuesta\n${l.enlace}`;
    case "SIN_CANDIDATA":
      return l.motivo === "ya_reasignado"
        ? `⚠️ Ya se reasignó y sigue sin respuesta (${l.otra ?? "sin asesora"}): ${quien} · ${duracion(l.minutos)}\n${l.enlace}`
        : `⚠️ No hay otra asesora disponible para pasarle el chat (es de ${l.otra ?? "nadie"}): ${quien} · ${duracion(l.minutos)}\n${l.enlace}`;
    case "REASIGNACION":
      return `↪️ Chat reasignado: ${quien}\n${l.enlace}`;
  }
}

/** Un solo mensaje con todo lo de la persona en esta vuelta. */
export function textoDelAviso(lineas: LineaDeAviso[]): string {
  return [`*Supervisor*`, ...lineas.map(lineaDeAviso)].join("\n\n");
}

/* ------------------------------------------------------------------------------------------------
   EL CONTEO DEL DÍA (para la pantalla y el resumen de las 7:30)
------------------------------------------------------------------------------------------------ */

export type FilaDelRegistro = {
  tipo: string;
  asesoraId: string;
  asesoraNuevaId: string | null;
  whatsappEnviado: boolean;
};

export type ConteoDeAsesora = {
  asesoraId: string;
  avisos: number;
  botPidioAsesora: number;
  caliente24h: number;
  /** Chats que se le quitaron por no responder. */
  reasignadosLeQuitaron: number;
  /** Chats que recibió de otra. */
  reasignadosRecibio: number;
  /** Escaladas al dueño (no había a quién pasarlo, o ya se había pasado). */
  sinCandidata: number;
  whatsappFallidos: number;
};

export function conteoPorAsesora(filas: FilaDelRegistro[]): ConteoDeAsesora[] {
  const porId = new Map<string, ConteoDeAsesora>();
  const de = (id: string) => {
    let c = porId.get(id);
    if (!c) {
      c = { asesoraId: id, avisos: 0, botPidioAsesora: 0, caliente24h: 0, reasignadosLeQuitaron: 0, reasignadosRecibio: 0, sinCandidata: 0, whatsappFallidos: 0 };
      porId.set(id, c);
    }
    return c;
  };
  for (const f of filas) {
    const c = de(f.asesoraId);
    if (f.tipo === "AVISO") c.avisos += 1;
    else if (f.tipo === "BOT_PIDIO_ASESORA") c.botPidioAsesora += 1;
    else if (f.tipo === "CALIENTE_24H") c.caliente24h += 1;
    else if (f.tipo === "SIN_CANDIDATA") c.sinCandidata += 1;
    else if (f.tipo === "REASIGNACION") {
      c.reasignadosLeQuitaron += 1;
      if (f.asesoraNuevaId) de(f.asesoraNuevaId).reasignadosRecibio += 1;
    }
    if (!f.whatsappEnviado) c.whatsappFallidos += 1;
  }
  return [...porId.values()].sort(
    (a, b) => b.reasignadosLeQuitaron - a.reasignadosLeQuitaron || b.avisos - a.avisos || a.asesoraId.localeCompare(b.asesoraId),
  );
}

/** El día (AAAA-MM-DD) en Bogotá y su rango en UTC. */
export function fechaBogota(fecha: Date): string {
  return new Date(fecha.getTime() + DESFASE_BOGOTA).toISOString().slice(0, 10);
}

export function rangoDelDia(fecha: string): { desde: Date; hasta: Date } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
  const inicio = Date.parse(`${fecha}T00:00:00Z`);
  if (!Number.isFinite(inicio)) return null;
  return { desde: new Date(inicio - DESFASE_BOGOTA), hasta: new Date(inicio - DESFASE_BOGOTA + DIA) };
}
