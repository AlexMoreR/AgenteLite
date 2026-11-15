// Pruebas de la fila de pastillas de la bandeja (10-11-2026): una sola fila con las fijas (Todas,
// Mias, No leido, Sin responder, Sin asignar) y las listas, que cada persona ordena y en la que
// oculta las fijas que no usa; y la pastilla "No leido" de verdad, con su numero en /counts.
//
// - El orden y las ocultas: funciones puras (features/chats/domain/orden-de-las-pastillas.ts),
//   con la limpieza de datos raros, viejos o de otra persona.
// - La condicion `no_leido:si` en la direccion y su SQL en las DOS fuentes (canal viejo y linea
//   oficial), corriendo en un Postgres embebido (PGlite) con chats armados a mano.
// - GET /api/cliente/chats/counts con un Prisma FALSO: el SQL crudo va a PGlite y los count() de
//   Prisma se evaluan sobre las mismas filas. Jefe, asesora y monitora: cada una cuenta lo suyo.
// - /api/cliente/chats/pastillas y /api/cliente/chats/filtros-guardados con un AppSetting en
//   memoria: cada persona guarda lo suyo y no puede meter listas de otra.
// No toca ninguna base real. Correr: npm run test:pastillas-ordenables
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

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
   El cargador de src (alias @/), con los modulos de la base y de permisos reemplazados.
------------------------------------------------------------------------------------------------ */
const { Prisma } = require("@prisma/client");

const db = new PGlite();
/** Las consultas crudas que llegaron a la base, para mirar que no abran el rawPayload. */
const sqls = [];
const ajustes = new Map();
const escenario = {
  sesion: { user: { id: "dueno", role: "CLIENTE" } },
  rolEnElNegocio: "OWNER",
  visibles: null,
  monitoreados: [],
};

async function correrSql(sql) {
  sqls.push(sql.text);
  return (await db.query(sql.text, sql.values)).rows;
}

/** Un WHERE de Prisma sobre una fila: solo lo que usa la bandeja. Lo desconocido falla en voz alta. */
function cumple(fila, where) {
  for (const [clave, valor] of Object.entries(where ?? {})) {
    if (clave === "AND") {
      if (!valor.every((parte) => cumple(fila, parte))) return false;
    } else if (clave === "OR") {
      if (!valor.some((parte) => cumple(fila, parte))) return false;
    } else if (clave === "contact") {
      if (!cumple(fila.contact, valor)) return false;
    } else if (valor === null || typeof valor !== "object") {
      if ((fila[clave] ?? null) !== valor) return false;
    } else {
      for (const [op, dato] of Object.entries(valor)) {
        const actual = fila[clave] ?? null;
        if (op === "in" && !dato.includes(actual)) return false;
        else if (op === "notIn" && dato.includes(actual)) return false;
        else if (op === "not" && actual === dato) return false;
        else if (!["in", "notIn", "not"].includes(op)) throw new Error(`operador no soportado: ${clave}.${op}`);
      }
    }
  }
  return true;
}

async function filasDeConversaciones() {
  const filas = await db.query(`
    SELECT c.*, ct."bloqueadoEn" AS "bloqueadoEn", ct."crmStage" AS "crmStage"
    FROM "Conversation" c JOIN "Contact" ct ON ct."id" = c."contactId"`);
  return filas.rows.map((f) => ({ ...f, contact: { bloqueadoEn: f.bloqueadoEn, crmStage: f.crmStage } }));
}

const prismaFalso = {
  async $queryRaw(primero, ...valores) {
    // Como plantilla (prisma.$queryRaw`...`) o con un Prisma.sql ya armado.
    const sql = Array.isArray(primero) ? Prisma.sql(primero, ...valores) : primero;
    return correrSql(sql);
  },
  conversation: {
    async count({ where }) {
      return (await filasDeConversaciones()).filter((fila) => cumple(fila, where)).length;
    },
  },
  officialApiConversation: {
    async count({ where }) {
      const filas = (await db.query(`SELECT * FROM "OfficialApiConversation"`)).rows;
      return filas.filter((fila) => cumple(fila, where)).length;
    },
  },
  officialApiClientConfig: {
    async findFirst({ where }) {
      return where.workspaceId === WS ? { id: "cfg_1" } : null;
    },
  },
  whatsAppChannel: {
    async findFirst() {
      return null;
    },
    async findMany() {
      return [];
    },
  },
  appSetting: {
    async findUnique({ where }) {
      return ajustes.has(where.key) ? { key: where.key, value: ajustes.get(where.key) } : null;
    },
    async upsert({ where, create, update }) {
      ajustes.set(where.key, ajustes.has(where.key) ? update.value : create.value);
      return { key: where.key, value: ajustes.get(where.key) };
    },
  },
};

function cargadorDeSrc() {
  const modulos = new Map();
  const reemplazos = {
    react: { cache: (f) => f },
    "server-only": {},
    "@/lib/prisma": { prisma: prismaFalso },
    "@/auth": { auth: async () => escenario.sesion },
    "@/lib/client-workspace-access": {
      canAccessClientModule: () => true,
      getClientWorkspaceAccessForUserCached: async () => ({ membershipRole: escenario.rolEnElNegocio, workspaceId: WS }),
    },
    "@/lib/channel-visibility": {
      getVisibleChannelIds: async () => escenario.visibles,
      resolverConexionElegida: async ({ connectionKey }) => connectionKey,
    },
    "@/lib/modo-monitoreo": { canalesQueMonitorea: async () => escenario.monitoreados },
    "@/lib/permisos-del-equipo": { esSupervisora: async () => false },
    "@/lib/canales-del-negocio": { canalesDelNegocio: async () => [] },
    "@/features/chats/services/espera-de-chats": {
      esperaDelNegocio: async () => [],
      esperaParaPersona: () => ({ mine: 0, all: 0, chats: [] }),
    },
    "@/lib/server-timing": { conServerTiming: (fn) => (request) => fn(request, { marca() {} }) },
    "@/lib/official-api-config": {},
    "@/lib/official-api-media": {},
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
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
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

const cargar = cargadorDeSrc();
const orden = cargar("@/features/chats/domain/orden-de-las-pastillas");
const filtrosDominio = cargar("@/features/chats/domain/filtros-de-bandeja");
const filtrosServicio = cargar("@/features/chats/services/filtros-de-bandeja");
const ultimoMensaje = cargar("@/lib/ultimo-mensaje-de-chats");
const oficial = cargar("@/features/official-api/services/getOfficialApiChatsData");
const pastillasBandeja = cargar("@/components/chats/pastillas-de-la-bandeja");

/* ------------------------------------------------------------------------------------------------
   1. El orden y las ocultas (puro)
------------------------------------------------------------------------------------------------ */
const JEFE = { isManager: true, idsDeListas: ["fa", "fb"] };
const ASESORA = { isManager: false, idsDeListas: ["fa", "fb"] };
const fila = (pref, ctx) => orden.pastillasDeLaFila(pref, ctx);

await prueba("orden por defecto: el de hoy mas las nuevas, y despues las listas", () => {
  assert.deepEqual(fila(orden.SIN_PREFERENCIA, JEFE).visibles, [
    "todas", "mias", "no_leido", "sin_responder", "sin_asignar", "lista:fa", "lista:fb",
  ]);
  // La asesora no ve Todas ni Sin asignar (como hoy).
  assert.deepEqual(fila(orden.SIN_PREFERENCIA, ASESORA).visibles, ["mias", "no_leido", "sin_responder", "lista:fa", "lista:fb"]);
  assert.deepEqual(fila(orden.SIN_PREFERENCIA, JEFE).ocultas, []);
  assert.equal(orden.ETIQUETAS_DE_PASTILLAS.sin_responder, "Sin responder");
  assert.equal(orden.ETIQUETAS_DE_PASTILLAS.no_leido, "No leído");
});

await prueba("datos dañados o viejos caen al orden por defecto, sin romper", () => {
  const porDefecto = fila(orden.SIN_PREFERENCIA, JEFE).visibles;
  for (const crudo of [null, undefined, "", "{no es json", "[]", "42", 7, [], "null", '"texto"', { orden: "todas" }, { orden: null, ocultas: 3 }]) {
    const limpia = orden.limpiarPreferencia(crudo, JEFE.idsDeListas);
    assert.deepEqual(fila(limpia, JEFE).visibles, porDefecto, `crudo: ${JSON.stringify(crudo)}`);
  }
});

await prueba("limpieza: solo fijas conocidas y listas de esa persona, sin repetidas", () => {
  const limpia = orden.limpiarPreferencia(
    {
      orden: ["sin_responder", "sin_responder", "inventada", "lista:fb", "lista:de_otra", "lista:", "lista:a;b", 3, null, "todas"],
      ocultas: ["mias", "mias", "lista:fa", "rara", 5],
    },
    JEFE.idsDeListas,
  );
  assert.deepEqual(limpia, { orden: ["sin_responder", "lista:fb", "todas"], ocultas: ["mias"] });
  // Tambien llega como texto (lo que guarda AppSetting).
  assert.deepEqual(orden.limpiarPreferencia(JSON.stringify({ orden: ["no_leido"], ocultas: [] }), []), { orden: ["no_leido"], ocultas: [] });
});

await prueba("el dueño puede dejar Sin responder de primera; lo que falta va al final", () => {
  const pref = { orden: ["sin_responder", "lista:fb", "todas"], ocultas: [] };
  assert.deepEqual(fila(pref, JEFE).visibles, [
    "sin_responder", "lista:fb", "todas", "mias", "no_leido", "sin_asignar", "lista:fa",
  ]);
});

await prueba("una lista nueva aparece al final; una borrada desaparece del orden", () => {
  const pref = { orden: ["lista:fb", "mias", "lista:fa", "todas", "no_leido", "sin_responder", "sin_asignar"], ocultas: [] };
  const conNueva = fila(pref, { isManager: true, idsDeListas: ["fa", "fb", "fc"] }).visibles;
  assert.equal(conNueva.at(-1), "lista:fc");
  const sinFa = fila(pref, { isManager: true, idsDeListas: ["fb"] }).visibles;
  assert.ok(!sinFa.includes("lista:fa"));
  assert.deepEqual(sinFa, ["lista:fb", "mias", "todas", "no_leido", "sin_responder", "sin_asignar"]);
  // Y al guardar de nuevo, la borrada ya no viaja.
  const guardada = orden.moverPastilla(pref, { isManager: true, idsDeListas: ["fb"] }, "mias", -1);
  assert.ok(!guardada.orden.includes("lista:fa"));
});

await prueba("la asesora no ve Todas ni Sin asignar aunque esten guardadas u ocultas", () => {
  const pref = { orden: ["todas", "sin_asignar", "sin_responder", "mias"], ocultas: ["todas"] };
  const { visibles, ocultas } = fila(pref, ASESORA);
  assert.deepEqual(visibles, ["sin_responder", "mias", "no_leido", "lista:fa", "lista:fb"]);
  assert.deepEqual(ocultas, [], "Todas no le aparece ni como oculta");
});

await prueba("mover: un lugar, sin la opcion que no aplica en los extremos, saltando las ocultas", () => {
  const visibles = fila(orden.SIN_PREFERENCIA, JEFE).visibles;
  assert.deepEqual(orden.movimientosPosibles(visibles, "todas"), { izquierda: false, derecha: true });
  assert.deepEqual(orden.movimientosPosibles(visibles, "lista:fb"), { izquierda: true, derecha: false });
  assert.deepEqual(orden.movimientosPosibles(visibles, "no_leido"), { izquierda: true, derecha: true });
  // La primera lista SI puede ir a la izquierda: las fijas ya son parte del orden.
  const listaPrimero = orden.moverPastilla(orden.SIN_PREFERENCIA, JEFE, "lista:fa", -1);
  assert.deepEqual(fila(listaPrimero, JEFE).visibles.slice(4, 6), ["lista:fa", "sin_asignar"]);
  assert.equal(orden.moverPastilla(orden.SIN_PREFERENCIA, JEFE, "todas", -1), null);
  assert.equal(orden.moverPastilla(orden.SIN_PREFERENCIA, JEFE, "lista:fb", 1), null);
  // Con "mias" oculta, mover "no_leido" a la izquierda la pone antes de "todas".
  const sinMias = orden.ocultarPastilla(orden.SIN_PREFERENCIA, JEFE, "mias");
  const movida = orden.moverPastilla(sinMias, JEFE, "no_leido", -1);
  assert.deepEqual(fila(movida, JEFE).visibles.slice(0, 2), ["no_leido", "todas"]);
  // Mias sigue oculta y conserva su lugar.
  assert.deepEqual(fila(movida, JEFE).ocultas, ["mias"]);
});

await prueba("ocultar y mostrar: solo las fijas; al mostrarla vuelve a su lugar", () => {
  const oculta = orden.ocultarPastilla(orden.SIN_PREFERENCIA, JEFE, "sin_asignar");
  assert.ok(!fila(oculta, JEFE).visibles.includes("sin_asignar"));
  assert.deepEqual(fila(oculta, JEFE).ocultas, ["sin_asignar"]);
  const dos = orden.ocultarPastilla(oculta, JEFE, "todas");
  assert.deepEqual(fila(dos, JEFE).ocultas, ["todas", "sin_asignar"]);
  const una = orden.mostrarPastilla(dos, JEFE, "sin_asignar");
  assert.deepEqual(fila(una, JEFE).visibles, ["mias", "no_leido", "sin_responder", "sin_asignar", "lista:fa", "lista:fb"]);
  const todas = orden.mostrarPastilla(dos, JEFE);
  assert.deepEqual(fila(todas, JEFE).ocultas, []);
  // Una lista no se oculta: la limpieza la saca de ocultas.
  assert.deepEqual(orden.limpiarPreferencia({ orden: [], ocultas: ["lista:fa"] }, ["fa"]).ocultas, []);
});

/* ------------------------------------------------------------------------------------------------
   2. La condicion no_leido en la direccion
------------------------------------------------------------------------------------------------ */
await prueba("direccion: no_leido:si se lee, se escribe y se nombra; otros operadores no", () => {
  const leer = (c) => filtrosDominio.leerFiltrosDeBandeja((clave) => (clave === "c" ? c : null)).condiciones;
  assert.deepEqual(leer("no_leido:si"), [{ campo: "no_leido", operador: "si" }]);
  assert.deepEqual(leer("no_leido:no"), []);
  assert.deepEqual(leer("no_leido:si;no_leido:si"), [{ campo: "no_leido", operador: "si" }]);
  assert.deepEqual(filtrosDominio.paramsDeFiltros({ condiciones: [{ campo: "no_leido", operador: "si" }] }), [["c", "no_leido:si"]]);
  assert.equal(filtrosDominio.textoDeCondicion({ campo: "no_leido", operador: "si" }, {}, new Date()), "no leídos");
  assert.ok(filtrosDominio.CAMPOS_DE_BANDEJA.some((c) => c.campo === "no_leido"));
  // Para /counts se quita, igual que sin_responder:si: tiene su propio numero.
  assert.deepEqual(
    pastillasBandeja.filtrosParaContar({ condiciones: [{ campo: "no_leido", operador: "si" }, { campo: "sin_responder", operador: "si" }] }),
    { condiciones: [] },
  );
});

await prueba("WHERE del canal viejo: no_leido entra como ids (sin lista, ninguno; nunca todos)", () => {
  const conLa = { condiciones: [{ campo: "no_leido", operador: "si" }] };
  assert.deepEqual(filtrosServicio.whereDeFiltros(conLa, { sinResponder: null, noLeidos: ["c1"] }), { AND: [{ id: { in: ["c1"] } }] });
  assert.deepEqual(filtrosServicio.whereDeFiltros(conLa, null), { AND: [{ id: { in: [] } }] });
  // La forma vieja (solo la lista de sin responder) sigue sirviendo.
  assert.deepEqual(
    filtrosServicio.whereDeFiltros({ condiciones: [{ campo: "sin_responder", operador: "si" }] }, ["x"]),
    { AND: [{ id: { in: ["x"] } }] },
  );
  assert.equal(filtrosServicio.necesitaIdsNoLeidos(conLa), true);
  assert.equal(filtrosServicio.necesitaIdsNoLeidos({ condiciones: [{ campo: "sin_responder", operador: "si" }] }), false);
});

/* ------------------------------------------------------------------------------------------------
   3. La base de prueba (PGlite)
------------------------------------------------------------------------------------------------ */
const WS = "ws_magilus";
await db.exec(`
  CREATE TABLE "Contact" (
    "id" text PRIMARY KEY, "workspaceId" text NOT NULL, "metadata" jsonb, "bloqueadoEn" timestamp(3), "crmStage" text
  );
  CREATE TABLE "Conversation" (
    "id" text PRIMARY KEY, "workspaceId" text NOT NULL, "channelId" text, "contactId" text NOT NULL,
    "assignedToUserId" text, "segundoAsesorId" text, "status" text NOT NULL, "lastMessageAt" timestamp(3)
  );
  CREATE TABLE "Message" (
    "id" text PRIMARY KEY, "workspaceId" text NOT NULL, "conversationId" text, "channelId" text,
    "direction" text NOT NULL, "type" text NOT NULL, "status" text NOT NULL, "readAt" timestamp(3),
    "isStatusBroadcast" boolean NOT NULL DEFAULT false, "deletedAt" timestamp(3), "rawPayload" jsonb,
    "createdAt" timestamp(3) NOT NULL
  );
  CREATE TABLE "OfficialApiContact" ("id" text PRIMARY KEY, "configId" text NOT NULL, "crmContactId" text);
  CREATE TABLE "OfficialApiConversation" (
    "id" text PRIMARY KEY, "configId" text NOT NULL, "contactId" text NOT NULL, "assignedToUserId" text,
    "status" text NOT NULL, "lastMessageAt" timestamp(3), "createdAt" timestamp(3)
  );
  CREATE TABLE "OfficialApiMessage" (
    "id" text PRIMARY KEY, "configId" text NOT NULL, "conversationId" text NOT NULL, "direction" text NOT NULL,
    "type" text NOT NULL, "status" text NOT NULL, "readAt" timestamp(3), "rawPayload" jsonb, "createdAt" timestamp(3) NOT NULL
  );
`);

const AHORA = Date.now();
const haceHoras = (h) => new Date(AHORA - h * 3_600_000);
let n = 0;
const IN = "INBOUND";
const OUT = "OUTBOUND";

/** Un chat del canal viejo. `mensajes`: [direccion, horasAtras, { leido, estado }]. */
async function chat(id, mensajes, extra = {}) {
  const contactId = `ct_${id}`;
  const ws = extra.workspaceId ?? WS;
  await db.query(`INSERT INTO "Contact" VALUES ($1,$2,$3,$4,$5)`, [contactId, ws, null, extra.bloqueado ? haceHoras(5) : null, null]);
  await db.query(`INSERT INTO "Conversation" VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [
    id, ws, extra.canal ?? "canal_1", contactId, extra.asesora ?? null, extra.segunda ?? null, extra.estado ?? "OPEN", haceHoras(1),
  ]);
  for (const [direccion, horas, o = {}] of mensajes) {
    await db.query(`INSERT INTO "Message" VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [
      `m_${++n}`, ws, id, extra.canal ?? "canal_1", direccion, "TEXT", direccion === IN ? "RECEIVED" : "SENT",
      o.leido ? haceHoras(horas - 0.1) : null, o.estado ?? false, null, JSON.stringify({ grande: "x".repeat(50) }), haceHoras(horas),
    ]);
  }
}

await chat("c_sin_duena", [[IN, 1]]);
await chat("c_maria", [[OUT, 3], [IN, 1]], { asesora: "maria" });
await chat("c_ana", [[IN, 2]], { asesora: "ana" });
await chat("c_ana_segunda_maria", [[IN, 2]], { asesora: "ana", segunda: "maria" });
await chat("c_otra_linea", [[IN, 1]], { canal: "canal_2" });
// Viejo pero sin abrir, con un mensaje leido despues: el globo verde sigue (no mira la saliente).
await chat("c_respondido_sin_abrir", [[IN, 3], [OUT, 2]], { asesora: "maria" });
/* --- Fuera --- */
await chat("c_leido", [[IN, 2, { leido: true }]], { asesora: "maria" });
await chat("c_solo_nuestro", [[OUT, 1]], { asesora: "maria" });
await chat("c_estado_whatsapp", [[IN, 1, { estado: true }]]);
await chat("c_de_hace_meses", [[IN, 24 * 90]]);
await chat("c_resuelto", [[IN, 1]], { estado: "CLOSED" });
await chat("c_bloqueado", [[IN, 1]], { bloqueado: true });
await chat("c_otro_negocio", [[IN, 1]], { workspaceId: "ws_otro" });

/** Un chat de la linea oficial. */
async function chatOficial(id, mensajes, extra = {}) {
  await db.query(`INSERT INTO "OfficialApiContact" VALUES ($1,$2,$3)`, [`oc_${id}`, extra.config ?? "cfg_1", null]);
  await db.query(`INSERT INTO "OfficialApiConversation" VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
    id, extra.config ?? "cfg_1", `oc_${id}`, extra.asesora ?? null, extra.estado ?? "OPEN", haceHoras(1), haceHoras(48),
  ]);
  for (const [direccion, horas, o = {}] of mensajes) {
    await db.query(`INSERT INTO "OfficialApiMessage" VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
      `om_${++n}`, extra.config ?? "cfg_1", id, direccion, "TEXT", direccion === IN ? "RECEIVED" : "SENT",
      o.leido ? haceHoras(horas - 0.1) : null, JSON.stringify({ grande: "x".repeat(50) }), haceHoras(horas),
    ]);
  }
}

await chatOficial("of_sin_duena", [[IN, 1]]);
await chatOficial("of_maria", [[OUT, 3], [IN, 2], [IN, 1]], { asesora: "maria" });
/* --- Fuera --- */
// En la oficial el globo verde se va al responder (cuenta solo lo posterior a la ultima saliente).
await chatOficial("of_respondido", [[IN, 2], [OUT, 1]]);
await chatOficial("of_leido", [[IN, 2, { leido: true }]], { asesora: "maria" });
await chatOficial("of_de_hace_meses", [[IN, 24 * 90]]);
await chatOficial("of_resuelto", [[IN, 1]], { estado: "CLOSED" });
await chatOficial("of_otro_negocio", [[IN, 1]], { config: "cfg_otro" });

/* ------------------------------------------------------------------------------------------------
   4. El SQL de No leido en las dos fuentes
------------------------------------------------------------------------------------------------ */
await prueba("canal viejo: no leido = entrantes sin abrir de los ultimos 60 dias, sin estados de WhatsApp", async () => {
  const filas = await correrSql(ultimoMensaje.sqlIdsNoLeidos({ workspaceId: WS, canales: null, dias: filtrosDominio.DIAS_DE_NO_LEIDO }));
  assert.deepEqual(
    filas.map((f) => f.conversationId).sort(),
    ["c_ana", "c_ana_segunda_maria", "c_bloqueado", "c_maria", "c_otra_linea", "c_respondido_sin_abrir", "c_resuelto", "c_sin_duena"],
    "el estado, el bloqueo y la linea los aplica la bandeja encima",
  );
  const soloLinea1 = await correrSql(ultimoMensaje.sqlIdsNoLeidos({ workspaceId: WS, canales: ["canal_1"], dias: 60 }));
  assert.ok(!soloLinea1.some((f) => f.conversationId === "c_otra_linea"));
  assert.deepEqual(await correrSql(ultimoMensaje.sqlIdsNoLeidos({ workspaceId: WS, canales: [], dias: 60 })), []);
});

await prueba("linea oficial: el mismo fragmento que usan la lista y el contador", async () => {
  const { etapa } = await oficial.fragmentosDeFiltrosOficiales({ condiciones: [{ campo: "no_leido", operador: "si" }] }, WS);
  const filas = await correrSql(Prisma.sql`
    SELECT c."id" FROM "OfficialApiConversation" c WHERE c."configId" = 'cfg_1' ${etapa} ORDER BY c."id"`);
  assert.deepEqual(filas.map((f) => f.id), ["of_maria", "of_resuelto", "of_sin_duena"]);
});

await prueba("rendimiento: ninguna de las dos abre el rawPayload", () => {
  const viejo = ultimoMensaje.sqlIdsNoLeidos({ workspaceId: WS, canales: null, dias: 60 }).text;
  const deLaOficial = ultimoMensaje.sqlOficialNoLeido(60).text;
  assert.doesNotMatch(viejo, /rawPayload/);
  assert.doesNotMatch(deLaOficial, /rawPayload/);
  // Va por la fecha (indice por negocio y fecha), con tope de dias.
  assert.match(viejo, /"createdAt" > now\(\) - make_interval/);
});

/* ------------------------------------------------------------------------------------------------
   5. La ruta /counts: cada persona cuenta lo suyo, en las dos fuentes
------------------------------------------------------------------------------------------------ */
const { GET: contar } = cargar("@/app/api/cliente/chats/counts/route");

async function pedirConteos(query = "") {
  const respuesta = await contar(new Request(`http://local/api/cliente/chats/counts${query}`));
  const cuerpo = await respuesta.json();
  assert.equal(cuerpo.ok, true, JSON.stringify(cuerpo));
  return cuerpo.counts;
}

function como(persona) {
  Object.assign(escenario, {
    sesion: { user: { id: persona.id, role: persona.rol ?? "CLIENTE" } },
    rolEnElNegocio: persona.enElNegocio,
    visibles: persona.visibles ?? null,
    monitoreados: persona.monitoreados ?? [],
  });
}

await prueba("/counts dueño: No leido de todo lo que ve, canal viejo + linea oficial", async () => {
  como({ id: "dueno", enElNegocio: "OWNER" });
  const conteos = await pedirConteos();
  // Viejo: sin dueña, maria, ana, ana+maria, otra linea, respondido sin abrir (6). Oficial: 2.
  assert.equal(conteos.noLeido, 8);
  assert.equal(typeof conteos.sinResponder, "number", "Sin responder sigue con su numero");
  assert.notEqual(conteos.noLeido, conteos.all, "No leido ya no dice casi lo mismo que Todas");
});

await prueba("/counts asesora: solo lo suyo (principal o segunda), tambien en la oficial", async () => {
  como({ id: "maria", rol: "EMPLEADO", enElNegocio: "AGENT" });
  // Viejo: c_maria, c_ana_segunda_maria, c_respondido_sin_abrir (3). Oficial: of_maria (1).
  assert.equal((await pedirConteos()).noLeido, 4);
  como({ id: "ana", rol: "EMPLEADO", enElNegocio: "AGENT" });
  // Ana no ve los de Maria: c_ana y c_ana_segunda_maria (es la principal). Nada en la oficial.
  assert.equal((await pedirConteos()).noLeido, 2);
  como({ id: "nadie", rol: "EMPLEADO", enElNegocio: "AGENT" });
  assert.equal((await pedirConteos()).noLeido, 0);
});

await prueba("/counts monitora: lo de sus lineas", async () => {
  como({ id: "moni", rol: "EMPLEADO", enElNegocio: "AGENT", monitoreados: ["canal_2"] });
  // Viejo: solo c_otra_linea. La oficial, como Sin responder: entra entera (verTodo).
  assert.equal((await pedirConteos()).noLeido, 3);
});

await prueba("/counts: No leido respeta el estado y las demas condiciones puestas", async () => {
  como({ id: "dueno", enElNegocio: "OWNER" });
  // Resueltas: c_resuelto y of_resuelto.
  assert.equal((await pedirConteos("?status=resolved")).noLeido, 2);
  // Con "Asesora es Maria" puesta: c_maria, c_respondido_sin_abrir y of_maria.
  assert.equal((await pedirConteos("?c=asesora:es:maria")).noLeido, 3);
  // Con no_leido:si en la base (la lista abierta en No leido), Todas cuenta lo mismo que la lista.
  const enNoLeido = await pedirConteos("?c=no_leido:si");
  assert.equal(enNoLeido.all, enNoLeido.noLeido);
});

/* ------------------------------------------------------------------------------------------------
   6. Las rutas que guardan: cada persona lo suyo
------------------------------------------------------------------------------------------------ */
const pastillasRuta = cargar("@/app/api/cliente/chats/pastillas/route");
const listasRuta = cargar("@/app/api/cliente/chats/filtros-guardados/route");

ajustes.set("chats:filtros:dueno", JSON.stringify([
  { id: "fd1", nombre: "Calientes", query: "stage=NEGOCIACION" },
  { id: "fd2", nombre: "Maria", query: "assigned=user%3Amaria" },
]));
ajustes.set("chats:filtros:maria", JSON.stringify([{ id: "fm1", nombre: "Mis nuevos", query: "stage=NUEVO" }]));

async function guardar(cuerpo) {
  const respuesta = await pastillasRuta.PUT(
    new Request("http://local/api/cliente/chats/pastillas", { method: "PUT", body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo) }),
  );
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

await prueba("guardar: se limpia en el servidor (claves conocidas y listas de esa misma persona)", async () => {
  como({ id: "dueno", enElNegocio: "OWNER" });
  const { estado, cuerpo } = await guardar({
    orden: ["sin_responder", "lista:fd2", "lista:fm1", "<script>", "todas", "todas"],
    ocultas: ["sin_asignar", "lista:fd1", "x"],
  });
  assert.equal(estado, 200);
  assert.deepEqual(cuerpo.pastillas, { orden: ["sin_responder", "lista:fd2", "todas"], ocultas: ["sin_asignar"] });
  assert.deepEqual(JSON.parse(ajustes.get("chats:pastillas:dueno")), cuerpo.pastillas);
  // Algo que no es un objeto no se guarda.
  assert.equal((await guardar("[1,2]")).estado, 400);
  assert.equal((await guardar("no es json")).estado, 400);
});

await prueba("cada persona lo suyo: lo del dueño no cambia la bandeja de la asesora", async () => {
  como({ id: "maria", rol: "EMPLEADO", enElNegocio: "AGENT" });
  const deMaria = await (await pastillasRuta.GET()).json();
  assert.deepEqual(deMaria.pastillas, { orden: [], ocultas: [] }, "Maria sigue con el orden por defecto");
  await guardar({ orden: ["no_leido", "lista:fm1", "lista:fd1"], ocultas: ["sin_responder"] });
  assert.deepEqual(JSON.parse(ajustes.get("chats:pastillas:maria")), { orden: ["no_leido", "lista:fm1"], ocultas: ["sin_responder"] });
  // Lo del dueño quedo igual.
  assert.deepEqual(JSON.parse(ajustes.get("chats:pastillas:dueno")).orden, ["sin_responder", "lista:fd2", "todas"]);
});

await prueba("las listas viajan con el orden de la persona, ya limpio contra sus listas de hoy", async () => {
  como({ id: "dueno", enElNegocio: "OWNER" });
  // Se borra fd2: desaparece del orden que se lee.
  const borrar = await listasRuta.DELETE(new Request("http://local/api/cliente/chats/filtros-guardados?id=fd2", { method: "DELETE" }));
  assert.equal((await borrar.json()).ok, true);
  const leido = await (await listasRuta.GET()).json();
  assert.deepEqual(leido.filtros.map((f) => f.id), ["fd1"]);
  assert.deepEqual(leido.pastillas, { orden: ["sin_responder", "todas"], ocultas: ["sin_asignar"] });
  // Lo que se dibuja: Sin responder de primera, la lista fd1 al final.
  assert.deepEqual(orden.pastillasDeLaFila(leido.pastillas, { isManager: true, idsDeListas: ["fd1"] }).visibles, [
    "sin_responder", "todas", "mias", "no_leido", "lista:fd1",
  ]);
  // Un valor dañado en la base: la bandeja abre con el orden por defecto.
  ajustes.set("chats:pastillas:dueno", "{roto");
  const roto = await (await listasRuta.GET()).json();
  assert.deepEqual(roto.pastillas, { orden: [], ocultas: [] });
});

await prueba("sin sesion no se lee ni se guarda", async () => {
  escenario.sesion = null;
  assert.equal((await pastillasRuta.GET()).status, 401);
  assert.equal((await guardar({ orden: [] })).estado, 401);
});

/* ------------------------------------------------------------------------------------------------
   7. La barra: usa estas reglas (no una lista fija de pastillas)
------------------------------------------------------------------------------------------------ */
await prueba("barra: la fila sale de pastillasDeLaFila y el menu trae mover y ocultar", () => {
  const barra = fs.readFileSync(path.join(raiz, "components/chats/appsidebar.tsx"), "utf8");
  assert.match(barra, /pastillasDeLaFila\(preferencia, contextoDeLaFila\)/);
  assert.match(barra, /isManager, idsDeListas: listas\.map/);
  assert.doesNotMatch(barra, /PASTILLAS_A_LA_VISTA/);
  assert.match(barra, /"Mover a la izquierda"/);
  assert.match(barra, /"Mover a la derecha"/);
  assert.match(barra, /texto: "Ocultar"/);
  assert.match(barra, /Mostrar pastillas ocultas/);
  assert.match(barra, /\/api\/cliente\/chats\/pastillas/);
  // El numero de cada una: sinResponder para Sin responder, noLeido para No leido.
  assert.match(barra, /clave === "sin_responder" \? assignedCounts\?\.sinResponder : assignedCounts\?\.noLeido/);
});

console.log(`\n${pruebas} pruebas ok`);
