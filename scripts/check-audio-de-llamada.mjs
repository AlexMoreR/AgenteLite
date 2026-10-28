// Pruebas de src/features/llamadas/components/audio-de-llamada.ts (audio de un solo sentido, 28-10-2026).
// Correr: npm run test:audio-de-llamada
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const sourcePath = path.resolve("src/features/llamadas/components/audio-de-llamada.ts");
const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
});
const mod = { exports: {} };
new Function("exports", "require", "module", "__filename", "__dirname", transpiled.outputText)(
  mod.exports,
  require,
  mod,
  sourcePath,
  path.dirname(sourcePath),
);
const { OPCIONES_CANAL_PCM, MUESTRAS_POR_PAQUETE, EmpaquetadorPcm, hayQueDescartar, LIMITE_COLA_BYTES, leerRutaElegida } =
  mod.exports;

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

prueba("el canal de audio NO es confiable ni ordenado (la causa del audio de un solo sentido)", () => {
  assert.equal(OPCIONES_CANAL_PCM.ordered, false);
  assert.equal(OPCIONES_CANAL_PCM.maxRetransmits, 0);
  assert.equal(OPCIONES_CANAL_PCM.maxPacketLifeTime, undefined, "no se pueden pedir las dos cosas a la vez");
});

prueba("los pedacitos de 128 muestras salen en paquetes de 20 ms, sin perder ni repetir muestras", () => {
  const e = new EmpaquetadorPcm();
  const salida = [];
  let n = 0;
  for (let vuelta = 0; vuelta < 10; vuelta += 1) {
    const trozo = new Float32Array(128).map(() => (n += 1));
    salida.push(...e.agregar(trozo));
  }
  // 1280 muestras = 4 paquetes de 320.
  assert.equal(salida.length, 4);
  salida.forEach((p) => assert.equal(p.length, MUESTRAS_POR_PAQUETE));
  const todas = salida.flatMap((p) => Array.from(p));
  assert.deepEqual(todas, Array.from({ length: 1280 }, (_, i) => i + 1));
});

prueba("un paquete entregado no se pisa con el siguiente", () => {
  const e = new EmpaquetadorPcm(4);
  const [a] = e.agregar(new Float32Array([1, 2, 3, 4]));
  e.agregar(new Float32Array([9, 9, 9, 9]));
  assert.deepEqual(Array.from(a), [1, 2, 3, 4]);
});

prueba("con la red ahogada se descarta audio nuevo en vez de apilarlo", () => {
  assert.equal(hayQueDescartar(0), false);
  assert.equal(hayQueDescartar(LIMITE_COLA_BYTES), false);
  assert.equal(hayQueDescartar(LIMITE_COLA_BYTES + 1), true);
  // 0,25 s de PCM a 16 kHz y 16 bits.
  assert.equal(LIMITE_COLA_BYTES, 16000 * 2 * 0.25);
});

prueba("lee bytes y RTT de la ruta de red elegida", () => {
  const ruta = leerRutaElegida([
    { type: "transport", id: "T1", selectedCandidatePairId: "CP2" },
    { type: "candidate-pair", id: "CP1", state: "failed", bytesSent: 1, bytesReceived: 1 },
    { type: "candidate-pair", id: "CP2", state: "succeeded", bytesSent: 5000, bytesReceived: 7000, currentRoundTripTime: 0.198 },
  ]);
  assert.deepEqual(ruta, { bytesEnviados: 5000, bytesRecibidos: 7000, rttMs: 198 });
});

prueba("sin transporte (Firefox) usa el par nominado; sin ruta devuelve null", () => {
  const ruta = leerRutaElegida([
    { type: "candidate-pair", id: "A", state: "succeeded", nominated: true, bytesSent: 10, bytesReceived: 20 },
  ]);
  assert.deepEqual(ruta, { bytesEnviados: 10, bytesRecibidos: 20, rttMs: null });
  assert.equal(leerRutaElegida([]), null);
});

console.log(`\n${pruebas} pruebas ok`);
