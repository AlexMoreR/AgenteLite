/*
  "Copiar conversación" por páginas (refrescos más livianos, parte 3).

  Antes era un solo /live con batchSize=200, sin precarga=1: el servidor lo corta en 100, y como no
  era precarga, copiar el chat marcaba leídos y pedía la presencia y la foto del contacto, como si se
  abriera. Ahora se piden páginas de 30 con precarga=1, cada una antes del mensaje más viejo de la
  anterior, hasta juntar TOPE_PARA_COPIAR o hasta que una página llegue incompleta o vacía.
*/

export const PAGINA_PARA_COPIAR = 30;
export const TOPE_PARA_COPIAR = 100;

export type MensajeParaCopiar = {
  id?: string;
  direction?: string;
  content?: string | null;
  type?: string;
  createdAt?: string;
};

/** Lo que trae una página de /live: `null` si no se pudo leer. Los mensajes vienen del más viejo al más nuevo. */
export type PaginaParaCopiar = { mensajes: MensajeParaCopiar[] } | null;

/** La URL de una página de /live para copiar: siempre de a 30 y como precarga. */
export function urlDePaginaParaCopiar(chatKey: string, antesDe?: string | null) {
  const params = new URLSearchParams();
  params.set("chatKey", chatKey);
  params.set("batchSize", String(PAGINA_PARA_COPIAR));
  params.set("precarga", "1");
  if (antesDe) params.set("beforeMessageId", antesDe);
  return `/api/cliente/chats/live?${params.toString()}`;
}

function instante(mensaje: MensajeParaCopiar) {
  const ms = mensaje.createdAt ? new Date(mensaje.createdAt).getTime() : Number.NaN;
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Junta las páginas hasta TOPE_PARA_COPIAR mensajes, en orden cronológico y sin repetidos.
 * Devuelve `null` si la primera página no se pudo leer; si falla una página posterior, se queda con
 * lo que ya tenía.
 */
export async function juntarConversacionParaCopiar(
  pedirPagina: (antesDe: string | null) => Promise<PaginaParaCopiar>,
): Promise<MensajeParaCopiar[] | null> {
  const porId = new Map<string, MensajeParaCopiar>();
  const sinId: MensajeParaCopiar[] = [];
  let antesDe: string | null = null;
  let primera = true;

  while (porId.size + sinId.length < TOPE_PARA_COPIAR) {
    const pagina = await pedirPagina(antesDe);
    if (!pagina) {
      if (primera) return null;
      break;
    }
    primera = false;
    const mensajes = pagina.mensajes;
    if (mensajes.length === 0) break;

    let nuevos = 0;
    for (const mensaje of mensajes) {
      if (mensaje.id) {
        if (!porId.has(mensaje.id)) {
          porId.set(mensaje.id, mensaje);
          nuevos += 1;
        }
      } else {
        sinId.push(mensaje);
        nuevos += 1;
      }
    }

    // La página llegó incompleta: no hay más atrás.
    if (mensajes.length < PAGINA_PARA_COPIAR) break;
    // El cursor es el más viejo de esta página. Sin id, o si no trajo nada nuevo, no se puede seguir.
    const masViejo = mensajes[0]?.id ?? null;
    if (!masViejo || masViejo === antesDe || nuevos === 0) break;
    antesDe = masViejo;
  }

  const todos = [...porId.values(), ...sinId].sort((a, b) => {
    const diferencia = instante(a) - instante(b);
    if (diferencia !== 0) return diferencia;
    return (a.id ?? "").localeCompare(b.id ?? "");
  });
  // Si la última página pasó el tope, se quedan los más recientes.
  return todos.slice(Math.max(0, todos.length - TOPE_PARA_COPIAR));
}
