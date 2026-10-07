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

console.log(`\n${pruebas} pruebas de origen de ventas OK`);
