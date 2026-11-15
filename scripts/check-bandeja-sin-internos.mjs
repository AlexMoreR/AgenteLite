// Pruebas del GRUPO de la bandeja (clientes / equipo / proveedores / todos), parte 2 de "sacar los
// avisos internos de la lista de clientes": la regla en /api/cliente/chats/list y en la linea oficial.
// Parte 3: la pantalla, los numeros de /counts (Equipo y Proveedores) y las pantallas que piden todo.
//
// No necesita base: usa el Prisma REAL con el pool de pg falso de check-velocidad-bandeja.mjs (mismo
// cargador de src), pero la consulta de los contactos internos y los fragmentos de la linea oficial
// corren en un Postgres embebido (PGlite) con chats armados a mano. El WHERE que arma /list se
// evalua en JS sobre los mismos chats.
// Correr: npm run test:bandeja-sin-internos   (requiere `prisma generate` hecho)
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
   Los datos: negocio "x1" (el id que devuelve el pool falso), la asesora es "x1" y otra asesora "a2".
------------------------------------------------------------------------------------------------ */
const WS = "x1";
const ASESORA = "x1";
const NUMERO_DE_AVISOS = "573002223333"; // en el contacto esta guardado SIN el 57
const NUMERO_DE_LINEA = "+57 310 555 0000"; // la linea Ventas 1 del negocio

const CONTACTOS = [
  { id: "k_cliente", name: "Cliente Uno", phone: "573111111111", tags: [], asesora: ASESORA },
  { id: "k_cliente_otra", name: "Cliente Dos", phone: "573111111112", tags: [], asesora: "a2" },
  { id: "k_cliente_sin", name: "Cliente Tres", phone: "573111111113", tags: [], asesora: null },
  { id: "k_equipo", name: "Jair Coordinador", phone: "573122222222", tags: ["t_equipo"], asesora: ASESORA },
  { id: "k_equipo_otra", name: "Ingrid Equipo", phone: "573122222223", tags: ["t_equipo"], asesora: "a2" },
  { id: "k_aviso", name: "Numero de avisos", phone: "3002223333", tags: [], asesora: ASESORA },
  { id: "k_linea", name: "Linea Ventas 1", phone: "573105550000", tags: [], asesora: ASESORA },
  { id: "k_prov", name: "Proveedor Telas", phone: "573133333333", tags: ["t_prov"], asesora: ASESORA },
  { id: "k_prov_otra", name: "Proveedor Hilos", phone: "573133333334", tags: ["t_provs"], asesora: "a2" },
  { id: "k_ambos", name: "Equipo y Proveedor", phone: "573144444444", tags: ["t_equipo", "t_prov"], asesora: ASESORA },
  { id: "k_vip", name: "Cliente VIP", phone: "573155555555", tags: ["t_vip"], asesora: ASESORA },
];
const ETIQUETAS = [
  { id: "t_equipo", name: "EQUIPO", slug: "equipo" },
  { id: "t_prov", name: "Proveedor", slug: "proveedor" },
  { id: "t_provs", name: "PROVEEDORES", slug: "proveedores-2" },
  // Contiene "equipo" pero NO es la etiqueta EQUIPO: no cuenta.
  { id: "t_vip", name: "VIP del equipo", slug: "vip-del-equipo" },
];
const CHATS = CONTACTOS.map((contacto) => ({
  id: `c_${contacto.id.slice(2)}`,
  workspaceId: WS,
  contactId: contacto.id,
  channelId: "x1",
  assignedToUserId: contacto.asesora,
  segundoAsesorId: null,
  status: "OPEN",
  lastMessageAt: new Date("2026-11-14T10:00:00Z"),
  updatedAt: new Date("2026-11-14T10:00:00Z"),
  contact: {
    id: contacto.id,
    name: contacto.name,
    phoneNumber: contacto.phone,
    bloqueadoEn: null,
    crmStage: null,
    ContactTag: contacto.tags.map((tagId) => ({ tagId })),
  },
}));

const db = new PGlite();
await db.exec(`
  CREATE TABLE "Contact" ("id" text PRIMARY KEY, "workspaceId" text NOT NULL, "name" text, "phoneNumber" text NOT NULL);
  CREATE TABLE "Tag" ("id" text PRIMARY KEY, "workspaceId" text NOT NULL, "name" text NOT NULL, "slug" text NOT NULL);
  CREATE TABLE "ContactTag" ("contactId" text NOT NULL, "tagId" text NOT NULL, "workspaceId" text NOT NULL);
  CREATE TABLE "WhatsAppChannel" ("id" text PRIMARY KEY, "workspaceId" text NOT NULL, "phoneNumber" text);
  CREATE TABLE "AppSetting" ("key" text PRIMARY KEY, "value" text NOT NULL);
  CREATE TABLE "OfficialApiContact" (
    "id" text PRIMARY KEY, "waId" text NOT NULL, "name" text, "phoneNumber" text, "crmContactId" text
  );
  CREATE TABLE "OfficialApiConversation" (
    "id" text PRIMARY KEY, "contactId" text NOT NULL, "assignedToUserId" text,
    "configId" text NOT NULL DEFAULT 'x1', "status" text NOT NULL DEFAULT 'OPEN'
  );
`);
for (const c of CONTACTOS) {
  await db.query(`INSERT INTO "Contact" VALUES ($1, $2, $3, $4)`, [c.id, WS, c.name, c.phone]);
  for (const tagId of c.tags) await db.query(`INSERT INTO "ContactTag" VALUES ($1, $2, $3)`, [c.id, tagId, WS]);
}
for (const t of ETIQUETAS) await db.query(`INSERT INTO "Tag" VALUES ($1, $2, $3, $4)`, [t.id, WS, t.name, t.slug]);
// Una etiqueta EQUIPO de OTRO negocio no cuenta.
await db.query(`INSERT INTO "Tag" VALUES ('t_ajeno', 'otro', 'EQUIPO', 'equipo')`);
await db.query(`INSERT INTO "WhatsAppChannel" VALUES ('ch1', $1, $2), ('ch2', $1, NULL), ('ch3', 'otro', '573199999999')`, [
  WS,
  NUMERO_DE_LINEA,
]);
/*
  Linea oficial: un cliente, uno del equipo por su ficha del CRM, uno del equipo SOLO por numero
  (sin ficha del CRM: el waId es el de avisos), un proveedor y uno sin ficha.
*/
const OFICIALES = [
  { id: "o_cliente", crm: "k_cliente", waId: "573111111111", phone: "573111111111" },
  { id: "o_equipo", crm: "k_equipo", waId: "573122222222", phone: null },
  { id: "o_aviso", crm: null, waId: NUMERO_DE_AVISOS, phone: null },
  { id: "o_prov", crm: "k_prov", waId: "573133333333", phone: "573133333333" },
  { id: "o_suelto", crm: null, waId: "573177777777", phone: null },
];
for (const o of OFICIALES) {
  await db.query(`INSERT INTO "OfficialApiContact" VALUES ($1, $2, NULL, $3, $4)`, [`f_${o.id}`, o.waId, o.phone, o.crm]);
  await db.query(`INSERT INTO "OfficialApiConversation" VALUES ($1, $2, $3)`, [o.id, `f_${o.id}`, ASESORA]);
}

/* ------------------------------------------------------------------------------------------------
   Pool de pg falso (el de check-velocidad-bandeja.mjs) + PGlite para la consulta de internos.
------------------------------------------------------------------------------------------------ */
const pg = require("pg");
const escenario = { userRole: "CLIENTE", memberRole: "OWNER" };
const sqls = [];
const CONFIG_DE_AVISOS = JSON.stringify({
  canalId: "ch1",
  activo: true,
  destinos: [{ numero: NUMERO_DE_AVISOS, soloDe: null, nombre: "Alex" }],
});

// La config de avisos la lee la misma SQL de los internos (en PGlite). Otro negocio con una config
// sin canalId (no cuenta) y otro con un valor roto (no tumba la consulta).
await db.query(`INSERT INTO "AppSetting" VALUES ($1, $2), ($3, $4), ($5, $6)`, [
  `agente-v3:avisos:${WS}`,
  CONFIG_DE_AVISOS,
  "agente-v3:avisos:sin_canal",
  JSON.stringify({ destinos: [{ numero: "573008889999" }] }),
  "agente-v3:avisos:roto",
  '{"canalId": "c", "destinos": [{"numero": "573007776666"',
]);

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

function valor(tabla, col, valores) {
  if (/^_aggr_count/.test(col)) return [23, 0];
  if (col === "role") return [25, tabla === "User" ? escenario.userRole : escenario.memberRole];
  if (col === "provider") return [25, "EVOLUTION"];
  if (col === "status") return [25, tabla === "Conversation" ? "OPEN" : "CONNECTED"];
  if (col === "moduleAccess") return [3802, JSON.stringify(["chats"])];
  if (col === "metadata" || col === "activeProductContext") return [3802, "{}"];
  if (col === "crmStage" || col === "planTier") return [25, null];
  if (col === "value") {
    const esAvisos = (valores ?? []).includes(`agente-v3:avisos:${WS}`);
    return [25, esAvisos ? CONFIG_DE_AVISOS : "[]"];
  }
  if (/At$/.test(col)) return [1114, "2026-10-08 10:00:00.000"];
  if (col === "isActive") return [16, true];
  if (/^is[A-Z]/.test(col) || col === "automationPaused") return [16, false];
  if (col === "name" || col === "email" || col === "phoneNumber" || col === "key") return [25, "n"];
  return [25, "x1"];
}

const esConsultaDeInternos = (texto) => texto.includes(`'telefono' AS "tipo"`);
// Para probar que la bandeja no se cae si la consulta de los internos falla.
const caida = { internos: false };
// El conteo por SQL de la linea oficial en /counts (countOfficialConversations): corre en PGlite.
const esConteoOficial = (texto) => texto.includes('FROM "OfficialApiConversation" c') && texto.includes("COUNT(*)");

class PoolFalso extends pg.Pool {
  async query(q) {
    const text = typeof q === "string" ? q : q.text;
    const valores = typeof q === "string" ? [] : (q.values ?? []);
    sqls.push(text);
    if (esConsultaDeInternos(text)) {
      if (caida.internos) throw new Error("la base no responde (prueba)");
      const r = await db.query(text, valores, { rowMode: "array" });
      return { fields: r.fields.map((f) => ({ name: f.name, dataTypeID: 25 })), rows: r.rows, rowCount: r.rows.length };
    }
    if (esConteoOficial(text) && text.includes('"OfficialApiMessage"')) {
      // Las pastillas Sin responder / No leido de la linea oficial: aca no hay mensajes, valen 0.
      return { fields: [{ name: "total", dataTypeID: 20 }], rows: [["0"]], rowCount: 1 };
    }
    if (esConteoOficial(text)) {
      const r = await db.query(text, valores, { rowMode: "array" });
      return {
        fields: r.fields.map((f) => ({ name: f.name, dataTypeID: 20 })),
        rows: r.rows.map((fila) => fila.map(String)),
        rowCount: r.rows.length,
      };
    }
    const info = columnas(text);
    if (!info) return { fields: [], rows: [], rowCount: 1 };
    return {
      fields: info.cols.map((c) => ({ name: c, dataTypeID: valor(info.tabla, c, valores)[0] })),
      rows: [info.cols.map((c) => valor(info.tabla, c, valores)[1])],
      rowCount: 1,
    };
  }
  async connect() {
    return { query: (q) => this.query(q), release() {}, on() {}, removeListener() {} };
  }
}

/* ------------------------------------------------------------------------------------------------
   Cargador de los .ts de src (con el alias @/), el mismo de check-velocidad-bandeja.mjs.
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

const sesion = { actual: { user: { id: ASESORA, role: "CLIENTE" } } };
const cargar = cargadorDeSrc(sesion);
const dominio = cargar("@/features/chats/domain/filtros-de-bandeja");
const servicio = cargar("@/features/chats/services/filtros-de-bandeja");
const internosMod = cargar("@/features/chats/services/contactos-internos");
const permisos = cargar("@/lib/cache-de-permisos");
const { GET } = cargar("@/app/api/cliente/chats/list/route");
const { GET: GET_COUNTS } = cargar("@/app/api/cliente/chats/counts/route");
const oficial = cargar("@/features/official-api/services/getOfficialApiChatsData");
const { prisma } = cargar("@/lib/prisma");

/* ------------------------------------------------------------------------------------------------
   Se anota el WHERE de cada conversation.findMany (y la consulta sigue al pool falso).
------------------------------------------------------------------------------------------------ */
const wheres = [];
const conteos = [];
void prisma.conversation; // crea el cliente real
const real = globalThis.prisma;
// La linea oficial para el conteo por Prisma de /counts (sin grupo): las mismas filas que PGlite.
const FILAS_OFICIALES = OFICIALES.map((o) => ({
  configId: "x1",
  status: "OPEN",
  assignedToUserId: ASESORA,
  contact: { name: null, waId: o.waId },
}));
globalThis.prisma = new Proxy(real, {
  get(objetivo, prop) {
    const valorReal = Reflect.get(objetivo, prop, objetivo);
    if (prop === "officialApiConversation") {
      return new Proxy(valorReal, {
        get(delegado, metodo) {
          const original = Reflect.get(delegado, metodo, delegado);
          if (metodo === "count") return async (args) => FILAS_OFICIALES.filter((fila) => cumple(fila, args?.where)).length;
          return typeof original === "function" ? original.bind(delegado) : original;
        },
      });
    }
    if (prop !== "conversation") return typeof valorReal === "function" ? valorReal.bind(objetivo) : valorReal;
    return new Proxy(valorReal, {
      get(delegado, metodo) {
        const original = Reflect.get(delegado, metodo, delegado);
        if (metodo === "count") {
          // /counts: el numero sale de evaluar el WHERE sobre los mismos chats de la prueba.
          return async (args) => {
            conteos.push(args?.where);
            return CHATS.filter((chat) => cumple(chat, args?.where)).length;
          };
        }
        if (metodo !== "findMany") return typeof original === "function" ? original.bind(delegado) : original;
        return (args) => {
          wheres.push(args?.where);
          return original.call(delegado, args);
        };
      },
    });
  },
});

// Evalua en JS un WHERE de Prisma (solo lo que arma la lista). Algo desconocido rompe la prueba.
function escalar(v, cond) {
  if (cond === null) return v === null;
  if (cond instanceof Date) return v instanceof Date && v.getTime() === cond.getTime();
  if (typeof cond !== "object") return v === cond;
  const t = (x) => (x instanceof Date ? x.getTime() : x);
  for (const [op, x] of Object.entries(cond)) {
    switch (op) {
      case "in":
        if (!x.includes(v)) return false;
        break;
      case "notIn":
        if (v === null || x.includes(v)) return false;
        break;
      case "not":
        if (x === null ? v === null : v === x) return false;
        break;
      case "equals":
        if (v !== x) return false;
        break;
      case "contains": {
        if (v == null) return false;
        const insensible = cond.mode === "insensitive";
        if (!(insensible ? v.toLowerCase() : v).includes(insensible ? x.toLowerCase() : x)) return false;
        break;
      }
      case "mode":
        break;
      case "gte":
        if (v === null || t(v) < t(x)) return false;
        break;
      case "lt":
        if (v === null || t(v) >= t(x)) return false;
        break;
      default:
        throw new Error(`operador no soportado: ${op}`);
    }
  }
  return true;
}
function cumple(fila, where) {
  for (const [clave, cond] of Object.entries(where ?? {})) {
    if (clave === "AND") {
      if (!cond.every((w) => cumple(fila, w))) return false;
    } else if (clave === "OR") {
      if (!cond.some((w) => cumple(fila, w))) return false;
    } else if (clave === "contact") {
      if (!cumple(fila.contact, cond)) return false;
    } else if (clave === "ContactTag") {
      if (cond.some && !fila.ContactTag.some((t) => cumple(t, cond.some))) return false;
      if (cond.none && fila.ContactTag.some((t) => cumple(t, cond.none))) return false;
    } else if (clave === "messages") {
      // Los chats de prueba no tienen mensajes guardados.
      if (cond.some) return false;
    } else {
      if (!(clave in fila)) throw new Error(`campo no soportado: ${clave}`);
      if (!escalar(fila[clave], cond)) return false;
    }
  }
  return true;
}

const logOriginal = console.log;
async function pedir(query, { rol = "asesora" } = {}) {
  if (rol === "asesora") {
    escenario.userRole = "EMPLEADO";
    escenario.memberRole = "AGENT";
    sesion.actual = { user: { id: ASESORA, role: "EMPLEADO" } };
  } else {
    escenario.userRole = "CLIENTE";
    escenario.memberRole = "OWNER";
    sesion.actual = { user: { id: ASESORA, role: "CLIENTE" } };
  }
  permisos.vaciarCachesDePermisos();
  internosMod.vaciarCacheDeContactosInternos();
  sqls.length = 0;
  wheres.length = 0;
  console.log = () => {};
  try {
    const res = await GET(new Request(`http://x/api/cliente/chats/list?limit=50&${query}`));
    const cuerpo = await res.json();
    assert.equal(cuerpo.ok, true, JSON.stringify(cuerpo));
  } finally {
    console.log = logOriginal;
  }
  assert.ok(wheres.length > 0, "no salio la consulta de la lista");
  const where = wheres[0];
  return {
    where,
    sqls: [...sqls],
    leyoInternos: sqls.some(esConsultaDeInternos),
    contactos: CHATS.filter((chat) => cumple(chat, where)).map((chat) => chat.contactId).sort(),
  };
}

const INTERNOS = ["k_equipo", "k_equipo_otra", "k_aviso", "k_linea", "k_ambos"];
const PROVEEDORES = ["k_prov", "k_prov_otra"];
const DE_LA_ASESORA = CONTACTOS.filter((c) => c.asesora === ASESORA).map((c) => c.id);
const ordenar = (lista) => [...lista].sort();
const menos = (lista, fuera) => ordenar(lista.filter((id) => !fuera.includes(id)));

/* ------------------------------------------------------------------------------------------------
   1. El grupo en la direccion
------------------------------------------------------------------------------------------------ */
const leer = (query) => dominio.leerFiltrosDeBandeja((clave) => new URLSearchParams(query).get(clave));

await prueba("direccion: grupo se lee, lo desconocido se ignora y viaja solo si vino", async () => {
  assert.equal(dominio.GRUPO_POR_DEFECTO, "clientes");
  assert.equal(leer("grupo=equipo").grupo, "equipo");
  assert.equal(leer("grupo=CLIENTES").grupo, "clientes");
  assert.equal("grupo" in leer("grupo=jefes"), false);
  assert.equal("grupo" in leer(""), false);
  assert.deepEqual(dominio.paramsDeFiltros(leer("")), []);
  assert.deepEqual(dominio.paramsDeFiltros(leer("grupo=proveedores")), [["grupo", "proveedores"]]);
  assert.deepEqual(dominio.paramsDeFiltros(leer("c=sin_responder:si&grupo=equipo")), [
    ["c", "sin_responder:si"],
    ["grupo", "equipo"],
  ]);
  // No es una condicion: no prende las chapitas ni "hay filtros".
  assert.equal(dominio.hayFiltrosPuestos(leer("grupo=equipo")), false);
  assert.equal(dominio.hayFiltrosPuestos(leer("grupo=equipo&c=sin_responder:si")), true);
});

await prueba("regla: con texto en el buscador el grupo no filtra", async () => {
  assert.equal(servicio.grupoQueAplica(leer("grupo=equipo"), "Jair"), "todos");
  assert.equal(servicio.grupoQueAplica(leer("grupo=equipo"), "  "), "equipo");
  // Sin grupo en la direccion aplica el de por defecto: clientes.
  assert.equal(servicio.grupoQueAplica(leer(""), ""), "clientes");
  assert.equal(servicio.grupoQueAplica(leer(""), "Jair"), "todos");
});

/* ------------------------------------------------------------------------------------------------
   2. Los contactos internos (la SQL corre en PGlite)
------------------------------------------------------------------------------------------------ */
await prueba("internos: etiquetas, numeros de avisos y lineas, con y sin 57; EQUIPO gana", async () => {
  internosMod.vaciarCacheDeContactosInternos();
  sqls.length = 0;
  const internos = await internosMod.contactosInternos(WS);
  assert.deepEqual(internos.equipoIds, ordenar(INTERNOS));
  assert.deepEqual(internos.proveedorIds, ordenar(PROVEEDORES));
  assert.deepEqual(internos.etiquetasEquipoIds, ["t_equipo"]);
  assert.deepEqual(internos.etiquetasProveedorIds, ["t_prov", "t_provs"]);
  for (const n of ["573002223333", "3002223333", "573105550000", "3105550000"]) {
    assert.ok(internos.variantesDeTelefono.includes(n), `falta la variante ${n}`);
  }
  assert.ok(!internos.variantesDeTelefono.includes("573199999999"), "una linea de otro negocio no cuenta");
  // En frio: UNA consulta (config de avisos, etiquetas y telefonos). En caliente, ninguna.
  assert.equal(sqls.length, 1, sqls.join("\n---\n"));
  sqls.length = 0;
  await internosMod.contactosInternos(WS);
  assert.equal(sqls.length, 0);
  // La clave es la misma que usa leerConfigDeAvisos.
  const avisos = fs.readFileSync(path.join(raiz, "features/agente-v3/servicios/avisos.ts"), "utf8");
  assert.match(avisos, new RegExp(`const CLAVE = "${internosMod.PREFIJO_CONFIG_DE_AVISOS}";`));
  // Una config sin canalId no cuenta (como en leerConfigDeAvisos) y un valor roto no rompe nada.
  internosMod.vaciarCacheDeContactosInternos();
  const sinCanal = await internosMod.contactosInternos("sin_canal");
  assert.ok(!sinCanal.variantesDeTelefono.includes("573008889999"));
  internosMod.vaciarCacheDeContactosInternos();
  const roto = await internosMod.contactosInternos("roto");
  assert.ok(roto.variantesDeTelefono.includes("573007776666"), "del texto roto igual se leen los numeros");
});

/* ------------------------------------------------------------------------------------------------
   3. /api/cliente/chats/list con grupo explicito
------------------------------------------------------------------------------------------------ */
await prueba("sin grupo (parte 4): la asesora no ve EQUIPO, numeros internos ni PROVEEDOR", async () => {
  const sinGrupo = await pedir("");
  assert.equal(sinGrupo.leyoInternos, true);
  assert.deepEqual(sinGrupo.contactos, menos(DE_LA_ASESORA, [...INTERNOS, ...PROVEEDORES]));
  assert.deepEqual(sinGrupo.contactos, ["k_cliente", "k_vip"]);
  // Lo mismo que grupo=clientes, y con assigned=mine explicito tambien.
  const clientes = await pedir("grupo=clientes");
  assert.deepEqual(JSON.stringify(sinGrupo.where), JSON.stringify(clientes.where));
  assert.deepEqual((await pedir("assigned=mine")).contactos, ["k_cliente", "k_vip"]);
  // Aunque pida assigned=all, el servidor le impone Mias.
  assert.deepEqual((await pedir("assigned=all")).contactos, ["k_cliente", "k_vip"]);
});

await prueba("sin grupo (parte 4): assigned=all del admin no trae EQUIPO y si PROVEEDOR", async () => {
  const jefe = await pedir("assigned=all", { rol: "admin" });
  assert.equal(jefe.leyoInternos, true);
  assert.deepEqual(jefe.contactos, menos(CONTACTOS.map((c) => c.id), INTERNOS));
  assert.ok(jefe.contactos.includes("k_prov") && jefe.contactos.includes("k_prov_otra"));
  for (const interno of INTERNOS) assert.ok(!jefe.contactos.includes(interno), interno);
});

await prueba("si no se pueden leer los internos, la lista sale igual (sin filtrar) y lo anota", async () => {
  caida.internos = true;
  const errores = [];
  const errorOriginal = console.error;
  console.error = (...args) => errores.push(args.join(" "));
  try {
    const r = await pedir("");
    assert.deepEqual(r.contactos, ordenar(DE_LA_ASESORA));
    assert.ok(errores.some((e) => e.includes("[chats/list] no se pudieron leer los contactos internos")), errores.join("\n"));
  } finally {
    caida.internos = false;
    console.error = errorOriginal;
  }
});

await prueba("grupo=todos: lo de antes (todo, sin leer los internos)", async () => {
  const asesora = await pedir("assigned=mine&grupo=todos");
  assert.equal(asesora.leyoInternos, false);
  assert.deepEqual(asesora.contactos, ordenar(DE_LA_ASESORA));
  const jefe = await pedir("assigned=all&grupo=todos", { rol: "admin" });
  assert.equal(jefe.leyoInternos, false);
  assert.deepEqual(jefe.contactos, ordenar(CONTACTOS.map((c) => c.id)));
});

await prueba("clientes de asesora: sin EQUIPO, sin numeros internos y sin PROVEEDOR", async () => {
  const r = await pedir("grupo=clientes");
  assert.equal(r.leyoInternos, true);
  assert.deepEqual(r.contactos, menos(DE_LA_ASESORA, [...INTERNOS, ...PROVEEDORES]));
  assert.deepEqual(r.contactos, ["k_cliente", "k_vip"]);
});

await prueba("clientes con assigned=all de admin: sin EQUIPO, con PROVEEDOR", async () => {
  const r = await pedir("grupo=clientes&assigned=all", { rol: "admin" });
  assert.deepEqual(r.contactos, menos(CONTACTOS.map((c) => c.id), INTERNOS));
  assert.ok(r.contactos.includes("k_prov") && r.contactos.includes("k_prov_otra"));
});

await prueba("equipo y proveedores de asesora con assigned=all: solo lo asignado a ella", async () => {
  const equipo = await pedir("grupo=equipo&assigned=all");
  assert.deepEqual(equipo.contactos, ["k_ambos", "k_aviso", "k_equipo", "k_linea"]);
  const proveedores = await pedir("grupo=proveedores&assigned=all");
  assert.deepEqual(proveedores.contactos, ["k_prov"]);
  // El admin en Todas si ve los de las demas.
  const jefe = await pedir("grupo=proveedores&assigned=all", { rol: "admin" });
  assert.deepEqual(jefe.contactos, ordenar(PROVEEDORES));
});

await prueba("q=<nombre> trae a un interno aunque el grupo sea clientes", async () => {
  const r = await pedir("grupo=clientes&q=Jair");
  assert.equal(r.leyoInternos, false, "con texto no se leen los internos");
  assert.deepEqual(r.contactos, ["k_equipo"]);
  // Sin grupo (la vista por defecto) tambien.
  const sinGrupo = await pedir("q=Jair");
  assert.equal(sinGrupo.leyoInternos, false);
  assert.deepEqual(sinGrupo.contactos, ["k_equipo"]);
});

await prueba("una condicion etiquetas:tiene:<EQUIPO> si trae a los del equipo (listas guardadas)", async () => {
  const equipo = await pedir("grupo=clientes&c=etiquetas:tiene:t_equipo");
  assert.deepEqual(equipo.contactos, ["k_ambos", "k_equipo"]);
  const proveedor = await pedir("grupo=clientes&c=etiquetas:tiene:t_prov");
  // Se desactiva solo la exclusion de proveedores: k_ambos sigue fuera por ser del equipo.
  assert.deepEqual(proveedor.contactos, ["k_prov"]);
  // Sin grupo (la vista por defecto), una lista guardada "con EQUIPO" sigue trayendolos.
  assert.deepEqual((await pedir("c=etiquetas:tiene:t_equipo")).contactos, ["k_ambos", "k_equipo"]);
  assert.deepEqual((await pedir("c=etiquetas:tiene:t_prov")).contactos, ["k_prov"]);
});

/* ------------------------------------------------------------------------------------------------
   4. La linea oficial: el mismo grupo en fragmentosDeFiltrosOficiales (SQL en PGlite)
------------------------------------------------------------------------------------------------ */
async function oficiales(query, contexto) {
  internosMod.vaciarCacheDeContactosInternos();
  const { etapa } = await oficial.fragmentosDeFiltrosOficiales(leer(query), WS, undefined, contexto);
  const { Prisma } = require("@prisma/client");
  const sql = Prisma.sql`SELECT c."id" FROM "OfficialApiConversation" c WHERE true ${etapa} ORDER BY c."id"`;
  const r = await db.query(sql.text, sql.values);
  return { ids: r.rows.map((fila) => fila.id), texto: etapa.text ?? "" };
}

await prueba("oficial: sin grupo aplica clientes; sin el argumento nuevo, el fragmento es el de antes", async () => {
  const hoy = await oficiales("c=etiquetas:tiene:t_vip");
  // Parte 4: sin grupo (con el contexto de la lista) es lo mismo que grupo=clientes.
  const conContexto = await oficiales("c=etiquetas:tiene:t_vip", { asignacion: "mine" });
  const clientes = await oficiales("c=etiquetas:tiene:t_vip&grupo=clientes", { asignacion: "mine" });
  assert.equal(conContexto.texto, clientes.texto);
  assert.notEqual(conContexto.texto, hoy.texto);
  assert.equal((await oficiales("c=etiquetas:tiene:t_vip&grupo=todos", { asignacion: "mine" })).texto, hoy.texto);
  const vacio = await oficiales("grupo=todos", { asignacion: "mine" });
  assert.equal(vacio.texto, "");
  // Sin el argumento nuevo el grupo no se aplica (las llamadas de antes no cambian).
  const sinArgumento = await oficiales("grupo=equipo");
  assert.equal(sinArgumento.ids.length, OFICIALES.length);
});

await prueba("oficial: clientes, equipo y proveedores sobre la ficha y el numero", async () => {
  assert.deepEqual((await oficiales("grupo=clientes", { asignacion: "mine" })).ids, ["o_cliente", "o_suelto"]);
  assert.deepEqual((await oficiales("grupo=clientes", { asignacion: "all" })).ids, ["o_cliente", "o_prov", "o_suelto"]);
  assert.deepEqual((await oficiales("grupo=equipo", { asignacion: "mine" })).ids, ["o_aviso", "o_equipo"]);
  assert.deepEqual((await oficiales("grupo=proveedores", { asignacion: "mine" })).ids, ["o_prov"]);
  // Con texto en el buscador no filtra.
  assert.equal((await oficiales("grupo=equipo", { asignacion: "mine", q: "Jair" })).ids.length, OFICIALES.length);
});

await prueba("oficial: con listas vacias no usa Prisma.join (equipo/proveedores = AND false)", async () => {
  const vacios = {
    equipoIds: [],
    proveedorIds: [],
    variantesDeTelefono: [],
    etiquetasEquipoIds: [],
    etiquetasProveedorIds: [],
  };
  const filtros = leer("");
  for (const grupo of ["equipo", "proveedores"]) {
    const regla = servicio.reglaDelGrupo({ grupo, internos: vacios, asignacion: "mine", filtros });
    assert.deepEqual(regla, { tipo: "solo", de: grupo });
    // En Prisma un `in: []` no trae ninguno (nunca todos).
    assert.deepEqual(servicio.whereDeGrupo({ grupo, internos: vacios, asignacion: "mine", filtros }), {
      contactId: { in: [] },
    });
  }
  assert.deepEqual(servicio.whereDeGrupo({ grupo: "clientes", internos: vacios, asignacion: "mine", filtros }), {});
  // Un negocio sin nada interno, por la SQL real: equipo no trae nada y clientes trae todo.
  const negocioVacio = "ws_vacio";
  internosMod.vaciarCacheDeContactosInternos();
  for (const grupo of ["equipo", "proveedores"]) {
    internosMod.vaciarCacheDeContactosInternos();
    const { etapa } = await oficial.fragmentosDeFiltrosOficiales(leer(`grupo=${grupo}`), negocioVacio, undefined, {
      asignacion: "mine",
    });
    assert.equal(etapa.text.trim(), "AND false", grupo);
  }
  internosMod.vaciarCacheDeContactosInternos();
  const clientes = await oficial.fragmentosDeFiltrosOficiales(leer("grupo=clientes"), negocioVacio, undefined, {
    asignacion: "mine",
  });
  assert.equal(clientes.etapa.text ?? "", "");
});

/* ------------------------------------------------------------------------------------------------
   5. /api/cliente/chats/counts: Equipo y Proveedores, y las pastillas fijas
------------------------------------------------------------------------------------------------ */
function comoRol(rol) {
  if (rol === "asesora") {
    escenario.userRole = "EMPLEADO";
    escenario.memberRole = "AGENT";
    sesion.actual = { user: { id: ASESORA, role: "EMPLEADO" } };
  } else {
    escenario.userRole = "CLIENTE";
    escenario.memberRole = "OWNER";
    sesion.actual = { user: { id: ASESORA, role: "CLIENTE" } };
  }
}

async function contar(query, { rol = "asesora" } = {}) {
  comoRol(rol);
  permisos.vaciarCachesDePermisos();
  internosMod.vaciarCacheDeContactosInternos();
  sqls.length = 0;
  conteos.length = 0;
  const logs = [console.log, console.error, console.warn];
  console.log = console.error = console.warn = () => {};
  try {
    const res = await GET_COUNTS(new Request(`http://x/api/cliente/chats/counts?${query}`));
    const cuerpo = await res.json();
    assert.equal(cuerpo.ok, true, JSON.stringify(cuerpo));
    const delGrupo = conteos.filter((where) => /"contactId":\{"(in|notIn)"/.test(JSON.stringify(where ?? {}))).length;
    return { ...cuerpo, sqls: [...sqls], leyoInternos: sqls.some(esConsultaDeInternos), conteosDeGrupo: delGrupo };
  } finally {
    [console.log, console.error, console.warn] = logs;
  }
}

/** Lo que trae la lista con ese grupo: los chats del canal viejo mas las filas de la linea oficial. */
async function delaLista(grupo, rol) {
  const lista = await pedir(`grupo=${grupo}&assigned=all`, { rol });
  const linea = await oficiales(`grupo=${grupo}`, { asignacion: rol === "asesora" ? "mine" : "all" });
  return lista.contactos.length + linea.ids.length;
}

await prueba("counts: equipo y proveedores coinciden con la lista del mismo grupo (con la linea oficial)", async () => {
  for (const rol of ["asesora", "admin"]) {
    const r = await contar("", { rol });
    assert.equal(r.leyoInternos, true, rol);
    assert.equal(r.counts.equipo, await delaLista("equipo", rol), `equipo de ${rol}`);
    assert.equal(r.counts.proveedores, await delaLista("proveedores", rol), `proveedores de ${rol}`);
  }
  // Los numeros a mano: canal viejo + linea oficial.
  const asesora = await contar("");
  assert.equal(asesora.counts.equipo, 4 + 2);
  assert.equal(asesora.counts.proveedores, 1 + 1);
  const jefe = await contar("", { rol: "admin" });
  assert.equal(jefe.counts.equipo, INTERNOS.length + 2);
  assert.equal(jefe.counts.proveedores, PROVEEDORES.length + 1);
});

await prueba("counts (parte 4): mine, unassigned y all ya no cuentan internos", async () => {
  // Las filas de la linea oficial que entran como clientes (ver "oficial: clientes, ...").
  const oficialesClientes = async (asignacion) => (await oficiales("grupo=clientes", { asignacion })).ids.length;
  const asesora = await contar("");
  assert.equal(asesora.counts.mine, (await pedir("")).contactos.length + (await oficialesClientes("mine")));
  assert.equal(asesora.counts.mine, 2 + 2);
  const jefe = await contar("assigned=all", { rol: "admin" });
  const jefeTodas = await pedir("assigned=all", { rol: "admin" });
  // Todas del jefe: lo mismo que su lista sin grupo (sin EQUIPO, con PROVEEDOR) mas la linea oficial.
  assert.equal(jefe.counts.all, jefeTodas.contactos.length + (await oficialesClientes("all")));
  assert.equal(jefe.counts.all, CONTACTOS.length - INTERNOS.length + 3);
  // Sin asignar: solo k_cliente_sin (ningun interno sin asignar en los datos, pero el WHERE lo saca igual).
  const sinAsignar = await pedir("assigned=unassigned", { rol: "admin" });
  assert.deepEqual(sinAsignar.contactos, ["k_cliente_sin"]);
  assert.ok(jefe.counts.unassigned >= 1);
  // Mias del jefe: sin EQUIPO ni PROVEEDOR (en Mias se sacan los dos).
  const jefeMias = await pedir("assigned=mine", { rol: "admin" });
  assert.deepEqual(jefeMias.contactos, ["k_cliente", "k_vip"]);
  assert.equal(jefe.counts.mine, jefeMias.contactos.length + (await oficialesClientes("mine")));
  // Los conteos del canal viejo de las pastillas fijas llevan el notIn de los internos.
  assert.ok(jefe.conteosDeGrupo > 0, "Todas / Mias / Sin asignar no sacan a los internos");
});

await prueba("counts: la asesora solo cuenta lo asignado, aunque pida assigned=all", async () => {
  const r = await contar("assigned=all&grupo=equipo");
  assert.equal(r.counts.unassigned, 0);
  // k_equipo_otra y k_prov_otra son de otra asesora: no entran.
  assert.equal(r.counts.equipo, ["k_ambos", "k_aviso", "k_equipo", "k_linea"].length + 2);
  assert.equal(r.counts.proveedores, ["k_prov"].length + 1);
});

await prueba("counts: el grupo de la direccion no cambia Todas / Mias / Sin asignar", async () => {
  for (const rol of ["asesora", "admin"]) {
    const sinGrupo = await contar("assigned=all", { rol });
    for (const grupo of ["clientes", "equipo", "proveedores", "todos"]) {
      const conGrupo = await contar(`assigned=all&grupo=${grupo}`, { rol });
      for (const clave of ["mine", "unassigned", "all", "equipo", "proveedores"]) {
        assert.equal(conGrupo.counts[clave], sinGrupo.counts[clave], `${rol} ${grupo} ${clave}`);
      }
    }
  }
});

await prueba("counts: con texto en el buscador equipo y proveedores valen 0 sin consultar", async () => {
  const r = await contar("q=Jair&grupo=equipo", { rol: "admin" });
  assert.equal(r.counts.equipo, 0);
  assert.equal(r.counts.proveedores, 0);
  assert.equal(r.leyoInternos, false, "con texto no se leen los internos");
  // Los unicos conteos oficiales por SQL son los de las pastillas Sin responder / No leido (de antes).
  assert.equal(
    r.sqls.some((texto) => esConteoOficial(texto) && !texto.includes('"OfficialApiMessage"')),
    false,
    "con texto no hay conteo oficial de Equipo ni Proveedores",
  );
  // Ningun conteo del canal viejo pregunta por los contactos del equipo o los proveedores.
  assert.equal(r.conteosDeGrupo, 0);
});

await prueba("counts: un negocio sin nadie interno no hace conteos de mas", async () => {
  const vacios = { equipoIds: [], proveedorIds: [], variantesDeTelefono: [], etiquetasEquipoIds: [], etiquetasProveedorIds: [] };
  assert.equal(servicio.grupoQueAplica({ condiciones: [], grupo: dominio.GRUPO_POR_DEFECTO }, ""), "clientes");
  // Con todo vacio, el grupo por defecto no agrega nada al WHERE de las pastillas.
  assert.deepEqual(
    servicio.whereDeGrupo({ grupo: dominio.GRUPO_POR_DEFECTO, internos: vacios, asignacion: "mine", filtros: leer("") }),
    {},
  );
  const fuente = fs.readFileSync(path.join(raiz, "app/api/cliente/chats/counts/route.ts"), "utf8");
  assert.match(fuente, /if \(!ids\.length && !telefonos\.length\) return 0;/);
});

/* ------------------------------------------------------------------------------------------------
   6. La pantalla y las pantallas que deben verlo todo
------------------------------------------------------------------------------------------------ */
await prueba("page.tsx aplica whereDeGrupo y lee los internos solo si el grupo no es todos", async () => {
  const fuente = fs.readFileSync(path.join(raiz, "app/cliente/chats/page.tsx"), "utf8");
  assert.match(fuente, /whereDeGrupo\(\{ grupo, internos, asignacion: assignedFilter, filtros \}\)/);
  assert.match(fuente, /const grupo = grupoQueAplica\(filtrosDeLaLista, searchQuery\);/);
  assert.match(fuente, /grupo === "todos" \? null : contactosInternosSiSePuede\(membership\.workspace\.id, "chats\/page"\)/);
  assert.match(fuente, /filtros: filtrosDeLaLista,/, "getOfficialApiChatsData recibe los filtros (con el grupo)");
});

await prueba("el link /c/<n> no pasa por el filtro del grupo (abre el chat por su id)", async () => {
  const corto = fs.readFileSync(path.join(raiz, "app/c/[numero]/page.tsx"), "utf8");
  assert.doesNotMatch(corto, /grupo|whereDeGrupo|contactosInternos/);
  assert.match(corto, /redirect\(`\/cliente\/chats\?chatKey=\$\{encodeURIComponent\(`agent:\$\{delCanalViejo\.id\}`\)\}&assigned=all`\)/);
  // La pantalla carga el chat pedido por su id, sin el WHERE de la lista (que si lleva el grupo).
  const pantalla = fs.readFileSync(path.join(raiz, "app/cliente/chats/page.tsx"), "utf8");
  assert.match(pantalla, /where: \{ id: selectedChatRef\.conversationId, workspaceId: membership\.workspace\.id \}/);
  const oficialFuente = fs.readFileSync(path.join(raiz, "features/official-api/services/getOfficialApiChatsData.ts"), "utf8");
  assert.match(oficialFuente, /fetchConversationDetail\(requestedConversationId\)/);
});

await prueba("la bandeja: pastillas Equipo y Proveedores, y los links de fila llevan el grupo", async () => {
  const barra = fs.readFileSync(path.join(raiz, "components/chats/appsidebar.tsx"), "utf8");
  assert.match(barra, /equipo\?: number; proveedores\?: number/);
  assert.match(barra, /aplicarFiltros\("all", statusFilter, \{ \.\.\.filtros, grupo \}\)/);
  const bandeja = fs.readFileSync(path.join(raiz, "components/chats/shared-inbox.tsx"), "utf8");
  assert.doesNotMatch(bandeja, /statusFilter, \[\], esperaDelServidor\)/, "los links de fila del servidor pierden el grupo");
  assert.match(bandeja, /equipo\?: number; proveedores\?: number/);
});

await prueba("Reenviar, la campanita y Notificaciones piden grupo=todos", async () => {
  const leerFuente = (archivo) => fs.readFileSync(path.join(raiz, archivo), "utf8");
  assert.match(
    leerFuente("components/chats/forward-message-dialog.tsx"),
    /new URLSearchParams\(\{[^}]*grupo: "todos"[^}]*\}\)/,
  );
  for (const archivo of ["components/ui/chat-notification-bell.tsx", "components/notificaciones/notificaciones-workspace.tsx"]) {
    assert.match(leerFuente(archivo), /\/api\/cliente\/chats\/list\?[^"]*grupo=todos/, archivo);
  }
});

console.log(`\n${pruebas} pruebas ok`);
process.exit(0);
