// Pruebas de "Chats mas rapido" (26-11-2026). Va por partes; cada parte agrega su seccion abajo.
//
// - Parte 1: la linea [timing] de conServerTiming (src/lib/server-timing.ts) trae retrasoEventLoop
//   (p99 y maximo en ms del retraso del event loop de Node desde el pedido anterior), y si el monitor
//   falla el pedido igual responde y la linea sale sin ese campo. No va en la cabecera Server-Timing.
// - Arreglo de subida de la parte 1: /tomar y /arranque (trabajador.ts) le pasan un plazo propio a
//   prisma.$transaction, y /tomar lee los intentos y el historial despues del commit.
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
   Parte 1, arreglo de subida (26-11-2026): la vigilancia deshizo la parte 1 porque /tomar paso los 5 s
   que Prisma da por defecto a una transaccion y la lectura del historial choco con la transaccion vencida.
   /tomar y /arranque le pasan un plazo propio a prisma.$transaction, y datosDeIntentos sale de la de /tomar.
------------------------------------------------------------------------------------------------ */
function cuerpoDeFuncion(fuente, nombre) {
  const inicio = fuente.indexOf(`export async function ${nombre}(`);
  assert.ok(inicio >= 0, `no esta la funcion ${nombre}`);
  const siguiente = fuente.indexOf("\nexport ", inicio + 1);
  return fuente.slice(inicio, siguiente < 0 ? undefined : siguiente);
}

const fuenteTrabajador = fs.readFileSync(path.join(raiz, "src/features/tableros-inteligentes/services/trabajador.ts"), "utf8");

await prueba("el plazo con candado del negocio tiene timeout de 30 s o mas", () => {
  const plazo = fuenteTrabajador.match(/const PLAZO_CON_CANDADO_DEL_NEGOCIO = \{([^}]*)\}/);
  assert.ok(plazo, "falta la constante PLAZO_CON_CANDADO_DEL_NEGOCIO");
  const timeout = Number(plazo[1].match(/timeout:\s*([\d_]+)/)?.[1].replaceAll("_", ""));
  const maxWait = Number(plazo[1].match(/maxWait:\s*([\d_]+)/)?.[1].replaceAll("_", ""));
  assert.ok(timeout >= 30_000, `timeout ${timeout}`);
  assert.ok(maxWait > 0, `maxWait ${maxWait}`);
});

for (const nombre of ["tomarTarjeta", "arranqueDelTrabajador"]) {
  await prueba(`${nombre} le pasa el plazo a prisma.$transaction`, () => {
    const cuerpo = cuerpoDeFuncion(fuenteTrabajador, nombre);
    assert.match(cuerpo, /prisma\.\$transaction\(/);
    assert.match(cuerpo, /\}, PLAZO_CON_CANDADO_DEL_NEGOCIO\);/);
  });
}

await prueba("tomarTarjeta lee los intentos fuera de la transaccion", () => {
  const cuerpo = cuerpoDeFuncion(fuenteTrabajador, "tomarTarjeta");
  const finDeLaTransaccion = cuerpo.indexOf("}, PLAZO_CON_CANDADO_DEL_NEGOCIO);");
  assert.ok(finDeLaTransaccion > 0);
  assert.doesNotMatch(cuerpo, /datosDeIntentos\(tx/);
  assert.ok(cuerpo.indexOf("datosDeIntentos(prisma") > finDeLaTransaccion, "datosDeIntentos(prisma, ...) va despues del commit");
});

/**
 * Un prisma falso: $transaction guarda el plazo que recibe y corre fn con un tx que, al terminar fn, queda vencido
 * (usarlo despues falla como en produccion). Las consultas crudas de /tomar responden en orden: el candado, vencidas,
 * madres partidas, huerfanas, las que estan en curso, la tomada y sus ancestros.
 */
function prismaFalso({ tomada }) {
  const plazos = [];
  const fila = {
    id: "t1",
    tableroId: "b1",
    titulo: "Tarjeta",
    detalle: "",
    plan: "plan",
    resultado: null,
    estado: "EN_CURSO",
    repo: "aizencrm",
    zonaProtegida: [],
    riesgo: null,
    riesgoMotivo: null,
    intentos: 1,
    reparaciones: 0,
    trabajoVenceEn: null,
    tablero: { nombre: "Tablero" },
  };
  const modelos = (alUsar) =>
    new Proxy(
      {},
      {
        get: (_o, modelo) =>
          new Proxy(
            {},
            {
              get: (_m, metodo) => async () => {
                alUsar(`${String(modelo)}.${String(metodo)}`);
                if (modelo === "tarjetaTablero" && metodo === "findUniqueOrThrow") return fila;
                if (modelo === "intentoTarjeta" && metodo === "findMany")
                  return [{ numero: 1, etapa: "construir", categoria: "otra", causa: "c", error: "se cayo", accion: "reintentar", cuentaComoIntento: true }];
                if (metodo === "findMany") return [];
                if (metodo === "updateMany" || metodo === "createMany") return { count: 0 };
                return {};
              },
            },
          ),
      },
    );
  const usadosFuera = [];
  const base = modelos((uso) => usadosFuera.push(uso));
  const prisma = new Proxy(
    {},
    {
      get: (_o, clave) => {
        if (clave === "$transaction")
          return async (fn, plazo) => {
            plazos.push(plazo);
            let vencida = false;
            const respuestas = [[], [], [], [], [], tomada ? [{ id: "t1", tableroId: "b1", antes: "APROBADO", estado: "EN_CURSO" }] : [], [{ id: "t1", ancestros: [] }]];
            const usar = (uso) => {
              if (vencida) throw new Error(`Transaction API error: ${uso} on an expired transaction`);
            };
            const modelosTx = modelos(usar);
            const tx = new Proxy(
              {},
              {
                get: (_t, k) => {
                  if (k === "$queryRawUnsafe") return async () => (usar("$queryRawUnsafe"), respuestas.shift() ?? []);
                  if (k === "$executeRawUnsafe") return async () => (usar("$executeRawUnsafe"), 0);
                  return modelosTx[k];
                },
              },
            );
            try {
              return await fn(tx);
            } finally {
              vencida = true;
            }
          };
        if (clave === "$queryRawUnsafe") return async () => (usadosFuera.push("$queryRawUnsafe"), []);
        return base[clave];
      },
    },
  );
  return { prisma, plazos, usadosFuera };
}

const cargarTrabajador = (falso) =>
  cargadorDeSrc({ "@/lib/prisma": { prisma: falso.prisma } })("@/features/tableros-inteligentes/services/trabajador");

await prueba("tomarTarjeta: pasa el plazo, lee los intentos despues del commit y la respuesta trae los datos de intentos", async () => {
  const falso = prismaFalso({ tomada: true });
  const { tomarTarjeta } = cargarTrabajador(falso);
  const respuesta = await tomarTarjeta({ claveId: "c1", workspaceId: "w1", nombre: "Coordinador" }, {});
  assert.equal(falso.plazos.length, 1);
  assert.ok(falso.plazos[0]?.timeout >= 30_000 && falso.plazos[0]?.maxWait > 0, JSON.stringify(falso.plazos[0]));
  assert.equal(respuesta.hacer, "construir");
  assert.equal(respuesta.tarjeta.id, "t1");
  for (const campo of ["ultimosIntentos", "esperasSeguidas", "esParte", "ultimoError", "planAprobadoPorElDueno"]) {
    assert.ok(campo in respuesta.tarjeta, `falta ${campo}`);
  }
  assert.equal(respuesta.tarjeta.ultimoError, "se cayo");
  assert.equal(respuesta.tarjeta.ultimosIntentos.length, 1);
  assert.ok(!("tomada" in respuesta), "no se filtra el campo interno tomada");
  assert.ok(falso.usadosFuera.includes("intentoTarjeta.findMany"), "los intentos se leen con prisma, fuera de la transaccion");
  assert.ok(falso.usadosFuera.includes("historialTarjeta.findMany"), "el historial se lee con prisma, fuera de la transaccion");
});

await prueba("tomarTarjeta: sin tarjeta para tomar responde nada y no lee intentos", async () => {
  const falso = prismaFalso({ tomada: false });
  const { tomarTarjeta } = cargarTrabajador(falso);
  const respuesta = await tomarTarjeta({ claveId: "c1", workspaceId: "w1", nombre: "Coordinador" }, {});
  assert.equal(respuesta.tarjeta, null);
  assert.equal(respuesta.motivo, "nada");
  assert.deepEqual(falso.usadosFuera, []);
});

await prueba("arranqueDelTrabajador: pasa el plazo a prisma.$transaction", async () => {
  const falso = prismaFalso({ tomada: false });
  const { arranqueDelTrabajador } = cargarTrabajador(falso);
  const respuesta = await arranqueDelTrabajador({ claveId: "c1", workspaceId: "w1", nombre: "Coordinador" });
  assert.equal(respuesta.ok, true);
  assert.ok(falso.plazos[0]?.timeout >= 30_000 && falso.plazos[0]?.maxWait > 0, JSON.stringify(falso.plazos[0]));
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
