// Pruebas del REPARTO POR ANUNCIO (src/lib/reparto-por-anuncio.ts), sin base ni red.
// Correr: npm run test:reparto-por-anuncio
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { cargar, RAIZ } from "./supervisor-cargar.mjs";

// ── Base y servicios falsos ─────────────────────────────────────────────────────────────────────
/** Cuándo se creó cada fila de AppSetting (para `createdAt`). */
const creadas = new Map();
const estado = {
  settings: new Map(),
  conversacion: { assignedToUserId: null },
  miembrosActivos: new Set(["yair"]),
  origenes: [],
  metaRespuesta: null,
  metaTardaMs: 0,
  metaPreguntas: 0,
  metaLista: null,
  metaListas: 0,
  metaConfigurada: true,
  pausas: [],
  actividades: [],
  avisos: [],
  push: [],
  asignaciones: [],
};

function reiniciar() {
  estado.settings = new Map();
  creadas.clear();
  estado.conversacion = { assignedToUserId: null };
  estado.miembrosActivos = new Set(["yair"]);
  estado.origenes = [];
  estado.metaRespuesta = null;
  estado.metaTardaMs = 0;
  estado.metaPreguntas = 0;
  estado.metaLista = null;
  estado.metaListas = 0;
  estado.metaConfigurada = true;
  estado.pausas = [];
  estado.actividades = [];
  estado.avisos = [];
  estado.push = [];
  estado.asignaciones = [];
}

const prisma = {
  appSetting: {
    findUnique: async ({ where }) => (estado.settings.has(where.key) ? { value: estado.settings.get(where.key) } : null),
    findMany: async ({ where }) =>
      [...estado.settings.keys()]
        .filter((key) => key.startsWith(where.key.startsWith))
        .map((key) => ({ key, value: estado.settings.get(key), createdAt: creadas.get(key) ?? new Date(0) })),
    upsert: async ({ where, create, update }) => {
      if (estado.settings.has(where.key)) {
        // `update: {}` no cambia nada (igual que Prisma).
        if ("value" in update) estado.settings.set(where.key, update.value);
      } else {
        estado.settings.set(where.key, create.value);
        creadas.set(where.key, new Date());
      }
      return {};
    },
    create: async ({ data }) => {
      // Igual que Prisma: la clave repetida falla.
      if (estado.settings.has(data.key)) throw new Error("Unique constraint failed");
      estado.settings.set(data.key, data.value);
      creadas.set(data.key, new Date());
      return {};
    },
    updateMany: async ({ where, data }) => {
      if (!estado.settings.has(where.key)) return { count: 0 };
      const actual = estado.settings.get(where.key);
      const cumple =
        typeof where.value === "string" ? actual === where.value : where.value?.lt !== undefined ? actual < where.value.lt : true;
      if (!cumple) return { count: 0 };
      estado.settings.set(where.key, data.value);
      return { count: 1 };
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
    metaAdsConfigurado: () => estado.metaConfigurada,
    buscarAnuncio: async () => {
      estado.metaPreguntas += 1;
      if (estado.metaTardaMs) await new Promise((r) => setTimeout(r, estado.metaTardaMs));
      return estado.metaRespuesta;
    },
    listarAnunciosDeCampana: async () => {
      estado.metaListas += 1;
      return estado.metaLista;
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
  claveDeUsoDeLaRegla,
  usoDeLasReglas,
  aprenderAnunciosDeCampanas,
  aprenderAnunciosDeCampanasConLimite,
  anunciosConocidosPorCampana,
  claveDeCampanasActualizadas,
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

await prueba("regla por campaña: el chat solo trae el anuncio, Meta da la campaña, asigna, pausa el bot y guarda el recuerdo y el origen", async () => {
  guardar([regla({ sinBienvenida: false })]);
  assert.equal(estado.origenes.length, 0, "el CRM no conoce la campaña: solo llega el ID del anuncio");
  estado.metaRespuesta = { anuncioNombre: "Foto Cali", conjuntoId: null, conjuntoNombre: null, campanaId: CAMPANA, campanaNombre: "Salones nov" };
  const r = await aplicarReglaDeAnuncio(chat());
  await esperarAvisos();
  assert.equal(r.aplicada, true);
  assert.equal(r.sinBienvenida, false);
  assert.deepEqual(estado.asignaciones, ["yair"]);
  assert.deepEqual(estado.pausas, [{ conversationId: "conv-1", paused: true }], "sin la casilla, el bot igual queda callado");
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

await prueba("contador: aplicar dos veces la regla al mismo chat cuenta 1", async () => {
  const laRegla = regla({ tipo: "anuncio", metaId: ANUNCIO });
  guardar([laRegla]);
  assert.equal((await aplicarReglaDeAnuncio(chat())).aplicada, true);
  // Otra vez el mismo chat (por ejemplo, la asignación se soltó y vuelve a entrar).
  estado.conversacion = { assignedToUserId: null };
  assert.equal((await aplicarReglaDeAnuncio(chat())).aplicada, true);
  await esperarAvisos();
  assert.ok(estado.settings.has(claveDeUsoDeLaRegla("ws", laRegla.id, "conv-1")));
  const uso = await usoDeLasReglas("ws");
  assert.equal(uso[laRegla.id].chats, 1);
  assert.ok(uso[laRegla.id].ultimo instanceof Date);
  // Otro negocio no ve este uso.
  assert.deepEqual(await usoDeLasReglas("otro-ws"), {});
});

await prueba("contador: si la marca falla, la asignación sigue", async () => {
  guardar([regla({ tipo: "anuncio", metaId: ANUNCIO })]);
  const original = prisma.appSetting.upsert;
  prisma.appSetting.upsert = async () => {
    throw new Error("base caída");
  };
  try {
    const r = await aplicarReglaDeAnuncio(chat());
    await esperarAvisos();
    assert.equal(r.aplicada, true);
    assert.deepEqual(estado.pausas, [{ conversationId: "conv-1", paused: true }]);
  } finally {
    prisma.appSetting.upsert = original;
  }
});

await prueba("sin llave de Meta: nada lanza, no se le pregunta a Meta y la regla por campaña no se aplica", async () => {
  guardar([regla()]);
  estado.metaConfigurada = false;
  estado.metaRespuesta = { anuncioNombre: null, conjuntoId: null, conjuntoNombre: null, campanaId: CAMPANA, campanaNombre: "X" };
  const r = await aplicarReglaDeAnuncio(chat());
  assert.equal(r.aplicada, false);
  assert.equal(estado.metaPreguntas, 0);
  assert.equal(await campanaDelAnuncio("ws", ANUNCIO, { esperaMs: 50 }), null);
  assert.deepEqual(estado.asignaciones, []);
  assert.deepEqual(estado.pausas, []);
});

await prueba("regla de otra línea: no se aplica ni le pregunta a Meta", async () => {
  guardar([regla({ channelId: "ventas-2" })]);
  estado.metaRespuesta = { anuncioNombre: null, conjuntoId: null, conjuntoNombre: null, campanaId: CAMPANA, campanaNombre: "X" };
  assert.equal((await aplicarReglaDeAnuncio(chat())).aplicada, false);
  assert.equal(estado.metaPreguntas, 0);
});

await prueba("un anuncio sin id válido no hace nada", async () => {
  guardar([regla({ tipo: "anuncio", metaId: ANUNCIO })]);
  assert.equal((await aplicarReglaDeAnuncio(chat({ anuncio: { id: "", titulo: "", red: "", ctwaClid: "" } }))).aplicada, false);
});

// ── Aprender de Meta los anuncios de cada campaña con regla ────────────────────────────────────
const LISTA = [
  { anuncioId: ANUNCIO, anuncioNombre: "Foto Cali", campanaId: CAMPANA, campanaNombre: "Salones nov" },
  { anuncioId: "120210000000000002", anuncioNombre: "Video", campanaId: CAMPANA, campanaNombre: "Salones nov" },
];

await prueba("después de aprender, la campaña del anuncio sale del recuerdo sin preguntarle a Meta por el anuncio", async () => {
  estado.metaLista = LISTA;
  const r = await aprenderAnunciosDeCampanas("ws", [regla(), regla({ activa: false, metaId: "99999999" }), regla({ tipo: "anuncio", metaId: ANUNCIO })]);
  assert.deepEqual(r, { anuncios: 2, campanas: 1, campanasFallidas: 0 });
  assert.equal(estado.metaListas, 1, "solo la campaña prendida");
  const campana = await campanaDelAnuncio("ws", ANUNCIO, { esperaMs: 50 });
  assert.equal(campana.campanaId, CAMPANA);
  assert.equal(campana.campanaNombre, "Salones nov");
  assert.equal(estado.metaPreguntas, 0);
  assert.deepEqual(await anunciosConocidosPorCampana(), { [CAMPANA]: 2 });
});

await prueba("después de aprender, el chat de la campaña se asigna sin preguntarle a Meta por el anuncio", async () => {
  estado.metaLista = LISTA;
  await aprenderAnunciosDeCampanas("ws", [regla()]);
  guardar([regla()]);
  const r = await aplicarReglaDeAnuncio(chat());
  await esperarAvisos();
  assert.equal(r.aplicada, true);
  assert.equal(estado.metaPreguntas, 0);
});

await prueba("dos chats seguidos leen la lista de Meta una sola vez (marca de 15 minutos)", async () => {
  guardar([regla()]);
  estado.metaLista = LISTA;
  await aplicarReglaDeAnuncio(chat());
  await esperarAvisos();
  estado.conversacion = { assignedToUserId: null };
  await aplicarReglaDeAnuncio(chat({ conversationId: "conv-2", contactId: "contacto-2" }));
  await esperarAvisos();
  assert.equal(estado.metaListas, 1);
  assert.ok(estado.settings.has(claveDeCampanasActualizadas("ws")));
  // Dos a la vez: solo uno pregunta.
  estado.settings.delete(claveDeCampanasActualizadas("ws"));
  const juntos = await Promise.all([
    aprenderAnunciosDeCampanasConLimite("ws", [regla()]),
    aprenderAnunciosDeCampanasConLimite("ws", [regla()]),
  ]);
  assert.deepEqual(juntos.sort(), [false, true]);
  assert.equal(estado.metaListas, 2);
  // Pasados los 15 minutos, vuelve a leer.
  estado.settings.set(claveDeCampanasActualizadas("ws"), new Date(Date.now() - 16 * 60 * 1000).toISOString());
  assert.equal(await aprenderAnunciosDeCampanasConLimite("ws", [regla()]), true);
  assert.equal(estado.metaListas, 3);
  // Otro negocio tiene su propia marca.
  assert.equal(await aprenderAnunciosDeCampanasConLimite("otro-ws", [regla()]), true);
});

await prueba("aprender no cambia el resultado de la regla ni demora el chat", async () => {
  guardar([regla({ tipo: "anuncio", metaId: ANUNCIO }), regla({ asignarA: "otra" })]);
  estado.metaLista = LISTA;
  const tareas = [];
  const r = await aplicarReglaDeAnuncio(chat({ enSegundoPlano: (tarea) => tareas.push(tarea) }));
  assert.equal(r.aplicada, true);
  assert.equal(estado.metaListas, 0, "el aprendizaje queda para después");
  assert.equal(tareas.length, 2, "aprender y los avisos van en segundo plano");
  await Promise.all(tareas.map((t) => t()));
  assert.equal(estado.metaListas, 1);
});

await prueba("sin llave de Meta: no se llama a la lista ni lanza", async () => {
  guardar([regla()]);
  estado.metaConfigurada = false;
  estado.metaLista = LISTA;
  assert.equal((await aplicarReglaDeAnuncio(chat())).aplicada, false);
  await esperarAvisos();
  assert.equal(await aprenderAnunciosDeCampanas("ws", [regla()]), null);
  assert.equal(await aprenderAnunciosDeCampanasConLimite("ws", [regla()]), false);
  assert.equal(estado.metaListas, 0);
  assert.equal(estado.settings.has(claveDeCampanasActualizadas("ws")), false);
});

await prueba("si Meta falla al listar, no lanza y no guarda nada", async () => {
  estado.metaLista = null;
  assert.deepEqual(await aprenderAnunciosDeCampanas("ws", [regla()]), { anuncios: 0, campanas: 1, campanasFallidas: 1 });
  assert.deepEqual(await anunciosConocidosPorCampana(), {});
});

await prueba("meta-ads-lectura.ts: solo GET, y la lista de anuncios de la campaña usa `leer`", () => {
  const lectura = fs.readFileSync(path.join(RAIZ, "src/features/pauta/servicios/meta-ads-lectura.ts"), "utf8");
  const metodos = lectura.match(/method:\s*["'`]?\w+/g) ?? [];
  assert.ok(metodos.length > 0);
  for (const metodo of metodos) assert.match(metodo, /method:\s*["'`]GET$/);
  assert.match(lectura, /await leer\(`\$\{campanaId\}\/ads`, \{ fields: "id,name,campaign\{id,name\}", limit: "200" \}\)/);
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
  assert.equal(exportadas.length, 4);
  assert.equal(protegidas.length, exportadas.length);
  assert.match(acciones, /if \(!esIdDeMeta\(metaId\)\) return \{ error:/);
});

await prueba("pantalla: dice si Meta está conectado y avisa en rojo cuando no", () => {
  const pagina = fs.readFileSync(path.join(RAIZ, "src/app/cliente/equipo/reparto-por-anuncio/page.tsx"), "utf8");
  assert.match(pagina, /import \{ metaAdsConfigurado \} from "@\/features\/pauta\/servicios\/meta-ads-lectura";/);
  assert.match(pagina, /const metaConectado = metaAdsConfigurado\(\);/);
  assert.match(pagina, /Meta conectado: <span className="font-medium">sí<\/span>/);
  assert.match(pagina, /Meta conectado: no<\/span>/);
  assert.match(pagina, /text-destructive"\s+role="alert"/);
  assert.match(pagina, /las reglas por campaña no pueden funcionar sin la\s+conexión de lectura de Meta/);
  // El contador y los anuncios conocidos no tumban la pantalla si fallan.
  assert.match(pagina, /usoDeLasReglas\(access\.workspaceId\)\.catch\(/);
  assert.match(pagina, /anunciosConocidosPorCampana\(\)\.catch\(/);
  // La fecha va armada en el servidor, en hora de Colombia, y los anuncios solo en reglas de campaña.
  assert.match(pagina, /timeZone: "America\/Bogota"/);
  assert.match(pagina, /ultimoChat: uso\[regla\.id\] \? FECHA_DEL_ULTIMO\.format\(uso\[regla\.id\]\.ultimo\) : null/);
  assert.match(pagina, /anunciosConocidos: regla\.tipo === "campana" \? /);
});

await prueba("formulario: muestra los chats de cada regla y el botón llama la acción de actualizar anuncios", () => {
  const formulario = fs.readFileSync(path.join(RAIZ, "src/components/reparto-por-anuncio-form.tsx"), "utf8");
  assert.match(formulario, /chats: number;/);
  assert.match(formulario, /ultimoChat: string \| null;/);
  assert.match(formulario, /anunciosConocidos: number \| null;/);
  assert.match(formulario, /`\$\{regla\.chats\} chats`/);
  assert.match(formulario, /último: \$\{regla\.ultimoChat\}/);
  assert.match(formulario, /anuncios conocidos/);
  assert.match(formulario, /const resultado = await actualizarAnunciosDeCampanasAction\(\);/);
  assert.match(formulario, /onClick=\{actualizarAnuncios\}/);
  assert.match(formulario, /Actualizar anuncios de las campañas/);
  const funcion = formulario.slice(formulario.indexOf("function actualizarAnuncios()"));
  assert.match(funcion.slice(0, 600), /toast\.error\(resultado\.error\)[\s\S]*toast\.success\([\s\S]*router\.refresh\(\)/);
});

await prueba("solo lectura de Meta: se usa buscarAnuncio sin otros métodos", () => {
  const fuente = fs.readFileSync(path.join(RAIZ, "src/lib/reparto-por-anuncio.ts"), "utf8");
  assert.match(fuente, /import \{ buscarAnuncio, listarAnunciosDeCampana, metaAdsConfigurado \} from "@\/features\/pauta\/servicios\/meta-ads-lectura";/);
  assert.doesNotMatch(fuente, /graph\.facebook\.com|method:\s*"(POST|DELETE)"/);
});

await prueba("que_es_esta_aplicacion muestra reparto_por_anuncio", () => {
  const fuente = fs.readFileSync(path.join(RAIZ, "src/lib/mcp/que-es-esta-aplicacion.ts"), "utf8");
  assert.match(fuente, /reparto_por_anuncio: await estadoDelRepartoPorAnuncio\(workspaceId\)/);
});

console.log(`\n${pruebas} pruebas ok`);
