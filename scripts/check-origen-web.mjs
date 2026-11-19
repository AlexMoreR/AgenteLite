// Pruebas de src/lib/origen-web.ts (chats de la página magilus.com) y de su uso en el webhook de
// Evolution. Corre con una base falsa en memoria: no toca ninguna base real.
// Correr: npm run test:origen-web
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);

function cargar(rutaRelativa, alias) {
  const sourcePath = path.resolve(rutaRelativa);
  const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  });
  const mod = { exports: {} };
  const requerir = (nombre) => (nombre in alias ? alias[nombre] : require(nombre));
  new Function("exports", "require", "module", "__filename", "__dirname", transpiled.outputText)(
    mod.exports,
    requerir,
    mod,
    sourcePath,
    path.dirname(sourcePath),
  );
  return mod.exports;
}

class PrismaClientKnownRequestError extends Error {}

function baseFalsa({ contacto, entrantes = 1, etiqueta = null }) {
  const db = { contacto: contacto ? { ...contacto } : null, etiqueta, uniones: [], updates: [], tagsCreados: 0 };
  db.prisma = {
    contact: {
      findUnique: async () => (db.contacto ? { ...db.contacto } : null),
      update: async ({ data }) => {
        db.updates.push(data);
        Object.assign(db.contacto, data);
        return db.contacto;
      },
    },
    message: { count: async () => entrantes },
    tag: {
      findFirst: async ({ where }) => (db.etiqueta && where.slug === db.etiqueta.slug ? { id: db.etiqueta.id } : null),
      create: async ({ data }) => {
        db.tagsCreados += 1;
        db.etiqueta = { id: data.id, slug: data.slug, name: data.name };
        return { id: data.id };
      },
    },
    contactTag: {
      createMany: async ({ data, skipDuplicates }) => {
        assert.equal(skipDuplicates, true);
        for (const fila of data) {
          if (!db.uniones.some((u) => u.contactId === fila.contactId && u.tagId === fila.tagId)) db.uniones.push(fila);
        }
      },
    },
  };
  return db;
}

const origenDeVenta = cargar("src/lib/origen-de-venta.ts", {});
let db;
const { registrarOrigenWeb } = cargar("src/lib/origen-web.ts", {
  "@/lib/prisma": { get prisma() { return db.prisma; } },
  "@prisma/client": { Prisma: { PrismaClientKnownRequestError } },
  "@/lib/origen-de-venta": origenDeVenta,
});

const datos = (extra = {}) => ({
  workspaceId: "ws1",
  contactId: "c1",
  channelId: "ch-admin",
  texto: "Hola, vengo de magilus.com",
  contactoRecienCreado: true,
  ...extra,
});

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

await prueba("primer mensaje web: etiqueta Web, origen web y visible en el CRM", async () => {
  db = baseFalsa({ contacto: { metadata: { lid: true }, bloqueadoEn: null, excludedFromCrm: true, crmStage: "NUEVO" } });
  await registrarOrigenWeb(datos());
  assert.equal(db.contacto.excludedFromCrm, false);
  assert.equal(db.contacto.metadata.crmOrigin, "web");
  assert.equal(db.contacto.metadata.origen.canal, "web");
  assert.equal(db.contacto.metadata.lid, true);
  assert.deepEqual(db.etiqueta.slug, "web");
  assert.deepEqual(db.etiqueta.name, "Web");
  assert.equal(db.uniones.length, 1);
  for (const u of db.updates) {
    assert.equal("crmStage" in u, false);
    assert.equal("assignedToUserId" in u, false);
  }
});

await prueba("reutiliza la etiqueta y no duplica la unión", async () => {
  db = baseFalsa({ contacto: { metadata: null, bloqueadoEn: null }, etiqueta: { id: "t-web", slug: "web" } });
  await registrarOrigenWeb(datos());
  await registrarOrigenWeb(datos());
  assert.equal(db.tagsCreados, 0);
  assert.equal(db.uniones.length, 1);
  assert.equal(db.uniones[0].tagId, "t-web");
});

await prueba("no pisa un origen ya guardado", async () => {
  db = baseFalsa({
    contacto: { metadata: { origen: { canal: "marketplace" }, crmOrigin: "marketplace" }, bloqueadoEn: null, excludedFromCrm: true },
  });
  await registrarOrigenWeb(datos());
  assert.equal(db.contacto.metadata.origen.canal, "marketplace");
  assert.equal(db.contacto.metadata.crmOrigin, "marketplace");
  assert.equal(db.contacto.excludedFromCrm, false);
});

await prueba("sin texto web, bloqueado o sin ser el primer mensaje: no hace nada", async () => {
  db = baseFalsa({ contacto: { metadata: null, bloqueadoEn: null, excludedFromCrm: true } });
  await registrarOrigenWeb(datos({ texto: "Hola, vengo de Marketplace" }));
  assert.equal(db.updates.length, 0);

  db = baseFalsa({ contacto: { metadata: null, bloqueadoEn: new Date(), excludedFromCrm: true } });
  await registrarOrigenWeb(datos());
  assert.equal(db.updates.length, 0);
  assert.equal(db.uniones.length, 0);

  db = baseFalsa({ contacto: { metadata: null, bloqueadoEn: null, excludedFromCrm: true }, entrantes: 3 });
  await registrarOrigenWeb(datos({ contactoRecienCreado: false }));
  assert.equal(db.updates.length, 0);
});

await prueba("se traga sus errores", async () => {
  db = baseFalsa({ contacto: { metadata: null, bloqueadoEn: null } });
  db.prisma.contact.findUnique = async () => {
    throw new Error("base caída");
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    await registrarOrigenWeb(datos());
  } finally {
    console.warn = warn;
  }
});

await prueba("origen-web.ts no manda nada por WhatsApp ni toca etapa o asesora", async () => {
  const fuente = fs.readFileSync("src/lib/origen-web.ts", "utf8");
  assert.doesNotMatch(fuente, /sendText|enviarMensaje|evolution|waha/i);
  assert.doesNotMatch(fuente, /crmStage\s*:|assignedToUserId\s*:/);
});

await prueba("webhook de Evolution: el chat web de la línea Admin no se oculta y se registra en after()", async () => {
  const fuente = fs.readFileSync("src/app/api/webhooks/evolution/route.ts", "utf8");
  assert.match(fuente, /channel\.purpose === "ADMIN" && !detectarOrigenWeb\(messageText\) \? \{ excludedFromCrm: true \} : \{\}/);
  assert.match(fuente, /after\(\(\) => registrarOrigenMarketplace\(datosOrigen\)\);/);
  assert.match(fuente, /after\(\(\) => registrarOrigenWeb\(datosOrigen\)\);/);
  assert.match(fuente, /if \(!fromMe && !isCallEvent && detectarOrigenWeb\(messageText\)\)/);
});

console.log(`\n${pruebas} pruebas de origen web OK`);
