// Pruebas de src/lib/origen-de-venta.ts (regla línea → origen, detección de Marketplace, referral
// de la API oficial y el GET /api/origen). Correr: npm run test:origen-ventas
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const sourcePath = path.resolve("src/lib/origen-de-venta.ts");
const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
});
const mod = { exports: {} };
new Function("exports", "require", "module", "__filename", "__dirname", transpiled.outputText)(
  mod.exports,
  require,
  mod,
  sourcePath,
  path.dirname(sourcePath),
);
const {
  origenDeLinea,
  parsearMapaDeLineas,
  armarOrigenDeVenta,
  detectarOrigenMarketplace,
  detectarOrigenWeb,
  leerReferralOficial,
  variantesDeTelefono,
  responderConsultaDeOrigen,
} = mod.exports;

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

await prueba("línea → origen por defecto (regla de Alex)", () => {
  assert.equal(origenDeLinea({ channelId: "a", nombre: "Ventas 1" }), "META_ADS");
  assert.equal(origenDeLinea({ channelId: "b", nombre: "  VENTAS   2 " }), "MARKETPLACE");
  assert.equal(origenDeLinea({ channelId: "c", nombre: "Admín" }), "REFERIDO_RECURRENTE");
  assert.equal(origenDeLinea({ channelId: "d", nombre: "Soporte", purpose: "ADMIN" }), "REFERIDO_RECURRENTE");
  assert.equal(origenDeLinea({ channelId: "e", nombre: "Ventas 3" }), null);
  assert.equal(origenDeLinea(null), null);
});

await prueba("línea → origen configurable (canal > mapa por id > mapa por nombre > defecto)", () => {
  const mapa = parsearMapaDeLineas(JSON.stringify({ x1: "marketplace", "Ventas 1": "MARKETPLACE", basura: "NADA" }));
  assert.equal(mapa.basura, undefined);
  assert.equal(origenDeLinea({ channelId: "x1", nombre: "Ventas 3" }, mapa), "MARKETPLACE");
  assert.equal(origenDeLinea({ channelId: "zz", nombre: "ventas 1" }, mapa), "MARKETPLACE");
  assert.equal(
    origenDeLinea({ channelId: "x1", nombre: "Ventas 1", metadata: { origenVenta: "meta_ads" } }, mapa),
    "META_ADS",
  );
  assert.deepEqual(parsearMapaDeLineas("{roto"), {});
  assert.deepEqual(parsearMapaDeLineas(null), {});
});

await prueba("armar origen: la línea manda y el detalle sale de la metadata", () => {
  const conAnuncio = armarOrigenDeVenta({
    linea: { channelId: "v1", nombre: "Ventas 1" },
    metadataContacto: { source: "meta ads", adSourceId: "120", adTitle: "Combo negro", adSourceApp: "instagram", adCapturedAt: "2026-10-01T00:00:00Z" },
    contactId: "c1",
  });
  assert.equal(conAnuncio.origin, "META_ADS");
  assert.equal(conAnuncio.linea, "Ventas 1");
  assert.equal(conAnuncio.originDetail.adId, "120");
  assert.equal(conAnuncio.originDetail.adTitle, "Combo negro");
  assert.equal(conAnuncio.originDetail.crmContactId, "c1");
  assert.equal(conAnuncio.originDetail.via, "cotizacion");

  // Línea Admin con anuncio viejo: sigue siendo Admin (regla base), pero conserva el detalle.
  const admin = armarOrigenDeVenta({
    linea: { channelId: "ad", nombre: "Admin" },
    metadataContacto: { origen: { canal: "marketplace", cuenta: "MK-ABC12", itemId: "998877" } },
  });
  assert.equal(admin.origin, "REFERIDO_RECURRENTE");
  assert.equal(admin.originDetail.mkCuenta, "MK-ABC12");
  assert.equal(admin.originDetail.marketplaceItemId, "998877");

  // Línea desconocida: caen las señales; sin señales, SIN_DATO.
  assert.equal(armarOrigenDeVenta({ linea: { channelId: "q", nombre: "Otra" }, metadataContacto: { adCapturedAt: "x" } }).origin, "META_ADS");
  assert.equal(armarOrigenDeVenta({ linea: null, metadataContacto: { origen: { canal: "marketplace" } } }).origin, "MARKETPLACE");
  assert.equal(armarOrigenDeVenta({ linea: null, metadataContacto: null }).origin, "SIN_DATO");
});

await prueba("detecta Marketplace: ref MK, 'vengo de' y link de item sin ref", () => {
  assert.deepEqual(detectarOrigenMarketplace("Hola, vengo de Marketplace 🛒 (ref MK-7F3A2)"), { cuenta: "MK-7F3A2" });
  assert.deepEqual(detectarOrigenMarketplace("vengo del marketplace"), { cuenta: null });
  assert.deepEqual(
    detectarOrigenMarketplace("¿Sigue estando disponible este artículo? - facebook.com/marketplace/item/1234567890123456/"),
    { cuenta: null, itemId: "1234567890123456" },
  );
  assert.deepEqual(
    detectarOrigenMarketplace("Hola https://www.facebook.com/marketplace/item/987654321?ref=share"),
    { cuenta: null, itemId: "987654321" },
  );
  assert.equal(detectarOrigenMarketplace("Hola, cuánto vale la camilla?"), null);
  assert.equal(detectarOrigenMarketplace("facebook.com/marketplace/category/muebles"), null);
  assert.equal(detectarOrigenMarketplace(""), null);
  assert.equal(detectarOrigenMarketplace(null), null);
});

await prueba("detección de la página web (vengo de magilus.com)", () => {
  assert.equal(detectarOrigenWeb("Hola Magilus, vengo de magilus.com y quiero…"), true);
  assert.equal(detectarOrigenWeb("VENGO DE MAGILUS.COM"), true);
  assert.equal(detectarOrigenWeb("vengo de Marketplace"), false);
  assert.equal(detectarOrigenWeb(""), false);
  assert.equal(detectarOrigenWeb(null), false);
});

await prueba("referral de la API oficial → anuncio", () => {
  const anuncio = leerReferralOficial({
    source_url: "https://fb.me/abc",
    source_id: "120210000",
    source_type: "ad",
    headline: "Silla barbera",
    body: "Envío gratis",
    ctwa_clid: "ARAkLk",
  });
  assert.equal(anuncio.sourceId, "120210000");
  assert.equal(anuncio.title, "Silla barbera");
  assert.equal(anuncio.ctwaClid, "ARAkLk");
  assert.equal(anuncio.sourceApp, "facebook");
  assert.equal(leerReferralOficial({ source_url: "https://www.instagram.com/p/x", source_type: "post" }).sourceApp, "instagram");
  assert.equal(leerReferralOficial(undefined), null);
  assert.equal(leerReferralOficial({}), null);
});

await prueba("variantes de teléfono colombiano", () => {
  assert.deepEqual(variantesDeTelefono("300 123 4567").sort(), ["3001234567", "573001234567"]);
  assert.deepEqual(variantesDeTelefono("+57 300-123-4567").sort(), ["3001234567", "573001234567"]);
  assert.deepEqual(variantesDeTelefono("12"), []);
  assert.deepEqual(variantesDeTelefono(null), []);
});

await prueba("GET /api/origen: llave, teléfono y respuesta sin datos del cliente", async () => {
  const llamadas = [];
  const deps = {
    workspacePorLlave: async (llave) => (llave === "secreta" ? "ws1" : null),
    origenPorTelefono: async (ws, variantes) => {
      llamadas.push([ws, variantes]);
      return variantes.includes("573001234567")
        ? { origin: "MARKETPLACE", originDetail: { via: "cotizacion", mkCuenta: "MK-1" }, linea: "Ventas 2" }
        : null;
    },
  };
  assert.equal((await responderConsultaDeOrigen({ autorizacion: null, telefono: "3001234567" }, deps)).status, 401);
  assert.equal((await responderConsultaDeOrigen({ autorizacion: "Bearer otra", telefono: "3001234567" }, deps)).status, 401);
  assert.equal((await responderConsultaDeOrigen({ autorizacion: "Bearer secreta", telefono: "abc" }, deps)).status, 400);

  const ok = await responderConsultaDeOrigen({ autorizacion: "Bearer secreta", telefono: "3001234567" }, deps);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, {
    encontrado: true,
    origin: "MARKETPLACE",
    originDetail: { via: "telefono", mkCuenta: "MK-1" },
    linea: "Ventas 2",
  });
  assert.equal(JSON.stringify(ok.body).includes("3001234567"), false);
  assert.equal(llamadas[0][0], "ws1");

  const nada = await responderConsultaDeOrigen({ autorizacion: "bearer secreta", telefono: "3110000000" }, deps);
  assert.deepEqual(nada.body, { encontrado: false, origin: "SIN_DATO", originDetail: null, linea: null });
});

// registrarOrigenWeb (src/lib/origen-web.ts) con una base de mentira: se carga el archivo real con
// los alias @/ resueltos a mano.
function cargarOrigenWeb(prismaFalso) {
  const ruta = path.resolve("src/lib/origen-web.ts");
  const js = ts.transpileModule(fs.readFileSync(ruta, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: ruta,
  }).outputText;
  class PrismaClientKnownRequestError extends Error {}
  const requerir = (nombre) => {
    if (nombre === "@/lib/prisma") return { prisma: prismaFalso };
    if (nombre === "@/lib/origen-de-venta") return mod.exports;
    if (nombre === "@prisma/client") return { Prisma: { PrismaClientKnownRequestError } };
    return require(nombre);
  };
  const m = { exports: {} };
  new Function("exports", "require", "module", "__filename", "__dirname", js)(m.exports, requerir, m, ruta, path.dirname(ruta));
  return m.exports;
}

function baseFalsa({ contacto, entrantes = 1, etiqueta = null }) {
  const log = { updates: [], tagsCreados: [], uniones: [], conteos: 0 };
  const prisma = {
    contact: {
      findUnique: async () => contacto,
      update: async (args) => log.updates.push(args),
    },
    message: { count: async () => (log.conteos++, entrantes) },
    tag: {
      findFirst: async () => etiqueta,
      create: async (args) => (log.tagsCreados.push(args.data), { id: "tag-web" }),
    },
    contactTag: { createMany: async (args) => log.uniones.push(args) },
  };
  return { prisma, log };
}

const datosWeb = (extra = {}) => ({
  workspaceId: "ws1",
  contactId: "c1",
  channelId: "ch1",
  texto: "Hola, vengo de magilus.com",
  contactoRecienCreado: true,
  ...extra,
});

await prueba("registrarOrigenWeb: primer mensaje web → etiqueta Web, origen web y visible en el CRM", async () => {
  const { prisma, log } = baseFalsa({ contacto: { metadata: { lid: true }, bloqueadoEn: null } });
  await cargarOrigenWeb(prisma).registrarOrigenWeb(datosWeb());
  assert.equal(log.updates.length, 1);
  const data = log.updates[0].data;
  assert.equal(data.excludedFromCrm, false);
  assert.deepEqual(data.metadata, { lid: true, crmOrigin: "web", origen: { canal: "web" } });
  assert.equal("crmStage" in data, false);
  assert.equal("assignedToUserId" in data, false);
  assert.equal(log.tagsCreados[0].slug, "web");
  assert.equal(log.tagsCreados[0].name, "Web");
  assert.deepEqual(log.uniones[0], {
    data: [{ contactId: "c1", tagId: "tag-web", workspaceId: "ws1" }],
    skipDuplicates: true,
  });
});

await prueba("registrarOrigenWeb: reutiliza la etiqueta y no pisa un origen ya guardado", async () => {
  const meta = { origen: { canal: "marketplace" }, crmOrigin: "marketplace" };
  const { prisma, log } = baseFalsa({ contacto: { metadata: meta, bloqueadoEn: null }, etiqueta: { id: "tag-viejo" } });
  await cargarOrigenWeb(prisma).registrarOrigenWeb(datosWeb());
  assert.deepEqual(log.updates[0].data, { excludedFromCrm: false });
  assert.equal(log.tagsCreados.length, 0);
  assert.equal(log.uniones[0].data[0].tagId, "tag-viejo");
});

await prueba("registrarOrigenWeb: no actúa sin el texto, con contacto bloqueado ni si no es el primer mensaje", async () => {
  const sinTexto = baseFalsa({ contacto: { metadata: null, bloqueadoEn: null } });
  await cargarOrigenWeb(sinTexto.prisma).registrarOrigenWeb(datosWeb({ texto: "Hola, cuánto vale?" }));
  assert.equal(sinTexto.log.updates.length + sinTexto.log.uniones.length, 0);

  const bloqueado = baseFalsa({ contacto: { metadata: null, bloqueadoEn: new Date() } });
  await cargarOrigenWeb(bloqueado.prisma).registrarOrigenWeb(datosWeb());
  assert.equal(bloqueado.log.updates.length + bloqueado.log.uniones.length, 0);

  const viejo = baseFalsa({ contacto: { metadata: null, bloqueadoEn: null }, entrantes: 3 });
  await cargarOrigenWeb(viejo.prisma).registrarOrigenWeb(datosWeb({ contactoRecienCreado: false }));
  assert.equal(viejo.log.conteos, 1);
  assert.equal(viejo.log.updates.length + viejo.log.uniones.length, 0);

  const fichaPreviaPrimerMensaje = baseFalsa({ contacto: { metadata: null, bloqueadoEn: null }, entrantes: 1 });
  await cargarOrigenWeb(fichaPreviaPrimerMensaje.prisma).registrarOrigenWeb(datosWeb({ contactoRecienCreado: false }));
  assert.equal(fichaPreviaPrimerMensaje.log.updates.length, 1);
});

await prueba("registrarOrigenWeb: se traga sus errores y no manda mensajes", async () => {
  const { prisma } = baseFalsa({ contacto: null });
  prisma.contact.findUnique = async () => {
    throw new Error("base caida");
  };
  await cargarOrigenWeb(prisma).registrarOrigenWeb(datosWeb());
  const fuente = fs.readFileSync(path.resolve("src/lib/origen-web.ts"), "utf8");
  assert.doesNotMatch(fuente, /sendText|enviarMensaje|evolution|waha/i);
});

await prueba("webhook de Evolution: el chat web de la línea Admin no se oculta y se registra su origen", () => {
  const webhook = fs.readFileSync(path.resolve("src/app/api/webhooks/evolution/route.ts"), "utf8");
  assert.match(webhook, /channel\.purpose === "ADMIN" && !detectarOrigenWeb\(messageText\) \? \{ excludedFromCrm: true \}/);
  assert.match(webhook, /after\(\(\) => registrarOrigenWeb\(datosOrigenWeb\)\)/);
  assert.match(webhook, /after\(\(\) => registrarOrigenMarketplace\(datosOrigen\)\)/);
});

console.log(`\n${pruebas} pruebas de origen de ventas OK`);
