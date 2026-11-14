// Pruebas de la llamada de tres, parte 1: la mezcla de sonido
// (src/features/llamadas/components/puente-de-llamadas.ts) y el servidor que marca por otra linea
// (src/app/api/wacalls/llamada/route.ts y src/lib/wacalls.ts).
// Correr: npm run test:llamada-de-tres
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const sourcePath = path.resolve("src/features/llamadas/components/puente-de-llamadas.ts");
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
const { sumarPcm, mezclaParaLlamada, mezclaParaParlante } = mod.exports;

const ruta = fs.readFileSync(path.resolve("src/app/api/wacalls/llamada/route.ts"), "utf8");
const wacalls = fs.readFileSync(path.resolve("src/lib/wacalls.ts"), "utf8");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const pcm = (...muestras) => Int16Array.from(muestras);
const lista = (x) => Array.from(x);

prueba("la suma va muestra por muestra", () => {
  const r = sumarPcm(pcm(1, 2, 3, -4), pcm(10, -20, 30, 40));
  assert.ok(r instanceof Int16Array);
  assert.deepEqual(lista(r), [11, -18, 33, 36]);
});

prueba("la suma nunca pasa de 32767 ni de -32768", () => {
  const r = sumarPcm(pcm(32767, 30000, -32768, -30000, 20000), pcm(1, 30000, -1, -30000, -20000));
  assert.deepEqual(lista(r), [32767, 32767, -32768, -32768, 0]);
  const fuerte = sumarPcm(new Int16Array(320).fill(32767), new Int16Array(320).fill(32767));
  assert.ok(lista(fuerte).every((m) => m === 32767), "no da la vuelta a negativo");
});

prueba("si un paquete es mas corto, lo que falta cuenta como silencio", () => {
  assert.deepEqual(lista(sumarPcm(pcm(1, 2, 3, 4), pcm(10))), [11, 2, 3, 4]);
  assert.deepEqual(lista(sumarPcm(pcm(), pcm(5, 6))), [5, 6]);
});

prueba("la suma no cambia los paquetes que recibe", () => {
  const a = pcm(1, 2);
  const b = pcm(3, 4);
  sumarPcm(a, b);
  assert.deepEqual(lista(a), [1, 2]);
  assert.deepEqual(lista(b), [3, 4]);
});

const microfono = pcm(100, 200, 300);
const llamadaA = pcm(1, 2, 3);
const llamadaB = pcm(1000, 2000, 3000);

prueba("la llamada A recibe microfono + B, y la llamada B recibe microfono + A", () => {
  const paraA = mezclaParaLlamada({ microfono, otraLlamada: llamadaB, silenciado: false });
  const paraB = mezclaParaLlamada({ microfono, otraLlamada: llamadaA, silenciado: false });
  assert.deepEqual(lista(paraA), [1100, 2200, 3300]);
  assert.deepEqual(lista(paraB), [101, 202, 303]);
});

prueba("con Alexander silenciado, A sigue recibiendo el sonido de B (y B el de A)", () => {
  const paraA = mezclaParaLlamada({ microfono, otraLlamada: llamadaB, silenciado: true });
  const paraB = mezclaParaLlamada({ microfono, otraLlamada: llamadaA, silenciado: true });
  assert.deepEqual(lista(paraA), lista(llamadaB));
  assert.deepEqual(lista(paraB), lista(llamadaA));
  assert.deepEqual(lista(microfono), [100, 200, 300], "silenciar no borra el microfono original");
});

prueba("el parlante suena A + B", () => {
  assert.deepEqual(lista(mezclaParaParlante(llamadaA, llamadaB)), [1001, 2002, 3003]);
});

prueba("route.ts: el permiso del modulo llamadas se pide antes de cualquier accion", () => {
  const permiso = ruta.indexOf('canAccessClientModule(access, "llamadas")');
  assert.ok(permiso > 0, "falta el control de permiso del modulo llamadas");
  const despues = [
    ruta.indexOf("await request.json()"),
    ruta.indexOf("getLineasDelNegocio(access.workspaceId)"),
    ruta.indexOf("getWaCallsSessionIdForChannel("),
    ruta.indexOf("switch (cuerpo.accion)"),
    ruta.indexOf("waCallsRequest<"),
  ];
  for (const posicion of despues) {
    assert.ok(posicion > permiso, `algo corre antes del permiso (posicion ${posicion})`);
  }
  // Si no tiene permiso, la ruta corta ahi mismo.
  assert.match(ruta.slice(permiso, permiso + 200), /status: 403/);
});

prueba("route.ts: la busqueda de otra linea filtra por el negocio de la sesion", () => {
  const llamadas = ruta.match(/getOtraLineaDelNegocio\(\s*([^,]+),/g) ?? [];
  assert.ok(llamadas.length >= 1, "iniciar no busca otra linea");
  for (const llamada of llamadas) {
    assert.match(llamada, /getOtraLineaDelNegocio\(\s*access\.workspaceId,/);
  }
  assert.ok(ruta.includes("No hay otra línea libre para agregar a alguien"));
  assert.match(ruta, /sessionId: linea/, "la respuesta de iniciar devuelve la linea usada");
  // Una linea que manda el navegador solo se acepta si es de este negocio.
  assert.match(ruta, /getLineasDelNegocio\(access\.workspaceId\)\)\.includes\(sidPedido\)/);
});

prueba("wacalls.ts: las lineas del negocio salen solo de canales de ese workspaceId", () => {
  const inicio = wacalls.indexOf("export async function getLineasDelNegocio(");
  assert.ok(inicio > 0);
  const cuerpo = wacalls.slice(inicio, wacalls.indexOf("\n}\n", inicio));
  assert.match(cuerpo, /where: \{ workspaceId, isActive: true \}/);
  const otra = wacalls.indexOf("export async function getOtraLineaDelNegocio(");
  assert.ok(otra > 0);
  assert.match(wacalls.slice(otra, wacalls.indexOf("\n}\n", otra)), /getLineasDelNegocio\(workspaceId\)/);
});

console.log(`\n${pruebas} pruebas ok`);
