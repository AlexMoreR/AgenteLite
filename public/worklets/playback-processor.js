const RING_SIZE = 16000 * 2;
// Colchon: no empieza a sonar hasta tener 60 ms juntos, y si se vacia (la red se atraso) espera a
// volver a juntarlos. Sin colchon, cada atraso de red se rellenaba con silencio: cortes y "robot".
const COLCHON = 960;
// Si se juntan mas de 250 ms sin reproducir (llego una rafaga despues de un corte de red), se salta
// hasta dejar 100 ms: es preferible perder un pedacito a quedar hablando con atraso, que es cuando
// los dos se pisan y parece que el otro no escucha.
const MAX_ATRASO = 4000;
const ATRASO_OBJETIVO = 1600;
// Al quedarse sin audio la salida se apaga en ~2 ms en vez de cortarse en seco (se oye como golpe).
const CAIDA = 0.9;

class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new Float32Array(RING_SIZE);
    this.read = 0;
    this.write = 0;
    this.available = 0;
    this.esperando = true;
    this.ultimo = 0;
    this.port.onmessage = (e) => {
      const data = e.data;
      for (let i = 0; i < data.length; i += 1) {
        this.ring[this.write] = data[i];
        this.write = (this.write + 1) % RING_SIZE;
        if (this.available < RING_SIZE) {
          this.available += 1;
        } else {
          this.read = (this.read + 1) % RING_SIZE;
        }
      }
      if (this.available > MAX_ATRASO) {
        const saltar = this.available - ATRASO_OBJETIVO;
        this.read = (this.read + saltar) % RING_SIZE;
        this.available -= saltar;
      }
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;
    if (this.esperando && this.available >= COLCHON) {
      this.esperando = false;
    }
    for (let i = 0; i < out.length; i += 1) {
      if (!this.esperando && this.available > 0) {
        this.ultimo = this.ring[this.read];
        out[i] = this.ultimo;
        this.read = (this.read + 1) % RING_SIZE;
        this.available -= 1;
      } else {
        if (!this.esperando) this.esperando = true;
        this.ultimo *= CAIDA;
        out[i] = this.ultimo;
      }
    }
    return true;
  }
}

registerProcessor("playback-processor", PlaybackProcessor);
