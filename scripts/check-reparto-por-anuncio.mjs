// Pruebas del REPARTO POR ANUNCIO (src/lib/reparto-por-anuncio.ts), sin base ni red.
// Correr: npm run test:reparto-por-anuncio
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { cargar, RAIZ } from "./supervisor-cargar.mjs";

// ── Base y servicios falsos ─────────────────────────────────────────────────────────────────────
const estado = {
  settings: new Map(),
  conversacion: { assignedToUserId: null },
  miembrosActivos: new Set(["yair"]),
  origenes: [],
  metaRespuesta: null,
  metaTardaMs: 0,
  metaPreguntas: 0,
  pausas: [],
  actividades: [],
  avisos: [],
  push: [],
  asignaciones: [],
};

function reiniciar() {
  estado.settings = new Map();
  estado.conversacion = { assignedToUserId: null };
  estado.miembrosActivos = new Set(["yair"]);
  estado.origenes = [];
  estado.metaRespuesta = null;
  estado.metaTardaMs = 0;
  estado.metaPreguntas = 0;
  estado.pausas = [];
  estado.actividades = [];
  estado.avisos = [];
  estado.push = [];
  estado.asignaciones = [];
}

const prisma = {
  appSetting: {
    findUnique: async ({ where }) => (estado.settings.has(where.key) ? { value: estado.settings.get(where.key) } : null),
    upsert: async ({ where, create, update }) => {
      estado.settings.set(where.key, estado.settings.has(where.key) ? update.value : create.value);
      return {};
    },
  },
  conversation: {
    findUnique: async () => ({ ...estado.conversacion }),
    updateMany: async ({ where, data }) => {
      if (where.assignedToUserId === null && estado.conversacion.assignedToUserId) return { count: 0 };
      estado.conversacion.assignedToUserId = data.assignedToUserId;
      estado.asignaciones.push(data.assignedToUserId);
      return { count: 1 };
    },
  },
  workspaceMember: {
    findFirst: async ({ where }) => (estado.miembrosActivos.has(where.userId) ? { userId: where.userId } : null),
  },
  user: { findUnique: async ({ where }) => ({ name: where.id === "yair" ? "Yair Silvera" : "Otra", email: null }) },
  origenDePauta: {
    findFirst: async ({ where }) => estado.origenes.find((o) => o.anuncioId === where.anuncioId && o.campanaId) ?? null,
    upsert: async ({ create }) => {
      if (!estado.origenes.some((o) => o.contactId === create.contactId)) estado.origenes.push(create);
      return {};
    },
  },
};

const mocks = {
  "@/lib/prisma": { prisma },
  "@/features/pauta/servicios/meta-ads-lectura": {
    buscarAnuncio: async () => {
      estado.metaPreguntas += 1;
      if (estado.metaTardaMs) await new Promise((r) => setTimeout(r, estado.metaTardaMs));
      return estado.metaRespuesta;
    },
  },
  "@/lib/conversation-automation": {
    setConversationAutomationPaused: async (input) => {
      estado.pausas.push(input);
      return true;
    },
  },
  "@/lib/conversation-activity": {
    recordConversationActivity: async (input) => {
      estado.actividades.push(input);
    },
  },
  "@/lib/etapa-automatica-crm": { etapaAlAsignar: async () => null },
  "@/features/agente-v3/servicios/avisos": {
    avisarAsesorPorWhatsApp: async (input) => {
      estado.avisos.push(input);
      return 1;
    },
  },
  "@/lib/reparto-de-leads": {
    avisarAsignacionPorPush: async (input) => {
      estado.push.push(input);
    },
  },
};

const rpa = cargar("src/lib/reparto-por-anuncio.ts", mocks);
const {
  buscarReglaDelAnuncio,
  leerReglasDeTexto,
  esIdDeMeta,
  aplicarReglaDeAnuncio,
  campanaDelAnuncio,
  claveDeReglas,
  claveDeCampanaDelAnuncio,
  ESPERA_DE_META_MS,
} = rpa;

let pruebas = 0;
async function prueba(nombre, fn) {
  reiniciar();
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const VENTAS1 = "linea-ventas-1";
const ANUNCIO = "120210000000000001";
const CAMPANA = "120210000000000900";

function regla(parcial = {}) {
  return {
    id: `r-${Math.random().toString(36).slice(2, 8)}`,
    tipo: "campana",
    metaId: CAMPANA,
    nombre: "Salones y almacenes",
    channelId: VENTAS1,
    asignarA: "yair",
    sinBienvenida: true,
    activa: true,
    creadaEn: "2026-11-04T00:00:00Z",
    ...parcial,
  };
}

function guardar(reglas) {
  estado.settings.set(claveDeReglas("ws"), JSON.stringify(reglas));
}

const avisosInmediatos = [];
function chat(parcial = {}) {
  return {
    workspaceId: "ws",
    channelId: VENTAS1,
    conversationId: "conv-1",
    contactId: "contacto-1",
    anuncio: { id: ANUNCIO, titulo: "Salón completo", red: "facebook", ctwaClid: "clid" },
    cliente: "Cliente",
    telefonoDelCliente: "573000000000",
    enSegundoPlano: (tarea) => avisosInmediatos.push(tarea()),
    esperaDeMetaMs: 200,
    ...parcial,
  };
}
const esperarAvisos = () => Promise.all(avisosInmediatos.splice(0));

// ── Función pura ────────────────────────────────────────────────────────────────────────────────
await prueba("la regla por anuncio gana sobre la de campaña", () => {
  const porCampana = regla({ asignarA: "otra" });
  const porAnuncio = regla({ tipo: "anuncio", metaId: ANUNCIO, asignarA: "yair" });
  const elegida = buscarReglaDelAnuncio({ reglas: [porCampana, porAnuncio], channelId: VENTAS1, anuncioId: ANUNCIO, campanaId: CAMPANA });
  assert.equal(elegida.id, porAnuncio.id);
});

await prueba("una regla apagada no se aplica", () => {
  assert.equal(
    buscarReglaDelAnuncio({ reglas: [regla({ activa: false })], channelId: VENTAS1, anuncioId: ANUNCIO, campanaId: CAMPANA }),
    null,
  );
});

await prueba("una regla de otra línea no se aplica", () => {
  assert.equal(
    buscarReglaDelAnuncio({ reglas: [regla({ channelId: "ventas-2" })], channelId: VENTAS1, anuncioId: ANUNCIO, campanaId: CAMPANA }),
    null,
  );
});

await prueba("sin campaña conocida, el chat queda sin regla", () => {
  assert.equal(buscarReglaDelAnuncio({ reglas: [regla()], channelId: VENTAS1, anuncioId: ANUNCIO, campanaId: null }), null);
});

await prueba("ids de Meta: solo números de 5 a 25 cifras", () => {
  for (const bueno of ["12345", "1".repeat(25), CAMPANA]) assert.equal(esIdDeMeta(bueno), true, bueno);
  for (const malo of ["1234", "1".repeat(26), "12a45", " 12345", "act_12345", "", null, 12345]) {
    assert.equal(esIdDeMeta(malo), false, String(malo));
  }
});

await prueba("lectura tolerante: lo roto se descarta y 'reparto normal' no lleva 'sin bienvenida'", () => {
  assert.deepEqual(leerReglasDeTexto(null), []);
  assert.deepEqual(leerReglasDeTexto("no es json"), []);
  assert.deepEqual(leerReglasDeTexto("{}"), []);
  const leidas = leerReglasDeTexto(
    JSON.stringify([regla({ metaId: "abc" }), regla({ tipo: "otro" }), regla({ asignarA: null, sinBienvenida: true }), null]),
  );
  assert.equal(leidas.length, 1);
  assert.equal(leidas[0].asignarA, null);
  assert.equal(leidas[0].sinBienvenida, false);
});

// ── Aplicar en el chat ─────────────────────────────────────────────────────────────────────────
await prueba("sin reglas guardadas no hace nada (ni le pregunta a Meta)", async () => {
  guardar([]);
  const r = await aplicarReglaDeAnuncio(chat());
  assert.equal(r.aplicada, false);
  assert.equal(estado.metaPreguntas, 0);
  assert.deepEqual(estado.asignaciones, []);
  assert.deepEqual(estado.pausas, []);
  // Y sin la fila de reglas, igual.
  estado.settings.clear();
  assert.equal((await aplicarReglaDeAnuncio(chat())).aplicada, false);
});

await prueba("regla por anuncio con asesora: asigna, pausa el bot, nota en el historial y avisos", async () => {
  guardar([regla({ tipo: "anuncio", metaId: ANUNCIO })]);
  const r = await aplicarReglaDeAnuncio(chat());
  await esperarAvisos();
  assert.equal(r.aplicada, true);
  assert.equal(r.sinBienvenida, true);
  assert.equal(estado.metaPreguntas, 0, "la regla por anuncio no depende de Meta");
  assert.deepEqual(estado.asignaciones, ["yair"]);
  assert.deepEqual(estado.pausas, [{ conversationId: "conv-1", paused: true }]);
  assert.match(estado.actividades[0].text, /Yair Silvera asignado por la regla del anuncio «Salones y almacenes»/);
  assert.equal(estado.avisos.length, 1);
  assert.deepEqual(estado.push, [{ conversationId: "conv-1", userId: "yair" }]);
});

await prueba("regla por campaña: pregunta la campaña a Meta, asigna y guarda el recuerdo y el origen", async () => {
  guardar([regla({ sinBienvenida: false })]);
  estado.metaRespuesta = { anuncioNombre: "Foto Cali", conjuntoId: null, conjuntoNombre: null, campanaId: CAMPANA, campanaNombre: "Salones nov" };
  const r = await aplicarReglaDeAnuncio(chat());
  await esperarAvisos();
  assert.equal(r.aplicada, true);
  assert.equal(r.sinBienvenida, false);
  assert.deepEqual(estado.pausas, [], "sin la casilla, el bot no se pausa");
  assert.equal(estado.metaPreguntas, 1);
  assert.match(estado.settings.get(claveDeCampanaDelAnuncio(ANUNCIO)), /Salones nov/);
  assert.equal(estado.origenes[0].campanaNombre, "Salones nov");
  assert.equal(estado.origenes[0].campanaId, CAMPANA);
});

await prueba("la campaña ya conocida (OrigenDePauta) no se le vuelve a preguntar a Meta", async () => {
  estado.origenes.push({ contactId: "otro", anuncioId: ANUNCIO, campanaId: CAMPANA, campanaNombre: "Salones nov", anuncioNombre: null });
  const campana = await campanaDelAnuncio("ws", ANUNCIO, { esperaMs: 50 });
  assert.equal(campana.campanaId, CAMPANA);
  assert.equal(estado.metaPreguntas, 0);
});

await prueba("'reparto normal' no asigna nada", async () => {
  guardar([regla({ tipo: "anuncio", metaId: ANUNCIO, asignarA: null })]);
  const r = await aplicarReglaDeAnuncio(chat());
  assert.equal(r.aplicada, false);
  assert.deepEqual(estado.asignaciones, []);
  assert.deepEqual(estado.pausas, []);
});

await prueba("si la asesora no está activa en el equipo, sigue el reparto normal", async () => {
  guardar([regla({ tipo: "anuncio", metaId: ANUNCIO })]);
  estado.miembrosActivos = new Set();
  const r = await aplicarReglaDeAnuncio(chat());
  assert.equal(r.aplicada, false);
  assert.deepEqual(estado.asignaciones, []);
  assert.deepEqual(estado.pausas, []);
});

await prueba("nunca le saca el chat a nadie", async () => {
  guardar([regla({ tipo: "anuncio", metaId: ANUNCIO })]);
  estado.conversacion = { assignedToUserId: "otra" };
  assert.equal((await aplicarReglaDeAnuncio(chat())).aplicada, false);
  assert.deepEqual(estado.asignaciones, []);
});

await prueba("si Meta tarda más que el límite, no se bloquea: reparto normal", async () => {
  guardar([regla()]);
  estado.metaRespuesta = { anuncioNombre: null, conjuntoId: null, conjuntoNombre: null, campanaId: CAMPANA, campanaNombre: "X" };
  estado.metaTardaMs = 1_000;
  const inicio = Date.now();
  const r = await aplicarReglaDeAnuncio(chat({ esperaDeMetaMs: 100 }));
  const tardo = Date.now() - inicio;
  assert.equal(r.aplicada, false);
  assert.ok(tardo < 600, `tardó ${tardo} ms`);
  assert.deepEqual(estado.asignaciones, []);
  assert.equal(ESPERA_DE_META_MS, 3_000, "el límite de producción es de 3 segundos");
  // Cuando Meta contesta después, queda en el recuerdo para el próximo chat.
  await new Promise((r) => setTimeout(r, 1_100));
  assert.match(estado.settings.get(claveDeCampanaDelAnuncio(ANUNCIO)) ?? "", new RegExp(CAMPANA));
});

await prueba("si Meta falla o no hay llave, sin campaña: reparto normal", async () => {
  guardar([regla()]);
  estado.metaRespuesta = null;
  assert.equal((await aplicarReglaDeAnuncio(chat())).aplicada, false);
});

await prueba("un anuncio sin id válido no hace nada", async () => {
  guardar([regla({ tipo: "anuncio", metaId: ANUNCIO })]);
  assert.equal((await aplicarReglaDeAnuncio(chat({ anuncio: { id: "", titulo: "", red: "", ctwaClid: "" } }))).aplicada, false);
});

// ── El webhook y la pantalla (lectura del código) ──────────────────────────────────────────────
const webhook = fs.readFileSync(path.join(RAIZ, "src/app/api/webhooks/evolution/route.ts"), "utf8");

await prueba("webhook: la regla se espera ANTES del reparto por campaña y del bloque del bot (V3 y V2)", () => {
  const regla = webhook.indexOf("await aplicarReglaDeAnuncio(");
  const porPalabras = webhook.indexOf("await assignAdLeadByCampaign({");
  const v3 = webhook.indexOf("const pausaV3 = canalUsaV3");
  const v2 = webhook.indexOf("const conversationAutomationPaused = pausaDelChat");
  assert.ok(regla > 0 && porPalabras > regla && v3 > regla && v2 > regla);
  assert.match(webhook, /if \(adLeadOrigin && !reglaDelAnuncio\?\.aplicada\) \{\s+await assignAdLeadByCampaign/);
});

await prueba("webhook: con 'Sin bienvenida' no sale el acuse de pausa en ese mensaje", () => {
  assert.match(webhook, /pausaV3 === "pausado" &&\s+!reglaDelAnuncioSinBienvenida &&/);
  assert.match(webhook, /reglaDelAnuncioSinBienvenida = reglaDelAnuncio\?\.aplicada === true && reglaDelAnuncio\.sinBienvenida;/);
});

await prueba("pantalla y acciones: solo dueño y administradores", () => {
  const pagina = fs.readFileSync(path.join(RAIZ, "src/app/cliente/equipo/reparto-por-anuncio/page.tsx"), "utf8");
  const acciones = fs.readFileSync(path.join(RAIZ, "src/app/actions/reparto-por-anuncio-actions.ts"), "utf8");
  assert.match(pagina, /requireClientWorkspaceAccess\("client_team", \{ ownerOnly: true \}\)/);
  const exportadas = acciones.match(/export async function \w+/g) ?? [];
  const protegidas = acciones.match(/requireClientWorkspaceAccess\("client_team", \{ ownerOnly: true \}\)/g) ?? [];
  assert.equal(exportadas.length, 3);
  assert.equal(protegidas.length, exportadas.length);
  assert.match(acciones, /if \(!esIdDeMeta\(metaId\)\) return \{ error:/);
});

await prueba("solo lectura de Meta: se usa buscarAnuncio sin otros métodos", () => {
  const fuente = fs.readFileSync(path.join(RAIZ, "src/lib/reparto-por-anuncio.ts"), "utf8");
  assert.match(fuente, /import \{ buscarAnuncio \} from "@\/features\/pauta\/servicios\/meta-ads-lectura";/);
  assert.doesNotMatch(fuente, /graph\.facebook\.com|method:\s*"(POST|DELETE)"/);
});

await prueba("que_es_esta_aplicacion muestra reparto_por_anuncio", () => {
  const fuente = fs.readFileSync(path.join(RAIZ, "src/lib/mcp/que-es-esta-aplicacion.ts"), "utf8");
  assert.match(fuente, /reparto_por_anuncio: await estadoDelRepartoPorAnuncio\(workspaceId\)/);
});

console.log(`\n${pruebas} pruebas ok`);
