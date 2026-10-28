/**
 * Las piezas del audio de una llamada que no dependen del navegador, separadas para poder probarlas
 * (scripts/check-audio-de-llamada.mjs).
 *
 * POR QUE EXISTE (28-10-2026, "uno habla y el otro no escucha nada"):
 *
 * El audio viaja crudo (PCM 16 kHz) por un canal de datos de WebRTC hasta WaCalls, que esta en
 * Francia: 200 ms de ida y vuelta desde Colombia. El canal se abria con la configuracion por
 * defecto, que es CONFIABLE Y ORDENADO, o sea como TCP: si se pierde un paquete, todo lo que viene
 * detras espera a que se reenvie. Para un archivo esta bien; para una voz es lo peor que hay.
 * Un paquete perdido frena el canal, el audio se apila, y cuando llega todo junto WaCalls guarda
 * solo los ultimos 240 ms y tira el resto (internal/voip/extension/audio/audio.go, FeedPCM).
 *
 * Las grabaciones lo muestran: en las llamadas contestadas de la ultima semana la grabacion dura
 * entre 5 % y 20 % MENOS que la conversacion (11A2EF6C: 80 s hablados, 63,6 s grabados). La
 * grabacion se escribe cada vez que llega audio de cualquiera de los dos lados, asi que esos
 * segundos que faltan son tramos de varios segundos en que no llegaba NADA del microfono de la
 * asesora: el cliente no la escuchaba. Al reves no pasa igual, porque el navegador guarda hasta
 * 2 s de lo que llega (llega tarde, pero llega).
 *
 * El arreglo es tratar el canal como se trata la voz en cualquier llamada: un paquete que se
 * pierde se pierde (son 20 ms, no se nota), pero nunca frena a los demas.
 */

/**
 * Sin orden y sin reenvios. Lo decide quien abre el canal (el navegador) y vale para los dos
 * sentidos: WaCalls responde por el mismo canal con la misma regla.
 */
export const OPCIONES_CANAL_PCM: RTCDataChannelInit = { ordered: false, maxRetransmits: 0 };

/** 20 ms de audio a 16 kHz: el tamaño de paquete de cualquier llamada de voz. */
export const MUESTRAS_POR_PAQUETE = 320;

/**
 * Cuanto se deja acumular sin salir en el canal antes de empezar a tirar audio nuevo: 0,25 s de
 * PCM (16 000 muestras/s × 2 bytes). Si la red de la asesora no da abasto, es mejor que el cliente
 * escuche con cortes cortos que con un retraso que crece hasta que no escucha nada.
 */
export const LIMITE_COLA_BYTES = 8000;

export function hayQueDescartar(bufferedAmount: number, limite = LIMITE_COLA_BYTES): boolean {
  return bufferedAmount > limite;
}

/**
 * Junta los pedacitos de 128 muestras que entrega el AudioWorklet (cada 8 ms) en paquetes de
 * 20 ms. Antes se mandaba un mensaje cada 8 ms: 125 por segundo, cada uno con su cabecera, y con
 * cada uno una oportunidad mas de perderse.
 */
export class EmpaquetadorPcm {
  private pendiente: Float32Array;
  private ocupadas = 0;

  constructor(private readonly tamano = MUESTRAS_POR_PAQUETE) {
    this.pendiente = new Float32Array(tamano);
  }

  agregar(muestras: Float32Array): Float32Array[] {
    const listos: Float32Array[] = [];
    let i = 0;
    while (i < muestras.length) {
      const cuantas = Math.min(this.tamano - this.ocupadas, muestras.length - i);
      this.pendiente.set(muestras.subarray(i, i + cuantas), this.ocupadas);
      this.ocupadas += cuantas;
      i += cuantas;
      if (this.ocupadas === this.tamano) {
        listos.push(this.pendiente);
        this.pendiente = new Float32Array(this.tamano);
        this.ocupadas = 0;
      }
    }
    return listos;
  }
}

/** Lo que se cuenta de una llamada para saber, despues, si el audio fue en los dos sentidos. */
export type DiagnosticoDeLlamada = {
  /** Paquetes de 20 ms del microfono que salieron hacia WaCalls. */
  enviados: number;
  /** Paquetes del microfono tirados porque la red no daba abasto (ver LIMITE_COLA_BYTES). */
  descartados: number;
  /** Mensajes de audio del cliente que llegaron desde WaCalls. */
  recibidos: number;
  bytesRecibidos: number;
  /** El mayor atraso visto en la salida del canal, en bytes. */
  colaMaxima: number;
  /** El hueco mas largo sin recibir audio del cliente con la llamada contestada, en ms. */
  huecoMaximoRecibidoMs: number;
  /** El hueco mas largo sin poder mandar audio del microfono, en ms. */
  huecoMaximoEnviadoMs: number;
  /** Veces que el microfono se apago solo (auricular desconectado, otro programa lo tomo...). */
  microfonoCaido: number;
  /** De getStats(): lo que realmente paso por la red y el tiempo de ida y vuelta. */
  bytesEnviadosRed: number | null;
  bytesRecibidosRed: number | null;
  rttMs: number | null;
};

export function diagnosticoVacio(): DiagnosticoDeLlamada {
  return {
    enviados: 0,
    descartados: 0,
    recibidos: 0,
    bytesRecibidos: 0,
    colaMaxima: 0,
    huecoMaximoRecibidoMs: 0,
    huecoMaximoEnviadoMs: 0,
    microfonoCaido: 0,
    bytesEnviadosRed: null,
    bytesRecibidosRed: null,
    rttMs: null,
  };
}

/**
 * Lee de getStats() la ruta de red elegida. Recibe la lista de reportes (no el RTCStatsReport)
 * para poder probarlo sin navegador.
 */
export function leerRutaElegida(
  reportes: Array<Record<string, unknown>>,
): { bytesEnviados: number; bytesRecibidos: number; rttMs: number | null } | null {
  const transporte = reportes.find((r) => r.type === "transport");
  const idElegido = typeof transporte?.selectedCandidatePairId === "string" ? transporte.selectedCandidatePairId : null;
  const par =
    (idElegido ? reportes.find((r) => r.id === idElegido) : undefined) ??
    reportes.find((r) => r.type === "candidate-pair" && (r.nominated === true || r.selected === true) && r.state === "succeeded");
  if (!par) {
    return null;
  }
  const numero = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const rtt = typeof par.currentRoundTripTime === "number" ? Math.round(par.currentRoundTripTime * 1000) : null;
  return { bytesEnviados: numero(par.bytesSent), bytesRecibidos: numero(par.bytesReceived), rttMs: rtt };
}
