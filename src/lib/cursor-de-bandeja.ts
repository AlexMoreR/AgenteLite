import type { Prisma } from "@prisma/client";

/**
 * Paginacion por CURSOR de la bandeja (/api/cliente/chats/list).
 *
 * Antes cada pagina del scroll era `OFFSET n`: Postgres tiene que recorrer y tirar las n filas
 * anteriores, asi que la pagina 30 costaba 30 veces la primera (medido el 08-10-2026: p99 6,3 s
 * en "pagina_siguiente"). Con cursor, cada pagina arranca justo despues de la ultima fila leida.
 *
 * El ORDEN es el de siempre -ultimo mensaje primero, despues la ultima actualizacion- con el id
 * como desempate final. Sin ese desempate dos chats con la misma hora podian salir en cualquier
 * orden y un cursor no sabria cual sigue.
 *
 * OJO con los nulos: en Postgres `ORDER BY ... DESC` pone los NULL PRIMERO. Los chats sin ultimo
 * mensaje (lastMessageAt NULL) van arriba de todo, como hoy, y el filtro de "despues de" lo respeta.
 *
 * El cursor se arma con la ultima fila LEIDA de la base, no con la ultima MOSTRADA: si la ultima
 * era un lead pospuesto (no se muestra), el cursor igual tiene que pasar por encima de el.
 */
export const ORDEN_DE_BANDEJA = [
  { lastMessageAt: "desc" },
  { updatedAt: "desc" },
  { id: "desc" },
] satisfies Prisma.ConversationOrderByWithRelationInput[];

export type PosicionEnBandeja = {
  id: string;
  lastMessageAt: Date | null;
  updatedAt: Date;
};

export function codificarCursor(fila: PosicionEnBandeja): string {
  const crudo = JSON.stringify({
    l: fila.lastMessageAt ? fila.lastMessageAt.toISOString() : null,
    u: fila.updatedAt.toISOString(),
    i: fila.id,
  });
  return Buffer.from(crudo, "utf8").toString("base64url");
}

/** El cursor que mando la pantalla, o null si no vino o no se entiende (se cae al offset). */
export function leerCursor(texto: string | null | undefined): PosicionEnBandeja | null {
  if (!texto || texto.length > 400) {
    return null;
  }
  try {
    const valor = JSON.parse(Buffer.from(texto, "base64url").toString("utf8")) as unknown;
    if (!valor || typeof valor !== "object") return null;
    const { l, u, i } = valor as { l?: unknown; u?: unknown; i?: unknown };
    if (typeof i !== "string" || !/^[a-z0-9_-]{1,64}$/i.test(i)) return null;
    if (typeof u !== "string") return null;
    const updatedAt = new Date(u);
    if (Number.isNaN(updatedAt.getTime())) return null;
    let lastMessageAt: Date | null = null;
    if (l !== null) {
      if (typeof l !== "string") return null;
      lastMessageAt = new Date(l);
      if (Number.isNaN(lastMessageAt.getTime())) return null;
    }
    return { id: i, lastMessageAt, updatedAt };
  } catch {
    return null;
  }
}

/** Las filas que van DESPUES de `c` en ORDEN_DE_BANDEJA. */
export function whereDespuesDelCursor(c: PosicionEnBandeja): Prisma.ConversationWhereInput {
  const desempate: Prisma.ConversationWhereInput = {
    OR: [{ updatedAt: { lt: c.updatedAt } }, { updatedAt: c.updatedAt, id: { lt: c.id } }],
  };
  if (c.lastMessageAt === null) {
    // Seguimos dentro del bloque de los NULL (que va primero) o ya en el de los que tienen fecha.
    return {
      OR: [{ AND: [{ lastMessageAt: null }, desempate] }, { lastMessageAt: { not: null } }],
    };
  }
  // Los NULL ya quedaron atras (van primero); `lt` no los incluye.
  return {
    OR: [{ lastMessageAt: { lt: c.lastMessageAt } }, { AND: [{ lastMessageAt: c.lastMessageAt }, desempate] }],
  };
}

/**
 * Corta lo que vino de la base (se pide `limit + 1`) en la pagina y el "hay mas", y arma el
 * cursor de la siguiente con la ultima fila CONSUMIDA (pospuestos incluidos).
 */
export function cortarPagina<T extends PosicionEnBandeja>(filas: T[], limit: number) {
  const consumidas = filas.slice(0, limit);
  const hayMas = filas.length > limit;
  const ultima = consumidas[consumidas.length - 1];
  return {
    consumidas,
    hayMas,
    nextCursor: hayMas && ultima ? codificarCursor(ultima) : null,
  };
}
