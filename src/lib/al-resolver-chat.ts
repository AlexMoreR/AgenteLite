import { after } from "next/server";

import { efectosDelCambio } from "./chat-resuelto";

/**
 * Lo que pasa DESPUÉS de resolver o reabrir un chat (botón "Resolver", menú de la fila o una
 * automatización). Ver lib/chat-resuelto.ts.
 *
 * Al resolver:
 *  - se cancelan los seguimientos AUTOMÁTICOS pendientes del contacto (los de una persona no), con
 *    la misma regla que al pausar o pasar a Perdido, aunque "un solo dueño" esté apagado;
 *  - el motor del seguimiento inteligente vuelve a mirar el lead: con el chat resuelto decide "no
 *    insistir", y así la tarea de asesora sale de Mi día, del Supervisor y de Recuperación por la
 *    misma puerta por la que se cierra cualquier tarea (un SIGUIENTE_ACCION nuevo).
 * Al reabrir, el motor vuelve a decidir (la tarea vuelve si corresponde).
 *
 * En segundo plano: no demora la respuesta del botón. Nunca lanza. Imports dinámicos: el motor y
 * los seguimientos arrastran media app y esto lo usan las acciones de chats y las automatizaciones.
 */
export function alCambiarEstadoDelChat(input: {
  workspaceId: string;
  /** null = chat de la línea oficial (el motor de tareas no la mira: solo se cancelan los automáticos). */
  conversationId: string | null;
  contactId: string;
  anterior: string | null | undefined;
  nuevo: string;
}): void {
  const efectos = efectosDelCambio(input.anterior, input.nuevo);
  if (!efectos.cancelarAutomaticos && !efectos.revisarLead) return;

  const tarea = async () => {
    try {
      if (efectos.cancelarAutomaticos) {
        const { cancelarAutomaticosPendientesDelContacto } = await import("@/features/seguimientos/services/follows");
        await cancelarAutomaticosPendientesDelContacto({
          workspaceId: input.workspaceId,
          contactId: input.contactId,
          motivo: "chat_resuelto",
          aunqueEsteApagado: true,
        });
      }
      if (efectos.revisarLead && input.conversationId) {
        const { revisarLead } = await import("@/features/seguimiento-inteligente/servicios/motor");
        await revisarLead(input.conversationId);
      }
    } catch (error) {
      console.warn("[chat-resuelto] no se pudieron aplicar los efectos del cambio de estado", {
        conversationId: input.conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  try {
    after(tarea);
  } catch {
    void tarea();
  }
}
