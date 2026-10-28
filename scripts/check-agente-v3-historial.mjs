// Pruebas del historial del libro V3 (src/features/agente-v3/servicios/almacen.ts) con un prisma FALSO: cada fila
// muestra el número de la versión que DEJÓ el cambio (318 · "el cambio que creó la 318"), las filas viejas
// (sin versionResultante, como las que hay hoy en producción) se leen igual de bien, y volver a una versión
// restaura exactamente esa versión. No necesita base ni red.
// Correr: npm run test:agente-v3-historial
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

const ajustes = new Map();
const falso = {
  appSetting: {
    findUnique: async ({ where }) => (ajustes.has(where.key) ? { key: where.key, value: ajustes.get(where.key) } : null),
    upsert: async ({ where, create, update }) => {
      ajustes.set(where.key, ajustes.has(where.key) ? update.value : create.value);
    },
  },
  $transaction: async (operaciones) => Promise.all(operaciones),
};
const almacen = cargar("src/features/agente-v3/servicios/almacen.ts", { "@/lib/prisma": { prisma: falso } });

let pruebas = 0;
async function prueba(nombre, fn) {
  ajustes.clear();
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const regla = (id) => ({ id, nombre: `Regla ${id}`, cuando: { palabras: [`palabra ${id}`] }, entonces: [], activa: true });
const libroCon = (version, ids) => ({ version, actualizadoEl: "2026-10-27T00:00:00.000Z", comoHablamos: "", reglas: ids.map(regla) });

await prueba("guardar: la fila nueva dice la versión que resultó (318) con el resumen y autor de ESE cambio", async () => {
  ajustes.set("agente-v3:libro:ws1", JSON.stringify(libroCon(317, ["a"])));
  const { version } = await almacen.guardarLibro({ workspaceId: "ws1", libro: libroCon(317, ["a", "b"]), autor: "Claude", resumen: "Regla nueva: combo camilla" });
  assert.equal(version, 318);
  const historial = await almacen.leerHistorialDelLibro("ws1");
  assert.equal(historial.length, 1);
  // Se sigue guardando la foto de antes (para volver atrás), ahora con la versión resultante anotada.
  assert.equal(historial[0].version, 317);
  assert.equal(historial[0].versionResultante, 318);
  assert.equal(historial[0].libro.reglas.length, 1);
  const actual = await almacen.leerLibro("ws1");
  const [cambio] = almacen.cambiosDelHistorial(actual, historial);
  assert.deepEqual(
    { version: cambio.version, anterior: cambio.anterior, autor: cambio.autor, resumen: cambio.resumen, reglas: cambio.reglas },
    { version: 318, anterior: 317, autor: "Claude", resumen: "Regla nueva: combo camilla", reglas: 2 },
  );
});

await prueba("filas VIEJAS (sin versionResultante, como las de producción) se muestran con version + 1", async () => {
  // Así quedó guardado hasta hoy: {version: anterior, libro: anterior, resumen/autor del cambio nuevo}.
  const viejas = [
    { version: 317, at: "2026-10-27T20:00:00.000Z", autor: "Claude", resumen: "Cambio que creó la 318", libro: libroCon(317, ["a", "b"]) },
    { version: 316, at: "2026-10-27T19:00:00.000Z", autor: "Alex", resumen: "Cambio que creó la 317", libro: libroCon(316, ["a"]) },
  ];
  const actual = libroCon(318, ["a", "b", "c"]);
  const cambios = almacen.cambiosDelHistorial(actual, viejas);
  assert.deepEqual(cambios.map((c) => `${c.version} · ${c.resumen} · ${c.autor} · ${c.reglas}`), [
    "318 · Cambio que creó la 318 · Claude · 3",
    "317 · Cambio que creó la 317 · Alex · 2",
  ]);
  assert.equal(almacen.versionResultanteDe({ version: 0 }), 1);
  assert.equal(almacen.versionResultanteDe({ version: 9, versionResultante: 10 }), 10);
});

await prueba("historial mezclado (filas nuevas encima de viejas) sigue en orden y sin huecos", async () => {
  ajustes.set("agente-v3:libro:ws1", JSON.stringify(libroCon(318, ["a", "b", "c"])));
  ajustes.set(
    "agente-v3:historial:ws1",
    JSON.stringify([{ version: 317, at: "2026-10-27T20:00:00.000Z", autor: "Claude", resumen: "Cambio que creó la 318", libro: libroCon(317, ["a", "b"]) }]),
  );
  await almacen.guardarLibro({ workspaceId: "ws1", libro: libroCon(318, ["a"]), autor: "Alex", resumen: "Quitó dos reglas" });
  const cambios = almacen.cambiosDelHistorial(await almacen.leerLibro("ws1"), await almacen.leerHistorialDelLibro("ws1"));
  assert.deepEqual(cambios.map((c) => `${c.version}<-${c.anterior} ${c.resumen} (${c.reglas})`), ["319<-318 Quitó dos reglas (1)", "318<-317 Cambio que creó la 318 (3)"]);
});

await prueba("volver a una versión restaura EXACTAMENTE esa versión (con filas viejas y nuevas)", async () => {
  ajustes.set("agente-v3:libro:ws1", JSON.stringify(libroCon(316, ["a"])));
  await almacen.guardarLibro({ workspaceId: "ws1", libro: libroCon(316, ["a", "b"]), autor: "Claude", resumen: "Crea la 317" });
  await almacen.guardarLibro({ workspaceId: "ws1", libro: libroCon(317, ["a", "b", "c"]), autor: "Claude", resumen: "Crea la 318" });
  // La 317 tenía las reglas a y b.
  const vuelta = await almacen.volverAVersion({ workspaceId: "ws1", version: 317, autor: "Alex" });
  assert.deepEqual(vuelta, { ok: true, version: 319 });
  const actual = await almacen.leerLibro("ws1");
  assert.deepEqual(actual.reglas.map((r) => r.id), ["a", "b"]);
  const [ultimo] = almacen.cambiosDelHistorial(actual, await almacen.leerHistorialDelLibro("ws1"));
  assert.equal(ultimo.version, 319);
  assert.equal(ultimo.resumen, "Volvió a la versión 317");
  // La 316 (foto de una fila) también; la actual no hace falta; una que no existe, error claro.
  assert.equal((await almacen.volverAVersion({ workspaceId: "ws1", version: 316, autor: "Alex" })).ok, true);
  assert.deepEqual((await almacen.leerLibro("ws1")).reglas.map((r) => r.id), ["a"]);
  assert.equal((await almacen.volverAVersion({ workspaceId: "ws1", version: 320, autor: "Alex" })).ok, false);
  assert.equal((await almacen.volverAVersion({ workspaceId: "ws1", version: 99, autor: "Alex" })).ok, false);
});

console.log(`\n${pruebas} pruebas del historial del libro V3 ok`);
