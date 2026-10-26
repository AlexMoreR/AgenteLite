/**
 * ¿Esta persona puede abrir este chat? (regla pura, sin base de datos)
 *
 * Abrir un chat con ?chatKey= (o pedirlo a /api/cliente/chats/live) se saltaba los filtros de la
 * lista: con un enlace, una asesora abria el chat de otra o el de una linea que no ve. Esta regla
 * es la MISMA de la lista, en un solo lugar:
 *  - Dueño y administradoras (`canalesVisibles === null`): todo.
 *  - Los demas: solo chats de una linea visible para ellos.
 *  - Quien monitorea (sin ser jefa): chats de las lineas que monitorea, sean de quien sean.
 *  - Supervisora: cualquier chat de sus lineas visibles.
 *  - Asesora comun: ademas, solo los chats asignados a ella.
 */
export type ReglaPermisoChat = {
  userId: string;
  /** Dueño o administradora: ve todo. */
  esDuenoOAdmin: boolean;
  /** Dueño, administradora o supervisora (ven "Todas"). */
  esJefe: boolean;
  /** Ids de linea visibles; null = ve todas. */
  canalesVisibles: string[] | null;
  /** Lineas que solo mira (modo monitoreo). Vacio = no monitorea. */
  canalesMonitoreados: string[];
};

export type DatosDelChat = {
  /** Linea del chat. Null = sin linea conocida. */
  channelId: string | null;
  assignedToUserId: string | null;
};

export function puedeAbrirChat(regla: ReglaPermisoChat, chat: DatosDelChat): boolean {
  if (regla.esDuenoOAdmin) {
    return true;
  }
  if (!chat.channelId) {
    return false;
  }
  if (regla.canalesVisibles && !regla.canalesVisibles.includes(chat.channelId)) {
    return false;
  }
  if (regla.canalesMonitoreados.length > 0 && !regla.esJefe) {
    return regla.canalesMonitoreados.includes(chat.channelId);
  }
  if (regla.esJefe) {
    return true;
  }
  return chat.assignedToUserId === regla.userId;
}
