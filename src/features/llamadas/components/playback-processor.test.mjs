import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const fuente = readFileSync(new URL("../../../../public/worklets/playback-processor.js", import.meta.url), "utf8");

const BLOQUE = 128;
const AMPLITUD = 0.5;
// Con un fundido de 32 muestras, lo maximo que puede cambiar la onda constante de una muestra a otra.
const SALTO_SIN_CLIC = AMPLITUD / 32 + 1e-4;
const OBJETIVO_INICIAL = 2400;
const OBJETIVO_MAXIMO = 4800;
const MARGEN_ATRASO = 4000;
const BLOQUES_EN_10_S = 16000 * 10 / BLOQUE;

function cargarWorklet() {
  const registrados = new Map();
  class AudioWorkletProcessor {
    port = {
      onmessage: null,
      enviados: [],
      postMessage(mensaje) {
        this.enviados.push(mensaje);
      },
    };
  }
  vm.runInNewContext(fuente, {
    AudioWorkletProcessor,
    registerProcessor: (nombre, clase) => registrados.set(nombre, clase),
  });
  return registrados;
}

function crear() {
  const Clase = cargarWorklet().get("playback-processor");
  return new Clase();
}

function enviar(proc, cuantas, valor = AMPLITUD) {
  proc.port.onmessage({ data: new Float32Array(cuantas).fill(valor) });
}

function bloque(proc) {
  const salida = new Float32Array(BLOQUE);
  assert.equal(proc.process([], [[salida]]), true);
  return salida;
}

function bloques(proc, cuantos) {
  const salida = new Float32Array(cuantos * BLOQUE);
  for (let i = 0; i < cuantos; i += 1) {
    salida.set(bloque(proc), i * BLOQUE);
  }
  return salida;
}

// Llena hasta el objetivo vigente y reproduce hasta que el anillo se vacia.
function provocarUnderrun(proc) {
  enviar(proc, proc.objetivo);
  const salida = [];
  do {
    salida.push(...bloque(proc));
  } while (proc.reproduciendo);
  // La vaciada se cuenta cuando llega el siguiente audio; un mensaje vacio lo dispara sin cambiar el anillo.
  enviar(proc, 0);
  return Float32Array.from(salida);
}

function mayorSalto(muestras, anterior = 0) {
  let mayor = 0;
  let previa = anterior;
  for (const muestra of muestras) {
    mayor = Math.max(mayor, Math.abs(muestra - previa));
    previa = muestra;
  }
  return mayor;
}

function esSilencio(muestras) {
  return muestras.every((m) => m === 0);
}

test("se registra con el nombre que usa useLlamada", () => {
  assert.deepEqual([...cargarWorklet().keys()], ["playback-processor"]);
});

test("sin canal de salida no falla ni consume", () => {
  const proc = crear();
  enviar(proc, OBJETIVO_INICIAL);
  assert.equal(proc.process([], [[]]), true);
  assert.equal(proc.available, OBJETIVO_INICIAL);
});

test("pre-roll: no suena hasta juntar 150 ms y no consume mientras tanto", () => {
  const proc = crear();
  enviar(proc, OBJETIVO_INICIAL - 1);
  assert.ok(esSilencio(bloques(proc, 20)));
  assert.equal(proc.available, OBJETIVO_INICIAL - 1);

  enviar(proc, 1);
  const salida = bloque(proc);
  assert.ok(salida.some((m) => m !== 0));
  assert.equal(proc.available, OBJETIVO_INICIAL - BLOQUE);
});

test("frase terminada: con 200 ms sin audio nuevo suena lo que quedo, aunque no llegue al objetivo, y no sube el colchon", () => {
  const proc = crear();
  enviar(proc, 1000);
  assert.ok(esSilencio(bloques(proc, 20)));
  assert.equal(proc.available, 1000);
  const salida = bloques(proc, 10);
  assert.ok(salida.some((m) => m !== 0));
  bloques(proc, 20);
  assert.equal(proc.available, 0);
  // El silencio duro mas de 200 ms: al volver el audio no se cuenta como corte de red.
  enviar(proc, 1000);
  bloques(proc, 20);
  assert.equal(proc.objetivo, OBJETIVO_INICIAL);
});

test("reproduce todas las muestras en orden despues del fundido de entrada", () => {
  const proc = crear();
  const entrada = Float32Array.from({ length: OBJETIVO_INICIAL }, (_, i) => (i / OBJETIVO_INICIAL) * AMPLITUD);
  proc.port.onmessage({ data: entrada });

  const salida = bloques(proc, 18);
  for (let i = 32; i < salida.length; i += 1) {
    assert.equal(salida[i], entrada[i]);
  }
});

test("re-priming: al vaciarse vuelve a esperar el objetivo y no suena con menos", () => {
  const proc = crear();
  provocarUnderrun(proc);
  bloque(proc);
  assert.equal(proc.reproduciendo, false);

  enviar(proc, OBJETIVO_INICIAL - 320);
  assert.ok(esSilencio(bloques(proc, 20)));
  assert.equal(proc.available, OBJETIVO_INICIAL - 320);

  enviar(proc, 320);
  assert.ok(bloque(proc).some((m) => m !== 0));
  assert.equal(proc.reproduciendo, true);
});

test("sin clics al entrar y salir del silencio", () => {
  const proc = crear();
  const primera = provocarUnderrun(proc);
  assert.ok(mayorSalto(primera) <= SALTO_SIN_CLIC, `salto de ${mayorSalto(primera)}`);
  assert.equal(primera.at(-1) === 0 || proc.colaRestante > 0, true);

  const cola = bloque(proc);
  assert.ok(mayorSalto(cola, primera.at(-1)) <= SALTO_SIN_CLIC);
  assert.equal(cola.at(-1), 0);
});

test("si el audio vuelve a mitad del apagado tampoco hay clic", () => {
  const proc = crear();
  // Vacia el anillo a 8 muestras de terminar el bloque: la cola queda a medias.
  enviar(proc, OBJETIVO_INICIAL - (OBJETIVO_INICIAL % BLOQUE) + BLOQUE - 8);
  const salida = [];
  do {
    salida.push(...bloque(proc));
  } while (proc.reproduciendo);
  assert.ok(proc.colaRestante > 0);

  enviar(proc, OBJETIVO_INICIAL);
  const siguiente = bloque(proc);
  assert.ok(mayorSalto(siguiente, salida.at(-1)) <= SALTO_SIN_CLIC, `salto de ${mayorSalto(siguiente, salida.at(-1))}`);
});

test("colchon: una vaciada suelta no sube el objetivo", () => {
  const proc = crear();
  provocarUnderrun(proc);
  assert.equal(proc.objetivo, OBJETIVO_INICIAL);

  // Mas de 5 s despues ya no cuenta como repetida.
  bloques(proc, Math.ceil(16000 * 5 / BLOQUE));
  provocarUnderrun(proc);
  assert.equal(proc.objetivo, OBJETIVO_INICIAL);
});

test("colchon: las vaciadas repetidas suben el objetivo hasta 300 ms y no mas", () => {
  const proc = crear();
  provocarUnderrun(proc);
  const vistos = [];
  for (let i = 0; i < 6; i += 1) {
    provocarUnderrun(proc);
    vistos.push(proc.objetivo);
  }
  assert.deepEqual(vistos, [3200, 4000, 4800, 4800, 4800, 4800]);
  assert.equal(proc.objetivo, OBJETIVO_MAXIMO);
});

test("colchon: baja de a poco tras 10 s sin vaciarse, quita atraso real y se detiene en 150 ms", () => {
  const proc = crear();
  provocarUnderrun(proc);
  provocarUnderrun(proc);
  assert.equal(proc.objetivo, 3200);

  enviar(proc, proc.objetivo);
  const alimentar = (cuantos) => {
    for (let i = 0; i < cuantos; i += 1) {
      enviar(proc, BLOQUE);
      bloque(proc);
    }
  };
  alimentar(BLOQUES_EN_10_S - 1);
  assert.equal(proc.objetivo, 3200);
  assert.equal(proc.available, 3200);

  alimentar(1);
  assert.equal(proc.objetivo, 2800);
  assert.equal(proc.available, 2800);

  alimentar(BLOQUES_EN_10_S - 1);
  assert.equal(proc.objetivo, 2800);
  alimentar(1);
  assert.equal(proc.objetivo, OBJETIVO_INICIAL);
  assert.equal(proc.available, OBJETIVO_INICIAL);

  alimentar(BLOQUES_EN_10_S * 2);
  assert.equal(proc.objetivo, OBJETIVO_INICIAL);
  assert.equal(proc.available, OBJETIVO_INICIAL);
});

test("colchon: una vaciada reinicia la espera para bajar", () => {
  const proc = crear();
  provocarUnderrun(proc);
  provocarUnderrun(proc);
  bloques(proc, BLOQUES_EN_10_S - 100);
  provocarUnderrun(proc);
  const objetivo = proc.objetivo;
  bloques(proc, BLOQUES_EN_10_S - 1);
  assert.equal(proc.objetivo, objetivo);
});

// El objeto nace dentro del vm: se copia para que deepEqual no lo rechace por tener otro prototipo.
function cortes(proc) {
  return proc.port.enviados.map((mensaje) => ({ ...mensaje }));
}

function vaciar(proc) {
  enviar(proc, proc.objetivo);
  do {
    bloque(proc);
  } while (proc.reproduciendo);
}

test("corte: una vaciada por la red avisa al hilo principal con el colchon vigente", () => {
  const proc = crear();
  provocarUnderrun(proc);
  assert.deepEqual(cortes(proc), [{ tipo: "corte", objetivoMs: 150 }]);

  // La segunda seguida es repetida: el colchon sube y el mensaje ya trae el nuevo.
  provocarUnderrun(proc);
  assert.deepEqual(cortes(proc), [
    { tipo: "corte", objetivoMs: 150 },
    { tipo: "corte", objetivoMs: 200 },
  ]);
});

test("corte: se avisa cuando vuelve el audio, si tardo menos de 200 ms", () => {
  const proc = crear();
  vaciar(proc);
  bloques(proc, 10);
  assert.deepEqual(cortes(proc), []);

  enviar(proc, 320);
  assert.deepEqual(cortes(proc), [{ tipo: "corte", objetivoMs: 150 }]);
});

test("corte: un silencio largo no se avisa", () => {
  const proc = crear();
  vaciar(proc);
  bloques(proc, 30);
  enviar(proc, 320);
  assert.deepEqual(cortes(proc), []);
});

test("salto de seguridad: con el objetivo inicial, respeta el margen y deja el objetivo", () => {
  const proc = crear();
  enviar(proc, OBJETIVO_INICIAL + MARGEN_ATRASO);
  assert.equal(proc.available, OBJETIVO_INICIAL + MARGEN_ATRASO);

  enviar(proc, 1);
  assert.equal(proc.available, OBJETIVO_INICIAL);
});

test("salto de seguridad: con el objetivo alto no se come el colchon y el atraso no pasa de 0,55 s", () => {
  const proc = crear();
  while (proc.objetivo < OBJETIVO_MAXIMO) {
    provocarUnderrun(proc);
  }
  enviar(proc, OBJETIVO_MAXIMO + MARGEN_ATRASO);
  assert.equal(proc.available, OBJETIVO_MAXIMO + MARGEN_ATRASO);
  assert.ok(proc.available / 16000 <= 0.55);

  enviar(proc, 320);
  assert.equal(proc.available, OBJETIVO_MAXIMO);
});

test("salto de seguridad: no suena como clic a mitad de la voz", () => {
  const proc = crear();
  enviar(proc, OBJETIVO_INICIAL, AMPLITUD);
  const antes = bloques(proc, 5);
  // Rafaga con otro valor: despues del salto la onda cae de golpe de 0,5 a -0,5.
  enviar(proc, 8000, -AMPLITUD);
  const despues = bloque(proc);
  const permitido = (2 * AMPLITUD) / 32 + 1e-4;
  assert.ok(mayorSalto(despues, antes.at(-1)) <= permitido, `salto de ${mayorSalto(despues, antes.at(-1))}`);
  assert.ok(Math.abs(despues[127] + AMPLITUD) < 1e-4);
});

test("una rafaga mas grande que el anillo no rompe nada", () => {
  const proc = crear();
  enviar(proc, 16000 * 3);
  assert.equal(proc.available, OBJETIVO_INICIAL);
  assert.ok(bloques(proc, 10).some((m) => m !== 0));
  assert.ok(proc.read >= 0 && proc.read < 32000);
});

// Paquetes de 20 ms con hasta 90 ms de variacion, como en las llamadas Colombia-Francia. El
// generador es determinista para que la prueba no falle al azar.
function simularRed(proc, segundos, jitterMs) {
  let semilla = 12345;
  const azar = () => {
    semilla = (Math.imul(semilla, 1103515245) + 12345) & 0x7fffffff;
    return semilla / 0x7fffffff;
  };
  const llegadas = Array.from({ length: (segundos * 1000) / 20 }, (_, i) => i * 20 + azar() * jitterMs).sort((a, b) => a - b);
  let siguiente = 0;
  const salida = [];
  for (let t = 0; t < segundos * 1000; t += 8) {
    while (siguiente < llegadas.length && llegadas[siguiente] <= t) {
      enviar(proc, 320);
      siguiente += 1;
    }
    salida.push(...bloque(proc));
  }
  return salida;
}

test("con 90 ms de variacion la voz sale continua despues del pre-roll", () => {
  const proc = crear();
  const salida = simularRed(proc, 30, 90);
  const inicio = salida.findIndex((m) => m !== 0);
  assert.ok(inicio > 0 && inicio <= 16000 * 0.3, `empezo en la muestra ${inicio}`);
  const cortes = salida.slice(inicio).filter((m) => m === 0).length;
  assert.equal(cortes, 0);
  assert.equal(proc.objetivo, OBJETIVO_INICIAL);
  assert.ok(proc.available <= OBJETIVO_INICIAL + MARGEN_ATRASO);
});
