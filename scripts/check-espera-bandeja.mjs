// Pruebas de "Esperando respuesta" (parte 1: el calculo y el campo `espera` de /counts; parte 2:
// la lista GET /api/cliente/chats/list?espera=1 y la vista inicial de la bandeja; parte 3: la
// marca «espera N min» de cada fila; parte 4: la pastilla «Esperando», la vista en la bandeja y la
// apertura de la asesora).
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
/** Los ids de chats que existen en PGlite: la lista los pide por id y el pool falso los devuelve. */
const idsConocidos = { agent: new Set(), official: new Set() };
/** Los ids que pidio cada consulta de filas (para saber que se trajo y que no). */
const pedidos = { agent: [], official: [] };

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
    // La configuracion de la linea oficial (SQL directo): conectada, para que la lista la lea.
    if (text.includes('FROM "OfficialApiClientConfig"') && text.includes('"accessToken"')) {
      const cols = ["id", "workspaceId", "accessToken", "phoneNumberId", "wabaId", "webhookVerifyToken", "appSecret", "status"];
      return { fields: cols.map((name) => ({ name, dataTypeID: 25 })), rows: [["cfg_1", "x1", "t", "p", "w", "v", "s", "CONNECTED"]], rowCount: 1 };
    }
    // La lista de la linea oficial por id (soloIds): una fila por cada chat oficial pedido.
    if (text.includes("filtered_conversations")) {
      const ids = (q.values ?? []).filter((v) => idsConocidos.official.has(v));
      pedidos.official.push(ids);
      const cols = [
        ["id", 25], ["contactId", 25], ["contactName", 25], ["contactPhoneNumber", 25], ["contactWaId", 25],
        ["crmContactId", 25], ["crmStage", 25], ["assignedToUserId", 25], ["assignedToName", 25],
        ["assignedToEmail", 25], ["incomingCount", 23], ["lastMessageId", 25], ["lastMessageContent", 25],
        ["lastMessageDirection", 25], ["lastMessageCreatedAt", 1114], ["lastMessageStatus", 25],
        ["lastMessageType", 25], ["lastMessageMediaUrl", 25], ["lastMessageRawPayload", 3802], ["sinResponderDesde", 1114],
      ];
      return {
        fields: cols.map(([name, dataTypeID]) => ({ name, dataTypeID })),
        rows: ids.map((id) => [
          id, `oc_${id}`, id, "573000000000", "573000000000", null, null, null, null, null, 1, `om_${id}`, "hola",
          "INBOUND", "2026-10-08 10:00:00.000", "RECEIVED", "TEXT", null, "{}", null,
        ]),
        rowCount: ids.length,
      };
    }
    // Los count() de los contadores: aca no importa el numero.
    const conteo = /AS "(_count\$_all)"/.exec(text);
    if (conteo) return { fields: [{ name: conteo[1], dataTypeID: 23 }], rows: [[0]], rowCount: 1 };
    const info = columnas(text);
    if (!info) return { fields: [], rows: [], rowCount: 1 };
    const fields = info.cols.map((c) => ({ name: c, dataTypeID: valor(info.tabla, c)[0] }));
    // La lista del canal viejo por id (soloIds): una fila por cada chat pedido que existe.
    const idsPedidos = (q.values ?? []).filter((v) => idsConocidos.agent.has(v));
    if (info.tabla === "Conversation" && idsPedidos.length) {
      pedidos.agent.push(idsPedidos);
      return {
        fields,
        // Cada chat con su propio contacto: la lista junta los chats del mismo contacto y linea.
        rows: idsPedidos.map((id) =>
          info.cols.map((c) => (c === "id" ? id : c === "contactId" ? `ct_${id}` : valor(info.tabla, c)[1])),
        ),
        rowCount: idsPedidos.length,
      };
    }
    // Y esos contactos, cuando Prisma los pide aparte.
    const contactosPedidos = (q.values ?? []).filter(
      (v) => typeof v === "string" && v.startsWith("ct_") && idsConocidos.agent.has(v.slice(3)),
    );
    if (info.tabla === "Contact" && contactosPedidos.length) {
      return {
        fields,
        rows: contactosPedidos.map((id) => info.cols.map((c) => (c === "id" ? id : valor(info.tabla, c)[1]))),
        rowCount: contactosPedidos.length,
      };
    }
    return { fields, rows: [info.cols.map((c) => valor(info.tabla, c)[1])], rowCount: 1 };
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

/* ------------------------------------------------------------------------------------------------
   6. Parte 2: la lista "Esperando" (funciones puras)
------------------------------------------------------------------------------------------------ */
const dominio = cargar("@/features/chats/domain/espera-de-chats");
const filtrosDominio = cargar("@/features/chats/domain/filtros-de-bandeja");

await prueba("lista: el que mas lleva primero; si empatan, por key", async () => {
  const chats = [
    { key: "agent:b", desde: "2026-11-06T10:00:00.000Z" },
    { key: "official:a", desde: "2026-11-06T09:00:00.000Z" },
    { key: "agent:a", desde: "2026-11-06T10:00:00.000Z" },
    { key: "agent:c", desde: "2026-11-06T08:00:00.000Z" },
  ];
  assert.deepEqual(dominio.ordenarEsperando(chats).map((c) => c.key), ["agent:c", "official:a", "agent:a", "agent:b"]);
});

await prueba("lista: las paginas siguen sin repetir ni saltar, y hasMore/nextOffset salen de la lista", async () => {
  const lista = Array.from({ length: 7 }, (_, i) => `k${i}`);
  const p1 = dominio.paginaDeEspera(lista, 0, 3);
  assert.deepEqual(p1, { pagina: ["k0", "k1", "k2"], nextOffset: 3, hasMore: true });
  const p2 = dominio.paginaDeEspera(lista, p1.nextOffset, 3);
  assert.deepEqual(p2, { pagina: ["k3", "k4", "k5"], nextOffset: 6, hasMore: true });
  const p3 = dominio.paginaDeEspera(lista, p2.nextOffset, 3);
  assert.deepEqual(p3, { pagina: ["k6"], nextOffset: 7, hasMore: false });
  assert.deepEqual(dominio.paginaDeEspera(lista, 50, 3), { pagina: [], nextOffset: 50, hasMore: false });
});

await prueba("lista: las filas se reordenan segun la espera y sobra lo que no esta en ella", async () => {
  const filas = [{ key: "a" }, { key: "b" }, { key: "x" }, { key: "c" }];
  assert.deepEqual(dominio.ordenarSegunEspera(filas, ["c", "a", "falta", "b"]).map((f) => f.key), ["c", "a", "b"]);
});

await prueba("direccion: espera=1 se lee sin Prisma", async () => {
  const leer = (q) => (clave) => new URLSearchParams(q).get(clave);
  assert.equal(filtrosDominio.leerEspera(leer("espera=1")), true);
  assert.equal(filtrosDominio.leerEspera(leer("espera=0")), false);
  assert.equal(filtrosDominio.leerEspera(leer("")), false);
  // El archivo del dominio no importa Prisma (lo usa la pantalla).
  for (const archivo of ["src/features/chats/domain/filtros-de-bandeja.ts", "src/features/chats/domain/espera-de-chats.ts"]) {
    assert.ok(!/from "@prisma\/client"|@\/lib\/prisma/.test(fs.readFileSync(archivo, "utf8")), archivo);
  }
});

await prueba("vista inicial: todos los casos", async () => {
  const leer = (q) => (clave) => new URLSearchParams(q).get(clave);
  const vista = (q, veTodas, esperandoMios) => dominio.vistaInicialDeLaBandeja({ leer: leer(q), veTodas, esperandoMios });
  // Dueño, admin, supervisora o monitora: Todas (tengan o no chats esperando).
  assert.deepEqual(vista("", true, 5), { origen: "defecto", assigned: "all", espera: false });
  assert.deepEqual(vista("", true, 0), { origen: "defecto", assigned: "all", espera: false });
  // Asesora con chats esperando: Esperando con Mias; sin chats, o sin saberlo: Mias.
  assert.deepEqual(vista("", false, 2), { origen: "defecto", assigned: "mine", espera: true });
  assert.deepEqual(vista("", false, 0), { origen: "defecto", assigned: "mine", espera: false });
  assert.deepEqual(vista("", false, null), { origen: "defecto", assigned: "mine", espera: false });
  // La conexion sola no elige la vista.
  assert.deepEqual(vista("connection=channel:x", false, 2), { origen: "defecto", assigned: "mine", espera: true });
  // Cualquiera de estos en la direccion: se respeta lo que viene.
  for (const q of [
    "chatKey=agent:1",
    "conversacion=1",
    "assigned=all",
    "q=juan",
    "status=resolved",
    "c=etapa:es:NUEVO",
    "stage=NUEVO",
    "tag=t1",
    "pending=1",
    "espera=1",
  ]) {
    assert.deepEqual(vista(q, false, 2), { origen: "direccion" }, q);
    assert.deepEqual(vista(q, true, 0), { origen: "direccion" }, q);
  }
  // Vacios no cuentan.
  assert.deepEqual(vista("q=&assigned=", false, 1), { origen: "defecto", assigned: "mine", espera: true });
});

/* ------------------------------------------------------------------------------------------------
   7. Parte 2: GET /api/cliente/chats/list?espera=1
------------------------------------------------------------------------------------------------ */
for (const fila of (await db.query(`SELECT "id" FROM "Conversation"`)).rows) idsConocidos.agent.add(fila.id);
for (const fila of (await db.query(`SELECT "id" FROM "OfficialApiConversation"`)).rows) idsConocidos.official.add(fila.id);
const lista = cargar("@/app/api/cliente/chats/list/route");
async function pedirLista(url) {
  sqls.length = 0;
  pedidos.agent.length = 0;
  pedidos.official.length = 0;
  console.log = () => {};
  console.error = (...args) => errores.push(args.map(String).join(" "));
  try {
    const res = await lista.GET(new Request(url));
    const cuerpo = await res.json();
    assert.equal(cuerpo.ok, true, JSON.stringify(cuerpo));
    return { cuerpo, consultas: sqls.length, consultasDeEspera: sqls.filter(esConsultaDeEspera).length };
  } finally {
    console.log = logOriginal;
    console.error = errorOriginal;
  }
}
/** Recorre la lista entera pagina por pagina, como el scroll de la bandeja. */
async function recorrer(base, limit) {
  const claves = [];
  let offset = 0;
  for (let vuelta = 0; vuelta < 50; vuelta++) {
    const { cuerpo } = await pedirLista(`${base}&limit=${limit}&offset=${offset}`);
    assert.equal(cuerpo.nextCursor, null, "sin cursor: el scroll cae a nextOffset");
    claves.push(...cuerpo.conversations.map((c) => c.key));
    if (!cuerpo.hasMore) return claves;
    assert.ok(cuerpo.nextOffset > offset, "el offset avanza");
    offset = cuerpo.nextOffset;
  }
  throw new Error("la lista no termina");
}
const comoDueno = () => {
  escenario.userRole = "CLIENTE";
  escenario.memberRole = "OWNER";
  sesion.actual = { user: { id: "x1", role: "CLIENTE" } };
  permisos.vaciarCachesDePermisos();
};
const comoAsesora = () => {
  escenario.userRole = "EMPLEADO";
  escenario.memberRole = "AGENT";
  sesion.actual = { user: { id: "x1", role: "EMPLEADO" } };
  permisos.vaciarCachesDePermisos();
};

await prueba("ruta /list: dueño en Todas, del que mas lleva al que menos, mezclando WhatsApp y oficial", async () => {
  comoDueno();
  espera.vaciarCacheDeEspera();
  const contadores = (await pedir("http://x/api/cliente/chats/counts")).cuerpo.espera;
  const esperado = dominio.ordenarEsperando(contadores.chats).map((c) => c.key);
  const { cuerpo, consultasDeEspera } = await pedirLista("http://x/api/cliente/chats/list?espera=1&assigned=all&limit=40");
  assert.equal(consultasDeEspera, 0, "la misma memoria de 60 s que /counts");
  assert.deepEqual(cuerpo.conversations.map((c) => c.key), esperado, "mismas filas y en el orden de la espera");
  assert.equal(cuerpo.hasMore, false);
  assert.equal(cuerpo.nextOffset, esperado.length);
  assert.ok(esperado.some((k) => k.startsWith("official:")) && esperado.some((k) => k.startsWith("agent:")));
  assert.equal(cuerpo.esperaNoDisponible, undefined);
});

await prueba("ruta /list: la pagina 2 sigue sin repetir ni saltar filas (oficial en cualquier pagina)", async () => {
  const todas = (await pedirLista("http://x/api/cliente/chats/list?espera=1&assigned=all&limit=40")).cuerpo.conversations.map((c) => c.key);
  for (const limit of [1, 2, 3, 5]) {
    const paginado = await recorrer("http://x/api/cliente/chats/list?espera=1&assigned=all", limit);
    assert.deepEqual(paginado, todas, `limit ${limit}`);
    assert.equal(new Set(paginado).size, paginado.length, "sin repetidos");
  }
  // La primera oficial no esta en la primera pagina de 3: igual sale, sin incluirOficial=1.
  const posicionOficial = todas.findIndex((k) => k.startsWith("official:"));
  assert.ok(posicionOficial >= 3, `la oficial deberia caer despues de la pagina 1 (esta en ${posicionOficial})`);
  const pagina = Math.floor(posicionOficial / 3) * 3;
  const { cuerpo } = await pedirLista(`http://x/api/cliente/chats/list?espera=1&assigned=all&limit=3&offset=${pagina}`);
  assert.ok(cuerpo.conversations.some((c) => c.source === "official"), JSON.stringify(cuerpo.conversations.map((c) => c.key)));
});

await prueba("ruta /list: linea oficial respondida solo por automatizacion sale; con manual no", async () => {
  const claves = (await pedirLista("http://x/api/cliente/chats/list?espera=1&assigned=all&limit=40")).cuerpo.conversations.map((c) => c.key);
  assert.ok(claves.includes("official:of_solo_bot"));
  assert.ok(!claves.includes("official:of_manual"));
  assert.ok(!claves.includes("agent:con_manual"));
});

await prueba("ruta /list: dueño en Mias ve solo lo suyo; sin asignar solo lo que no tiene asesora", async () => {
  const mias = (await pedirLista("http://x/api/cliente/chats/list?espera=1&assigned=mine&limit=40")).cuerpo.conversations.map((c) => c.key);
  assert.deepEqual([...mias].sort(), ["agent:de_ana_y_maria", "agent:de_maria", "official:of_sin_respuesta"]);
  const sinAsignar = (await pedirLista("http://x/api/cliente/chats/list?espera=1&assigned=unassigned&limit=40")).cuerpo.conversations.map((c) => c.key);
  assert.ok(sinAsignar.length > 0);
  assert.ok(!sinAsignar.some((k) => ["agent:de_maria", "agent:de_ana_y_maria", "agent:otro_canal", "official:of_sin_respuesta"].includes(k)));
});

await prueba("ruta /list: la linea elegida filtra (y la oficial no entra si no es esa linea)", async () => {
  const claves = (await pedirLista("http://x/api/cliente/chats/list?espera=1&assigned=all&limit=40&connection=channel:x1")).cuerpo.conversations.map((c) => c.key);
  assert.ok(claves.length > 0);
  assert.ok(claves.every((k) => k.startsWith("agent:")));
  assert.ok(!claves.includes("agent:otro_canal"));
});

await prueba("ruta /list: asesora solo ve lo suyo, aunque pida Todas", async () => {
  comoAsesora();
  for (const assigned of ["all", "mine", "unassigned", ""]) {
    const { cuerpo } = await pedirLista(`http://x/api/cliente/chats/list?espera=1&assigned=${assigned}&limit=40`);
    assert.deepEqual(cuerpo.conversations.map((c) => c.key).sort(), ["agent:de_ana_y_maria", "agent:de_maria", "official:of_sin_respuesta"], assigned);
    // Solo se pidieron a la base sus chats.
    assert.deepEqual(pedidos.agent.flat().sort(), ["de_ana_y_maria", "de_maria"]);
  }
  const paginado = await recorrer("http://x/api/cliente/chats/list?espera=1&assigned=mine", 1);
  assert.equal(paginado.length, 3);
});

await prueba("ruta /list: con ids= (fijados) devuelve solo los que ademas estan esperando", async () => {
  comoDueno();
  // Los ids reales son cuid (letras y numeros): la ruta descarta los demas.
  const negocio = { workspaceId: "x1", channelId: "x1", contacto: { workspaceId: "x1" } };
  await chat("fijado1", [[IN, 2]], negocio);
  await chat("fijado2", [[IN, 3], [OUT, 2, { source: "manual" }]], negocio);
  await chat("fijado3", [[IN, 2]], negocio);
  for (const tabla of ["Message", "Conversation"]) {
    const campo = tabla === "Message" ? "createdAt" : "lastMessageAt";
    const columna = tabla === "Message" ? "conversationId" : "id";
    await db.query(
      `UPDATE "${tabla}" SET "${campo}" = "${campo}" + ($1 || ' milliseconds')::interval WHERE "${columna}" IN ('fijado1','fijado2','fijado3')`,
      [String(corrimiento)],
    );
  }
  for (const id of ["fijado1", "fijado2", "fijado3"]) idsConocidos.agent.add(id);
  espera.vaciarCacheDeEspera();
  const { cuerpo } = await pedirLista("http://x/api/cliente/chats/list?espera=1&assigned=all&ids=agent:fijado1,fijado2,fijado3");
  assert.deepEqual(cuerpo.conversations.map((c) => c.key).sort(), ["agent:fijado1", "agent:fijado3"]);
  assert.deepEqual(pedidos.agent.flat().sort(), ["fijado1", "fijado3"], "fijado2 ya tiene respuesta: ni se pide");
  assert.equal(cuerpo.hasMore, false);
});

await prueba("oficial: soloIds trae solo esos chats y entra en la clave de su memoria", async () => {
  const { getOfficialApiChatsData } = cargar("@/features/official-api/services/getOfficialApiChatsData");
  const base = { workspaceId: "x1", includeSelectedConversation: false, statusFilter: "open", assignedFilter: "all", currentUserId: "x1" };
  const uno = await getOfficialApiChatsData({ ...base, soloIds: ["of_solo_bot"] });
  assert.deepEqual(uno.conversations.map((c) => c.id), ["of_solo_bot"]);
  const otro = await getOfficialApiChatsData({ ...base, soloIds: ["of_fallido"] });
  assert.deepEqual(otro.conversations.map((c) => c.id), ["of_fallido"], "no sirve la memoria del pedido anterior");
  // Una lista vacia no trae nada (nunca todos).
  pedidos.official.length = 0;
  const vacia = await getOfficialApiChatsData({ ...base, soloIds: [] });
  assert.deepEqual(vacia.conversations, []);
});

await prueba("ruta /list: con texto en el buscador la busqueda manda y espera no se aplica", async () => {
  const { cuerpo, consultasDeEspera } = await pedirLista("http://x/api/cliente/chats/list?espera=1&assigned=all&q=juan&limit=20");
  assert.equal(consultasDeEspera, 0);
  assert.equal(pedidos.agent.length, 0, "no pide por id: es la lista normal");
  assert.equal(cuerpo.esperaNoDisponible, undefined);
});

await prueba("ruta /list: sin espera, nada cambia (no lee la espera)", async () => {
  espera.vaciarCacheDeEspera();
  const { cuerpo, consultasDeEspera } = await pedirLista("http://x/api/cliente/chats/list?assigned=all&limit=20");
  assert.equal(consultasDeEspera, 0);
  assert.equal(cuerpo.esperaNoDisponible, undefined);
  assert.equal(pedidos.agent.length, 0);
});

await prueba("ruta /list: si la espera falla responde ok, vacia, hasMore false y esperaNoDisponible", async () => {
  espera.vaciarCacheDeEspera();
  escenario.falla = true;
  errores.length = 0;
  try {
    const { cuerpo } = await pedirLista("http://x/api/cliente/chats/list?espera=1&assigned=all&limit=20");
    assert.deepEqual(cuerpo.conversations, []);
    assert.equal(cuerpo.hasMore, false);
    assert.equal(cuerpo.esperaNoDisponible, true);
    assert.equal(cuerpo.nextCursor, null);
    assert.ok(errores.some((e) => e.includes("no se pudo calcular la espera")));
    assert.ok(!JSON.stringify(cuerpo).includes("simulado"), "el error interno no sale en la respuesta");
  } finally {
    escenario.falla = false;
  }
  const otra = await pedirLista("http://x/api/cliente/chats/list?espera=1&assigned=all&limit=20");
  assert.ok(otra.cuerpo.conversations.length > 0, "el error no se guarda");
});

/* ------------------------------------------------------------------------------------------------
   Parte 3: la marca «espera N min» de cada fila
------------------------------------------------------------------------------------------------ */
const T = Date.parse("2026-11-07T15:00:00.000Z");
const hace = (minutos) => new Date(T - minutos * 60_000).toISOString();

await prueba("marca: 9 min gris; 10 y 14 ambar; 15 rojo", async () => {
  assert.equal(dominio.marcaDeEspera(hace(9), T).color, "gris");
  assert.equal(dominio.marcaDeEspera(hace(0), T).color, "gris");
  assert.equal(dominio.marcaDeEspera(hace(10), T).color, "ambar");
  assert.equal(dominio.marcaDeEspera(hace(14), T).color, "ambar");
  assert.equal(dominio.marcaDeEspera(hace(15), T).color, "rojo");
  assert.equal(dominio.marcaDeEspera(hace(3 * 24 * 60), T).color, "rojo");
});

await prueba("marca: textos de 12 min, 2 h 5 min y 3 d (siempre con la palabra «espera»)", async () => {
  assert.equal(dominio.marcaDeEspera(hace(12), T).texto, "espera 12 min");
  assert.equal(dominio.marcaDeEspera(hace(125), T).texto, "espera 2 h 5 min");
  assert.equal(dominio.marcaDeEspera(hace(3 * 24 * 60 + 70), T).texto, "espera 3 d");
  assert.equal(dominio.textoDeEspera(59), "espera 59 min");
  assert.equal(dominio.textoDeEspera(60), "espera 1 h");
  assert.equal(dominio.textoDeEspera(24 * 60 - 1), "espera 23 h 59 min");
  assert.equal(dominio.textoDeEspera(24 * 60), "espera 1 d");
});

await prueba("marca: sin desde, fecha rota o desde en el futuro", async () => {
  assert.equal(dominio.marcaDeEspera(undefined, T), null);
  assert.equal(dominio.marcaDeEspera(null, T), null);
  assert.equal(dominio.marcaDeEspera("no-es-fecha", T), null);
  assert.equal(dominio.marcaDeEspera(new Date(T + 90_000).toISOString(), T).texto, "espera 0 min");
});

await prueba("marca: el reloj sube cada minuto sin pedir nada (misma fecha, otra hora)", async () => {
  const desde = hace(9);
  assert.equal(dominio.marcaDeEspera(desde, T).texto, "espera 9 min");
  assert.equal(dominio.marcaDeEspera(desde, T + 60_000).texto, "espera 10 min");
  assert.equal(dominio.marcaDeEspera(desde, T + 60_000).color, "ambar");
});

await prueba("marca: el mapa sale del ultimo /counts; null o un chat que ya no viene = sin marca", async () => {
  const primero = dominio.esperaPorClave({ mine: 1, all: 2, chats: [
    { key: "agent:a", desde: hace(12), mia: true },
    { key: "official:b", desde: hace(3), mia: false },
  ] });
  assert.equal(primero.get("agent:a"), hace(12));
  assert.equal(primero.get("official:b"), hace(3));
  const siguiente = dominio.esperaPorClave({ mine: 0, all: 1, chats: [{ key: "official:b", desde: hace(3), mia: false }] });
  assert.equal(siguiente.has("agent:a"), false, "el que ya no espera pierde la marca");
  assert.equal(dominio.esperaPorClave(null).size, 0);
  assert.equal(dominio.esperaPorClave(undefined).size, 0);
});

await prueba("pantalla: un solo reloj en la lista, nada por fila, y el efecto de conteos no se dispara mas", async () => {
  const lista = fs.readFileSync(path.join(raiz, "components/chats/conversation-list.tsx"), "utf8");
  const bandeja = fs.readFileSync(path.join(raiz, "components/chats/shared-inbox.tsx"), "utf8");
  assert.equal((lista.match(/setInterval\(/g) ?? []).length, 1, "un solo setInterval en conversation-list");
  assert.match(lista, /setInterval\(tic, 60_000\)/);
  assert.match(lista, /if \(!document\.hidden\) setAhoraDeEspera/, "con la pestaña oculta no sube");
  const item = lista.slice(lista.indexOf("const ConversationListItem = memo("), lista.indexOf("const ESTILO_DE_FILA"));
  assert.ok(!/setInterval|setTimeout/.test(item), "la fila no tiene temporizador propio");
  // La marca vive en la linea de etiquetas, de alto fijo: no cambia el alto de la fila.
  const filaDeEtiquetas = lista.slice(lista.indexOf("function ConversationTagsRow("), lista.indexOf("const ConversationListItem = memo("));
  assert.match(filaDeEtiquetas, /espera\.texto/);
  assert.match(filaDeEtiquetas, /h-\[22px\]/);
  // El efecto de conteos conserva sus dependencias de siempre.
  assert.match(
    bandeja,
    /\}, \[conversationListApiPath, searchQuery, selectedConnectionKey, statusFilter, ponerFiltrosNuevos, pedidoDeConteos\]\);/,
  );
  assert.match(bandeja, /setEsperaDelConteo\(payload\.espera \?\? null\)/);
  assert.match(bandeja, /esperaPorClave\(esperaVigente\)/);
  assert.match(bandeja, /conversationItems=\{filasConEspera\}/);
  assert.ok(!/setConversationItems\([^)]*esperaDesde/.test(bandeja), "esperaDesde no se guarda en conversationItems");
});

/* ------------------------------------------------------------------------------------------------
   Parte 4: la pastilla «Esperando», la vista en la bandeja y la apertura de la asesora
------------------------------------------------------------------------------------------------ */
const utils = cargar("@/components/chats/chat-inbox-conversation-utils");
const leerHref = (href) => new URL(href, "http://x");

await prueba("enlaces: abrir un chat conserva espera=1 (y Mias, la linea y el chatKey)", async () => {
  const href = utils.buildConversationItemHrefFromParams(
    "/cliente/chats", "channel:c1", "", { id: "agent:a1" }, "mine", "open", [], true,
  );
  const url = leerHref(href);
  assert.equal(url.searchParams.get("chatKey"), "agent:a1");
  assert.equal(url.searchParams.get("espera"), "1");
  assert.equal(url.searchParams.get("assigned"), "mine");
  assert.equal(url.searchParams.get("connection"), "channel:c1");
  // Sin Esperando el enlace queda como siempre.
  const sin = leerHref(utils.buildConversationItemHrefFromParams("/cliente/chats", "", "", { id: "agent:a1" }, "all", "open"));
  assert.equal(sin.searchParams.has("espera"), false);
  assert.equal(sin.searchParams.has("assigned"), false);
});

await prueba("enlaces: page.tsx conserva espera=1 en volver a la lista, el chat abierto y cada fila", async () => {
  const pagina = fs.readFileSync(path.join(raiz, "app/cliente/chats/page.tsx"), "utf8");
  const listaHref = pagina.slice(pagina.indexOf("const chatListHref"), pagina.indexOf("const selectedChatHref"));
  assert.match(listaHref, /pideEspera \? \[\["espera", "1"\]\]/);
  assert.match(listaHref, /\|\|\s*pideEspera/);
  const abiertoHref = pagina.slice(pagina.indexOf("const selectedChatHref"), pagina.indexOf("let selectedConversation"));
  assert.match(abiertoHref, /pideEspera \? \[\["espera", "1"\]\]/);
  assert.match(pagina, /\$\{pideEspera \? "&espera=1" : ""\}`/);
  assert.match(pagina, /esperaDelServidor=\{pideEspera\}/);
});

await prueba("pastilla: asignacion al tocar Esperando (Todas o Mias, nada mas)", async () => {
  // Jefe
  assert.equal(utils.asignacionDeEsperando("all", true), "all");
  assert.equal(utils.asignacionDeEsperando("mine", true), "mine");
  assert.equal(utils.asignacionDeEsperando("unassigned", true), "all");
  assert.equal(utils.asignacionDeEsperando("user:ana", true), "all");
  // Con una lista guardada o condiciones se suelta y queda Todas.
  assert.equal(utils.asignacionDeEsperando("mine", true, true), "all");
  // Asesora: siempre Mias.
  assert.equal(utils.asignacionDeEsperando("all", false), "mine");
  assert.equal(utils.asignacionDeEsperando("mine", false, true), "mine");
});

await prueba("pastilla: numero espera.all en Todas y espera.mine en Mias; sin dato, sin numero", async () => {
  const espera = { mine: 2, all: 7, chats: [] };
  assert.equal(utils.numeroDeEsperando(espera, "all"), 7);
  assert.equal(utils.numeroDeEsperando(espera, "mine"), 2);
  assert.equal(utils.numeroDeEsperando(null, "all"), null);
  assert.equal(utils.numeroDeEsperando(undefined, "mine"), null);
  assert.equal(utils.numeroDeEsperando({ mine: 0, all: 0, chats: [] }, "mine"), 0);
});

await prueba("pastilla: la direccion pone espera=1 con la asignacion y la linea; suelta estado y condiciones", async () => {
  const conLinea = leerHref(utils.hrefDeEsperando({
    searchAction: "/cliente/chats", selectedConnectionKey: "channel:c1", searchQuery: "", asignacion: "mine", espera: true,
  }));
  assert.deepEqual([...conLinea.searchParams.entries()].sort(), [["assigned", "mine"], ["connection", "channel:c1"], ["espera", "1"]]);
  const todas = leerHref(utils.hrefDeEsperando({ searchAction: "/cliente/chats", asignacion: "all", espera: true }));
  assert.deepEqual([...todas.searchParams.entries()], [["espera", "1"]]);
  // Tocar de nuevo Esperando la quita y deja el grupo (Mias queda en la direccion y se respeta).
  const fuera = leerHref(utils.hrefDeEsperando({ searchAction: "/cliente/chats", asignacion: "mine", espera: false }));
  assert.deepEqual([...fuera.searchParams.entries()], [["assigned", "mine"]]);
});

await prueba("pastilla: appsidebar ya no muestra la pastilla Esperando (se quito a pedido de Alex, ff348ec)", async () => {
  const barra = fs.readFileSync(path.join(raiz, "components/chats/appsidebar.tsx"), "utf8");
  // Se quito el boton "Esperando" de la barra; la vista espera=1 y su logica siguen.
  assert.ok(!barra.includes("{/* \"Esperando\": para todos"), "la pastilla Esperando volvio a la barra");
  assert.doesNotMatch(barra, /irAEsperando\(asignacionEsperando, !enEspera\)/);
  assert.match(barra, /La pastilla "Esperando" se quitó a pedido de Alex/);
  // Estando en Esperando: otro grupo cambia sin salir; el mismo grupo (la asesora, Mias) sale.
  assert.match(barra, /enEspera\s*\? irAEsperando\(valor, filtroMostrado !== valor\)/);
  // En Esperando no hay lista guardada abierta.
  assert.match(barra, /const listaActiva = enEspera \? null :/);
});

const fila = (id) => ({ id });
await prueba("vista: un chat que ya no espera sale sin pedir nada; uno nuevo pide /list UNA vez", async () => {
  const espera = { mine: 2, all: 3, chats: [
    { key: "agent:a", desde: hace(30), mia: true },
    { key: "agent:b", desde: hace(20), mia: false },
    { key: "official:c", desde: hace(5), mia: true },
  ] };
  // Recien cargada: lo que ya esperaba se da por conocido (lo trae el scroll), sin pedido.
  const conocidas = new Set(espera.chats.map((c) => c.key));
  let r = utils.sincronizarConEspera({ items: [fila("agent:a"), fila("agent:x")], espera, asignacion: "all", yaPedidas: conocidas });
  assert.deepEqual(r.items.map((i) => i.id), ["agent:a"], "agent:x ya no espera: sale");
  assert.equal(r.pedirLista, false);
  // Entra uno nuevo: se pide una vez.
  const conNuevo = { ...espera, all: 4, chats: [...espera.chats, { key: "agent:nuevo", desde: hace(1), mia: false }] };
  r = utils.sincronizarConEspera({ items: r.items, espera: conNuevo, asignacion: "all", yaPedidas: conocidas });
  assert.equal(r.pedirLista, true);
  assert.ok(r.faltan.includes("agent:nuevo"));
  // El ciclo siguiente, con el mismo /counts, ya no pide aunque /list no lo haya traido.
  const despues = new Set([...conocidas, ...r.faltan]);
  r = utils.sincronizarConEspera({ items: r.items, espera: conNuevo, asignacion: "all", yaPedidas: despues });
  assert.equal(r.pedirLista, false);
  // En Mias solo cuentan los de quien mira.
  r = utils.sincronizarConEspera({ items: [], espera: conNuevo, asignacion: "mine", yaPedidas: new Set() });
  assert.deepEqual(r.faltan.sort(), ["agent:a", "official:c"]);
  // Sin dato no se toca la lista.
  const items = [fila("agent:a")];
  r = utils.sincronizarConEspera({ items, espera: null, asignacion: "all", yaPedidas: new Set() });
  assert.equal(r.items, items);
  assert.equal(r.pedirLista, false);
  // Sin cambios devuelve el mismo arreglo (no re-dibuja).
  r = utils.sincronizarConEspera({ items, espera, asignacion: "all", yaPedidas: conocidas });
  assert.equal(r.items, items);
});

await prueba("vista: red abierta 3 minutos (3 /counts) sin chats nuevos = 0 /list; con uno nuevo = 1", async () => {
  const espera = { mine: 1, all: 1, chats: [{ key: "agent:a", desde: hace(30), mia: true }] };
  let conocidas = new Set(espera.chats.map((c) => c.key));
  let items = [fila("agent:a")];
  let pedidosDeLista = 0;
  const ciclo = (e) => {
    const r = utils.sincronizarConEspera({ items, espera: e, asignacion: "mine", yaPedidas: conocidas });
    conocidas = new Set([...conocidas, ...r.faltan]);
    items = r.items;
    if (r.pedirLista) pedidosDeLista += 1;
  };
  for (let minuto = 0; minuto < 3; minuto += 1) ciclo(espera);
  assert.equal(pedidosDeLista, 0);
  const conNuevo = { mine: 2, all: 2, chats: [...espera.chats, { key: "agent:b", desde: hace(0), mia: true }] };
  for (let minuto = 0; minuto < 3; minuto += 1) ciclo(conNuevo);
  assert.equal(pedidosDeLista, 1);
  // El realtime no pide /list en Esperando (lo decide /counts).
  const bandeja = fs.readFileSync(path.join(raiz, "components/chats/shared-inbox.tsx"), "utf8");
  assert.match(bandeja, /if \(!yaEstaEnLaLista && !esAvisoLocal && !ordenDelServidorRef\.current\) \{/);
});

await prueba("vista: el numero de la pastilla es igual a las filas al bajar hasta el final", async () => {
  const lista = Array.from({ length: 53 }, (_, i) => ({ key: `agent:c${String(i).padStart(2, "0")}`, desde: hace(100 - i), mia: i % 2 === 0 }));
  const espera = { mine: lista.filter((c) => c.mia).length, all: lista.length, chats: lista };
  for (const [asignacion, propias] of [["all", lista], ["mine", lista.filter((c) => c.mia)]]) {
    // Primera pagina de 20 (la pantalla) y despues de a 40 (el scroll), como /list.
    let { pagina, nextOffset, hasMore } = dominio.paginaDeEspera(propias, 0, 20);
    let filas = pagina.map((c) => fila(c.key));
    while (hasMore) {
      const offset = Math.min(nextOffset, filas.length);
      ({ pagina, nextOffset, hasMore } = dominio.paginaDeEspera(propias, offset, 40));
      filas = Array.from(new Map([...filas, ...pagina.map((c) => fila(c.key))].map((f) => [f.id, f])).values());
    }
    assert.equal(filas.length, utils.numeroDeEsperando(espera, asignacion), asignacion);
    assert.deepEqual(filas.map((f) => f.id), propias.map((c) => c.key), "en el orden del servidor");
  }
});

await prueba("vista: el orden del servidor no se toca (ordenar, insertar, tiempo real)", async () => {
  const a = { id: "agent:a", lastMessageAt: "2026-11-07T10:00:00.000Z" };
  const b = { id: "agent:b", lastMessageAt: "2026-11-07T12:00:00.000Z" };
  const orden = { ordenDelServidor: true };
  assert.deepEqual(utils.sortConversationItems([a, b], orden).map((i) => i.id), ["agent:a", "agent:b"]);
  assert.deepEqual(utils.sortConversationItems([a, b]).map((i) => i.id), ["agent:b", "agent:a"], "fuera de Esperando, por fecha");
  const nuevo = { id: "agent:z", lastMessageAt: "2026-11-07T13:00:00.000Z" };
  assert.deepEqual(utils.insertConversationItemByTimestamp([a, b], nuevo, orden).map((i) => i.id), ["agent:a", "agent:b"]);
  // Un mensaje en tiempo real de un chat que no esta no entra; el que esta se actualiza en su lugar.
  assert.deepEqual(utils.updateConversationItemInSortedList([a, b], "z", nuevo, orden).map((i) => i.id), ["agent:a", "agent:b"]);
  const aConMensaje = { ...a, lastMessageAt: "2026-11-07T14:00:00.000Z", lastMessage: "hola" };
  const tras = utils.updateConversationItemInSortedList([a, b], "a", aConMensaje, orden);
  assert.deepEqual(tras.map((i) => i.id), ["agent:a", "agent:b"]);
  assert.equal(tras[0].lastMessage, "hola");
  // Y fuera de Esperando sigue subiendo arriba.
  assert.deepEqual(utils.updateConversationItemInSortedList([b, a], "a", aConMensaje).map((i) => i.id), ["agent:a", "agent:b"]);
});

await prueba("vista: el refresco junta la pagina en su orden y lo cargado al bajar", async () => {
  const items = ["agent:a", "agent:b", "agent:c", "agent:d"].map(fila);
  const pagina = ["agent:b", "agent:a", "agent:n"].map(fila);
  assert.deepEqual(utils.juntarPaginaDeEsperando(items, pagina, true).map((i) => i.id), ["agent:b", "agent:a", "agent:n", "agent:c", "agent:d"]);
  // Si no hay mas, la lista es la pagina: lo que no vino ya no espera.
  assert.deepEqual(utils.juntarPaginaDeEsperando(items, pagina, false).map((i) => i.id), ["agent:b", "agent:a", "agent:n"]);
});

await prueba("vista: contestar desde la pantalla saca el chat en el acto y baja el numero", async () => {
  const T0 = T;
  const espera = { mine: 2, all: 3, chats: [
    { key: "agent:a", desde: hace(30), mia: true },
    { key: "agent:b", desde: hace(20), mia: true },
    { key: "agent:c", desde: hace(10), mia: false },
  ] };
  const contestadas = new Map([["agent:a", T0]]);
  const vigente = utils.esperaSinContestadas(espera, contestadas, T0 + 30_000, 180_000);
  assert.deepEqual(vigente.chats.map((c) => c.key), ["agent:b", "agent:c"]);
  assert.equal(vigente.mine, 1);
  assert.equal(vigente.all, 2);
  assert.equal(utils.numeroDeEsperando(vigente, "mine"), 1);
  // Si el cliente volvio a escribir despues de la respuesta, vuelve a esperar.
  const otraVez = { ...espera, chats: [{ key: "agent:a", desde: new Date(T0 + 60_000).toISOString(), mia: true }] };
  assert.equal(utils.esperaSinContestadas(otraVez, contestadas, T0 + 90_000, 180_000).chats.length, 1);
  // Pasada la vigencia manda /counts.
  assert.equal(utils.esperaSinContestadas(espera, contestadas, T0 + 200_000, 180_000).chats.length, 3);
  assert.equal(utils.esperaSinContestadas(null, contestadas, T0, 180_000), null);
  assert.equal(utils.esperaSinContestadas(espera, new Map(), T0, 180_000), espera);
  // Solo reacciona al resultado bueno del envio (texto, o foto/archivo/audio/ubicacion); no toca el envio.
  const bandeja = fs.readFileSync(path.join(raiz, "components/chats/shared-inbox.tsx"), "utf8");
  const fin = bandeja.slice(bandeja.indexOf("const finalizeOptimisticSend"), bandeja.indexOf("const handleEnvioTerminado"));
  assert.match(fin, /if \(result\?\.ok && !result\.suppressOptimistic\) \{[\s\S]*marcarContestadaEnEspera\(/);
  const terminado = bandeja.slice(bandeja.indexOf("const handleEnvioTerminado"), bandeja.indexOf("const textoEnCursoRef"));
  assert.match(terminado, /if \(envio\.tipo\) \{\s*marcarContestadaEnEspera\(conversationId\);/);
});

await prueba("bandeja: espera viaja en todos los /list (vista, refresco, scroll, fijados) y no en /counts", async () => {
  const bandeja = fs.readFileSync(path.join(raiz, "components/chats/shared-inbox.tsx"), "utf8");
  // armarParams (cambio de vista y refrescos), fijados y scroll.
  assert.equal((bandeja.match(/params\.set\("espera", "1"\)/g) ?? []).length, 3);
  const armar = bandeja.slice(bandeja.indexOf("const armarParams = () => {"), bandeja.indexOf("CAMBIO DE VISTA"));
  assert.match(armar, /if \(enEspera\) params\.set\("espera", "1"\);/);
  const conteos = bandeja.slice(bandeja.indexOf("const fetchCounts = async () => {"), bandeja.indexOf("const alCambiarVisibilidad"));
  assert.ok(!conteos.includes("espera\", \"1"), "/counts no lo necesita");
  // vistaDeLaUrl, claveDeVista y alCambiarVista conocen la vista.
  assert.match(bandeja, /espera: leerEspera\(\(clave\) => params\.get\(clave\)\)/);
  assert.match(bandeja, /espera \? "espera" : ""\]\.join\("::"\)/);
  assert.match(bandeja, /espera: esperaDestino,\s*\} = vistaDeLaUrl\(destino\.searchParams/);
  // Si /list responde esperaNoDisponible se vuelve a Mias o Todas.
  assert.ok((bandeja.match(/esperaNoDisponible\) \{\s*(setVistaEnCurso\(false\);\s*)?salirDeEsperando\(\);/g) ?? []).length >= 2);
  assert.ok((bandeja.match(/payload\?\.ok && payload\.esperaNoDisponible/g) ?? []).length >= 2);
  assert.match(bandeja, /url\.searchParams\.delete\("espera"\);\s*window\.history\.replaceState/);
});

await prueba("apertura: vista inicial (parte 2) con la direccion como verdad", async () => {
  const leer = (q) => (clave) => new URLSearchParams(q).get(clave);
  // Asesora sin nada en la direccion y con chats esperando: Mias + Esperando (redirect).
  assert.deepEqual(dominio.vistaInicialDeLaBandeja({ leer: leer(""), veTodas: false, esperandoMios: 3 }), { origen: "defecto", assigned: "mine", espera: true });
  // Sin chats esperando o sin dato: Mias como siempre.
  assert.equal(dominio.vistaInicialDeLaBandeja({ leer: leer(""), veTodas: false, esperandoMios: 0 }).espera, false);
  assert.equal(dominio.vistaInicialDeLaBandeja({ leer: leer(""), veTodas: false, esperandoMios: null }).espera, false);
  // Tocar Mias deja assigned=mine y se respeta; entrar con chatKey o con espera=1 tambien.
  for (const q of ["assigned=mine", "chatKey=agent%3Aa1", "assigned=mine&espera=1", "chatKey=agent%3Aa1&espera=1"]) {
    assert.equal(dominio.vistaInicialDeLaBandeja({ leer: leer(q), veTodas: false, esperandoMios: 5 }).origen, "direccion", q);
  }
  // La linea sola no elige vista (se conserva en el redirect).
  assert.equal(dominio.vistaInicialDeLaBandeja({ leer: leer("connection=channel%3Ac1"), veTodas: false, esperandoMios: 1 }).origen, "defecto");
});

await prueba("apertura: page.tsx redirige a Mias + Esperando, no lee la espera para jefes y si falla, Mias", async () => {
  const pagina = fs.readFileSync(path.join(raiz, "app/cliente/chats/page.tsx"), "utf8");
  const apertura = pagina.slice(pagina.indexOf("const veTodasLaBandeja"), pagina.indexOf("let paginaDeEsperando"));
  // Dueño, admin, supervisora y monitora: ni se entra al bloque (no se lee la espera).
  assert.match(apertura, /const veTodasLaBandeja = isManager \|\| modoMonitoreo;/);
  assert.match(apertura, /if \(!veTodasLaBandeja && vistaInicialDeLaBandeja\(/);
  // La lectura va en try/catch: si falla, esperandoMios queda null = Mias, sin error.
  assert.match(apertura, /try \{\s*esperandoMios = \(await leerListaDeEspera\("mine"\)\)\.length;\s*\} catch/);
  assert.match(apertura, /\["assigned", "mine"\],\s*\["espera", "1"\],/);
  assert.match(apertura, /redirect\(/);
  // El redirect no queda dentro del try (si no, el catch se lo tragaria).
  const enElTry = apertura.slice(apertura.indexOf("try {"), apertura.indexOf("} catch"));
  assert.ok(!enElTry.includes("redirect("));
});

await prueba("servidor: con espera=1 la primera lista sale del mismo servicio y orden que /list", async () => {
  const pagina = fs.readFileSync(path.join(raiz, "app/cliente/chats/page.tsx"), "utf8");
  assert.match(pagina, /listaDeEsperaDeLaBandeja\(\{/);
  assert.match(pagina, /paginaDeEspera\(\s*await leerListaDeEspera\(assignedFilter\),\s*0,\s*conversationListTake,\s*\)/);
  assert.match(pagina, /ordenarSegunEspera\(mergedPorFecha, paginaDeEsperando\.claves\)/);
  assert.match(pagina, /\{ id: \{ in: idsEsperandoDe\("agent:"\) \} \}/);
  assert.match(pagina, /soloIds: idsEsperandoDe\("official:"\)/);
  assert.match(pagina, /initialConversationOffset=\{paginaDeEsperando \? paginaDeEsperando\.nextOffset/);
  // Quien mira: lo mismo que responderEsperando en /list.
  const ruta = fs.readFileSync(path.join(raiz, "app/api/cliente/chats/list/route.ts"), "utf8");
  assert.match(ruta, /soloMios: !input\.isManager/);
  assert.match(pagina, /soloMios: !isManager/);
  assert.match(pagina, /const monitoreadosDeLaEspera = isManager \? \[\] : canalesMonitoreados;/);
});

await db.close();
console.log(`\n${pruebas} pruebas ok`);
process.exit(0);
