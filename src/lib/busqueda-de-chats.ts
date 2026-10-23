import type { Prisma } from "@prisma/client";

/*
  LA BUSQUEDA DEL BUSCADOR DE CHATS (la caja "Buscar chats" de la bandeja), en el servidor.

  Nombre y numero son baratos: la tabla de contactos es chica y ya va filtrada por negocio. El texto
  de los mensajes NO: `content ILIKE '%algo%'` no puede usar ningun indice (no hay pg_trgm), asi que
  recorre los mensajes de todas las conversaciones candidatas en cada pedido. Para que no vuelva a
  tumbar la bandeja (19-10-2026, Fase 1 del plan del buscador):
   - en los mensajes se busca solo con 4 letras o mas (con menos, casi todo coincide igual), y
   - solo en los de los ultimos 90 dias, que usa el indice (conversationId, createdAt).

  La lista, los contadores y la pagina usan ESTA funcion: si cada una armara la suya, el numero de
  la pastilla terminaria contando otra cosa que la lista.
*/

export const LETRAS_PARA_BUSCAR_EN_MENSAJES = 4;
export const DIAS_DE_MENSAJES_EN_LA_BUSQUEDA = 90;

/**
 * Un numero escrito como se lee ("300 123-4567", "+57 (300) 123 4567") no aparece tal cual en el
 * telefono guardado, que va sin espacios. Si lo escrito es solo un numero con separadores y tiene 4
 * cifras o mas, se busca tambien con las cifras solas. Con letras no: "Pedro 2024" no es un telefono.
 */
export function cifrasDeLaBusqueda(q: string): string | null {
  const texto = q.trim();
  if (!/^[\d\s()+.-]+$/.test(texto)) return null;
  const cifras = texto.replace(/\D/g, "");
  return cifras.length >= 4 && cifras !== texto ? cifras : null;
}

/**
 * Las formas del numero que se buscan en el telefono guardado, ademas de lo escrito tal cual.
 * Si lo escrito es un celular de Colombia con el 57 delante (12 cifras), se busca tambien sin el
 * 57: hay telefonos guardados con las 10 cifras solas, y "573012175617" no esta dentro de
 * "3012175617". Al reves no hace falta: "3012175617" ya esta dentro de "573012175617".
 */
export function numerosDeLaBusqueda(q: string): string[] {
  const texto = q.trim();
  if (!/^[\d\s()+.-]+$/.test(texto)) return [];
  const cifras = texto.replace(/\D/g, "");
  const numeros = new Set<string>();
  if (cifras.length >= 4 && cifras !== texto) numeros.add(cifras);
  if (cifras.length === 12 && cifras.startsWith("57")) numeros.add(cifras.slice(2));
  return [...numeros];
}

export type FiltroDeEstado = "open" | "resolved" | "all";

/**
 * Con algo escrito en el buscador, el estado no filtra: se busca en abiertos, pendientes, cerrados
 * y archivados. El filtro "Todos" de la bandeja es el de la asesora, no el del estado, y el estado
 * se queda en "Abiertos" sin que se vea: sin esto, un chat cerrado o descartado no aparecia nunca al
 * buscarlo por numero (22-10-2026). Sin busqueda, el estado queda como venia.
 */
export function estadoParaLaBusqueda<T extends FiltroDeEstado>(statusFilter: T, rawQ: string): T | "all" {
  return rawQ.trim() ? "all" : statusFilter;
}

function desdeCuandoBuscarMensajes(ahora: Date): Date {
  return new Date(ahora.getTime() - DIAS_DE_MENSAJES_EN_LA_BUSQUEDA * 24 * 60 * 60 * 1000);
}

function filtroDeMensajes(q: string, ahora: Date) {
  return {
    some: {
      createdAt: { gte: desdeCuandoBuscarMensajes(ahora) },
      content: { contains: q, mode: "insensitive" as const },
    },
  };
}

/** Lo que agrega `q` a la consulta de conversaciones del canal viejo. Sin texto, nada. */
export function whereDeBusquedaDeChats(rawQ: string, ahora: Date = new Date()): Prisma.ConversationWhereInput {
  const q = rawQ.trim();
  if (!q) return {};
  return {
    OR: [
      { contact: { name: { contains: q, mode: "insensitive" } } },
      { contact: { phoneNumber: { contains: q, mode: "insensitive" } } },
      ...numerosDeLaBusqueda(q).map((numero) => ({ contact: { phoneNumber: { contains: numero } } })),
      ...(q.length >= LETRAS_PARA_BUSCAR_EN_MENSAJES ? [{ messages: filtroDeMensajes(q, ahora) }] : []),
    ],
  };
}

/** Lo mismo para las conversaciones de la API oficial (el telefono ahi es el waId). */
export function whereDeBusquedaDeChatsOficiales(
  rawQ: string,
  ahora: Date = new Date(),
): Prisma.OfficialApiConversationWhereInput {
  const q = rawQ.trim();
  if (!q) return {};
  return {
    OR: [
      { contact: { name: { contains: q, mode: "insensitive" } } },
      { contact: { waId: { contains: q, mode: "insensitive" } } },
      ...numerosDeLaBusqueda(q).map((numero) => ({ contact: { waId: { contains: numero } } })),
      ...(q.length >= LETRAS_PARA_BUSCAR_EN_MENSAJES ? [{ messages: filtroDeMensajes(q, ahora) }] : []),
    ],
  };
}
