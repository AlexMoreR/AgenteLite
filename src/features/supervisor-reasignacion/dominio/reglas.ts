/**
 * SUPERVISOR: AVISOS POR WHATSAPP Y REASIGNACIÓN AUTOMÁTICA DE CHATS (reglas puras, sin base de datos).
 *
 * Decisión del dueño:
 *  1. A los 5 min sin respuesta de la asesora (el cliente escribió último) → WhatsApp a ella.
 *  2. A los 30 min → el chat pasa a otra asesora activa (la que tenga menos pendientes) y se avisa
 *     a la nueva y a la anterior. El cliente es de quien lo atiende.
 *  3. Solo en horario laboral. Fuera de horario no avisa ni reasigna; el conteo arranca al abrir.
 *  4. Los tiempos se cambian sin tocar código (config en AppSetting).
 *  5. Chat Caliente con 24 h sin mensaje de la asesora → aviso.
 *  6. Si el bot pidió pasar a asesora y nadie responde en 5 min → el mismo aviso.
 *  9. Interruptores separados: avisos y reasignación.
 * 10. Nunca el mismo aviso dos veces (ver `claveDeAviso`).
 *
 * Nada de esto le escribe al cliente. Los filtros de "esperando" son los mismos del Supervisor
 * (despedidas, auto-respuestas, chats ganados/perdidos, clientes del exterior, dormidos).
 */

import { enHorario, estadoDeEspera, type ChatAbierto, type HorarioLaboral } from "../../supervisor/dominio/detectores-atencion";
import { motivoDeExclusion } from "../../supervisor/dominio/exclusiones";

const MIN = 60_000;
const HORA = 3_600_000;
const DIA = 24 * HORA;
/** Bogotá es UTC−5 todo el año (sin horario de verano). */
const BOGOTA = 5 * HORA;

/** La línea Admin de Magilus: desde ahí salen los avisos al WhatsApp personal de cada asesora. */
export const LINEA_ADMIN_POR_DEFECTO = "cmt06kiob00lw2hk2mgllstsb";
export const DOMINIO = "https://app.aizenbot.com";

export type TipoDeAviso = "AVISO" | "REASIGNACION" | "CALIENTE_24H" | "BOT_PIDIO_ASESORA" | "SIN_CANDIDATA";

export type ConfigReasignacion = {
  /** Interruptor de los avisos por WhatsApp (AVISO, CALIENTE_24H, BOT_PIDIO_ASESORA). */
  avisosActivo: boolean;
  /** Interruptor de la reasignación. Es independiente del de los avisos. */
  reasignacionActiva: boolean;
  /** Minutos laborales sin respuesta para el aviso a la asesora. */
  minutosAviso: number;
  /** Minutos laborales sin respuesta para pasar el chat a otra asesora. */
  minutosReasignacion: number;
  /** Horas sin mensaje de la asesora para el aviso de un chat Caliente. */
  horasCaliente: number;
  horario: HorarioLaboral;
  /** Línea desde la que salen los avisos (tiene que ser administrativa). */
  canalId: string;
};

export const CONFIG_POR_DEFECTO: ConfigReasignacion = {
  avisosActivo: false,
  reasignacionActiva: false,
  minutosAviso: 5,
  minutosReasignacion: 30,
  horasCaliente: 24,
  horario: { desde: 8, hasta: 18, dias: [1, 2, 3, 4, 5, 6] },
  canalId: LINEA_ADMIN_POR_DEFECTO,
};

export const claveConfigReasignacion = (workspaceId: string) => `supervisor:reasignacion:${workspaceId}`;

function entero(valor: unknown, defecto: number, min: number, max: number): number {
  const n = typeof valor === "number" ? valor : typeof valor === "string" && valor.trim() ? Number(valor) : NaN;
  if (!Number.isFinite(n)) return defecto;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Lee la config guardada (JSON). Sin fila o JSON roto = los dos interruptores apagados y los valores de siempre. */
export function leerConfigDeTexto(texto: string | null | undefined): ConfigReasignacion {
  let crudo: Record<string, unknown> = {};
  try {
    const leido = texto ? JSON.parse(texto) : null;
    if (leido && typeof leido === "object" && !Array.isArray(leido)) crudo = leido as Record<string, unknown>;
  } catch {
    crudo = {};
  }
  const base = CONFIG_POR_DEFECTO;
  const minutosAviso = entero(crudo.minutosAviso, base.minutosAviso, 1, 240);
  // La reasignación siempre va después del aviso.
  const minutosReasignacion = Math.max(minutosAviso + 1, entero(crudo.minutosReasignacion, base.minutosReasignacion, 2, 480));
  const h = crudo.horario && typeof crudo.horario === "object" ? (crudo.horario as Record<string, unknown>) : {};
  const desde = entero(h.desde, base.horario.desde, 0, 23);
  const hasta = entero(h.hasta, base.horario.hasta, 1, 24);
  const dias = Array.isArray(h.dias)
    ? [...new Set(h.dias.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : base.horario.dias;
  return {
    avisosActivo: crudo.avisosActivo === true,
    reasignacionActiva: crudo.reasignacionActiva === true,
    minutosAviso,
    minutosReasignacion,
    horasCaliente: entero(crudo.horasCaliente, base.horasCaliente, 1, 168),
    horario: hasta > desde && dias.length ? { desde, hasta, dias } : base.horario,
    canalId: typeof crudo.canalId === "string" && crudo.canalId.trim() ? crudo.canalId.trim() : base.canalId,
  };
}

/* ------------------------------------------------------------------------------------------------
   HORARIO LABORAL
------------------------------------------------------------------------------------------------ */

/**
 * Minutos entre `desde` y `hasta` que caen DENTRO del horario laboral, al minuto (el del Supervisor
 * cuenta de a 15 y no alcanza para un aviso a los 5). Máximo 7 días hacia atrás. Una espera que
 * empieza fuera de horario arranca a contar cuando abre.
 */
export function minutosLaboralesExactos(desde: Date, hasta: Date, horario: HorarioLaboral): number {
  const ini = desde.getTime();
  const fin = Math.min(hasta.getTime(), ini + 7 * DIA);
  if (fin <= ini) return 0;
  let total = 0;
  // Medianoche de Bogotá del día de `desde`, en ms UTC.
  for (let dia = Math.floor((ini - BOGOTA) / DIA) * DIA + BOGOTA; dia < fin; dia += DIA) {
    if (!horario.dias.includes(new Date(dia - BOGOTA).getUTCDay())) continue;
    const abre = Math.max(ini, dia + horario.desde * HORA);
    const cierra = Math.min(fin, dia + horario.hasta * HORA);
    if (cierra > abre) total += cierra - abre;
  }
  return Math.floor(total / MIN);
}

/* ------------------------------------------------------------------------------------------------
   QUÉ TOCA HACER
------------------------------------------------------------------------------------------------ */

export type Decision = {
  tipo: Exclude<TipoDeAviso, "SIN_CANDIDATA">;
  conversationId: string;
  asesoraId: string;
  /** La hora (ISO) del mensaje que provocó esto: junto con el chat y el tipo, es la clave anti-duplicados. */
  episodio: string;
  minutos: number;
  etapa: string | null;
  nombre: string | null;
  telefono: string | null;
};

/** La clave que no deja avisar dos veces lo mismo (es la regla única de la tabla). */
export const claveDeAviso = (conversationId: string, tipo: TipoDeAviso, episodio: string) => `${conversationId}|${tipo}|${episodio}`;

function datosDeExclusion(chat: ChatAbierto, conRespuesta: boolean) {
  return {
    etapa: chat.etapa,
    telefono: chat.telefono,
    metadata: chat.metadata,
    esLid: chat.esLid,
    telefonoDescubierto: chat.telefonoDescubierto,
    dormidoHasta: chat.dormidoHasta,
    ultimoClienteEn: chat.ultimoClienteEn,
    ultimaRespuestaHumanaEn: conRespuesta ? chat.ultimaRespuestaHumanaEn : null,
    textos: chat.textosDelCliente ?? chat.textosPendientes,
  };
}

/** ¿El chat está esperando a su asesora de verdad? (mismos filtros del Supervisor). */
export function chatEsperando(chat: ChatAbierto, ahora: Date, horario: HorarioLaboral): boolean {
  if (!chat.asesoraId) return false;
  const espera = estadoDeEspera(chat, ahora, horario);
  if (!espera.esperando || espera.cierre) return false;
  return motivoDeExclusion(datosDeExclusion(chat, true), ahora) === null;
}

/** Cuántos chats está esperando contestar cada asesora (para repartir al que menos tiene). */
export function pendientesPorAsesora(chats: ChatAbierto[], ahora: Date, horario: HorarioLaboral): Map<string, number> {
  const cuenta = new Map<string, number>();
  for (const chat of chats) {
    if (chat.asesoraId && chatEsperando(chat, ahora, horario)) cuenta.set(chat.asesoraId, (cuenta.get(chat.asesoraId) ?? 0) + 1);
  }
  return cuenta;
}

/**
 * Lo que toca hacer en esta vuelta. `registrados` = claves (`claveDeAviso`) de lo que ya quedó anotado.
 * Fuera de horario no devuelve nada. Una vuelta que llega tarde (por ejemplo, tras una caída) con la
 * reasignación vencida manda solo la reasignación: un aviso de "5 minutos" a los 35 ya no sirve.
 */
export function decidir(input: { chats: ChatAbierto[]; ahora: Date; config: ConfigReasignacion; registrados: Set<string> }): Decision[] {
  const { chats, ahora, config, registrados } = input;
  if (!config.avisosActivo && !config.reasignacionActiva) return [];
  if (!enHorario(ahora, config.horario)) return [];
  const decisiones: Decision[] = [];

  for (const chat of chats) {
    const asesoraId = chat.asesoraId;
    if (!asesoraId) continue;
    const base = { conversationId: chat.conversationId, asesoraId, etapa: chat.etapa, nombre: chat.nombreCliente ?? null, telefono: chat.telefono ?? null };

    // 1, 2 y 6: el cliente escribió último y la asesora no ha contestado.
    if (chatEsperando(chat, ahora, config.horario) && chat.ultimoClienteEn) {
      const episodio = chat.ultimoClienteEn.toISOString();
      // El reloj de la asesora arranca cuando recibió el chat: no se le cobra la espera de antes.
      const inicio = chat.asignadaEn && chat.asignadaEn > chat.ultimoClienteEn ? chat.asignadaEn : chat.ultimoClienteEn;
      const minutos = minutosLaboralesExactos(inicio, ahora, config.horario);
      const reasignar = config.reasignacionActiva && minutos >= config.minutosReasignacion;
      if (reasignar) {
        if (!registrados.has(claveDeAviso(chat.conversationId, "REASIGNACION", episodio)) && !registrados.has(claveDeAviso(chat.conversationId, "SIN_CANDIDATA", episodio))) {
          decisiones.push({ ...base, tipo: "REASIGNACION", episodio, minutos });
        }
      } else if (config.avisosActivo && minutos >= config.minutosAviso) {
        const tipo = chat.turno?.motivo === "bot_pidio_asesora" ? "BOT_PIDIO_ASESORA" : "AVISO";
        if (!registrados.has(claveDeAviso(chat.conversationId, tipo, episodio))) decisiones.push({ ...base, tipo, episodio, minutos });
      }
    }

    // 5: Caliente sin mensaje de la asesora en 24 h (cuenta también desde que se le asignó).
    if (config.avisosActivo && estadoDeEspera(chat, ahora, config.horario).caliente && motivoDeExclusion(datosDeExclusion(chat, false), ahora) === null) {
      const ultimo = [chat.ultimaRespuestaHumanaEn, chat.asignadaEn].filter((f): f is Date => Boolean(f)).sort((a, b) => b.getTime() - a.getTime())[0];
      if (ultimo && ahora.getTime() - ultimo.getTime() >= config.horasCaliente * HORA) {
        const episodio = ultimo.toISOString();
        if (!registrados.has(claveDeAviso(chat.conversationId, "CALIENTE_24H", episodio))) {
          decisiones.push({ ...base, tipo: "CALIENTE_24H", episodio, minutos: Math.floor((ahora.getTime() - ultimo.getTime()) / MIN) });
        }
      }
    }
  }
  return decisiones;
}

/** La asesora con menos chats pendientes (empate: por id, para que sea estable). Nunca la actual. */
export function elegirAsesora(candidatas: string[], pendientes: Map<string, number>, actual: string | null): string | null {
  const posibles = [...new Set(candidatas)].filter((id) => id !== actual);
  if (!posibles.length) return null;
  return posibles.sort((a, b) => (pendientes.get(a) ?? 0) - (pendientes.get(b) ?? 0) || a.localeCompare(b))[0];
}

/* ------------------------------------------------------------------------------------------------
   TEXTOS DEL WHATSAPP (cortos; un solo mensaje por asesora por vuelta)
------------------------------------------------------------------------------------------------ */

export type LineaDeChat = { cliente: string; etapa: string; minutos: number; enlace: string };

const ETAPAS: Record<string, string> = {
  NUEVO: "Nuevo",
  CALIFICADO: "Calificado",
  PROPUESTA: "Propuesta",
  NEGOCIACION: "Caliente",
  GANADO: "Ganado",
  PERDIDO: "Perdido",
};

export const etiquetaDeEtapa = (etapa: string | null) => (etapa ? (ETAPAS[etapa] ?? etapa) : "Sin etapa");

/** Nombre del cliente o, si no hay, el teléfono tapado (•••• 4567). */
export function etiquetaDelCliente(nombre: string | null | undefined, telefono: string | null | undefined): string {
  const limpio = (nombre ?? "").trim();
  if (limpio && !/^\+?\d[\d\s-]*$/.test(limpio)) return limpio.slice(0, 40);
  const digitos = (telefono ?? limpio).replace(/\D/g, "");
  return digitos.length >= 4 ? `•••• ${digitos.slice(-4)}` : "Cliente";
}

export const enlaceDelChat = (numero: number | null | undefined) => (numero ? `${DOMINIO}/c/${numero}` : `${DOMINIO}/cliente/chats`);

export type MensajeParaAsesora = {
  /** Sin respuesta (5 min y bot que pidió asesora). */
  esperando: LineaDeChat[];
  /** Calientes con 24 h sin mensaje de ella. */
  calientes: LineaDeChat[];
  /** Chats que le pasaron a ella. */
  recibidos: LineaDeChat[];
  /** Chats que ella dejó vencer y se pasaron a otra (con el nombre de quien los recibió). */
  perdidos: Array<LineaDeChat & { aQuien: string }>;
  minutosReasignacion: number;
  horasCaliente: number;
};

const linea = (c: LineaDeChat, extra = "") => `• ${c.cliente} · ${c.etapa}${extra}\n  ${c.enlace}`;

/** El WhatsApp de una asesora en esta vuelta, o null si no tiene nada. */
export function textoParaAsesora(m: MensajeParaAsesora): string | null {
  const partes: string[] = [];
  if (m.esperando.length) {
    partes.push([`⏰ *Cliente esperando respuesta* (${m.esperando.length})`, ...m.esperando.map((c) => linea(c, ` · ${c.minutos} min esperando`))].join("\n"));
  }
  if (m.recibidos.length) {
    partes.push([`🔁 *Te pasaron ${m.recibidos.length === 1 ? "un chat" : `${m.recibidos.length} chats`}* (la otra asesora no respondió en ${m.minutosReasignacion} min)`, ...m.recibidos.map((c) => linea(c, ` · ${c.minutos} min esperando`))].join("\n"));
  }
  if (m.perdidos.length) {
    partes.push([`➡️ *Pasé a otra asesora ${m.perdidos.length === 1 ? "un chat tuyo" : `${m.perdidos.length} chats tuyos`}* (más de ${m.minutosReasignacion} min sin respuesta)`, ...m.perdidos.map((c) => linea(c, ` · ahora lo atiende ${c.aQuien}`))].join("\n"));
  }
  if (m.calientes.length) {
    partes.push([`🔥 *Caliente sin mensaje tuyo hace ${m.horasCaliente} h o más* (${m.calientes.length})`, ...m.calientes.map((c) => linea(c))].join("\n"));
  }
  return partes.length ? partes.join("\n\n") : null;
}

/* ------------------------------------------------------------------------------------------------
   EL REGISTRO: CONTEO DEL DÍA POR ASESORA
------------------------------------------------------------------------------------------------ */

export type FilaDeAviso = {
  tipo: string;
  asesoraId: string | null;
  asesoraNuevaId: string | null;
  whatsappEnviado: boolean;
  creadoEn: Date;
};

export type ConteoDeAsesora = {
  asesoraId: string;
  avisos: number;
  botPidioAsesora: number;
  caliente24h: number;
  /** Chats que ella dejó vencer y se le quitaron. */
  reasignadosDeEllas: number;
  /** Chats que recibió por reasignación. */
  recibidos: number;
};

/** Cuenta por asesora lo que quedó en el registro (para el resumen de las 7:30). */
export function conteoPorAsesora(filas: FilaDeAviso[]): ConteoDeAsesora[] {
  const mapa = new Map<string, ConteoDeAsesora>();
  const de = (id: string) => {
    let c = mapa.get(id);
    if (!c) {
      c = { asesoraId: id, avisos: 0, botPidioAsesora: 0, caliente24h: 0, reasignadosDeEllas: 0, recibidos: 0 };
      mapa.set(id, c);
    }
    return c;
  };
  for (const fila of filas) {
    if (fila.tipo === "REASIGNACION") {
      if (fila.asesoraId) de(fila.asesoraId).reasignadosDeEllas += 1;
      if (fila.asesoraNuevaId) de(fila.asesoraNuevaId).recibidos += 1;
      continue;
    }
    if (!fila.asesoraId) continue;
    if (fila.tipo === "AVISO") de(fila.asesoraId).avisos += 1;
    else if (fila.tipo === "BOT_PIDIO_ASESORA") de(fila.asesoraId).botPidioAsesora += 1;
    else if (fila.tipo === "CALIENTE_24H") de(fila.asesoraId).caliente24h += 1;
  }
  return [...mapa.values()].sort((a, b) => b.reasignadosDeEllas + b.avisos - (a.reasignadosDeEllas + a.avisos) || a.asesoraId.localeCompare(b.asesoraId));
}

/** El rango UTC de un día de Bogotá (AAAA-MM-DD), o null si la fecha no es válida. */
export function rangoDelDiaBogota(fecha: string): { desde: Date; hasta: Date } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
  const desde = new Date(`${fecha}T00:00:00.000-05:00`);
  if (Number.isNaN(desde.getTime())) return null;
  return { desde, hasta: new Date(desde.getTime() + DIA) };
}

/** La fecha de hoy en Bogotá (AAAA-MM-DD). */
export function fechaDeBogota(fecha: Date): string {
  return new Date(fecha.getTime() - BOGOTA).toISOString().slice(0, 10);
}
