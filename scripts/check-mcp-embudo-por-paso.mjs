// Pruebas de la herramienta MCP `embudo_por_paso` (src/lib/mcp/embudo-por-paso.ts): sale en la lista y
// está registrada, solo lee, usa el negocio de la clave (nunca uno pasado por argumento), rechaza
// fechas malas, niega el acceso a una asesora y responde bien con el embudo apagado. Con una base de
// mentira (sin red ni base real). Correr: npm run test:mcp-embudo-por-paso
import assert from "node:assert/strict";
import fs from "node:fs";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

const WS = "ws1";
const db = { consultas: [], escrituras: [], apagado: false };
const hace = (horas) => new Date(Date.now() - horas * 3_600_000);

const MEMBRESIAS = new Map([
  [`${WS}:alex`, { role: "OWNER", user: { role: "CLIENTE" }, workspace: { ownerId: "alex" } }],
  [`${WS}:asesora`, { role: "AGENT", user: { role: "EMPLEADO" }, workspace: { ownerId: "alex" } }],
]);

function fila(i, actual, maximo, horasSinEscribir, extra = {}) {
  return {
    id: `c${i}`, canal: "Ventas 1", anuncioTitulo: "Combo camilla", productoEntrada: null, productoActual: "combo-camilla",
    productoInteres: "combo-camilla", pasoActual: actual, pasoMaximo: maximo, pasoHistorial: null,
    ultimoClienteEn: hace(horasSinEscribir), crmStage: "NUEVO", ventaEn: null, automationPaused: false, asignadaA: null,
    asignadaChat: null, ...extra,
  };
}
const filas = [];
for (let i = 0; i < 10; i += 1) filas.push(fila(i, "PRESENTACION", "PRESENTACION", 30));
for (let i = 10; i < 16; i += 1) filas.push(fila(i, "PRODUCTO", "PRODUCTO", 30));
for (let i = 16; i < 18; i += 1) filas.push(fila(i, "CIERRE", "CIERRE", 2));
filas.push(fila(18, "OBJECIONES", "OBJECIONES", 30, { automationPaused: true }));
filas.push(fila(19, "PRODUCTO", "PRODUCTO", 30, { asignadaChat: "u1" }));
filas.push(fila(20, "PRODUCTO", "PRODUCTO", 30, { canal: "Ventas 2", productoInteres: null })); // marketplace: otra familia

const METODOS_DE_ESCRITURA = ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"];
const anotar = (modelo, metodo) => async () => { db.escrituras.push(`${modelo}.${metodo}`); return {}; };
const prismaBase = {
  workspaceMember: { findFirst: async ({ where }) => MEMBRESIAS.get(`${where.workspaceId}:${where.userId}`) ?? null },
  appSetting: { findUnique: async () => (db.apagado ? { value: "false" } : null) },
  whatsAppChannel: { findMany: async () => [] },
  $queryRaw: async (sql) => {
    const [partes, ...valores] = sql;
    db.consultas.push({ texto: partes.join("?"), valores });
    assert.ok(valores.includes(WS), "toda consulta cruda filtra por el negocio de la clave");
    return filas;
  },
  $executeRaw: anotar("$", "executeRaw"),
  $transaction: anotar("$", "transaction"),
};
const prisma = new Proxy(prismaBase, {
  get(objetivo, prop) {
    if (prop in objetivo) return objetivo[prop];
    if (typeof prop !== "string") return undefined;
    return new Proxy({}, { get: (_, metodo) => (METODOS_DE_ESCRITURA.includes(metodo) ? anotar(prop, metodo) : async () => (metodo === "findMany" ? [] : null)) });
  },
});
const mocks = {
  "@/lib/prisma": { prisma },
  "@prisma/client": { Prisma: { sql: (...a) => a, join: (x) => x } },
  react: { cache: (f) => f },
  "@/lib/cache-de-permisos": {
    cacheDeSupervisoras: { obtener: (_c, fn) => fn(), invalidar: () => {}, vaciar: () => {} },
    cacheDeAcceso: { obtener: (_c, fn) => fn(), invalidar: () => {}, vaciar: () => {} },
    cacheDeCanales: { obtener: (_c, fn) => fn(), invalidar: () => {}, vaciar: () => {} },
    invalidarTrasEscritura: () => {},
  },
  "@/lib/web-push": { sendPushToUser: anotar("push", "send") },
  "@/lib/evolution": { sendEvolutionTextMessageWithReconnect: anotar("whatsapp", "send") },
  "@/lib/anti-bloqueo/servicio": { leerConfigAntiBloqueo: async () => ({ avisos: { canalInternoId: null } }) },
};
const mcp = cargar("src/lib/mcp/embudo-por-paso.ts", mocks);

let pruebas = 0;
const fallas = [];
async function prueba(nombre, fn) {
  try {
    await fn();
    pruebas += 1;
    console.log(`ok - ${nombre}`);
  } catch (error) {
    fallas.push(nombre);
    console.log(`FALLA - ${nombre}\n  ${String(error?.stack ?? error).split("\n").slice(0, 6).join("\n  ")}`);
  }
}
const alex = { workspaceId: WS, userId: "alex" };
const ejecutar = (args, contexto = alex) => mcp.ejecutarHerramientaMcpEmbudoPorPaso("embudo_por_paso", args, contexto);

await prueba("sale en la lista del MCP, es de solo lectura y está registrada", () => {
  const herramienta = mcp.HERRAMIENTAS_MCP_EMBUDO_POR_PASO[0];
  assert.equal(herramienta.name, "embudo_por_paso");
  assert.equal(herramienta.annotations.readOnlyHint, true);
  assert.equal(mcp.esHerramientaDeEmbudoPorPaso("embudo_por_paso"), true);
  assert.equal(mcp.esHerramientaDeEmbudoPorPaso("otra"), false);
  const fuente = fs.readFileSync(`${RAIZ}/src/lib/mcp/herramientas.ts`, "utf8");
  assert.ok(fuente.includes("...HERRAMIENTAS_MCP_EMBUDO_POR_PASO"));
  assert.ok(fuente.includes("ejecutarHerramientaMcpEmbudoPorPaso(nombre, args, contexto)"));
});

await prueba("no acepta un negocio por argumento", () => {
  const props = mcp.HERRAMIENTAS_MCP_EMBUDO_POR_PASO[0].inputSchema.properties;
  assert.deepEqual(Object.keys(props), ["producto", "desde", "hasta"]);
});

await prueba("devuelve los 4 pasos del combo con números, separando bot y asesora", async () => {
  const r = await ejecutar({});
  assert.equal(r.producto, "Combo camilla");
  assert.deepEqual(r.pasos_del_reporte, ["Presentación", "Producto", "Objeciones", "Cierre"]);
  assert.equal(r.solo_el_bot.clientes, 18);
  assert.deepEqual(r.solo_el_bot.pasos.map((x) => x.llegaron), [18, 8, 2, 2]);
  assert.deepEqual(r.solo_el_bot.pasos.map((x) => x.se_quedaron_aqui), [10, 6, 0, 0]);
  assert.equal(r.solo_el_bot.pasos[0].pct_que_pasa_al_siguiente, 44.4);
  assert.equal(r.solo_el_bot.paso_donde_mas_se_cae.entre, "Producto y Objeciones");
  assert.equal(r.lo_tomo_una_asesora.clientes, 2);
  assert.deepEqual(r.lo_tomo_una_asesora.pasos.map((x) => x.llegaron), [2, 2, 1, 0]);
  assert.ok(r.resumen_para_decir.includes("18 a Presentación"));
  assert.ok(r.resumen_para_decir.includes("Donde más se cae"));
});

await prueba("pide otro producto: marketplace y camillas se separan del combo", async () => {
  const r = await ejecutar({ producto: "marketplace" });
  assert.equal(r.producto, "Marketplace");
  assert.equal(r.solo_el_bot.clientes, 1);
  const c = await ejecutar({ producto: "camillas" });
  assert.equal(c.solo_el_bot.clientes, 0);
});

await prueba("solo lee y usa el negocio de la clave", () => {
  assert.deepEqual(db.escrituras, []);
  assert.ok(db.consultas.length > 0 && db.consultas.every((c) => c.valores.includes(WS)));
  assert.ok(db.consultas.every((c) => /^\s*SELECT/i.test(c.texto)));
});

await prueba("fechas y producto inválidos dan un error claro", async () => {
  await assert.rejects(ejecutar({ desde: "ayer" }), /AAAA-MM-DD/);
  await assert.rejects(ejecutar({ hasta: "2026-13-45" }), /AAAA-MM-DD/);
  await assert.rejects(ejecutar({ desde: "2026-10-20", hasta: "2026-10-01" }), /posterior/);
  await assert.rejects(ejecutar({ producto: "zapatos" }), /No reconozco/);
});

await prueba("un asesor no puede usarla", async () => {
  await assert.rejects(ejecutar({}, { workspaceId: WS, userId: "asesora" }), /no tiene permiso/);
  await assert.rejects(ejecutar({}, { workspaceId: WS, userId: "intruso" }), /no tiene permiso/);
});

await prueba("con el embudo apagado responde bien y no lee los chats", async () => {
  // El interruptor se recuerda un minuto: se prueba con otro negocio.
  db.apagado = true;
  MEMBRESIAS.set("ws9:alex", { role: "OWNER", user: { role: "CLIENTE" }, workspace: { ownerId: "alex" } });
  const antes = db.consultas.length;
  const r = await ejecutar({}, { workspaceId: "ws9", userId: "alex" });
  assert.ok(r.resumen_para_decir.includes("apagado"));
  assert.equal(db.consultas.length, antes);
});

console.log(`\n${pruebas} pruebas ok, ${fallas.length} con falla`);
if (fallas.length) {
  console.log("Fallaron:", fallas.join(" | "));
  process.exit(1);
}
