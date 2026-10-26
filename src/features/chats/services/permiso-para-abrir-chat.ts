/**
 * ¿Esta persona puede ABRIR este chat? La regla, en un solo lugar y sin tocar la base.
 *
 * Nace de un hueco: abrir /cliente/chats?chatKey=agent:<id> cargaba el chat por su numero sin
 * preguntar nada mas. La lista de la izquierda aplica tres filtros (lineas visibles, "solo mis
 * chats" y las lineas que monitorea quien monitorea) y el chat abierto por enlace se saltaba los
 * tres: con el enlace, una asesora podia leer el chat de otra o el de una linea que no le toca.
 *
 * Aca se repite exactamente lo que hace la lista (ver page.tsx y /api/cliente/chats/list):
 *  - Una linea que la persona no ve cierra la puerta, sea quien sea (menos el dueño y los
 *    administradores, que la ven toda: `canalesVisibles` es null).
 *  - La supervisora ve cualquier chat de SUS lineas, tenga dueña o no.
 *  - Quien monitorea ve los chats de las lineas que monitorea (solo mirar: escribir ya esta
 *    apagado en otro lado).
 *  - La asesora comun solo ve los chats asignados a ella.
 *
 * Los chats de la API oficial no tienen canal propio: cuentan como chats de la linea oficial.
 */

export type EntradaPermisoParaAbrirChat = {
  /** De donde viene el chat: el canal de siempre o la API oficial. */
  origen: "agent" | "official";
  /**
   * La(s) linea(s) del chat. Un chat de WhatsApp tiene una (o ninguna). Uno oficial cuenta como de
   * la linea oficial: se pasan los canales OFFICIAL_API del negocio.
   */
  canalIds: string[];
  /** Quien atiende el chat hoy. null = sin asignar. */
  asignadoAUserId: string | null;
  /** Quien quiere abrirlo. */
  userId: string;
  /** Lineas visibles para esta persona, o null si ve todas (dueño y administradores). */
  canalesVisibles: string[] | null;
  /** Dueño, administrador o supervisora: ve el trabajo de todo el equipo. */
  esJefeOSupervisora: boolean;
  /** Lineas que esta persona solo mira. Vacio = no monitorea. */
  canalesMonitoreados: string[];
};

export function puedeAbrirChat(entrada: EntradaPermisoParaAbrirChat): boolean {
  const { origen, canalIds, canalesVisibles, canalesMonitoreados } = entrada;

  // Sin linea: un chat de WhatsApp sin canal no entra en la lista de nadie que tenga filtro de
  // lineas. Los oficiales sin linea registrada no tienen que filtrarse por ella.
  const sinLinea = canalIds.length === 0;

  if (canalesVisibles) {
    const laVe = origen === "official" && sinLinea ? true : canalIds.some((id) => canalesVisibles.includes(id));
    if (!laVe) return false;
  }

  if (entrada.esJefeOSupervisora) return true;

  // Quien monitorea queda dentro de SUS lineas (igual que la lista), tenga dueña el chat o no.
  if (canalesMonitoreados.length > 0) {
    return canalIds.some((id) => canalesMonitoreados.includes(id));
  }

  return entrada.asignadoAUserId !== null && entrada.asignadoAUserId === entrada.userId;
}
