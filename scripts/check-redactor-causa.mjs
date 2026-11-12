// Pruebas: el redactor del V3 dice POR QUÉ falló la IA y si a la clienta le llegó algo.
// Sin red, sin base y sin clientas: `fetch` (OpenAI) y la base se reemplazan por unos falsos.
// Correr: npm run test:redactor-causa
//
// Carga el código REAL de src/lib/sugerencia-de-respuesta.ts y src/features/agente-v3/servicios/redactor.ts
// transpilando el TypeScript; solo se reemplaza lo que toca la base (prisma, libro, catálogo, flujos).
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const nodeRequire = createRequire(import.meta.url);
const SRC = path.resolve("src");

// --- Cargador mínimo de TypeScript con alias "@/" y reemplazos -------------------------------------
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

// --- Una conversación falsa (sin datos de clientas reales) ----------------------------------------
const ahora = Date.now();
const prismaFalso = {
  conversation: {
    findFirst: async () => ({
      activeProductContext: null,
      channelId: "canal-prueba",
      messages: [
        { direction: "INBOUND", type: "TEXT", content: "Hola, ¿cuánto vale el combo?", transcripcion: null, createdAt: new Date(ahora - 60_000) },
      ],
    }),
  },
  message: { findMany: async () => [] },
  product: { findFirst: async () => null },
};

const reemplazos = new Map([
  [ruta("lib/prisma.ts"), { prisma: prismaFalso }],
  [ruta("features/agente-v3/servicios/almacen.ts"), { leerLibro: async () => ({ comoHablamos: "" }) }],
  [ruta("features/agente-v3/servicios/catalogo.ts"), { catalogoActivo: async () => [], nombreLegible: (n) => n }],
  [ruta("lib/flujos-para-sugerir.ts"), { flujosParaSugerir: async () => [], mismaDireccion: (a, b) => a === b }],
]);

const { generarSugerenciaDeRespuesta } = cargar(ruta("lib/sugerencia-de-respuesta.ts"), reemplazos);
const { responderConElRedactor } = cargar(ruta("features/agente-v3/servicios/redactor.ts"), reemplazos);

process.env.OPENAI_API_KEY = "clave-falsa-de-prueba";
const ERROR_DE_LA_ESTRELLA = "No se pudo generar la sugerencia. Inténtalo de nuevo.";

// --- Las caras de OpenAI ---------------------------------------------------------------------------
let llamadas = 0;
const conContenido = (contenido) =>
  new Response(JSON.stringify({ choices: [{ message: { content: contenido } }] }), { status: 200 });
const OPENAI = {
  // Lo que lanza el fetch de Node cuando vence AbortSignal.timeout (los 25 s).
  "tiempo de espera": async () => {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  },
  "la IA respondió 429": async () => new Response("{}", { status: 429 }),
  "la IA respondió 500": async () => new Response("{}", { status: 500 }),
  "fallo de conexión": async () => {
    throw new TypeError("fetch failed");
  },
  "respuesta vacía": async () => conContenido(""),
  // El modelo contesta, pero el texto queda vacío después de los arreglos.
  "respuesta vacía (después de los arreglos)": async () => conContenido(JSON.stringify({ texto: '""', falta_dato: false })),
  bien: async () => conContenido(JSON.stringify({ texto: "El *combo* trae camilla, escalera, silla y auxiliar. ¿En qué *ciudad* estás?", falta_dato: false })),
};
function usar(cara) {
  globalThis.fetch = async (...args) => {
    llamadas += 1;
    return OPENAI[cara](...args);
  };
}

// Los console.log de la causa se guardan para comprobarlos (y no ensucian la salida).
const logs = [];
const logOriginal = console.log;
console.log = (...args) => logs.push(args);
const warnOriginal = console.warn;
console.warn = () => {};

let pruebas = 0;
async function prueba(nombre, fn) {
  logs.length = 0;
  llamadas = 0;
  await fn();
  pruebas += 1;
  logOriginal(`ok - ${nombre}`);
}

async function redactorCon(cara, { yaLoDijimos = false, enviar = true } = {}) {
  usar(cara);
  const registro = { avisos: [], enviados: [], pausas: 0 };
  const resultado = await responderConElRedactor({
    workspaceId: "ws",
    conversationId: "cv-prueba",
    enviarTexto: async (texto) => {
      registro.enviados.push(texto);
      return enviar;
    },
    avisarAsesor: async (motivo) => {
      registro.avisos.push(motivo);
    },
    yaLoDijimos: async () => yaLoDijimos,
    pausarIa: async () => {
      registro.pausas += 1;
    },
  });
  return { resultado, registro };
}

try {
  // --- La estrella: el error que ven las asesoras NO cambia; la causa va solo por dentro ----------
  const causasDeLaEstrella = [];
  for (const cara of ["tiempo de espera", "la IA respondió 429", "respuesta vacía"]) {
    await prueba(`estrella con "${cara}": mismo error de siempre y la causa por dentro`, async () => {
      usar(cara);
      const resultado = await generarSugerenciaDeRespuesta({ workspaceId: "ws", fuente: "agent", conversationId: "cv-prueba" });
      assert.equal(resultado.error, ERROR_DE_LA_ESTRELLA);
      assert.equal(resultado.causa, cara);
      assert.equal(llamadas, 1, "sin reintentos");
      assert.ok(
        logs.some((linea) => JSON.stringify(linea).includes(cara)),
        "la causa queda escrita en el console.log",
      );
      causasDeLaEstrella.push(resultado.causa);
    });
  }
  await prueba("las tres causas son distintas", async () => {
    assert.equal(new Set(causasDeLaEstrella).size, 3);
  });

  for (const cara of ["la IA respondió 500", "fallo de conexión", "respuesta vacía (después de los arreglos)"]) {
    await prueba(`estrella con "${cara}"`, async () => {
      usar(cara);
      const resultado = await generarSugerenciaDeRespuesta({ workspaceId: "ws", fuente: "agent", conversationId: "cv-prueba" });
      assert.equal(resultado.error, ERROR_DE_LA_ESTRELLA);
      assert.equal(resultado.causa, cara.replace(" (después de los arreglos)", ""));
    });
  }

  await prueba("la estrella con respuesta buena no trae causa ni error", async () => {
    usar("bien");
    const resultado = await generarSugerenciaDeRespuesta({ workspaceId: "ws", fuente: "agent", conversationId: "cv-prueba" });
    assert.equal(resultado.error, undefined);
    assert.equal(resultado.causa, undefined);
    assert.match(resultado.texto, /combo/);
  });

  // --- El redactor del V3 ------------------------------------------------------------------------
  for (const cara of ["tiempo de espera", "la IA respondió 429", "respuesta vacía"]) {
    await prueba(`redactor con "${cara}": no responde, la nota lleva la causa`, async () => {
      const { resultado, registro } = await redactorCon(cara);
      assert.equal(resultado.respondio, false);
      assert.equal(resultado.causa, cara);
      assert.match(resultado.porque, new RegExp(`\\(${cara}\\)`));
      assert.equal(registro.enviados.length, 0, "a la clienta no le sale nada");
      assert.deepEqual(registro.avisos, [`El agente no pudo redactar una respuesta (${cara}): que conteste una persona`]);
      assert.equal(registro.pausas, 0, "como hoy: si falla la IA no se pausa");
    });
  }

  await prueba("redactor con respuesta buena: responde, sin causa ni aviso", async () => {
    const { resultado, registro } = await redactorCon("bien");
    assert.deepEqual(resultado, { porque: "Respondió el redactor: ninguna regla del libro aplicaba.", respondio: true, causa: null });
    assert.equal(registro.enviados.length, 1);
    assert.equal(registro.avisos.length, 0);
  });

  await prueba("redactor que iba a repetir un mensaje: respondio false", async () => {
    const { resultado, registro } = await redactorCon("bien", { yaLoDijimos: true });
    assert.equal(resultado.respondio, false);
    assert.equal(resultado.causa, null);
    assert.equal(registro.enviados.length, 0);
    assert.equal(registro.avisos.length, 1);
  });

  await prueba("redactor cuyo mensaje no sale: respondio false", async () => {
    const { resultado } = await redactorCon("bien", { enviar: false });
    assert.equal(resultado.respondio, false);
  });

  await prueba("el filtro frena el texto: respondio false y la IA queda pausada (como hoy)", async () => {
    // Una política de venta que no está en el libro ni en el catálogo: el filtro la frena siempre.
    globalThis.fetch = async () => {
      llamadas += 1;
      return conContenido(JSON.stringify({ texto: "La camilla no se vende por separado, solo las piezas juntas, ¿te parece?", falta_dato: false }));
    };
    const registro = { avisos: [], enviados: [], pausas: 0 };
    const resultado = await responderConElRedactor({
      workspaceId: "ws",
      conversationId: "cv-prueba",
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
    });
    assert.equal(resultado.respondio, false);
    assert.equal(resultado.causa, null);
    assert.equal(registro.enviados.length, 0);
    assert.equal(registro.pausas, 1);
  });
} finally {
  console.log = logOriginal;
  console.warn = warnOriginal;
}

console.log(`\n${pruebas} pruebas ok`);
