/*
  Un mismo pedido de la fila de un chat (/summary) no sale dos veces a la vez (velocidad de Chats,
  21-nov-2026).

  El mismo aviso de WhatsApp llega por más de un camino (el socket del gateway, el altavoz, el
  respaldo de después de enviar) y cada uno pedía la fila del chat por su cuenta: dos /summary
  iguales con milisegundos de diferencia. Si sale un pedido idéntico mientras el primero todavía
  viaja y empezó hace muy poco (VENTANA_MS), se reusa su respuesta.

  La ventana es corta a propósito: un pedido que salió antes puede no traer un mensaje que se guardó
  después. Pasada la ventana, el pedido nuevo sale siempre, aunque el anterior siga en camino.
*/

export const VENTANA_MS = 250;

type EnCamino = { empezo: number; respuesta: Promise<Response> };

const enCamino = new Map<string, EnCamino>();

/** Como `fetch` (solo GET), pero un pedido idéntico que salió hace menos de VENTANA_MS se reusa. */
export function fetchCompartido(
  url: string,
  init?: RequestInit,
  ahora: () => number = Date.now,
  pedir: typeof fetch = fetch,
): Promise<Response> {
  const momento = ahora();
  const previo = enCamino.get(url);
  if (previo && momento - previo.empezo < VENTANA_MS) {
    // Cada quien lee su propia copia: el cuerpo de una respuesta se puede leer una sola vez.
    return previo.respuesta.then((respuesta) => respuesta.clone());
  }
  const respuesta = pedir(url, init);
  const entrada: EnCamino = { empezo: momento, respuesta };
  enCamino.set(url, entrada);
  const soltar = () => {
    if (enCamino.get(url) === entrada) enCamino.delete(url);
  };
  respuesta.then(soltar, soltar);
  // El primero también recibe una copia: así el original queda intacto para clonar.
  return respuesta.then((r) => r.clone());
}

/** Solo para las pruebas. */
export function olvidarPedidosEnCamino() {
  enCamino.clear();
}
