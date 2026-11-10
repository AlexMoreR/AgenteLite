import type { Prisma } from "@prisma/client";

/*
  LA BUSQUEDA DEL BUSCADOR DE CHATS (la caja "Buscar chats" de la bandeja), en el servidor.

  Nombre y numero son baratos: la tabla de contactos es chica y ya va filtrada por negocio. El texto
  de los mensajes NO, y por eso va APARTE (Alex, 10-11-2026):
   - la lista y la pagina buscan solo por nombre y numero (`partes: "nombreYNumero"`), asi sale al
     instante;
   - los chats que coinciden por el texto de un mensaje los pide la bandeja en una SEGUNDA llamada
     (`/list?soloPorMensaje=1`, `partes: "mensajes"`) y los agrega al final;
   - los contadores siguen contando las dos cosas (`partes: "todo"`).

  En los mensajes se busca solo con 4 letras o mas (con menos, casi todo coincide igual), en los de
  los ultimos 90 dias, en `content` y en `transcripcion` (lo que se dijo en un audio). Es un
  `ILIKE '%algo%'` sobre cada columna sola (sin lower() ni COALESCE): asi Postgres usa los indices
  GIN de pg_trgm "Message_content_trgm_idx" y "Message_transcripcion_trgm_idx" (migracion
  20261111000100_busqueda_por_texto). No los declara schema.prisma: ver docs/cambios-pendientes.
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
 * Las cifras con las que se busca el telefono, ademas de lo escrito tal cual.
 *
 * Un numero de Colombia puede estar guardado con el 57 adelante (573012175617) o sin el
 * (3012175617). Buscar "3012175617" ya encuentra los dos (el `contains` lo halla dentro del largo),
 * pero "573012175617" o "+57 301 217 5617" no encontraban el guardado sin el 57. Por eso, si las
 * cifras son 12 y empiezan por 57, se busca tambien con las 10 de atras.
 */
export function cifrasParaBuscarElTelefono(q: string): string[] {
  const texto = q.trim();
  if (!/^[\d\s()+.-]+$/.test(texto)) return [];
  const cifras = texto.replace(/\D/g, "");
  const variantes = new Set<string>();
  const sinSeparadores = cifrasDeLaBusqueda(texto);
  if (sinSeparadores) variantes.add(sinSeparadores);
  if (cifras.length === 12 && cifras.startsWith("57")) variantes.add(cifras.slice(2));
  // Lo escrito tal cual ya va en su propia condicion: no se repite.
  variantes.delete(texto);
  return [...variantes];
}

export type EstadoDeLaBandeja = "all" | "open" | "resolved";

/** Si hay algo escrito en el buscador. */
export function hayBusqueda(q: string | null | undefined): boolean {
  return Boolean(q?.trim());
}

/**
 * El filtro de estado que de verdad se aplica.
 *
 * Con texto en el buscador el estado NO filtra (ni los pospuestos se esconden): quien busca un
 * numero quiere encontrar ese chat aunque este cerrado. Antes, con "Abiertos" puesto -que no se
 * ve en la pantalla-, buscar el numero de un chat cerrado no daba nada (Alex, 30-10-2026). Sin
 * texto, todo queda como siempre.
 */
export function estadoQueAplica(statusFilter: EstadoDeLaBandeja, q: string | null | undefined): EstadoDeLaBandeja {
  return hayBusqueda(q) ? "all" : statusFilter;
}

function desdeCuandoBuscarMensajes(ahora: Date): Date {
  return new Date(ahora.getTime() - DIAS_DE_MENSAJES_EN_LA_BUSQUEDA * 24 * 60 * 60 * 1000);
}

/** Que parte de la busqueda se aplica (ver arriba). */
export type PartesDeLaBusqueda = "todo" | "nombreYNumero" | "mensajes";

/** Si con este texto se busca dentro de los mensajes. */
export function buscaEnMensajes(q: string | null | undefined): boolean {
  return (q?.trim().length ?? 0) >= LETRAS_PARA_BUSCAR_EN_MENSAJES;
}

/** Lo que piden los parametros de /list: `soloPorMensaje=1` o, si no, solo nombre y numero. */
export function partesDeLaBusquedaDeLaLista(leer: (clave: string) => string | null): PartesDeLaBusqueda {
  return leer("soloPorMensaje") === "1" ? "mensajes" : "nombreYNumero";
}

// Una condicion por columna, con la columna sola: Prisma la escribe `"content" ILIKE $1`.
function filtroDeMensajes(q: string, ahora: Date) {
  return {
    some: {
      createdAt: { gte: desdeCuandoBuscarMensajes(ahora) },
      OR: [
        { content: { contains: q, mode: "insensitive" as const } },
        { transcripcion: { contains: q, mode: "insensitive" as const } },
      ],
    },
  };
}

/** Nunca coincide (pedir "mensajes" con un texto demasiado corto). */
const NINGUN_CHAT: Prisma.ConversationWhereInput = { id: { in: [] } };

/**
 * Lo que agrega `q` a la consulta de conversaciones del canal viejo. Sin texto, nada.
 *
 * `partes`: "nombreYNumero" no mira los mensajes; "mensajes" mira solo los mensajes (con menos de 4
 * letras no devuelve ningun chat); "todo", las dos cosas.
 */
export function whereDeBusquedaDeChats(
  rawQ: string,
  ahora: Date = new Date(),
  partes: PartesDeLaBusqueda = "todo",
): Prisma.ConversationWhereInput {
  const q = rawQ.trim();
  if (!q) return {};
  const porMensaje = buscaEnMensajes(q) ? [{ messages: filtroDeMensajes(q, ahora) }] : [];
  if (partes === "mensajes") return porMensaje[0] ?? NINGUN_CHAT;
  const cifras = cifrasParaBuscarElTelefono(q);
  return {
    OR: [
      { contact: { name: { contains: q, mode: "insensitive" } } },
      { contact: { phoneNumber: { contains: q, mode: "insensitive" } } },
      ...cifras.map((variante) => ({ contact: { phoneNumber: { contains: variante } } })),
      ...(partes === "todo" ? porMensaje : []),
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
  const cifras = cifrasParaBuscarElTelefono(q);
  return {
    OR: [
      { contact: { name: { contains: q, mode: "insensitive" } } },
      { contact: { waId: { contains: q, mode: "insensitive" } } },
      ...cifras.map((variante) => ({ contact: { waId: { contains: variante } } })),
      // La API oficial no guarda transcripcion: solo el texto.
      ...(buscaEnMensajes(q)
        ? [
            {
              messages: {
                some: {
                  createdAt: { gte: desdeCuandoBuscarMensajes(ahora) },
                  content: { contains: q, mode: "insensitive" as const },
                },
              },
            },
          ]
        : []),
    ],
  };
}
