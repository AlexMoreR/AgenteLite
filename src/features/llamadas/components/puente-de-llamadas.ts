/**
 * La mezcla de sonido de una llamada de tres (Alexander + cliente + una persona agregada), separada
 * para poder probarla sin navegador (scripts/check-llamada-de-tres.mjs).
 *
 * POR QUE EXISTE: WaCalls solo hace llamadas de una persona a otra. Para sumar a alguien (por
 * ejemplo el transportador) el CRM abre una SEGUNDA llamada y hace de puente: a cada llamada le
 * manda el microfono de Alexander mas lo que dice la otra llamada, y por el parlante suenan las
 * dos. No cuesta nada: son dos llamadas normales de WhatsApp.
 *
 *   Llamada A (cliente)        <- microfono + B
 *   Llamada B (agregado)       <- microfono + A
 *   Parlante de Alexander      <- A + B
 *
 * El formato es el mismo de audio-de-llamada.ts y useLlamada.ts: PCM de 16 bits con signo,
 * 16 kHz, un canal, en paquetes de 20 ms (320 muestras) por el canal de datos "pcm". Aca se trabaja
 * con Int16Array, que es lo que viaja por ese canal (little-endian, igual que en el navegador).
 *
 * Solo funciones puras: no tocan React, el navegador ni la red.
 */

const MAXIMO = 32767;
const MINIMO = -32768;

/**
 * Suma dos paquetes muestra por muestra y recorta a lo que cabe en 16 bits.
 *
 * Si uno es mas corto, lo que le falta cuenta como silencio: el resultado tiene el largo del mas
 * largo. Sin el recorte, dos voces fuertes a la vez darian la vuelta (32767 + 1 = -32768) y se
 * oiria un chasquido.
 */
export function sumarPcm(a: Int16Array, b: Int16Array): Int16Array {
  const largo = Math.max(a.length, b.length);
  const salida = new Int16Array(largo);
  for (let i = 0; i < largo; i += 1) {
    const suma = (i < a.length ? a[i] : 0) + (i < b.length ? b[i] : 0);
    salida[i] = suma > MAXIMO ? MAXIMO : suma < MINIMO ? MINIMO : suma;
  }
  return salida;
}

/**
 * Lo que se le manda a UNA llamada: el microfono de Alexander mas el sonido de la otra llamada.
 *
 * Con `silenciado`, el microfono se cambia por silencio pero lo de la otra llamada sigue pasando:
 * Alexander se calla, pero el cliente y la persona agregada se siguen escuchando entre ellos.
 */
export function mezclaParaLlamada(input: {
  microfono: Int16Array;
  otraLlamada: Int16Array;
  silenciado: boolean;
}): Int16Array {
  const microfono = input.silenciado ? new Int16Array(input.microfono.length) : input.microfono;
  return sumarPcm(microfono, input.otraLlamada);
}

/** Lo que suena en el parlante de Alexander: las dos llamadas juntas. */
export function mezclaParaParlante(a: Int16Array, b: Int16Array): Int16Array {
  return sumarPcm(a, b);
}
