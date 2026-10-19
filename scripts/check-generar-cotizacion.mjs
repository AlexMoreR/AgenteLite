// Pruebas de src/features/cotizaciones/services/generar-cotizacion.ts (pedido a Gestion, lo que
// falta, lectura de "Productos" y de la respuesta). Correr: npm run test:generar-cotizacion
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const sourcePath = path.resolve("src/features/cotizaciones/services/generar-cotizacion.ts");
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
  armarPedidoDeCotizacion,
  faltantesDelCliente,
  faltantesDeProductos,
  interpretarProductos,
  leerRespuestaDeGestion,
  textoParaElCliente,
  juntarLineas,
} = mod.exports;

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const FICHA = {
  fullName: "Ana Pérez",
  document: "1144000000",
  email: "",
  city: "Cali",
  department: "Valle del Cauca",
  address: "Calle 10 # 20-30",
  products: "2 sillas barberas",
};
const CATALOGO = [
  { id: "p1", codigo: "SIL-BAR", nombre: "Silla barbera", precio: 900000, origen: "GESTION", activo: true },
  { id: "p2", codigo: "SIL-BAR-PRO", nombre: "Silla barbera pro", precio: 1200000, origen: "GESTION", activo: true },
  { id: "p3", codigo: "ESP-01", nombre: "Espejo", precio: 300000, origen: "GESTION", activo: true },
  { id: "m1", codigo: null, nombre: "Lavacabezas manual", precio: 1, origen: "MANUAL", activo: true },
  { id: "i1", codigo: "VIE-01", nombre: "Tocador viejo", precio: 1, origen: "GESTION", activo: false },
];

await prueba("pedido completo: cliente, codigos de Gestion, origen y chat; sin precios", () => {
  const r = armarPedidoDeCotizacion({
    ficha: FICHA,
    lineas: [{ productId: "p1", cantidad: 1 }, { productId: "p3", cantidad: 2 }, { productId: "p1", cantidad: 1 }],
    catalogo: CATALOGO,
    telefono: "+57 300 123 4567",
    asesoraEmail: " Ingrid@Magilus.com ",
    origen: "META_ADS",
    linea: "Ventas 1",
    conversationId: "conv1",
    contactId: "ct1",
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.pedido.client, {
    fullName: "Ana Pérez",
    document: "1144000000",
    phone: "573001234567",
    city: "Cali",
    department: "Valle del Cauca",
    address: "Calle 10 # 20-30",
  });
  assert.deepEqual(r.pedido.items, [
    { productCode: "SIL-BAR", quantity: 2 },
    { productCode: "ESP-01", quantity: 2 },
  ]);
  assert.equal(r.pedido.asesoraEmail, "ingrid@magilus.com");
  assert.equal(r.pedido.origin, "META_ADS");
  assert.equal(r.pedido.linea, "Ventas 1");
  assert.equal(r.pedido.crmConversationId, "conv1");
  assert.equal(r.pedido.crmContactId, "ct1");
  assert.match(r.pedido.notes, /2 sillas barberas/);
  assert.equal(JSON.stringify(r.pedido).includes("precio"), false);
  assert.equal(JSON.stringify(r.pedido).includes("900000"), false);
});

await prueba("lo que falta del cliente, en palabras simples", () => {
  const faltan = faltantesDelCliente({ ...FICHA, fullName: "", document: " ", email: "malo", address: "c1" }, null);
  assert.deepEqual(
    faltan.map((f) => f.campo),
    ["fullName", "document", "email", "phone", "address"],
  );
  assert.ok(faltan.every((f) => f.mensaje.length > 3));
  // En el navegador no se sabe el telefono: no se revisa.
  assert.deepEqual(faltantesDelCliente(FICHA, undefined), []);
  assert.deepEqual(faltantesDelCliente(FICHA, "3001234567"), []);
});

await prueba("productos: sin productos, manual, inactivo, cantidad mala, inexistente", () => {
  assert.deepEqual(faltantesDeProductos([], CATALOGO).map((f) => f.campo), ["items"]);
  const faltan = faltantesDeProductos(
    [
      { productId: "m1", cantidad: 1 },
      { productId: "i1", cantidad: 1 },
      { productId: "p1", cantidad: 0 },
      { productId: "zz", cantidad: 1 },
    ],
    CATALOGO,
  );
  assert.equal(faltan.length, 4);
  assert.match(faltan[0].mensaje, /no viene de Gestión/);
  assert.match(faltan[1].mensaje, /inactivo/);
  assert.match(faltan[2].mensaje, /Cantidad/);
  assert.match(faltan[3].mensaje, /ya no está/);
});

await prueba("con datos faltantes no se arma el pedido (no se llama a Gestion)", () => {
  const r = armarPedidoDeCotizacion({ ficha: { ...FICHA, city: "" }, lineas: [], catalogo: CATALOGO, telefono: null });
  assert.equal(r.ok, false);
  assert.deepEqual(r.faltantes.map((f) => f.campo), ["phone", "city", "items"]);
});

await prueba("juntarLineas suma el mismo producto", () => {
  assert.deepEqual(juntarLineas([{ productId: "a", cantidad: 1 }, { productId: "a", cantidad: 2 }]), [{ productId: "a", cantidad: 3 }]);
});

await prueba("interpretar 'Productos': cantidad, nombre mas largo, codigo y lo no reconocido", () => {
  const r = interpretarProductos("2 sillas barberas pro\nEspejo x3, lavacabezas, SIL-BAR (4)", CATALOGO);
  assert.deepEqual(r.lineas, [
    { productId: "p2", cantidad: 2 },
    { productId: "p3", cantidad: 3 },
    { productId: "p1", cantidad: 4 },
  ]);
  assert.deepEqual(r.sinReconocer, ["lavacabezas"]);
  assert.deepEqual(interpretarProductos("", CATALOGO), { lineas: [], sinReconocer: [] });
  // Inactivos y manuales nunca se eligen solos.
  assert.deepEqual(interpretarProductos("tocador viejo", CATALOGO).lineas, []);
});

await prueba("respuesta de Gestion: creada, reutilizada, 422 y errores", () => {
  const creada = leerRespuestaDeGestion(201, {
    ok: true,
    reused: false,
    quoteId: "q1",
    code: "COT-00200",
    total: 1800000,
    shareUrl: "https://magilus.com/cotizaciones/t",
    pdfUrl: "https://magilus.com/api/generate-quote-pdf?token=t",
  });
  assert.equal(creada.tipo, "creada");
  assert.equal(creada.codigo, "COT-00200");
  assert.equal(creada.reutilizada, false);
  assert.equal(leerRespuestaDeGestion(200, { ok: true, reused: true, code: "COT-1", total: "5", shareUrl: "u" }).reutilizada, true);
  const faltan = leerRespuestaDeGestion(422, { ok: false, missing: [{ campo: "document", mensaje: "Falta la cédula" }, { x: 1 }] });
  assert.deepEqual(faltan, { tipo: "faltan", faltantes: [{ campo: "document", mensaje: "Falta la cédula" }] });
  assert.equal(leerRespuestaDeGestion(401, {}).tipo, "error");
  assert.equal(leerRespuestaDeGestion(500, null).tipo, "error");
  assert.equal(leerRespuestaDeGestion(201, { ok: true }).tipo, "error");
});

await prueba("texto al cliente: primer nombre, codigo, total y enlace", () => {
  const texto = textoParaElCliente({ nombre: "Ana Pérez", codigo: "COT-00200", total: 1800000, shareUrl: "https://magilus.com/cotizaciones/t" });
  assert.match(texto, /^Ana, aquí está tu cotización COT-00200 por \$1\.800\.000:/);
  assert.match(texto, /https:\/\/magilus\.com\/cotizaciones\/t$/);
  assert.match(textoParaElCliente({ nombre: "", codigo: "C", total: 1, shareUrl: "u" }), /^Aquí/);
});

console.log(`\n${pruebas} pruebas ok`);
