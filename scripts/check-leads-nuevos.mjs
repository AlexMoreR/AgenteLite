// Pruebas de src/features/leads-nuevos/dominio/reglas.ts (leads nuevos reales: origen, línea y asesora).
// Correr: npm run test:leads-nuevos
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

const origen = cargar("src/lib/origen-de-venta.ts", { "node:crypto": await import("node:crypto") });
const { agruparLeadsNuevos, leadsNuevosDeLasFilas, normalizarTelefono } = cargar(
  "src/features/leads-nuevos/dominio/reglas.ts",
  { "../../../lib/origen-de-venta": origen },
);

let pasadas = 0;
function caso(nombre, fn) {
  try {
    fn();
    pasadas += 1;
    console.log(`ok  - ${nombre}`);
  } catch (error) {
    console.error(`FALLO - ${nombre}\n${error.message}`);
    process.exitCode = 1;
  }
}

const FECHA = "2026-10-14";
const DENTRO = "2026-10-14T15:00:00Z";
const ADMIN = { canalId: "cmt06kiob00lw2hk2mgllstsb", linea: "Admin", proposito: "ADMIN" };
const V1 = { canalId: "c-v1", linea: "Ventas 1", proposito: "SALES" };
const V2 = { canalId: "c-v2", linea: "Ventas 2", proposito: "SALES" };
const fila = (extra) => ({ telefono: "573001112233", primerMensajeEn: DENTRO, primerTexto: "Hola", ...V1, ...extra });

caso("cliente que escribe por Admin y Ventas 1 cuenta una vez, en la línea donde escribió primero", () => {
  const r = agruparLeadsNuevos(
    [fila({ ...ADMIN, primerMensajeEn: "2026-10-14T14:00:00Z" }), fila({ primerMensajeEn: "2026-10-14T16:00:00Z" })],
    FECHA,
  );
  assert.equal(r.total, 1);
  assert.equal(r.por_linea.admin, 1);
  assert.equal(r.por_linea.ventas_1, 0);
});

caso("el teléfono se normaliza (con y sin 57, con símbolos)", () => {
  assert.equal(normalizarTelefono("300 111 2233"), "573001112233");
  assert.equal(normalizarTelefono("+57 300-111-2233"), "573001112233");
  const r = agruparLeadsNuevos([fila({ telefono: "3001112233" }), fila({ ...V2, telefono: "+573001112233", primerMensajeEn: "2026-10-14T20:00:00Z" })], FECHA);
  assert.equal(r.total, 1);
});

caso("cliente con mensajes de días anteriores no es lead nuevo", () => {
  const r = agruparLeadsNuevos([fila({ primerMensajeEn: "2026-10-10T15:00:00Z" }), fila({ ...ADMIN })], FECHA);
  assert.equal(r.total, 0);
  assert.equal(r.sin_asignar, 0);
});

caso("cliente sin mensajes de antes que escribe el día siguiente no cuenta ese día", () => {
  assert.equal(agruparLeadsNuevos([fila({ primerMensajeEn: "2026-10-15T15:00:00Z" })], FECHA).total, 0);
});

caso("el día de Colombia corta a las 05:00 UTC", () => {
  const f = (iso) => agruparLeadsNuevos([fila({ primerMensajeEn: iso })], FECHA).total;
  assert.equal(f("2026-10-14T04:59:59Z"), 0, "04:59 UTC es el día anterior");
  assert.equal(f("2026-10-14T05:00:00Z"), 1, "05:00 UTC ya es el día");
  assert.equal(f("2026-10-15T04:59:59Z"), 1, "04:59 UTC del día siguiente aún es el día");
  assert.equal(f("2026-10-15T05:00:00Z"), 0, "05:00 UTC del día siguiente ya es otro día");
});

caso("origen: anuncio > Marketplace por texto > Marketplace por línea > directo", () => {
  const casos = [
    // Ventas 2 con anuncio y con texto de Marketplace: gana el anuncio.
    [fila({ ...V2, telefono: "1", anuncioEnEmbudo: true, primerTexto: "vengo de Marketplace ref MK-ABC12" }), "meta"],
    [fila({ ...V1, telefono: "2", metadataContacto: { adCapturedAt: "2026-10-14T15:00:00Z" } }), "meta"],
    // Ventas 2 con texto: por texto.
    [fila({ ...V2, telefono: "3", primerTexto: "¿Sigue disponible? facebook.com/marketplace/item/1234567890" }), "marketplace_por_texto"],
    [fila({ ...V1, telefono: "4", etiquetaMarketplace: true }), "marketplace_por_texto"],
    [fila({ ...V1, telefono: "5", metadataContacto: { origen: { canal: "marketplace" } } }), "marketplace_por_texto"],
    // Ventas 2 sin nada: por línea.
    [fila({ ...V2, telefono: "6" }), "marketplace_por_linea"],
    // Ventas 1 sin anuncio y Admin: directo.
    [fila({ ...V1, telefono: "7" }), "directo"],
    [fila({ ...ADMIN, telefono: "8" }), "directo"],
  ];
  for (const [f, esperado] of casos) {
    const [lead] = leadsNuevosDeLasFilas([f], FECHA);
    assert.equal(lead.origen, esperado, `${f.telefono} debía ser ${esperado}`);
  }
  const r = agruparLeadsNuevos(casos.map(([f]) => f), FECHA);
  assert.deepEqual(r.por_origen, { meta: 2, marketplace: { total: 4, por_texto: 3, por_linea: 1 }, directo: 2 });
});

caso("chat sin dueña sale en 'sin asignar'; usa la dueña del chat en la otra línea", () => {
  const r = agruparLeadsNuevos(
    [
      fila({ telefono: "1" }),
      fila({ telefono: "2", asesoraId: "u1", asesora: "Karina" }),
      // Escribió primero por Admin sin dueña; en Ventas 1 lo atiende Hillary.
      fila({ telefono: "3", ...ADMIN, primerMensajeEn: "2026-10-14T13:00:00Z" }),
      fila({ telefono: "3", primerMensajeEn: "2026-10-14T14:00:00Z", asesoraId: "u2", asesora: "Hillary" }),
    ],
    FECHA,
  );
  assert.equal(r.total, 3);
  assert.equal(r.sin_asignar, 1);
  assert.deepEqual(r.por_asesora.map((a) => [a.asesora, a.id, a.total]), [["Hillary", "u2", 1], ["Karina", "u1", 1]]);
});

caso("las sumas cuadran con el total", () => {
  const filas = [
    fila({ telefono: "1", ...ADMIN, asesoraId: "u1", asesora: "Karina" }),
    fila({ telefono: "2", asesoraId: "u1", asesora: "Karina", anuncioEnEmbudo: true }),
    fila({ telefono: "3", ...V2, asesoraId: "u2", asesora: "Hillary" }),
    fila({ telefono: "4", ...V2 }),
    fila({ telefono: "5", canalId: "c-x", linea: "Otra", proposito: "SALES" }),
    fila({ telefono: "6", primerMensajeEn: "2026-10-01T10:00:00Z" }),
  ];
  const r = agruparLeadsNuevos(filas, FECHA);
  assert.equal(r.total, 5);
  const { admin, ventas_1, ventas_2, otras, solo_ventas } = r.por_linea;
  assert.equal(admin + ventas_1 + ventas_2 + otras, r.total);
  assert.equal(solo_ventas, r.total - admin);
  assert.equal(r.por_asesora.reduce((s, a) => s + a.total, 0) + r.sin_asignar, r.total);
  const o = r.por_origen;
  assert.equal(o.meta + o.marketplace.total + o.directo, r.total);
  assert.equal(o.marketplace.por_texto + o.marketplace.por_linea, o.marketplace.total);
  for (const a of r.por_asesora) assert.equal(a.por_origen.meta + a.por_origen.marketplace.total + a.por_origen.directo, a.total);
});

caso("sin leads: todo en cero", () => {
  const r = agruparLeadsNuevos([], FECHA);
  assert.equal(r.fecha, FECHA);
  assert.equal(r.total, 0);
  assert.deepEqual(r.por_asesora, []);
});

console.log(`\n${pasadas} casos ok`);
