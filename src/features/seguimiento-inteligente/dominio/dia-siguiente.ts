/**
 * EL "DÍA SIGUIENTE" QUE SE RE-ARMA (código puro). Decisión de Alexander, 13-10-2026.
 *
 * Hoy el seguimiento de día 1 del paso del Playbook (ProductStageFollowUp, "Etapa <paso> · N") se
 * agenda UNA vez, al entrar al paso; si el cliente escribe se cancela y no vuelve. Con
 * `diaSiguiente.rearmar` (seguimiento-inteligente:config) se arma en CADA silencio:
 *
 *   cliente escribe → respondemos (bot o asesora) → cliente se calla
 *   ⇒ queda UN Follow "Etapa <paso> · día siguiente" del PASO DE ESE MOMENTO, para 24 h (el plazo
 *     del seguimiento ≥ 24 h del paso) después de nuestra ÚLTIMA respuesta.
 *   Si el cliente vuelve a escribir, el webhook lo cancela (cancelar_si_escribe) y se re-arma tras
 *   nuestra siguiente respuesta. Si respondemos otra vez antes de que salga, se corre (se cancela el
 *   viejo y queda uno nuevo).
 *
 * "Nuestra respuesta" = un mensaje nuestro que NO es un automático (seguimiento del V3, Follow,
 * reactivación): el recordatorio de 15 min / 1 h no corre el reloj del día siguiente.
 *
 * Quién manda en cada silencio (no se duplica):
 *  - Chat PAUSADO (escribió la asesora, o lo pausaron a mano) → no se arma, y el que hubiera se
 *    cancela al enviar. Ese silencio es de "Tras asesora" (1 h / 24 h) o de nadie.
 *  - Hay un "Tras asesora: …" PENDIENTE, o ya se agendó uno después de nuestra última respuesta →
 *    no se arma (ese silencio ya tiene su toque de día siguiente).
 *  - Hay OTRO Follow pendiente que no es de etapa (lo agendó una asesora, una regla, el motor
 *    inteligente, una campaña) → no se arma (como hoy: no se apilan).
 *  - Chat que el V3 nunca atendió (del equipo, avisos del Supervisor), línea ADMIN, etapa GANADO o
 *    PERDIDO → no se arma.
 * Lo demás (horario 8–20, tope 3 contando desde la persona, espaciado, un solo dueño, texto
 * vigente, convivencia del seguimiento inteligente con sus excepciones, turno, exterior, freno de
 * dos seguidos) lo pone el motor de seguimientos AL ENVIAR, como a cualquier "Etapa …".
 */

const MIN = 60_000;

export const SUFIJO_DIA_SIGUIENTE = " · día siguiente";
export const PREFIJO_TRAS_ASESORA = "Tras asesora: ";

/** Los que no cuentan como "nuestra respuesta" (mismos que el freno de automáticos). */
export const ORIGENES_QUE_NO_RESPONDEN = ["agente-v3-seguimiento", "agente-v3-seguimiento-ia", "follow", "automation_reactivation"];

/** Un seguimiento armado a esta distancia de la hora correcta, con el mismo texto, se deja como está. */
export const TOLERANCIA_MS = 15 * MIN;

const MINUTOS_POR_UNIDAD: Record<string, number> = { MINUTES: 1, HOURS: 60, DAYS: 1440 };

export function minutosDe(timeType: string, timeValue: number): number {
  return timeValue * (MINUTOS_POR_UNIDAD[String(timeType)] ?? 1);
}

export function nombreDelDiaSiguiente(etiquetaDelPaso: string): string {
  return `Etapa ${etiquetaDelPaso}${SUFIJO_DIA_SIGUIENTE}`;
}

export function esDiaSiguiente(nombre: string | null | undefined): boolean {
  const n = (nombre ?? "").trim();
  return n.startsWith("Etapa ") && n.endsWith(SUFIJO_DIA_SIGUIENTE);
}

export type SeguimientoDelPaso = {
  timeType: string;
  timeValue: number;
  content: string | null;
  flowId: string | null;
  cancelOnActivity: boolean;
};

export type SeguimientoDelDia1 = SeguimientoDelPaso & { minutos: number };

/**
 * El "día siguiente" de un paso: el primer seguimiento activo (en el orden del Playbook) que espera
 * al menos `desdeMinutos` (24 h) y tiene texto o flujo. null = el paso no tiene.
 */
export function elegirSeguimientoDelDia1(seguimientos: SeguimientoDelPaso[], desdeMinutos = 24 * 60): SeguimientoDelDia1 | null {
  for (const s of seguimientos) {
    const minutos = minutosDe(s.timeType, s.timeValue);
    if (s.timeValue > 0 && minutos >= desdeMinutos && ((s.content ?? "").trim() || (s.flowId ?? "").trim())) {
      return { ...s, minutos };
    }
  }
  return null;
}

/** El texto con el que queda guardado el Follow (igual que agendarSeguimientoDeEtapa). */
export function contenidoDelFollow(s: Pick<SeguimientoDelPaso, "content" | "flowId">): string {
  return (s.flowId ?? "").trim() ? "Flujo del embudo" : (s.content ?? "").trim();
}

export type MensajeParaElAncla = { direccion: "IN" | "OUT"; origen: string | null; en: Date };

/**
 * Nuestra última respuesta del silencio actual. null si lo último es del cliente, si nunca escribió
 * o si después de su último mensaje no le respondimos (solo salieron automáticos).
 */
export function anclaDelSilencio(mensajes: MensajeParaElAncla[]): { ancla: Date | null; motivo: string } {
  const orden = [...mensajes].sort((a, b) => a.en.getTime() - b.en.getTime());
  const ultimo = orden[orden.length - 1];
  if (!ultimo) return { ancla: null, motivo: "sin_mensajes" };
  if (ultimo.direccion === "IN") return { ancla: null, motivo: "le_toca_a_magilus" };
  const ultimoCliente = [...orden].reverse().find((m) => m.direccion === "IN");
  if (!ultimoCliente) return { ancla: null, motivo: "nunca_escribio" };
  const respuesta = [...orden]
    .reverse()
    .find((m) => m.direccion === "OUT" && m.en.getTime() > ultimoCliente.en.getTime() && !ORIGENES_QUE_NO_RESPONDEN.includes(m.origen ?? ""));
  if (!respuesta) return { ancla: null, motivo: "sin_respuesta_nuestra" };
  return { ancla: respuesta.en, motivo: "ok" };
}

export type FollowConocido = {
  id: string;
  name: string | null;
  status: string;
  content: string | null;
  timeType: string;
  timeValue: number;
  executeAt: Date;
  createdAt: Date;
};

export type DecisionDiaSiguiente =
  | { accion: "nada"; motivo: string; cancelar: string[]; revisarEn: Date | null }
  | { accion: "mantener"; motivo: string; cancelar: string[]; followId: string }
  | { accion: "armar"; motivo: string; cancelar: string[]; executeAt: Date; seguimiento: SeguimientoDelDia1; ancla: Date };

export function decidirDiaSiguiente(input: {
  activo: boolean;
  esAdmin: boolean;
  v3Atendio: boolean;
  pausado: boolean;
  etapaCrm: string | null;
  mensajes: MensajeParaElAncla[];
  /** Paso y producto del V3 en este momento. */
  paso: string | null;
  productoId: string | null;
  /** El día 1 del paso actual (null = el paso no tiene). */
  seguimiento: SeguimientoDelDia1 | null;
  /** Follows del contacto: los PENDIENTES y los "Tras asesora" recientes (de cualquier estado). */
  follows: FollowConocido[];
  minutosDeCalma: number;
  ahora: Date;
}): DecisionDiaSiguiente {
  const { ahora } = input;
  const pendientes = input.follows.filter((f) => f.status === "PENDING");
  const nuestros = pendientes.filter((f) => esDiaSiguiente(f.name)).map((f) => f.id);
  const nada = (motivo: string, cancelar: string[] = [], revisarEn: Date | null = null): DecisionDiaSiguiente => ({
    accion: "nada",
    motivo,
    cancelar,
    revisarEn,
  });

  // Apagado: no se toca nada (ni lo armado antes: eso lo cancela el motor al enviar).
  if (!input.activo) return nada("apagado");
  if (input.esAdmin) return nada("linea_admin", nuestros);
  if (input.etapaCrm === "GANADO" || input.etapaCrm === "PERDIDO") return nada("etapa_cerrada", nuestros);
  if (input.pausado) return nada("chat_pausado", nuestros);
  if (!input.v3Atendio) return nada("chat_del_equipo", nuestros);

  const { ancla, motivo } = anclaDelSilencio(input.mensajes);
  // Le toca a Magilus o no hay respuesta nuestra: lo pendiente (si quedó, con cancelar_si_escribe
  // apagado) se deja como está: es la decisión del Playbook.
  if (!ancla) return nada(motivo);
  const calma = ancla.getTime() + input.minutosDeCalma * MIN;
  if (calma > ahora.getTime()) return nada("esperando_calma", [], new Date(calma));

  if (!input.paso || !input.productoId) return nada("sin_paso", nuestros);
  const s = input.seguimiento;
  if (!s) return nada("paso_sin_dia_1", nuestros);

  const executeAt = new Date(ancla.getTime() + s.minutos * MIN);
  // No se recupera hacia atrás: si ya pasó la hora, ese silencio se perdió (sin ráfagas al prender).
  if (executeAt.getTime() <= ahora.getTime()) return nada("ya_vencio");

  // "Tras asesora": si está pendiente, o ya se agendó en este silencio, ese día siguiente es suyo.
  const tras = input.follows.filter((f) => (f.name ?? "").startsWith(PREFIJO_TRAS_ASESORA));
  if (tras.some((f) => f.status === "PENDING")) return nada("tras_asesora_pendiente", nuestros);
  if (tras.some((f) => f.createdAt.getTime() > ancla.getTime())) return nada("tras_asesora_en_este_silencio", nuestros);

  // Otro Follow pendiente que no es de etapa: no se apila (como hoy).
  if (pendientes.some((f) => !(f.name ?? "").startsWith("Etapa "))) return nada("otro_pendiente", nuestros);

  // Los "día 1" pendientes: los nuestros y los de la entrada al paso con el mismo plazo.
  const delDia1 = pendientes.filter(
    (f) => esDiaSiguiente(f.name) || ((f.name ?? "").startsWith("Etapa ") && minutosDe(f.timeType, f.timeValue) === s.minutos),
  );
  const contenido = contenidoDelFollow(s);
  const bueno = delDia1.find(
    (f) => (f.content ?? "").trim() === contenido && Math.abs(f.executeAt.getTime() - executeAt.getTime()) <= TOLERANCIA_MS,
  );
  const cancelar = delDia1.filter((f) => f.id !== bueno?.id).map((f) => f.id);
  if (bueno) return { accion: "mantener", motivo: "ya_armado", cancelar, followId: bueno.id };
  return { accion: "armar", motivo: delDia1.length ? "rearmado" : "armado", cancelar, executeAt, seguimiento: s, ancla };
}

/**
 * Al ENVIAR un "· día siguiente" (además de todo el anti-bloqueo de siempre): por si cambió algo
 * entre que se armó y que vence. null = puede salir.
 */
export function frenoDelDiaSiguienteAlEnviar(input: {
  activo: boolean;
  pausado: boolean | null;
  etapaCrm: string | null;
  v3Atendio: boolean;
  /** Se agendó un "Tras asesora" después de armar este. */
  trasAsesoraDespues: boolean;
}): "seguimiento_apagado" | "chat_pausado" | "etapa_cerrada" | "chat_del_equipo" | "tras_asesora" | null {
  if (!input.activo) return "seguimiento_apagado";
  if (input.etapaCrm === "GANADO" || input.etapaCrm === "PERDIDO") return "etapa_cerrada";
  if (input.pausado) return "chat_pausado";
  if (!input.v3Atendio) return "chat_del_equipo";
  if (input.trasAsesoraDespues) return "tras_asesora";
  return null;
}
