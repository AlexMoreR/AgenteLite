// Todas las medidas estan en muestras a 16 kHz (16 muestras = 1 ms).
const RING_SIZE = 16000 * 2;

// La voz llega por un canal sin orden y sin reenvios, con ~90 ms de variacion entre paquetes. Si se
// reproduce apenas llega el primer pedazo, cualquier paquete atrasado deja el anillo vacio y la
// asesora oye la voz recortada. Por eso se junta un colchon antes de sonar: 150 ms alcanzan para
// esa variacion sin que el atraso se note en la conversacion.
const OBJETIVO_INICIAL = 2400;
// Con una red peor se paga mas atraso a cambio de no cortar, pero hasta 300 ms: de ahi para arriba
// los dos empiezan a pisarse al hablar.
const OBJETIVO_MAXIMO = 4800;
// Se sube rapido porque cada vaciada es un corte que se oye; se baja de a poco para no volver a
// cortar apenas la red se calma.
const PASO_SUBIDA = 800;
const PASO_BAJADA = 400;
// Una vaciada suelta puede ser casualidad; dos en menos de 5 s ya son la red.
const VENTANA_REPETIDO = 16000 * 5;
const ESPERA_PARA_BAJAR = 16000 * 10;

// Si se juntan mas de objetivo + 0,25 s sin reproducir (llego una rafaga despues de un corte de
// red), se salta hasta dejar el objetivo: es preferible perder un pedacito a quedar hablando con un
// segundo de atraso, que es cuando los dos se pisan y parece que el otro no escucha. El margen va
// sobre el objetivo vigente para que el salto nunca se coma el colchon que se acaba de ganar; en el
// peor caso el atraso queda en 0,55 s.
const MARGEN_ATRASO = 4000;

// 2 ms: lo minimo para que un cambio brusco de la onda no suene como un clic, y tan corto que no se
// oye como fundido.
const MUESTRAS_FUNDIDO = 32;

// Si el cliente calla, WaCalls puede dejar de mandar audio (no hay paquetes, no es la red). Con 200 ms
// sin recibir nada se da por terminada la frase: lo que quede en el anillo suena aunque no llegue al
// objetivo (si no, el final de una palabra corta quedaria retenido hasta la siguiente vez que hable).
// Y una vaciada que dura 200 ms o mas sin audio nuevo es silencio, no red: no sube el colchon.
const SILENCIO_SIN_DATOS = 3200;

class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new Float32Array(RING_SIZE);
    this.read = 0;
    this.write = 0;
    this.available = 0;
    this.objetivo = OBJETIVO_INICIAL;
    this.reproduciendo = false;
    // Arranca en infinito para que la primera vaciada de la llamada no cuente como repetida.
    this.desdeUnderrun = Infinity;
    this.proximaBajada = ESPERA_PARA_BAJAR;
    this.ultimaSalida = 0;
    this.desde = 0;
    this.fundido = MUESTRAS_FUNDIDO;
    this.colaRestante = 0;
    this.sinDatos = 0;
    this.vacio = 0;
    this.vaciadaPendiente = false;
    this.port.onmessage = (e) => {
      const data = e.data;
      if (this.vaciadaPendiente) {
        this.vaciadaPendiente = false;
        if (this.vacio < SILENCIO_SIN_DATOS) {
          this.contarVaciada();
        }
        this.vacio = 0;
      }
      this.sinDatos = 0;
      for (let i = 0; i < data.length; i += 1) {
        this.ring[this.write] = data[i];
        this.write = (this.write + 1) % RING_SIZE;
        if (this.available < RING_SIZE) {
          this.available += 1;
        } else {
          this.read = (this.read + 1) % RING_SIZE;
        }
      }
      if (this.available > this.objetivo + MARGEN_ATRASO) {
        this.saltar(this.available - this.objetivo);
      }
    };
  }

  // Se funde desde lo ultimo que salio y no desde cero: asi sirve igual al volver del silencio, en
  // un salto a mitad de la voz o si el audio vuelve antes de que termine de apagarse.
  empezarFundido() {
    this.desde = this.ultimaSalida;
    this.fundido = 0;
  }

  saltar(cuantas) {
    this.read = (this.read + cuantas) % RING_SIZE;
    this.available -= cuantas;
    if (this.reproduciendo) {
      this.empezarFundido();
    }
  }

  // El tiempo se mide en muestras procesadas porque el worklet corre siempre, haya voz o no.
  adaptar(muestras) {
    this.desdeUnderrun += muestras;
    if (this.objetivo <= OBJETIVO_INICIAL || this.desdeUnderrun < this.proximaBajada) {
      return;
    }
    this.proximaBajada += ESPERA_PARA_BAJAR;
    this.objetivo = Math.max(OBJETIVO_INICIAL, this.objetivo - PASO_BAJADA);
    // Bajar solo el numero no quitaria atraso: se consume al mismo ritmo que llega, asi que el
    // anillo seguiria igual de lleno hasta la proxima vaciada.
    if (this.reproduciendo) {
      const sobra = Math.min(this.available - this.objetivo, PASO_BAJADA);
      if (sobra > 0) {
        this.saltar(sobra);
      }
    }
  }

  // Se vuelve a llenar en vez de sacar ceros: con el anillo casi vacio, cada paquete que llega se
  // reproduciria solo y la voz saldria a pedazos; es mejor un solo hueco y despues voz continua.
  registrarUnderrun() {
    this.reproduciendo = false;
    this.colaRestante = MUESTRAS_FUNDIDO;
    // Se decide cuando llegue el siguiente audio: si tardo poco fue la red, si tardo mucho fue silencio.
    this.vaciadaPendiente = true;
    this.vacio = 0;
  }

  contarVaciada() {
    if (this.desdeUnderrun < VENTANA_REPETIDO) {
      this.objetivo = Math.min(OBJETIVO_MAXIMO, this.objetivo + PASO_SUBIDA);
    }
    this.desdeUnderrun = 0;
    this.proximaBajada = ESPERA_PARA_BAJAR;
    // Aca ya se sabe que fue la red y no un silencio: es lo que se cuenta en el diagnostico.
    this.port.postMessage({ tipo: "corte", objetivoMs: this.objetivo / 16 });
  }

  siguienteMuestra() {
    let muestra = this.ring[this.read];
    this.read = (this.read + 1) % RING_SIZE;
    this.available -= 1;
    if (this.fundido < MUESTRAS_FUNDIDO) {
      this.fundido += 1;
      const ganancia = this.fundido / MUESTRAS_FUNDIDO;
      muestra = muestra * ganancia + this.desde * (1 - ganancia);
    }
    this.ultimaSalida = muestra;
    return muestra;
  }

  // Al vaciarse ya no quedan muestras con las que hacer el fundido de salida, asi que se apaga la
  // ultima que sono. Termina en cero exacto.
  siguienteSilencio() {
    if (this.colaRestante > 0) {
      this.ultimaSalida -= this.ultimaSalida / this.colaRestante;
      this.colaRestante -= 1;
    }
    return this.ultimaSalida;
  }

  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;
    this.adaptar(out.length);
    this.sinDatos = Math.min(this.sinDatos + out.length, 16000 * 60);
    const fraseTerminada = this.available > 0 && this.sinDatos >= SILENCIO_SIN_DATOS;
    if (!this.reproduciendo && (this.available >= this.objetivo || fraseTerminada)) {
      this.reproduciendo = true;
      this.empezarFundido();
    }
    for (let i = 0; i < out.length; i += 1) {
      if (this.reproduciendo && this.available === 0) {
        this.registrarUnderrun();
      }
      if (!this.reproduciendo && this.vaciadaPendiente && this.available === 0) {
        this.vacio += 1;
      }
      out[i] = this.reproduciendo ? this.siguienteMuestra() : this.siguienteSilencio();
    }
    return true;
  }
}

registerProcessor("playback-processor", PlaybackProcessor);
