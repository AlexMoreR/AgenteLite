// Pruebas de ver_asignacion y cambiar_asignacion por MCP (T-772, parte 4): src/lib/mcp/asignacion.ts,
// con la lógica común src/lib/asignacion-del-negocio.ts y el historial con vuelta atrás
// src/lib/mcp/cambios.ts (lo que usan listar_cambios y deshacer_cambio). Sin base ni red: una base
// simulada en memoria. Correr: npm run test:mcp-asignacion
import assert from "node:assert/strict";

import { cargar } from "./supervisor-cargar.mjs";

// ── Base simulada ───────────────────────────────────────────────────────────────────────────────
const NEGOCIO = "negocio-1";
const estado = { settings: new Map(), canales: [], miembros: [] };

function reiniciar() {
  estado.settings = new Map();
  estado.canales = [
    {
      id: "linea-ventas",
      workspaceId: NEGOCIO,
      name: "Ventas 1",
      purpose: "SALES",
      createdAt: new Date("2026-01-01"),
      metadata: { collaboratorIds: ["ingrid", "camila", "jair", "monitora"], monitorIds: ["monitora"], pausedAssignmentIds: ["jair"], otra: 1 },
    },
    { id: "linea-abierta", workspaceId: NEGOCIO, name: "Abierta", purpose: "SALES", createdAt: new Date("2026-01-02"), metadata: {} },
    {
      id: "linea-admin",
      workspaceId: NEGOCIO,
      name: "Admin",
      purpose: "ADMIN",
      createdAt: new Date("2026-01-03"),
      metadata: { collaboratorIds: ["ingrid"] },
    },
    {
      id: "linea-de-otro",
      workspaceId: "otro-negocio",
      name: "Ajena",
      purpose: "SALES",
      createdAt: new Date("2026-01-04"),
      metadata: { collaboratorIds: ["ingrid"] },
    },
  ];
  estado.miembros = [
    { workspaceId: NEGOCIO, userId: "alex", role: "OWNER", isActive: true, nombre: "Alexander" },
    { workspaceId: NEGOCIO, userId: "ingrid", role: "MEMBER", isActive: true, nombre: "Ingrid" },
    { workspaceId: NEGOCIO, userId: "camila", role: "MEMBER", isActive: true, nombre: "María Camila" },
    { workspaceId: NEGOCIO, userId: "jair", role: "MEMBER", isActive: true, nombre: "Jair" },
    { workspaceId: NEGOCIO, userId: "monitora", role: "MEMBER", isActive: true, nombre: "Monitora" },
  ];
  estado.settings.set(`chats:demora-asesora:config:${NEGOCIO}`, JSON.stringify({ activo: true, minutosAviso: 5, minutosReasignar: 10, minutosActiva: 3 }));
  rcn?.olvidarConfigsDeAsignacion();
}

/** Todo lo que el cambio puede tocar, sin el historial del MCP ni el de la demora. */
function foto() {
  return structuredClone({
    config: estado.settings.get(`reparto:cuando:${NEGOCIO}`) ?? null,
    demora: estado.settings.get(`chats:demora-asesora:config:${NEGOCIO}`) ?? null,
    canales: estado.canales.map((c) => ({ id: c.id, metadata: c.metadata })),
  });
}

const prisma = {
  appSetting: {
    findUnique: async ({ where }) => (estado.settings.has(where.key) ? { key: where.key, value: estado.settings.get(where.key) } : null),
    upsert: async ({ where, create, update }) => {
      estado.settings.set(where.key, estado.settings.has(where.key) ? update.value : create.value);
      return {};
    },
  },
  whatsAppChannel: {
    findMany: async ({ where }) =>
      estado.canales
        .filter((c) => c.workspaceId === where.workspaceId && c.purpose !== where.NOT?.purpose)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((c) => structuredClone({ id: c.id, name: c.name, metadata: c.metadata })),
    update: async ({ where, data }) => {
      const canal = estado.canales.find((c) => c.id === where.id);
      if (!canal) throw new Error("no existe");
      canal.metadata = structuredClone(data.metadata);
      return {};
    },
  },
  workspaceMember: {
    findMany: async ({ where }) =>
      estado.miembros
        .filter((m) => m.workspaceId === where.workspaceId && m.isActive === where.isActive)
        .map((m) => ({ userId: m.userId, user: { name: m.nombre, email: null } })),
    findFirst: async ({ where }) => {
      const m = estado.miembros.find((x) => x.workspaceId === where.workspaceId && x.userId === where.userId && x.isActive);
      return m ? { role: m.role, user: { role: "CLIENT", name: m.nombre }, workspace: { ownerId: "alex" } } : null;
    },
  },
};

const mocks = {
  "@/lib/prisma": { prisma },
  "@/features/embudo/servicios/versiones": { registrarVersionProtegido: async () => {} },
};

const rcn = cargar("src/lib/reparto-cuando-lo-necesita.ts", mocks);
const mcp = cargar("src/lib/mcp/asignacion.ts", mocks);
const cambios = cargar("src/lib/mcp/cambios.ts", mocks);

const DUENO = { workspaceId: NEGOCIO, userId: "alex" };
const ASESORA = { workspaceId: NEGOCIO, userId: "ingrid" };
const ver = (contexto = DUENO) => mcp.ejecutarHerramientaMcpAsignacion("ver_asignacion", {}, contexto);
const cambiar = (args, contexto = DUENO) => mcp.ejecutarHerramientaMcpAsignacion("cambiar_asignacion", args, contexto);

const PEDIDO = {
  interruptores: { clienta_pregunta_plata_o_entrega: false },
  lineas: [{ linea_id: "linea-ventas", fuera: ["camila"] }],
  minutos_avisar: 7,
  minutos_pasar_a_otra: 15,
};

let pruebas = 0;
async function prueba(nombre, fn) {
  reiniciar();
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

// ── Las herramientas existen y están registradas ────────────────────────────────────────────────
await prueba("las dos herramientas están en la lista; ver es de solo lectura", async () => {
  const nombres = mcp.HERRAMIENTAS_MCP_ASIGNACION.map((h) => h.name);
  assert.deepEqual(nombres, ["ver_asignacion", "cambiar_asignacion"]);
  assert.equal(mcp.HERRAMIENTAS_MCP_ASIGNACION[0].annotations.readOnlyHint, true);
  assert.equal(mcp.HERRAMIENTAS_MCP_ASIGNACION[1].annotations.readOnlyHint, false);
  const fs = await import("node:fs");
  const registro = fs.readFileSync(new URL("../src/lib/mcp/herramientas.ts", import.meta.url), "utf8");
  assert.match(registro, /\.\.\.HERRAMIENTAS_MCP_ASIGNACION/);
  assert.match(registro, /esHerramientaDeAsignacion\(nombre\)/);
});

// ── ver_asignacion ──────────────────────────────────────────────────────────────────────────────
await prueba("ver_asignacion: interruptores, asesoras por línea de ventas y minutos", async () => {
  const vista = await ver();
  assert.deepEqual(vista.interruptores, {
    agente_pide: true,
    clienta_pregunta_plata_o_entrega: true,
    asesora_escribe: true,
    como_antes: false,
  });
  assert.match(vista.cuando_se_asigna, /^cuando lo necesita: el agente pide asesora/);
  // Solo líneas de ventas de este negocio; la monitora no sale.
  assert.deepEqual(vista.lineas.map((l) => l.linea_id), ["linea-ventas", "linea-abierta"]);
  assert.deepEqual(vista.lineas[0].asesoras, [
    { id: "ingrid", nombre: "Ingrid", reparto: "en el reparto" },
    { id: "camila", nombre: "María Camila", reparto: "en el reparto" },
    { id: "jair", nombre: "Jair", reparto: "fuera" },
  ]);
  assert.ok(vista.lineas[1].abierta);
  assert.deepEqual(vista.demora, { minutos_avisar: 5, minutos_pasar_a_otra: 10, regla: "prendida" });
});

// ── cambiar_asignacion: sin confirmar no guarda ─────────────────────────────────────────────────
await prueba("sin confirmado no guarda y muestra el antes y el después", async () => {
  const antes = foto();
  const r = await cambiar(PEDIDO);
  assert.equal(r.guardado, false);
  assert.equal(r.antes.interruptores.clienta_pregunta_plata_o_entrega, true);
  assert.equal(r.despues.interruptores.clienta_pregunta_plata_o_entrega, false);
  assert.deepEqual(r.antes.lineas, [{ linea_id: "linea-ventas", nombre: "Ventas 1", fuera_del_reparto: ["Jair"] }]);
  assert.deepEqual(r.despues.lineas, [{ linea_id: "linea-ventas", nombre: "Ventas 1", fuera_del_reparto: ["María Camila"] }]);
  assert.equal(r.antes.minutos_avisar, 5);
  assert.equal(r.despues.minutos_pasar_a_otra, 15);
  assert.deepEqual(foto(), antes);
  assert.equal((await cambios.listarCambiosMcp(NEGOCIO)).length, 0);
});

await prueba("con confirmado y un texto inválido no guarda", async () => {
  const antes = foto();
  for (const texto of [undefined, "", "dale", "ok, hazlo ya", "no apruebo, sí", "sí, no apruebo eso"]) {
    await assert.rejects(cambiar({ ...PEDIDO, confirmado: true, texto_confirmacion: texto }), /No se guardó nada/);
  }
  assert.deepEqual(foto(), antes);
  assert.equal((await cambios.listarCambiosMcp(NEGOCIO)).length, 0);
});

await prueba("una asesora (sin ser dueña ni administradora) no puede cambiar", async () => {
  const antes = foto();
  await assert.rejects(cambiar({ ...PEDIDO, confirmado: true, texto_confirmacion: "sí, apruebo" }, ASESORA), /Solo el dueño o un administrador/);
  await assert.rejects(cambiar(PEDIDO, ASESORA), /Solo el dueño o un administrador/);
  await assert.rejects(cambiar(PEDIDO, { workspaceId: NEGOCIO, userId: "extraño" }), /Solo el dueño o un administrador/);
  assert.deepEqual(foto(), antes);
});

await prueba("minutos de 1 a 120, enteros y pasar a otra mayor que avisar", async () => {
  const antes = foto();
  for (const malo of [0, 121, 7.5, "7", -3]) {
    await assert.rejects(cambiar({ minutos_avisar: malo, confirmado: true, texto_confirmacion: "sí, apruebo" }), /de 1 a 120/);
  }
  await assert.rejects(cambiar({ minutos_pasar_a_otra: 4, confirmado: true, texto_confirmacion: "sí, apruebo" }), /más que los del aviso/);
  assert.deepEqual(foto(), antes);
  // Los bordes sirven.
  const r = await cambiar({ minutos_avisar: 1, minutos_pasar_a_otra: 120 });
  assert.equal(r.despues.minutos_avisar, 1);
  assert.equal(r.despues.minutos_pasar_a_otra, 120);
});

await prueba("líneas, asesoras e interruptores que no existen dan error y no guardan", async () => {
  const antes = foto();
  const si = { confirmado: true, texto_confirmacion: "sí, apruebo" };
  await assert.rejects(cambiar({ lineas: [{ linea_id: "linea-de-otro", fuera: [] }], ...si }), /no es una línea de ventas de este negocio/);
  await assert.rejects(cambiar({ lineas: [{ linea_id: "linea-admin", fuera: [] }], ...si }), /no es una línea de ventas/);
  await assert.rejects(cambiar({ lineas: [{ linea_id: "linea-abierta", fuera: [] }], ...si }), /se arma en Conexión/);
  await assert.rejects(cambiar({ lineas: [{ linea_id: "linea-ventas", fuera: ["monitora"] }], ...si }), /no son asesoras del reparto: monitora/);
  await assert.rejects(cambiar({ lineas: [{ linea_id: "linea-ventas", fuera: ["alguien"] }], ...si }), /no son asesoras/);
  await assert.rejects(cambiar({ interruptores: { inventado: true }, ...si }), /No existe el interruptor/);
  await assert.rejects(cambiar({ interruptores: { como_antes: "si" }, ...si }), /true o false/);
  await assert.rejects(cambiar({ interruptores: { agente_pide: true }, ...si }), /Ya está así/);
  assert.deepEqual(foto(), antes);
});

// ── Guardar, listar_cambios y deshacer_cambio ───────────────────────────────────────────────────
await prueba("con texto válido guarda, aparece en listar_cambios y deshacer_cambio lo deja como estaba", async () => {
  const antes = foto();
  const r = await cambiar({ ...PEDIDO, confirmado: true, texto_confirmacion: "Sí, apruebo" });
  assert.equal(r.guardado, true);
  assert.ok(r.cambio_id);

  // Quedó guardado: interruptores, reparto (sin tocar colaboradoras, monitoras ni lo demás) y minutos.
  assert.deepEqual(JSON.parse(estado.settings.get(`reparto:cuando:${NEGOCIO}`)), {
    agentePide: true,
    clientaPreguntaPlataOEntrega: false,
    asesoraEscribe: true,
    comoAntes: false,
  });
  const linea = estado.canales.find((c) => c.id === "linea-ventas");
  assert.deepEqual(linea.metadata.pausedAssignmentIds, ["camila"]);
  assert.deepEqual(linea.metadata.collaboratorIds, ["ingrid", "camila", "jair", "monitora"]);
  assert.equal(linea.metadata.otra, 1);
  const demora = JSON.parse(estado.settings.get(`chats:demora-asesora:config:${NEGOCIO}`));
  assert.deepEqual(demora, { activo: true, minutosAviso: 7, minutosReasignar: 15, minutosActiva: 3 });
  const historialDemora = JSON.parse(estado.settings.get(`chats:demora-asesora:historial:${NEGOCIO}`));
  assert.equal(historialDemora.length, 1);
  assert.deepEqual(historialDemora[0].antes, { activo: true, minutosAviso: 5, minutosReasignar: 10 });
  // La memoria de un minuto del reparto se olvidó en este proceso: ya lee lo nuevo.
  assert.equal((await rcn.leerConfigDeAsignacion(NEGOCIO)).clientaPreguntaPlataOEntrega, false);
  assert.match((await ver()).cuando_se_asigna, /^cuando lo necesita: el agente pide asesora o pausa la IA; una asesora escribe/);

  // listar_cambios: con la foto del antes.
  const lista = await cambios.listarCambiosMcp(NEGOCIO);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].id, r.cambio_id);
  assert.equal(lista[0].tabla, "Asignacion");
  assert.equal(lista[0].filaId, NEGOCIO);
  assert.match(lista[0].titulo, /^Asignación de chats: cuándo se asigna; reparto de Ventas 1; minutos 5\/10 → 7\/15$/);
  assert.equal(lista[0].antes.interruptores.clientaPreguntaPlataOEntrega, true);
  assert.deepEqual(lista[0].antes.lineas, [{ id: "linea-ventas", nombre: "Ventas 1", pausados: ["jair"] }]);
  assert.equal(lista[0].antes.minutosAviso, 5);

  // deshacer_cambio: todo como estaba (la fila de interruptores queda con los valores de antes).
  const deshecho = await cambios.deshacerCambioMcp(NEGOCIO, r.cambio_id, { id: "alex", nombre: "Claude (MCP)" });
  assert.equal(deshecho.ok, true, deshecho.error);
  const despues = foto();
  assert.deepEqual(JSON.parse(despues.config), { agentePide: true, clientaPreguntaPlataOEntrega: true, asesoraEscribe: true, comoAntes: false });
  assert.deepEqual(despues.canales, antes.canales);
  assert.deepEqual(JSON.parse(despues.demora), JSON.parse(antes.demora));
  assert.equal((await rcn.leerConfigDeAsignacion(NEGOCIO)).clientaPreguntaPlataOEntrega, true);
  assert.equal((await cambios.listarCambiosMcp(NEGOCIO))[0].deshecho, true);
  // Volver los minutos también queda en su historial.
  assert.equal(JSON.parse(estado.settings.get(`chats:demora-asesora:historial:${NEGOCIO}`)).length, 2);
  // Dos veces no.
  const otraVez = await cambios.deshacerCambioMcp(NEGOCIO, r.cambio_id);
  assert.equal(otraVez.ok, false);
});

await prueba("deshacer no pisa lo que se cambió después (por ejemplo desde la pantalla)", async () => {
  const r = await cambiar({ ...PEDIDO, confirmado: true, texto_confirmacion: "si apruebo el cambio" });
  // Alguien cambia los minutos desde Equipo > Asignación.
  estado.settings.set(`chats:demora-asesora:config:${NEGOCIO}`, JSON.stringify({ activo: true, minutosAviso: 8, minutosReasignar: 20 }));
  const antes = foto();
  const deshecho = await cambios.deshacerCambioMcp(NEGOCIO, r.cambio_id);
  assert.equal(deshecho.ok, false);
  assert.match(deshecho.error, /alguien tocó los minutos/);
  assert.deepEqual(foto(), antes);
  assert.notEqual((await cambios.listarCambiosMcp(NEGOCIO))[0].deshecho, true);
});

await prueba("de dos cambios seguidos, primero se deshace el más nuevo", async () => {
  const primero = await cambiar({ minutos_avisar: 6, confirmado: true, texto_confirmacion: "sí, apruebo" });
  await new Promise((listo) => setTimeout(listo, 5));
  const segundo = await cambiar({ interruptores: { como_antes: true }, confirmado: true, texto_confirmacion: "sí, apruebo" });
  const viejo = await cambios.deshacerCambioMcp(NEGOCIO, primero.cambio_id);
  assert.equal(viejo.ok, false);
  assert.match(viejo.error, /Deshaz primero el más nuevo/);
  assert.equal((await cambios.deshacerCambioMcp(NEGOCIO, segundo.cambio_id)).ok, true);
  assert.equal((await cambios.deshacerCambioMcp(NEGOCIO, primero.cambio_id)).ok, true);
  assert.equal(JSON.parse(estado.settings.get(`chats:demora-asesora:config:${NEGOCIO}`)).minutosAviso, 5);
  assert.equal(JSON.parse(estado.settings.get(`reparto:cuando:${NEGOCIO}`)).comoAntes, false);
});

await prueba("un cambio de asignación de otro negocio o roto no se deshace", async () => {
  const r = await cambiar({ minutos_avisar: 6, confirmado: true, texto_confirmacion: "sí, apruebo" });
  const lista = await cambios.listarCambiosMcp(NEGOCIO);
  estado.settings.set(`mcp:cambios:${NEGOCIO}`, JSON.stringify([{ ...lista[0], filaId: "otro-negocio" }]));
  const antes = foto();
  const deshecho = await cambios.deshacerCambioMcp(NEGOCIO, r.cambio_id);
  assert.equal(deshecho.ok, false);
  assert.match(deshecho.error, /no se puede leer/);
  assert.deepEqual(foto(), antes);
});

// ── Cuándo se asigna, en una frase ──────────────────────────────────────────────────────────────
await prueba("cuandoSeAsigna: como antes, cuando lo necesita y nunca sola", async () => {
  const base = { agentePide: true, clientaPreguntaPlataOEntrega: true, asesoraEscribe: true, comoAntes: false };
  assert.match(mcp.cuandoSeAsigna({ ...base, comoAntes: true }), /^como antes/);
  assert.equal(
    mcp.cuandoSeAsigna({ ...base, clientaPreguntaPlataOEntrega: false }),
    "cuando lo necesita: el agente pide asesora o pausa la IA; una asesora escribe en el chat",
  );
  assert.match(mcp.cuandoSeAsigna({ agentePide: false, clientaPreguntaPlataOEntrega: false, asesoraEscribe: false, comoAntes: false }), /^nunca sola/);
});

await prueba("que_es_esta_aplicacion lee los interruptores en vivo y, si la base falla, lo dice", async () => {
  const fs = await import("node:fs");
  const fuente = fs.readFileSync(new URL("../src/lib/mcp/que-es-esta-aplicacion.ts", import.meta.url), "utf8");
  assert.match(fuente, /reparto_por_turno: await estadoDelRepartoPorTurno\(workspaceId\)/);
  assert.match(fuente, /seguro\("reparto_por_turno"/);
});

console.log(`\n${pruebas} pruebas de ver_asignacion y cambiar_asignacion: OK`);
