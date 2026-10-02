/**
 * Los sonidos del marcador, generados en el navegador (no hay archivos de audio que cargar).
 *
 * Sin ellos la asesora marcaba y escuchaba silencio: no sabia si estaba timbrando, si el cliente
 * habia contestado o si la llamada se habia caido (Alex, 02-10-2026). Un telefono de verdad avisa
 * las tres cosas con sonido, y la diadema es por donde ella esta atenta.
 *
 * Suenan solo de este lado: van al parlante de la asesora y no al canal de la llamada, asi que el
 * cliente no los escucha y la grabacion no los guarda.
 */

/** Tono de timbrado de Colombia: 425 Hz, un segundo sonando y cuatro callado. */
const TIMBRADO_HZ = 425;
const TIMBRADO_SUENA_S = 1;
const TIMBRADO_CICLO_MS = 5000;
const VOLUMEN = 0.12;

/** Arranca el "tuuu... tuuu..." y devuelve la funcion que lo apaga. */
export function empezarTimbrado(ctx: AudioContext): () => void {
  const oscilador = ctx.createOscillator();
  oscilador.frequency.value = TIMBRADO_HZ;
  const volumen = ctx.createGain();
  volumen.gain.value = 0;
  oscilador.connect(volumen);
  volumen.connect(ctx.destination);
  oscilador.start();

  const timbrar = () => {
    const ahora = ctx.currentTime;
    volumen.gain.setValueAtTime(VOLUMEN, ahora);
    volumen.gain.setValueAtTime(0, ahora + TIMBRADO_SUENA_S);
  };
  timbrar();
  const intervalo = window.setInterval(timbrar, TIMBRADO_CICLO_MS);

  let apagado = false;
  return () => {
    if (apagado) {
      return;
    }
    apagado = true;
    window.clearInterval(intervalo);
    try {
      volumen.gain.cancelScheduledValues(ctx.currentTime);
      volumen.gain.setValueAtTime(0, ctx.currentTime);
      oscilador.stop();
    } catch {
      // El contexto ya se cerro (colgaron en el medio): no queda nada sonando.
    }
    oscilador.disconnect();
    volumen.disconnect();
  };
}

/** Dos pitidos cortos y agudos: el cliente contesto. */
export function pitidoDeContestada(ctx: AudioContext) {
  pitidos(ctx, [0, 0.2], 880);
}

/**
 * Un pitido grave: la llamada termino.
 *
 * Usa un contexto de audio propio porque suena justo cuando el de la llamada se esta cerrando.
 */
export function pitidoDeFin() {
  try {
    const ctx = new AudioContext();
    pitidos(ctx, [0], 330, 0.35);
    window.setTimeout(() => void ctx.close().catch(() => {}), 1000);
  } catch {
    // Sin audio no hay pitido; el panel igual dice como termino.
  }
}

function pitidos(ctx: AudioContext, inicios: number[], hz: number, duracion = 0.12) {
  try {
    const ahora = ctx.currentTime;
    for (const inicio of inicios) {
      const oscilador = ctx.createOscillator();
      oscilador.frequency.value = hz;
      const volumen = ctx.createGain();
      volumen.gain.setValueAtTime(VOLUMEN * 1.5, ahora + inicio);
      volumen.gain.setValueAtTime(0, ahora + inicio + duracion);
      oscilador.connect(volumen);
      volumen.connect(ctx.destination);
      oscilador.start(ahora + inicio);
      oscilador.stop(ahora + inicio + duracion + 0.05);
      oscilador.onended = () => {
        oscilador.disconnect();
        volumen.disconnect();
      };
    }
  } catch {
    // Sin contexto de audio no hay pitido; el panel igual cambia de color y de texto.
  }
}

/** En el celular, ademas, vibra. En la computadora no hace nada. */
export function vibrar(patron: number | number[]) {
  try {
    navigator.vibrate?.(patron);
  } catch {
    // Algunos navegadores lo tienen y lo bloquean: no es un error para la llamada.
  }
}
