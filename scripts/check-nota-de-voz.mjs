// Pruebas de src/lib/nota-de-voz-reintento.ts (reintento de notas de voz, 08-10-2026).
// Correr: npm run test:nota-de-voz
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const sourcePath = path.resolve("src/lib/nota-de-voz-reintento.ts");
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
const {
  clasificarSubida,
  clasificarEnvio,
  conUnReintento,
  MENSAJE_SIN_CONEXION_SUBIDA,
  MENSAJE_SIN_CONEXION_ENVIO,
  MENSAJE_TIEMPO_AGOTADO,
} = mod.exports;

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const sinEspera = { esperar: async () => {} };

await prueba("subida ok devuelve la URL", () => {
  assert.deepEqual(clasificarSubida({ status: 200, url: "/u/a.ogg" }), { ok: true, valor: "/u/a.ogg" });
});

await prueba("subida sin respuesta = conexion, reintentable", () => {
  const r = clasificarSubida({ status: null });
  assert.equal(r.ok, false);
  assert.equal(r.falla.tipo, "conexion");
  assert.equal(r.falla.reintentable, true);
  assert.equal(r.falla.mensaje, MENSAJE_SIN_CONEXION_SUBIDA);
});

await prueba("subida vencida = tiempo, reintentable", () => {
  const r = clasificarSubida({ status: null, vencio: true });
  assert.equal(r.falla.tipo, "tiempo");
  assert.equal(r.falla.reintentable, true);
  assert.equal(r.falla.mensaje, MENSAJE_TIEMPO_AGOTADO);
});

await prueba("subida 502 / 504 / 429 = reintentable", () => {
  for (const status of [502, 504, 500, 429, 408]) {
    assert.equal(clasificarSubida({ status }).falla.reintentable, true, String(status));
  }
});

await prueba("subida 400 con motivo = rechazo, no reintentable, motivo tal cual", () => {
  const r = clasificarSubida({ status: 400, error: "Formato de audio no permitido (audio/x)." });
  assert.equal(r.falla.tipo, "rechazo");
  assert.equal(r.falla.reintentable, false);
  assert.match(r.falla.mensaje, /Formato de audio no permitido/);
});

await prueba("envio ok", () => {
  assert.deepEqual(clasificarEnvio({ resultado: { ok: true } }), { ok: true, valor: true });
});

await prueba("envio con error del servidor NO se reintenta y muestra el detalle", () => {
  const r = clasificarEnvio({ resultado: { error: "No se pudo enviar la nota de voz: fuera de la ventana de 24 h" } });
  assert.equal(r.falla.reintentable, false);
  assert.equal(r.falla.mensaje, "WhatsApp no aceptó el audio: fuera de la ventana de 24 h");
});

await prueba("envio con excepcion de red = reintentable", () => {
  const r = clasificarEnvio({ excepcion: true });
  assert.equal(r.falla.reintentable, true);
  assert.equal(r.falla.mensaje, MENSAJE_SIN_CONEXION_ENVIO);
});

await prueba("envio con respuesta vacia = reintentable", () => {
  assert.equal(clasificarEnvio({ resultado: undefined }).falla.reintentable, true);
});

await prueba("conUnReintento: falla reintentable y luego ok = 2 intentos, ok", async () => {
  let llamadas = 0;
  let esperado = 0;
  const r = await conUnReintento(
    async () => {
      llamadas += 1;
      return llamadas === 1 ? clasificarEnvio({ excepcion: true }) : clasificarEnvio({ resultado: { ok: true } });
    },
    { esperaMs: 2000, esperar: async (ms) => { esperado = ms; } },
  );
  assert.equal(r.ok, true);
  assert.equal(r.intentos, 2);
  assert.equal(llamadas, 2);
  assert.equal(esperado, 2000);
});

await prueba("conUnReintento: error de negocio = 1 solo intento (sin duplicado)", async () => {
  let llamadas = 0;
  const r = await conUnReintento(async () => {
    llamadas += 1;
    return clasificarEnvio({ resultado: { error: "Numero invalido" } });
  }, sinEspera);
  assert.equal(r.ok, false);
  assert.equal(r.intentos, 1);
  assert.equal(llamadas, 1);
});

await prueba("conUnReintento: dos fallas de red = se rinde a los 2 intentos", async () => {
  let llamadas = 0;
  const r = await conUnReintento(async () => {
    llamadas += 1;
    return clasificarSubida({ status: null });
  }, sinEspera);
  assert.equal(r.ok, false);
  assert.equal(r.intentos, 2);
  assert.equal(llamadas, 2);
});

await prueba("conUnReintento: ok al primero = 1 intento", async () => {
  const r = await conUnReintento(async () => clasificarSubida({ status: 201, url: "/x" }), sinEspera);
  assert.equal(r.intentos, 1);
  assert.equal(r.valor, "/x");
});

console.log(`\n${pruebas} pruebas ok`);
