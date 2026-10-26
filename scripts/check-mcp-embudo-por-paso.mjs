// Pruebas de la herramienta MCP `embudo_por_paso` (src/lib/mcp/embudo-por-paso.ts): está registrada,
// solo lee, usa el negocio de la clave, rechaza fechas malas, niega el acceso a una asesora y
// responde con el embudo apagado. Con una base de mentira. Correr: npm run test:mcp-embudo-por-paso
import assert from "node:assert/strict";
import fs from "node:fs";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

const WS = "ws1";
const db = { consultas: [], escrituras: [], apagado: false };
const hace = (dias) => new Date(Date.now() - dias * 86_400_000);

const MEMBRESIAS = new Map([
  [`${WS}:alex`, { role: "OWNER", user: { role: "CLIENTE" }, workspace: { ownerId: "alex" } }],
  [`${WS}:asesora`, { role: "AGENT", user: { role: "EMPLEADO" }, workspace: { ownerId: "alex" } }],
]);

function fila(i, actual, maximo, conAsesora = false) {
  return {
    id: `c-${actual}-${i}`, canal: "Ventas 1", entradaEn: hace(10), anuncioTitulo: "Combo camilla", productoEntrada: null,
    productoActual: "combo-camilla", productoInteres: "combo-camilla", pasoActual: actual, pasoMaximo: maximo,
    pasoDesde: hace(9), pasoHistorial: null, ultimoClienteEn: hace(5), transferencia: conAsesora ? "ASIGNADA" : "NO",
    iaPausada: conAsesora, asignada: conAsesora,
  };
}
// 40 se quedaron en Presentación, 20 en Producto, 10 en Objeciones, 2 llegaron a Cierre; 5 con asesora.
const filas = [];
for (let i = 0; i < 40; i += 1) filas.push(fila(i, "PRESENTACION", "PRESENTACION"));
for (let i = 0; i < 20; i += 1) filas.push(fila(i, "PRODUCTO", "PRODUCTO"));
for (let i = 0; i < 10; i += 1) filas.push(fila(i, "OBJECIONES", "OBJECIONES"));
for (let i = 0; i < 2; i += 1) filas.push(fila(i, "CIERRE", "CIERRE"));
for (let i = 0; i < 5; i += 1) filas.push(fila(i, "CIERRE", "CIERRE", true));

const METODOS_DE_ESCRITURA = ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"];
const anotar = (modelo, metodo) => async () => { db.escrituras.push(`${modelo}.${metodo}`); return {}; };
const prismaBase = {
  workspaceMember: {
    findFirst: async ({ where }) => MEMBRESIAS.get(`${where.workspaceId}:${where.userId}`) ?? null,
  },
  appSetting: {
    findUnique: async () => (db.apagado ? { value: "false" } : null),
  },
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
const TOOL = "embudo_por_paso";

await prueba("sale en la lista del MCP y está registrada", () => {
  assert.equal(mcp.HERRAMIENTAS_MCP_EMBUDO_POR_PASO[0].name, TOOL);
  assert.equal(mcp.HERRAMIENTAS_MCP_EMBUDO_POR_PASO[0].annotations.readOnlyHint, true);
  assert.equal(mcp.esHerramientaDeEmbudoPorPaso(TOOL), true);
  const fuente = fs.readFileSync(`${RAIZ}/src/lib/mcp/herramientas.ts`, "utf8");
  assert.ok(fuente.includes("...HERRAMIENTAS_MCP_EMBUDO_POR_PASO"));
  assert.ok(fuente.includes("ejecutarHerramientaMcpEmbudoPorPaso(nombre, args, contexto)"));
});

await prueba("no acepta un negocio por argumento", () => {
  const props = mcp.HERRAMIENTAS_MCP_EMBUDO_POR_PASO[0].inputSchema.properties;
  assert.ok(!("workspaceId" in props) && !("negocio" in props));
});

await prueba("devuelve los 4 pasos con llegaron, se quedaron y la tasa; separa a la asesora", async () => {
  const r = await mcp.ejecutarHerramientaMcpEmbudoPorPaso(TOOL, {}, alex);
  assert.equal(r.solo_bot.chats, 72);
  assert.equal(r.con_asesora.chats, 5);
  assert.deepEqual(r.solo_bot.pasos.map((p) => p.paso), ["Presentación", "Producto", "Objeciones", "Cierre"]);
  assert.deepEqual(r.solo_bot.pasos.map((p) => p.llegaron), [72, 32, 12, 2]);
  assert.equal(r.solo_bot.pasos[1].pct_que_pasa_desde_el_paso_anterior, 44);
  assert.equal(r.solo_bot.pasos[0].se_quedaron, 40);
  assert.equal(r.con_asesora.pasos[3].llegaron, 5);
  assert.ok(r.resumen_para_decir.includes("Donde más se cae"));
});

await prueba("solo lee y usa el negocio de la clave", () => {
  assert.deepEqual(db.escrituras, []);
  assert.ok(db.consultas.length > 0 && db.consultas.every((c) => c.valores.includes(WS)));
  assert.ok(db.consultas.every((c) => /^\s*SELECT/i.test(c.texto)));
});

await prueba("argumentos inválidos dan un error claro", async () => {
  await assert.rejects(mcp.ejecutarHerramientaMcpEmbudoPorPaso(TOOL, { desde: "ayer" }, alex), /AAAA-MM-DD/);
  await assert.rejects(mcp.ejecutarHerramientaMcpEmbudoPorPaso(TOOL, { hasta: "2026-13-45" }, alex), /AAAA-MM-DD/);
  await assert.rejects(mcp.ejecutarHerramientaMcpEmbudoPorPaso(TOOL, { producto: "zapatos" }, alex), /No reconozco/);
});

await prueba("una asesora no puede usarla", async () => {
  await assert.rejects(mcp.ejecutarHerramientaMcpEmbudoPorPaso(TOOL, {}, { workspaceId: WS, userId: "asesora" }), /no tiene permiso/);
  await assert.rejects(mcp.ejecutarHerramientaMcpEmbudoPorPaso(TOOL, {}, { workspaceId: WS, userId: "intruso" }), /no tiene permiso/);
});

await prueba("con el embudo apagado avisa y no lee los chats", async () => {
  // El interruptor se recuerda un minuto: se prueba con otro negocio.
  db.apagado = true;
  MEMBRESIAS.set("ws9:alex", { role: "OWNER", user: { role: "CLIENTE" }, workspace: { ownerId: "alex" } });
  const antes = db.consultas.length;
  const r = await mcp.ejecutarHerramientaMcpEmbudoPorPaso(TOOL, {}, { workspaceId: "ws9", userId: "alex" });
  assert.ok(r.resumen_para_decir.includes("apagado"));
  assert.equal(db.consultas.length, antes);
});

console.log(`\n${pruebas} pruebas ok${fallas.length ? `, ${fallas.length} fallaron: ${fallas.join("; ")}` : ""}`);
if (fallas.length) process.exit(1);
