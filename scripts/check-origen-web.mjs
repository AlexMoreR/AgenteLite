// Pruebas del ORIGEN WEB (src/lib/origen-web.ts) y de cómo lo usa el webhook de Evolution, sin base
// ni red. Correr: npm run test:origen-web
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { cargar, RAIZ } from "./supervisor-cargar.mjs";

// ── Base falsa ──────────────────────────────────────────────────────────────────────────────────
const estado = { contacto: null, entrantes: 1, tags: [], uniones: [], updates: [], fallarUpdate: false };

function reiniciar(contacto, entrantes = 1) {
  estado.contacto = contacto;
  estado.entrantes = entrantes;
  estado.tags = [];
  estado.uniones = [];
  estado.updates = [];
  estado.fallarUpdate = false;
}

const prisma = {
  contact: {
    findUnique: async () => (estado.contacto ? { ...estado.contacto } : null),
    update: async ({ data }) => {
      if (estado.fallarUpdate) throw new Error("base caida");
      estado.updates.push(data);
      return {};
    },
  },
  message: { count: async () => estado.entrantes },
  tag: {
    findFirst: async ({ where }) => estado.tags.find((t) => t.slug === where.slug) ?? null,
    create: async ({ data }) => {
      estado.tags.push(data);
      return { id: data.id };
    },
  },
  contactTag: {
    createMany: async ({ data }) => {
      for (const fila of data) {
        if (!estado.uniones.some((u) => u.contactId === fila.contactId && u.tagId === fila.tagId)) estado.uniones.push(fila);
      }
      return { count: data.length };
    },
  },
};

class PrismaClientKnownRequestError extends Error {}
const mocks = {
  "@/lib/prisma": { prisma },
  "@prisma/client": { Prisma: { PrismaClientKnownRequestError } },
};

const { registrarOrigenWeb } = cargar("src/lib/origen-web.ts", mocks);

const base = { workspaceId: "w1", contactId: "c1", channelId: "admin", contactoRecienCreado: true };
const TEXTO = "Hola, vengo de magilus.com y quiero una camilla";

let fallas = 0;
async function prueba(nombre, fn) {
  try {
    await fn();
    console.log(`ok - ${nombre}`);
  } catch (error) {
    fallas += 1;
    console.error(`FALLA - ${nombre}\n${error.stack}`);
  }
}

// Silencia los console.log/warn del módulo durante las pruebas.
const logOriginal = console.log;
const warnOriginal = console.warn;
const silenciar = async (fn) => {
  console.log = () => {};
  console.warn = () => {};
  try {
    await fn();
  } finally {
    console.log = logOriginal;
    console.warn = warnOriginal;
  }
};

await prueba("primer mensaje web: etiqueta Web, origen web y visible en el CRM", async () => {
  reiniciar({ metadata: { otra: 1 }, bloqueadoEn: null });
  await silenciar(() => registrarOrigenWeb({ ...base, texto: TEXTO }));
  assert.equal(estado.updates.length, 1);
  const data = estado.updates[0];
  assert.equal(data.excludedFromCrm, false);
  assert.equal(data.metadata.crmOrigin, "web");
  assert.equal(data.metadata.origen.canal, "web");
  assert.equal(data.metadata.otra, 1);
  assert.ok(!("crmStage" in data), "no toca la etapa");
  assert.ok(!("assignedToUserId" in data), "no toca la asesora");
  assert.equal(estado.tags.length, 1);
  assert.equal(estado.tags[0].slug, "web");
  assert.equal(estado.tags[0].name, "Web");
  assert.equal(estado.uniones.length, 1);
});

await prueba("la etiqueta se reutiliza y la union no se duplica", async () => {
  reiniciar({ metadata: null, bloqueadoEn: null });
  await silenciar(() => registrarOrigenWeb({ ...base, texto: TEXTO }));
  await silenciar(() => registrarOrigenWeb({ ...base, texto: TEXTO }));
  assert.equal(estado.tags.length, 1);
  assert.equal(estado.uniones.length, 1);
});

await prueba("si ya habia origen no se pisa, pero queda visible y con etiqueta", async () => {
  reiniciar({ metadata: { origen: { canal: "marketplace" }, crmOrigin: "marketplace" }, bloqueadoEn: null });
  await silenciar(() => registrarOrigenWeb({ ...base, texto: TEXTO }));
  assert.equal(estado.updates.length, 1);
  assert.equal(estado.updates[0].excludedFromCrm, false);
  assert.ok(!("metadata" in estado.updates[0]));
  assert.equal(estado.uniones.length, 1);
});

await prueba("crmOrigin existente no se pisa", async () => {
  reiniciar({ metadata: { crmOrigin: "meta_ads" }, bloqueadoEn: null });
  await silenciar(() => registrarOrigenWeb({ ...base, texto: TEXTO }));
  assert.equal(estado.updates[0].metadata.crmOrigin, "meta_ads");
  assert.equal(estado.updates[0].metadata.origen.canal, "web");
});

await prueba("no actua: texto sin 'vengo de magilus.com'", async () => {
  reiniciar({ metadata: null, bloqueadoEn: null });
  await silenciar(() => registrarOrigenWeb({ ...base, texto: "Hola, vengo de Marketplace" }));
  assert.equal(estado.updates.length, 0);
  assert.equal(estado.uniones.length, 0);
});

await prueba("no actua: contacto bloqueado", async () => {
  reiniciar({ metadata: null, bloqueadoEn: new Date() });
  await silenciar(() => registrarOrigenWeb({ ...base, texto: TEXTO }));
  assert.equal(estado.updates.length, 0);
  assert.equal(estado.uniones.length, 0);
});

await prueba("no actua: no es el primer mensaje entrante", async () => {
  reiniciar({ metadata: null, bloqueadoEn: null }, 3);
  await silenciar(() => registrarOrigenWeb({ ...base, contactoRecienCreado: false, texto: TEXTO }));
  assert.equal(estado.updates.length, 0);
});

await prueba("ficha vieja con un solo mensaje entrante si cuenta como primero", async () => {
  reiniciar({ metadata: null, bloqueadoEn: null }, 1);
  await silenciar(() => registrarOrigenWeb({ ...base, contactoRecienCreado: false, texto: TEXTO }));
  assert.equal(estado.updates.length, 1);
});

await prueba("se traga sus propios errores", async () => {
  reiniciar({ metadata: null, bloqueadoEn: null });
  estado.fallarUpdate = true;
  await silenciar(() => registrarOrigenWeb({ ...base, texto: TEXTO }));
});

await prueba("origen-web.ts no manda nada por WhatsApp", () => {
  const fuente = fs.readFileSync(path.join(RAIZ, "src/lib/origen-web.ts"), "utf8");
  assert.doesNotMatch(fuente, /sendText|enviarMensaje|sendMedia/);
  const imports = [...fuente.matchAll(/from "([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ["@/lib/origen-de-venta", "@/lib/origen-de-venta", "@/lib/prisma", "@prisma/client", "node:crypto"]);
});

await prueba("webhook de Evolution: el chat web de la línea Admin no se oculta y llama a registrarOrigenWeb", () => {
  const fuente = fs.readFileSync(path.join(RAIZ, "src/app/api/webhooks/evolution/route.ts"), "utf8");
  assert.match(
    fuente,
    /channel\.purpose === "ADMIN" && !\(!fromMe && !isCallEvent && detectarOrigenWeb\(messageText\)\)\s*\?\s*\{ excludedFromCrm: true \}/,
  );
  assert.match(fuente, /after\(\(\) => registrarOrigenMarketplace\(datosOrigen\)\)/);
  assert.match(fuente, /after\(\(\) => registrarOrigenWeb\(datosOrigenWeb\)\)/);
});

if (fallas) {
  console.error(`\n${fallas} prueba(s) fallaron`);
  process.exit(1);
}
console.log("\nOrigen web: todas las pruebas pasaron");
