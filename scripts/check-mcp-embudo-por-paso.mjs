// Pruebas de la herramienta MCP `embudo_por_paso` (src/lib/mcp/embudo-por-paso.ts): sale en la
// lista, solo lee, usa el negocio de la clave (nunca uno pasado por argumento) y trae los 4 pasos del combo. Con una base de mentira (sin red ni base real). Correr: npm run test:mcp-embudo-por-paso
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

function fila(i, paso, extra = {}) {
  return {
    id: `c${paso}-${i}-${Math.random()}`, canalId: "L1", canal: "Ventas 1", entradaEn: hace(10), anuncioTitulo: "Combo camilla",
    productoEntrada: null, productoActual: "combo-camilla", productoInteres: "combo-camilla",
    pasoActual: paso, pasoMaximo: paso, pasoAnterior: null, pasoDesde: hace(5), pasoHistorial: null,
    ultimoClienteEn: hace(3), ventaEn: null, transferencia: "NO", asignadaA: null, primeraRespuestaAsesoraEn: null,
    crmStage: "NUEVO", automationPaused: false, assignedToUserId: null, ...extra,
  };
}
const dias = (n) => new Date(Date.now() - n * 86_400_000);
// 40 se quedan en Presentación (3 días sin escribir), 30 en Producto, 10 en Objeciones y 8 en Cierre; 4 con asesora.
const filas = [];
for (let i = 0; i < 40; i += 1) filas.push(fila(i, "PRESENTACION", { ultimoClienteEn: dias(3) }));
for (let i = 0; i < 30; i += 1) filas.push(fila(i, "PRODUCTO", { ultimoClienteEn: dias(2) }));
for (let i = 0; i < 10; i += 1) filas.push(fila(i, "OBJECIONES", { ultimoClienteEn: dias(2) }));
for (let i = 0; i < 8; i += 1) filas.push(fila(i, "CIERRE", { ultimoClienteEn: dias(2) }));
for (let i = 0; i < 4; i += 1) filas.push(fila(i, "CIERRE", { automationPaused: true }));

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
const ejecutar = (args, contexto = alex) => mcp.ejecutarHerramientaMcpEmbudoPorPaso("embudo_por_paso", args, contexto);

await prueba("sale en la lista del MCP y está registrada", () => {
  assert.equal(mcp.HERRAMIENTAS_MCP_EMBUDO_POR_PASO[0].name, "embudo_por_paso");
  assert.equal(mcp.HERRAMIENTAS_MCP_EMBUDO_POR_PASO[0].annotations.readOnlyHint, true);
  assert.equal(mcp.esHerramientaDeEmbudoPorPaso("embudo_por_paso"), true);
  const fuente = fs.readFileSync(`${RAIZ}/src/lib/mcp/herramientas.ts`, "utf8");
  assert.ok(fuente.includes("...HERRAMIENTAS_MCP_EMBUDO_POR_PASO"));
  assert.ok(fuente.includes("ejecutarHerramientaMcpEmbudoPorPaso(nombre, args, contexto)"));
});

await prueba("no acepta un negocio por argumento", () => {
  const props = mcp.HERRAMIENTAS_MCP_EMBUDO_POR_PASO[0].inputSchema.properties;
  assert.ok(!("workspaceId" in props) && !("negocio" in props));
  assert.deepEqual(Object.keys(props), ["producto", "desde", "hasta"]);
});

await prueba("devuelve los 4 pasos del combo con llegaron y se quedaron", async () => {
  const r = await ejecutar({});
  assert.equal(r.producto, "Combo camilla");
  const pasos = r.solo_el_bot.pasos;
  assert.deepEqual(pasos.map((p) => p.paso), ["Presentación", "Producto", "Objeciones", "Cierre"]);
  assert.deepEqual(pasos.map((p) => p.llegaron), [88, 48, 18, 8]);
  assert.deepEqual(pasos.map((p) => p.se_quedaron), [40, 30, 10, 8]);
  assert.equal(pasos[0].pct_que_pasa_al_siguiente, 54.5);
  assert.equal(r.solo_el_bot.paso_donde_mas_se_cae.entre, "Producto y Objeciones");
  assert.equal(r.tomados_por_asesora.chats, 4);
  assert.equal(r.solo_el_bot.chats, 88);
  assert.ok(r.resumen_para_decir.includes("Presentación 88"));
});

await prueba("solo lee y usa el negocio de la clave", () => {
  assert.deepEqual(db.escrituras, []);
  assert.ok(db.consultas.length > 0 && db.consultas.every((c) => c.valores.includes(WS)));
  assert.ok(db.consultas.every((c) => /^\s*SELECT/i.test(c.texto)));
});

await prueba("otro producto filtra por familia", async () => {
  const r = await ejecutar({ producto: "camillas" });
  assert.equal(r.producto, "Camillas");
  assert.equal(r.solo_el_bot.chats + r.tomados_por_asesora.chats, 0);
});

await prueba("argumentos inválidos dan un error claro", async () => {
  await assert.rejects(ejecutar({ desde: "ayer" }), /AAAA-MM-DD/);
  await assert.rejects(ejecutar({ hasta: "2026-13-45x" }), /AAAA-MM-DD/);
  await assert.rejects(ejecutar({ producto: "zapatos" }), /No reconozco/);
  await assert.rejects(ejecutar({ desde: "2026-10-20", hasta: "2026-10-01" }), /posterior/);
});

await prueba("una asesora no puede usarla", async () => {
  await assert.rejects(ejecutar({}, { workspaceId: WS, userId: "asesora" }), /no tiene permiso/);
  await assert.rejects(ejecutar({}, { workspaceId: WS, userId: "intruso" }), /no tiene permiso/);
});

await prueba("con el embudo apagado avisa y no lee los chats", async () => {
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
