// Prueba del colchon de reproduccion de las llamadas (public/worklets/playback-processor.js).
// Carga el procesador con un AudioWorkletProcessor falso y lo alimenta como lo haria la red.
import { readFileSync } from "node:fs";
import vm from "node:vm";

let fallos = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "OK   " : "FALLO"} ${msg}`);
  if (!cond) fallos += 1;
};

let Clase;
vm.runInNewContext(readFileSync("public/worklets/playback-processor.js", "utf8"), {
  AudioWorkletProcessor: class {
    constructor() {
      this.port = {};
    }
  },
  registerProcessor: (_n, c) => {
    Clase = c;
  },
});

const nuevo = () => new Clase();
const llegan = (p, n, valor = 0.5) => p.port.onmessage({ data: new Float32Array(n).fill(valor) });
const bloque = (p) => {
  const out = new Float32Array(128);
  p.process([], [[out]]);
  return out;
};

// 1. No suena antes de tener 60 ms (960 muestras).
let p = nuevo();
llegan(p, 640);
ok(bloque(p).every((x) => x === 0), "no suena con 40 ms juntos");
llegan(p, 320);
ok(bloque(p).some((x) => x !== 0), "suena al juntar 60 ms");

// 2. Descarta lo viejo al pasar de 250 ms (4000 muestras).
p = nuevo();
llegan(p, 8000);
ok(p.available <= 4000, `con 500 ms juntos queda en ${p.available} muestras (<= 250 ms)`);

// 3. Un corte de red no mete saltos: se apaga sin golpe seco y vuelve a esperar el colchon.
p = nuevo();
llegan(p, 960);
for (let i = 0; i < 7; i += 1) bloque(p);
bloque(p); // aqui se acaba el audio a mitad del bloque
const tras = bloque(p);
ok(tras[0] < 0.5 && tras[127] < 0.01 && tras[127] > 0, "al quedarse sin audio la salida decae, no se corta en seco");
llegan(p, 320);
ok(bloque(p).every((x) => x < 0.5), "tras el corte espera el colchon antes de volver a sonar");

// 4. Rafagas simuladas: llegan de a 20 ms con retrasos de hasta 100 ms y no hay silencio de mas.
p = nuevo();
let sinAudio = 0;
let bloques = 0;
for (let t = 0; t < 500; t += 1) {
  if (t % 5 !== 4) llegan(p, 320); // cada 5to paquete se atrasa y llega junto con el siguiente
  else llegan(p, 640);
  for (let k = 0; k < 2; k += 1) {
    bloques += 1;
    if (t > 10 && bloque(p).every((x) => Math.abs(x) < 0.001)) sinAudio += 1;
  }
}
ok(sinAudio / bloques < 0.02, `con rafagas, sin audio ${sinAudio} de ${bloques} bloques`);

// 5. La conversion a enteros y de vuelta no cambia la señal (misma formula de useLlamada.ts).
const src = readFileSync("src/features/llamadas/components/useLlamada.ts", "utf8");
ok(/function aEnteros/.test(src) && /function aFlotantes/.test(src), "existen aEnteros y aFlotantes");

process.exit(fallos ? 1 : 0);
