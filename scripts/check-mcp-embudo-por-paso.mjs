// Pruebas de la herramienta MCP `embudo_por_paso` (src/lib/mcp/embudo-por-paso.ts): está registrada,
// solo lee, usa el negocio de la clave, rechaza fechas malas, niega el acceso a una asesora y avisa
// con el embudo apagado. Con una base de mentira. Correr: npm run test:mcp-embudo-por-paso
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

const fila = (paso, maximo, extra = {}) => ({
  canal: "Ventas 1", entradaEn: hace(10), anuncioTitulo: "Combo camilla", productoEntrada: null, productoActual: "combo-camilla",
  productoInteres: "combo-camilla", pasoActual: paso, pasoMaximo: maximo, pasoDesde: hace(9), pasoHistorial: null,
  ultimoClienteEn: hace(5), transferencia: "NO", ventaEn: null, crmStage: "NUEVO", automationPaused: false, asignada: null, ...extra,
});
const filas = [
  fila("PRESENTACION", "PRESENTACION"), fila("PRESENTACION", "PRESENTACION"),
  fila("PRODUCTO", "PRODUCTO"), fila("OBJECIONES", "OBJECIONES"),
  fila("CIERRE", "CIERRE", { automationPaused: true }),
];

const METODOS_DE_ESCRITURA = ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"];
const anotar = (modelo, metodo) => async () => { db.escrituras.push(`${modelo}.${metodo}`); return {}; };
const prismaBase = {
  workspaceMember: { findFirst: async ({ where }) => MEMBRESIAS.get(`${where.workspaceId}:${where.userId}`) ?? null },
  appSetting: { findUnique: async () => (db.apagado ? { value: "false" } : null) },
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
const llamar = (args, ctx = alex) => mcp.ejecutarHerramientaMcpEmbudoPorPaso("embudo_por_paso", args, ctx);

await prueba("está registrada, de solo lectura y sin negocio por argumento", () => {
  const h = mcp.HERRAMIENTAS_MCP_EMBUDO_POR_PASO[0];
  assert.equal(h.name, "embudo_por_paso");
  assert.equal(h.annotations.readOnlyHint, true);
  assert.ok(!("workspaceId" in h.inputSchema.properties));
  assert.equal(mcp.esHerramientaDeEmbudoPorPaso("embudo_por_paso"), true);
  const fuente = fs.readFileSync(`${RAIZ}/src/lib/mcp/herramientas.ts`, "utf8");
  assert.ok(fuente.includes("...HERRAMIENTAS_MCP_EMBUDO_POR_PASO"));
  assert.ok(fuente.includes("ejecutarHerramientaMcpEmbudoPorPaso(nombre, args, contexto)"));
});

await prueba("devuelve los 4 pasos del combo, el bot aparte de la asesora", async () => {
  const r = await llamar({});
  assert.equal(r.producto, "Combo camilla");
  assert.deepEqual(r.solo_el_bot.pasos.map((p) => p.paso), ["Presentación", "Producto", "Objeciones", "Cierre"]);
  assert.deepEqual(r.solo_el_bot.pasos.map((p) => p.llegaron), [4, 2, 1, 0]);
  assert.equal(r.lo_tomo_una_asesora.chats, 1);
  assert.ok(r.resumen_para_decir.includes("llegaron"));
});

await prueba("solo lee y usa el negocio de la clave", () => {
  assert.deepEqual(db.escrituras, []);
  assert.ok(db.consultas.length > 0 && db.consultas.every((c) => c.valores.includes(WS) && /^\s*SELECT/i.test(c.texto)));
});

await prueba("argumentos inválidos dan un error claro", async () => {
  await assert.rejects(llamar({ desde: "ayer" }), /AAAA-MM-DD/);
  await assert.rejects(llamar({ hasta: "2026-13-45" }), /AAAA-MM-DD/);
  await assert.rejects(llamar({ producto: "zapatos" }), /No reconozco/);
});

await prueba("una asesora no puede usarla", async () => {
  await assert.rejects(llamar({}, { workspaceId: WS, userId: "asesora" }), /no tiene permiso/);
  await assert.rejects(llamar({}, { workspaceId: WS, userId: "intruso" }), /no tiene permiso/);
});

await prueba("con el embudo apagado avisa y no lee los chats", async () => {
  db.apagado = true;
  MEMBRESIAS.set("ws9:alex", { role: "OWNER", user: { role: "CLIENTE" }, workspace: { ownerId: "alex" } });
  const antes = db.consultas.length;
  const r = await llamar({}, { workspaceId: "ws9", userId: "alex" });
  assert.ok(r.resumen_para_decir.includes("apagado"));
  assert.equal(db.consultas.length, antes);
});

console.log(`\n${pruebas} pruebas ok, ${fallas.length} con falla`);
if (fallas.length) {
  console.log("Fallaron:", fallas.join(" | "));
  process.exit(1);
}
