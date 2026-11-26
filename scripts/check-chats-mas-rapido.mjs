// Pruebas de "Chats mas rapido" (26-11-2026). Va por partes; cada parte agrega su seccion abajo.
//
// - Parte 1: la linea [timing] de conServerTiming (src/lib/server-timing.ts) trae retrasoEventLoop
//   (p99 y maximo en ms del retraso del event loop de Node desde el pedido anterior), y si el monitor
//   falla el pedido igual responde y la linea sale sin ese campo. No va en la cabecera Server-Timing.
// - Arreglo de subida de la parte 1: /tomar y /arranque (trabajador.ts) le pasan un plazo propio a
//   prisma.$transaction, y /tomar lee los intentos y el historial despues del commit.
// - Parte 2: la ficha, las notas del turno y el apagado leen solo "rawPayload"->>'source' (en PGlite).
// - Partes 3 y 4: sus pruebas van en las secciones de abajo.
// No toca ninguna base real (la parte 2 usa PGlite, un Postgres embebido). Correr: npm run test:chats-mas-rapido
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
   Parte 2: la ficha (leerFicha), las notas del turno (leerNotasDelTurno) y el apagado
   (revisarApagadoDelChat) piden a Postgres solo "rawPayload"->>'source' y no el JSON entero.
   Corre en PGlite con mensajes que traen un rawPayload de varios megas (base64) y un source, y se compara
   con la lectura de antes (el rawPayload entero y rawPayload.source en JS): mismo origen y misma decision.
------------------------------------------------------------------------------------------------ */
const { abrirBaseDePruebas } = await import("./lib/base-de-pruebas.mjs");
const db = await abrirBaseDePruebas();
await db.exec(`
  CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');
  CREATE TYPE "MessageType" AS ENUM ('TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'STICKER', 'DOCUMENT', 'LOCATION', 'BUTTON', 'TEMPLATE', 'SYSTEM');
  CREATE TYPE "MessageStatus" AS ENUM ('RECEIVED', 'QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');
  CREATE TABLE "Message" (
    "id" text PRIMARY KEY,
    "conversationId" text NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "type" "MessageType" NOT NULL DEFAULT 'TEXT',
    "status" "MessageStatus" NOT NULL DEFAULT 'RECEIVED',
    "content" text,
    "mediaUrl" text,
    "transcripcion" text,
    "rawPayload" jsonb,
    "readAt" timestamp(3),
    "deletedAt" timestamp(3),
    "createdAt" timestamp(3) NOT NULL
  );
`);

const AHORA = new Date(Date.now() - (Date.now() % 1000));
const haceHoras = (h) => new Date(AHORA.getTime() - h * 3_600_000);
const BASE64 = "A".repeat(3 * 1024 * 1024); // una foto de unos 3 MB metida en el rawPayload
let nMensaje = 0;
async function mensaje(conv, m) {
  nMensaje += 1;
  await db.query(
    `INSERT INTO "Message" ("id", "conversationId", "direction", "type", "status", "content", "mediaUrl", "transcripcion", "rawPayload", "readAt", "deletedAt", "createdAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      `m${String(nMensaje).padStart(3, "0")}`,
      conv,
      m.dir ?? "OUTBOUND",
      m.tipo ?? "TEXT",
      m.estado ?? "SENT",
      m.texto ?? null,
      m.media ?? null,
      m.transcripcion ?? null,
      m.raw === undefined ? null : JSON.stringify(m.raw),
      m.leido ?? null,
      m.borrado ?? null,
      m.en,
    ],
  );
}
const grande = (source) => ({ source, message: { imageMessage: { jpegThumbnail: BASE64 } } });

// conv_manual: la asesora escribio a mano hace 2 h (con una foto de 3 MB) -> se apaga el del embudo.
await mensaje("conv_manual", { dir: "INBOUND", estado: "RECEIVED", texto: "hola, precio?", raw: grande("webhook"), en: haceHoras(5) });
await mensaje("conv_manual", { tipo: "IMAGE", texto: "te mando la foto", media: "https://x/foto.jpg", raw: grande("manual"), leido: haceHoras(1), en: haceHoras(2) });
await mensaje("conv_manual", { dir: "INBOUND", tipo: "AUDIO", estado: "RECEIVED", texto: "[audio]", transcripcion: "  me gusta  ", raw: grande("webhook"), en: haceHoras(1) });
await mensaje("conv_manual", { tipo: "SYSTEM", texto: "El agente pide un asesor", raw: { source: "agente-v3" }, en: haceHoras(1.5) });
// conv_auto: solo mensajes automaticos (follow) y uno sin rawPayload -> no se apaga.
await mensaje("conv_auto", { dir: "INBOUND", estado: "RECEIVED", texto: "info", raw: grande("webhook"), en: haceHoras(6) });
await mensaje("conv_auto", { texto: "¿Pudiste ver lo que te envié?", raw: grande("follow"), en: haceHoras(3) });
await mensaje("conv_auto", { texto: "sin payload", en: haceHoras(2) });
await mensaje("conv_auto", { texto: "source no texto", raw: { source: null }, en: haceHoras(1.8) });
// conv_borrado: el unico mensaje a mano esta BORRADO y el otro es una nota SYSTEM "manual" -> no se apaga.
await mensaje("conv_borrado", { dir: "INBOUND", estado: "RECEIVED", texto: "hola", raw: grande("webhook"), en: haceHoras(4) });
await mensaje("conv_borrado", { texto: "te escribo", raw: grande("manual"), borrado: haceHoras(1), en: haceHoras(2) });
await mensaje("conv_borrado", { tipo: "SYSTEM", texto: "Nota de la asesora", raw: grande("manual"), en: haceHoras(1.5) });
await mensaje("conv_borrado", { tipo: "SYSTEM", texto: "Nota borrada", raw: { source: "manual" }, borrado: haceHoras(1), en: haceHoras(1.2) });
// conv_tope: 41 mensajes; el mas viejo (a mano, hace 23 h) queda fuera de los ultimos 40 -> no se apaga.
await mensaje("conv_tope", { texto: "a mano, el mas viejo", raw: grande("manual"), en: haceHoras(23) });
for (let i = 0; i < 40; i += 1) await mensaje("conv_tope", { texto: `auto ${i}`, raw: { source: "follow" }, en: haceHoras(22 - i * 0.1) });

/** Prisma falso: $queryRaw (tagged template) corre en PGlite y guarda el SQL; lo demas responde lo de la charla. */
function prismaDeLaParte2({ falla = false } = {}) {
  const sqls = [];
  const charla = (id) => ({
    id,
    channelId: "ch1",
    workspaceId: "ws1",
    contactId: `k_${id}`,
    assignedToUserId: null,
    automationPaused: false,
    automationPausedAt: null,
    startedAt: null,
    status: "OPEN",
    seguimientosApagados: false,
    contact: { name: "Cliente", phoneNumber: "573001112233", metadata: null, crmStage: null },
  });
  const prisma = {
    $queryRaw: async (partes, ...valores) => {
      assert.ok(Array.isArray(partes?.raw), "$queryRaw se llama como plantilla (los valores van como parametros)");
      const texto = partes.reduce((acc, parte, i) => acc + (i > 0 ? `$${i}` : "") + parte, "");
      sqls.push(texto);
      if (falla) throw new Error("la base no responde");
      return (await db.query(texto, valores)).rows;
    },
    conversation: {
      findFirst: async ({ where }) => charla(where.id),
      findUnique: async ({ where }) => charla(where.id),
    },
    message: new Proxy({}, { get: (_o, metodo) => () => assert.fail(`no se usa prisma.message.${String(metodo)}`) }),
    historialEtapa: { findFirst: async () => null },
    embudoLead: { findUnique: async () => null },
    product: { findFirst: async () => null },
  };
  return { prisma, sqls };
}

const cargarParte2 = (falso) => {
  const cargar = cargadorDeSrc({
    "@/lib/prisma": { prisma: falso.prisma },
    "@/lib/conversation-activity": { recordConversationActivity: async () => null },
    "@/features/agente-v3/motor/estado": { leerEstado: async () => null },
  });
  return {
    apagado: cargar("@/features/seguimientos/services/apagado"),
    ficha: cargar("@/features/seguimiento-inteligente/servicios/ficha"),
    dominio: cargar("@/features/seguimientos/dominio/apagado"),
  };
};

/** La lectura de ANTES: el rawPayload entero y rawPayload.source en JS, con el mismo filtro y el mismo tope. */
async function lecturaDeAntes(conv, { sistema, tope }) {
  const { rows } = await db.query(
    `SELECT "direction"::text AS "direction", "type"::text AS "type", "content", "transcripcion", "createdAt", "readAt",
            "status"::text AS "status", "mediaUrl", "rawPayload"
       FROM "Message" WHERE "conversationId" = $1 AND ${sistema ? `"type" = 'SYSTEM'` : `"type" <> 'SYSTEM'`} AND "deletedAt" IS NULL
      ORDER BY "createdAt" DESC LIMIT $2`,
    [conv, tope],
  );
  return rows.reverse().map((m) => ({ ...m, origen: m.rawPayload?.source ?? null }));
}

// El SQL no puede traer la columna entera: fuera de "rawPayload"->>'source' no aparece rawPayload.
const sinRawPayloadEntero = (sql) => {
  assert.match(sql, /"rawPayload"->>'source' AS origen/);
  assert.doesNotMatch(sql.replaceAll(`"rawPayload"->>'source'`, ""), /rawPayload/i, sql);
};

const MOTIVO_ESPERADO = { conv_manual: "asesora_escribio", conv_auto: null, conv_borrado: null, conv_tope: null };

for (const conv of Object.keys(MOTIVO_ESPERADO)) {
  await prueba(`parte 2: apagado de ${conv}: mismo origen y misma decision que antes, sin el rawPayload entero`, async () => {
    const falso = prismaDeLaParte2();
    const { apagado, dominio } = cargarParte2(falso);
    const revision = await apagado.revisarApagadoDelChat({ workspaceId: "ws1", contactId: `k_${conv}`, conversationId: conv, tipo: "embudo", ahora: AHORA });
    assert.equal(falso.sqls.length, 1);
    sinRawPayloadEntero(falso.sqls[0]);
    assert.match(falso.sqls[0], /"type" <> 'SYSTEM'/);
    assert.match(falso.sqls[0], /"deletedAt" IS NULL/);
    assert.match(falso.sqls[0], /ORDER BY m\."createdAt" DESC/);

    const antes = await lecturaDeAntes(conv, { sistema: false, tope: 40 });
    const mensajesDeAntes = antes.map((m) => ({
      direccion: m.direction === "INBOUND" ? "IN" : "OUT",
      tipo: m.type,
      texto: m.direction === "INBOUND" ? m.transcripcion?.trim() || m.content : m.content,
      en: m.createdAt,
      origen: m.origen,
    }));
    const decisionDeAntes = dominio.decidirApagado({
      tipo: "embudo",
      etapaCrm: null,
      etapaPuestaPorElSistema: false,
      interruptorApagado: false,
      mensajes: mensajesDeAntes,
      inicioDeLaCharla: null,
      ahora: AHORA,
    });
    assert.equal(decisionDeAntes?.codigo ?? null, MOTIVO_ESPERADO[conv], "la regla de antes da lo esperado");
    assert.equal(revision?.motivo.codigo ?? null, MOTIVO_ESPERADO[conv], "y la de ahora da lo mismo");
    assert.deepEqual(revision?.motivo ?? null, decisionDeAntes);
    if (revision) assert.deepEqual(revision, { motivo: decisionDeAntes, conversationId: conv, channelId: "ch1" });
  });
}

await prueba("parte 2: si la consulta del apagado falla, no lanza, lo anota en el log y no se apaga a nadie", async () => {
  const falso = prismaDeLaParte2({ falla: true });
  const { apagado } = cargarParte2(falso);
  const errores = [];
  const original = console.error;
  console.error = (...args) => errores.push(args);
  let revision;
  try {
    revision = await apagado.revisarApagadoDelChat({ workspaceId: "ws1", contactId: "k_conv_manual", conversationId: "conv_manual", tipo: "embudo", ahora: AHORA });
  } finally {
    console.error = original;
  }
  assert.equal(revision, null);
  assert.equal(errores.length, 1);
  assert.match(String(errores[0][0]), /no se pudo revisar el apagado del chat/);
  assert.equal(errores[0][1].error, "la base no responde");
});

for (const conv of ["conv_manual", "conv_auto", "conv_borrado", "conv_tope"]) {
  await prueba(`parte 2: ficha de ${conv}: mismos mensajes, mismo origen y mismos tipos que antes`, async () => {
    const falso = prismaDeLaParte2();
    const { ficha } = cargarParte2(falso);
    const resultado = await ficha.leerFicha(conv);
    assert.equal(falso.sqls.length, 1);
    sinRawPayloadEntero(falso.sqls[0]);
    const antes = await lecturaDeAntes(conv, { sistema: false, tope: 80 });
    const esperados = antes.map((m) => ({
      direccion: m.direction === "INBOUND" ? "IN" : "OUT",
      tipo: m.type,
      texto: m.direction === "INBOUND" ? m.transcripcion?.trim() || m.content : m.content,
      en: m.createdAt,
      leidoEn: m.readAt,
      estado: m.status,
      origen: m.origen,
      media: m.mediaUrl,
    }));
    const mensajes = resultado.ficha.mensajes;
    assert.deepEqual(mensajes, esperados);
    assert.ok(mensajes.length > 0);
    for (const m of mensajes) {
      assert.ok(m.en instanceof Date, "createdAt llega como Date");
      assert.ok(m.leidoEn === null || m.leidoEn instanceof Date, "readAt llega como Date o null");
      assert.equal(typeof m.tipo, "string");
      assert.equal(typeof m.estado, "string");
      assert.ok(!("rawPayload" in m));
    }
    assert.ok(!mensajes.some((m) => m.tipo === "SYSTEM"), "las notas SYSTEM no van en la ficha");
    assert.equal(resultado.ficha.historialCompleto, antes.length < 80);
    assert.ok(JSON.stringify(resultado).length < 100_000, "la ficha no carga el base64");
  });
}

await prueba("parte 2: ficha de conv_manual: los valores que importan (origen, transcripcion, leido, media)", async () => {
  const { ficha } = cargarParte2(prismaDeLaParte2());
  const { mensajes } = (await ficha.leerFicha("conv_manual")).ficha;
  assert.deepEqual(
    mensajes.map((m) => [m.direccion, m.tipo, m.texto, m.origen, m.estado, m.media, m.leidoEn?.getTime() ?? null]),
    [
      ["IN", "TEXT", "hola, precio?", "webhook", "RECEIVED", null, null],
      ["OUT", "IMAGE", "te mando la foto", "manual", "SENT", "https://x/foto.jpg", haceHoras(1).getTime()],
      ["IN", "AUDIO", "me gusta", "webhook", "RECEIVED", null, null],
    ],
  );
  assert.equal(mensajes[1].en.getTime(), haceHoras(2).getTime());
});

await prueba("parte 2: ficha de conv_auto: sin rawPayload o con source null el origen es null", async () => {
  const { ficha } = cargarParte2(prismaDeLaParte2());
  const { mensajes } = (await ficha.leerFicha("conv_auto")).ficha;
  assert.deepEqual(mensajes.map((m) => m.origen), ["webhook", "follow", null, null]);
});

for (const conv of ["conv_manual", "conv_borrado", "conv_auto"]) {
  await prueba(`parte 2: notas del turno de ${conv}: solo SYSTEM sin borrar, mismo origen que antes`, async () => {
    const falso = prismaDeLaParte2();
    const { ficha } = cargarParte2(falso);
    const notas = await ficha.leerNotasDelTurno(conv);
    assert.equal(falso.sqls.length, 1);
    sinRawPayloadEntero(falso.sqls[0]);
    assert.match(falso.sqls[0], /"type" = 'SYSTEM'/);
    assert.match(falso.sqls[0], /"deletedAt" IS NULL/);
    const antes = await lecturaDeAntes(conv, { sistema: true, tope: 30 });
    assert.deepEqual(
      notas,
      antes.map((m) => ({
        direccion: m.direction === "INBOUND" ? "IN" : "OUT",
        tipo: m.type,
        texto: m.content,
        en: m.createdAt,
        leidoEn: null,
        origen: m.origen,
      })),
    );
    for (const n of notas) assert.ok(n.en instanceof Date);
  });
}

await prueba("parte 2: notas del turno de conv_borrado: la nota borrada no sale", async () => {
  const { ficha } = cargarParte2(prismaDeLaParte2());
  const notas = await ficha.leerNotasDelTurno("conv_borrado");
  assert.deepEqual(notas.map((n) => [n.texto, n.origen]), [["Nota de la asesora", "manual"]]);
});

await prueba("parte 2: el criterio: los dos archivos piden \"rawPayload\"->>'source' y no rawPayload: true", () => {
  for (const archivo of ["src/features/seguimientos/services/apagado.ts", "src/features/seguimiento-inteligente/servicios/ficha.ts"]) {
    const fuente = fs.readFileSync(path.join(raiz, archivo), "utf8");
    assert.doesNotMatch(fuente, /rawPayload: true/, archivo);
    assert.match(fuente, /"rawPayload"->>'source'/, archivo);
  }
});

await db.close();

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
