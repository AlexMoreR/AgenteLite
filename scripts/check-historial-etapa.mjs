// Pruebas del HISTORIAL DE ETAPAS del CRM (Embudo 1) con un prisma FALSO en memoria.
// Carga el src/lib/historial-etapa.ts REAL, las funciones REALES del bot (crm-stage-sync.ts) y la
// herramienta REAL del MCP listar_conversaciones. No necesita base ni red.
// Además revisa el código: falla si un archivo cambia `crmStage` sin llamar a registrarCambioDeEtapa.
// Correr: npm run test:historial-etapa
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

/* ------------------------------------------------------------------ prisma falso */

const estado = { historial: [], contactos: new Map(), falla: false, ultimoWhere: null, historialDelContacto: [] };
const prismaFalso = {
  historialEtapa: {
    create: async ({ data }) => {
      if (estado.falla) throw new Error("base caída");
      estado.historial.push({ ...data, creadoEn: new Date() });
    },
    createMany: async ({ data }) => {
      if (estado.falla) throw new Error("base caída");
      data.forEach((d) => estado.historial.push({ ...d, creadoEn: new Date() }));
      return { count: data.length };
    },
  },
  contact: {
    // Una copia, como la base: el UPDATE posterior no puede cambiar lo que ya se leyó.
    findFirst: async ({ where }) => (estado.contactos.has(where.id) ? { ...estado.contactos.get(where.id) } : null),
    update: async ({ where, data }) => {
      const c = estado.contactos.get(where.id);
      if (data.crmStage) c.crmStage = data.crmStage;
    },
    count: async () => 0,
  },
  $executeRaw: async (_texto, ...valores) => {
    // Los UPDATE del bot: el contacto va en el último valor o el destino en el primero (enum).
    const destino = valores.find((v) => typeof v === "string" && /^(CALIFICADO|PROPUESTA|NEGOCIACION)$/.test(v));
    const id = valores.find((v) => typeof v === "string" && estado.contactos.has(v));
    if (destino && id) estado.contactos.get(id).crmStage = destino;
    return 1;
  },
};
const mocks = {
  "@/lib/prisma": { prisma: prismaFalso },
  "@/features/seguimientos/services/follows": { createFollowsFromRulesForSource: async () => undefined },
  "@/lib/conversation-activity": { recordConversationActivity: async () => undefined },
};

const { registrarCambioDeEtapa, registrarCambiosDeEtapa } = cargar("src/lib/historial-etapa.ts", mocks);
const reiniciar = () => {
  estado.historial.length = 0;
  estado.falla = false;
};

/* ------------------------------------------------------------------ la función */

await prueba("cada origen (asesora, bot, automático, MCP, sistema) deja una fila con quién y cuándo", async () => {
  reiniciar();
  const origenes = ["ASESORA", "BOT", "AUTOMATICO", "MCP", "SISTEMA"];
  for (const origen of origenes) {
    const ok = await registrarCambioDeEtapa({
      workspaceId: "w1",
      contactId: "c1",
      conversationId: "ch1",
      etapaAnterior: "NUEVO",
      etapaNueva: "CALIFICADO",
      origen,
      quien: origen === "ASESORA" ? "usuaria-1" : null,
      nota: "prueba",
    });
    assert.equal(ok, true);
  }
  assert.deepEqual(estado.historial.map((f) => f.origen), origenes);
  assert.equal(estado.historial[0].quien, "usuaria-1");
  assert.ok(estado.historial.every((f) => f.creadoEn instanceof Date && f.etapaAnterior === "NUEVO" && f.etapaNueva === "CALIFICADO"));
});

await prueba("si la etapa no cambia, no se escribe fila", async () => {
  reiniciar();
  assert.equal(await registrarCambioDeEtapa({ workspaceId: "w1", contactId: "c1", etapaAnterior: "NUEVO", etapaNueva: "NUEVO", origen: "ASESORA" }), false);
  assert.equal(await registrarCambiosDeEtapa([{ workspaceId: "w1", contactId: "c1", etapaAnterior: "GANADO", etapaNueva: "GANADO", origen: "SISTEMA" }]), 0);
  assert.equal(estado.historial.length, 0);
});

await prueba("si la base falla, no lanza y no bloquea el cambio", async () => {
  reiniciar();
  estado.falla = true;
  const silencio = console.error;
  console.error = () => undefined;
  try {
    assert.equal(await registrarCambioDeEtapa({ workspaceId: "w1", contactId: "c1", etapaNueva: "PERDIDO", origen: "AUTOMATICO" }), false);
    assert.equal(await registrarCambiosDeEtapa([{ workspaceId: "w1", contactId: "c1", etapaNueva: "NUEVO", origen: "SISTEMA" }]), 0);
  } finally {
    console.error = silencio;
  }
});

await prueba("vaciar el CRM escribe todas las filas en una sola instrucción", async () => {
  reiniciar();
  const cambios = Array.from({ length: 50 }, (_, i) => ({ workspaceId: "w1", contactId: `c${i}`, etapaAnterior: "GANADO", etapaNueva: "NUEVO", origen: "SISTEMA", nota: "vaciar CRM" }));
  let llamadas = 0;
  const original = prismaFalso.historialEtapa.createMany;
  prismaFalso.historialEtapa.createMany = async (a) => (llamadas++, original(a));
  assert.equal(await registrarCambiosDeEtapa(cambios), 50);
  prismaFalso.historialEtapa.createMany = original;
  assert.equal(llamadas, 1);
});

/* ------------------------------------------------------------------ el bot (funciones reales) */

const sync = cargar("src/lib/crm-stage-sync.ts", mocks);
const charla = { workspaceId: "w1", contactId: "c1", conversationId: "ch1", channelId: null };

await prueba("moverEtapaDesdeAgente (regla del agente) deja una fila BOT", async () => {
  reiniciar();
  estado.contactos.set("c1", { id: "c1", crmStage: "NUEVO", excludedFromCrm: false, metadata: {} });
  const r = await sync.moverEtapaDesdeAgente({ ...charla, etapa: "Caliente" });
  assert.ok(r.etapa);
  assert.equal(estado.historial.length, 1);
  assert.equal(estado.historial[0].origen, "BOT");
  assert.equal(estado.historial[0].etapaAnterior, "NUEVO");
  assert.equal(estado.historial[0].etapaNueva, r.etapa);
  assert.equal(estado.historial[0].conversationId, "ch1");
});

await prueba("moverEtapaDesdeAgente sin cambio real no escribe nada", async () => {
  reiniciar();
  estado.contactos.set("c1", { id: "c1", crmStage: "GANADO", excludedFromCrm: false, metadata: {} });
  const r = await sync.moverEtapaDesdeAgente({ ...charla, etapa: "Tibio" });
  assert.equal(r.etapa, null);
  assert.equal(estado.historial.length, 0);
});

await prueba("marcarCierreDeCompra deja una fila BOT hacia Negociación", async () => {
  reiniciar();
  estado.contactos.set("c1", { id: "c1", crmStage: "CALIFICADO", excludedFromCrm: false, metadata: {} });
  assert.equal(await sync.marcarCierreDeCompra(charla), true);
  assert.equal(estado.historial.length, 1);
  assert.deepEqual([estado.historial[0].origen, estado.historial[0].etapaAnterior, estado.historial[0].etapaNueva], ["BOT", "CALIFICADO", "NEGOCIACION"]);
  // Ya en Caliente: no avanza, no hay fila nueva.
  estado.contactos.get("c1").crmStage = "NEGOCIACION";
  await sync.marcarCierreDeCompra(charla);
  assert.equal(estado.historial.length, 1);
});

/* ------------------------------------------------------------------ MCP: listar_conversaciones */

const modulosVacios = {
  "@/features/flows/services/getCreatedFlowItems": { getCreatedFlowItems: async () => [] },
  "@/lib/agent-product-flow": { getFlowReply: () => null },
  "@/lib/workspace-business-config": { parseWorkspaceBusinessConfig: () => ({}) },
  "@/lib/mcp/agente-v3": { HERRAMIENTAS_MCP_V3: [], ejecutarHerramientaMcpV3: async () => null, esHerramientaV3: () => false },
  "@/lib/mcp/productos": { HERRAMIENTAS_MCP_PRODUCTOS: [], ejecutarHerramientaMcpProductos: async () => null, esHerramientaDeProductos: () => false },
  "@/lib/mcp/que-es-esta-aplicacion": { HERRAMIENTAS_MCP_APLICACION: [], ejecutarHerramientaMcpAplicacion: async () => null, esHerramientaDeLaAplicacion: () => false },
  "@/lib/mcp/diagrama-del-agente": { HERRAMIENTAS_MCP_DIAGRAMA: [], ejecutarHerramientaMcpDiagrama: async () => null, esHerramientaDeDiagrama: () => false },
  "@/lib/mcp/escritura": { HERRAMIENTAS_MCP_ESCRITURA: [], ejecutarHerramientaMcpEscritura: async () => null, esHerramientaDeEscritura: () => false },
  "@/lib/mcp/supervisor": { HERRAMIENTAS_MCP_SUPERVISOR: [], ejecutarHerramientaMcpSupervisor: async () => null, esHerramientaDelSupervisor: () => false },
  "@/lib/mcp/reuniones": { HERRAMIENTAS_MCP_REUNIONES: [], ejecutarHerramientaMcpReuniones: async () => null, esHerramientaDeReuniones: () => false },
  "@/lib/mcp/tableros-inteligentes": { HERRAMIENTAS_MCP_TABLEROS: [], ejecutarHerramientaMcpTableros: async () => null, esHerramientaDeTableros: () => false },
};
const ahora = new Date("2026-10-25T15:00:00Z");
let conversacionesFalsas = [];
const prismaMcp = {
  tag: { findMany: async () => [] },
  conversation: {
    findMany: async ({ where }) => {
      estado.ultimoWhere = where;
      return conversacionesFalsas;
    },
  },
  message: { groupBy: async () => [] },
  contact: { count: async () => 0 },
};
const mcp = cargar("src/lib/mcp/herramientas.ts", { ...modulosVacios, "@/lib/prisma": { prisma: prismaMcp } });
const fila = (id, crmStage, historialEtapas) => ({
  id,
  status: "OPEN",
  lastMessageAt: ahora,
  automationPaused: false,
  channel: { id: "l1", name: "Línea" },
  assignedTo: null,
  contact: { name: id, phoneNumber: "57300", crmStage, excludedFromCrm: false, ContactTag: [], historialEtapas },
});

await prueba("listar_conversaciones usa la fecha real cuando hay fila y la aproximada cuando no", async () => {
  conversacionesFalsas = [
    fila("con-historial", "NEGOCIACION", [{ etapaNueva: "NEGOCIACION", creadoEn: new Date("2026-10-24T14:30:00Z") }]),
    fila("sin-historial", "PROPUESTA", []),
    fila("historial-de-otra-etapa", "PERDIDO", [{ etapaNueva: "CALIFICADO", creadoEn: new Date("2026-10-20T14:30:00Z") }]),
  ];
  const r = await mcp.ejecutarHerramientaMcp("listar_conversaciones", { dias: 3 }, { workspaceId: "w1", userId: "u1" });
  const por = Object.fromEntries(r.conversaciones.map((c) => [c.contacto, c]));
  assert.equal(por["con-historial"].etapa_desde_tipo, "real");
  assert.equal(por["con-historial"].etapa_desde, "2026-10-24 09:30");
  assert.equal(por["sin-historial"].etapa_desde_tipo, "aproximada");
  assert.equal(por["sin-historial"].etapa_desde, undefined);
  assert.equal(por["historial-de-otra-etapa"].etapa_desde_tipo, "aproximada");
  assert.match(r.fechado_por.NEGOCIACION, /fecha real del cambio de etapa/);
  assert.match(r.fechado_por.NEGOCIACION, /aproximado/);
});

await prueba("el filtro por etapa usa el historial y cae a updatedAt solo si no hay fila de esa etapa", async () => {
  conversacionesFalsas = [];
  await mcp.ejecutarHerramientaMcp("listar_conversaciones", { etapa: "PERDIDO,GANADO", desde: "2026-10-01", hasta: "2026-10-31" }, { workspaceId: "w1", userId: "u1" });
  const [perdido, ganado] = estado.ultimoWhere.contact.AND[0].OR;
  assert.equal(perdido.crmStage, "PERDIDO");
  const [real, aproximada] = perdido.OR;
  assert.ok(real.historialEtapas.some.creadoEn.gte instanceof Date);
  assert.equal(real.historialEtapas.some.etapaNueva, "PERDIDO");
  assert.ok(aproximada.updatedAt.gte instanceof Date);
  assert.deepEqual(aproximada.historialEtapas, { none: { etapaNueva: "PERDIDO" } });
  // Ganado sigue con su fecha real de venta.
  assert.ok(ganado.wonAt.gte instanceof Date);
});

/* ------------------------------------------------------------------ cobertura del código */

// Archivos que escriben `crmStage` a propósito sin registrar, con el motivo:
const EXCEPCIONES = {
  "src/lib/fusionar-chat-duplicado.ts": "la fusión solo copia la etapa entre dos fichas, no la cambia (y es un archivo de chats protegido)",
  "src/lib/historial-etapa.ts": "es el propio registro",
};

function archivos(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = path.join(dir, e.name);
    if (e.isDirectory()) return archivos(ruta);
    return /\.(ts|tsx)$/.test(e.name) ? [ruta] : [];
  });
}

// Escritura de crmStage: SQL ("crmStage" = ...) o prisma (crmStage: ... dentro de data / create).
const ESCRIBE_SQL = /SET\s+"crmStage"\s*=/;
const ESCRIBE_PRISMA = /contact\.(update|updateMany|upsert)\(\{[\s\S]{0,400}?\bcrmStage\s*:|\?\s*\{\s*crmStage\s*:\s*"[A-Z]+"\s+as\s+CrmStage\s*\}/;

await prueba("cobertura: todo archivo que cambia crmStage llama a registrarCambioDeEtapa", async () => {
  const sinRegistrar = [];
  for (const ruta of archivos(path.join(RAIZ, "src"))) {
    const rel = path.relative(RAIZ, ruta).replaceAll("\\", "/");
    const codigo = fs.readFileSync(ruta, "utf8");
    if (!ESCRIBE_SQL.test(codigo) && !ESCRIBE_PRISMA.test(codigo)) continue;
    if (EXCEPCIONES[rel]) continue;
    if (!/registrarCambio(s)?DeEtapa/.test(codigo)) sinRegistrar.push(rel);
  }
  assert.deepEqual(sinRegistrar, [], `escriben crmStage sin registrar el historial: ${sinRegistrar.join(", ")}`);
});

await prueba("cobertura: los 9 archivos que se sabe que mueven la etapa sí registran", async () => {
  const esperados = [
    "src/app/actions/crm-actions.ts",
    "src/app/actions/workspace-actions.ts",
    "src/lib/crm-stage-sync.ts",
    "src/features/crm/services/lead-temperature.ts",
    "src/features/crm/services/descarte-automatico.ts",
    "src/features/llamadas/services/lead-cooldown.ts",
    "src/features/automatizaciones/servicio.ts",
    "src/features/seguimiento-inteligente/servicios/motor.ts",
    "src/features/seguimiento-inteligente/servicios/recuperacion.ts",
  ];
  for (const rel of esperados) {
    const codigo = fs.readFileSync(path.join(RAIZ, rel), "utf8");
    assert.match(codigo, /registrarCambio(s)?DeEtapa\(/, rel);
  }
});

console.log(`\n${pruebas} pruebas OK`);
