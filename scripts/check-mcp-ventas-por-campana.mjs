// Pruebas de la herramienta MCP `ventas_por_campana` (src/lib/mcp/ventas-por-campana.ts): sale en la
// lista, solo lee (la base y Meta), usa el negocio de la clave y contesta con datos de prueba.
// Sin red ni base real. Correr: npm run test:mcp-ventas-por-campana
import assert from "node:assert/strict";
import fs from "node:fs";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

const WS = "ws1";
const db = { consultas: [], escrituras: [] };
const hoy = new Date();
const esteMes = new Date(hoy.getTime() - 5 * 3_600_000);
esteMes.setUTCDate(1);
const mitad = new Date(Date.UTC(esteMes.getUTCFullYear(), esteMes.getUTCMonth(), 1, 15));

const MEMBRESIAS = new Map([
  [`${WS}:alex`, { role: "OWNER", user: { role: "CLIENTE" }, workspace: { ownerId: "alex" } }],
  [`${WS}:asesora`, { role: "AGENT", user: { role: "EMPLEADO" }, workspace: { ownerId: "alex" } }],
]);
const origenes = [
  { id: "o1", contactId: "c1", anuncioId: "111111", anuncioNombre: "Combo foto", conjuntoNombre: "Mujeres", campanaId: "K1", campanaNombre: "Combo camilla" },
  { id: "o2", contactId: "c2", anuncioId: "111111", anuncioNombre: "Combo foto", conjuntoNombre: "Mujeres", campanaId: "K1", campanaNombre: "Combo camilla" },
  { id: "o3", contactId: "c3", anuncioId: "222222", anuncioNombre: "Manicura", conjuntoNombre: "Todos", campanaId: "K2", campanaNombre: "Manicura" },
];
const ventas = [
  { ventaGestionId: "G-1", monto: 1_200_000, origenDePautaId: "o1" },
  { ventaGestionId: "G-2", monto: 900_000, origenDePautaId: null },
];

const METODOS_DE_ESCRITURA = ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"];
const anotar = (modelo, metodo) => async () => { db.escrituras.push(`${modelo}.${metodo}`); return {}; };
const lecturas = {
  workspaceMember: { findFirst: async ({ where }) => MEMBRESIAS.get(`${where.workspaceId}:${where.userId}`) ?? null },
  origenDePauta: {
    findMany: async ({ where }) => {
      assert.equal(where.workspaceId, WS, "filtra por el negocio de la clave");
      db.consultas.push("origenDePauta.findMany");
      return where.id ? origenes.filter((o) => where.id.in.includes(o.id)) : origenes;
    },
  },
  ventaDePauta: {
    findMany: async ({ where }) => {
      assert.equal(where.workspaceId, WS);
      db.consultas.push("ventaDePauta.findMany");
      return ventas;
    },
  },
  embudoLead: {
    findMany: async ({ where }) => {
      assert.equal(where.workspaceId, WS);
      db.consultas.push("embudoLead.findMany");
      return [{ contactId: "c1" }, { contactId: "c3" }];
    },
  },
};
const prisma = new Proxy(lecturas, {
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

// Meta de mentira: registra cada petición para comprobar que solo son GET.
const peticiones = [];
globalThis.fetch = async (url, opciones = {}) => {
  peticiones.push({ url: String(url), metodo: opciones.method ?? "GET" });
  return new Response(
    JSON.stringify({ data: [{ ad_id: "111111", ad_name: "Combo foto", adset_name: "Mujeres", campaign_id: "K1", campaign_name: "Combo camilla", spend: "300000" }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
};
delete process.env.META_ADS_ACCESS_TOKEN;
delete process.env.META_ADS_ACCOUNT_ID;

const mcp = cargar("src/lib/mcp/ventas-por-campana.ts", mocks);
void mitad;

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

await prueba("sale en la lista del MCP, es de solo lectura y está registrada", () => {
  const h = mcp.HERRAMIENTAS_MCP_VENTAS_POR_CAMPANA[0];
  assert.equal(h.name, "ventas_por_campana");
  assert.equal(h.annotations.readOnlyHint, true);
  assert.ok(!("workspaceId" in h.inputSchema.properties));
  assert.equal(mcp.esHerramientaDeVentasPorCampana("ventas_por_campana"), true);
  const fuente = fs.readFileSync(`${RAIZ}/src/lib/mcp/herramientas.ts`, "utf8");
  assert.ok(fuente.includes("...HERRAMIENTAS_MCP_VENTAS_POR_CAMPANA"));
  assert.ok(fuente.includes("ejecutarHerramientaMcpVentasPorCampana(nombre, args, contexto)"));
});

await prueba("sin llave de Meta: gasto no disponible, ventas ordenadas y organico aparte", async () => {
  const r = await mcp.ejecutarHerramientaMcpVentasPorCampana("ventas_por_campana", {}, alex);
  assert.equal(r.gasto_disponible, false);
  assert.equal(r.campanas[0].nombre, "Combo camilla");
  assert.equal(r.campanas[0].chats, 2);
  assert.equal(r.campanas[0].calientes, 1);
  assert.equal(r.campanas[0].ventas, 1);
  assert.equal(r.campanas[0].monto_vendido, 1_200_000);
  assert.equal(r.campanas[0].tasa_de_cierre_pct, 50);
  assert.equal(r.campanas[0].costo_por_venta, "—");
  assert.equal(r.organico_marketplace_otro.ventas, 1);
  assert.ok(r.resumen_para_decir.includes("Combo camilla"));
  assert.ok(r.resumen_para_decir.includes("gasto no está disponible"));
  assert.equal(peticiones.length, 0, "sin llave no se llama a Meta");
});

await prueba("con llave de Meta: calcula el costo por venta y solo hace GET", async () => {
  process.env.META_ADS_ACCESS_TOKEN = "falsa";
  process.env.META_ADS_ACCOUNT_ID = "123";
  const r = await mcp.ejecutarHerramientaMcpVentasPorCampana("ventas_por_campana", { desde: "2026-10-01", hasta: "2026-10-26" }, alex);
  assert.equal(r.gasto_disponible, true);
  assert.equal(r.campanas[0].gasto, 300000);
  assert.equal(r.campanas[0].costo_por_venta, 300000);
  assert.equal(r.desde, "2026-10-01");
  assert.ok(peticiones.length > 0 && peticiones.every((p) => p.metodo === "GET" && p.url.includes("graph.facebook.com")));
  delete process.env.META_ADS_ACCESS_TOKEN;
  delete process.env.META_ADS_ACCOUNT_ID;
});

await prueba("solo lee: ninguna escritura en la base", () => {
  assert.deepEqual(db.escrituras, []);
  assert.ok(db.consultas.every((c) => c.endsWith("findMany")));
});

await prueba("fechas inválidas dan un error claro", async () => {
  await assert.rejects(mcp.ejecutarHerramientaMcpVentasPorCampana("ventas_por_campana", { desde: "ayer" }, alex), /AAAA-MM-DD/);
});

await prueba("una asesora o un intruso no pueden usarla", async () => {
  await assert.rejects(mcp.ejecutarHerramientaMcpVentasPorCampana("ventas_por_campana", {}, { workspaceId: WS, userId: "asesora" }), /no tiene permiso/);
  await assert.rejects(mcp.ejecutarHerramientaMcpVentasPorCampana("ventas_por_campana", {}, { workspaceId: WS, userId: "intruso" }), /no tiene permiso/);
});

console.log(`\n${pruebas} pruebas ok, ${fallas.length} con falla`);
if (fallas.length) {
  console.log("Fallaron:", fallas.join(" | "));
  process.exit(1);
}
