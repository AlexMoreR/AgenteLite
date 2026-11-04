import type { Prisma } from "@prisma/client";

// Un chat puede tener dos asesores: el principal (assignedToUserId) y el segundo (segundoAsesorId).
// Para los dos el chat es "Mío". Aquí está esa regla en un solo lugar, sin prisma ni nada de servidor,
// para que la usen la bandeja, los contadores y las pantallas por igual.

type ChatConAsesores = { assignedToUserId: string | null; segundoAsesorId?: string | null };

/** Filtro de Prisma para "Mías": el chat es de la persona si es el asesor principal o el segundo. */
export function whereEsMio(userId: string): Prisma.ConversationWhereInput {
  return { OR: [{ assignedToUserId: userId }, { segundoAsesorId: userId }] };
}

/** Verdadero si la persona es el asesor principal o el segundo del chat. */
export function esDeQuien(chat: ChatConAsesores, userId: string): boolean {
  return chat.assignedToUserId === userId || (chat.segundoAsesorId ?? null) === userId;
}

/** Los asesores del chat (principal primero), sin vacíos ni repetidos. */
export function asignadosDelChat(chat: ChatConAsesores): string[] {
  const ids = [chat.assignedToUserId, chat.segundoAsesorId ?? null].filter((id): id is string => Boolean(id));
  return [...new Set(ids)];
}

/**
 * Qué puede hacer la persona con el segundo asesor en la ficha del chat. Es lo mismo que comprueba
 * asignarSegundoAsesorAction: aquí solo sirve para no ofrecer un botón que el servidor va a rechazar.
 *
 * - Agregar: el jefe o el asesor principal, cuando el chat tiene principal y todavía no tiene segundo.
 * - Quitar: el jefe, el principal y el propio segundo asesor (que solo puede quitarse a sí mismo).
 */
export function queVeDelSegundoAsesor(input: {
  principalId: string | null;
  segundoId: string | null;
  usuarioId: string | null;
  esJefe: boolean;
}): { puedeAgregar: boolean; puedeQuitar: boolean } {
  const { principalId, segundoId, usuarioId, esJefe } = input;
  const esElPrincipal = Boolean(principalId && usuarioId && principalId === usuarioId);
  const esElSegundo = Boolean(segundoId && usuarioId && segundoId === usuarioId);
  return {
    puedeAgregar: Boolean(principalId) && !segundoId && (esJefe || esElPrincipal),
    puedeQuitar: Boolean(segundoId) && (esJefe || esElPrincipal || esElSegundo),
  };
}
