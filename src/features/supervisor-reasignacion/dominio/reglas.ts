/**
 * SUPERVISOR DE REASIGNACIÓN (reglas puras, sin base de datos ni envíos).
 *
 * Pedido del dueño: cuando un chat asignado lleva 5 minutos sin respuesta de la asesora (el cliente
 * escribió último) se le avisa por WhatsApp; a los 30 se le pasa a otra asesora activa (la que tenga
 * menos chats esperando) y se avisa a las dos. Un Caliente que lleva 24 h sin mensaje de su asesora
 * también avisa. Todo cuenta solo dentro del horario laboral. Nunca se le escribe al cliente.
 *
 * Acá solo se DECIDE qué toca y se arman los textos; el servicio hace lo que cuesta (leer, anotar,
 * mover el chat, mandar). Así se prueba con un reloj simulado.
 */

export type HorarioLaboral = { desde: number; hasta: number; dias: number[] };

export type ConfigReasignacion = {
  /** Interruptor de los avisos por WhatsApp (5 min, Caliente 24 h, bot pidió asesora). */
  avisosActivo: boolean;
  /** Interruptor aparte de la reasignación automática. */
  reasignacionActiva: boolean;
  minutosAviso: number;
  minutosReasignacion: number;
  horasCaliente: number;
  horario: HorarioLaboral;
  /** Línea desde la que salen los avisos. Sin valor: la Admin del negocio. */
  canalId: string | null;
};

/** La línea Admin de Magilus (la usa el dueño para los avisos internos). */
export const CANAL_ADMIN_POR_DEFECTO = "cmt06kiob00lw2hk2mgllstsb";

/** Lunes a sábado, 8 a. m. a 6 p. m. (Bogotá), como el resto del Supervisor. */
export const HORARIO_LABORAL_POR_DEFECTO: HorarioLaboral = { desde: 8, hasta: 18, dias: [1, 2, 3, 4, 5, 6] };

/** Los dos interruptores nacen APAGADOS. */
export const CONFIG_REASIGNACION_POR_DEFECTO: ConfigReasignacion = {
  avisosActivo: false,
  reasignacionActiva: false,
  minutosAviso: 5,
  minutosReasignacion: 30,
  horasCaliente: 24,
  horario: HORARIO_LABORAL_POR_DEFECTO,
  canalId: null,
};

export const prefijoConfigReasignacion = "supervisor:reasignacion:";
export const claveConfigReasignacion = (workspaceId: string) => `${prefijoConfigReasignacion}${workspaceId}`;

function entero(valor: unknown, minimo: number, maximo: number, defecto: number): number {
  const n = typeof valor === "number" ? valor : typeof valor === "string" ? Number(valor) : NaN;
  if (!Number.isFinite(n)) return defecto;
  return Math.min(maximo, Math.max(minimo, Math.round(n)));
}

/** Lee el ajuste guardado. Texto roto o vacío = todo apagado y con los tiempos de siempre. */
export function leerConfigReasignacionDeTexto(texto: string | null | undefined): ConfigReasignacion {
  const base = CONFIG_REASIGNACION_POR_DEFECTO;
  if (!texto) return base;
  let crudo: Record<string, unknown>;
  try {
    const leido = JSON.parse(texto);
    if (!leido || typeof leido !== "object" || Array.isArray(leido)) return base;
    crudo = leido as Record<string, unknown>;
  } catch {
    return base;
  }
  const h = crudo.horario && typeof crudo.horario === "object" ? (crudo.horario as Record<string, unknown>) : {};
  let desde = entero(h.desde, 0, 23, base.horario.desde);
  let hasta = entero(h.hasta, 1, 24, base.horario.hasta);
  if (hasta <= desde) {
    desde = base.horario.desde;
    hasta = base.horario.hasta;
  }
  const dias = Array.isArray(h.dias)
    ? [...new Set(h.dias.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : base.horario.dias;
  const canal = typeof crudo.canalId === "string" ? crudo.canalId.trim() : "";
  return {
    avisosActivo: crudo.avisosActivo === true,
    reasignacionActiva: crudo.reasignacionActiva === true,
    minutosAviso: entero(crudo.minutosAviso, 1, 240, base.minutosAviso),
    minutosReasignacion: entero(crudo.minutosReasignacion, 1, 480, base.minutosReasignacion),
    horasCaliente: entero(crudo.horasCaliente, 1, 168, base.horasCaliente),
    horario: { desde, hasta, dias },
    canalId: canal || null,
  };
}

/* ------------------------------------------------------------------------------------------------
   HORARIO LABORAL (hora de Bogotá, sin horario de verano: el desfase es fijo)
------------------------------------------------------------------------------------------------ */

const MIN = 60_000;
const HORA = 3_600_000;
const DIA = 24 * HORA;
const DESFASE_BOGOTA = 5 * HORA;

export function enHorarioLaboral(fecha: Date, horario: HorarioLaboral): boolean {
  const local = new Date(fecha.getTime() - DESFASE_BOGOTA);
  return horario.dias.includes(local.getUTCDay()) && local.getUTCHours() >= horario.desde && local.getUTCHours() < horario.hasta;
}

/**
 * Minutos entre dos momentos contados SOLO dentro del horario laboral, exactos (por tramos de día,
 * no por bloques). Máximo 7 días hacia atrás.
 */
export function minutosLaboralesExactos(desde: Date, hasta: Date, horario: HorarioLaboral): number {
  const fin = Math.min(hasta.getTime(), desde.getTime() + 7 * DIA);
  const inicio = desde.getTime();
  if (fin <= inicio) return 0;
  let total = 0;
  const primerDia = Math.floor((inicio - DESFASE_BOGOTA) / DIA) * DIA;
  for (let dia = primerDia; dia + DESFASE_BOGOTA < fin; dia += DIA) {
    if (!horario.dias.includes(new Date(dia).getUTCDay())) continue;
    const abre = dia + horario.desde * HORA + DESFASE_BOGOTA;
    const cierra = dia + horario.hasta * HORA + DESFASE_BOGOTA;
    const tramo = Math.min(cierra, fin) - Math.max(abre, inicio);
    if (tramo > 0) total += tramo;
  }
  return Math.floor(total / MIN);
}

/* ------------------------------------------------------------------------------------------------
   LO QUE SE DECIDE
------------------------------------------------------------------------------------------------ */

export type TipoDeAviso = "AVISO" | "REASIGNACION" | "CALIENTE_24H" | "BOT_PIDIO_ASESORA" | "SIN_CANDIDATA";

/** Un chat tal como lo ve la decisión (el servicio ya sacó los cerrados, robots, del exterior y despedidas). */
export type ChatVigilado = {
  conversationId: string;
  numero: number | null;
  asesoraId: string | null;
  etapa: string | null;
  caliente: boolean;
  nombre: string | null;
  telefono: string | null;
  /** El cliente escribió último, ninguna persona le respondió y el último mensaje no es una despedida. */
  esperando: boolean;
  /** El bot pidió pasar a una asesora y nadie ha contestado. */
  botPidioAsesora: boolean;
  /** El primer mensaje del cliente que sigue sin respuesta de una persona. */
  primerPendienteEn: Date | null;
  /** Desde cuándo es de la asesora actual (nota "asignado"), si se sabe. */
  asignadaEn: Date | null;
  ultimaRespuestaHumanaEn: Date | null;
};

export type Decision =
  | { tipo: "AVISO" | "BOT_PIDIO_ASESORA"; chat: ChatVigilado; asesoraId: string; episodio: Date; minutos: number }
  | { tipo: "CALIENTE_24H"; chat: ChatVigilado; asesoraId: string; episodio: Date; minutos: number }
  | { tipo: "REASIGNACION"; chat: ChatVigilado; asesoraId: string; asesoraNuevaId: string; episodio: Date; minutos: number }
  | { tipo: "SIN_CANDIDATA"; chat: ChatVigilado; asesoraId: string; episodio: Date; minutos: number };

/** La llave de lo que ya se anotó: la misma combinación que es única en la base. */
export const llaveDeAviso = (conversationId: string, tipo: TipoDeAviso, episodio: Date) => `${conversationId}|${tipo}|${episodio.getTime()}`;

export function decidir(input: {
  chats: ChatVigilado[];
  ahora: Date;
  config: ConfigReasignacion;
  /** Asesoras que pueden recibir un chat (activas, en horario, sin pausa). */
  candidatas: string[];
  /** Llaves ya anotadas (ver `llaveDeAviso`). */
  registrados: Set<string>;
}): Decision[] {
  const { chats, ahora, config, registrados } = input;
  // Fuera de horario no avisa ni reasigna: el reloj arranca al abrir.
  if (!enHorarioLaboral(ahora, config.horario)) return [];

  // Cuántos chats esperando respuesta tiene cada asesora: la que menos tiene, recibe.
  const carga = new Map<string, number>();
  for (const id of input.candidatas) carga.set(id, 0);
  for (const chat of chats) {
    if (chat.esperando && chat.asesoraId && carga.has(chat.asesoraId)) carga.set(chat.asesoraId, (carga.get(chat.asesoraId) ?? 0) + 1);
  }

  const decisiones: Decision[] = [];
  const yaEsta = (chat: ChatVigilado, tipo: TipoDeAviso, episodio: Date) => registrados.has(llaveDeAviso(chat.conversationId, tipo, episodio));

  const esperando = chats
    .filter((c) => c.asesoraId && c.esperando && c.primerPendienteEn)
    .map((chat) => {
      // El reloj arranca cuando el cliente escribió o cuando el chat llegó a la asesora, lo que sea más tarde:
      // un chat que le pasan ya viejo no se le cobra a quien acaba de recibirlo.
      const inicio = new Date(Math.max((chat.primerPendienteEn as Date).getTime(), chat.asignadaEn?.getTime() ?? 0));
      return { chat, inicio, minutos: minutosLaboralesExactos(inicio, ahora, config.horario) };
    })
    .sort((a, b) => b.minutos - a.minutos);

  for (const { chat, inicio, minutos } of esperando) {
    const asesoraId = chat.asesoraId as string;
    const pendiente = chat.primerPendienteEn as Date;
    if (config.reasignacionActiva && minutos >= config.minutosReasignacion) {
      if (yaEsta(chat, "REASIGNACION", pendiente) || yaEsta(chat, "SIN_CANDIDATA", pendiente)) continue;
      const elegida = [...carga.entries()]
        .filter(([id]) => id !== asesoraId)
        .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))[0];
      if (!elegida) {
        decisiones.push({ tipo: "SIN_CANDIDATA", chat, asesoraId, episodio: pendiente, minutos });
        continue;
      }
      carga.set(elegida[0], elegida[1] + 1);
      carga.set(asesoraId, Math.max(0, (carga.get(asesoraId) ?? 1) - 1));
      decisiones.push({ tipo: "REASIGNACION", chat, asesoraId, asesoraNuevaId: elegida[0], episodio: pendiente, minutos });
      continue;
    }
    if (config.avisosActivo && minutos >= config.minutosAviso) {
      const tipo = chat.botPidioAsesora ? "BOT_PIDIO_ASESORA" : "AVISO";
      // Un mismo mensaje del cliente no se avisa dos veces aunque cambie el tipo.
      if (yaEsta(chat, "AVISO", inicio) || yaEsta(chat, "BOT_PIDIO_ASESORA", inicio)) continue;
      decisiones.push({ tipo, chat, asesoraId, episodio: inicio, minutos });
    }
  }

  if (config.avisosActivo) {
    for (const chat of chats) {
      if (!chat.caliente || !chat.asesoraId) continue;
      const referencia = chat.ultimaRespuestaHumanaEn ?? chat.asignadaEn;
      if (!referencia) continue;
      const horas = (ahora.getTime() - referencia.getTime()) / HORA;
      if (horas < config.horasCaliente || yaEsta(chat, "CALIENTE_24H", referencia)) continue;
      decisiones.push({ tipo: "CALIENTE_24H", chat, asesoraId: chat.asesoraId, episodio: referencia, minutos: Math.floor(horas * 60) });
    }
  }
  return decisiones;
}

/* ------------------------------------------------------------------------------------------------
   TEXTOS (cortos; al cliente nunca se le manda nada)
------------------------------------------------------------------------------------------------ */

export const DOMINIO_APP = "https://app.aizenbot.com";

const ETAPAS: Record<string, string> = {
  NUEVO: "Nuevo",
  CALIFICADO: "Calificado",
  PROPUESTA: "Propuesta",
  NEGOCIACION: "Caliente",
  GANADO: "Ganado",
  PERDIDO: "Perdido",
};

export function etapaLegible(etapa: string | null): string {
  return (etapa && ETAPAS[etapa]) || "Sin etapa";
}

/** El nombre del cliente o, si no tiene, su teléfono tapado ("•••• 4567"). */
export function clienteLegible(chat: Pick<ChatVigilado, "nombre" | "telefono">): string {
  const nombre = chat.nombre?.trim();
  if (nombre && !/^\+?[\d\s()-]{7,}$/.test(nombre)) return nombre;
  const digitos = (chat.telefono ?? nombre ?? "").replace(/\D/g, "");
  return digitos.length >= 4 ? `•••• ${digitos.slice(-4)}` : "Cliente sin nombre";
}

export function enlaceDelChat(chat: Pick<ChatVigilado, "numero" | "conversationId">): string {
  return chat.numero ? `${DOMINIO_APP}/c/${chat.numero}` : `${DOMINIO_APP}/cliente/chats?chatKey=${encodeURIComponent(`agent:${chat.conversationId}`)}&assigned=all`;
}

function duracion(minutos: number): string {
  if (minutos < 120) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  return horas < 48 ? `${horas} h` : `${Math.floor(horas / 24)} días`;
}

const TOPE_POR_MENSAJE = 5;

/** UN mensaje por asesora y vuelta, aunque tenga varios chats. */
export function textoDeAvisos(items: Array<Pick<Decision, "tipo" | "chat" | "minutos">>): string {
  const linea = (d: Pick<Decision, "tipo" | "chat" | "minutos">) => {
    const esCaliente = d.tipo === "CALIENTE_24H";
    return [
      `👤 ${clienteLegible(d.chat)} · ${etapaLegible(d.chat.etapa)}`,
      esCaliente ? `🔥 ${duracion(d.minutos)} sin mensaje tuyo` : `⏱ ${duracion(d.minutos)} esperando respuesta${d.tipo === "BOT_PIDIO_ASESORA" ? " (el bot pidió una asesora)" : ""}`,
      `🔗 ${enlaceDelChat(d.chat)}`,
    ].join("\n");
  };
  if (items.length === 1) return [items[0].tipo === "CALIENTE_24H" ? "🔥 Cliente Caliente sin atender" : "⏰ Cliente esperando respuesta", linea(items[0])].join("\n");
  const visibles = items.slice(0, TOPE_POR_MENSAJE);
  const resto = items.length - visibles.length;
  return [`⏰ ${items.length} clientes esperando`, ...visibles.map(linea), ...(resto > 0 ? [`… y ${resto} más en el CRM`] : [])].join("\n\n");
}

export function textoReasignacionNueva(d: { chat: ChatVigilado; minutos: number }, anterior: string): string {
  return [
    "📥 Te pasaron un chat",
    `👤 ${clienteLegible(d.chat)} · ${etapaLegible(d.chat.etapa)}`,
    `${anterior} no respondió en ${duracion(d.minutos)}: ahora es tuyo.`,
    `🔗 ${enlaceDelChat(d.chat)}`,
  ].join("\n");
}

export function textoReasignacionAnterior(d: { chat: ChatVigilado; minutos: number }, nueva: string): string {
  return [
    "↪️ Se te quitó un chat",
    `👤 ${clienteLegible(d.chat)} · ${etapaLegible(d.chat.etapa)}`,
    `Pasaron ${duracion(d.minutos)} sin respuesta y se le pasó a ${nueva}.`,
  ].join("\n");
}

/* ------------------------------------------------------------------------------------------------
   CONTEO DEL DÍA POR ASESORA (para la pantalla y el resumen de las 7:30)
------------------------------------------------------------------------------------------------ */

export type FilaDeAviso = { tipo: string; asesoraId: string | null; asesoraNuevaId: string | null; whatsappEnviado?: boolean };

export type ConteoDeAsesora = {
  asesoraId: string;
  avisos: number;
  calientes: number;
  botPidioAsesora: number;
  chatsPerdidos: number;
  chatsRecibidos: number;
  sinCandidata: number;
};

export function conteoPorAsesora(filas: FilaDeAviso[]): ConteoDeAsesora[] {
  const mapa = new Map<string, ConteoDeAsesora>();
  const de = (id: string) => {
    let c = mapa.get(id);
    if (!c) {
      c = { asesoraId: id, avisos: 0, calientes: 0, botPidioAsesora: 0, chatsPerdidos: 0, chatsRecibidos: 0, sinCandidata: 0 };
      mapa.set(id, c);
    }
    return c;
  };
  for (const f of filas) {
    if (f.tipo === "REASIGNACION") {
      if (f.asesoraId) de(f.asesoraId).chatsPerdidos += 1;
      if (f.asesoraNuevaId) de(f.asesoraNuevaId).chatsRecibidos += 1;
      continue;
    }
    if (!f.asesoraId) continue;
    const c = de(f.asesoraId);
    if (f.tipo === "AVISO") c.avisos += 1;
    else if (f.tipo === "CALIENTE_24H") c.calientes += 1;
    else if (f.tipo === "BOT_PIDIO_ASESORA") c.botPidioAsesora += 1;
    else if (f.tipo === "SIN_CANDIDATA") c.sinCandidata += 1;
  }
  return [...mapa.values()].sort((a, b) => a.asesoraId.localeCompare(b.asesoraId));
}

/* ------------------------------------------------------------------------------------------------
   DÍAS DE BOGOTÁ (para el registro y el conteo)
------------------------------------------------------------------------------------------------ */

/** "2026-10-27" en hora de Colombia. */
export function fechaDeBogota(fecha: Date): string {
  return new Date(fecha.getTime() - DESFASE_BOGOTA).toISOString().slice(0, 10);
}

/** El día entero "AAAA-MM-DD" de Colombia como rango UTC [desde, hasta). Null si la fecha no existe. */
export function rangoDelDiaBogota(fecha: string): { desde: Date; hasta: Date } | null {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha.trim());
  if (!partes) return null;
  const [anio, mes, dia] = partes.slice(1).map(Number);
  const inicio = new Date(Date.UTC(anio, mes - 1, dia));
  if (inicio.getUTCFullYear() !== anio || inicio.getUTCMonth() !== mes - 1 || inicio.getUTCDate() !== dia) return null;
  const desde = new Date(inicio.getTime() + DESFASE_BOGOTA);
  return { desde, hasta: new Date(desde.getTime() + DIA) };
}
