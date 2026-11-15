// Pruebas de la causa cuando la IA no logra redactar (Agente V3, mensaje de respaldo, parte 1).
// Correr: npm run test:redactor-causa
//
// Carga la estrella (src/lib/sugerencia-de-respuesta.ts) y el redactor del V3 REALES transpilando el
// TypeScript, con `fetch` simulado: sin red, sin base y sin clientas. Comprueba que:
//  - el tiempo de espera, un 429, un fallo de conexión y una respuesta vacía dan causas distintas;
//  - el error que ven las asesoras en la estrella NO cambia;
//  - el redactor devuelve { porque, respondio, causa } y la nota a la asesora lleva la causa, sin
//    dejar de ser un pedido de asesor para el reparto.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const nodeRequire = createRequire(import.meta.url);
const SRC = path.resolve("src");

// --- Cargador mínimo de TypeScript con alias "@/" y reemplazos (igual que check-agente-v3-foto) -----
const cache = new Map();
function resolver(desde, especificador) {
  let base;
  if (especificador.startsWith("@/")) base = path.join(SRC, especificador.slice(2));
  else if (especificador.startsWith(".")) base = path.resolve(path.dirname(desde), especificador);
  else return null;
  for (const candidato of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (fs.existsSync(candidato) && fs.statSync(candidato).isFile()) return candidato;
  }
  throw new Error(`No encuentro ${especificador} desde ${desde}`);
}
function cargar(archivo, reemplazos) {
  if (reemplazos.has(archivo)) return reemplazos.get(archivo);
  if (cache.has(archivo)) return cache.get(archivo).exports;
  const salida = ts.transpileModule(fs.readFileSync(archivo, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: archivo,
  });
  const mod = { exports: {} };
  cache.set(archivo, mod);
  const req = (especificador) => {
    const resuelto = resolver(archivo, especificador);
    return resuelto ? cargar(resuelto, reemplazos) : nodeRequire(especificador);
  };
  new Function("exports", "require", "module", "__filename", "__dirname", salida.outputText)(
    mod.exports,
    req,
    mod,
    archivo,
    path.dirname(archivo),
  );
  return mod.exports;
}
const ruta = (relativa) => path.join(SRC, relativa);

// --- Reemplazos: la base, el libro, el catálogo y los flujos --------------------------------------
const chatFalso = {
  activeProductContext: null,
  channelId: "canal",
  messages: [
    { direction: "INBOUND", type: "TEXT", content: "Hola, ¿qué precio tiene el combo?", transcripcion: null, createdAt: new Date() },
  ],
};
const prismaFalso = {
  conversation: { findFirst: async () => chatFalso },
  message: { findMany: async () => [] },
};
const reemplazos = new Map([
  [ruta("lib/prisma.ts"), { prisma: prismaFalso }],
  [ruta("features/agente-v3/servicios/almacen.ts"), { leerLibro: async () => ({ comoHablamos: "" }) }],
  [ruta("features/agente-v3/servicios/catalogo.ts"), { catalogoActivo: async () => [], nombreLegible: (n) => n }],
  [ruta("lib/flujos-para-sugerir.ts"), { flujosParaSugerir: async () => [], mismaDireccion: (a, b) => a === b }],
]);

const { generarSugerenciaDeRespuesta } = cargar(ruta("lib/sugerencia-de-respuesta.ts"), reemplazos);
const { responderConElRedactor } = cargar(ruta("features/agente-v3/servicios/redactor.ts"), reemplazos);
const { chatNecesitaAsesora } = cargar(ruta("lib/reparto-cuando-lo-necesita.ts"), reemplazos);

// --- fetch simulado: cada prueba dice qué hace la IA ----------------------------------------------
process.env.OPENAI_API_KEY = "clave-falsa-de-prueba";
let iaHace = async () => {
  throw new Error("la prueba no configuró la IA");
};
let llamadas = 0;
globalThis.fetch = async (url, opciones) => {
  llamadas += 1;
  assert.equal(String(url), "https://api.openai.com/v1/chat/completions", "no llama a otra dirección");
  assert.ok(opciones?.signal, "la llamada lleva el plazo de 25 s");
  return iaHace();
};
const respuestaJson = (status, cuerpo) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });
const conTexto = (texto) => respuestaJson(200, { choices: [{ message: { content: JSON.stringify({ texto, falta_dato: false }) } }] });

const CASOS = {
  "tiempo de espera": async () => {
    // Lo mismo que lanza AbortSignal.timeout cuando vence el plazo.
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  },
  "la IA respondió 429": async () => respuestaJson(429, { error: { message: "Rate limit" } }),
  "la IA respondió 500": async () => respuestaJson(500, { error: { message: "Server error" } }),
  "fallo de conexión": async () => {
    throw new TypeError("fetch failed");
  },
  "respuesta vacía": async () => respuestaJson(200, { choices: [{ message: { content: "" } }] }),
};

// Los logs de la causa se guardan para comprobarlos (y no ensucian la salida).
const logs = [];
const logOriginal = console.log;
const warnOriginal = console.warn;
console.log = (...args) => logs.push(args);
console.warn = (...args) => logs.push(args);

let pruebas = 0;
async function prueba(nombre, fn) {
  try {
    await fn();
    pruebas += 1;
    logOriginal(`ok - ${nombre}`);
  } catch (error) {
    console.log = logOriginal;
    console.warn = warnOriginal;
    console.error(`FALLA - ${nombre}`);
    throw error;
  }
}

const ERROR_DE_LA_ESTRELLA = "No se pudo generar la sugerencia. Inténtalo de nuevo.";
const pedirSugerencia = () =>
  generarSugerenciaDeRespuesta({ workspaceId: "ws", fuente: "agent", conversationId: "cv", conFlujos: false });

// --- (a) La estrella: cada fallo trae su causa, y el error que ven las asesoras no cambia ----------
const causasVistas = new Set();
for (const [causa, hacer] of Object.entries(CASOS)) {
  await prueba(`(a) estrella: ${causa}`, async () => {
    iaHace = hacer;
    llamadas = 0;
    logs.length = 0;
    const resultado = await pedirSugerencia();
    assert.equal(resultado.error, ERROR_DE_LA_ESTRELLA, "el mensaje de la estrella no cambia");
    assert.equal(resultado.causa, causa);
    assert.equal(llamadas, 1, "sin reintentos");
    assert.ok(
      logs.some((linea) => linea[0] === "[sugerencia] la IA no redactó" && linea[1]?.causa === causa),
      "la causa se escribe en el log",
    );
    assert.ok(!JSON.stringify(logs).includes("clave-falsa-de-prueba"), "la clave no sale en los logs");
    causasVistas.add(resultado.causa);
  });
}

await prueba("(a) tiempo de espera, 429 y respuesta vacía dan causas distintas", () => {
  for (const causa of ["tiempo de espera", "la IA respondió 429", "respuesta vacía"]) assert.ok(causasVistas.has(causa), causa);
  assert.equal(causasVistas.size, Object.keys(CASOS).length);
});

await prueba("(a) el texto que queda vacío después de los arreglos también es 'respuesta vacía'", async () => {
  // Solo comillas: leerRespuesta las quita y no queda nada.
  iaHace = async () => respuestaJson(200, { choices: [{ message: { content: JSON.stringify({ texto: "\"\"" }) } }] });
  const resultado = await pedirSugerencia();
  assert.equal(resultado.error, ERROR_DE_LA_ESTRELLA);
  assert.equal(resultado.causa, "respuesta vacía");
});

await prueba("(a) si la IA redacta, la estrella devuelve el texto sin error ni causa", async () => {
  iaHace = async () => conTexto("Con gusto te cuento del *combo*. ¿En qué *ciudad* estás?");
  const resultado = await pedirSugerencia();
  assert.ok(!("error" in resultado), JSON.stringify(resultado));
  assert.ok(!("causa" in resultado));
  assert.match(resultado.texto, /combo/);
});

// --- (b) El redactor del V3: { porque, respondio, causa } y la nota con la causa --------------------
function herramientas() {
  const registro = { enviados: [], avisos: [], pausas: 0 };
  return {
    registro,
    entrada: {
      workspaceId: "ws",
      conversationId: "cv",
      enviarTexto: async (texto) => {
        registro.enviados.push(texto);
        return true;
      },
      avisarAsesor: async (motivo) => {
        registro.avisos.push(motivo);
      },
      yaLoDijimos: async () => false,
      pausarIa: async () => {
        registro.pausas += 1;
      },
    },
  };
}
// Lo que hace avisarAsesor en el webhook y en retomar: antepone el prefijo que busca el reparto.
const notaDelChat = (motivo) => `El agente pide un asesor: ${motivo}`;

for (const causa of ["tiempo de espera", "la IA respondió 429", "respuesta vacía"]) {
  await prueba(`(b) redactor: ${causa} → no respondió, la nota dice la causa`, async () => {
    iaHace = CASOS[causa];
    const { registro, entrada } = herramientas();
    const resultado = await responderConElRedactor(entrada);
    assert.equal(resultado.respondio, false);
    assert.equal(resultado.causa, causa);
    assert.equal(typeof resultado.porque, "string");
    assert.equal(registro.enviados.length, 0, "a la clienta no le llega nada (todavía no hay respaldo)");
    assert.deepEqual(registro.avisos, [`El agente no pudo redactar una respuesta (${causa}): que conteste una persona`]);
    assert.equal(registro.pausas, 0, "como hoy: un fallo de la IA no pausa");
    const decision = chatNecesitaAsesora([
      { direction: "INBOUND", type: "TEXT", content: "Hola", createdAt: new Date() },
      { direction: "OUTBOUND", type: "SYSTEM", content: notaDelChat(registro.avisos[0]), createdAt: new Date() },
    ]);
    assert.equal(decision.motivo, "agente_pide_asesora", "el reparto la sigue viendo como pedido de asesor");
  });
}

await prueba("(b) redactor: un error de la base no pone su detalle en la nota", async () => {
  const original = prismaFalso.conversation.findFirst;
  prismaFalso.conversation.findFirst = async () => {
    throw new Error("PrismaClientKnownRequestError: conexión rechazada a 10.0.0.1");
  };
  try {
    const { registro, entrada } = herramientas();
    const resultado = await responderConElRedactor(entrada);
    assert.equal(resultado.respondio, false);
    assert.equal(resultado.causa, "error interno");
    assert.deepEqual(registro.avisos, ["El agente no pudo redactar una respuesta (error interno): que conteste una persona"]);
  } finally {
    prismaFalso.conversation.findFirst = original;
  }
});

await prueba("(b) redactor: el filtro frena el texto → no respondió y pausa la IA, como hoy", async () => {
  // Menciona mayorista: el filtro no lo deja salir (ni tras las dos correcciones).
  iaHace = async () => conTexto("Te doy el precio al por mayor de $500.000. ¿Lo quieres?");
  const { registro, entrada } = herramientas();
  const resultado = await responderConElRedactor(entrada);
  assert.equal(resultado.respondio, false);
  assert.equal(resultado.causa, null);
  assert.equal(registro.enviados.length, 0);
  assert.equal(registro.pausas, 1);
  assert.match(registro.avisos[0], /sin inventar un dato/);
});

await prueba("(b) redactor: iba a repetir un mensaje → no respondió", async () => {
  iaHace = async () => conTexto("Con gusto te cuento del *combo*. ¿En qué *ciudad* estás?");
  const { registro, entrada } = herramientas();
  const resultado = await responderConElRedactor({ ...entrada, yaLoDijimos: async () => true });
  assert.equal(resultado.respondio, false);
  assert.equal(resultado.causa, null);
  assert.equal(registro.enviados.length, 0);
  assert.match(registro.avisos[0], /repetir un mensaje/);
});

await prueba("(b) redactor: la IA redacta → respondió, sin causa ni aviso", async () => {
  iaHace = async () => conTexto("Con gusto te cuento del *combo*. ¿En qué *ciudad* estás?");
  const { registro, entrada } = herramientas();
  const resultado = await responderConElRedactor(entrada);
  assert.equal(resultado.respondio, true);
  assert.equal(resultado.causa, null);
  assert.equal(resultado.porque, "Respondió el redactor: ninguna regla del libro aplicaba.");
  assert.equal(registro.enviados.length, 1);
  assert.equal(registro.avisos.length, 0);
});

console.log = logOriginal;
console.warn = warnOriginal;
console.log(`\n${pruebas} pruebas ok`);
