import { turnoDeLaConversacion } from "@/lib/turno-de-la-conversacion";

import {
  HORARIO_POR_DEFECTO,
  enHorario,
  esCaliente,
  estadoDeEspera,
  type ChatAbierto,
  type HorarioLaboral,
} from "@/features/supervisor/dominio/detectores-atencion";
import { motivoDeExclusion } from "@/features/supervisor/dominio/exclusiones";

/**
 * EL VIGILANTE DE REASIGNACIÓN (reglas puras, sin base ni red). El servicio está en
 * ../servicios/vigilante.ts.
 *
 * Qué decide, cada minuto y SOLO en horario laboral:
 *  - AVISO: el cliente escribió último y la asesora lleva `avisoMin` minutos laborales sin contestar.
 *  - BOT_PIDIO_ASESORA: lo mismo, pero el bot ya había pedido pasar con una asesora.
 *  - REASIGNACION: a los `reasignarMin` minutos el chat pasa a la asesora activa con menos chats
 *    esperando (el cliente es de quien lo atiende). Una sola vez por cada mensaje del cliente.
 *  - SIN_CANDIDATA: había que reasignar y no hay otra asesora disponible (se le avisa al dueño).
 *  - ESCALADA_DUENO: ya se reasignó y la nueva tampoco contestó en `reasignarMin` minutos.
 *  - CALIENTE_24H: un chat Caliente lleva `calienteHoras` horas sin mensaje de su asesora.
 *
 * Nunca decide mandarle nada al cliente: todo va al equipo.
 */

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;
/** Bogotá no tiene horario de verano: siempre UTC-5. */
const DESFASE_BOGOTA = 5 * HORA;

/** La línea Admin del negocio (la de los avisos internos). */
export const CANAL_ADMIN_POR_DEFECTO = "cmt06kiob00lw2hk2mgllstsb";

export const DOMINIO = "https://app.aizenbot.com";

export type TipoDeAviso = "AVISO" | "BOT_PIDIO_ASESORA" | "CALIENTE_24H" | "REASIGNACION" | "SIN_CANDIDATA" | "ESCALADA_DUENO";

export type ConfigReasignacion = {
  /** Interruptor de los avisos por WhatsApp (AVISO, BOT_PIDIO_ASESORA, CALIENTE_24H). */
  avisosActivo: boolean;
  /** Interruptor de la reasignación (y de los avisos que la acompañan). */
  reasignacionActiva: boolean;
  avisoMin: number;
  reasignarMin: number;
  calienteHoras: number;
  horario: HorarioLaboral;
  /** Línea desde la que salen los avisos. Tiene que ser administrativa. */
  canalId: string;
};

export const CONFIG_REASIGNACION_POR_DEFECTO: ConfigReasignacion = {
  avisosActivo: false,
  reasignacionActiva: false,
  avisoMin: 5,
  reasignarMin: 30,
  calienteHoras: 24,
  horario: HORARIO_POR_DEFECTO,
  canalId: CANAL_ADMIN_POR_DEFECTO,
};

export const claveConfigReasignacion = (workspaceId: string) => `supervisor:reasignacion:${workspaceId}`;
export const PREFIJO_CONFIG_REASIGNACION = "supervisor:reasignacion:";

function numeroEnRango(valor: unknown, porDefecto: number, min: number, max: number): number {
  const n = typeof valor === "number" ? valor : typeof valor === "string" && valor.trim() ? Number(valor) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : porDefecto;
}

/** Lee el JSON guardado. Cualquier cosa rara vuelve al valor por defecto, que tiene los dos interruptores APAGADOS. */
export function leerConfigReasignacionDeTexto(texto: string | null | undefined): ConfigReasignacion {
  const base = CONFIG_REASIGNACION_POR_DEFECTO;
  if (!texto) return base;
  let crudo: Record<string, unknown>;
  try {
    const leido = JSON.parse(texto) as unknown;
    if (!leido || typeof leido !== "object" || Array.isArray(leido)) return base;
    crudo = leido as Record<string, unknown>;
  } catch {
    return base;
  }
  const h = crudo.horario && typeof crudo.horario === "object" ? (crudo.horario as Record<string, unknown>) : {};
  const dias = Array.isArray(h.dias) ? [...new Set(h.dias.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : base.horario.dias;
  const desde = numeroEnRango(h.desde, base.horario.desde, 0, 23);
  const hasta = numeroEnRango(h.hasta, base.horario.hasta, 1, 24);
  return {
    avisosActivo: crudo.avisosActivo === true,
    reasignacionActiva: crudo.reasignacionActiva === true,
    avisoMin: numeroEnRango(crudo.avisoMin, base.avisoMin, 1, 600),
    reasignarMin: numeroEnRango(crudo.reasignarMin, base.reasignarMin, 1, 1440),
    calienteHoras: numeroEnRango(crudo.calienteHoras, base.calienteHoras, 1, 168),
    horario: hasta > desde && dias.length ? { desde, hasta, dias } : base.horario,
    canalId: typeof crudo.canalId === "string" && crudo.canalId.trim() ? crudo.canalId.trim() : base.canalId,
  };
}

/* ------------------------------------------------------------------------------------------------
   TIEMPO LABORAL (al minuto: los umbrales son de 5 minutos y el del Supervisor viejo va de a 15)
------------------------------------------------------------------------------------------------ */

/** Minutos entre dos fechas contados SOLO dentro del horario laboral (hora de Bogotá, máximo 7 días). */
export function minutosLaboralesExactos(desde: Date, hasta: Date, horario: HorarioLaboral): number {
  const ini = desde.getTime();
  const fin = Math.min(hasta.getTime(), ini + 7 * DIA);
  if (fin <= ini) return 0;
  let total = 0;
  // `d` es la medianoche de Bogotá de cada día, expresada como "reloj de pared" (UTC corrido).
  for (let d = Math.floor((ini - DESFASE_BOGOTA) / DIA) * DIA; d + DESFASE_BOGOTA < fin; d += DIA) {
    if (!horario.dias.includes(new Date(d).getUTCDay())) continue;
    const abre = d + horario.desde * HORA + DESFASE_BOGOTA;
    const cierra = d + horario.hasta * HORA + DESFASE_BOGOTA;
    total += Math.max(0, Math.min(cierra, fin) - Math.max(abre, ini));
  }
  return Math.floor(total / MIN);
}

/* ------------------------------------------------------------------------------------------------
   DECISIONES
------------------------------------------------------------------------------------------------ */

/** Lo que ya está anotado en SupervisorAviso: clave `conversationId|tipo|episodioISO` → cuándo se anotó. */
export type Anotados = Map<string, Date>;
export const claveDeAviso = (conversationId: string, tipo: TipoDeAviso, episodio: Date) => `${conversationId}|${tipo}|${episodio.toISOString()}`;

export type Decision = {
  tipo: TipoDeAviso;
  chat: ChatAbierto;
  /** La asesora que tenía el chat (a quien se le avisa en AVISO / BOT / CALIENTE). */
  asesoraId: string;
  /** Solo en REASIGNACION: la que lo recibe. */
  asesoraNuevaId?: string;
  episodio: Date;
  /** Minutos laborales esperando (o, en CALIENTE_24H, las horas sin mensaje × 60). */
  minutos: number;
};

/** Pendientes = chats asignados a la asesora donde el cliente espera respuesta humana. */
export function esperaRespuesta(chat: ChatAbierto, ahora: Date, horario: HorarioLaboral): boolean {
  const motivo = motivoDeExclusion({ ...chat, textos: [...(chat.textosDelCliente ?? []), ...chat.textosPendientes] }, ahora);
  if (motivo !== null) return false;
  const estado = estadoDeEspera(chat, ahora, horario);
  return estado.esperando && !estado.cierre;
}

/** ¿El bot ya había pedido pasar con una asesora en este chat? (turno con motivo bot_pidio_asesora) */
export function botPidioAsesora(chat: ChatAbierto): boolean {
  if (!chat.mensajes?.length) return false;
  try {
    const turno = turnoDeLaConversacion(chat.mensajes, {
      caliente: esCaliente(chat),
      asignada: Boolean(chat.asesoraId),
      tuvoContactoHumano: Boolean(chat.ultimaRespuestaHumanaEn),
    });
    return turno.motivo === "bot_pidio_asesora";
  } catch {
    return false;
  }
}

/** La candidata con menos chats esperando (desempata por menos chats totales y luego por id). */
export function elegirCandidata(input: {
  candidatas: string[];
  excluir: string;
  pendientes: Map<string, number>;
  totales: Map<string, number>;
}): string | null {
  const lista = input.candidatas.filter((id) => id !== input.excluir);
  if (!lista.length) return null;
  return (
    [...lista].sort(
      (a, b) =>
        (input.pendientes.get(a) ?? 0) - (input.pendientes.get(b) ?? 0) ||
        (input.totales.get(a) ?? 0) - (input.totales.get(b) ?? 0) ||
        a.localeCompare(b),
    )[0] ?? null
  );
}

export function decidir(input: {
  chats: ChatAbierto[];
  ahora: Date;
  config: ConfigReasignacion;
  anotados: Anotados;
  /** Las asesoras que pueden recibir ESE chat (activas, en horario, sin pausa). */
  candidatasDe: (chat: ChatAbierto) => string[];
}): Decision[] {
  const { ahora, config, anotados } = input;
  // Fuera de horario no avisa ni reasigna: el reloj de espera solo corre dentro del horario.
  if (!enHorario(ahora, config.horario)) return [];
  if (!config.avisosActivo && !config.reasignacionActiva) return [];

  const asignados = input.chats.filter((c) => c.asesoraId);
  const pendientes = new Map<string, number>();
  const totales = new Map<string, number>();
  const esperando = new Set<string>();
  for (const chat of asignados) {
    totales.set(chat.asesoraId as string, (totales.get(chat.asesoraId as string) ?? 0) + 1);
    if (esperaRespuesta(chat, ahora, config.horario)) {
      esperando.add(chat.conversationId);
      pendientes.set(chat.asesoraId as string, (pendientes.get(chat.asesoraId as string) ?? 0) + 1);
    }
  }

  const salida: Decision[] = [];
  const masViejoPrimero = [...asignados].sort(
    (a, b) => (a.ultimoClienteEn?.getTime() ?? 0) - (b.ultimoClienteEn?.getTime() ?? 0) || a.conversationId.localeCompare(b.conversationId),
  );

  for (const chat of masViejoPrimero) {
    const asesoraId = chat.asesoraId as string;
    if (esperando.has(chat.conversationId) && chat.ultimoClienteEn) {
      const episodio = chat.ultimoClienteEn;
      const minutos = minutosLaboralesExactos(episodio, ahora, config.horario);
      const clave = (tipo: TipoDeAviso) => claveDeAviso(chat.conversationId, tipo, episodio);
      const reasignadoEn = anotados.get(clave("REASIGNACION"));
      let reasignadoAhora = false;

      if (config.reasignacionActiva) {
        if (!reasignadoEn && minutos >= config.reasignarMin) {
          const nueva = elegirCandidata({ candidatas: input.candidatasDe(chat), excluir: asesoraId, pendientes, totales });
          if (nueva) {
            salida.push({ tipo: "REASIGNACION", chat, asesoraId, asesoraNuevaId: nueva, episodio, minutos });
            pendientes.set(asesoraId, Math.max(0, (pendientes.get(asesoraId) ?? 1) - 1));
            pendientes.set(nueva, (pendientes.get(nueva) ?? 0) + 1);
            totales.set(nueva, (totales.get(nueva) ?? 0) + 1);
            reasignadoAhora = true;
          } else if (!anotados.has(clave("SIN_CANDIDATA"))) {
            salida.push({ tipo: "SIN_CANDIDATA", chat, asesoraId, episodio, minutos });
          }
        } else if (reasignadoEn && !anotados.has(clave("ESCALADA_DUENO"))) {
          // Ya se pasó una vez por este mensaje: si la nueva tampoco contesta, no se vuelve a pasar; se avisa al dueño.
          if (minutosLaboralesExactos(reasignadoEn, ahora, config.horario) >= config.reasignarMin) {
            salida.push({ tipo: "ESCALADA_DUENO", chat, asesoraId, episodio, minutos });
          }
        }
      }

      if (config.avisosActivo && !reasignadoAhora && !reasignadoEn && minutos >= config.avisoMin) {
        const yaAvisado = anotados.has(clave("AVISO")) || anotados.has(clave("BOT_PIDIO_ASESORA"));
        if (!yaAvisado) {
          salida.push({ tipo: botPidioAsesora(chat) ? "BOT_PIDIO_ASESORA" : "AVISO", chat, asesoraId, episodio, minutos });
        }
      }
    }

    // Caliente sin mensaje de la asesora en `calienteHoras`. Aquí SÍ cuenta el chat que ella ya contestó
    // (ya_respondio): lo que se vigila es que pase un día sin escribirle al cliente.
    if (config.avisosActivo && esCaliente(chat)) {
      const motivo = motivoDeExclusion({ ...chat, textos: [...(chat.textosDelCliente ?? []), ...chat.textosPendientes] }, ahora);
      const referencia = chat.ultimaRespuestaHumanaEn ?? chat.asignadaEn ?? chat.ultimoClienteEn;
      if ((motivo === null || motivo === "ya_respondio") && referencia) {
        const horas = (ahora.getTime() - referencia.getTime()) / HORA;
        if (horas >= config.calienteHoras && !anotados.has(claveDeAviso(chat.conversationId, "CALIENTE_24H", referencia))) {
          salida.push({ tipo: "CALIENTE_24H", chat, asesoraId, episodio: referencia, minutos: Math.floor(horas * 60) });
        }
      }
    }
  }
  return salida;
}

/* ------------------------------------------------------------------------------------------------
   TEXTOS (cortos, para la asesora)
------------------------------------------------------------------------------------------------ */

const ETAPAS: Record<string, string> = {
  NUEVO: "Nuevo",
  CALIFICADO: "Calificado",
  PROPUESTA: "Propuesta",
  NEGOCIACION: "Caliente",
  GANADO: "Ganado",
  PERDIDO: "Perdido",
};

export function etapaLegible(etapa: string | null | undefined): string {
  return (etapa && ETAPAS[etapa]) || "Sin etapa";
}

/** El nombre del cliente o, si no hay, el teléfono tapado (•••• 4567). */
export function nombreOTelefono(chat: Pick<ChatAbierto, "nombreCliente" | "telefono">): string {
  const nombre = (chat.nombreCliente ?? "").trim();
  if (nombre && /\p{L}/u.test(nombre)) return nombre.slice(0, 40);
  const digitos = (chat.telefono ?? "").replace(/\D/g, "");
  return digitos.length >= 4 ? `•••• ${digitos.slice(-4)}` : "Cliente";
}

export function enlaceDelChat(numero: number | null | undefined, conversationId: string): string {
  return numero ? `${DOMINIO}/c/${numero}` : `${DOMINIO}/cliente/chats?chatKey=${encodeURIComponent(`agent:${conversationId}`)}&assigned=all`;
}

function duracion(minutos: number): string {
  return minutos >= 120 ? `${Math.floor(minutos / 60)} h` : `${minutos} min`;
}

/** Una línea del mensaje, según el tipo. `otra` = la asesora anterior / la nueva (para REASIGNACION). */
export function lineaDeAviso(input: { tipo: TipoDeAviso; chat: ChatAbierto; minutos: number; enlace: string; otra?: string; paraLaAnterior?: boolean }): string {
  const quien = `${nombreOTelefono(input.chat)} · ${etapaLegible(input.chat.etapa)}`;
  switch (input.tipo) {
    case "AVISO":
      return `⏰ ${quien} · ${duracion(input.minutos)} esperando\n${input.enlace}`;
    case "BOT_PIDIO_ASESORA":
      return `🙋 El bot pidió una asesora: ${quien} · ${duracion(input.minutos)} esperando\n${input.enlace}`;
    case "CALIENTE_24H":
      return `🔥 Caliente sin mensaje tuyo hace ${Math.floor(input.minutos / 60)} h: ${quien}\n${input.enlace}`;
    case "REASIGNACION":
      return input.paraLaAnterior
        ? `↪️ Pasé a ${input.otra ?? "otra asesora"} el chat de ${quien}: llevaba ${duracion(input.minutos)} sin respuesta tuya.`
        : `📥 Te pasaron un chat: ${quien}${input.otra ? ` (era de ${input.otra})` : ""}, esperaba hace ${duracion(input.minutos)}. Contéstale ya.\n${input.enlace}`;
    case "SIN_CANDIDATA":
      return `⚠️ No hay otra asesora disponible para ${quien} (${duracion(input.minutos)} sin respuesta de ${input.otra ?? "su asesora"}).\n${input.enlace}`;
    case "ESCALADA_DUENO":
      return `⚠️ ${quien} sigue sin respuesta (${duracion(input.minutos)}) aunque ya se pasó a ${input.otra ?? "otra asesora"}.\n${input.enlace}`;
  }
}

/** Varias líneas de la misma persona en la misma vuelta van juntas en UN mensaje. */
export function armarMensaje(lineas: string[]): string {
  if (lineas.length <= 1) return lineas[0] ?? "";
  return `*Supervisor: ${lineas.length} avisos*\n\n${lineas.join("\n\n")}`;
}

/* ------------------------------------------------------------------------------------------------
   REGISTRO DEL DÍA (para la pantalla y para el resumen de las 7:30)
------------------------------------------------------------------------------------------------ */

export type FilaDeAviso = { tipo: string; asesoraId: string | null; asesoraNuevaId: string | null; whatsappEnviado: boolean };
export type ConteoDeAsesora = {
  asesoraId: string;
  avisos: number;
  reasignadosDeEllaA: number;
  recibidos: number;
  calientes24h: number;
  whatsappFallidos: number;
};

/** Cuántos avisos / reasignaciones tuvo cada asesora. Los tipos que son para el dueño no cuentan contra ella. */
export function conteoPorAsesora(filas: FilaDeAviso[]): ConteoDeAsesora[] {
  const mapa = new Map<string, ConteoDeAsesora>();
  const de = (id: string) => {
    let c = mapa.get(id);
    if (!c) {
      c = { asesoraId: id, avisos: 0, reasignadosDeEllaA: 0, recibidos: 0, calientes24h: 0, whatsappFallidos: 0 };
      mapa.set(id, c);
    }
    return c;
  };
  for (const f of filas) {
    if (f.tipo === "AVISO" || f.tipo === "BOT_PIDIO_ASESORA") {
      if (f.asesoraId) {
        de(f.asesoraId).avisos += 1;
        if (!f.whatsappEnviado) de(f.asesoraId).whatsappFallidos += 1;
      }
    } else if (f.tipo === "CALIENTE_24H") {
      if (f.asesoraId) {
        de(f.asesoraId).calientes24h += 1;
        if (!f.whatsappEnviado) de(f.asesoraId).whatsappFallidos += 1;
      }
    } else if (f.tipo === "REASIGNACION") {
      if (f.asesoraId) de(f.asesoraId).reasignadosDeEllaA += 1;
      if (f.asesoraNuevaId) de(f.asesoraNuevaId).recibidos += 1;
    }
  }
  return [...mapa.values()].sort((a, b) => b.reasignadosDeEllaA + b.avisos - (a.reasignadosDeEllaA + a.avisos) || a.asesoraId.localeCompare(b.asesoraId));
}

/** El día de Bogotá (YYYY-MM-DD) de una fecha. */
export function diaDeBogota(fecha: Date): string {
  return new Date(fecha.getTime() - DESFASE_BOGOTA).toISOString().slice(0, 10);
}

/** Inicio (UTC) del día de Bogotá `YYYY-MM-DD`. */
export function inicioDelDia(dia: string): Date {
  return new Date(Date.parse(`${dia}T00:00:00.000Z`) + DESFASE_BOGOTA);
}
