// Pruebas de la herramienta MCP `actividad_del_equipo` (src/lib/mcp/actividad-del-equipo.ts): sale en la
// lista, solo lee, usa el negocio de la clave, solo la usan el dueño y los administradores, y contesta
// con la última conexión en hora de Colombia y lo que cada persona mandó desde el CRM.
// Sin red ni base real. Correr: npm run test:mcp-actividad-del-equipo
import assert from "node:assert/strict";
import fs from "node:fs";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

const WS = "ws1";
const db = { consultas: [], escrituras: [], desdes: [] };

const MEMBRESIAS = new Map([
  [`${WS}:alex`, { role: "OWNER", user: { role: "CLIENTE" }, workspace: { ownerId: "alex" } }],
  [`${WS}:admin`, { role: "ADMIN", user: { role: "ADMIN" }, workspace: { ownerId: "alex" } }],
  [`${WS}:claudia`, { role: "AGENT", user: { role: "EMPLEADO" }, workspace: { ownerId: "alex" } }],
]);
const EQUIPO = [
  { isActive: true, user: { id: "claudia", name: "Claudia Gallardo", email: "claudia@magilus.co" } },
  { isActive: true, user: { id: "maria", name: "María Peña", email: "maria@magilus.co" } },
  { isActive: true, user: { id: "jose", name: "José Ruiz", email: "jose@magilus.co" } },
];
const ahora = Date.now();
const LATIDOS = {
  // 24 nov 2026, 3:42 p. m. en Colombia: ya pasó, no está conectada.
  claudia: { cuando: "2026-11-24T20:42:00Z", ruta: "/cliente/chats", donde: "Chats · Salón Rosa", dispositivo: "Android" },
  // Hace 2 minutos: conectada ahora.
  maria: { cuando: new Date(ahora - 2 * 60_000).toISOString(), ruta: "/cliente/crm", donde: "CRM", dispositivo: "Windows" },
};
const ENVIOS = [
  { userId: "claudia", mensajes: 14n, chats: 5n, ultimoEn: new Date("2026-11-24T20:40:00Z"), cliente: "Salón Rosa", extracto: "Hola, te comparto el precio de la camilla" },
];

const METODOS_DE_ESCRITURA = ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"];
const anotar = (modelo, metodo) => async () => { db.escrituras.push(`${modelo}.${metodo}`); return {}; };
const lecturas = {
  workspaceMember: {
    findFirst: async ({ where }) => MEMBRESIAS.get(`${where.workspaceId}:${where.userId}`) ?? null,
    findMany: async ({ where }) => {
      assert.equal(where.workspaceId, WS, "el equipo sale del negocio de la clave");
      db.consultas.push("workspaceMember.findMany");
      return EQUIPO;
    },
  },
  appSetting: {
    findUnique: async ({ where }) => {
      assert.equal(where.key, `equipo:ultima-actividad:${WS}`, "los latidos salen del negocio de la clave");
      db.consultas.push("appSetting.findUnique");
      return { value: JSON.stringify(LATIDOS) };
    },
  },
  $queryRaw: async (partes, ...valores) => {
    assert.equal(valores[0], WS, "los mensajes salen del negocio de la clave");
    assert.ok(valores[1] instanceof Date, "la consulta va acotada por fecha");
    db.consultas.push("$queryRaw");
    db.desdes.push(valores[1]);
    return ENVIOS;
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

const mcp = cargar("src/lib/mcp/actividad-del-equipo.ts", mocks);
const ejecutar = (args, contexto) => mcp.ejecutarHerramientaMcpActividadDelEquipo("actividad_del_equipo", args, contexto);

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
const admin = { workspaceId: WS, userId: "admin" };

await prueba("sale en la lista del MCP, es de solo lectura y está registrada", () => {
  const h = mcp.HERRAMIENTAS_MCP_ACTIVIDAD_DEL_EQUIPO[0];
  assert.equal(h.name, "actividad_del_equipo");
  assert.equal(h.annotations.readOnlyHint, true);
  assert.ok(!("workspaceId" in h.inputSchema.properties), "el negocio no se pide como argumento");
  assert.match(h.description, /NO el inicio de sesion/);
  assert.equal(mcp.esHerramientaDeActividadDelEquipo("actividad_del_equipo"), true);
  const fuente = fs.readFileSync(`${RAIZ}/src/lib/mcp/herramientas.ts`, "utf8");
  assert.ok(fuente.includes("...HERRAMIENTAS_MCP_ACTIVIDAD_DEL_EQUIPO"));
  assert.ok(fuente.includes("ejecutarHerramientaMcpActividadDelEquipo(nombre, args, contexto)"));
});

await prueba("el código no llama create/update/delete/upsert", () => {
  const fuente = fs.readFileSync(`${RAIZ}/src/lib/mcp/actividad-del-equipo.ts`, "utf8");
  assert.doesNotMatch(fuente, /\.(create|createMany|update|updateMany|upsert|delete|deleteMany|\$executeRaw\w*)\s*\(/);
  assert.doesNotMatch(fuente, /anotarActividad/);
});

await prueba("rechaza a quien no es dueño ni administrador", async () => {
  await assert.rejects(ejecutar({}, { workspaceId: WS, userId: "claudia" }), /no tiene permiso/);
  await assert.rejects(ejecutar({}, { workspaceId: WS, userId: "intruso" }), /no tiene permiso/);
  // El dueño de OTRO negocio tampoco entra con la clave de este.
  await assert.rejects(ejecutar({}, { workspaceId: "ws2", userId: "alex" }), /no tiene permiso/);
  const r = await ejecutar({}, admin);
  assert.equal(r.equipo.length, 3, "el administrador sí la usa");
});

await prueba("solo lee el workspaceId de la clave (aunque venga otro en los argumentos)", async () => {
  const r = await ejecutar({ workspaceId: "ws2" }, alex);
  assert.equal(r.equipo.length, 3);
});

await prueba("{persona:'claudia'} devuelve solo a Claudia Gallardo", async () => {
  const r = await ejecutar({ persona: "claudia" }, alex);
  assert.deepEqual(r.equipo.map((p) => p.nombre), ["Claudia Gallardo"]);
  // Sin importar mayúsculas ni tildes, y por correo.
  assert.deepEqual((await ejecutar({ persona: "MARIA" }, alex)).equipo.map((p) => p.nombre), ["María Peña"]);
  assert.deepEqual((await ejecutar({ persona: "josé@magilus" }, alex)).equipo.map((p) => p.nombre), ["José Ruiz"]);
  const nadie = await ejecutar({ persona: "pedro" }, alex);
  assert.deepEqual(nadie.equipo, []);
  assert.match(nadie.aviso, /No hay nadie/);
});

await prueba("última conexión en hora de Colombia, con pantalla y aparato; conectada_ahora en true y en false", async () => {
  const r = await ejecutar({}, alex);
  const claudia = r.equipo.find((p) => p.nombre === "Claudia Gallardo");
  const maria = r.equipo.find((p) => p.nombre === "María Peña");
  const jose = r.equipo.find((p) => p.nombre === "José Ruiz");
  assert.deepEqual(claudia.ultima_conexion, { cuando: "24 nov 2026, 3:42 p. m.", pantalla: "Chats · Salón Rosa", aparato: "Android" });
  assert.equal(claudia.conectada_ahora, false);
  assert.equal(maria.conectada_ahora, true);
  assert.equal(maria.ultima_conexion.aparato, "Windows");
  assert.equal(jose.ultima_conexion, null);
  assert.equal(jose.conectada_ahora, false);
});

await prueba("trae ultimo_mensaje_enviado, chats_atendidos y mensajes_enviados", async () => {
  const r = await ejecutar({ persona: "claudia" }, alex);
  const [claudia] = r.equipo;
  assert.deepEqual(claudia.ultimo_mensaje_enviado, {
    cuando: "24 nov 2026, 3:40 p. m.",
    cliente: "Salón Rosa",
    extracto: "Hola, te comparto el precio de la camilla",
  });
  assert.equal(claudia.chats_atendidos, 5);
  assert.equal(claudia.mensajes_enviados, 14);
  const jose = (await ejecutar({ persona: "jose" }, alex)).equipo[0];
  assert.equal(jose.ultimo_mensaje_enviado, null);
  assert.equal(jose.chats_atendidos, 0);
  assert.equal(jose.mensajes_enviados, 0);
});

await prueba("dias: 7 por defecto, 0 → 1 y 500 → 90", async () => {
  assert.equal(mcp.leerDias(undefined), 7);
  assert.equal(mcp.leerDias(0), 1);
  assert.equal(mcp.leerDias(500), 90);
  assert.equal(mcp.leerDias("30"), 30);
  assert.equal(mcp.leerDias("muchos"), 7);
  const r0 = await ejecutar({ dias: 0 }, alex);
  assert.equal(r0.dias, 1);
  const r500 = await ejecutar({ dias: 500 }, alex);
  assert.equal(r500.dias, 90);
  const desde = db.desdes.at(-1).getTime();
  const esperado = Date.now() - 90 * 24 * 3_600_000;
  assert.ok(Math.abs(desde - esperado) < 60_000, "la consulta se acota a 90 días");
});

await prueba("solo lee: ninguna escritura y una sola consulta de mensajes por llamada", async () => {
  db.consultas.length = 0;
  await ejecutar({}, alex);
  assert.equal(db.consultas.filter((c) => c === "$queryRaw").length, 1, "una consulta para todo el equipo, no una por persona");
  assert.deepEqual(db.escrituras, []);
});

console.log(`\n${pruebas} pruebas ok, ${fallas.length} con falla`);
if (fallas.length) {
  console.log("Fallaron:", fallas.join(" | "));
  process.exit(1);
}
