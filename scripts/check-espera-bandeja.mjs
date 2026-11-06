// Pruebas de "Esperando respuesta" (parte 1: el calculo y el campo `espera` de /counts).
//
// - El SQL de src/features/chats/services/espera-de-chats.ts corre en un Postgres embebido
//   (PGlite) con chats armados a mano: cuales entran, cuales no y desde cuando cuenta el reloj.
// - El recorte por persona (asesora, monitora, jefe, linea elegida) es una funcion pura.
// - GET /api/cliente/chats/counts con el Prisma REAL sobre un pool de pg falso (el cargador de
//   scripts/check-velocidad-bandeja.mjs): las consultas de la espera se desvian a PGlite y el resto
//   contesta filas inventadas. No toca ninguna base real.
// Correr: npm run test:espera-bandeja   (requiere `prisma generate` hecho)
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
   1. La base de prueba (PGlite) con los chats armados a mano
------------------------------------------------------------------------------------------------ */
const db = new PGlite();
await db.exec(`
  CREATE TABLE "Contact" (
    "id" text PRIMARY KEY, "workspaceId" text NOT NULL, "excludedFromCrm" boolean NOT NULL DEFAULT false,
    "bloqueadoEn" timestamp(3), "metadata" jsonb
  );
  CREATE TABLE "Tag" ("id" text PRIMARY KEY, "workspaceId" text NOT NULL, "name" text NOT NULL, "slug" text NOT NULL);
  CREATE TABLE "ContactTag" ("contactId" text NOT NULL, "tagId" text NOT NULL, "workspaceId" text NOT NULL);
  CREATE TABLE "Conversation" (
    "id" text PRIMARY KEY, "workspaceId" text NOT NULL, "channelId" text, "contactId" text NOT NULL,
    "assignedToUserId" text, "segundoAsesorId" text, "status" text NOT NULL, "lastMessageAt" timestamp(3)
  );
  CREATE INDEX ON "Conversation"("workspaceId", "lastMessageAt");
  CREATE TABLE "Message" (
    "id" text PRIMARY KEY, "workspaceId" text NOT NULL, "conversationId" text NOT NULL,
    "direction" text NOT NULL, "type" text NOT NULL, "status" text NOT NULL, "content" text,
    "deletedAt" timestamp(3), "failedAt" timestamp(3), "rawPayload" jsonb,
    "isStatusBroadcast" boolean NOT NULL DEFAULT false, "createdAt" timestamp(3) NOT NULL
  );
  CREATE TABLE "OfficialApiClientConfig" ("id" text PRIMARY KEY, "workspaceId" text NOT NULL UNIQUE);
  CREATE TABLE "OfficialApiContact" ("id" text PRIMARY KEY, "configId" text NOT NULL, "crmContactId" text);
  CREATE TABLE "OfficialApiConversation" (
    "id" text PRIMARY KEY, "configId" text NOT NULL, "contactId" text NOT NULL, "assignedToUserId" text,
    "status" text NOT NULL, "lastMessageAt" timestamp(3)
  );
  CREATE TABLE "OfficialApiMessage" (
    "id" text PRIMARY KEY, "configId" text NOT NULL, "conversationId" text NOT NULL,
    "direction" text NOT NULL, "type" text NOT NULL, "status" text NOT NULL, "content" text,
    "failedAt" timestamp(3), "rawPayload" jsonb, "createdAt" timestamp(3) NOT NULL
  );
`);

const WS = "ws_magilus";
const AHORA = new Date("2026-11-06T12:00:00.000Z");
const haceHoras = (h) => new Date(AHORA.getTime() - h * 3_600_000);
const iso = (d) => d.toISOString();
let n = 0;

async function contacto(id, extra = {}) {
  await db.query(`INSERT INTO "Contact" VALUES ($1,$2,$3,$4,$5)`, [
    id,
    extra.workspaceId ?? WS,
    extra.excludedFromCrm ?? false,
    extra.bloqueadoEn ?? null,
    extra.metadata ? JSON.stringify(extra.metadata) : null,
  ]);
}
async function etiqueta(contactId, name, slug) {
  const id = `tag_${++n}`;
  await db.query(`INSERT INTO "Tag" VALUES ($1,$2,$3,$4)`, [id, WS, name, slug]);
  await db.query(`INSERT INTO "ContactTag" VALUES ($1,$2,$3)`, [contactId, id, WS]);
}

/**
 * Un chat del canal viejo. `mensajes`: [direccion, horasAtras, {tipo, source, status, failed,
 * contenido, estado, borrado}].
 */
async function chat(id, mensajes, extra = {}) {
  const contactId = extra.contactId ?? `ct_${id}`;
  if (!extra.contactId) await contacto(contactId, extra.contacto ?? {});
  const ultimo = mensajes.length ? Math.min(...mensajes.map((m) => m[1])) : 200;
  await db.query(`INSERT INTO "Conversation" VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [
    id,
    extra.workspaceId ?? WS,
    extra.channelId ?? "canal_1",
    contactId,
    extra.asesora ?? null,
    extra.segunda ?? null,
    extra.estado ?? "OPEN",
    iso(haceHoras(ultimo)),
  ]);
  for (const [direccion, horas, o = {}] of mensajes) {
    await db.query(`INSERT INTO "Message" VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [
      `m_${++n}`,
      extra.workspaceId ?? WS,
      id,
      direccion,
      o.tipo ?? "TEXT",
      o.status ?? (direccion === "IN" ? "RECEIVED" : "SENT"),
      o.contenido ?? "hola",
      o.borrado ? iso(AHORA) : null,
      o.failed ? iso(haceHoras(horas)) : null,
      o.source === undefined ? null : JSON.stringify({ source: o.source }),
      o.estadoWhatsapp ?? false,
      iso(haceHoras(horas)),
    ]);
  }
}
// Las direcciones van cortas en los casos; en la base, como en Prisma.
const IN = "INBOUND";
const OUT = "OUTBOUND";

/* --- Dentro --- */
await chat("sin_respuesta", [[IN, 2]]);
await chat("solo_bot", [[IN, 3], [OUT, 2.9, { source: null }], [OUT, 2.8, { source: "api" }]]);
await chat("solo_seguimiento", [[IN, 5], [OUT, 4, { source: "follow" }], [OUT, 3, { source: "agente-v3-seguimiento" }]]);
await chat("humano_fallido", [[IN, 4], [OUT, 3.5, { source: "manual", status: "FAILED" }], [OUT, 3, { source: "instance", failed: true }]]);
await chat("nota_despues", [[IN, 2], [OUT, 1, { tipo: "SYSTEM", source: "activity" }], [OUT, 0.5, { tipo: "SYSTEM", source: "manual" }]]);
// El reloj arranca en el PRIMER mensaje sin respuesta de una persona (no en el ultimo).
await chat("reloj", [[IN, 10], [OUT, 9, { source: "manual" }], [IN, 8], [OUT, 7.5, { source: null }], [IN, 7]]);
// Demora que empezo antes de la ventana: cuenta desde el primer mensaje DENTRO de las 72 h.
await chat("demora_vieja", [[IN, 100], [IN, 50], [IN, 20]]);
// Llamada perdida del cliente: no es respuesta.
await chat("llamada_perdida", [[IN, 6], [IN, 5, { tipo: "SYSTEM", source: "llamada", contenido: "Llamada entrante perdida" }]]);
// Pospuesto que ya vencio: vuelve a contar.
await chat("pospuesto_vencido", [[IN, 2]], { contacto: { metadata: { snoozedUntil: iso(haceHoras(1)) } } });
// De la asesora: principal y segunda; y en otro canal.
await chat("de_maria", [[IN, 1]], { asesora: "maria" });
await chat("de_ana_y_maria", [[IN, 1.5]], { asesora: "ana", segunda: "maria" });
await chat("otro_canal", [[IN, 1]], { channelId: "canal_2", asesora: "ana" });
await chat("pendiente", [[IN, 1]], { estado: "PENDING" });

/* --- Fuera --- */
await chat("con_manual", [[IN, 3], [OUT, 2, { source: "manual" }]]);
await chat("con_instance", [[IN, 3], [OUT, 2, { source: "instance" }]]);
await chat("llamada_atendida", [[IN, 3], [OUT, 2, { tipo: "SYSTEM", source: "llamada", contenido: "Llamada saliente · 45 s" }]]);
await chat("llamada_entrante_atendida", [[IN, 3], [IN, 2, { tipo: "SYSTEM", source: "llamada", contenido: "Llamada entrante · 3 min" }]]);
await chat("equipo_mayusculas", [[IN, 1]]);
await etiqueta("ct_equipo_mayusculas", "EQUIPO", "equipo");
await chat("proveedor_tilde", [[IN, 1]]);
await etiqueta("ct_proveedor_tilde", "Proveedór", "x-1");
await chat("proveedor_por_slug", [[IN, 1]]);
await etiqueta("ct_proveedor_por_slug", "Otra cosa", "PROVEEDORES");
await chat("equipo_tilde", [[IN, 1]]);
await etiqueta("ct_equipo_tilde", "Équipo ", "eq");
await chat("oculto", [[IN, 1]], { contacto: { excludedFromCrm: true } });
await chat("bloqueado", [[IN, 1]], { contacto: { bloqueadoEn: iso(haceHoras(30)) } });
await chat("pospuesto", [[IN, 1]], { contacto: { metadata: { snoozedUntil: iso(haceHoras(-5)) } } });
await chat("resuelto", [[IN, 1]], { estado: "CLOSED" });
await chat("archivado", [[IN, 1]], { estado: "ARCHIVED" });
await chat("estado_whatsapp", [[IN, 1, { estadoWhatsapp: true }]]);
await chat("cliente_viejo", [[IN, 80]]);
await chat("borrado", [[IN, 1, { borrado: true }]]);
await chat("solo_nuestro", [[OUT, 1, { source: null }]]);
await chat("otro_negocio", [[IN, 1]], { workspaceId: "ws_otro", contacto: { workspaceId: "ws_otro" } });
// Etiqueta que no es EQUIPO ni PROVEEDOR: sigue dentro.
await chat("con_otra_etiqueta", [[IN, 1]]);
await etiqueta("ct_con_otra_etiqueta", "Cliente VIP", "vip");

/* --- Linea oficial --- */
await db.query(`INSERT INTO "OfficialApiClientConfig" VALUES ('cfg_1', $1), ('cfg_otro', 'ws_otro')`, [WS]);
async function chatOficial(id, mensajes, extra = {}) {
  const contactoOficial = `oc_${id}`;
  let crm = null;
  if (extra.contacto || extra.etiqueta) {
    crm = `ct_of_${id}`;
    await contacto(crm, extra.contacto ?? {});
    if (extra.etiqueta) await etiqueta(crm, extra.etiqueta, "s");
  }
  await db.query(`INSERT INTO "OfficialApiContact" VALUES ($1,$2,$3)`, [contactoOficial, extra.config ?? "cfg_1", crm]);
  const ultimo = Math.min(...mensajes.map((m) => m[1]));
  await db.query(`INSERT INTO "OfficialApiConversation" VALUES ($1,$2,$3,$4,$5,$6)`, [
    id,
    extra.config ?? "cfg_1",
    contactoOficial,
    extra.asesora ?? null,
    extra.estado ?? "OPEN",
    iso(haceHoras(ultimo)),
  ]);
  for (const [direccion, horas, o = {}] of mensajes) {
    await db.query(`INSERT INTO "OfficialApiMessage" VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [
      `om_${++n}`,
      extra.config ?? "cfg_1",
      id,
      direccion,
      o.tipo ?? "TEXT",
      o.status ?? (direccion === "IN" ? "RECEIVED" : "SENT"),
      o.contenido ?? "hola",
      o.failed ? iso(haceHoras(horas)) : null,
      o.source === undefined ? null : JSON.stringify({ source: o.source }),
      iso(haceHoras(horas)),
    ]);
  }
}
await chatOficial("of_sin_respuesta", [[IN, 2]], { asesora: "maria" });
await chatOficial("of_solo_bot", [[IN, 3], [OUT, 2, { source: "automation" }]]);
await chatOficial("of_fallido", [[IN, 3], [OUT, 2, { source: "manual", status: "FAILED" }]]);
await chatOficial("of_manual", [[IN, 3], [OUT, 2, { source: "manual" }]]);
await chatOficial("of_bloqueado", [[IN, 1]], { contacto: { bloqueadoEn: iso(haceHoras(1)) } });
await chatOficial("of_proveedor", [[IN, 1]], { etiqueta: "PROVEEDOR" });
await chatOficial("of_resuelto", [[IN, 1]], { estado: "CLOSED" });
await chatOficial("of_otro_negocio", [[IN, 1]], { config: "cfg_otro" });

/* ------------------------------------------------------------------------------------------------
   2. El cargador de src (alias @/) con un pool de pg falso, copiado de check-velocidad-bandeja.mjs.
      Las consultas de la espera van a PGlite; el resto contesta filas inventadas.
------------------------------------------------------------------------------------------------ */
const pg = require("pg");
const escenario = { userRole: "CLIENTE", memberRole: "OWNER", monitorIds: [], falla: false };
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
  if (col === "metadata" && tabla === "WhatsAppChannel") return [3802, JSON.stringify({ monitorIds: escenario.monitorIds })];
  if (col === "metadata" || col === "activeProductContext") return [3802, "{}"];
  if (col === "crmStage" || col === "planTier") return [25, null];
  if (col === "value") return [25, "[]"];
  if (/At$/.test(col)) return [1114, "2026-10-08 10:00:00.000"];
  if (col === "isActive") return [16, true];
  if (/^is[A-Z]/.test(col) || col === "automationPaused") return [16, false];
  if (col === "name" || col === "email" || col === "phoneNumber" || col === "key") return [25, "n"];
  return [25, "x1"];
}

const esConsultaDeEspera = (texto) => texto.includes("WITH candidatas AS");

class PoolFalso extends pg.Pool {
  async query(q) {
    const text = typeof q === "string" ? q : q.text;
    sqls.push(text);
    if (esConsultaDeEspera(text)) {
      if (escenario.falla) throw new Error("la base no responde (simulado)");
      // Como lo entrega pg por texto: los JSON como texto (el adaptador de Prisma los lee asi).
      const res = await db.query(text, q.values ?? [], { rowMode: "array" });
      return {
        fields: res.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
        rows: res.rows.map((fila) =>
          fila.map((v, i) => ([114, 3802].includes(res.fields[i].dataTypeID) && v !== null ? JSON.stringify(v) : v)),
        ),
        rowCount: res.rows.length,
      };
    }
    // Los count() de los contadores: aca no importa el numero.
    const conteo = /AS "(_count\$_all)"/.exec(text);
    if (conteo) return { fields: [{ name: conteo[1], dataTypeID: 23 }], rows: [[0]], rowCount: 1 };
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

const sesion = { actual: { user: { id: "x1", role: "CLIENTE" } } };
const cargar = cargadorDeSrc(sesion);
const espera = cargar("@/features/chats/services/espera-de-chats");

/* ------------------------------------------------------------------------------------------------
   3. El SQL en PGlite: quien entra, quien no y desde cuando
------------------------------------------------------------------------------------------------ */
async function correr(sql) {
  return (await db.query(sql.text, sql.values)).rows;
}
const filasViejo = await correr(espera.sqlEsperaDeChats({ workspaceId: WS, ahora: AHORA }));
const filasOficial = await correr(espera.sqlEsperaOficial({ workspaceId: WS, ahora: AHORA }));
const enEspera = [
  ...espera.chatsEnEsperaDeLasFilas(filasViejo, false),
  ...espera.chatsEnEsperaDeLasFilas(filasOficial, true),
];
const porClave = new Map(enEspera.map((c) => [c.key, c]));
const desdeDe = (key) => new Date(porClave.get(key).desde).toISOString();

await prueba("dentro: sin respuesta, solo bot, solo seguimiento, humano con envio fallido, nota interna despues", async () => {
  for (const id of ["sin_respuesta", "solo_bot", "solo_seguimiento", "humano_fallido", "nota_despues"]) {
    assert.ok(porClave.has(`agent:${id}`), `falta ${id}`);
  }
  assert.equal(desdeDe("agent:solo_bot"), iso(haceHoras(3)));
  assert.equal(desdeDe("agent:humano_fallido"), iso(haceHoras(4)));
});

await prueba("dentro: llamada perdida, pospuesto vencido, PENDING y una etiqueta cualquiera", async () => {
  for (const id of ["llamada_perdida", "pospuesto_vencido", "pendiente", "con_otra_etiqueta"]) {
    assert.ok(porClave.has(`agent:${id}`), `falta ${id}`);
  }
});

await prueba("reloj: desde el PRIMER mensaje sin respuesta de una persona; el bot no lo corta", async () => {
  assert.equal(desdeDe("agent:reloj"), iso(haceHoras(8)));
  assert.equal(desdeDe("agent:llamada_perdida"), iso(haceHoras(6)));
});

await prueba("reloj: si la demora empezo antes de las 72 h, cuenta desde el primer mensaje dentro", async () => {
  assert.equal(desdeDe("agent:demora_vieja"), iso(haceHoras(50)));
});

await prueba("fuera: manual, instance, llamada atendida (saliente y entrante)", async () => {
  for (const id of ["con_manual", "con_instance", "llamada_atendida", "llamada_entrante_atendida"]) {
    assert.ok(!porClave.has(`agent:${id}`), `no deberia estar ${id}`);
  }
});

await prueba("fuera: EQUIPO o PROVEEDOR con o sin tilde o mayusculas, por nombre o por slug", async () => {
  for (const id of ["equipo_mayusculas", "proveedor_tilde", "proveedor_por_slug", "equipo_tilde"]) {
    assert.ok(!porClave.has(`agent:${id}`), `no deberia estar ${id}`);
  }
});

await prueba("fuera: oculto, bloqueado, pospuesto, resuelto, estado de WhatsApp, viejo, borrado, otro negocio", async () => {
  for (const id of [
    "oculto",
    "bloqueado",
    "pospuesto",
    "resuelto",
    "archivado",
    "estado_whatsapp",
    "cliente_viejo",
    "borrado",
    "solo_nuestro",
    "otro_negocio",
  ]) {
    assert.ok(!porClave.has(`agent:${id}`), `no deberia estar ${id}`);
  }
});

await prueba("linea oficial: misma regla, y la ficha del CRM por crmContactId", async () => {
  const oficiales = enEspera.filter((c) => c.oficial).map((c) => c.key).sort();
  assert.deepEqual(oficiales, ["official:of_fallido", "official:of_sin_respuesta", "official:of_solo_bot"]);
  assert.equal(porClave.get("official:of_sin_respuesta").assignedToUserId, "maria");
});

await prueba("rendimiento: rawPayload se abre solo en las salientes y llamadas de los candidatos", async () => {
  const texto = espera.sqlEsperaDeChats({ workspaceId: WS, ahora: AHORA }).text;
  const [antesDeRespuestas] = texto.split("respuestas AS (");
  assert.ok(!antesDeRespuestas.includes("rawPayload"), "rawPayload aparece antes de tener los candidatos");
  assert.match(texto, /c\."lastMessageAt" > \$\d+/);
  assert.ok(!/make_interval|now\(\)/.test(texto), "la ventana sale de `ahora`, no del reloj de la base");
});

/* ------------------------------------------------------------------------------------------------
   4. El recorte por persona (funcion pura)
------------------------------------------------------------------------------------------------ */
const todos = [...enEspera].sort((a, b) => a.desde - b.desde);
const base = { canales: null, soloMios: false, canalElegido: null, incluirOficial: true };

await prueba("recorte: asesora solo ve sus chats (principal o segunda), tambien en la linea oficial", async () => {
  const r = espera.esperaParaPersona(todos, { ...base, userId: "maria", canales: ["canal_1", "canal_2"], soloMios: true });
  assert.deepEqual(r.chats.map((c) => c.key).sort(), ["agent:de_ana_y_maria", "agent:de_maria", "official:of_sin_respuesta"]);
  assert.equal(r.mine, 3);
  assert.equal(r.all, 3);
  assert.ok(r.chats.every((c) => c.mia));
});

await prueba("recorte: monitora y jefe ven sus lineas; mia marca lo suyo", async () => {
  const jefe = espera.esperaParaPersona(todos, { ...base, userId: "maria" });
  assert.equal(jefe.all, todos.length);
  assert.equal(jefe.mine, 3);
  const monitora = espera.esperaParaPersona(todos, { ...base, userId: "lucia", canales: ["canal_2"] });
  assert.deepEqual(monitora.chats.map((c) => c.key).sort(), [
    "agent:otro_canal",
    "official:of_fallido",
    "official:of_sin_respuesta",
    "official:of_solo_bot",
  ]);
  assert.equal(monitora.mine, 0);
});

await prueba("recorte: la linea elegida filtra y la oficial entra solo si la conexion la admite", async () => {
  const soloCanal2 = espera.esperaParaPersona(todos, { ...base, userId: "ana", canalElegido: "canal_2", incluirOficial: false });
  assert.deepEqual(soloCanal2.chats.map((c) => c.key), ["agent:otro_canal"]);
  assert.equal(soloCanal2.mine, 1);
  const soloOficial = espera.esperaParaPersona(todos, { ...base, userId: "ana", canalElegido: "linea_oficial", incluirOficial: true });
  assert.ok(soloOficial.chats.every((c) => c.key.startsWith("official:")));
  assert.equal(soloOficial.all, 3);
});

await prueba("recorte: el que mas lleva esperando primero, con la fecha en ISO", async () => {
  const r = espera.esperaParaPersona(todos, { ...base, userId: "x" });
  assert.equal(r.chats[0].key, "agent:demora_vieja");
  assert.equal(r.chats[0].desde, iso(haceHoras(50)));
});

/* ------------------------------------------------------------------------------------------------
   5. GET /api/cliente/chats/counts: `espera` en las tres salidas, memoria de 60 s y falla suave
------------------------------------------------------------------------------------------------ */
const { GET } = cargar("@/app/api/cliente/chats/counts/route");
const permisos = cargar("@/lib/cache-de-permisos");
const logOriginal = console.log;
const errorOriginal = console.error;
const errores = [];
async function pedir(url) {
  sqls.length = 0;
  console.log = () => {}; // las lineas [timing]
  console.error = (...args) => errores.push(args.map(String).join(" "));
  try {
    const res = await GET(new Request(url));
    const cuerpo = await res.json();
    assert.equal(cuerpo.ok, true, JSON.stringify(cuerpo));
    return { cuerpo, consultasDeEspera: sqls.filter(esConsultaDeEspera).length, timing: res.headers.get("Server-Timing") };
  } finally {
    console.log = logOriginal;
    console.error = errorOriginal;
  }
}
// El negocio de la ruta es "x1" (el pool falso contesta "x1" en todos los ids): se copian los chats.
await db.exec(`
  UPDATE "Conversation" SET "workspaceId" = 'x1' WHERE "workspaceId" = '${WS}';
  UPDATE "Message" SET "workspaceId" = 'x1' WHERE "workspaceId" = '${WS}';
  UPDATE "Contact" SET "workspaceId" = 'x1' WHERE "workspaceId" = '${WS}';
  UPDATE "OfficialApiClientConfig" SET "workspaceId" = 'x1' WHERE "workspaceId" = '${WS}';
  UPDATE "Conversation" SET "channelId" = 'x1' WHERE "channelId" = 'canal_1';
  UPDATE "Conversation" SET "assignedToUserId" = 'x1' WHERE "assignedToUserId" = 'maria';
  UPDATE "Conversation" SET "segundoAsesorId" = 'x1' WHERE "segundoAsesorId" = 'maria';
  UPDATE "OfficialApiConversation" SET "assignedToUserId" = 'x1' WHERE "assignedToUserId" = 'maria';
`);

await prueba("ruta: dueño recibe espera de todo el negocio; una sola carga por minuto (2 consultas)", async () => {
  espera.vaciarCacheDeEspera();
  permisos.vaciarCachesDePermisos();
  const fria = await pedir("http://x/api/cliente/chats/counts");
  assert.equal(fria.consultasDeEspera, 2, "una del canal viejo y una de la oficial");
  const e = fria.cuerpo.espera;
  assert.ok(e && Array.isArray(e.chats), JSON.stringify(fria.cuerpo));
  // El reloj del pedido es el de hoy, no AHORA: los que tienen mensajes dentro de 72 h de hoy.
  assert.equal(e.all, e.chats.length);
  assert.ok(e.chats.every((c) => /^(agent|official):/.test(c.key) && !Number.isNaN(Date.parse(c.desde))));
  assert.equal(e.mine, e.chats.filter((c) => c.mia).length);
  assert.ok(fria.cuerpo.counts, "los contadores siguen saliendo");
  assert.match(fria.timing ?? "", /espera/);
  const caliente = await pedir("http://x/api/cliente/chats/counts");
  assert.equal(caliente.consultasDeEspera, 0, "de la memoria");
  assert.deepEqual(caliente.cuerpo.espera, e);
});

// Para que la ruta vea chats, los mensajes se corren a "hace un rato" respecto de hoy.
const corrimiento = Date.now() - AHORA.getTime();
await db.query(`UPDATE "Message" SET "createdAt" = "createdAt" + ($1 || ' milliseconds')::interval`, [String(corrimiento)]);
await db.query(`UPDATE "OfficialApiMessage" SET "createdAt" = "createdAt" + ($1 || ' milliseconds')::interval`, [String(corrimiento)]);
await db.query(`UPDATE "Conversation" SET "lastMessageAt" = "lastMessageAt" + ($1 || ' milliseconds')::interval`, [String(corrimiento)]);
await db.query(`UPDATE "OfficialApiConversation" SET "lastMessageAt" = "lastMessageAt" + ($1 || ' milliseconds')::interval`, [String(corrimiento)]);
await db.query(`UPDATE "Contact" SET "metadata" = NULL WHERE "id" IN ('ct_pospuesto_vencido', 'ct_pospuesto')`);
await db.query(`DELETE FROM "Conversation" WHERE "id" = 'pospuesto'`);

await prueba("ruta: dueño con datos de hoy ve todos y marca los suyos", async () => {
  espera.vaciarCacheDeEspera();
  const { cuerpo } = await pedir("http://x/api/cliente/chats/counts");
  const claves = cuerpo.espera.chats.map((c) => c.key);
  assert.ok(claves.includes("agent:sin_respuesta"));
  assert.ok(claves.includes("agent:otro_canal"));
  assert.ok(claves.includes("official:of_solo_bot"));
  assert.ok(!claves.includes("agent:con_manual"));
  assert.ok(!claves.includes("agent:equipo_mayusculas"));
  // Suyos: de_maria (principal), de_ana_y_maria (segunda) y of_sin_respuesta.
  assert.equal(cuerpo.espera.mine, 3);
});

await prueba("ruta: asesora solo cuenta sus chats (principal o segunda)", async () => {
  escenario.userRole = "EMPLEADO";
  escenario.memberRole = "AGENT";
  sesion.actual = { user: { id: "x1", role: "EMPLEADO" } };
  permisos.vaciarCachesDePermisos();
  const { cuerpo, consultasDeEspera } = await pedir("http://x/api/cliente/chats/counts");
  assert.equal(consultasDeEspera, 0, "recorta lo que ya estaba en memoria");
  assert.deepEqual(cuerpo.espera.chats.map((c) => c.key).sort(), [
    "agent:de_ana_y_maria",
    "agent:de_maria",
    "official:of_sin_respuesta",
  ]);
  assert.equal(cuerpo.espera.mine, 3);
  assert.equal(cuerpo.espera.all, 3);
});

await prueba("ruta: asesora con una linea elegida que no es la oficial: sin chats oficiales", async () => {
  const { cuerpo } = await pedir("http://x/api/cliente/chats/counts?connection=channel:x1");
  assert.deepEqual(cuerpo.espera.chats.map((c) => c.key).sort(), ["agent:de_ana_y_maria", "agent:de_maria"]);
});

await prueba("ruta: monitora ve todo lo de sus lineas, no solo lo suyo", async () => {
  escenario.monitorIds = ["x1"];
  permisos.vaciarCachesDePermisos();
  const { cuerpo } = await pedir("http://x/api/cliente/chats/counts");
  const claves = cuerpo.espera.chats.map((c) => c.key);
  assert.ok(claves.includes("agent:sin_respuesta"), "lo de su linea aunque no sea suyo");
  assert.ok(!claves.includes("agent:otro_canal"), "otra linea no");
  assert.equal(cuerpo.espera.mine, cuerpo.espera.chats.filter((c) => c.mia).length);
  escenario.monitorIds = [];
});

await prueba("ruta: si la espera falla, espera null, queda en el log y los contadores responden", async () => {
  espera.vaciarCacheDeEspera();
  permisos.vaciarCachesDePermisos();
  escenario.falla = true;
  errores.length = 0;
  const { cuerpo } = await pedir("http://x/api/cliente/chats/counts");
  assert.equal(cuerpo.espera, null);
  assert.ok(cuerpo.counts);
  assert.ok(errores.some((e) => e.includes("no se pudo calcular la espera")), errores.join("\n"));
  // El error no se guarda: el pedido siguiente vuelve a intentar.
  escenario.falla = false;
  const otra = await pedir("http://x/api/cliente/chats/counts");
  assert.ok(otra.cuerpo.espera && otra.cuerpo.espera.all === 3);
});

await db.close();
console.log(`\n${pruebas} pruebas ok`);
process.exit(0);
