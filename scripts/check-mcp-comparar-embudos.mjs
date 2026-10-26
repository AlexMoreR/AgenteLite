// Pruebas de la herramienta MCP `comparar_embudos` (src/lib/mcp/comparar-embudos.ts): sale en la
// lista, solo lee, usa el negocio de la clave (nunca uno pasado por argumento) y el texto dice qué
// versión vende más. Con una base de mentira (sin red ni base real). Correr: npm run test:mcp-comparar-embudos
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

function fila(i, version, avance) {
  return {
    id: `c${version}-${i}`, canalId: "L1", canal: "Ventas 1", entradaEn: hace(10), anuncioId: "ad1", anuncioTitulo: "Combo camilla",
    productoEntrada: null, productoActual: "combo-camilla", productoInteres: "combo-camilla", libroVersionEntrada: version,
    temperatura: avance >= 3 ? "CALIENTE" : "FRIO", cotizacionEn: null, cotizacionRef: null, anticipoEn: null,
    ventaEn: null, crmStage: avance >= 4 ? "GANADO" : "NUEVO", wonAt: avance >= 4 ? hace(8) : null,
    respondio: avance >= 1, dioCiudad: avance >= 2,
  };
}
// Versión 3: 100 chats, 2 compran. Versión 4: 100 chats, 9 compran.
const filas = [];
for (let i = 0; i < 100; i += 1) filas.push(fila(i, 3, i < 2 ? 4 : i < 10 ? 2 : i < 40 ? 1 : 0));
for (let i = 0; i < 100; i += 1) filas.push(fila(i, 4, i < 9 ? 4 : i < 30 ? 3 : i < 60 ? 2 : i < 80 ? 1 : 0));

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
const mcp = cargar("src/lib/mcp/comparar-embudos.ts", mocks);

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

await prueba("sale en la lista del MCP y está registrada", () => {
  assert.equal(mcp.HERRAMIENTAS_MCP_COMPARAR_EMBUDOS[0].name, "comparar_embudos");
  assert.equal(mcp.HERRAMIENTAS_MCP_COMPARAR_EMBUDOS[0].annotations.readOnlyHint, true);
  assert.equal(mcp.esHerramientaDeCompararEmbudos("comparar_embudos"), true);
  const fuente = fs.readFileSync(`${RAIZ}/src/lib/mcp/herramientas.ts`, "utf8");
  assert.ok(fuente.includes("...HERRAMIENTAS_MCP_COMPARAR_EMBUDOS"));
  assert.ok(fuente.includes("ejecutarHerramientaMcpCompararEmbudos(nombre, args, contexto)"));
});

await prueba("no acepta un negocio por argumento", () => {
  const props = mcp.HERRAMIENTAS_MCP_COMPARAR_EMBUDOS[0].inputSchema.properties;
  assert.ok(!("workspaceId" in props) && !("negocio" in props));
});

await prueba("compara las dos versiones con más chats y dice cuál vende más", async () => {
  const r = await mcp.ejecutarHerramientaMcpCompararEmbudos("comparar_embudos", {}, alex);
  assert.equal(r.version_que_vende_mas, "Versión 4");
  assert.equal(r.version_a.version, 3);
  assert.equal(r.version_b.tasaCierre, 9);
  assert.equal(r.version_a.tasaCierre, 2);
  assert.ok(r.resumen_para_decir.startsWith("Versión 4 vende más"));
  assert.ok(r.resumen_para_decir.includes("se cae sobre todo entre"));
  assert.equal(r.diferencia_de_b_frente_a_a.cierre, "+7 puntos");
});

await prueba("solo lee y usa el negocio de la clave", () => {
  assert.deepEqual(db.escrituras, []);
  assert.ok(db.consultas.length > 0 && db.consultas.every((c) => c.valores.includes(WS)));
  assert.ok(db.consultas.every((c) => /^\s*SELECT/i.test(c.texto)));
});

await prueba("versiones pedidas a mano, incluida 'sin'", async () => {
  const r = await mcp.ejecutarHerramientaMcpCompararEmbudos("comparar_embudos", { version_a: "4", version_b: "3" }, alex);
  assert.equal(r.version_que_vende_mas, "Versión 4");
  assert.equal(r.version_a.version, 4);
  const sin = await mcp.ejecutarHerramientaMcpCompararEmbudos("comparar_embudos", { version_a: "3", version_b: "sin" }, alex);
  assert.equal(sin.version_b.chats, 0);
  assert.ok(sin.avisos.some((a) => a.includes("Faltan datos")));
});

await prueba("argumentos inválidos dan un error claro", async () => {
  await assert.rejects(mcp.ejecutarHerramientaMcpCompararEmbudos("comparar_embudos", { desde: "ayer" }, alex), /AAAA-MM-DD/);
  await assert.rejects(mcp.ejecutarHerramientaMcpCompararEmbudos("comparar_embudos", { producto: "zapatos" }, alex), /No reconozco/);
  await assert.rejects(mcp.ejecutarHerramientaMcpCompararEmbudos("comparar_embudos", { version_a: "x" }, alex), /version_a/);
  await assert.rejects(mcp.ejecutarHerramientaMcpCompararEmbudos("comparar_embudos", { origen: "radio" }, alex), /origen/);
});

await prueba("una asesora no puede usarla", async () => {
  await assert.rejects(mcp.ejecutarHerramientaMcpCompararEmbudos("comparar_embudos", {}, { workspaceId: WS, userId: "asesora" }), /no tiene permiso/);
  await assert.rejects(mcp.ejecutarHerramientaMcpCompararEmbudos("comparar_embudos", {}, { workspaceId: WS, userId: "intruso" }), /no tiene permiso/);
});

await prueba("con el embudo apagado avisa y no lee los chats", async () => {
  // El interruptor se recuerda un minuto: se prueba con otro negocio.
  db.apagado = true;
  MEMBRESIAS.set("ws9:alex", { role: "OWNER", user: { role: "CLIENTE" }, workspace: { ownerId: "alex" } });
  const antes = db.consultas.length;
  const r = await mcp.ejecutarHerramientaMcpCompararEmbudos("comparar_embudos", {}, { workspaceId: "ws9", userId: "alex" });
  assert.ok(r.resumen_para_decir.includes("apagado"));
  assert.equal(db.consultas.length, antes);
});

console.log(`\n${pruebas} pruebas ok, ${fallas.length} con falla`);
if (fallas.length) {
  console.log("Fallaron:", fallas.join(" | "));
  process.exit(1);
}
