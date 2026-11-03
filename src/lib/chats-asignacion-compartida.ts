// Chats con dos asesores: un chat tiene su asesor principal (assignedToUserId) y, si hace falta, un
// segundo asesor (segundoAsesorId). Los dos lo ven en "Mías". Un chat sin segundo asesor queda igual
// que siempre.
//
// Solo reglas y tipos: aquí no se toca la base ni nada de servidor, para poder probarlo solo.
import type { Prisma } from "@prisma/client";

/** Lo mínimo del chat que hace falta para saber de quién es. */
export type ChatConAsesores = {
  assignedToUserId: string | null;
  segundoAsesorId?: string | null;
};

/** Filtro de Prisma para "Mías": el chat es de la persona si es el principal o el segundo asesor. */
export function whereEsMio(userId: string): Prisma.ConversationWhereInput {
  return { OR: [{ assignedToUserId: userId }, { segundoAsesorId: userId }] };
}

/** Dice si el chat es de la persona (principal o segundo asesor). */
export function esDeQuien(chat: ChatConAsesores, userId: string): boolean {
  return chat.assignedToUserId === userId || (chat.segundoAsesorId ?? null) === userId;
}

/** Los asesores del chat: primero el principal y después el segundo, sin vacíos ni repetidos. */
export function asignadosDelChat(chat: ChatConAsesores): string[] {
  const asesores: string[] = [];
  for (const id of [chat.assignedToUserId, chat.segundoAsesorId]) {
    if (id && !asesores.includes(id)) asesores.push(id);
  }
  return asesores;
}
