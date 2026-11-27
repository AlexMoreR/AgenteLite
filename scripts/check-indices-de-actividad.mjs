/**
 * Prueba de los índices de actividad de Message y de las consultas que los usan, contra un Postgres embebido
 * (PGlite), sin tocar ninguna base real ni mandar nada:
 *   node scripts/check-indices-de-actividad.mjs
 *
 * Los índices son los de 20261125000000_indices_ultima_accion (Message_ultima_accion_enviado_idx y
 * Message_ultima_accion_actor_idx: la "última acción" de Equipo) y 20261126000000_indice_message_no_leido
 * (Message_no_leido_idx: los no leídos de la bandeja). En producción se crean a mano con
 * scripts/sql/indices-de-actividad-a-mano.sql (CONCURRENTLY, sin trabar escrituras).
 *
 * (a) Formato: las migraciones solo crean índices con IF NOT EXISTS, sin borrar ni cambiar nada.
 * (b) Se puede volver a aplicar: correrlas otra vez no falla y no agrega ni quita índices.
 * (c) Mismos resultados: `ultimaAccionPorPersona` (unnest + LATERAL, el código real) da el mismo Map que la
 *     consulta vieja con DISTINCT ON, con 2 negocios, varias personas, notas de otros kind, mensajes de hace
 *     más de 30 días y mensajes entrantes.
 * (d) Usa el índice: con enable_seqscan = off, el plan de las dos consultas de mensajes nombra
 *     Message_ultima_accion_enviado_idx y Message_ultima_accion_actor_idx, y el de sqlIdsNoLeidos
 *     Message_no_leido_idx.
 * (e) El archivo a mano coincide: cada sentencia es la de su migración, solo con CONCURRENTLY.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { abrirBaseDePruebas } from "./lib/base-de-pruebas.mjs";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

const CARPETA = path.join(RAIZ, "prisma", "migrations");
const MIGRACIONES_DE_ACTIVIDAD = ["20261125000000_indices_ultima_accion", "20261126000000_indice_message_no_leido"];
const A_MANO = "scripts/sql/indices-de-actividad-a-mano.sql";
const INDICES = ["Message_ultima_accion_enviado_idx", "Message_ultima_accion_actor_idx", "Message_no_leido_idx"];

// Sin los \r de Windows: las comparaciones de texto son por líneas.
const leerArchivo = (relativo) => fs.readFileSync(path.join(RAIZ, relativo), "utf8").replace(/\r\n/g, "\n");
const leerMigracion = (nombre) => fs.readFileSync(path.join(CARPETA, nombre, "migration.sql"), "utf8").replace(/\r\n/g, "\n");
/** Las sentencias de un archivo SQL, sin comentarios y con los espacios juntados. */
const sentenciasDe = (sql) =>
  sql
    .replace(/--.*$/gm, "")
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);

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

const db = await abrirBaseDePruebas();
const filas = async (sql, valores = []) => (await db.query(sql, valores)).rows;

/* ── Migraciones: todas en orden ── */
const migraciones = fs
  .readdirSync(CARPETA, { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(path.join(CARPETA, e.name, "migration.sql")))
  .map((e) => e.name)
  .sort();
for (const nombre of MIGRACIONES_DE_ACTIVIDAD) assert.ok(migraciones.includes(nombre), `falta la migración ${nombre}`);
for (const nombre of migraciones) {
  try {
    await db.exec(leerMigracion(nombre));
  } catch (fallo) {
    throw new Error(`La migración ${nombre} falló en PGlite: ${fallo.message}`);
  }
}

/* ── (a) Formato ── */
await prueba("(a) formato: las migraciones solo crean los 3 índices (IF NOT EXISTS), sin borrar ni cambiar nada", () => {
  const nombres = [];
  for (const nombre of MIGRACIONES_DE_ACTIVIDAD) {
    const sql = leerMigracion(nombre);
    assert.doesNotMatch(sql.replace(/--.*$/gm, ""), /\b(DROP|DELETE|TRUNCATE|UPDATE|INSERT|ALTER|RENAME)\b/i, nombre);
    assert.doesNotMatch(sql.replace(/--.*$/gm, ""), /CONCURRENTLY/i, `${nombre}: CONCURRENTLY no va en la migración (es del archivo a mano)`);
    for (const s of sentenciasDe(sql)) {
      if (s === "BEGIN" || s === "COMMIT") continue;
      const nombreDelIndice = s.match(/^CREATE INDEX IF NOT EXISTS "([^"]+)" ON "Message" /)?.[1];
      assert.ok(nombreDelIndice, `${nombre}: sentencia que no es CREATE INDEX IF NOT EXISTS: ${s}`);
      nombres.push(nombreDelIndice);
    }
  }
  assert.deepEqual(nombres.sort(), [...INDICES].sort());
});

/* ── (b) Se puede volver a aplicar ── */
await prueba("(b) se puede volver a aplicar: otra vez no falla y deja los mismos índices", async () => {
  const listar = async () => (await filas(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1`)).map((f) => f.indexname);
  const antes = await listar();
  for (const nombre of MIGRACIONES_DE_ACTIVIDAD) await db.exec(leerMigracion(nombre));
  const despues = await listar();
  assert.deepEqual(despues, antes);
  for (const indice of INDICES) assert.ok(despues.includes(indice), `falta ${indice}`);
});

/* ── Datos: sin las llaves foráneas (solo se prueban consultas) y con relleno para las columnas obligatorias ── */
await db.exec(`SET session_replication_role = replica;`);
// CallAttempt no tiene migración en el repo: se crea aquí solo con lo que lee la consulta de llamadas.
await db.exec(`CREATE TABLE IF NOT EXISTS "CallAttempt" (
  "id" text PRIMARY KEY, "workspaceId" text NOT NULL, "contactId" text NOT NULL,
  "calledByUserId" text, "calledAt" timestamp(3) NOT NULL
);`);
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

// Fechas relativas a hoy: la función usa sus 30 días por defecto. Cada mensaje en un minuto distinto, para
// que "el más nuevo" no dependa de cómo desempata cada consulta.
const AHORA = Date.now();
let minuto = 0;
const haceDias = (dias) => new Date(AHORA - dias * 24 * 3_600_000 - ++minuto * 60_000);
let siguiente = 0;
const mensaje = (datos) =>
  insertar("Message", {
    id: `m${String(++siguiente).padStart(5, "0")}`,
    conversationId: `conv-${datos.contactId ?? "x"}`,
    direction: "OUTBOUND",
    type: "TEXT",
    isStatusBroadcast: false,
    ...datos,
  });

const NEGOCIOS = { ws1: ["ana", "beto", "caro", "dani", "eva"], ws2: ["ana", "fer", "gabi"] };
for (const [ws, personas] of Object.entries(NEGOCIOS)) {
  for (let i = 0; i < 4; i += 1) {
    // ct-ws1-3 sin nombre: sale el teléfono, como en la pantalla.
    await insertar("Contact", { id: `ct-${ws}-${i}`, workspaceId: ws, phoneNumber: `57300${ws}${i}`, name: i === 3 ? null : `Cliente ${ws} ${i}` });
  }
  for (const [p, persona] of personas.entries()) {
    const contacto = (n) => `ct-${ws}-${(p + n) % 4}`;
    // ana responde en los dos negocios; dani solo tiene cosas de hace más de 30 días; eva solo recibe.
    if (persona !== "dani" && persona !== "eva") {
      for (let k = 0; k < 6; k += 1) {
        await mensaje({ workspaceId: ws, contactId: contacto(k), createdAt: haceDias(1 + k * 3 + p), rawPayload: { enviadoPorUserId: persona, source: "manual" } });
      }
      // Notas de asignación y de etapa.
      await mensaje({ workspaceId: ws, contactId: contacto(1), type: "SYSTEM", createdAt: haceDias(2 + p), rawPayload: { actorUserId: persona, kind: "assigned" } });
      await mensaje({ workspaceId: ws, contactId: contacto(2), type: "SYSTEM", createdAt: haceDias(5 + p), rawPayload: { actorUserId: persona, kind: "stage_changed" } });
      await mensaje({ workspaceId: ws, contactId: contacto(3), type: "SYSTEM", createdAt: haceDias(9), rawPayload: { actorUserId: persona, kind: "unassigned" } });
    }
    // Notas de otros kind, MÁS nuevas: no cuentan como última acción.
    await mensaje({ workspaceId: ws, contactId: contacto(0), type: "SYSTEM", createdAt: haceDias(0), rawPayload: { actorUserId: persona, kind: "tag_added" } });
    await mensaje({ workspaceId: ws, contactId: contacto(0), type: "SYSTEM", createdAt: haceDias(0), rawPayload: { actorUserId: persona, kind: "resolved" } });
    // Mensajes entrantes con el campo puesto, más nuevos: tampoco cuentan.
    await mensaje({ workspaceId: ws, contactId: contacto(1), direction: "INBOUND", createdAt: haceDias(0), rawPayload: { enviadoPorUserId: persona } });
    // Una nota de sistema con enviadoPorUserId: no es un mensaje enviado.
    await mensaje({ workspaceId: ws, contactId: contacto(2), type: "SYSTEM", createdAt: haceDias(0), rawPayload: { enviadoPorUserId: persona, kind: "assigned" } });
    // De hace más de 30 días, de todo tipo: quedan fuera.
    await mensaje({ workspaceId: ws, contactId: contacto(3), createdAt: haceDias(40), rawPayload: { enviadoPorUserId: persona } });
    await mensaje({ workspaceId: ws, contactId: contacto(3), type: "SYSTEM", createdAt: haceDias(45), rawPayload: { actorUserId: persona, kind: "stage_changed" } });
    // Llamadas: algunas nuevas, alguna vieja (las de dani y eva, todas viejas).
    await db.query(`INSERT INTO "CallAttempt" VALUES ($1, $2, $3, $4, $5)`, [`call-${ws}-${persona}-1`, ws, contacto(2), persona, haceDias(persona === "dani" || persona === "eva" ? 50 : p === 1 ? 0.5 : 12)]);
    await db.query(`INSERT INTO "CallAttempt" VALUES ($1, $2, $3, $4, $5)`, [`call-${ws}-${persona}-2`, ws, contacto(1), persona, haceDias(50)]);
  }
}
// Mensajes del bot (sin quién los mandó) y relleno para que el índice tenga sentido frente a un recorrido.
for (let i = 0; i < 400; i += 1) {
  await mensaje({ workspaceId: i % 2 ? "ws1" : "ws2", contactId: `ct-ws1-${i % 4}`, direction: i % 3 ? "INBOUND" : "OUTBOUND", createdAt: haceDias(i % 35), rawPayload: { source: "bot" }, readAt: i % 5 ? new Date(AHORA) : null });
}
await db.exec(`ANALYZE "Message"; ANALYZE "Contact"; ANALYZE "CallAttempt";`);

/* ── El código real, con la base de prueba ── */
const consultas = [];
const queryRaw = async (sql, ...resto) => {
  const objeto = sql instanceof Sql ? sql : Prisma.sql(sql, ...resto);
  consultas.push(objeto);
  return filas(objeto.texto, objeto.valores);
};
const prismaDePrueba = {
  $queryRaw: queryRaw,
  $transaction: async (fn) => fn({ $queryRaw: queryRaw, $executeRawUnsafe: async (sql) => db.exec(sql) }),
};
const mocks = { "@/lib/prisma": { prisma: prismaDePrueba }, "@prisma/client": { Prisma } };

const { ultimaAccionPorPersona } = cargar("src/features/actividad/services/actividad.ts", mocks);
const { quedarseConLaMasReciente } = cargar("src/features/actividad/services/ultima-accion.ts", mocks);
const { sqlIdsNoLeidos } = cargar("src/lib/ultimo-mensaje-de-chats.ts", mocks);

/** La consulta de ANTES, tal cual estaba con DISTINCT ON ($1 = workspaceId, $2 = desde). */
const VIEJA = {
  mensajes: `
      SELECT u."userId", u."createdAt" AS cuando, coalesce(c."name", c."phoneNumber") AS cliente
      FROM (
        SELECT DISTINCT ON (m."rawPayload"->>'enviadoPorUserId')
               m."rawPayload"->>'enviadoPorUserId' AS "userId", m."createdAt", m."contactId"
        FROM "Message" m
        WHERE m."workspaceId" = $1
          AND m."createdAt" >= $2
          AND m."direction" = 'OUTBOUND' AND m."type" <> 'SYSTEM'
          AND m."rawPayload"->>'enviadoPorUserId' IS NOT NULL
        ORDER BY m."rawPayload"->>'enviadoPorUserId', m."createdAt" DESC
      ) u
      LEFT JOIN "Contact" c ON c."id" = u."contactId"`,
  notas: `
      SELECT u."userId", u.kind, u."createdAt" AS cuando, coalesce(c."name", c."phoneNumber") AS cliente
      FROM (
        SELECT DISTINCT ON (m."rawPayload"->>'actorUserId')
               m."rawPayload"->>'actorUserId' AS "userId", m."rawPayload"->>'kind' AS kind,
               m."createdAt", m."contactId"
        FROM "Message" m
        WHERE m."workspaceId" = $1
          AND m."createdAt" >= $2
          AND m."type" = 'SYSTEM'
          AND m."rawPayload"->>'actorUserId' IS NOT NULL
          AND m."rawPayload"->>'kind' IN ('assigned', 'unassigned', 'stage_changed')
        ORDER BY m."rawPayload"->>'actorUserId', m."createdAt" DESC
      ) u
      LEFT JOIN "Contact" c ON c."id" = u."contactId"`,
  llamadas: `
      SELECT u."userId", u."calledAt" AS cuando, coalesce(c."name", c."phoneNumber") AS cliente
      FROM (
        SELECT DISTINCT ON (a."calledByUserId") a."calledByUserId" AS "userId", a."calledAt", a."contactId"
        FROM "CallAttempt" a
        WHERE a."workspaceId" = $1
          AND a."calledAt" >= $2
          AND a."calledByUserId" IS NOT NULL
        ORDER BY a."calledByUserId", a."calledAt" DESC
      ) u
      LEFT JOIN "Contact" c ON c."id" = u."contactId"`,
};

async function comoAntes(workspaceId, userIds, desde) {
  const deLasPersonas = (lista) => lista.filter((f) => userIds.includes(f.userId));
  const mensajes = deLasPersonas(await filas(VIEJA.mensajes, [workspaceId, desde]));
  const notas = deLasPersonas(await filas(VIEJA.notas, [workspaceId, desde]));
  const llamadas = deLasPersonas(await filas(VIEJA.llamadas, [workspaceId, desde]));
  return quedarseConLaMasReciente([
    ...mensajes.map((m) => ({ ...m, tipo: "mensaje" })),
    ...notas.map((n) => ({ userId: n.userId, cuando: n.cuando, cliente: n.cliente, tipo: n.kind === "stage_changed" ? "etapa" : "asignacion" })),
    ...llamadas.map((l) => ({ ...l, tipo: "llamada" })),
  ]);
}
const ordenado = (mapa) => [...mapa.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, { ...v, cuando: v.cuando.getTime() }]);

/* ── (c) Mismos resultados ── */
await prueba("(c) mismos resultados: ultimaAccionPorPersona da el mismo Map que la consulta vieja con DISTINCT ON", async () => {
  const desde = new Date(AHORA - 30 * 24 * 3_600_000);
  for (const [ws, personas] of Object.entries(NEGOCIOS)) {
    // Las del negocio, más una que no existe y una de otro negocio (no deben aparecer).
    const pedidas = [...personas, "nadie", ws === "ws1" ? "fer" : "beto"];
    const ahora = await ultimaAccionPorPersona({ workspaceId: ws, userIds: pedidas, desde, lanzarSiFalla: true });
    const antes = await comoAntes(ws, pedidas, desde);
    assert.deepEqual(ordenado(ahora), ordenado(antes), ws);
    assert.ok(ahora.size >= 2, `${ws}: tiene que haber acciones que comparar`);
    assert.ok(!ahora.has("nadie") && !ahora.has("dani") && !ahora.has("eva"), `${ws}: sin acciones en 30 días no sale`);
    // Con los 30 días por defecto sale lo mismo.
    const porDefecto = await ultimaAccionPorPersona({ workspaceId: ws, userIds: pedidas, lanzarSiFalla: true });
    assert.deepEqual(ordenado(porDefecto), ordenado(antes), `${ws} (30 días por defecto)`);
  }
  // Cada negocio con lo suyo: ana tiene una última acción distinta en cada uno.
  const ana1 = (await ultimaAccionPorPersona({ workspaceId: "ws1", userIds: ["ana"], lanzarSiFalla: true })).get("ana");
  const ana2 = (await ultimaAccionPorPersona({ workspaceId: "ws2", userIds: ["ana"], lanzarSiFalla: true })).get("ana");
  assert.ok(ana1 && ana2);
  assert.match(ana1.cliente, /ws1/);
  assert.match(ana2.cliente, /ws2/);
  // Sin personas no consulta nada.
  consultas.length = 0;
  assert.equal((await ultimaAccionPorPersona({ workspaceId: "ws1", userIds: [] })).size, 0);
  assert.equal(consultas.length, 0, "sin personas no se consulta");
  // Un negocio sin mensajes: Map vacío.
  assert.equal((await ultimaAccionPorPersona({ workspaceId: "ws9", userIds: ["ana"], lanzarSiFalla: true })).size, 0);
});

/* ── (d) Usa el índice ── */
async function planDe(sql) {
  await db.exec(`SET enable_seqscan = off;`);
  try {
    const plan = await filas(`EXPLAIN ${sql.texto}`, sql.valores);
    return plan.map((f) => f["QUERY PLAN"]).join("\n");
  } finally {
    await db.exec(`SET enable_seqscan = on;`);
  }
}

await prueba("(d) usa el índice: las consultas de mensajes y la de no leídos van por sus índices parciales", async () => {
  const fuente = leerArchivo("src/features/actividad/services/actividad.ts");
  const inicio = fuente.indexOf("export async function ultimaAccionPorPersona");
  const funcion = fuente.slice(inicio, fuente.indexOf("\nexport async function", inicio + 1));
  assert.equal((funcion.match(/unnest\(/g) ?? []).length, 2, "las dos consultas de mensajes con unnest(");
  assert.equal((funcion.match(/CROSS JOIN LATERAL/g) ?? []).length, 2, "las dos con CROSS JOIN LATERAL");
  assert.equal((funcion.match(/ORDER BY m\."createdAt" DESC\s+LIMIT 1/g) ?? []).length, 2, 'las dos con ORDER BY m."createdAt" DESC LIMIT 1');
  assert.doesNotMatch(funcion, /DISTINCT ON \(m\./, "las de mensajes ya no usan DISTINCT ON");

  consultas.length = 0;
  await ultimaAccionPorPersona({ workspaceId: "ws1", userIds: NEGOCIOS.ws1, lanzarSiFalla: true });
  const deMensajes = consultas.filter((c) => c.texto.includes('FROM "Message" m'));
  assert.equal(deMensajes.length, 2, "dos consultas de mensajes");
  const enviado = deMensajes.find((c) => c.texto.includes("'enviadoPorUserId' = "));
  const actor = deMensajes.find((c) => c.texto.includes("'actorUserId' = "));
  assert.ok(enviado && actor);
  const planEnviado = await planDe(enviado);
  assert.match(planEnviado, /Message_ultima_accion_enviado_idx/, planEnviado);
  const planActor = await planDe(actor);
  assert.match(planActor, /Message_ultima_accion_actor_idx/, planActor);

  const noLeidos = sqlIdsNoLeidos({ workspaceId: "ws1", canales: null, dias: 30 });
  const planNoLeidos = await planDe(noLeidos);
  assert.match(planNoLeidos, /Message_no_leido_idx/, planNoLeidos);
});

/* ── (e) El archivo a mano coincide ── */
await prueba("(e) el archivo a mano coincide: cada índice es el de su migración, con CONCURRENTLY y sin transacción", () => {
  const aMano = leerArchivo(A_MANO);
  const sentencias = sentenciasDe(aMano);
  assert.doesNotMatch(aMano.replace(/--.*$/gm, ""), /\b(BEGIN|COMMIT)\b/, "CONCURRENTLY no corre dentro de una transacción");
  assert.equal(sentencias.length, INDICES.length, "una sentencia por índice");
  const deLasMigraciones = MIGRACIONES_DE_ACTIVIDAD.flatMap((n) => sentenciasDe(leerMigracion(n))).filter((s) => s !== "BEGIN" && s !== "COMMIT");
  for (const s of sentencias) {
    assert.match(s, /^CREATE INDEX CONCURRENTLY IF NOT EXISTS "/, s);
    const comoEnLaMigracion = s.replace("CREATE INDEX CONCURRENTLY IF NOT EXISTS", "CREATE INDEX IF NOT EXISTS");
    assert.ok(deLasMigraciones.includes(comoEnLaMigracion), `no coincide con ninguna migración: ${s}`);
  }
  assert.deepEqual(
    sentencias.map((s) => s.match(/"([^"]+)"/)[1]).sort(),
    [...INDICES].sort(),
  );
});

await db.close();
console.log(`\n${pruebas} pruebas de los índices de actividad: todas pasaron.`);
