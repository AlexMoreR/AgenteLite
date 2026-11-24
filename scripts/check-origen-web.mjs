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

// ---- Arreglo de una sola vez: arreglarChatsWebViejos ----
function crearBaseArreglo({ filas, marca = false, contactos = {} }) {
  const estado = { ajustes: new Map(marca ? [["arreglo_chats_web_60d", "{}"]] : []), contactos, uniones: [], etiquetas: [], consultas: 0, updates: [] };
  const prisma = {
    appSetting: {
      findUnique: async ({ where }) => (estado.ajustes.has(where.key) ? { key: where.key } : null),
      create: async ({ data }) => {
        estado.ajustes.set(data.key, data.value);
        return data;
      },
    },
    $queryRaw: async () => {
      estado.consultas += 1;
      return filas;
    },
    contact: {
      update: async ({ where, data }) => {
        estado.updates.push([where.id, data]);
        estado.contactos[where.id] = { ...(estado.contactos[where.id] ?? {}), ...data };
        return estado.contactos[where.id];
      },
    },
    tag: {
      findFirst: async ({ where }) => estado.etiquetas.find((t) => t.slug === where.slug && t.workspaceId === where.workspaceId) ?? null,
      create: async ({ data }) => {
        estado.etiquetas.push(data);
        return { id: data.id };
      },
    },
    contactTag: {
      createMany: async ({ data }) => {
        estado.uniones.push(...data);
        return { count: data.length };
      },
    },
  };
  return { prisma, estado };
}

const fila = (extra = {}) => ({
  contactId: "c1",
  workspaceId: "ws1",
  channelId: "linea-admin",
  content: "Hola, vengo de magilus.com",
  createdAt: new Date("2026-10-01T15:00:00Z"),
  metadata: null,
  ...extra,
});

await prueba("arreglo: muestra y etiqueta los chats web viejos y deja la marca", async () => {
  const { prisma, estado } = crearBaseArreglo({
    filas: [
      fila(),
      fila({ contactId: "c2", metadata: { origen: { canal: "marketplace" }, crmOrigin: "marketplace" } }),
      fila({ contactId: "c3", content: "Hola, precio de la camilla" }),
      fila({ contactId: "c4", createdAt: new Date("2026-09-10T15:00:00Z") }),
    ],
  });
  const resultado = await cargarOrigenWeb(prisma).arreglarChatsWebViejos();
  assert.deepEqual(resultado.contactIds, ["c1", "c2"]);
  assert.equal(estado.contactos.c1.excludedFromCrm, false);
  assert.equal(estado.contactos.c1.metadata.crmOrigin, "web");
  assert.equal(estado.contactos.c1.metadata.origen.canal, "web");
  // El que ya tenía origen: visible, pero su origen no se pisa.
  assert.equal(estado.contactos.c2.excludedFromCrm, false);
  assert.ok(!("metadata" in estado.contactos.c2));
  assert.ok(!estado.contactos.c3 && !estado.contactos.c4, "ni el que no es web ni el de antes del 16-sep");
  for (const [, data] of estado.updates) assert.ok(!("crmStage" in data) && !("assignedToUserId" in data));
  assert.equal(estado.etiquetas.length, 1);
  assert.equal(estado.etiquetas[0].slug, "web");
  assert.equal(estado.uniones.length, 2);
  const marca = JSON.parse(estado.ajustes.get("arreglo_chats_web_60d"));
  assert.equal(marca.cantidad, 2);
  assert.deepEqual(marca.contactIds, ["c1", "c2"]);
  assert.ok(marca.fecha);
});

await prueba("arreglo: con la marca puesta no hace nada", async () => {
  const { prisma, estado } = crearBaseArreglo({ filas: [fila()], marca: true });
  const resultado = await cargarOrigenWeb(prisma).arreglarChatsWebViejos();
  assert.equal(resultado, null);
  assert.equal(estado.consultas, 0);
  assert.equal(estado.updates.length, 0);
});

await prueba("arreglo: un contacto que falla no frena a los demás; la base caída no tira error", async () => {
  const avisoOriginal = console.warn;
  console.warn = () => {};
  try {
    const { prisma, estado } = crearBaseArreglo({ filas: [fila(), fila({ contactId: "c2" })] });
    const updateOriginal = prisma.contact.update;
    prisma.contact.update = async (args) => {
      if (args.where.id === "c1") throw new Error("falla");
      return updateOriginal(args);
    };
    const resultado = await cargarOrigenWeb(prisma).arreglarChatsWebViejos();
    assert.deepEqual(resultado.contactIds, ["c2"]);
    assert.equal(JSON.parse(estado.ajustes.get("arreglo_chats_web_60d")).cantidad, 1);

    const caida = crearBaseArreglo({ filas: [] });
    caida.prisma.$queryRaw = async () => {
      throw new Error("base caída");
    };
    assert.equal(await cargarOrigenWeb(caida.prisma).arreglarChatsWebViejos(), null);
    assert.equal(caida.estado.ajustes.size, 0, "sin marca: se vuelve a intentar en la próxima vuelta");
  } finally {
    console.warn = avisoOriginal;
  }
});

await prueba("arreglo: la consulta busca el primer entrante de líneas ADMIN de Evolution, ocultos y no bloqueados", async () => {
  const fuente = fs.readFileSync("src/lib/origen-web.ts", "utf8");
  assert.match(fuente, /DISTINCT ON \(m\."contactId"\)/);
  assert.match(fuente, /w\."purpose" = 'ADMIN'/);
  assert.match(fuente, /w\."provider" = 'EVOLUTION'/);
  assert.match(fuente, /c\."excludedFromCrm" = true/);
  assert.match(fuente, /c\."bloqueadoEn" IS NULL/);
  assert.match(fuente, /ORDER BY m\."contactId", m\."createdAt" ASC/);
  assert.doesNotMatch(fuente, /crmStage|assignedToUserId|sendText|enviarMensaje/);
});

await prueba("reloj: llama al arreglo en su propio try/catch", async () => {
  const fuente = fs.readFileSync("src/app/api/cron/follows/route.ts", "utf8");
  assert.match(fuente, /try \{\n\s+await arreglarChatsWebViejos\(\);\n\s+\} catch \(error\) \{/);
});

console.log(`\n${pruebas} pruebas OK`);
