/*
  SALIDA DEL SONIDO EN LA SALA: ALTAVOZ O AURICULAR (lógica pura, sin navegador ni LiveKit: se prueba con node).

  Recibe la lista de `navigator.mediaDevices.enumerateDevices()` y dice cómo se puede cambiar por dónde
  sale el sonido y qué dispositivo escoger para cada modo:

  - "salida": el navegador muestra más de una salida de sonido (computador). Se escoge con
    `room.switchActiveDevice("audiooutput", …)` (por dentro, setSinkId).
  - "microfono": Chrome de Android no muestra salidas, pero sí unos «micrófonos» llamados
    «Speakerphone» (altavoz) y «Headset earpiece» (auricular). Escoger uno también cambia por dónde sale
    el sonido. Se escoge con `room.switchActiveDevice("audioinput", …)`.
  - "ninguna": no se puede desde el navegador (por ejemplo iPhone con Safari): se muestra un aviso.

  En el modo auricular, si hay audífonos Bluetooth se prefieren a la bocina de la oreja.
*/

export type SalidaDeAudio = "altavoz" | "auricular";

export type FormaDeCambiar = "salida" | "microfono" | "ninguna";

/** Lo que se usa de un MediaDeviceInfo. */
export type DispositivoDeAudio = { kind: string; deviceId: string; label: string };

export type OpcionesDeSalida = {
  forma: FormaDeCambiar;
  altavoz: DispositivoDeAudio | null;
  auricular: DispositivoDeAudio | null;
};

/** Dónde se guarda la elección en el aparato (localStorage), para la próxima reunión. */
export const CLAVE_GUARDADA = "reuniones:salida-de-audio";

export const AVISO_SIN_CAMBIO =
  "Este celular no deja cambiar la salida desde el navegador. Usa los botones de volumen o el control de audio del teléfono.";

/** Copias que el navegador agrega a la lista («default», «communications»): no son un aparato más. */
const IDS_DE_COPIA = new Set(["", "default", "communications"]);

const PALABRAS_DE_AURICULAR = /earpiece|auricular|headset|headphone|aud[ií]fono|bluetooth/i;
const PALABRAS_DE_ALTAVOZ = /speaker|altavo|parlante/i;

export function esAuricular(dispositivo: DispositivoDeAudio): boolean {
  return PALABRAS_DE_AURICULAR.test(dispositivo.label);
}

/** «Speakerphone», «Altavoces», «Parlantes»… sin las palabras de auricular («Bluetooth speaker» es auricular). */
export function esAltavoz(dispositivo: DispositivoDeAudio): boolean {
  return PALABRAS_DE_ALTAVOZ.test(dispositivo.label) && !esAuricular(dispositivo);
}

function reales(dispositivos: readonly DispositivoDeAudio[], tipo: string) {
  return dispositivos.filter((dispositivo) => dispositivo.kind === tipo && !IDS_DE_COPIA.has(dispositivo.deviceId));
}

const NINGUNA: OpcionesDeSalida = { forma: "ninguna", altavoz: null, auricular: null };

/** Cómo se puede cambiar la salida con esta lista de dispositivos y qué escoger para cada modo. */
export function opcionesDeSalida(dispositivos: readonly DispositivoDeAudio[] | null | undefined): OpcionesDeSalida {
  const lista = dispositivos ?? [];

  // 1. Varias salidas de sonido (computador): por el nombre y, si no dice, la primera que no sea la otra.
  const salidas = reales(lista, "audiooutput");
  if (salidas.length >= 2) {
    const altavoz = salidas.find(esAltavoz) ?? salidas.find((salida) => !esAuricular(salida)) ?? salidas[0];
    const auricular =
      salidas.find((salida) => esAuricular(salida) && salida.deviceId !== altavoz.deviceId) ??
      salidas.find((salida) => salida.deviceId !== altavoz.deviceId) ??
      null;
    if (auricular) {
      return { forma: "salida", altavoz, auricular };
    }
  }

  // 2. Chrome de Android: los «micrófonos» Speakerphone y Headset earpiece (o Bluetooth).
  const entradas = reales(lista, "audioinput");
  const altavoz = entradas.find(esAltavoz) ?? null;
  const auricular =
    entradas.find((entrada) => /bluetooth/i.test(entrada.label)) ?? entradas.find(esAuricular) ?? null;
  if (altavoz && auricular) {
    return { forma: "microfono", altavoz, auricular };
  }

  // 3. No se puede desde el navegador.
  return NINGUNA;
}

/** El tipo de dispositivo que hay que cambiar en LiveKit para cada forma (null si no se puede). */
export function tipoParaCambiar(forma: FormaDeCambiar): "audiooutput" | "audioinput" | null {
  if (forma === "salida") {
    return "audiooutput";
  }
  if (forma === "microfono") {
    return "audioinput";
  }
  return null;
}

/** Lo que toca al tocar el botón: sin elección todavía el teléfono suele usar el auricular, así que pasa al altavoz. */
export function siguienteSalida(actual: SalidaDeAudio | null): SalidaDeAudio {
  return actual === "altavoz" ? "auricular" : "altavoz";
}

/** Lee la elección guardada (cualquier otro valor cuenta como «sin elección»). */
export function salidaGuardada(valor: string | null | undefined): SalidaDeAudio | null {
  return valor === "altavoz" || valor === "auricular" ? valor : null;
}

/** ¿Es un celular o tableta? Ahí el botón se ve siempre (aunque sea para mostrar el aviso). */
export function esCelular(agente: string | null | undefined): boolean {
  return /Android|iPhone|iPad|iPod|Mobi/i.test(agente ?? "");
}
