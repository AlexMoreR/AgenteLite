/**
 * Prueba de la migración de índices de velocidad (prisma/migrations/20261111000000_indices_de_velocidad) y de
 * las consultas que la usan, contra un Postgres embebido (PGlite), sin tocar ninguna base real ni mandar nada:
 *   node scripts/check-indices-de-velocidad.mjs
 *
 * 1. Aplica TODAS las migraciones en orden, y la nueva otra vez (IF NOT EXISTS: no falla). Solo agrega índices.
 * 2. Acuses de WAHA: `buscarMensajePorIdCrudo` (el código real, con la base de prueba) da el MISMO mensaje que
 *    la consulta de antes (id exacto o `endsWith('_' + crudo)`, el más nuevo, acotado a la línea), y usa el índice.
 * 3. Kanban: la consulta nueva (los últimos 6 por chat, en la base) arma el mismo transcript que la de antes
 *    (todos los mensajes y el recorte en JS).
 * 4. Tareas de Mi día: con el filtro por workspace salen las mismas tareas que sin él, con dos negocios.
 * 5. Audios pendientes, archivo ya transcrito y seguimientos que vencen: cada consulta usa su índice.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

const CARPETA = path.join(RAIZ, "prisma", "migrations");
const NUEVA = "20261111000000_indices_de_velocidad";
// Sin los \r de Windows: las comparaciones de texto son por líneas.
const leerArchivo = (relativo) => fs.readFileSync(path.join(RAIZ, relativo), "utf8").replace(/\r\n/g, "\n");
const leerMigracion = (nombre) => fs.readFileSync(path.join(CARPETA, nombre, "migration.sql"), "utf8").replace(/\r\n/g, "\n");

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

/* ── Un Prisma.sql de juguete: arma el texto con $1, $2... como lo hace Prisma ── */
class Sql {
  constructor(partes, valores) {
    this.partes = [partes[0]];
    this.valores = [];
    valores.forEach((valor, i) => {
      if (valor instanceof Sql) {
        this.partes[this.partes.length - 1] += valor.partes[0];
        valor.valores.forEach((v, j) => {
          this.valores.push(v);
          this.partes.push(valor.partes[j + 1]);
        });
        this.partes[this.partes.length - 1] += partes[i + 1];
      } else {
        this.valores.push(valor);
        this.partes.push(partes[i + 1]);
      }
    });
  }
  get texto() {
    return this.partes.reduce((acc, parte, i) => (i === 0 ? parte : `${acc}$${i}${parte}`), "");
  }
}
const Prisma = {
  sql: (partes, ...valores) => new Sql(partes, valores),
  empty: new Sql([""], []),
  join: (lista, sep = ", ") => new Sql(["", ...lista.slice(1).map(() => sep), ""], lista),
};

const db = new PGlite();
const filas = async (sql, valores = []) => (await db.query(sql, valores)).rows;
const consultas = [];
const prismaDePrueba = {
  $queryRaw: async (sql, ...resto) => {
    const objeto = sql instanceof Sql ? sql : Prisma.sql(sql, ...resto);
    consultas.push(objeto.texto);
    return filas(objeto.texto, objeto.valores);
  },
};
const mocks = { "@/lib/prisma": { prisma: prismaDePrueba }, "@prisma/client": { Prisma } };

/* ── 1. Migraciones ── */
const migraciones = fs
  .readdirSync(CARPETA, { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(path.join(CARPETA, e.name, "migration.sql")))
  .map((e) => e.name)
  .sort();
assert.ok(migraciones.includes(NUEVA), `falta la migración ${NUEVA}`);
for (const nombre of migraciones) {
  try {
    await db.exec(leerMigracion(nombre));
  } catch (fallo) {
    throw new Error(`La migración ${nombre} falló en PGlite: ${fallo.message}`);
  }
}

const INDICES = {
  Message_channel_idCrudo_idx: "Message",
  Message_audio_pendiente_idx: "Message",
  Message_mediaUrl_transcrita_idx: "Message",
  EmbudoEvento_conversationId_tipo_createdAt_idx: "EmbudoEvento",
  Follow_pendiente_executeAt_idx: "Follow",
};

await prueba("la migración solo crea índices (IF NOT EXISTS), en una transacción, sin borrar nada", () => {
  const sql = leerMigracion(NUEVA);
  assert.match(sql, /^BEGIN;$/m);
  assert.match(sql, /^COMMIT;$/m);
  assert.doesNotMatch(sql, /\b(DROP|DELETE|TRUNCATE|UPDATE|INSERT|ALTER)\b/i);
  assert.doesNotMatch(sql, /CONCURRENTLY/i, "CONCURRENTLY no corre dentro de una transacción");
  const sentencias = sql.replace(/--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean);
  for (const s of sentencias) {
    if (s === "BEGIN" || s === "COMMIT") continue;
    assert.match(s, /^CREATE INDEX IF NOT EXISTS "/, s);
  }
  assert.equal(sentencias.length, Object.keys(INDICES).length + 2);
  assert.doesNotMatch(sql, /CallAttempt/, "CallAttempt no tiene migración en el repo");
});

await prueba("se puede volver a aplicar sin fallar y deja los 5 índices, sin tocar los que había", async () => {
  const antes = await filas(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1`);
  await db.exec(leerMigracion(NUEVA));
  const despues = await filas(`SELECT indexname, tablename FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1`);
  assert.deepEqual(despues.map((f) => f.indexname), antes.map((f) => f.indexname));
  for (const [indice, tabla] of Object.entries(INDICES)) {
    assert.ok(despues.some((f) => f.indexname === indice && f.tablename === tabla), `falta ${indice}`);
  }
  assert.ok(despues.some((f) => f.indexname === "EmbudoEvento_conversationId_createdAt_idx"), "el índice viejo se queda");
});

await prueba("schema.prisma declara el índice nuevo de EmbudoEvento (sin desvío para prisma migrate)", () => {
  const schema = leerArchivo("prisma/schema.prisma");
  const modelo = schema.slice(schema.indexOf("model EmbudoEvento {"));
  const cuerpo = modelo.slice(0, modelo.indexOf("\n}"));
  assert.match(cuerpo, /@@index\(\[conversationId, tipo, createdAt\]\)/);
  assert.match(cuerpo, /@@index\(\[conversationId, createdAt\]\)/);
});

/* ── Datos: sin las llaves foráneas (solo se prueban consultas) y con relleno para las columnas obligatorias ── */
await db.exec(`SET session_replication_role = replica;`);
const columnasCache = new Map();
async function insertar(tabla, valores) {
  if (!columnasCache.has(tabla)) {
    columnasCache.set(
      tabla,
      await filas(
        `SELECT c.column_name, c.data_type, c.udt_name, c.is_nullable, c.column_default
           FROM information_schema.columns c WHERE c.table_name = $1`,
        [tabla],
      ),
    );
  }
  const completo = { ...valores };
  for (const col of columnasCache.get(tabla)) {
    if (col.column_name in completo || col.is_nullable === "YES" || col.column_default !== null) continue;
    if (col.data_type === "USER-DEFINED") {
      const [primero] = await filas(
        `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = $1 ORDER BY e.enumsortorder LIMIT 1`,
        [col.udt_name],
      );
      completo[col.column_name] = primero.enumlabel;
    } else if (col.data_type.startsWith("timestamp")) completo[col.column_name] = new Date("2026-11-01T00:00:00Z");
    else if (col.data_type === "boolean") completo[col.column_name] = false;
    else if (["integer", "bigint", "double precision", "numeric", "smallint", "real"].includes(col.data_type)) completo[col.column_name] = 0;
    else if (col.data_type === "jsonb" || col.data_type === "json") completo[col.column_name] = {};
    else if (col.data_type === "ARRAY") completo[col.column_name] = [];
    else completo[col.column_name] = `x-${Math.random().toString(36).slice(2)}`;
  }
  const nombres = Object.keys(completo);
  const tipos = new Map(columnasCache.get(tabla).map((c) => [c.column_name, c]));
  const marcas = nombres.map((n, i) => {
    const col = tipos.get(n);
    if (col?.data_type === "USER-DEFINED") return `$${i + 1}::"${col.udt_name}"`;
    if (col?.data_type === "jsonb") return `$${i + 1}::jsonb`;
    return `$${i + 1}`;
  });
  const valoresSql = nombres.map((n) => {
    const v = completo[n];
    return tipos.get(n)?.data_type === "jsonb" && v !== null ? JSON.stringify(v) : v;
  });
  await db.query(
    `INSERT INTO "${tabla}" (${nombres.map((n) => `"${n}"`).join(", ")}) VALUES (${marcas.join(", ")})`,
    valoresSql,
  );
}
const T0 = new Date("2026-11-10T12:00:00Z").getTime();
const en = (min) => new Date(T0 + min * 60_000);
let siguiente = 0;
const mensaje = (datos) =>
  insertar("Message", { id: `m${String(++siguiente).padStart(4, "0")}`, workspaceId: "ws1", conversationId: "c1", direction: "INBOUND", ...datos });

/* ── 2. Acuses de WAHA ── */
const ACUSE = [
  // [id, línea, externalId, minuto]
  ["a1", "ch1", "true_573001112233@c.us_3EB0AAAA11112222", 1],
  ["a2", "ch1", "false_37898875334784@lid_3EB0BBBB33334444", 2],
  ["a3", "ch1", "3EB0CCCC55556666", 3],
  ["a4", "ch1", "true_573001112233@c.us_SHORT1", 4],
  ["a5", "ch1", "true_1234@c.us_3EB0AAAA11112222", 5], // mismo crudo que a1, más nuevo
  ["a6", "ch2", "false_37898875334784@lid_3EB0BBBB33334444", 6], // el mismo id en otra línea
  ["a7", "ch1", "wamid.HBgMNTczMDAxMTEyMjMzFQIAERgSM0VCMA", 7],
  ["a8", "ch1", null, 8],
  ["a9", "ch1", "x_y_z_3EB0EEEE77778888", 9],
];
for (const [id, channelId, externalId, minuto] of ACUSE) {
  await insertar("Message", { id, workspaceId: "ws1", conversationId: `conv-${channelId}`, channelId, externalId, direction: "OUTBOUND", createdAt: en(minuto) });
}
// Relleno para que el índice tenga sentido frente a un recorrido.
for (let i = 0; i < 300; i += 1) {
  await insertar("Message", { id: `r${i}`, workspaceId: "ws1", conversationId: "conv-r", channelId: i % 2 ? "ch1" : "ch3", externalId: `true_57300${i}@c.us_3EB0${String(i).padStart(12, "0")}`, direction: "INBOUND", createdAt: en(-i) });
}
await db.exec(`ANALYZE "Message";`);

const { buscarMensajePorIdCrudo } = cargar("src/lib/mensaje-por-id-crudo.ts", mocks);
const { idCrudoDeMensaje } = cargar("src/lib/waha.ts", mocks);

/** La consulta de ANTES (Prisma: `OR [externalId = id, externalId endsWith '_' + crudo]`, el más nuevo). */
async function comoAntes(channelId, idMensaje, { comodinSinEscapar = false } = {}) {
  const crudo = idCrudoDeMensaje(idMensaje);
  const patron = comodinSinEscapar ? `'%_' || $3` : `'%\\_' || $3`;
  const [fila] = await filas(
    `SELECT "id" FROM "Message"
      WHERE "channelId" = $1 AND ("externalId" = $2 OR ($4::boolean AND "externalId" LIKE ${patron}))
      ORDER BY "createdAt" DESC LIMIT 1`,
    [channelId, idMensaje, crudo, crudo.length >= 8],
  );
  return fila?.id ?? null;
}

const PEDIDOS = [
  ["ch1", "true_37898875334784@lid_3EB0AAAA11112222"], // acuse con el LID: el más nuevo de los dos
  ["ch1", "true_573001112233@c.us_3EB0AAAA11112222"], // el exacto existe, pero hay uno más nuevo con el mismo crudo
  ["ch1", "true_573001112233@c.us_3EB0BBBB33334444"],
  ["ch2", "true_573001112233@c.us_3EB0BBBB33334444"],
  ["ch3", "true_573001112233@c.us_3EB0BBBB33334444"],
  ["ch1", "3EB0CCCC55556666"], // sin "_": solo el exacto
  ["ch1", "true_573001112233@c.us_3EB0CCCC55556666"], // el guardado no tiene "_" antes: antes tampoco coincidía
  ["ch1", "true_9@c.us_SHORT1"], // crudo corto: solo el exacto, y no está
  ["ch1", "true_573001112233@c.us_SHORT1"], // crudo corto, exacto
  ["ch1", "wamid.HBgMNTczMDAxMTEyMjMzFQIAERgSM0VCMA"],
  ["ch1", "true_1@lid_3EB0EEEE77778888"],
  ["ch1", "nada_ZZZZZZZZZZZZ"],
  ["ch1", "true_57300151@c.us_3EB0000000000151"],
  ["ch1", "true_1@lid_3EB0000000000150"], // es de ch3
  ["ch1", ""],
  ["ch9", "true_1@lid_3EB0AAAA11112222"],
];

await prueba("acuses: el mensaje que encuentra es el mismo que con la consulta de antes, en todos los casos", async () => {
  for (const [canal, id] of PEDIDOS) {
    const nuevo = await buscarMensajePorIdCrudo(canal, id);
    assert.equal(nuevo?.id ?? null, await comoAntes(canal, id), `${canal} ${id}`);
    // Con ids reales tampoco cambia aunque el "_" de Prisma hubiera actuado como comodín de LIKE.
    assert.equal(nuevo?.id ?? null, await comoAntes(canal, id, { comodinSinEscapar: true }), `${canal} ${id} (comodín)`);
  }
  assert.equal((await buscarMensajePorIdCrudo("ch1", PEDIDOS[0][1]))?.id, "a5");
  assert.equal((await buscarMensajePorIdCrudo("ch2", PEDIDOS[3][1]))?.id, "a6");
});

await prueba("acuses: devuelve lo que usan los tres sitios del webhook (estado, negocio, chat, texto, borrado)", async () => {
  const m = await buscarMensajePorIdCrudo("ch1", "true_1@lid_3EB0BBBB33334444");
  assert.deepEqual(Object.keys(m).sort(), ["content", "conversationId", "deletedAt", "id", "status", "workspaceId"]);
  assert.equal(m.conversationId, "conv-ch1");
  assert.equal(typeof m.status, "string");
});

await prueba("acuses: la consulta usa Message_channel_idCrudo_idx (y la expresión es la del índice)", async () => {
  const fuente = leerArchivo("src/lib/mensaje-por-id-crudo.ts");
  assert.ok(fuente.includes(`reverse(split_part(reverse(m."externalId"), '_', 1))`));
  assert.ok(leerMigracion(NUEVA).includes(`reverse(split_part(reverse("externalId"), '_', 1))`));
  consultas.length = 0;
  await buscarMensajePorIdCrudo("ch1", "true_1@lid_3EB0BBBB33334444");
  const [texto] = consultas;
  await db.exec(`SET enable_seqscan = off;`);
  const plan = await filas(`EXPLAIN ${texto}`, ["ch1", "true_1@lid_3EB0BBBB33334444", "3EB0BBBB33334444"]);
  await db.exec(`SET enable_seqscan = on;`);
  const textoDelPlan = plan.map((f) => f["QUERY PLAN"]).join("\n");
  assert.match(textoDelPlan, /Message_channel_idCrudo_idx/, textoDelPlan);
});

await prueba("acuses: el webhook ya no busca con JOIN a la línea ni con endsWith", () => {
  const ruta = leerArchivo("src/app/api/webhooks/waha/route.ts");
  assert.doesNotMatch(ruta, /externalId:\s*\{\s*endsWith/);
  assert.doesNotMatch(ruta, /channel:\s*\{\s*evolutionInstanceName/);
  assert.equal(ruta.match(/buscarMensajePorIdCrudo\(/g)?.length, 3);
});

/* ── 3. Kanban ── */
const KANBAN = ["k1", "k2", "k3", "k4"];
for (const conv of KANBAN.slice(0, 3)) {
  for (let i = 0; i < 20; i += 1) {
    await mensaje({
      conversationId: conv,
      direction: i % 3 ? "INBOUND" : "OUTBOUND",
      type: i % 7 === 0 ? "SYSTEM" : "TEXT",
      content: i % 5 === 0 ? null : `  ${conv} mensaje ${i}  `,
      // k2 tiene dos mensajes en el mismo instante: desempata el id, como antes.
      createdAt: en(conv === "k2" && i === 19 ? 18 : i),
    });
  }
}
await mensaje({ conversationId: "k3", content: "", createdAt: en(30) });

function armarTranscripts(mensajes, cuantos) {
  const porChat = new Map();
  for (const m of mensajes) {
    const lista = porChat.get(m.conversationId) ?? [];
    if (lista.length < cuantos) {
      lista.push(m);
      porChat.set(m.conversationId, lista);
    }
  }
  const salida = new Map();
  for (const [id, lista] of porChat) {
    const texto = lista.slice().reverse().map((m) => `${m.direction === "INBOUND" ? "Cliente" : "Bot"}: ${m.content.trim()}`).join(" · ");
    if (texto) salida.set(id, texto);
  }
  return salida;
}

await prueba("Kanban: los últimos 6 por chat salen en la base y el transcript es idéntico al de antes", async () => {
  const fuente = leerArchivo("src/features/crm/services/getCrmData.ts");
  const cuantos = Number(fuente.match(/const TRANSCRIPT_MESSAGE_COUNT = (\d+);/)[1]);
  const plantilla = fuente.match(/>\(Prisma\.sql`([\s\S]*?)`\);/)[1];
  assert.match(plantilla, /CROSS JOIN LATERAL/);
  const textoNuevo = plantilla
    .replace("${[...new Set(conversationIds)]}", "$1")
    .replace("${TRANSCRIPT_MESSAGE_COUNT}", "$2");
  assert.doesNotMatch(textoNuevo, /\$\{/, textoNuevo);
  const nuevos = await filas(textoNuevo, [KANBAN, cuantos]);
  assert.ok(nuevos.length <= KANBAN.length * cuantos);

  // Antes: TODOS los mensajes de esos chats, del más nuevo al más viejo, y el recorte en JS.
  const todos = await filas(
    `SELECT "conversationId", "content", "direction"::text AS "direction" FROM "Message"
      WHERE "conversationId" = ANY($1::text[]) AND "type" <> 'SYSTEM' AND "content" IS NOT NULL
      ORDER BY "createdAt" DESC, "id" DESC`,
    [KANBAN],
  );
  assert.ok(todos.length > nuevos.length);
  const antes = armarTranscripts(todos, cuantos);
  const ahora = armarTranscripts(nuevos, cuantos);
  assert.deepEqual([...ahora.entries()], [...antes.entries()]);
  assert.equal(ahora.size, 3);
});

/* ── 4. Tareas de Mi día ── */
for (const ws of ["ws1", "ws2"]) {
  await insertar("User", { id: `u-${ws}`, email: `${ws}@x.co`, name: `Asesora ${ws}` });
  for (let i = 0; i < 6; i += 1) {
    const conv = `t-${ws}-${i}`;
    await insertar("Contact", { id: `ct-${conv}`, workspaceId: ws, phoneNumber: `57300${i}`, name: `Cliente ${i}`, crmStage: "NUEVO" });
    await insertar("Conversation", { id: conv, workspaceId: ws, contactId: `ct-${conv}`, assignedToUserId: `u-${ws}`, status: "OPEN" });
    await insertar("EmbudoLead", {
      conversationId: conv,
      contactId: `ct-${conv}`,
      workspaceId: ws,
      channelId: "ch1",
      accion: "tarea_asesora",
      exterior: false,
      accionEn: en(0),
      tareaPrioridad: "A",
      tareaVence: en(60),
      accionDatos: { modo: "activo", motivo: "silencio" },
    });
    // 0: sin mensajes. 1: la asesora le escribió después (hecha). 2: le escribió antes. 3: salió un seguimiento
    // automático después. 4: la asesora le escribió después, pero a otro chat. 5: recibió del cliente.
    const datos = [
      null,
      { direction: "OUTBOUND", rawPayload: { source: "manual" }, createdAt: en(10) },
      { direction: "OUTBOUND", rawPayload: { source: "instance" }, createdAt: en(-10) },
      { direction: "OUTBOUND", rawPayload: { source: "follow" }, createdAt: en(10) },
      { direction: "OUTBOUND", rawPayload: { source: "manual" }, createdAt: en(10), conversationId: `otro-${ws}` },
      { direction: "INBOUND", rawPayload: { source: "manual" }, createdAt: en(10) },
    ][i];
    if (datos) await mensaje({ conversationId: conv, workspaceId: ws, ...datos });
  }
}

function cargarTareas(fuente) {
  const ts = createRequire(path.join(RAIZ, "package.json"))("typescript");
  const salida = ts.transpileModule(fuente, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const mod = { exports: {} };
  const requerir = (pedido) => {
    if (pedido === "./config") return { leerConfigSeguimiento: async () => null };
    if (pedido === "./reactivacion") return { corteDeLaConfig: () => null, filtroSinReactivar: () => Prisma.empty };
    if (pedido === "@/lib/chat-resuelto-sql") return cargar("src/lib/chat-resuelto-sql.ts", mocks);
    return mocks[pedido];
  };
  new Function("exports", "require", "module", salida.outputText)(mod.exports, requerir, mod);
  return mod.exports;
}

await prueba("tareas de Mi día: con el filtro por negocio salen exactamente las mismas que sin él", async () => {
  const fuente = leerArchivo("src/features/seguimiento-inteligente/servicios/tareas.ts");
  const linea = `          WHERE m."workspaceId" = \${input.workspaceId}\n            AND m."conversationId"`;
  assert.ok(fuente.includes(linea), "falta el filtro por workspace en el NOT EXISTS");
  const vieja = fuente.replace(linea, `          WHERE m."conversationId"`);
  const nuevo = cargarTareas(fuente);
  const antes = cargarTareas(vieja);
  for (const ws of ["ws1", "ws2"]) {
    // Ordenadas por chat: entre empates de prioridad y vencimiento la base no promete un orden.
    const porChat = (lista) => [...lista].sort((a, b) => a.conversationId.localeCompare(b.conversationId));
    const ahora = porChat(await nuevo.leerTareasDeAsesora(ws, `u-${ws}`, en(0)));
    const previas = porChat(await antes.leerTareasDeAsesora(ws, `u-${ws}`, en(0)));
    assert.deepEqual(ahora, previas, ws);
    assert.deepEqual(ahora.map((t) => t.conversationId).sort(), [0, 2, 3, 4, 5].map((i) => `t-${ws}-${i}`));
  }
});

/* ── 5. Los otros índices ── */
async function planDe(sql, valores) {
  await db.exec(`SET enable_seqscan = off;`);
  const plan = await filas(`EXPLAIN ${sql}`, valores);
  await db.exec(`SET enable_seqscan = on;`);
  return plan.map((f) => f["QUERY PLAN"]).join("\n");
}

await prueba("audios pendientes: la vuelta del reloj usa Message_audio_pendiente_idx", async () => {
  for (let i = 0; i < 5; i += 1) {
    await mensaje({ type: "AUDIO", mediaUrl: `https://x/a${i}.ogg`, createdAt: en(i), transcritoEn: i % 2 ? en(i) : null, transcripcion: i % 2 ? "hola" : null });
  }
  await db.exec(`ANALYZE "Message";`);
  const fuente = leerArchivo("src/lib/transcripcion-de-audios.ts");
  for (const condicion of [`"type" = 'AUDIO'`, `"transcritoEn" IS NULL`, `"deletedAt" IS NULL`, `"mediaUrl" IS NOT NULL`]) {
    assert.ok(fuente.includes(condicion), `la consulta del reloj ya no tiene ${condicion}`);
  }
  const plan = await planDe(
    `SELECT "id" FROM "Message" WHERE "type" = 'AUDIO' AND "transcritoEn" IS NULL AND "deletedAt" IS NULL
       AND "mediaUrl" IS NOT NULL AND "createdAt" >= $1 ORDER BY "createdAt" DESC LIMIT 15 FOR UPDATE SKIP LOCKED`,
    [en(-60 * 24 * 7)],
  );
  assert.match(plan, /Message_audio_pendiente_idx/, plan);
});

await prueba("audio ya transcrito: la búsqueda por archivo usa Message_mediaUrl_transcrita_idx", async () => {
  const plan = await planDe(
    `SELECT "transcripcion" FROM "Message" WHERE "mediaUrl" = $1 AND "transcripcion" IS NOT NULL AND "id" <> $2 LIMIT 1`,
    ["https://x/a1.ogg", "m0001"],
  );
  assert.match(plan, /Message_mediaUrl_transcrita_idx/, plan);
});

await prueba("seguimientos que vencen (todos los negocios): el reclamo usa Follow_pendiente_executeAt_idx", async () => {
  for (let i = 0; i < 50; i += 1) {
    await insertar("Follow", { id: `f${i}`, workspaceId: `ws${i % 3}`, contactId: "ct", executeAt: en(i - 25), status: i % 4 ? "EXECUTED" : "PENDING" });
  }
  await db.exec(`ANALYZE "Follow";`);
  const plan = await planDe(
    `SELECT f."id" FROM public."Follow" f WHERE f."status" = 'PENDING' AND f."executeAt" <= $1
       AND (f."lockedAt" IS NULL OR f."lockedAt" < $2)
     ORDER BY f."executeAt" ASC, f."createdAt" ASC LIMIT 50 FOR UPDATE SKIP LOCKED`,
    [en(0), en(-10)],
  );
  assert.match(plan, /Follow_pendiente_executeAt_idx/, plan);
});

await prueba("eventos del embudo por chat y tipo: hay un índice que cubre (conversationId, tipo, createdAt)", async () => {
  const [fila] = await filas(`SELECT indexdef FROM pg_indexes WHERE indexname = 'EmbudoEvento_conversationId_tipo_createdAt_idx'`);
  assert.match(fila.indexdef, /\("conversationId", tipo, "createdAt"\)/);
});

await db.close();
console.log(`\n${pruebas} pruebas de los índices de velocidad: todas pasaron.`);
