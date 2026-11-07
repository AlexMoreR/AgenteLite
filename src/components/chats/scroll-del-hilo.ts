/**
 * Cuando el chat baja solo al final, y cuando no (7-nov-2026, pedido de Emanuel).
 *
 * La asesora subia a leer lo anterior y la vista se volvia sola al final. La regla es una sola y
 * vive aca, sin React ni navegador, para poder probarla (`scroll-del-hilo.test.ts`). La vista baja
 * sola UNICAMENTE:
 *   - al abrir la conversacion;
 *   - cuando la asesora envia un mensaje;
 *   - cuando entra un mensaje y ella estaba a menos de 100 px del final.
 * Si ella subio, nada la mueve: ni un mensaje que entra, ni una foto que termina de cargar, ni los
 * reintentos de los primeros instantes al abrir el chat.
 *
 * Hay dos medidas de "estar al final" y no es un descuido:
 *   - 100 px cuando ENTRA un mensaje: quien esta leyendo lo ultimo quiere ver lo que llego;
 *   - 24 px cuando solo CRECE el contenido (una foto que carga, un mensaje de arriba que se dibuja):
 *     si con 100 px la asesora apenas empezaba a subir, cada foto la devolveria abajo.
 */

/** Entra un mensaje y la asesora estaba a menos de esto del final: baja a verlo. */
export const DISTANCIA_CERCA_DEL_FINAL_PX = 100;
/** Crece el contenido (foto que carga): solo se acompaña si estaba pegada al final. */
export const DISTANCIA_PEGADA_AL_FINAL_PX = 24;
/** Desde esta distancia se ve el boton para bajar (mas ancho para que no parpadee). */
export const DISTANCIA_BOTON_BAJAR_PX = 220;

type MedidasDelScroll = { scrollHeight: number; scrollTop: number; clientHeight: number };

/** Cuantos px faltan para llegar al final (nunca negativo). */
export function distanciaAlFinal(el: MedidasDelScroll): number {
  return Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
}

export function estaCercaDelFinal(distancia: number): boolean {
  return distancia <= DISTANCIA_CERCA_DEL_FINAL_PX;
}

export function estaPegadaAlFinal(distancia: number): boolean {
  return distancia <= DISTANCIA_PEGADA_AL_FINAL_PX;
}

export function debeVerseElBotonDeBajar(distancia: number): boolean {
  return distancia > DISTANCIA_BOTON_BAJAR_PX;
}

/**
 * Lo que pasa en el chat y podria bajar la vista.
 * - `asesoraSeMovio`: movio la rueda, el dedo o el teclado DESPUES de que empezo lo que se evalua
 *   (la apertura del chat, una bajada pendiente). Gana siempre: lo que ella hizo no se deshace.
 * - `distancia`: cuanto le faltaba para el final ANTES de que llegara el cambio.
 */
export type MotivoParaBajar =
  | { tipo: "abrir" }
  | { tipo: "reintento-apertura"; asesoraSeMovio: boolean }
  | { tipo: "enviar" }
  | { tipo: "mensaje-nuevo"; distancia: number; asesoraSeMovio: boolean }
  | { tipo: "crecio-contenido"; distancia: number; asesoraSeMovio: boolean; enApertura: boolean };

export function debeBajarAlFinal(motivo: MotivoParaBajar): boolean {
  switch (motivo.tipo) {
    case "abrir":
    case "enviar":
      return true;
    case "reintento-apertura":
      // Los reintentos de los primeros instantes acomodan el chat recien abierto; si ella ya
      // empezo a subir, se cancelan.
      return !motivo.asesoraSeMovio;
    case "mensaje-nuevo":
      return !motivo.asesoraSeMovio && estaCercaDelFinal(motivo.distancia);
    case "crecio-contenido":
      if (motivo.asesoraSeMovio) {
        return false;
      }
      // Recien abierto el chat las fotos todavia estan cargando: se la acompaña al final hasta
      // que ella toque algo. Despues, solo si sigue pegada.
      return motivo.enApertura || estaPegadaAlFinal(motivo.distancia);
  }
}

type MensajeDelHilo = { id: string; direction?: string | null };

/**
 * Cuantos mensajes NUEVOS del cliente entraron al final desde la ultima vez, para el contador del
 * boton. Solo cuenta si de verdad cambio el ultimo mensaje: cargar mensajes antiguos (que entran
 * arriba) o rehacer la lista no suma nada.
 */
export function contarNuevosAlFinal(ultimoIdAnterior: string, mensajes: readonly MensajeDelHilo[]): number {
  const ultimo = mensajes.at(-1);
  if (!ultimo || !ultimoIdAnterior || ultimo.id === ultimoIdAnterior) {
    return 0;
  }
  const desde = mensajes.findIndex((mensaje) => mensaje.id === ultimoIdAnterior);
  if (desde < 0) {
    // El anterior ya no esta (p. ej. la burbuja optimista se cambio por la real): se cuenta solo el
    // ultimo, si es del cliente.
    return ultimo.direction === "INBOUND" ? 1 : 0;
  }
  return mensajes.slice(desde + 1).filter((mensaje) => mensaje.direction === "INBOUND").length;
}

/**
 * La llave que identifica lo que se ve del hilo: "<id del chat>|<cantidad>|<id del ultimo>".
 * El id puede traer ":", por eso el separador es "|".
 */
export function leerLlaveDelHilo(llave: string): { chatId: string; cantidad: number; ultimoId: string } {
  const [chatId = "", cantidad = "0", ultimoId = ""] = llave.split("|");
  return { chatId, cantidad: Number(cantidad) || 0, ultimoId };
}
