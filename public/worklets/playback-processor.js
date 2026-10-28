const RING_SIZE = 16000 * 2;
// Si se juntan mas de 0,4 s sin reproducir (llego una rafaga despues de un corte de red), se salta
// hasta dejar 0,15 s: es preferible perder un pedacito a quedar hablando con un segundo de atraso,
// que es cuando los dos se pisan y parece que el otro no escucha.
const MAX_ATRASO = 6400;
const ATRASO_OBJETIVO = 2400;

class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new Float32Array(RING_SIZE);
    this.read = 0;
    this.write = 0;
    this.available = 0;
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
    for (let i = 0; i < out.length; i += 1) {
      if (this.available > 0) {
        out[i] = this.ring[this.read];
        this.read = (this.read + 1) % RING_SIZE;
        this.available -= 1;
      } else {
        out[i] = 0;
      }
    }
    return true;
  }
}

registerProcessor("playback-processor", PlaybackProcessor);
