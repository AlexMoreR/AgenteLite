// Pruebas de src/lib/etapa-automatica-crm.ts: el lead avanza solo al asignar (NUEVO -> Frio) y al
// cotizar o poner el total del envio (-> Caliente), con los candados del bot. Sin base de datos:
// la base es de mentira, en memoria. Correr: npm run test:etapa-automatica
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);

// ── Base de mentira ───────────────────────────────────────────────────────────────────────────
const db = {
  contacts: new Map(),
  conversations: new Map(),
  official: new Map(),
  settings: new Map(),
  notas: [],
  notasOficiales: [],
  seguimientos: [],
};

function reiniciar() {
  db.contacts.clear();
  db.conversations.clear();
  db.official.clear();
  db.settings.clear();
  db.notas.length = 0;
  db.notasOficiales.length = 0;
  db.seguimientos.length = 0;
}

const prisma = {
  appSetting: {
    findUnique: async ({ where }) => (db.settings.has(where.key) ? { value: db.settings.get(where.key) } : null),
  },
  contact: {
    findFirst: async ({ where }) => {
      const c = db.contacts.get(where.id);
      return c && c.workspaceId === where.workspaceId ? { crmStage: c.crmStage, excludedFromCrm: c.excludedFromCrm } : null;
    },
  },
  conversation: {
    findFirst: async ({ where }) => {
      const c = db.conversations.get(where.id);
      return c && c.workspaceId === where.workspaceId
        ? { contactId: c.contactId, channelId: c.channelId, channel: { purpose: c.purpose ?? "SALES" } }
        : null;
    },
  },
  officialApiConversation: {
    findFirst: async ({ where }) => {
      const c = db.official.get(where.id);
      return c && c.workspaceId === where.config.workspaceId
        ? { configId: c.configId, contact: { crmContactId: c.crmContactId } }
        : null;
    },
  },
  user: { findUnique: async () => ({ name: "Laura", email: "laura@x.co" }) },
  // UPDATE "Contact" SET crmStage = destino WHERE id = contactId AND crmStage = etapaActual
  $executeRaw: async (_partes, destino, contactId, etapaActual) => {
    const c = db.contacts.get(contactId);
    if (!c || c.crmStage !== etapaActual) return 0;
    c.crmStage = destino;
    return 1;
  },
};

const stubs = {
  "@/lib/prisma": { prisma },
  "@/features/seguimientos/services/follows": {
    createFollowsFromRulesForSource: async (input) => {
      db.seguimientos.push(input);
    },
  },
  "@/lib/conversation-activity": {
    recordConversationActivity: async (input) => {
      db.notas.push(input);
    },
  },
  "@/lib/official-api-crm-stage": {
    recordOfficialApiStageActivity: async (input) => {
      db.notasOficiales.push(input);
    },
  },
};

// ── Cargador: transpila el .ts real y resuelve "@/..." a src/ (o a un stub) ───────────────────
const cache = new Map();
function cargar(archivo) {
  if (cache.has(archivo)) return cache.get(archivo);
  const transpiled = ts.transpileModule(fs.readFileSync(archivo, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: archivo,
  });
  const mod = { exports: {} };
  cache.set(archivo, mod.exports);
  const requerir = (id) => {
    if (stubs[id]) return stubs[id];
    if (id.startsWith("@/")) return cargar(path.resolve("src", `${id.slice(2)}.ts`));
    return require(id);
  };
  new Function("exports", "require", "module", "__filename", "__dirname", transpiled.outputText)(
    mod.exports,
    requerir,
    mod,
    archivo,
    path.dirname(archivo),
  );
  return mod.exports;
}

const { decidirEtapaAutomatica, moverEtapaAutomatica, textoDeLaNota, CLAVE_ETAPA_AUTOMATICA } = cargar(
  path.resolve("src/lib/etapa-automatica-crm.ts"),
);

let pruebas = 0;
async function prueba(nombre, fn) {
  reiniciar();
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const WS = "ws1";
const ASIGNADO = { tipo: "asignado", asesora: "Laura" };
const COTIZACION = { tipo: "cotizacion", codigo: "COT-1234" };
const PANEL = { tipo: "panel-de-envio" };
const ETAPAS = ["NUEVO", "CALIFICADO", "PROPUESTA", "NEGOCIACION", "GANADO", "PERDIDO"];

function chatViejo(id, crmStage, extra = {}) {
  db.contacts.set(`k-${id}`, { workspaceId: WS, crmStage, excludedFromCrm: Boolean(extra.excludedFromCrm) });
  db.conversations.set(id, { workspaceId: WS, contactId: `k-${id}`, channelId: "canal1", purpose: extra.purpose });
  return { source: "agent", conversationId: id };
}

function decide(motivo, etapaActual, extra = {}) {
  return decidirEtapaAutomatica({ motivo, etapaActual, fueraDelCrm: false, prendido: true, ...extra }).destino;
}

// ── La decisión ───────────────────────────────────────────────────────────────────────────────
await prueba("asignar: NUEVO pasa a Frio", () => {
  assert.equal(decide(ASIGNADO, "NUEVO"), "CALIFICADO");
});

await prueba("asignar: un lead en Frio, Tibio o Caliente no se toca", () => {
  for (const etapa of ["CALIFICADO", "PROPUESTA", "NEGOCIACION"]) {
    assert.equal(decide(ASIGNADO, etapa), null, etapa);
  }
});

await prueba("cotizacion y panel: suben a Caliente desde Nuevo, Frio y Tibio", () => {
  for (const motivo of [COTIZACION, PANEL]) {
    for (const etapa of ["NUEVO", "CALIFICADO", "PROPUESTA"]) {
      assert.equal(decide(motivo, etapa), "NEGOCIACION", `${motivo.tipo} desde ${etapa}`);
    }
  }
});

await prueba("cotizacion: un lead que ya estaba en Caliente queda igual", () => {
  assert.equal(decide(COTIZACION, "NEGOCIACION"), null);
  assert.equal(decide(PANEL, "NEGOCIACION"), null);
});

await prueba("Ganado y Perdido nunca cambian y nunca se ponen solos", () => {
  for (const motivo of [ASIGNADO, COTIZACION, PANEL]) {
    for (const etapa of ETAPAS) {
      const destino = decide(motivo, etapa);
      assert.notEqual(destino, "GANADO", `${motivo.tipo} desde ${etapa}`);
      assert.notEqual(destino, "PERDIDO", `${motivo.tipo} desde ${etapa}`);
      if (etapa === "GANADO" || etapa === "PERDIDO") assert.equal(destino, null, `${motivo.tipo} desde ${etapa}`);
    }
  }
});

await prueba("nunca baja de etapa", () => {
  for (const motivo of [ASIGNADO, COTIZACION, PANEL]) {
    for (const etapa of ["NUEVO", "CALIFICADO", "PROPUESTA", "NEGOCIACION"]) {
      const destino = decide(motivo, etapa);
      if (destino) assert.ok(ETAPAS.indexOf(destino) > ETAPAS.indexOf(etapa), `${motivo.tipo}: ${etapa} -> ${destino}`);
    }
  }
});

await prueba("fuera del CRM no se mueve; con el interruptor apagado tampoco", () => {
  assert.equal(decide(ASIGNADO, "NUEVO", { fueraDelCrm: true }), null);
  assert.equal(decide(COTIZACION, "NUEVO", { fueraDelCrm: true }), null);
  assert.equal(decide(ASIGNADO, "NUEVO", { prendido: false }), null);
  assert.equal(decide(PANEL, "PROPUESTA", { prendido: false }), null);
});

await prueba("la nota dice que lo movio el sistema y por que", () => {
  assert.match(textoDeLaNota("CALIFICADO", ASIGNADO), /^Etapa movida por el sistema: Frio \(se asignó a Laura\)$/);
  assert.match(textoDeLaNota("NEGOCIACION", COTIZACION), /^Etapa movida por el sistema: Caliente \(se creó la cotización COT-1234\)$/);
  assert.match(textoDeLaNota("NEGOCIACION", PANEL), /^Etapa movida por el sistema: Caliente \(.*panel de envío.*\)$/);
});

// ── De punta a punta, con la base de mentira ──────────────────────────────────────────────────
await prueba("asignar mueve la etapa, arranca los seguimientos y deja la nota en el chat", async () => {
  const chat = chatViejo("c1", "NUEVO");
  const movida = await moverEtapaAutomatica({ workspaceId: WS, chat, motivo: ASIGNADO });
  assert.equal(movida, "CALIFICADO");
  assert.equal(db.contacts.get("k-c1").crmStage, "CALIFICADO");
  assert.deepEqual(db.seguimientos.map((s) => [s.sourceType, s.sourceId]), [["CRM_STAGE", "CALIFICADO"]]);
  assert.equal(db.notas.length, 1);
  assert.equal(db.notas[0].kind, "stage_changed");
  assert.equal(db.notas[0].conversationId, "c1");
  assert.match(db.notas[0].text, /Etapa movida por el sistema: Frio/);
});

await prueba("sin cambio no hay seguimientos ni nota", async () => {
  const chat = chatViejo("c2", "PROPUESTA");
  assert.equal(await moverEtapaAutomatica({ workspaceId: WS, chat, motivo: ASIGNADO }), null);
  assert.equal(db.contacts.get("k-c2").crmStage, "PROPUESTA");
  assert.equal(db.seguimientos.length, 0);
  assert.equal(db.notas.length, 0);
});

await prueba("un lead fuera del CRM o de la linea administrativa no se mueve", async () => {
  const fuera = chatViejo("c3", "NUEVO", { excludedFromCrm: true });
  const admin = chatViejo("c4", "NUEVO", { purpose: "ADMIN" });
  assert.equal(await moverEtapaAutomatica({ workspaceId: WS, chat: fuera, motivo: ASIGNADO }), null);
  assert.equal(await moverEtapaAutomatica({ workspaceId: WS, chat: admin, motivo: COTIZACION }), null);
  assert.equal(db.contacts.get("k-c3").crmStage, "NUEVO");
  assert.equal(db.contacts.get("k-c4").crmStage, "NUEVO");
});

await prueba("con el interruptor en off no se mueve nada; otro valor no lo apaga", async () => {
  const chat = chatViejo("c5", "NUEVO");
  db.settings.set(`${CLAVE_ETAPA_AUTOMATICA}${WS}`, "off");
  assert.equal(await moverEtapaAutomatica({ workspaceId: WS, chat, motivo: ASIGNADO }), null);
  assert.equal(db.contacts.get("k-c5").crmStage, "NUEVO");
  db.settings.set(`${CLAVE_ETAPA_AUTOMATICA}${WS}`, "on");
  assert.equal(await moverEtapaAutomatica({ workspaceId: WS, chat, motivo: ASIGNADO }), "CALIFICADO");
});

await prueba("Ganado no se toca aunque se cotice de nuevo", async () => {
  const chat = chatViejo("c6", "GANADO");
  assert.equal(await moverEtapaAutomatica({ workspaceId: WS, chat, motivo: COTIZACION }), null);
  assert.equal(db.contacts.get("k-c6").crmStage, "GANADO");
});

await prueba("si alguien la movio a mano en el medio, manda la persona", async () => {
  const chat = chatViejo("c7", "NUEVO");
  const original = prisma.contact.findFirst;
  // Se lee NUEVO, pero antes del UPDATE una persona la pasa a Ganado.
  prisma.contact.findFirst = async (args) => {
    const leido = await original(args);
    db.contacts.get("k-c7").crmStage = "GANADO";
    return leido;
  };
  try {
    assert.equal(await moverEtapaAutomatica({ workspaceId: WS, chat, motivo: ASIGNADO }), null);
  } finally {
    prisma.contact.findFirst = original;
  }
  assert.equal(db.contacts.get("k-c7").crmStage, "GANADO");
  assert.equal(db.notas.length, 0);
});

await prueba("API oficial: mueve la ficha del CRM y deja la nota en la tabla del canal oficial", async () => {
  db.contacts.set("k-o1", { workspaceId: WS, crmStage: "NUEVO", excludedFromCrm: false });
  db.official.set("o1", { workspaceId: WS, configId: "cfg1", crmContactId: "k-o1" });
  const movida = await moverEtapaAutomatica({
    workspaceId: WS,
    chat: { source: "official", conversationId: "o1" },
    motivo: PANEL,
  });
  assert.equal(movida, "NEGOCIACION");
  assert.equal(db.contacts.get("k-o1").crmStage, "NEGOCIACION");
  assert.equal(db.notas.length, 0, "no escribe en la tabla del canal viejo");
  assert.equal(db.notasOficiales.length, 1);
  assert.equal(db.notasOficiales[0].configId, "cfg1");
  assert.match(db.notasOficiales[0].text, /Etapa movida por el sistema: Caliente/);
});

await prueba("API oficial sin ficha en el CRM, o chat de otro negocio: no hace nada", async () => {
  db.official.set("o2", { workspaceId: WS, configId: "cfg1", crmContactId: null });
  db.contacts.set("k-o3", { workspaceId: "otro", crmStage: "NUEVO", excludedFromCrm: false });
  db.official.set("o3", { workspaceId: "otro", configId: "cfg2", crmContactId: "k-o3" });
  assert.equal(await moverEtapaAutomatica({ workspaceId: WS, chat: { source: "official", conversationId: "o2" }, motivo: ASIGNADO }), null);
  assert.equal(await moverEtapaAutomatica({ workspaceId: WS, chat: { source: "official", conversationId: "o3" }, motivo: ASIGNADO }), null);
  assert.equal(db.contacts.get("k-o3").crmStage, "NUEVO");
});

await prueba("si la base falla, no lanza: devuelve null", async () => {
  const chat = chatViejo("c8", "NUEVO");
  const original = prisma.$executeRaw;
  prisma.$executeRaw = async () => {
    throw new Error("la base no responde");
  };
  const avisos = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await moverEtapaAutomatica({ workspaceId: WS, chat, motivo: ASIGNADO }), null);
  } finally {
    prisma.$executeRaw = original;
    console.warn = avisos;
  }
});

console.log(`\n${pruebas} pruebas de la etapa automatica pasaron.`);
