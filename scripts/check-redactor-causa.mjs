// Pruebas de la causa de falla del redactor (la IA del V3 y la estrella ✨).
// Cuando la IA no logra redactar, redactarSugerencia devuelve { causa } con una de cuatro causas, y
// generarSugerenciaDeRespuesta devuelve el mismo error de siempre para las asesoras, con la causa al lado.
// Sin base, sin red y sin clientas: fetch, prisma, el libro, el catálogo y los flujos son falsos.
// Correr: npm run test:redactor-causa
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const nodeRequire = createRequire(import.meta.url);
const SRC = path.resolve("src");

// --- Cargador mínimo de TypeScript con alias "@/" y reemplazos (el de check-agente-v3-foto.mjs) ----
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

// --- Piezas falsas en vez de la base y del libro --------------------------------------------------
const ahora = new Date("2026-11-27T15:00:00Z");
const prismaFalso = {
  conversation: {
    findFirst: async () => ({
      activeProductContext: null,
      channelId: "linea-1",
      messages: [{ direction: "INBOUND", type: "TEXT", content: "hola, ¿qué precio tiene?", transcripcion: null, createdAt: ahora }],
    }),
  },
  message: { findMany: async () => [] },
  product: { findFirst: async () => null },
};
const reemplazos = new Map([
  [ruta("lib/prisma.ts"), { prisma: prismaFalso }],
  [ruta("features/agente-v3/servicios/almacen.ts"), { leerLibro: async () => null }],
  [ruta("features/agente-v3/servicios/catalogo.ts"), { catalogoActivo: async () => [], nombreLegible: (n) => n }],
  [ruta("lib/flujos-para-sugerir.ts"), { flujosParaSugerir: async () => [], mismaDireccion: () => false }],
]);
const sugerencia = cargar(ruta("lib/sugerencia-de-respuesta.ts"), reemplazos);
const { redactarSugerencia, generarSugerenciaDeRespuesta, ERROR_AL_GENERAR_SUGERENCIA } = sugerencia;

// --- fetch falso: cada prueba dice qué hace la "IA" -----------------------------------------------
const fetchOriginal = globalThis.fetch;
let llamadas = 0;
function iaFalsa(responder) {
  llamadas = 0;
  globalThis.fetch = async (url) => {
    llamadas += 1;
    assert.equal(String(url), "https://api.openai.com/v1/chat/completions", "no sale a otra dirección");
    return responder(llamadas);
  };
}
const conContenido = (contenido) =>
  new Response(JSON.stringify({ choices: [{ message: { content: contenido } }] }), { status: 200 });
const errorConNombre = (nombre) => Object.assign(new Error(`simulado ${nombre}`), { name: nombre });

// Lo que se anota en el registro, para comprobar la marca [sugerencia].
const avisos = [];
const warnOriginal = console.warn;
console.warn = (...partes) => avisos.push(partes.map(String).join(" "));

const redactar = () =>
  redactarSugerencia({
    apiKey: "falsa",
    comoHablamos: "",
    producto: null,
    catalogo: [],
    lineas: [{ de: "cliente", texto: "hola, ¿qué precio tiene?", en: ahora }],
    enviado: { resumen: "", flujosEnviados: new Set() },
    flujos: [],
    ahora,
  });

const casos = [
  {
    nombre: "fetch lanza TimeoutError → tiempo de espera",
    ia: () => {
      throw errorConNombre("TimeoutError");
    },
    causa: "tiempo de espera",
  },
  {
    nombre: "fetch lanza AbortError → tiempo de espera",
    ia: () => {
      throw errorConNombre("AbortError");
    },
    causa: "tiempo de espera",
  },
  {
    nombre: "la IA responde 429 → la IA respondió 429",
    ia: () => new Response("{}", { status: 429 }),
    causa: "la IA respondió 429",
  },
  {
    nombre: "la IA responde 500 → la IA respondió 500",
    ia: () => new Response("{}", { status: 500 }),
    causa: "la IA respondió 500",
  },
  {
    nombre: "fetch lanza TypeError → fallo de conexión",
    ia: () => {
      throw new TypeError("fetch failed");
    },
    causa: "fallo de conexión",
  },
  {
    nombre: "JSON sin choices[0].message.content → respuesta vacía",
    ia: () => new Response(JSON.stringify({ choices: [] }), { status: 200 }),
    causa: "respuesta vacía",
  },
  {
    nombre: "texto que queda vacío después de los arreglos → respuesta vacía",
    ia: () => conContenido(JSON.stringify({ texto: "   ", flujo_id: null, falta_dato: false })),
    causa: "respuesta vacía",
    // La IA sí respondió: pasa por las dos correcciones de siempre (no son reintentos nuevos).
    llamadas: 3,
  },
];

let fallas = 0;
async function probar(nombre, fn) {
  try {
    await fn();
    warnOriginal(`ok   - ${nombre}`);
  } catch (error) {
    fallas += 1;
    warnOriginal(`FALLA - ${nombre}\n${error instanceof Error ? error.stack : String(error)}`);
  }
}

for (const caso of casos) {
  await probar(`redactarSugerencia: ${caso.nombre}`, async () => {
    avisos.length = 0;
    iaFalsa(caso.ia);
    const resultado = await redactar();
    assert.deepEqual(resultado, { causa: caso.causa });
    assert.equal(llamadas, caso.llamadas ?? 1, "sin reintentos");
    assert.ok(
      avisos.some((linea) => linea.startsWith("[sugerencia]") && linea.includes(caso.causa)),
      `el registro anota la causa con [sugerencia]: ${avisos.join(" | ")}`,
    );
  });
}

await probar("con una respuesta normal, redactarSugerencia sigue devolviendo texto", async () => {
  iaFalsa(() => conContenido(JSON.stringify({ texto: "¡Hola! Con gusto te cuento, ¿cuál producto te interesa?", flujo_id: null, falta_dato: false })));
  const resultado = await redactar();
  assert.ok("texto" in resultado, JSON.stringify(resultado));
  assert.match(resultado.texto, /cuál producto te interesa/);
  assert.equal(resultado.causa, undefined);
});

await probar("si falla la corrección, sigue con el borrador anterior (no devuelve causa)", async () => {
  // El primer borrador no termina en pregunta, así que se pide una corrección, y esa corrección falla.
  iaFalsa((n) => (n === 1 ? conContenido(JSON.stringify({ texto: "Hola, el producto vale lo que dice el catálogo.", falta_dato: false })) : new Response("{}", { status: 503 })));
  const resultado = await redactar();
  assert.ok(llamadas >= 2, "pidió corregir");
  assert.ok("texto" in resultado, JSON.stringify(resultado));
});

await probar("la constante del error de la estrella no cambia", () => {
  assert.equal(ERROR_AL_GENERAR_SUGERENCIA, "No se pudo generar la sugerencia. Inténtalo de nuevo.");
});

await probar("generarSugerenciaDeRespuesta: mismo error para las asesoras, con la causa al lado", async () => {
  const claveOriginal = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "falsa";
  try {
    iaFalsa(() => new Response("{}", { status: 429 }));
    const resultado = await generarSugerenciaDeRespuesta({ workspaceId: "ws", fuente: "agent", conversationId: "c1" });
    assert.deepEqual(resultado, {
      error: "No se pudo generar la sugerencia. Inténtalo de nuevo.",
      causa: "la IA respondió 429",
    });
  } finally {
    if (claveOriginal === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = claveOriginal;
  }
});

// --- responderConElRedactor (el redactor del V3) con generarSugerenciaDeRespuesta simulado --------
let sugerenciaSimulada = null;
const { responderConElRedactor } = cargar(
  ruta("features/agente-v3/servicios/redactor.ts"),
  new Map([[ruta("lib/sugerencia-de-respuesta.ts"), { generarSugerenciaDeRespuesta: async () => sugerenciaSimulada() }]]),
);
function herramientasDelRedactor({ yaLoDijimos = false, saleElEnvio = true } = {}) {
  const registro = { enviados: [], avisos: [], pausas: 0 };
  return {
    registro,
    input: {
      workspaceId: "ws",
      conversationId: "cv",
      enviarTexto: async (texto) => {
        registro.enviados.push(texto);
        return saleElEnvio;
      },
      avisarAsesor: async (motivo) => {
        registro.avisos.push(motivo);
      },
      yaLoDijimos: async () => yaLoDijimos,
      pausarIa: async () => {
        registro.pausas += 1;
      },
    },
  };
}

await probar("redactor: si la IA falla, no responde y la nota dice la causa", async () => {
  sugerenciaSimulada = () => ({ error: ERROR_AL_GENERAR_SUGERENCIA, causa: "tiempo de espera" });
  const { registro, input } = herramientasDelRedactor();
  const resultado = await responderConElRedactor(input);
  assert.equal(resultado.respondio, false);
  assert.equal(resultado.causa, "tiempo de espera");
  assert.deepEqual(registro.avisos, ["El agente no pudo redactar una respuesta (tiempo de espera): que conteste una persona"]);
  assert.equal(registro.enviados.length, 0);
  assert.match(resultado.porque, /El redactor no pudo responder/);
});

await probar("redactor: si generar lanza una excepción, la causa es su mensaje", async () => {
  sugerenciaSimulada = () => {
    throw new Error("se cayó todo");
  };
  const { registro, input } = herramientasDelRedactor();
  const resultado = await responderConElRedactor(input);
  assert.equal(resultado.respondio, false);
  assert.equal(resultado.causa, "se cayó todo");
  assert.deepEqual(registro.avisos, ["El agente no pudo redactar una respuesta (se cayó todo): que conteste una persona"]);
});

await probar("redactor: si el filtro frena el texto, no responde y pausa la IA", async () => {
  sugerenciaSimulada = () => ({ texto: "Vale $10.000", flujo: null, faltaDato: false, problemas: ["inventa un precio"] });
  const { registro, input } = herramientasDelRedactor();
  const resultado = await responderConElRedactor(input);
  assert.equal(resultado.respondio, false);
  assert.equal(resultado.causa, null);
  assert.equal(registro.enviados.length, 0);
  assert.equal(registro.pausas, 1);
  assert.deepEqual(registro.avisos, ["El agente no pudo responder sin inventar un dato: que conteste una persona"]);
});

await probar("redactor: si iba a repetir un mensaje, no responde", async () => {
  sugerenciaSimulada = () => ({ texto: "Hola, ¿en qué ciudad estás?", flujo: null, faltaDato: false, problemas: [] });
  const { registro, input } = herramientasDelRedactor({ yaLoDijimos: true });
  const resultado = await responderConElRedactor(input);
  assert.equal(resultado.respondio, false);
  assert.equal(resultado.causa, null);
  assert.equal(registro.enviados.length, 0);
});

await probar("redactor: si el envío no sale, no responde", async () => {
  sugerenciaSimulada = () => ({ texto: "Hola, ¿en qué ciudad estás?", flujo: null, faltaDato: false, problemas: [] });
  const { input } = herramientasDelRedactor({ saleElEnvio: false });
  const resultado = await responderConElRedactor(input);
  assert.equal(resultado.respondio, false);
  assert.equal(resultado.causa, null);
});

await probar("redactor: si se envía bien, respondió y sin causa", async () => {
  sugerenciaSimulada = () => ({ texto: "Hola, ¿en qué ciudad estás?", flujo: null, faltaDato: false, problemas: [] });
  const { registro, input } = herramientasDelRedactor();
  const resultado = await responderConElRedactor(input);
  assert.deepEqual(resultado, { porque: "Respondió el redactor: ninguna regla del libro aplicaba.", respondio: true, causa: null });
  assert.equal(registro.enviados.length, 1);
  assert.equal(registro.avisos.length, 0);
});

await probar("redactor: si se envía bien pero falta un dato, respondió y pausa la IA", async () => {
  sugerenciaSimulada = () => ({ texto: "Te confirmo el envío. ¿En qué ciudad estás?", flujo: null, faltaDato: true, problemas: [] });
  const { registro, input } = herramientasDelRedactor();
  const resultado = await responderConElRedactor(input);
  assert.equal(resultado.respondio, true);
  assert.equal(resultado.causa, null);
  assert.equal(registro.pausas, 1);
});

globalThis.fetch = fetchOriginal;
console.warn = warnOriginal;
if (fallas > 0) {
  console.error(`\n${fallas} prueba(s) fallaron`);
  process.exit(1);
}
console.log("\nTodas las pruebas de la causa del redactor pasaron");
