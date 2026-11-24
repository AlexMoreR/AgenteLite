/*
  Motores viejos (24-nov-2026): el agente V1/V2 de una línea se puede PAUSAR sin borrarlo, y entonces sus
  seguimientos viejos ya no salen. Son los de su escalera "si no contesta" ("Sin responder …") y los de las
  reglas del diagrama del V2 (FollowRule con origen AGENT_NODE).

  NO son del V2 y siguen saliendo igual: los de los pasos del embudo ("Etapa …", que el V3 usa desde el
  día 1), los del V3 ("Inteligente: …", "Tras asesora: …") y los que agendó una asesora a mano.

  Solo funciones puras: las usan follows.ts (al enviar) y scripts/apagar-motores-viejos.mjs.
*/

/** El nombre con el que se agenda la escalera "si no contesta" del agente V1/V2 de la línea. */
export const PREFIJO_SIN_RESPONDER = "Sin responder";

/** La marca que deja el script en `executionError` al cancelar un seguimiento del V2 (así --volver sabe cuáles revivir). */
export const MARCA_CANCELADO_POR_MOTORES_VIEJOS = "motores-viejos: agente V2 en pausa";

/** La clave de AppSetting donde el script guarda cómo estaba todo antes de pausar. */
export const PREFIJO_RESPALDO_MOTORES_VIEJOS = "motores-viejos:respaldo:";

export function claveDelRespaldo(workspaceId: string): string {
  return `${PREFIJO_RESPALDO_MOTORES_VIEJOS}${workspaceId}`;
}

/** ¿Este seguimiento lo agendó el agente V1/V2 (y no el embudo, el V3 ni una asesora)? */
export function esSeguimientoDelV2(input: { nombre: string | null; reglaSourceType: string | null }): boolean {
  const nombre = (input.nombre ?? "").trim();
  if (nombre.startsWith(PREFIJO_SIN_RESPONDER)) return true;
  return input.reglaSourceType === "AGENT_NODE";
}

/** Pausado = como lo deja el botón de la pantalla Agentes (status PAUSED) o apagado (isActive false). */
export function agenteEnPausa(agente: { status: string; isActive: boolean } | null | undefined): boolean {
  if (!agente) return false;
  return agente.status === "PAUSED" || agente.isActive === false;
}

/** ¿Al agente le toca atender? Lo mismo que mira el webhook: prendido y en ACTIVE. */
export function agenteActivo(agente: { status: string; isActive: boolean }): boolean {
  return agente.isActive === true && agente.status === "ACTIVE";
}

/** ¿Esta línea la atiende el agente V3 (WhatsAppChannel.metadata.agenteV3 = true)? */
export function lineaConV3(metadata: unknown): boolean {
  return Boolean(metadata && typeof metadata === "object" && !Array.isArray(metadata) && (metadata as Record<string, unknown>).agenteV3 === true);
}
