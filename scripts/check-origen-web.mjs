// Pruebas de registrarOrigenWeb (src/lib/origen-web.ts) con una base falsa, sin conexión.
// Se corre desde: npm run test:origen-ventas (al final de scripts/check-origen-ventas.mjs).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

function baseFalsa({ contacto, entrantes = 1, etiqueta = null }) {
  const llamadas = { update: [], tagCreate: [], contactTag: [] };
  const prisma = {
    contact: {
      findUnique: async () => contacto,
      update: async (args) => {
        llamadas.update.push(args);
        return {};
      },
    },
    message: { count: async () => entrantes },
    tag: {
      findFirst: async () => etiqueta,
      create: async (args) => {
        llamadas.tagCreate.push(args);
        return { id: "tag-web" };
      },
    },
    contactTag: {
      createMany: async (args) => {
        llamadas.contactTag.push(args);
        return { count: 1 };
      },
    },
  };
  return { prisma, llamadas };
}

let actual = null;
const prismaProxy = new Proxy({}, { get: (_t, k) => actual.prisma[k] });
class PrismaClientKnownRequestError extends Error {}
const { registrarOrigenWeb } = cargar("src/lib/origen-web.ts", {
  "@/lib/prisma": { prisma: prismaProxy },
  "@prisma/client": { Prisma: { PrismaClientKnownRequestError } },
});

const base = { workspaceId: "ws1", contactId: "c1", channelId: "ch1", contactoRecienCreado: true };
let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

await prueba("web: primer mensaje -> etiqueta Web, origen web y visible en el CRM", async () => {
  actual = baseFalsa({ contacto: { metadata: { lid: true }, bloqueadoEn: null } });
  await registrarOrigenWeb({ ...base, texto: "Hola, vengo de magilus.com" });
  const [u] = actual.llamadas.update;
  assert.equal(u.data.excludedFromCrm, false);
  assert.equal(u.data.metadata.crmOrigin, "web");
  assert.equal(u.data.metadata.origen.canal, "web");
  assert.equal(u.data.metadata.lid, true);
  assert.equal("crmStage" in u.data, false);
  assert.equal("assignedToUserId" in u.data, false);
  assert.equal(actual.llamadas.tagCreate[0].data.slug, "web");
  assert.equal(actual.llamadas.tagCreate[0].data.name, "Web");
  assert.equal(actual.llamadas.contactTag[0].skipDuplicates, true);
});

await prueba("web: reutiliza la etiqueta y no pisa un origen ya guardado", async () => {
  actual = baseFalsa({
    contacto: { metadata: { origen: { canal: "marketplace" }, crmOrigin: "marketplace" }, bloqueadoEn: null },
    etiqueta: { id: "tag-existente" },
  });
  await registrarOrigenWeb({ ...base, texto: "vengo de magilus.com" });
  const [u] = actual.llamadas.update;
  assert.equal(u.data.excludedFromCrm, false);
  assert.equal("metadata" in u.data, false);
  assert.equal(actual.llamadas.tagCreate.length, 0);
  assert.equal(actual.llamadas.contactTag[0].data[0].tagId, "tag-existente");
});

await prueba("web: no actúa si no es el primer mensaje, si está bloqueado o si no dice magilus.com", async () => {
  actual = baseFalsa({ contacto: { metadata: {}, bloqueadoEn: null }, entrantes: 3 });
  await registrarOrigenWeb({ ...base, contactoRecienCreado: false, texto: "vengo de magilus.com" });
  assert.equal(actual.llamadas.update.length, 0);

  actual = baseFalsa({ contacto: { metadata: {}, bloqueadoEn: new Date() } });
  await registrarOrigenWeb({ ...base, texto: "vengo de magilus.com" });
  assert.equal(actual.llamadas.update.length, 0);

  actual = baseFalsa({ contacto: { metadata: {}, bloqueadoEn: null } });
  await registrarOrigenWeb({ ...base, texto: "Hola, vengo de Marketplace" });
  assert.equal(actual.llamadas.update.length + actual.llamadas.contactTag.length, 0);
});

await prueba("web: se traga sus errores", async () => {
  actual = { prisma: { contact: { findUnique: async () => { throw new Error("sin base"); } } } };
  const avisoOriginal = console.warn;
  console.warn = () => {};
  try {
    await registrarOrigenWeb({ ...base, texto: "vengo de magilus.com" });
  } finally {
    console.warn = avisoOriginal;
  }
});

await prueba("web: no manda WhatsApp y el webhook de Evolution solo oculta Admin si no es chat web", async () => {
  const fuente = fs.readFileSync(path.join(RAIZ, "src/lib/origen-web.ts"), "utf8");
  assert.equal(/sendText|enviarMensaje/.test(fuente), false);
  const webhook = fs.readFileSync(path.join(RAIZ, "src/app/api/webhooks/evolution/route.ts"), "utf8");
  assert.match(webhook, /channel\.purpose === "ADMIN" && !esChatWeb \? \{ excludedFromCrm: true \}/);
  assert.match(webhook, /after\(\(\) => registrarOrigenWeb\(datosOrigen\)\)/);
});

console.log(`\n${pruebas} pruebas de origen web OK`);
