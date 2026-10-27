// Pruebas de src/lib/chat-envio-reintento.ts (envio de texto del chat sin errores, 27-10-2026).
// Correr: npm run test:envio-reintento
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const sourcePath = path.resolve("src/lib/chat-envio-reintento.ts");
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
  clasificarMotivo,
  esReintentable,
  enviarConReintento,
  nuevoIdDeMensaje,
  idDeMensajeValido,
  leerFallidos,
  guardarFallidosEnNavegador,
  cargarFallidosDelNavegador,
  crearCandadoDeEnvios,
  ESPERAS_DE_REINTENTO_MS,
} = mod.exports;

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const esperas = [];
const esperar = async (ms) => {
  esperas.push(ms);
};

await prueba("clasifica los motivos de falla", () => {
  assert.equal(clasificarMotivo('Failed to find Server Action "abc". This request might be from an older or newer deployment.'), "version_vieja");
  assert.equal(clasificarMotivo("WhatsApp no respondio a tiempo (25s)."), "timeout_gateway");
  assert.equal(clasificarMotivo("No se pudo enviar el mensaje: connection closed"), "conexion_cerrada");
  assert.equal(clasificarMotivo("TypeError: Failed to fetch"), "sin_red");
  assert.equal(clasificarMotivo("No se pudo enviar el mensaje: 404 page not found"), "gateway_rechazo");
  assert.equal(clasificarMotivo(""), "otro");
});

await prueba("solo se reintenta cuando es seguro que no salio", () => {
  for (const motivo of ["version_vieja", "sin_red", "conexion_cerrada", "gateway_rechazo"]) {
    assert.equal(esReintentable(motivo), true, motivo);
  }
  for (const motivo of ["timeout_gateway", "guardado_fallo", "sin_sesion", "otro"]) {
    assert.equal(esReintentable(motivo), false, motivo);
  }
});

await prueba("caida del gateway: reintenta 1 vez con la misma id y sale una sola vez", async () => {
  esperas.length = 0;
  const id = nuevoIdDeMensaje();
  const vistos = [];
  let salidas = 0;
  const resultado = await enviarConReintento({
    esperar,
    enviar: async (intento) => {
      vistos.push(id);
      if (intento === 1) return { ok: false, error: "No se pudo enviar el mensaje: connection closed" };
      salidas += 1;
      return { ok: true };
    },
  });
  assert.equal(resultado.ok, true);
  assert.equal(salidas, 1);
  assert.equal(vistos.length, 2);
  assert.deepEqual(esperas, [ESPERAS_DE_REINTENTO_MS[0]]);
});

await prueba("sin conexion del navegador: reintenta y no pierde el mensaje", async () => {
  esperas.length = 0;
  const anotados = [];
  let llamadas = 0;
  const resultado = await enviarConReintento({
    esperar,
    enviar: async () => {
      llamadas += 1;
      throw new TypeError("Failed to fetch");
    },
    alFallar: (info) => anotados.push(info),
  });
  assert.equal(resultado.ok, false);
  assert.equal(llamadas, 3); // 1 intento + 2 reintentos
  assert.deepEqual(esperas, [1500, 4000]);
  assert.equal(resultado.motivo, "sin_red");
  assert.equal(anotados.length, 3);
  assert.ok(anotados.every((a) => a.llegoAlServidor === false));
});

await prueba("version vieja: se reintenta y sale", async () => {
  let llamadas = 0;
  const resultado = await enviarConReintento({
    esperar,
    enviar: async () => {
      llamadas += 1;
      return llamadas < 3
        ? { ok: false, error: "Failed to find Server Action", motivo: "version_vieja" }
        : { ok: true };
    },
  });
  assert.equal(resultado.ok, true);
  assert.equal(llamadas, 3);
});

await prueba("si se agota el tiempo NO se reintenta solo: queda No se envio", async () => {
  esperas.length = 0;
  let llamadas = 0;
  const resultado = await enviarConReintento({
    esperar,
    enviar: async () => {
      llamadas += 1;
      return { ok: false, error: "WhatsApp no respondio a tiempo (25s).", motivo: "timeout_gateway" };
    },
  });
  assert.equal(llamadas, 1);
  assert.equal(resultado.ok, false);
  assert.equal(resultado.motivo, "timeout_gateway");
  assert.equal(esperas.length, 0);
});

await prueba("una falla que no es de red ni de gateway no se repite", async () => {
  let llamadas = 0;
  const resultado = await enviarConReintento({
    esperar,
    enviar: async () => {
      llamadas += 1;
      return { ok: false, error: "No autorizado", motivo: "sin_sesion" };
    },
  });
  assert.equal(llamadas, 1);
  assert.equal(resultado.ok, false);
});

await prueba("el numero unico es valido y distinto cada vez", () => {
  const a = nuevoIdDeMensaje();
  const b = nuevoIdDeMensaje();
  assert.notEqual(a, b);
  assert.equal(idDeMensajeValido(a), a);
  assert.equal(idDeMensajeValido("x"), null);
  assert.equal(idDeMensajeValido("con espacios y ñ ñ ñ"), null);
});

await prueba("el mensaje fallido se guarda y se lee del navegador sin perder el texto", () => {
  const memoria = new Map();
  const almacen = {
    getItem: (k) => memoria.get(k) ?? null,
    setItem: (k, v) => memoria.set(k, v),
    removeItem: (k) => memoria.delete(k),
  };
  const ahora = Date.now();
  const lista = [
    {
      id: "optimistic:c1:1",
      conversationId: "c1",
      content: "Hola, ¿sigue interesado?",
      createdAt: new Date(ahora - 60_000).toISOString(),
      envio: { chatKey: "agent:c1", campos: [["clientMessageId", "abc12345-xyz"], ["message", "Hola"]] },
    },
  ];
  guardarFallidosEnNavegador(almacen, "u1", lista);
  const leidos = cargarFallidosDelNavegador(almacen, "u1", ahora);
  assert.equal(leidos.length, 1);
  assert.equal(leidos[0].content, "Hola, ¿sigue interesado?");
  assert.deepEqual(leidos[0].envio.campos[0], ["clientMessageId", "abc12345-xyz"]);
  // Otra asesora en el mismo navegador no ve lo de la primera.
  assert.equal(cargarFallidosDelNavegador(almacen, "u2", ahora).length, 0);
  // Pasadas 12 h ya no se muestra.
  assert.equal(cargarFallidosDelNavegador(almacen, "u1", ahora + 13 * 3600_000).length, 0);
  // Vaciar la lista borra lo guardado.
  guardarFallidosEnNavegador(almacen, "u1", []);
  assert.equal(cargarFallidosDelNavegador(almacen, "u1", ahora).length, 0);
  // Datos rotos no revientan.
  assert.deepEqual(leerFallidos("{no es json"), []);
  assert.deepEqual(leerFallidos(JSON.stringify([{ id: 1 }])), []);
});

await prueba("el mismo numero unico no produce un segundo envio", async () => {
  const candado = crearCandadoDeEnvios(50);
  let envios = 0;
  const trabajo = async () => {
    envios += 1;
    await new Promise((r) => setTimeout(r, 20));
    return { ok: true };
  };
  const [a, b] = await Promise.all([
    candado.ejecutar("id-1", trabajo, (v) => v.ok),
    candado.ejecutar("id-1", trabajo, (v) => v.ok),
  ]);
  assert.equal(envios, 1);
  assert.deepEqual(a, b);
  // Ya enviado: un reintento posterior con la misma id tampoco vuelve a enviar.
  await candado.ejecutar("id-1", trabajo, (v) => v.ok);
  assert.equal(envios, 1);
  // Si fallo, la id se libera y Reintentar si puede volver a mandar.
  let falla = true;
  const otro = async () => {
    envios += 1;
    return falla ? { ok: false } : { ok: true };
  };
  await candado.ejecutar("id-2", otro, (v) => v.ok);
  falla = false;
  const reintento = await candado.ejecutar("id-2", otro, (v) => v.ok);
  assert.equal(reintento.ok, true);
  assert.equal(envios, 3);
});

console.log(`\n${pruebas} pruebas OK`);
