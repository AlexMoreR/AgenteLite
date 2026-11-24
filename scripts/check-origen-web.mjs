// Pruebas de src/lib/origen-web.ts (etiqueta y origen "Web" para los chats del botón de magilus.com)
// y del cambio en el webhook de Evolution. Correr: node scripts/check-origen-web.mjs
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);

function cargar(rutaRelativa, requireFalso) {
  const sourcePath = path.resolve(rutaRelativa);
  const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  });
  const mod = { exports: {} };
  new Function("exports", "require", "module", "__filename", "__dirname", transpiled.outputText)(
    mod.exports,
    requireFalso,
    mod,
    sourcePath,
    path.dirname(sourcePath),
  );
  return mod.exports;
}

const origenDeVenta = cargar("src/lib/origen-de-venta.ts", require);

class PrismaClientKnownRequestError extends Error {}

// Base falsa en memoria: un contacto, sus mensajes, etiquetas y uniones.
function crearBase({ contacto, entrantes = 1, etiquetas = [] }) {
  const estado = {
    contacto: contacto ? { ...contacto } : null,
    etiquetas: [...etiquetas],
    uniones: [],
    llamadas: [],
  };
  const prisma = {
    contact: {
      findUnique: async () => (estado.contacto ? { ...estado.contacto } : null),
      update: async ({ data }) => {
        estado.llamadas.push(["contact.update", data]);
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
      createMany: async ({ data, skipDuplicates }) => {
        assert.equal(skipDuplicates, true);
        for (const fila of data) {
          if (!estado.uniones.some((u) => u.contactId === fila.contactId && u.tagId === fila.tagId)) {
            estado.uniones.push(fila);
          }
        }
        return { count: data.length };
      },
    },
  };
  return { prisma, estado };
}

function cargarOrigenWeb(prisma) {
  return cargar("src/lib/origen-web.ts", (nombre) => {
    if (nombre === "@/lib/prisma") return { prisma };
    if (nombre === "@prisma/client") return { Prisma: { PrismaClientKnownRequestError } };
    if (nombre === "@/lib/origen-de-venta") return origenDeVenta;
    return require(nombre);
  });
}

const datos = (extra = {}) => ({
  workspaceId: "ws1",
  contactId: "c1",
  channelId: "linea-admin",
  texto: "Hola Magilus, vengo de magilus.com y quiero una camilla",
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
  const { prisma, estado } = crearBase({
    contacto: { id: "c1", metadata: null, bloqueadoEn: null, excludedFromCrm: true, crmStage: "NUEVO", assignedToUserId: "u1" },
  });
  await cargarOrigenWeb(prisma).registrarOrigenWeb(datos());
  assert.equal(estado.contacto.excludedFromCrm, false);
  assert.equal(estado.contacto.metadata.crmOrigin, "web");
  assert.equal(estado.contacto.metadata.origen.canal, "web");
  assert.equal(estado.contacto.crmStage, "NUEVO");
  assert.equal(estado.contacto.assignedToUserId, "u1");
  const [, data] = estado.llamadas[0];
  assert.ok(!("crmStage" in data) && !("assignedToUserId" in data), "no toca etapa ni asesora");
  assert.equal(estado.etiquetas.length, 1);
  assert.equal(estado.etiquetas[0].slug, "web");
  assert.equal(estado.etiquetas[0].name, "Web");
  assert.equal(estado.uniones.length, 1);
});

await prueba("reutiliza la etiqueta Web y no duplica la unión", async () => {
  const { prisma, estado } = crearBase({
    contacto: { id: "c1", metadata: null, bloqueadoEn: null, excludedFromCrm: false },
    etiquetas: [{ id: "t-web", slug: "web", name: "Web" }],
  });
  const mod = cargarOrigenWeb(prisma);
  await mod.registrarOrigenWeb(datos());
  await mod.registrarOrigenWeb(datos());
  assert.equal(estado.etiquetas.length, 1);
  assert.equal(estado.uniones.length, 1);
  assert.equal(estado.uniones[0].tagId, "t-web");
});

await prueba("no pisa un origen ya guardado", async () => {
  const origenPrevio = { canal: "marketplace", cuenta: "MK-1" };
  const { prisma, estado } = crearBase({
    contacto: { id: "c1", metadata: { origen: origenPrevio, crmOrigin: "marketplace" }, bloqueadoEn: null, excludedFromCrm: true },
  });
  await cargarOrigenWeb(prisma).registrarOrigenWeb(datos());
  assert.deepEqual(estado.contacto.metadata.origen, origenPrevio);
  assert.equal(estado.contacto.metadata.crmOrigin, "marketplace");
  assert.equal(estado.contacto.excludedFromCrm, false);
});

await prueba("contacto bloqueado: no se toca", async () => {
  const { prisma, estado } = crearBase({
    contacto: { id: "c1", metadata: null, bloqueadoEn: new Date(), excludedFromCrm: true },
  });
  await cargarOrigenWeb(prisma).registrarOrigenWeb(datos());
  assert.equal(estado.llamadas.length, 0);
  assert.equal(estado.uniones.length, 0);
  assert.equal(estado.contacto.excludedFromCrm, true);
});

await prueba("no es el primer mensaje entrante: no se toca", async () => {
  const { prisma, estado } = crearBase({
    contacto: { id: "c1", metadata: null, bloqueadoEn: null, excludedFromCrm: true },
    entrantes: 3,
  });
  await cargarOrigenWeb(prisma).registrarOrigenWeb(datos({ contactoRecienCreado: false }));
  assert.equal(estado.llamadas.length, 0);
  assert.equal(estado.uniones.length, 0);
});

await prueba("texto que no viene de la web: no se toca", async () => {
  const { prisma, estado } = crearBase({
    contacto: { id: "c1", metadata: null, bloqueadoEn: null, excludedFromCrm: true },
  });
  await cargarOrigenWeb(prisma).registrarOrigenWeb(datos({ texto: "Hola, vengo de Marketplace" }));
  assert.equal(estado.llamadas.length, 0);
});

await prueba("se traga sus propios errores", async () => {
  const { prisma } = crearBase({ contacto: { id: "c1", metadata: null, bloqueadoEn: null } });
  prisma.contact.findUnique = async () => {
    throw new Error("base caída");
  };
  const avisoOriginal = console.warn;
  console.warn = () => {};
  try {
    await cargarOrigenWeb(prisma).registrarOrigenWeb(datos());
  } finally {
    console.warn = avisoOriginal;
  }
});

// Base falsa para el arreglo de una sola vez: varios contactos, sus primeros mensajes por la línea Admin
// y AppSetting. `primeros` es lo que devuelve el groupBy (ya filtrado por la base).
function crearBaseArreglo({ contactos, primeros, marca = null }) {
  const estado = {
    contactos: Object.fromEntries(contactos.map((c) => [c.id, { ...c }])),
    ajustes: marca ? { [marca.key]: marca.value } : {},
    etiquetas: [],
    uniones: [],
    updates: [],
    consultas: [],
  };
  const prisma = {
    appSetting: {
      findUnique: async ({ where }) => (where.key in estado.ajustes ? { key: where.key } : null),
      upsert: async ({ where, create }) => {
        estado.ajustes[where.key] = create.value;
        return create;
      },
    },
    message: {
      groupBy: async (args) => {
        estado.consultas.push(args);
        return primeros.map((p) => ({ contactId: p.contactId, _min: { createdAt: p.createdAt } }));
      },
      findFirst: async ({ where }) => {
        const p = primeros.find((x) => x.contactId === where.contactId);
        return p ? { content: p.content, channelId: "linea-admin", workspaceId: "ws1", createdAt: p.createdAt } : null;
      },
    },
    contact: {
      findUnique: async ({ where }) => (estado.contactos[where.id] ? { ...estado.contactos[where.id] } : null),
      update: async ({ where, data }) => {
        estado.updates.push(data);
        Object.assign(estado.contactos[where.id], data);
        return estado.contactos[where.id];
      },
    },
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
          if (!estado.uniones.some((u) => u.contactId === fila.contactId && u.tagId === fila.tagId)) estado.uniones.push(fila);
        }
        return { count: data.length };
      },
    },
  };
  return { prisma, estado };
}

const WEB = "Hola Magilus, vengo de magilus.com y quiero una camilla";

await prueba("arreglo de chats web: deja visibles y con etiqueta Web solo a los de la página", async () => {
  const fecha = new Date("2026-10-01T15:00:00.000Z");
  const { prisma, estado } = crearBaseArreglo({
    contactos: [
      { id: "web1", metadata: null, bloqueadoEn: null, excludedFromCrm: true, crmStage: "NUEVO", assignedToUserId: null },
      { id: "web2", metadata: { origen: { canal: "marketplace" }, crmOrigin: "marketplace" }, bloqueadoEn: null, excludedFromCrm: true },
      { id: "otro", metadata: null, bloqueadoEn: null, excludedFromCrm: true },
      { id: "bloq", metadata: null, bloqueadoEn: new Date(), excludedFromCrm: true },
    ],
    primeros: [
      { contactId: "web1", createdAt: fecha, content: WEB },
      { contactId: "web2", createdAt: fecha, content: WEB },
      { contactId: "otro", createdAt: fecha, content: "Buenas, una factura" },
      { contactId: "bloq", createdAt: fecha, content: WEB },
    ],
  });
  const mod = cargarOrigenWeb(prisma);
  const resultado = await mod.arreglarChatsWebViejos(new Date("2026-11-24T12:00:00.000Z"));

  assert.deepEqual(resultado.contactIds, ["web1", "web2"]);
  assert.equal(resultado.cantidad, 2);
  assert.equal(estado.contactos.web1.excludedFromCrm, false);
  assert.equal(estado.contactos.web1.metadata.crmOrigin, "web");
  assert.equal(estado.contactos.web1.metadata.origen.canal, "web");
  assert.equal(estado.contactos.web1.metadata.origen.fecha, fecha.toISOString());
  assert.equal(estado.contactos.web1.crmStage, "NUEVO");
  // El que ya tenía origen queda visible y etiquetado, pero su origen no se pisa.
  assert.equal(estado.contactos.web2.excludedFromCrm, false);
  assert.equal(estado.contactos.web2.metadata.crmOrigin, "marketplace");
  assert.equal(estado.contactos.otro.excludedFromCrm, true);
  assert.equal(estado.contactos.bloq.excludedFromCrm, true);
  for (const data of estado.updates) assert.ok(!("crmStage" in data) && !("assignedToUserId" in data));
  assert.equal(estado.etiquetas.length, 1);
  assert.equal(estado.etiquetas[0].slug, "web");
  assert.deepEqual(estado.uniones.map((u) => u.contactId), ["web1", "web2"]);

  const marca = JSON.parse(estado.ajustes.arreglo_chats_web_60d);
  assert.equal(marca.cantidad, 2);
  assert.deepEqual(marca.contactIds, ["web1", "web2"]);
  assert.equal(marca.fecha, "2026-11-24T12:00:00.000Z");

  // La búsqueda: solo ocultos, no bloqueados, línea Admin de Evolution, primer entrante desde el 16-sep.
  const [consulta] = estado.consultas;
  assert.equal(consulta.where.direction, "INBOUND");
  assert.deepEqual(consulta.where.channel, { is: { purpose: "ADMIN", provider: "EVOLUTION" } });
  assert.deepEqual(consulta.where.contact, { is: { excludedFromCrm: true, bloqueadoEn: null } });
  assert.equal(consulta.having.createdAt._min.gte.toISOString(), "2026-09-16T05:00:00.000Z");
});

await prueba("arreglo de chats web: con la marca en AppSetting no hace nada", async () => {
  const { prisma, estado } = crearBaseArreglo({
    contactos: [{ id: "web1", metadata: null, bloqueadoEn: null, excludedFromCrm: true }],
    primeros: [{ contactId: "web1", createdAt: new Date("2026-10-01T15:00:00.000Z"), content: WEB }],
    marca: { key: "arreglo_chats_web_60d", value: "{}" },
  });
  const resultado = await cargarOrigenWeb(prisma).arreglarChatsWebViejos();
  assert.equal(resultado, null);
  assert.equal(estado.consultas.length, 0);
  assert.equal(estado.contactos.web1.excludedFromCrm, true);
});

await prueba("arreglo de chats web: si la búsqueda falla no deja la marca y no lanza", async () => {
  const { prisma, estado } = crearBaseArreglo({ contactos: [], primeros: [] });
  prisma.message.groupBy = async () => {
    throw new Error("base caída");
  };
  const avisoOriginal = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await cargarOrigenWeb(prisma).arreglarChatsWebViejos(), null);
  } finally {
    console.warn = avisoOriginal;
  }
  assert.ok(!("arreglo_chats_web_60d" in estado.ajustes));
});

await prueba("arreglo de chats web: un contacto que falla no frena a los demás", async () => {
  const fecha = new Date("2026-10-01T15:00:00.000Z");
  const { prisma, estado } = crearBaseArreglo({
    contactos: [
      { id: "malo", metadata: null, bloqueadoEn: null, excludedFromCrm: true },
      { id: "web1", metadata: null, bloqueadoEn: null, excludedFromCrm: true },
    ],
    primeros: [
      { contactId: "malo", createdAt: fecha, content: WEB },
      { contactId: "web1", createdAt: fecha, content: WEB },
    ],
  });
  const updateOriginal = prisma.contact.update;
  prisma.contact.update = async (args) => {
    if (args.where.id === "malo") throw new Error("choque");
    return updateOriginal(args);
  };
  const avisoOriginal = console.warn;
  console.warn = () => {};
  try {
    const resultado = await cargarOrigenWeb(prisma).arreglarChatsWebViejos();
    assert.deepEqual(resultado.contactIds, ["web1"]);
  } finally {
    console.warn = avisoOriginal;
  }
  assert.equal(JSON.parse(estado.ajustes.arreglo_chats_web_60d).cantidad, 1);
});

await prueba("origen-web.ts no toca etapa ni asesora y no manda mensajes", async () => {
  const fuente = fs.readFileSync("src/lib/origen-web.ts", "utf8");
  assert.doesNotMatch(fuente, /crmStage|assignedToUserId|sendText|enviarMensaje/);
  assert.doesNotMatch(fuente, /\.delete(Many)?\(/);
});

await prueba("cron de seguimientos: corre el arreglo de chats web en su propio try/catch", async () => {
  const fuente = fs.readFileSync("src/app/api/cron/follows/route.ts", "utf8");
  assert.match(fuente, /import \{ arreglarChatsWebViejos \} from "@\/lib\/origen-web";/);
  assert.match(fuente, /try \{\n\s*await arreglarChatsWebViejos\(\);\n\s*\} catch/);
});

await prueba("origen-web.ts no manda mensajes de WhatsApp", async () => {
  const fuente = fs.readFileSync("src/lib/origen-web.ts", "utf8");
  assert.doesNotMatch(fuente, /sendText|enviarMensaje/);
});

await prueba("webhook de Evolution: la línea Admin no oculta los chats web y registra el origen", async () => {
  const fuente = fs.readFileSync("src/app/api/webhooks/evolution/route.ts", "utf8");
  assert.match(
    fuente,
    /channel\.purpose === "ADMIN" && !detectarOrigenWeb\(messageText\) \? \{ excludedFromCrm: true \} : \{\}/,
  );
  assert.match(fuente, /after\(\(\) => registrarOrigenWeb\(datosOrigenWeb\)\)/);
  assert.match(fuente, /after\(\(\) => registrarOrigenMarketplace\(datosOrigen\)\)/);
});

console.log(`\n${pruebas} pruebas OK`);
