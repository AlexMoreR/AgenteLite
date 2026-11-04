/**
 * LA ESPERA REAL DEL CLIENTE (código puro, sin base). Pedido de Alexander, 4-nov-2026.
 *
 * Caso real (chat cv7ea1f09d7ae1996754d3bba2, Yair): 13:34 el bot pide asesor ("confirmarle el envío y
 * la forma de pago"), 13:35 el cliente escribe "Medellín" y "O también me sirve Aquibdo", 13:36 el bot
 * pide asesor otra vez, 13:36 el cliente pide "La foto para mirarlo completo" y el bot le manda 4 fotos,
 * un video y "¿Para cuándo lo necesitas?", 13:52 un seguimiento. El cliente estaba atendido y aun así
 * salieron el aviso de las 13:53, el segundo aviso y la escalada de las 14:18 ("43 min").
 *
 * Con los últimos mensajes y notas del chat (`ChatAbierto.mensajes`, los mismos 40 del turno):
 *  (a) el último mensaje del cliente no tuvo NINGUNA respuesta (ni del bot ni de una persona): espera
 *      desde ese mensaje. Los seguimientos automáticos no cuentan como respuesta.
 *  (b) el bot respondió y no pidió asesor: NO espera.
 *  (c) el bot pidió asesor (nota "El agente pide un asesor: …" o la promesa "una asesora te contacta")
 *      y el pedido sigue en pie (después no hubo un mensaje del cliente que el bot contestara, ni
 *      respondió una persona): espera desde el ÚLTIMO pedido vigente, no desde el primero. El motivo
 *      es el texto que va después de los dos puntos.
 *  (d) el bot pidió asesor y después siguió atendiendo (el cliente escribió y el bot le contestó): ese
 *      pedido ya no cuenta (el caso de Yair).
 * Siempre devuelve el último mensaje real del cliente.
 *
 * Devuelve null si no se puede decidir (sin mensajes, o sin ningún mensaje del cliente entre ellos):
 * quien llama sigue como antes.
 */

import { BOT_PROMETE_ASESORA, claseDelEvento, NOTA_PIDE_ASESORA, type ClaseDeEvento, type EventoDelChat } from "../../../lib/turno-de-la-conversacion";

export type MotivoDeLaEspera = "sin_respuesta" | "bot_pidio_asesor" | "respondio_el_bot" | "respondio_persona";

export type EsperaReal = {
  esperando: boolean;
  motivo: MotivoDeLaEspera;
  /** Desde cuándo espera (el mensaje sin respuesta o el último pedido de asesor vigente); null si no espera. */
  desde: Date | null;
  /** Por qué el bot pidió asesor (texto tras "El agente pide un asesor: "), si el pedido sigue en pie. */
  motivoDelBot: string | null;
  /** El último mensaje del cliente (texto y hora). */
  ultimoDelCliente: { texto: string | null; en: Date };
  /** Textos del cliente que nadie (bot ni persona) contestó, del más viejo al más nuevo. */
  sinRespuesta: string[];
};

const esRespuesta = (c: ClaseDeEvento) => c === "bot" || c === "humano" || c === "llamada_atendida";
const esPersona = (c: ClaseDeEvento) => c === "humano" || c === "llamada_atendida";

/** El motivo legible de un pedido de asesor: lo que va después de "El agente pide un asesor: ". */
export function motivoDelPedido(texto: string | null | undefined): string | null {
  const limpio = (texto ?? "").replace(/\s+/g, " ").trim();
  if (!limpio) return null;
  const m = /^El agente pide un asesor:\s*(.+)$/i.exec(limpio);
  return (m ? m[1] : limpio).trim() || null;
}

/** ¿Este evento es un pedido de asesor del bot (nota o promesa en su texto)? */
function esPedidoDeAsesor(e: EventoDelChat, clase: ClaseDeEvento): boolean {
  if (clase === "nota") return NOTA_PIDE_ASESORA.test(e.texto ?? "");
  if (clase === "bot") return BOT_PROMETE_ASESORA.test(e.texto ?? "");
  return false;
}

export function esperaReal(eventos: EventoDelChat[] | null | undefined): EsperaReal | null {
  if (!eventos?.length) return null;
  const orden = [...eventos].sort((a, b) => a.en.getTime() - b.en.getTime());
  const clases = orden.map(claseDelEvento);
  const iCliente = clases.lastIndexOf("cliente");
  if (iCliente < 0) return null;
  const ultimoDelCliente = { texto: orden[iCliente].texto, en: orden[iCliente].en };

  // Una persona respondió después del último mensaje del cliente: no espera.
  const despues = clases.slice(iCliente + 1);
  if (despues.some(esPersona)) {
    return { esperando: false, motivo: "respondio_persona", desde: null, motivoDelBot: null, ultimoDelCliente, sinRespuesta: [] };
  }

  // Los mensajes del cliente sin respuesta: los que vienen después de la última respuesta (bot o persona).
  let iRespuesta = -1;
  for (let i = orden.length - 1; i >= 0; i -= 1) {
    if (esRespuesta(clases[i])) {
      iRespuesta = i;
      break;
    }
  }
  const sinRespuesta = orden
    .slice(iRespuesta + 1)
    .filter((_, k) => clases[iRespuesta + 1 + k] === "cliente")
    .map((e) => (e.texto ?? "").trim())
    .filter(Boolean);

  // El último pedido de asesor que sigue en pie (c / d).
  let pedido: { en: Date; motivo: string | null } | null = null;
  for (let p = orden.length - 1; p >= 0 && !pedido; p -= 1) {
    if (!esPedidoDeAsesor(orden[p], clases[p])) continue;
    let escribioElCliente = false;
    let superado = false;
    for (let j = p + 1; j < orden.length; j += 1) {
      if (esPersona(clases[j])) {
        superado = true;
        break;
      }
      if (clases[j] === "cliente") escribioElCliente = true;
      else if (clases[j] === "bot" && escribioElCliente) {
        superado = true;
        break;
      }
    }
    // Si el más nuevo ya quedó superado, los anteriores también: no se sigue buscando.
    if (superado) break;
    pedido = { en: orden[p].en, motivo: motivoDelPedido(orden[p].texto) };
  }
  if (pedido) {
    return { esperando: true, motivo: "bot_pidio_asesor", desde: pedido.en, motivoDelBot: pedido.motivo, ultimoDelCliente, sinRespuesta };
  }
  // (a) El último mensaje del cliente no tuvo ninguna respuesta.
  if (iRespuesta < iCliente) {
    return { esperando: true, motivo: "sin_respuesta", desde: ultimoDelCliente.en, motivoDelBot: null, ultimoDelCliente, sinRespuesta };
  }
  // (b) / (d) El bot respondió y no hay pedido de asesor en pie.
  return { esperando: false, motivo: "respondio_el_bot", desde: null, motivoDelBot: null, ultimoDelCliente, sinRespuesta: [] };
}
