// Pruebas del rescate de una sola vez del 22-nov-2026 (src/lib/rescate-nuevo-sin-asesora.ts), con una base
// simulada en memoria: sin base ni red. Correr: npm run test:rescate-nuevo-sin-asesora
//
// 1. Reparte por turnos entre Ingrid y María, del chat más reciente al más viejo.
// 2. Solo los chats que la clienta escribió 2 o más veces; ni los de fuera de Colombia ni los que ya tienen dueña.
// 3. No manda nada: ni a la clienta ni push. Deja la nota de asignación y pasa a Frío (si no hay reglas por etapa).
// 4. Corre UNA vez: con la marca en AppSetting no hace nada; deja el resultado en la marca.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { cargar, RAIZ } from "./supervisor-cargar.mjs";

const estado = { settings: new Map(), conversaciones: [], conteos: new Map(), notas: [], etapas: [], reglasPorEtapa: 0, filtros: [] };

const prisma = {
  appSetting: {
    findUnique: async ({ where }) => (estado.settings.has(where.key) ? { key: where.key, value: estado.settings.get(where.key) } : null),
    create: async ({ data }) => {
      if (estado.settings.has(data.key)) throw new Error("clave repetida");
      estado.settings.set(data.key, data.value);
      return data;
    },
    update: async ({ where, data }) => {
      estado.settings.set(where.key, data.value);
      return {};
    },
  },
  user: {
    findMany: async ({ where }) => where.id.in.map((id) => ({ id })),
  },
  conversation: {
    findMany: async ({ where }) => {
      estado.filtros.push(where);
      return estado.conversaciones
        .filter((c) => c.assignedToUserId === null && !["CLOSED", "ARCHIVED"].includes(c.status))
        .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
        .map((c) => ({ id: c.id, workspaceId: "ws1", channelId: "ventas-1", contactId: `ct-${c.id}`, contact: { metadata: c.metadata ?? null } }));
    },
    updateMany: async ({ where, data }) => {
      const c = estado.conversaciones.find((x) => x.id === where.id);
      if (!c || c.assignedToUserId !== null) return { count: 0 };
      c.assignedToUserId = data.assignedToUserId;
      return { count: 1 };
    },
  },
  message: {
    groupBy: async ({ where }) =>
      where.conversationId.in.filter((id) => estado.conteos.has(id)).map((id) => ({ conversationId: id, _count: { _all: estado.conteos.get(id) } })),
  },
  followRule: {
    count: async () => estado.reglasPorEtapa,
  },
};

const mocks = {
  "@/lib/prisma": { prisma },
  "@/lib/conversation-activity": { recordConversationActivity: async (nota) => estado.notas.push(nota) },
  "@/lib/etapa-automatica-crm": { etapaAlAsignar: async (entrada) => estado.etapas.push(entrada) },
  "@/features/chats/domain/candado-no-reasignar": { whereSinCandadoVigente: () => ({ candado: "sin candado vigente" }) },
  "@/features/seguimiento-inteligente/dominio/exterior": { leerMarcaExterior: (metadata) => (metadata?.exterior ? { pais: "EC" } : null) },
};
const rescate = cargar("src/lib/rescate-nuevo-sin-asesora.ts", mocks);

const INGRID = "cms0qky97099f2go1n16d5y3y";
const MARIA = "cmtuns8l302782nlp3cvrgdgt";

function reiniciar() {
  estado.settings = new Map();
  estado.conversaciones = [];
  estado.conteos = new Map();
  estado.notas = [];
  estado.etapas = [];
  estado.reglasPorEtapa = 0;
  estado.filtros = [];
}

function chat(id, mensajesDeLaClienta, extra = {}) {
  const minuto = estado.conversaciones.length;
  estado.conversaciones.push({ id, assignedToUserId: null, status: "OPEN", lastMessageAt: new Date(Date.UTC(2026, 10, 22, 12, minuto)), ...extra });
  estado.conteos.set(id, mensajesDeLaClienta);
}

let pruebas = 0;
async function prueba(nombre, fn) {
  reiniciar();
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

await prueba("repartirPorTurnos: una a cada una, en orden", async () => {
  assert.deepEqual(
    rescate.repartirPorTurnos(["a", "b", "c"], ["I", "M"]).map(({ chat: c, asesora }) => `${c}:${asesora}`),
    ["a:I", "b:M", "c:I"],
  );
  assert.deepEqual(rescate.repartirPorTurnos(["a"], []), []);
});

await prueba("reparte entre Ingrid y María, del más reciente al más viejo, solo los que escribieron 2 o más veces", async () => {
  chat("viejo", 3);
  chat("solo-anuncio", 1);
  chat("medio", 2);
  chat("exterior", 4, { metadata: { exterior: true } });
  chat("con-duena", 5, { assignedToUserId: "yair" });
  chat("cerrado", 3, { status: "CLOSED" });
  chat("nuevo", 2);
  const r = await rescate.rescatarNuevoSinAsesoraUnaVez(new Date("2026-11-23T00:30:00Z"));
  assert.equal(r.asignados, 3);
  assert.deepEqual(r.porAsesora, { "Ingrid Sanchez": 2, "Maria Bautista": 1 });
  const duena = Object.fromEntries(estado.conversaciones.map((c) => [c.id, c.assignedToUserId]));
  assert.deepEqual(duena, {
    viejo: INGRID,
    "solo-anuncio": null,
    medio: MARIA,
    exterior: null,
    "con-duena": "yair",
    cerrado: null,
    nuevo: INGRID,
  });
});

await prueba("filtra en la base: Nuevo, sin asesora, línea de ventas, desde el 13-nov, sin candado", async () => {
  chat("a", 2);
  await rescate.rescatarNuevoSinAsesoraUnaVez();
  const where = estado.filtros[0];
  assert.equal(where.assignedToUserId, null);
  assert.equal(where.contact.crmStage, "NUEVO");
  assert.equal(where.contact.excludedFromCrm, false);
  assert.equal(where.contact.bloqueadoEn, null);
  assert.equal(where.contact.createdAt.gte.toISOString(), "2026-11-13T05:00:00.000Z");
  assert.equal(where.channel.is.purpose, "SALES");
  assert.equal(where.candado, "sin candado vigente");
});

await prueba("deja la nota de asignación y pasa a Frío; sin reglas por etapa", async () => {
  chat("a", 2);
  chat("b", 2);
  await rescate.rescatarNuevoSinAsesoraUnaVez();
  assert.equal(estado.notas.length, 2);
  assert.ok(estado.notas.every((n) => n.kind === "assigned" && n.text.includes("rescate del 22-nov")));
  assert.equal(estado.etapas.length, 2);
});

await prueba("con reglas de seguimiento por etapa prendidas no mueve la etapa (el Frío le escribiría a la clienta)", async () => {
  estado.reglasPorEtapa = 1;
  chat("a", 2);
  const r = await rescate.rescatarNuevoSinAsesoraUnaVez();
  assert.equal(r.asignados, 1);
  assert.equal(r.sinEtapa, true);
  assert.equal(estado.etapas.length, 0);
});

await prueba("corre UNA sola vez: con la marca no hace nada, y la marca guarda el resultado", async () => {
  chat("a", 2);
  const primera = await rescate.rescatarNuevoSinAsesoraUnaVez();
  assert.equal(primera.asignados, 1);
  const marca = JSON.parse(estado.settings.get(rescate.CLAVE_RESCATE_NUEVO_SIN_ASESORA));
  assert.equal(marca.asignados, 1);
  chat("b", 2);
  assert.equal(await rescate.rescatarNuevoSinAsesoraUnaVez(), null);
  assert.equal(estado.conversaciones.find((c) => c.id === "b").assignedToUserId, null);
});

await prueba("no manda nada: ni mensajes a la clienta ni push; y el reloj de cada minuto lo llama", async () => {
  const fuente = fs.readFileSync(path.join(RAIZ, "src/lib/rescate-nuevo-sin-asesora.ts"), "utf8");
  assert.doesNotMatch(fuente, /sendAndPersist|sendText|evolution-envio|avisarAsignacionPorPush|web-push|autoAssignConversationToCollaborator/);
  const reloj = fs.readFileSync(path.join(RAIZ, "src/app/api/cron/follows/route.ts"), "utf8");
  assert.match(reloj, /rescatarNuevoSinAsesoraUnaVez\(\)/);
});

console.log(`\n${pruebas} pruebas del rescate de chats en Nuevo: OK`);
