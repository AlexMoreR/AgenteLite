// Pruebas de "sacar los avisos internos de la bandeja" (parte 2: la regla de grupos y /list).
//
// - contactosInternos (src/features/chats/services/contactos-internos.ts): su consulta corre en un
//   Postgres embebido (PGlite) con etiquetas, lineas y contactos armados a mano.
// - GET /api/cliente/chats/list con el Prisma REAL sobre un pool de pg falso (el cargador de
//   scripts/check-velocidad-bandeja.mjs). La consulta de la lista se reescribe para devolver solo
//   los ids y su WHERE corre en PGlite: asi se ve que chats trae de verdad cada pedido.
// - La API oficial: el fragmento de fragmentosDeFiltrosOficiales corre en PGlite.
// No toca ninguna base real.
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
   1. La base de prueba (PGlite). El negocio es "x1" y la asesora que mira tambien es "x1": son los
   ids que contesta el pool falso para la sesion, la membresia y el negocio.
------------------------------------------------------------------------------------------------ */
const WS = "x1";
const YO = "x1";
const OTRA = "u2";
const db = new PGlite();
await db.exec(`
  CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'PENDING', 'CLOSED', 'ARCHIVED');
  CREATE TABLE "Contact" (
    "id" text PRIMARY KEY, "workspaceId" text NOT NULL, "name" text, "phoneNumber" text NOT NULL,
    "bloqueadoEn" timestamp(3)
  );
  CREATE TABLE "Tag" ("id" text PRIMARY KEY, "workspaceId" text NOT NULL, "name" text NOT NULL, "slug" text NOT NULL);
  CREATE TABLE "ContactTag" ("contactId" text NOT NULL, "tagId" text NOT NULL, "workspaceId" text NOT NULL);
  CREATE TABLE "WhatsAppChannel" ("id" text PRIMARY KEY, "workspaceId" text NOT NULL, "phoneNumber" text);
  CREATE TABLE "Conversation" (
    "id" text PRIMARY KEY, "workspaceId" text NOT NULL, "contactId" text NOT NULL, "channelId" text,
    "assignedToUserId" text, "segundoAsesorId" text, "status" "ConversationStatus" NOT NULL,
    "lastMessageAt" timestamp(3), "updatedAt" timestamp(3) NOT NULL DEFAULT now(), "createdAt" timestamp(3) NOT NULL DEFAULT now()
  );
  CREATE TABLE "OfficialApiContact" (
    "id" text PRIMARY KEY, "crmContactId" text, "phoneNumber" text, "waId" text NOT NULL
  );
  CREATE TABLE "OfficialApiConversation" ("id" text PRIMARY KEY, "contactId" text NOT NULL);

  INSERT INTO "Tag" VALUES
    ('t_eq', '${WS}', 'Equipo', 'equipo'),
    ('t_prov', '${WS}', 'Proveedores', 'proveedores'),
    ('t_prov1', '${WS}', 'PROVEEDOR', 'proveedor'),
    ('t_eqv', '${WS}', 'Equipo de ventas', 'equipo-de-ventas'),
    ('t_otro_ws', 'w9', 'Equipo', 'equipo');
  -- La linea del negocio, escrita como la escribe la gente.
  INSERT INTO "WhatsAppChannel" VALUES ('ch1', '${WS}', '+57 300 555 0000'), ('ch9', 'w9', '573004440000');
  INSERT INTO "Contact" VALUES
    ('k_cli1', '${WS}', 'Clienta Uno', '573001110001', NULL),
    ('k_cli2', '${WS}', 'Clienta Dos', '573001110002', NULL),
    ('k_eq_tag', '${WS}', 'Supervisor', '573001110003', NULL),
    ('k_eq_tag2', '${WS}', 'Necesita atencion', '573001110004', NULL),
    ('k_eq_num', '${WS}', 'Avisos Ingrid', '3009990001', NULL),
    ('k_linea', '${WS}', 'Ventas 1', '573005550000', NULL),
    ('k_prov', '${WS}', 'Proveedor Telas', '573001110005', NULL),
    ('k_prov2', '${WS}', 'Proveedor Hilos', '573001110006', NULL),
    ('k_ambos', '${WS}', 'Jair', '573001110007', NULL),
    ('k_ventas', '${WS}', 'Clienta Tres', '573001110008', NULL),
    ('k_otro_ws', 'w9', 'De otro negocio', '573004440000', NULL);
  INSERT INTO "ContactTag" VALUES
    ('k_eq_tag', 't_eq', '${WS}'), ('k_eq_tag2', 't_eq', '${WS}'),
    ('k_prov', 't_prov', '${WS}'), ('k_prov2', 't_prov1', '${WS}'),
    ('k_ambos', 't_eq', '${WS}'), ('k_ambos', 't_prov1', '${WS}'),
    ('k_ventas', 't_eqv', '${WS}');
  INSERT INTO "Conversation" ("id", "workspaceId", "contactId", "assignedToUserId", "status", "lastMessageAt") VALUES
    ('cv_cli1', '${WS}', 'k_cli1', '${YO}', 'OPEN', now()),
    ('cv_cli2', '${WS}', 'k_cli2', '${OTRA}', 'OPEN', now()),
    ('cv_eq_tag', '${WS}', 'k_eq_tag', '${YO}', 'OPEN', now()),
    ('cv_eq_tag2', '${WS}', 'k_eq_tag2', '${OTRA}', 'OPEN', now()),
    ('cv_eq_num', '${WS}', 'k_eq_num', '${YO}', 'OPEN', now()),
    ('cv_linea', '${WS}', 'k_linea', '${YO}', 'OPEN', now()),
    ('cv_prov', '${WS}', 'k_prov', '${YO}', 'OPEN', now()),
    ('cv_prov2', '${WS}', 'k_prov2', '${OTRA}', 'OPEN', now()),
    ('cv_ambos', '${WS}', 'k_ambos', '${YO}', 'OPEN', now()),
    ('cv_ventas', '${WS}', 'k_ventas', '${YO}', 'OPEN', now());
  -- La linea que ve la asesora: el pool falso contesta "x1" como su unico canal visible.
  UPDATE "Conversation" SET "channelId" = 'x1';
  -- La API oficial: una ficha ligada al CRM, una solo por telefono (con y sin 57) y una clienta.
  INSERT INTO "OfficialApiContact" VALUES
    ('o_eq', 'k_eq_tag', NULL, '573001110003'),
    ('o_num', NULL, '3009990001', '3009990001'),
    ('o_waid', NULL, NULL, '573005550000'),
    ('o_prov', 'k_prov', NULL, '573001110005'),
    ('o_cli', 'k_cli1', NULL, '573001110001'),
    ('o_suelta', NULL, NULL, '573001119999');
  INSERT INTO "OfficialApiConversation" VALUES
    ('oc_eq', 'o_eq'), ('oc_num', 'o_num'), ('oc_waid', 'o_waid'), ('oc_prov', 'o_prov'),
    ('oc_cli', 'o_cli'), ('oc_suelta', 'o_suelta');
`);

// Los avisos del agente (Mi empresa → Equipo): el numero de Ingrid, con el 57.
const AVISOS = JSON.stringify({
  canalId: "ch1",
  activo: true,
  destinos: [{ numero: "573009990001", nombre: "Ingrid", soloDe: YO, userId: YO }],
});

/* ------------------------------------------------------------------------------------------------
   2. Pool de pg falso (el de check-velocidad-bandeja) que ademas:
   - contesta la configuracion de avisos;
   - corre en PGlite la consulta de contactosInternos;
   - corre en PGlite el WHERE de la lista de conversaciones y anota los ids que trae.
------------------------------------------------------------------------------------------------ */
const pg = require("pg");
const escenario = { userRole: "CLIENTE", memberRole: "OWNER" };
const sqls = [];
const listas = [];

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

/** El WHERE de la consulta de la lista, corrido en PGlite: los ids que traeria. */
async function idsDeLaLista(text, values) {
  const desde = text.indexOf(' FROM "public"."Conversation"');
  const hasta = text.lastIndexOf(" ORDER BY ");
  const cuerpo = text.slice(desde, hasta);
  const usados = Math.max(0, ...[...cuerpo.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
  const res = await db.query(`SELECT "public"."Conversation"."id"${cuerpo}`, values.slice(0, usados));
  return res.rows.map((fila) => fila.id).sort();
}

class PoolFalso extends pg.Pool {
  async query(q) {
    const text = typeof q === "string" ? q : q.text;
    const values = typeof q === "string" ? [] : (q.values ?? []);
    sqls.push(text);
    if (/WITH numeros AS/.test(text)) {
      const res = await db.query(text, values, { rowMode: "array" });
      return { fields: res.fields, rows: res.rows, rowCount: res.rows.length };
    }
    if (/FROM "public"\."AppSetting"/.test(text) && String(values[0] ?? "").startsWith("agente-v3:avisos:")) {
      // Solo el negocio de la prueba tiene avisos; otro negocio no tiene nada guardado.
      if (values[0] !== `agente-v3:avisos:${WS}`) return { fields: [], rows: [], rowCount: 0 };
      const info = columnas(text);
      return {
        fields: info.cols.map((c) => ({ name: c, dataTypeID: valor("AppSetting", c)[0] })),
        rows: [info.cols.map((c) => (c === "value" ? AVISOS : c === "key" ? values[0] : valor("AppSetting", c)[1]))],
        rowCount: 1,
      };
    }
    if (text.startsWith('SELECT "public"."Conversation"."id", "public"."Conversation"."lastMessageAt"')) {
        listas.push(await idsDeLaLista(text, values));
    }
    const info = columnas(text);
    if (!info) return { fields: [], rows: [], rowCount: 1 };
    return {
      fields: info.cols.map((c) => ({ name: c, dataTypeID: valor(info.tabla, c)[0] })),
      rows: [info.cols.map((c) => valor(info.tabla, c)[1])],
      rowCount: 1,
    };
  }
  async connect() {
    return { query: (q) => this.query(q), release() {}, on() {}, removeListener() {} };
  }
}

/* ------------------------------------------------------------------------------------------------
   Cargador de los .ts de src (con el alias @/), igual que check-velocidad-bandeja.
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

const sesion = { actual: { user: { id: YO, role: "CLIENTE" } } };
const cargar = cargadorDeSrc(sesion);
const dominio = cargar("@/features/chats/domain/filtros-de-bandeja");
const internosMod = cargar("@/features/chats/services/contactos-internos");
const permisos = cargar("@/lib/cache-de-permisos");
const { GET } = cargar("@/app/api/cliente/chats/list/route");
const { fragmentosDeFiltrosOficiales } = cargar("@/features/official-api/services/getOfficialApiChatsData");

/* ------------------------------------------------------------------------------------------------
   3. La direccion: `grupo` viaja aparte y no cuenta como filtro puesto
------------------------------------------------------------------------------------------------ */
const leer = (query) => {
  const p = new URLSearchParams(query);
  return dominio.leerFiltrosDeBandeja((clave) => p.get(clave));
};

await prueba("direccion: grupo se lee, se emite y un valor raro se ignora", async () => {
  assert.equal(dominio.GRUPO_POR_DEFECTO, "todos");
  assert.deepEqual(leer("grupo=clientes"), { condiciones: [], grupo: "clientes" });
  assert.deepEqual(leer("grupo=hackeo'--"), { condiciones: [] });
  // Sin grupo el objeto queda igual que antes (sin la clave).
  assert.deepEqual(leer("c=sin_responder:si"), { condiciones: [{ campo: "sin_responder", operador: "si" }] });
  assert.deepEqual(dominio.paramsDeFiltros(leer("grupo=equipo&c=no_leido:si")), [
    ["c", "no_leido:si"],
    ["grupo", "equipo"],
  ]);
  assert.deepEqual(dominio.paramsDeFiltros(leer("c=no_leido:si")), [["c", "no_leido:si"]]);
  assert.equal(dominio.hayFiltrosPuestos(leer("grupo=clientes")), false);
});

/* ------------------------------------------------------------------------------------------------
   4. contactosInternos
------------------------------------------------------------------------------------------------ */
await prueba("internos: etiquetas EQUIPO/PROVEEDOR(ES), numeros de avisos y de la linea, con y sin 57", async () => {
  internosMod.vaciarCacheDeContactosInternos();
  sqls.length = 0;
  const internos = await internosMod.contactosInternos(WS);
  assert.deepEqual(internos.etiquetasEquipoIds, ["t_eq"]);
  assert.deepEqual(internos.etiquetasProveedorIds, ["t_prov", "t_prov1"]);
  // "Equipo de ventas" no es EQUIPO; el contacto de otro negocio no entra.
  assert.deepEqual(internos.equipoIds, ["k_ambos", "k_eq_num", "k_eq_tag", "k_eq_tag2", "k_linea"]);
  // k_ambos tiene las dos: queda solo en el equipo.
  assert.deepEqual(internos.proveedorIds, ["k_prov", "k_prov2"]);
  for (const v of ["573009990001", "3009990001", "573005550000", "3005550000"]) {
    assert.ok(internos.variantesDeTelefono.includes(v), `falta la variante ${v}`);
  }
  assert.ok(!internos.variantesDeTelefono.includes("573004440000"), "la linea de otro negocio no cuenta");
  // En frio: la configuracion de avisos y UNA consulta para etiquetas, telefonos y contactos.
  assert.equal(sqls.length, 2, sqls.join("\n---\n"));
  sqls.length = 0;
  await internosMod.contactosInternos(WS);
  assert.equal(sqls.length, 0, "en caliente sale de la memoria");
});

/* ------------------------------------------------------------------------------------------------
   5. GET /api/cliente/chats/list
------------------------------------------------------------------------------------------------ */
const logOriginal = console.log;
async function pedir(query) {
  sqls.length = 0;
  listas.length = 0;
  console.log = () => {};
  try {
    const res = await GET(new Request(`http://x/api/cliente/chats/list?limit=20&${query}`));
    const cuerpo = await res.json();
    assert.equal(cuerpo.ok, true, JSON.stringify(cuerpo));
    assert.equal(listas.length, 1, `se esperaba una consulta de la lista: ${listas.length}`);
    return { ids: listas[0], sqls: [...sqls], cuerpo };
  } finally {
    console.log = logOriginal;
  }
}
function comoAsesora() {
  escenario.userRole = "EMPLEADO";
  escenario.memberRole = "AGENT";
  sesion.actual = { user: { id: YO, role: "EMPLEADO" } };
  permisos.vaciarCachesDePermisos();
}
function comoAdmin() {
  escenario.userRole = "CLIENTE";
  escenario.memberRole = "OWNER";
  sesion.actual = { user: { id: YO, role: "CLIENTE" } };
  permisos.vaciarCachesDePermisos();
}
const MIOS = ["cv_ambos", "cv_cli1", "cv_eq_num", "cv_eq_tag", "cv_linea", "cv_prov", "cv_ventas"];
const TODOS = [...MIOS, "cv_cli2", "cv_eq_tag2", "cv_prov2"].sort();

await prueba("sin grupo: igual que hoy (ni se leen los internos) y igual a grupo=todos", async () => {
  comoAdmin();
  internosMod.vaciarCacheDeContactosInternos();
  const sinGrupo = await pedir("assigned=all");
  assert.deepEqual(sinGrupo.ids, TODOS);
  assert.ok(!sinGrupo.sqls.some((s) => /WITH numeros AS/.test(s)), "sin grupo no se leen los internos");
  assert.ok(!sinGrupo.sqls.some((s) => s.includes("agente-v3:avisos")));
  const conTodos = await pedir("assigned=all&grupo=todos");
  assert.deepEqual(conTodos.ids, TODOS);
  assert.ok(!conTodos.sqls.some((s) => /WITH numeros AS/.test(s)));
  const lista = (r) => r.sqls.find((s) => s.startsWith('SELECT "public"."Conversation"."id", "public"."Conversation"."lastMessageAt"'));
  assert.equal(lista(sinGrupo), lista(conTodos), "la consulta de la lista es la misma");
  comoAsesora();
  assert.deepEqual((await pedir("assigned=mine")).ids, MIOS);
});

await prueba("clientes de asesora: sin EQUIPO, sin numeros internos y sin PROVEEDOR", async () => {
  comoAsesora();
  const { ids } = await pedir("assigned=mine&grupo=clientes");
  assert.deepEqual(ids, ["cv_cli1", "cv_ventas"]);
  // Aunque pida "Todas", a la asesora se le impone "Mias".
  assert.deepEqual((await pedir("assigned=all&grupo=clientes")).ids, ["cv_cli1", "cv_ventas"]);
});

await prueba("clientes con assigned=all de admin: sin EQUIPO y con PROVEEDOR", async () => {
  comoAdmin();
  const { ids } = await pedir("assigned=all&grupo=clientes");
  assert.deepEqual(ids, ["cv_cli1", "cv_cli2", "cv_prov", "cv_prov2", "cv_ventas"]);
  // En "Mias" el admin tampoco ve proveedores.
  assert.deepEqual((await pedir("assigned=mine&grupo=clientes")).ids, ["cv_cli1", "cv_ventas"]);
});

await prueba("equipo y proveedores de asesora con assigned=all: solo lo asignado a ella", async () => {
  comoAsesora();
  assert.deepEqual((await pedir("assigned=all&grupo=equipo")).ids, ["cv_ambos", "cv_eq_num", "cv_eq_tag", "cv_linea"]);
  assert.deepEqual((await pedir("assigned=all&grupo=proveedores")).ids, ["cv_prov"]);
  comoAdmin();
  assert.deepEqual(
    (await pedir("assigned=all&grupo=equipo")).ids,
    ["cv_ambos", "cv_eq_num", "cv_eq_tag", "cv_eq_tag2", "cv_linea"],
  );
  assert.deepEqual((await pedir("assigned=all&grupo=proveedores")).ids, ["cv_prov", "cv_prov2"]);
});

await prueba("con texto en el buscador el grupo no filtra: q=<nombre> trae al interno", async () => {
  comoAsesora();
  const { ids, sqls: hechas } = await pedir(`assigned=mine&grupo=clientes&q=${encodeURIComponent("Supervisor")}`);
  assert.deepEqual(ids, ["cv_eq_tag"]);
  assert.ok(!hechas.some((s) => /WITH numeros AS/.test(s)), "con busqueda no se leen los internos");
});

await prueba("listas guardadas: etiquetas:tiene:<EQUIPO> trae al equipo dentro de clientes", async () => {
  comoAsesora();
  const conEquipo = await pedir(`assigned=mine&grupo=clientes&c=${encodeURIComponent("etiquetas:tiene:t_eq")}`);
  assert.deepEqual(conEquipo.ids, ["cv_ambos", "cv_eq_tag"]);
  const conProveedor = await pedir(`assigned=mine&grupo=clientes&c=${encodeURIComponent("etiquetas:tiene:t_prov")}`);
  assert.deepEqual(conProveedor.ids, ["cv_prov"]);
});

/* ------------------------------------------------------------------------------------------------
   6. La API oficial (fragmentosDeFiltrosOficiales en PGlite)
------------------------------------------------------------------------------------------------ */
async function idsOficiales(filtros, grupo, negocio = WS) {
  const { etapa } = await fragmentosDeFiltrosOficiales(filtros, negocio, new Date(), grupo);
  const res = await db.query(`SELECT c."id" FROM "OfficialApiConversation" c WHERE true ${etapa.text}`, etapa.values);
  return res.rows.map((fila) => fila.id).sort();
}
const TODAS_OFICIALES = ["oc_cli", "oc_eq", "oc_num", "oc_prov", "oc_suelta", "oc_waid"];

await prueba("oficial: misma regla sobre la ficha (crmContactId, phoneNumber y waId)", async () => {
  // Sin el argumento nuevo (el contador, por ahora) o sin grupo, nada cambia.
  assert.deepEqual(await idsOficiales(leer("grupo=clientes"), undefined), TODAS_OFICIALES);
  assert.deepEqual(await idsOficiales(leer(""), { asignacion: "mine", q: "" }), TODAS_OFICIALES);
  assert.deepEqual(await idsOficiales(leer("grupo=clientes"), { asignacion: "mine", q: "" }), ["oc_cli", "oc_suelta"]);
  assert.deepEqual(
    await idsOficiales(leer("grupo=clientes"), { asignacion: "all", q: "" }),
    ["oc_cli", "oc_prov", "oc_suelta"],
  );
  assert.deepEqual(await idsOficiales(leer("grupo=equipo"), { asignacion: "all", q: "" }), ["oc_eq", "oc_num", "oc_waid"]);
  assert.deepEqual(await idsOficiales(leer("grupo=proveedores"), { asignacion: "all", q: "" }), ["oc_prov"]);
  assert.deepEqual(await idsOficiales(leer("grupo=equipo"), { asignacion: "all", q: "Supervisor" }), TODAS_OFICIALES);
  // La lista guardada "con EQUIPO": el grupo clientes no la deja vacia.
  assert.deepEqual(
    await idsOficiales(leer(`grupo=clientes&c=${encodeURIComponent("etiquetas:tiene:t_eq")}`), { asignacion: "all", q: "" }),
    ["oc_eq"],
  );
});

await prueba("oficial: con listas vacias no se arma IN () (equipo/proveedores = AND false, clientes = nada)", async () => {
  const { armarContactosInternos } = internosMod;
  const vacio = armarContactosInternos([]);
  assert.deepEqual(vacio, {
    equipoIds: [],
    proveedorIds: [],
    variantesDeTelefono: [],
    etiquetasEquipoIds: [],
    etiquetasProveedorIds: [],
  });
  // Un negocio sin etiquetas, sin lineas y sin avisos: el SQL corre igual.
  const nada = { asignacion: "mine", q: "" };
  assert.deepEqual(await idsOficiales(leer("grupo=equipo"), nada, "w_vacio"), []);
  assert.deepEqual(await idsOficiales(leer("grupo=proveedores"), nada, "w_vacio"), []);
  assert.deepEqual(await idsOficiales(leer("grupo=clientes"), nada, "w_vacio"), TODAS_OFICIALES);
  const { reglaDeGrupo, whereDeGrupo } = cargar("@/features/chats/services/filtros-de-bandeja");
  assert.deepEqual(reglaDeGrupo({ grupo: "todos", internos: vacio, asignacion: "mine", filtros: leer("") }), { modo: "ninguna" });
  assert.deepEqual(whereDeGrupo({ grupo: "equipo", internos: vacio, asignacion: "all", filtros: leer("") }), {
    contactId: { in: [] },
  });
  assert.deepEqual(whereDeGrupo({ grupo: "clientes", internos: vacio, asignacion: "mine", filtros: leer("") }), {});
  assert.deepEqual(whereDeGrupo({ grupo: "todos", internos: null, asignacion: "mine", filtros: leer("") }), {});
});

console.log(`\n${pruebas} pruebas ok`);
process.exit(0);
