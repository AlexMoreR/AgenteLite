// Pruebas de la velocidad de la bandeja (08-10-2026): cache de permisos, cursor de la lista y
// cuantas consultas SQL hace GET /api/cliente/chats/list. No necesita base: usa el Prisma REAL con
// un pool de pg falso que anota cada SQL y contesta filas inventadas.
// Correr: npm run test:velocidad-bandeja   (requiere `prisma generate` hecho)
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const raiz = path.resolve("src");
process.env.DATABASE_URL = process.env.DATABASE_URL_FALSA ?? "postgres://x:y@127.0.0.1:1/z";

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

/* ------------------------------------------------------------------------------------------------
   Pool de pg falso: anota cada SQL y devuelve UNA fila inventada para los SELECT de Prisma (los
   $queryRaw devuelven vacio). Alcanza para que el codigo recorra el camino completo.
------------------------------------------------------------------------------------------------ */
const pg = require("pg");
const escenario = { userRole: "CLIENTE", memberRole: "OWNER" };
const sqls = [];

function columnas(sql) {
  const m = /^SELECT (.*?) FROM "public"\."(\w+)"/s.exec(sql);
  if (!m) return null;
  const partes = [];
  let prof = 0;
  let actual = "";
  for (const ch of m[1]) {
    if (ch === "(") prof++;
    if (ch === ")") prof--;
    if (ch === "," && prof === 0) {
      partes.push(actual.trim());
      actual = "";
      continue;
    }
    actual += ch;
  }
  if (actual.trim()) partes.push(actual.trim());
  return {
    tabla: m[2],
    cols: partes.map((p) => / AS "([^"]+)"$/.exec(p)?.[1] ?? /"([^"]+)"(::[\w[\]]+)?$/.exec(p)?.[1] ?? p),
  };
}

function valor(tabla, col) {
  if (/^_aggr_count/.test(col)) return [23, 0];
  if (col === "role") return [25, tabla === "User" ? escenario.userRole : escenario.memberRole];
  if (col === "provider") return [25, "EVOLUTION"];
  if (col === "status") return [25, tabla === "Conversation" ? "OPEN" : "CONNECTED"];
  if (col === "moduleAccess") return [3802, JSON.stringify(["chats"])];
  if (col === "metadata" || col === "activeProductContext") return [3802, "{}"];
  if (col === "crmStage" || col === "planTier") return [25, null];
  if (col === "value") return [25, "[]"];
  if (/At$/.test(col)) return [1114, "2026-10-08 10:00:00.000"];
  if (col === "isActive") return [16, true];
  if (/^is[A-Z]/.test(col) || col === "automationPaused") return [16, false];
  if (col === "name" || col === "email" || col === "phoneNumber" || col === "key") return [25, "n"];
  return [25, "x1"];
}

class PoolFalso extends pg.Pool {
  async query(q) {
    const text = typeof q === "string" ? q : q.text;
    sqls.push(text);
    const info = columnas(text);
    if (!info) return { fields: [], rows: [], rowCount: 1 };
    return {
      fields: info.cols.map((c) => ({ name: c, dataTypeID: valor(info.tabla, c)[0] })),
      rows: [info.cols.map((c) => valor(info.tabla, c)[1])],
      rowCount: 1,
    };
  }
  // Las escrituras de Prisma van en una transaccion interna: piden una conexion propia.
  async connect() {
    return {
      query: (q) => this.query(q),
      release() {},
      on() {},
      removeListener() {},
    };
  }
}

/* ------------------------------------------------------------------------------------------------
   Cargador de los .ts de src (con el alias @/), igual que las otras pruebas pero recursivo.
------------------------------------------------------------------------------------------------ */
function cargadorDeSrc(sesion) {
  const modulos = new Map();
  const reemplazos = {
    pg: { ...pg, Pool: PoolFalso, default: { ...pg, Pool: PoolFalso } },
    react: { cache: (f) => f },
    "@/auth": { auth: async () => sesion.actual },
    "next/navigation": {
      redirect() {
        throw new Error("redirect");
      },
      notFound() {
        throw new Error("404");
      },
    },
    "server-only": {},
    // Corre en segundo plano (after): no es parte de la respuesta y aca no hay contexto de Next.
    "@/lib/contact-avatar-refresh": { scheduleContactAvatarRefresh() {}, scheduleSingleContactAvatarRefresh() {} },
  };
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
      ? resolver(path.join(raiz, spec.slice(2)))
      : spec.startsWith(".")
        ? resolver(path.resolve(path.dirname(desde), spec))
        : null;
    if (!archivo || !/\.tsx?$/.test(archivo)) return require(archivo ?? spec);
    if (modulos.has(archivo)) return modulos.get(archivo).exports;
    const mod = { exports: {} };
    modulos.set(archivo, mod);
    const salida = ts.transpileModule(fs.readFileSync(archivo, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
      },
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
  return (spec) => requerir(spec, path.join(raiz, "index.ts"));
}

const sesion = { actual: { user: { id: "x1", role: "CLIENTE" } } };
const cargar = cargadorDeSrc(sesion);
const { CacheConTtl } = cargar("@/lib/cache-en-memoria");
const permisos = cargar("@/lib/cache-de-permisos");
const cursorMod = cargar("@/lib/cursor-de-bandeja");

/* ------------------------------------------------------------------------------------------------
   1. La cache
------------------------------------------------------------------------------------------------ */
await prueba("cache: devuelve lo guardado hasta el TTL y despues vuelve a cargar", async () => {
  let ahora = 1_000;
  const cache = new CacheConTtl({ ttlMs: 45_000, maxEntradas: 10, ahora: () => ahora });
  let cargas = 0;
  const cargarUno = async () => ++cargas;
  assert.equal(await cache.obtener("u1", cargarUno), 1);
  ahora += 44_999;
  assert.equal(await cache.obtener("u1", cargarUno), 1);
  ahora += 1;
  assert.equal(await cache.obtener("u1", cargarUno), 2);
  assert.equal(cargas, 2);
});

await prueba("cache: tamaño acotado, se va la usada hace mas tiempo", async () => {
  const cache = new CacheConTtl({ ttlMs: 60_000, maxEntradas: 3 });
  for (const k of ["a", "b", "c"]) await cache.obtener(k, async () => k);
  cache.leer("a"); // "a" usada recien: la mas vieja pasa a ser "b"
  await cache.obtener("d", async () => "d");
  assert.equal(cache.tamano, 3);
  assert.equal(cache.leer("b"), undefined);
  assert.equal(cache.leer("a"), "a");
  for (let i = 0; i < 2_000; i++) await cache.obtener(`k${i}`, async () => i);
  assert.equal(cache.tamano, 3);
});

await prueba("cache: invalidar una clave y vaciar", async () => {
  const cache = new CacheConTtl({ ttlMs: 60_000, maxEntradas: 10 });
  let n = 0;
  await cache.obtener("a", async () => ++n);
  await cache.obtener("b", async () => ++n);
  cache.invalidar("a");
  assert.equal(cache.leer("a"), undefined);
  assert.equal(cache.leer("b"), 2);
  cache.vaciar();
  assert.equal(cache.tamano, 0);
});

await prueba("cache: pedidos simultaneos comparten UNA carga; un error no se guarda", async () => {
  const cache = new CacheConTtl({ ttlMs: 60_000, maxEntradas: 10 });
  let cargas = 0;
  const lenta = () => new Promise((r) => setTimeout(() => r(++cargas), 5));
  const valores = await Promise.all(Array.from({ length: 10 }, () => cache.obtener("a", lenta)));
  assert.deepEqual(new Set(valores), new Set([1]));
  assert.equal(cargas, 1);
  await assert.rejects(cache.obtener("e", async () => Promise.reject(new Error("base caida"))));
  assert.equal(cache.leer("e"), undefined);
  assert.equal(await cache.obtener("e", async () => "ok"), "ok");
});

await prueba("cache: si se invalida durante la carga, ese resultado viejo no se guarda", async () => {
  const cache = new CacheConTtl({ ttlMs: 60_000, maxEntradas: 10 });
  let soltar;
  const enVuelo = cache.obtener("a", () => new Promise((r) => (soltar = r)));
  await new Promise((r) => setImmediate(r));
  cache.invalidar("a");
  soltar("viejo");
  assert.equal(await enVuelo, "viejo");
  assert.equal(cache.leer("a"), undefined);
});

await prueba("invalidacion: cada escritura vacia la cache que corresponde", async () => {
  const { cacheDeAcceso, cacheDeSupervisoras, cacheDeCanales, invalidarTrasEscritura, vaciarCachesDePermisos } =
    permisos;
  const llenar = async () => {
    vaciarCachesDePermisos();
    await cacheDeAcceso.obtener("u1", async () => null);
    await cacheDeSupervisoras.obtener("w1", async () => ["s"]);
    await cacheDeSupervisoras.obtener("w2", async () => ["s"]);
    await cacheDeCanales.obtener("w1", async () => []);
  };
  await llenar();
  invalidarTrasEscritura("WorkspaceMember", "update", { where: { id: "m1" }, data: { role: "ADMIN" } });
  assert.equal(cacheDeAcceso.tamano, 0);
  assert.equal(cacheDeCanales.tamano, 1);

  await llenar();
  invalidarTrasEscritura("AppSetting", "upsert", { where: { key: "equipo:supervisoras:w1" } });
  assert.equal(cacheDeSupervisoras.leer("w1"), undefined);
  assert.deepEqual(cacheDeSupervisoras.leer("w2"), ["s"]);
  invalidarTrasEscritura("AppSetting", "upsert", { where: { key: "otra:cosa" } });
  assert.deepEqual(cacheDeSupervisoras.leer("w2"), ["s"]);

  await llenar();
  invalidarTrasEscritura("WhatsAppChannel", "update", { where: { id: "c1" }, data: { metadata: {} } });
  assert.equal(cacheDeCanales.tamano, 0);
  assert.equal(cacheDeAcceso.tamano, 1);

  await llenar();
  invalidarTrasEscritura("WhatsAppChannel", "findMany", {});
  invalidarTrasEscritura("Conversation", "update", {});
  assert.equal(cacheDeCanales.tamano, 1);
  assert.equal(cacheDeAcceso.tamano, 1);
  vaciarCachesDePermisos();
});

/* ------------------------------------------------------------------------------------------------
   2. El cursor de la lista
------------------------------------------------------------------------------------------------ */
const { codificarCursor, leerCursor, whereDespuesDelCursor, cortarPagina, ORDEN_DE_BANDEJA } = cursorMod;

// Evalua en JS el where que arma whereDespuesDelCursor (solo lo que ese where usa).
function cumple(fila, where) {
  return Object.entries(where).every(([clave, cond]) => {
    if (clave === "OR") return cond.some((w) => cumple(fila, w));
    if (clave === "AND") return cond.every((w) => cumple(fila, w));
    const v = fila[clave];
    const num = (x) => (x instanceof Date ? x.getTime() : x);
    if (cond === null) return v === null;
    if (cond instanceof Date || typeof cond !== "object") return v !== null && num(v) === num(cond);
    if ("lt" in cond) return v !== null && num(v) < num(cond.lt);
    if ("not" in cond && cond.not === null) return v !== null;
    throw new Error(`condicion no soportada: ${JSON.stringify(cond)}`);
  });
}

// El orden de Postgres para ORDEN_DE_BANDEJA: DESC con los NULL primero.
function comparar(a, b) {
  for (const orden of ORDEN_DE_BANDEJA) {
    const [campo] = Object.keys(orden);
    const x = a[campo];
    const y = b[campo];
    if (x === y) continue;
    if (x === null) return -1;
    if (y === null) return 1;
    const vx = x instanceof Date ? x.getTime() : x;
    const vy = y instanceof Date ? y.getTime() : y;
    if (vx === vy) continue;
    return vx > vy ? -1 : 1;
  }
  return 0;
}

function datos() {
  const horas = [null, new Date("2026-10-08T10:00:00.000Z"), new Date("2026-10-08T09:00:00.000Z")];
  const act = [new Date("2026-10-08T12:00:00.000Z"), new Date("2026-10-08T11:00:00.000Z")];
  const filas = [];
  for (let i = 0; i < 37; i++) {
    filas.push({
      id: `c${String((i * 7919) % 1000).padStart(3, "0")}`,
      lastMessageAt: horas[i % 3],
      updatedAt: act[(i >> 1) % 2],
      pospuesto: i % 5 === 0 || (i >= 12 && i <= 16),
    });
  }
  return filas;
}

function paginarConCursor(filas, limit) {
  const ordenadas = [...filas].sort(comparar);
  const vistos = [];
  let cursor = null;
  for (let vuelta = 0; vuelta < 100; vuelta++) {
    const candidatas = cursor ? ordenadas.filter((f) => cumple(f, whereDespuesDelCursor(cursor))) : ordenadas;
    const { consumidas, hayMas, nextCursor } = cortarPagina(candidatas.slice(0, limit + 1), limit);
    vistos.push(...consumidas.filter((f) => !f.pospuesto).map((f) => f.id));
    if (!hayMas) return vistos;
    cursor = leerCursor(nextCursor);
    assert.ok(cursor, "el cursor que se manda se tiene que poder leer");
  }
  throw new Error("la paginacion no termina");
}

function paginarConOffset(filas, limit) {
  const ordenadas = [...filas].sort(comparar);
  const vistos = [];
  for (let offset = 0; ; ) {
    const lote = ordenadas.slice(offset, offset + limit + 1);
    const consumidas = lote.slice(0, limit);
    vistos.push(...consumidas.filter((f) => !f.pospuesto).map((f) => f.id));
    offset += consumidas.length;
    if (lote.length <= limit) return vistos;
  }
}

await prueba("cursor: ida y vuelta, y un cursor roto se ignora (se cae al offset)", async () => {
  const fila = { id: "abc123", lastMessageAt: new Date("2026-10-08T10:00:00.123Z"), updatedAt: new Date(0) };
  assert.deepEqual(leerCursor(codificarCursor(fila)), fila);
  const sinMensaje = { id: "z9", lastMessageAt: null, updatedAt: new Date("2026-01-01T00:00:00Z") };
  assert.deepEqual(leerCursor(codificarCursor(sinMensaje)), sinMensaje);
  for (const roto of [null, "", "no-es-base64!!", Buffer.from("{}").toString("base64url"), "x".repeat(500)]) {
    assert.equal(leerCursor(roto), null);
  }
  const inyeccion = Buffer.from(JSON.stringify({ l: null, u: new Date().toISOString(), i: "a' OR 1=1" })).toString(
    "base64url",
  );
  assert.equal(leerCursor(inyeccion), null);
});

await prueba("cursor: mismas filas y mismo orden que el offset, con empates y nulos", async () => {
  const filas = datos();
  const esperado = [...filas].sort(comparar).filter((f) => !f.pospuesto).map((f) => f.id);
  for (const limit of [1, 2, 3, 4, 7, 20, 40]) {
    const conCursor = paginarConCursor(filas, limit);
    assert.deepEqual(conCursor, esperado, `limit ${limit}`);
    assert.deepEqual(paginarConOffset(filas, limit), esperado, `offset limit ${limit}`);
    assert.equal(new Set(conCursor).size, conCursor.length, "sin repetidos");
  }
});

await prueba("cursor: los pospuestos no frenan el scroll (el cursor pasa por encima)", async () => {
  // Una pagina ENTERA de pospuestos: no se muestra nada, pero el cursor avanza y sigue habiendo mas.
  const filas = datos().map((f, i) => ({ ...f, pospuesto: i < 10 }));
  const ordenadas = [...filas].sort(comparar);
  const primera = cortarPagina(ordenadas.slice(0, 5), 4);
  assert.equal(primera.hayMas, true);
  assert.equal(leerCursor(primera.nextCursor).id, ordenadas[3].id);
  const esperado = ordenadas.filter((f) => !f.pospuesto).map((f) => f.id);
  assert.deepEqual(paginarConCursor(filas, 4), esperado);
});

await prueba("cursor: un chat que sube al tope mientras se scrollea no se repite ni hace saltar filas", async () => {
  const filas = datos().map((f) => ({ ...f, pospuesto: false }));
  const ordenadas = [...filas].sort(comparar);
  const pagina1 = cortarPagina(ordenadas.slice(0, 5), 4);
  // Entra un mensaje a un chat de MAS ABAJO: pasa a ser el primero.
  const movido = ordenadas[20];
  const ahora = filas.map((f) => (f.id === movido.id ? { ...f, lastMessageAt: null, updatedAt: new Date("2030-01-01") } : f));
  const siguientes = [...ahora]
    .sort(comparar)
    .filter((f) => cumple(f, whereDespuesDelCursor(leerCursor(pagina1.nextCursor))))
    .slice(0, 4)
    .map((f) => f.id);
  // Con offset 4 la pagina 2 repetia la ultima fila de la pagina 1; con cursor sigue en la 5.
  assert.deepEqual(siguientes, ordenadas.slice(4, 8).map((f) => f.id));
});

/* ------------------------------------------------------------------------------------------------
   3. Cuantas consultas hace /api/cliente/chats/list (y que las escrituras invalidan)
------------------------------------------------------------------------------------------------ */
const { GET } = cargar("@/app/api/cliente/chats/list/route");
const { prisma } = cargar("@/lib/prisma");
const logOriginal = console.log;
async function pedir(url) {
  sqls.length = 0;
  console.log = () => {}; // las lineas [timing]
  try {
    const res = await GET(new Request(url));
    const cuerpo = await res.json();
    assert.equal(cuerpo.ok, true, JSON.stringify(cuerpo));
    return { consultas: sqls.length, cuerpo, sqls: [...sqls] };
  } finally {
    console.log = logOriginal;
  }
}

await prueba("consultas: dueño, cache fria <= 11 y caliente <= 7 (antes eran 14)", async () => {
  permisos.vaciarCachesDePermisos();
  const url = "http://x/api/cliente/chats/list?assigned=all&limit=20";
  const fria = await pedir(url);
  const caliente = await pedir(url);
  const otra = await pedir(url);
  console.log(`   dueño: fria ${fria.consultas}, caliente ${caliente.consultas}, ${otra.consultas}`);
  assert.ok(fria.consultas <= 11, `fria: ${fria.consultas}`);
  assert.ok(caliente.consultas <= 7, `caliente: ${caliente.consultas}`);
  // Ya no se cuentan todas las conversaciones del negocio en cada pedido.
  assert.ok(!fria.sqls.some((s) => s.includes("_aggr_count_conversations")));
});

await prueba("consultas: asesora con linea elegida y scroll, caliente <= 7 (antes eran 17)", async () => {
  escenario.userRole = "EMPLEADO";
  escenario.memberRole = "AGENT";
  sesion.actual = { user: { id: "x1", role: "EMPLEADO" } };
  permisos.vaciarCachesDePermisos();
  const url = "http://x/api/cliente/chats/list?assigned=mine&limit=20&connection=channel:x1&offset=20";
  const fria = await pedir(url);
  const caliente = await pedir(url);
  console.log(`   asesora: fria ${fria.consultas}, caliente ${caliente.consultas}`);
  assert.ok(fria.consultas <= 12, `fria: ${fria.consultas}`);
  assert.ok(caliente.consultas <= 7, `caliente: ${caliente.consultas}`);
});

await prueba("consultas: con cursor no hay OFFSET de filas, el where arranca despues del cursor", async () => {
  const cursor = codificarCursor({ id: "c1", lastMessageAt: new Date("2026-10-08T10:00:00Z"), updatedAt: new Date() });
  const { sqls: hechas } = await pedir(
    `http://x/api/cliente/chats/list?assigned=mine&limit=20&offset=500&cursor=${cursor}`,
  );
  const lista = hechas.find((s) => s.startsWith('SELECT "public"."Conversation"."id"'));
  assert.ok(lista, "no salio la consulta de la lista");
  assert.match(lista, /"lastMessageAt" < \$\d+/);
});

await prueba("consultas: cambiar canales, supervisoras o miembros desde la app se ve en el pedido siguiente", async () => {
  const url = "http://x/api/cliente/chats/list?assigned=mine&limit=20";
  await pedir(url);
  const base = (await pedir(url)).consultas;

  await prisma.whatsAppChannel.updateMany({ where: { workspaceId: "x1" }, data: { name: "Ventas 1" } });
  const trasCanal = await pedir(url);
  assert.equal(trasCanal.consultas, base + 1, "vuelve a leer los canales");
  assert.ok(trasCanal.sqls.some((s) => s.includes('FROM "public"."WhatsAppChannel"')));

  await prisma.appSetting.updateMany({ where: { key: "equipo:supervisoras:x1" }, data: { value: "[]" } });
  const trasSupervisoras = await pedir(url);
  assert.equal(trasSupervisoras.consultas, base + 1, "vuelve a leer las supervisoras");

  await prisma.workspaceMember.updateMany({ where: { userId: "x1" }, data: { isActive: false } });
  const trasMiembro = await pedir(url);
  assert.ok(trasMiembro.consultas >= base + 3, "vuelve a leer el acceso (usuario, membresia, negocio)");

  assert.equal((await pedir(url)).consultas, base, "y despues vuelve a la cache");
});

console.log(`\n${pruebas} pruebas ok`);
process.exit(0);
