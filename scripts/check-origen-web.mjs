// Pruebas de src/lib/origen-web.ts (chats que llegan del botón de magilus.com) y de su uso en el
// webhook de Evolution. Usa una base falsa en memoria: no se conecta a nada.
// Correr: npm run test:origen-web
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import ts from "typescript";

function cargar(ruta, dependencias = {}) {
  const fuente = path.resolve(ruta);
  const salida = ts.transpileModule(fs.readFileSync(fuente, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: fuente,
  });
  const mod = { exports: {} };
  const pedir = (nombre) => {
    if (dependencias[nombre]) return dependencias[nombre];
    throw new Error(`Dependencia inesperada: ${nombre}`);
  };
  new Function("exports", "require", "module", "__filename", "__dirname", salida.outputText)(
    mod.exports, pedir, mod, fuente, path.dirname(fuente),
  );
  return mod.exports;
}

const crypto = await import("node:crypto");
const origenDeVenta = cargar("src/lib/origen-de-venta.ts", { "node:crypto": crypto });

class PrismaClientKnownRequestError extends Error {}

// Base falsa: un contacto, sus mensajes entrantes, las etiquetas y las uniones contacto-etiqueta.
function baseFalsa({ contacto, entrantes = 1, etiquetas = [] }) {
  const estado = { contacto: contacto ? { ...contacto } : null, etiquetas: [...etiquetas], uniones: [], updates: [] };
  const prisma = {
    contact: {
      findUnique: async () => (estado.contacto ? { ...estado.contacto } : null),
      update: async ({ data }) => {
        estado.updates.push(data);
        Object.assign(estado.contacto, data);
        return estado.contacto;
      },
    },
    message: { count: async () => entrantes },
    tag: {
      findFirst: async ({ where }) => estado.etiquetas.find((t) => t.slug === where.slug) ?? null,
      create: async ({ data }) => {
        estado.etiquetas.push(data);
        return { id: data.id };
      },
    },
    contactTag: {
      createMany: async ({ data }) => {
        for (const fila of data) {
          if (!estado.uniones.some((u) => u.contactId === fila.contactId && u.tagId === fila.tagId)) {
            estado.uniones.push(fila);
          }
        }
        return { count: data.length };
      },
    },
  };
  const { registrarOrigenWeb } = cargar("src/lib/origen-web.ts", {
    "node:crypto": crypto,
    "@prisma/client": { Prisma: { PrismaClientKnownRequestError } },
    "@/lib/prisma": { prisma },
    "@/lib/origen-de-venta": origenDeVenta,
  });
  return { estado, prisma, registrarOrigenWeb };
}

const entrada = (extra = {}) => ({
  workspaceId: "w1",
  contactId: "c1",
  channelId: "linea-admin",
  texto: "Hola Magilus, vengo de magilus.com y quiero una camilla",
  contactoRecienCreado: true,
  ...extra,
});

let pasadas = 0;
async function caso(nombre, fn) {
  try {
    await fn();
    pasadas += 1;
    console.log(`ok  - ${nombre}`);
  } catch (error) {
    console.error(`FALLO - ${nombre}\n${error.message}`);
    process.exitCode = 1;
  }
}

const silenciar = () => {
  const log = console.log;
  const warn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  return () => {
    console.log = log;
    console.warn = warn;
  };
};

async function correr(base, datos) {
  const volver = silenciar();
  try {
    await base.registrarOrigenWeb(datos);
  } finally {
    volver();
  }
}

await caso("primer mensaje web: etiqueta Web, origen web y visible en el CRM", async () => {
  const base = baseFalsa({ contacto: { metadata: null, bloqueadoEn: null, excludedFromCrm: true } });
  await correr(base, entrada());
  const c = base.estado.contacto;
  assert.equal(c.excludedFromCrm, false);
  assert.equal(c.metadata.crmOrigin, "web");
  assert.equal(c.metadata.origen.canal, "web");
  assert.equal(base.estado.etiquetas.length, 1);
  assert.equal(base.estado.etiquetas[0].slug, "web");
  assert.equal(base.estado.etiquetas[0].name, "Web");
  assert.equal(base.estado.uniones.length, 1);
  // No toca etapa ni asesora.
  for (const data of base.estado.updates) {
    assert.ok(!("crmStage" in data));
    assert.ok(!("assignedToUserId" in data));
  }
});

await caso("reutiliza la etiqueta Web y no duplica la unión", async () => {
  const base = baseFalsa({
    contacto: { metadata: null, bloqueadoEn: null },
    etiquetas: [{ id: "tag-web", slug: "web", name: "Web" }],
  });
  await correr(base, entrada());
  await correr(base, entrada({ contactoRecienCreado: false }));
  assert.equal(base.estado.etiquetas.length, 1);
  assert.equal(base.estado.uniones.length, 1);
  assert.equal(base.estado.uniones[0].tagId, "tag-web");
});

await caso("no pisa un origen ya guardado, pero sí etiqueta y deja visible", async () => {
  const base = baseFalsa({
    contacto: { metadata: { origen: { canal: "marketplace" }, crmOrigin: "marketplace" }, bloqueadoEn: null, excludedFromCrm: true },
  });
  await correr(base, entrada());
  const c = base.estado.contacto;
  assert.equal(c.metadata.origen.canal, "marketplace");
  assert.equal(c.metadata.crmOrigin, "marketplace");
  assert.equal(c.excludedFromCrm, false);
  assert.equal(base.estado.uniones.length, 1);
});

await caso("contacto bloqueado: no hace nada", async () => {
  const base = baseFalsa({ contacto: { metadata: null, bloqueadoEn: new Date(), excludedFromCrm: true } });
  await correr(base, entrada());
  assert.equal(base.estado.updates.length, 0);
  assert.equal(base.estado.uniones.length, 0);
  assert.equal(base.estado.contacto.excludedFromCrm, true);
});

await caso("no es el primer mensaje entrante: no hace nada", async () => {
  const base = baseFalsa({ contacto: { metadata: null, bloqueadoEn: null }, entrantes: 3 });
  await correr(base, entrada({ contactoRecienCreado: false }));
  assert.equal(base.estado.updates.length, 0);
  assert.equal(base.estado.uniones.length, 0);
});

await caso("texto que no viene de la web: no hace nada", async () => {
  const base = baseFalsa({ contacto: { metadata: null, bloqueadoEn: null } });
  await correr(base, entrada({ texto: "Hola, vengo de Marketplace" }));
  assert.equal(base.estado.updates.length, 0);
});

await caso("se traga sus errores", async () => {
  const base = baseFalsa({ contacto: { metadata: null, bloqueadoEn: null } });
  base.prisma.contact.findUnique = async () => {
    throw new Error("la base no responde");
  };
  await correr(base, entrada());
});

await caso("origen-web.ts no manda mensajes", () => {
  const fuente = fs.readFileSync(path.resolve("src/lib/origen-web.ts"), "utf8");
  assert.ok(!/sendText|enviarMensaje|evolution|waha/i.test(fuente));
});

await caso("webhook de Evolution: la línea Admin no oculta el chat web y llama a registrarOrigenWeb", () => {
  const webhook = fs.readFileSync(path.resolve("src/app/api/webhooks/evolution/route.ts"), "utf8");
  assert.ok(webhook.includes('channel.purpose === "ADMIN" && !detectarOrigenWeb(messageText)'));
  assert.ok(webhook.includes("after(() => registrarOrigenWeb("));
});

console.log(`\n${pasadas} casos pasaron.`);
