// Pruebas de "Chats mas rapido" (26-11-2026). Va por partes; cada parte agrega su seccion abajo.
//
// - Parte 1: la linea [timing] de conServerTiming (src/lib/server-timing.ts) trae retrasoEventLoop
//   (p99 y maximo en ms del retraso del event loop de Node desde el pedido anterior), y si el monitor
//   falla el pedido igual responde y la linea sale sin ese campo. No va en la cabecera Server-Timing.
// - Partes 2, 3 y 4: sus pruebas van en las secciones de abajo.
// No toca ninguna base. Correr: npm run test:chats-mas-rapido
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

let fallas = 0;
async function prueba(nombre, fn) {
  try {
    await fn();
    console.log(`ok   ${nombre}`);
  } catch (error) {
    fallas += 1;
    console.error(`FALLA ${nombre}\n${error?.stack ?? error}`);
  }
}

/* ------------------------------------------------------------------------------------------------
   Cargador de src/ con los alias @/ (como las otras check-*.mjs). Cada llamada arma una copia nueva
   de los modulos, asi cada prueba tiene su propio monitor del event loop.
------------------------------------------------------------------------------------------------ */
function cargadorDeSrc(reemplazos = {}) {
  const modulos = new Map();
  const resolver = (base) => {
    for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
      const f = base + ext;
      if (fs.existsSync(f) && fs.statSync(f).isFile()) return f;
    }
    return null;
  };
  function requerir(spec, desde) {
    if (reemplazos[spec]) return reemplazos[spec];
    const archivo = spec.startsWith("@/")
      ? resolver(path.join(raiz, "src", spec.slice(2)))
      : spec.startsWith(".")
        ? resolver(path.resolve(path.dirname(desde), spec))
        : null;
    if (!archivo || !/\.tsx?$/.test(archivo)) return require(archivo ?? spec);
    if (modulos.has(archivo)) return modulos.get(archivo).exports;
    const mod = { exports: {} };
    modulos.set(archivo, mod);
    const salida = ts.transpileModule(fs.readFileSync(archivo, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: archivo,
    });
    new Function("exports", "require", "module", "__filename", "__dirname", salida.outputText)(
      mod.exports,
      (s) => requerir(s, archivo),
      mod,
      archivo,
      path.dirname(archivo),
    );
    return mod.exports;
  }
  return (spec) => requerir(spec, path.join(raiz, "src", "index.ts"));
}

/** Corre fn guardando lo que se escribe con console.log (las lineas [timing]). */
async function conLineas(fn) {
  const lineas = [];
  const original = console.log;
  console.log = (...args) => lineas.push(args.join(" "));
  try {
    const resultado = await fn();
    return { resultado, lineas };
  } finally {
    console.log = original;
  }
}

const lineaTiming = (lineas) => {
  const linea = lineas.find((l) => l.startsWith("[timing] "));
  assert.ok(linea, `no salio la linea [timing]; salio: ${JSON.stringify(lineas)}`);
  return JSON.parse(linea.slice("[timing] ".length));
};

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const trabarNode = (ms) => {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    // A proposito: bloquea el event loop para que el monitor tenga algo que medir.
  }
};

/* ------------------------------------------------------------------------------------------------
   Parte 1: retrasoEventLoop en la linea [timing]
------------------------------------------------------------------------------------------------ */
await prueba("parte 1: la linea [timing] trae retrasoEventLoop con p99 y max numericos (ms)", async () => {
  const { conServerTiming } = cargadorDeSrc()("@/lib/server-timing");
  const ruta = conServerTiming(
    async (_request, t) => {
      // Varias vueltas del event loop con un bloqueo en medio, para que el histograma tenga muestras.
      for (let i = 0; i < 5; i += 1) await esperar(25);
      trabarNode(120);
      await esperar(25);
      t.marca("trabajo");
      return new Response("ok", { status: 200 });
    },
    { log: "chats/list" },
  );
  const { resultado, lineas } = await conLineas(() => ruta(new Request("http://x/api/cliente/chats/list")));
  assert.equal(resultado.status, 200);
  assert.equal(await resultado.text(), "ok");
  const datos = lineaTiming(lineas);
  assert.equal(datos.ruta, "chats/list");
  assert.ok(datos.retrasoEventLoop, `falta retrasoEventLoop: ${JSON.stringify(datos)}`);
  const { p99, max } = datos.retrasoEventLoop;
  assert.equal(typeof p99, "number");
  assert.equal(typeof max, "number");
  assert.ok(Number.isInteger(p99) && Number.isInteger(max), "p99 y max van redondeados");
  assert.ok(max >= p99, `max (${max}) no puede ser menor que p99 (${p99})`);
  assert.ok(max >= 50, `el bloqueo de 120 ms tenia que verse en max (salio ${max} ms)`);
  // Solo en el log: la cabecera Server-Timing no lo trae.
  assert.doesNotMatch(resultado.headers.get("Server-Timing") ?? "", /retraso/i);
});

await prueba("parte 1: cada linea reinicia el monitor (el pedido siguiente mide desde el anterior)", async () => {
  const { conServerTiming } = cargadorDeSrc()("@/lib/server-timing");
  const lenta = conServerTiming(
    async () => {
      for (let i = 0; i < 3; i += 1) await esperar(25);
      trabarNode(150);
      await esperar(25);
      return new Response("ok");
    },
    { log: "chats/counts" },
  );
  const rapida = conServerTiming(
    async () => {
      for (let i = 0; i < 5; i += 1) await esperar(25);
      return new Response("ok");
    },
    { log: "chats/counts" },
  );
  const primera = lineaTiming((await conLineas(() => lenta(new Request("http://x/a")))).lineas);
  const segunda = lineaTiming((await conLineas(() => rapida(new Request("http://x/b")))).lineas);
  assert.ok(primera.retrasoEventLoop.max >= 80, `la primera tenia que ver el bloqueo: ${primera.retrasoEventLoop.max}`);
  assert.ok(
    segunda.retrasoEventLoop.max < primera.retrasoEventLoop.max,
    `la segunda no tenia que arrastrar el bloqueo de la primera: ${segunda.retrasoEventLoop.max}`,
  );
});

await prueba("parte 1: sin log no escribe linea (y no hace falta el monitor)", async () => {
  let creados = 0;
  const perfHooks = require("node:perf_hooks");
  const { conServerTiming } = cargadorDeSrc({
    "node:perf_hooks": {
      ...perfHooks,
      monitorEventLoopDelay: (...args) => {
        creados += 1;
        return perfHooks.monitorEventLoopDelay(...args);
      },
    },
  })("@/lib/server-timing");
  const ruta = conServerTiming(async () => new Response("ok"));
  const { resultado, lineas } = await conLineas(() => ruta(new Request("http://x/")));
  assert.equal(resultado.status, 200);
  assert.equal(lineas.filter((l) => l.startsWith("[timing]")).length, 0);
  assert.equal(creados, 0);
});

await prueba("parte 1: si no se puede crear el monitor, el pedido responde y la linea sale sin el campo", async () => {
  const { conServerTiming } = cargadorDeSrc({
    "node:perf_hooks": {
      monitorEventLoopDelay: () => {
        throw new Error("monitor roto");
      },
    },
  })("@/lib/server-timing");
  const ruta = conServerTiming(async () => new Response("ok", { status: 201 }), { log: "chats/counts" });
  const { resultado, lineas } = await conLineas(() => ruta(new Request("http://x/")));
  assert.equal(resultado.status, 201);
  assert.equal(await resultado.text(), "ok");
  const datos = lineaTiming(lineas);
  assert.equal(datos.ruta, "chats/counts");
  assert.equal(datos.status, 201);
  assert.equal("retrasoEventLoop" in datos, false);
});

await prueba("parte 1: si leer el monitor falla, el pedido responde y la linea sale sin el campo", async () => {
  const { conServerTiming } = cargadorDeSrc({
    "node:perf_hooks": {
      monitorEventLoopDelay: () => ({
        enable() {},
        reset() {},
        get max() {
          throw new Error("max roto");
        },
        percentile() {
          throw new Error("percentile roto");
        },
      }),
    },
  })("@/lib/server-timing");
  const ruta = conServerTiming(async () => new Response("ok"), { log: "chats/list" });
  const { resultado, lineas } = await conLineas(() => ruta(new Request("http://x/")));
  assert.equal(resultado.status, 200);
  const datos = lineaTiming(lineas);
  assert.equal(datos.ruta, "chats/list");
  assert.equal("retrasoEventLoop" in datos, false);
  assert.equal(typeof datos.consultas, "number");
});

await prueba("parte 1: si el manejador falla, la linea 500 sale igual y el error sigue", async () => {
  const { conServerTiming } = cargadorDeSrc()("@/lib/server-timing");
  const ruta = conServerTiming(
    async () => {
      await esperar(5);
      throw new Error("se cayo");
    },
    { log: "chats/list" },
  );
  const { lineas } = await conLineas(() => assert.rejects(() => ruta(new Request("http://x/")), /se cayo/));
  const datos = lineaTiming(lineas);
  assert.equal(datos.status, 500);
  assert.equal(typeof datos.retrasoEventLoop?.p99, "number");
});

/* ------------------------------------------------------------------------------------------------
   Parte 2: (la agrega la parte 2)
------------------------------------------------------------------------------------------------ */

/* ------------------------------------------------------------------------------------------------
   Parte 3: (la agrega la parte 3)
------------------------------------------------------------------------------------------------ */

/* ------------------------------------------------------------------------------------------------
   Parte 4: (la agrega la parte 4)
------------------------------------------------------------------------------------------------ */

if (fallas > 0) {
  console.error(`\n${fallas} prueba(s) fallaron.`);
  process.exit(1);
}
console.log("\nTodas las pruebas de chats-mas-rapido pasaron.");
