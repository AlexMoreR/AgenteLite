/**
 * CHAT RESUELTO = SALE DEL CRM DE TRABAJO (Alex, 16-10-2026).
 *
 * "Resuelto" se guarda en `Conversation.status` (y `OfficialApiConversation.status` en la línea
 * oficial): el botón "Resolver" lo pasa a CLOSED y "Reabrir" a OPEN. ARCHIVED cuenta igual que
 * CLOSED. Mientras el chat está resuelto:
 *  - no sale en las listas de chats (salvo el filtro "Resueltas" y el buscador global);
 *  - no tiene tareas de asesora (Mi día, Supervisor, Recuperación, tope) ni seguimientos
 *    AUTOMÁTICOS pendientes (los que agendó una persona no se tocan, igual que al pausar);
 *  - no entra al Kanban de trabajo (las columnas Ganado / Descartado son historia y se quedan);
 *  - la etapa del CRM NO cambia: resolver no es ganar ni descartar.
 * Cuando el CLIENTE vuelve a escribir, el chat se reabre solo y vuelve a todo lo anterior.
 *
 * Las métricas de la semana (Embudo semanal, "Semana" de Recuperación) son historia: siguen
 * contando los chats resueltos.
 *
 * Código puro, sin imports: lo prueba scripts/check-resuelto.mjs (npm run test:resuelto).
 */

export const ESTADOS_RESUELTOS = ["CLOSED", "ARCHIVED"] as const;
export const ESTADOS_ABIERTOS = ["OPEN", "PENDING"] as const;

/** ¿El chat está resuelto? Sin estado (null) se toma como abierto: así estaba antes. */
export function estaResuelto(estado: string | null | undefined): boolean {
  return (ESTADOS_RESUELTOS as readonly string[]).includes(String(estado ?? "").toUpperCase());
}

export type MensajeQueLlega = {
  /** INBOUND = lo escribió el cliente; OUTBOUND = lo mandamos nosotros (CRM, celular, bot, eco). */
  direccion: "INBOUND" | "OUTBOUND";
  /** Una edición o un borrado de un mensaje viejo no es "volvió a escribir". */
  editado?: boolean;
  borrado?: boolean;
};

/**
 * ¿Este mensaje reabre un chat resuelto? Solo uno NUEVO del cliente.
 *
 * Lo que mandamos nosotros no lo reabre: el eco de un mensaje que salió del CRM (o un automático)
 * llegaba segundos después de que la asesora lo resolvía y lo devolvía a la bandeja. Cuando una
 * asesora escribe DESDE EL CRM, la acción de enviar ya lo reabre por su cuenta.
 */
export function reabreAlLlegar(mensaje: MensajeQueLlega, estadoActual: string | null | undefined): boolean {
  if (!estaResuelto(estadoActual)) return false;
  if (mensaje.direccion !== "INBOUND") return false;
  if (mensaje.editado || mensaje.borrado) return false;
  return true;
}

/**
 * El estado que queda al llegar un mensaje: si lo reabre, OPEN; si no, el mismo de antes. Para un
 * chat abierto (o PENDING) nunca cambia nada.
 */
export function estadoAlLlegar<E extends string>(mensaje: MensajeQueLlega, estadoActual: E): E | "OPEN" {
  return reabreAlLlegar(mensaje, estadoActual) ? "OPEN" : estadoActual;
}

/**
 * Qué seguimientos (Follow) se cancelan al resolver (y al pausar o pasar a Perdido, la misma
 * regla): los PENDIENTES y AUTOMÁTICOS ("Etapa …", "Sin
 * responder…", reglas, "Inteligente: …", "Tras asesora: …"), la misma convención que al pausar el
 * chat o pasarlo a Perdido. Los que agendó una persona, las campañas, las automatizaciones y la
 * reactivación se quedan. `clase` = clasificarFollow (lib/anti-bloqueo/reglas.ts).
 */
export function esAutomaticoPendiente(follow: { status: string; clase: string }): boolean {
  return follow.status === "PENDING" && follow.clase === "automatico";
}

export const ETAPAS_DE_HISTORIA = ["GANADO", "PERDIDO"] as const;

/**
 * ¿Sale del Kanban? Solo los resueltos que siguen en una etapa de trabajo (Nuevo … Negociación).
 * Ganado y Descartado son el resultado del lead: un ganado que se resolvió sigue en su columna.
 */
export function saleDelKanban(input: { etapa: string | null | undefined; estadoDelChat: string | null | undefined }): boolean {
  if (!estaResuelto(input.estadoDelChat)) return false;
  return !(ETAPAS_DE_HISTORIA as readonly string[]).includes(String(input.etapa ?? "NUEVO").toUpperCase());
}

/** Lo que hay que hacer al cambiar el estado del chat (botón, menú de la fila o automatización). */
export type EfectosDelCambio = {
  /** Cancelar los seguimientos automáticos pendientes del contacto. */
  cancelarAutomaticos: boolean;
  /** Volver a mirar el lead con el motor: la tarea de asesora se cierra (o vuelve, al reabrir). */
  revisarLead: boolean;
};

export function efectosDelCambio(anterior: string | null | undefined, nuevo: string | null | undefined): EfectosDelCambio {
  const antes = estaResuelto(anterior);
  const despues = estaResuelto(nuevo);
  if (antes === despues) return { cancelarAutomaticos: false, revisarLead: false };
  // Al resolver: fuera los automáticos y la tarea. Al reabrir: el motor decide de nuevo (los
  // automáticos cancelados no vuelven; el motor agenda lo que corresponda).
  return { cancelarAutomaticos: despues, revisarLead: true };
}
