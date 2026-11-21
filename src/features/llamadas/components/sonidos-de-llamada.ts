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

/*
  El timbre de una llamada ENTRANTE (parte 3 de "Llamadas entrantes en la PWA", 21-nov-2026).

  Suena con su propio contexto de audio, aparte del de la llamada: hay que poder timbrar sin
  microfono ni llamada armada. El problema es el iPhone (y Chrome con su politica de autoplay): un
  contexto de audio creado sin que la persona haya tocado la pantalla nace "suspendido" y no suena.
  Por eso `prepararAudioDeTimbre` se engancha al PRIMER toque, tecla o clic en cualquier parte del
  CRM y ahi crea y enciende el contexto; cuando despues entre una llamada, ya esta listo.

  Si nadie toco la pantalla todavia, el timbre se programa igual sobre el contexto suspendido y
  empieza a sonar apenas la asesora toque algo (por ejemplo, la propia pantalla de la llamada). La
  pantalla sale siempre, suene o no.
*/

/** Timbre de telefono: dos tonos mezclados (440 + 480 Hz), dos rafagas y una pausa. */
const ENTRANTE_HZ = [440, 480];
const ENTRANTE_RAFAGA_S = 0.4;
const ENTRANTE_PAUSA_ENTRE_RAFAGAS_S = 0.2;
const ENTRANTE_CICLO_MS = 3000;
const ENTRANTE_VOLUMEN = 0.18;

let contextoDeTimbre: AudioContext | null = null;
let preparado = false;

/** El contexto del timbre: se crea una sola vez y se reusa en todas las llamadas. */
function obtenerContextoDeTimbre(): AudioContext | null {
  if (typeof window === "undefined" || typeof window.AudioContext !== "function") {
    return null;
  }
  try {
    if (!contextoDeTimbre || contextoDeTimbre.state === "closed") {
      contextoDeTimbre = new window.AudioContext();
    }
    if (contextoDeTimbre.state !== "running") {
      void contextoDeTimbre.resume().catch(() => {});
    }
    return contextoDeTimbre;
  } catch {
    return null;
  }
}

/**
 * Deja el audio del timbre listo con el primer toque en la pantalla (lo que pide el iPhone para
 * poder sonar despues). Se puede llamar muchas veces: engancha una sola.
 */
export function prepararAudioDeTimbre() {
  if (preparado || typeof window === "undefined") {
    return;
  }
  preparado = true;
  const alPrimerToque = () => {
    const ctx = obtenerContextoDeTimbre();
    if (ctx && ctx.state === "running") {
      for (const evento of EVENTOS_DE_TOQUE) {
        window.removeEventListener(evento, alPrimerToque, true);
      }
    }
  };
  for (const evento of EVENTOS_DE_TOQUE) {
    window.addEventListener(evento, alPrimerToque, { capture: true, passive: true });
  }
}

const EVENTOS_DE_TOQUE = ["pointerdown", "touchend", "keydown", "click"] as const;

/**
 * Arranca el timbre de llamada entrante, que se repite hasta que se apaga, y devuelve la funcion
 * que lo apaga. Si el navegador no tiene audio, devuelve una funcion que no hace nada.
 */
export function empezarTonoDeLlamadaEntrante(): () => void {
  const ctx = obtenerContextoDeTimbre();
  if (!ctx) {
    return () => {};
  }

  let osciladores: OscillatorNode[] = [];
  let volumen: GainNode;
  try {
    volumen = ctx.createGain();
    volumen.gain.value = 0;
    volumen.connect(ctx.destination);
    osciladores = ENTRANTE_HZ.map((hz) => {
      const oscilador = ctx.createOscillator();
      oscilador.frequency.value = hz;
      oscilador.connect(volumen);
      oscilador.start();
      return oscilador;
    });
  } catch {
    return () => {};
  }

  const timbrar = () => {
    try {
      // Si el contexto quedo suspendido (no han tocado la pantalla), se intenta encender en cada vuelta.
      if (ctx.state !== "running") {
        void ctx.resume().catch(() => {});
      }
      const ahora = ctx.currentTime;
      const segunda = ahora + ENTRANTE_RAFAGA_S + ENTRANTE_PAUSA_ENTRE_RAFAGAS_S;
      volumen.gain.setValueAtTime(ENTRANTE_VOLUMEN, ahora);
      volumen.gain.setValueAtTime(0, ahora + ENTRANTE_RAFAGA_S);
      volumen.gain.setValueAtTime(ENTRANTE_VOLUMEN, segunda);
      volumen.gain.setValueAtTime(0, segunda + ENTRANTE_RAFAGA_S);
    } catch {
      // Sin audio no hay timbre; la pantalla igual esta a la vista.
    }
  };
  timbrar();
  const intervalo = window.setInterval(timbrar, ENTRANTE_CICLO_MS);

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
      osciladores.forEach((oscilador) => oscilador.stop());
    } catch {
      // Ya no queda nada sonando.
    }
    osciladores.forEach((oscilador) => oscilador.disconnect());
    volumen.disconnect();
  };
}

/** Patron de vibracion mientras timbra una llamada entrante (Android; el iPhone no vibra desde la web). */
const VIBRACION_ENTRANTE = [700, 300, 700];
const VIBRACION_CICLO_MS = 3000;

/** Vibra al ritmo del timbre hasta que se apaga. Devuelve la funcion que la apaga. */
export function empezarVibracionDeLlamadaEntrante(): () => void {
  vibrar(VIBRACION_ENTRANTE);
  const intervalo = window.setInterval(() => vibrar(VIBRACION_ENTRANTE), VIBRACION_CICLO_MS);
  return () => {
    window.clearInterval(intervalo);
    vibrar(0);
  };
}

/** En el celular, ademas, vibra. En la computadora no hace nada. */
export function vibrar(patron: number | number[]) {
  try {
    navigator.vibrate?.(patron);
  } catch {
    // Algunos navegadores lo tienen y lo bloquean: no es un error para la llamada.
  }
}
