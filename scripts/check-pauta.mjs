// Pruebas del reporte de pauta (src/features/pauta/dominio/reporte.ts) y de que Meta Ads solo se LEA.
// Con datos de prueba, sin red ni base. Correr: npm run test:pauta
import assert from "node:assert/strict";
import fs from "node:fs";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

const r = cargar("src/features/pauta/dominio/reporte.ts");
let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}
const origen = (contactId, anuncioId, campanaId, campanaNombre, caliente = false) => ({
  contactId, anuncioId, anuncioNombre: `Anuncio ${anuncioId}`, conjuntoNombre: null, campanaId, campanaNombre, caliente,
});

prueba("chat de anuncio con venta: la venta cuenta en su campaña", () => {
  const rep = r.armarReporte({
    origenes: [origen("c1", "A1", "K1", "Combo", true), origen("c2", "A1", "K1", "Combo"), origen("c3", "A2", "K2", "Camillas")],
    ventas: [{ origen: { anuncioId: "A1", campanaId: "K1" }, monto: 1_000_000 }],
    gastos: [{ anuncioId: "A1", anuncioNombre: "A1", conjuntoNombre: null, campanaId: "K1", campanaNombre: "Combo", gasto: 200_000 }],
  });
  const combo = rep.campanas.find((c) => c.clave === "K1");
  assert.equal(combo.chats, 2);
  assert.equal(combo.calientes, 1);
  assert.equal(combo.ventas, 1);
  assert.equal(combo.monto, 1_000_000);
  assert.equal(combo.tasaCierre, 50);
  assert.equal(combo.costoPorVenta, 200_000);
  assert.equal(combo.anuncios[0].ventas, 1);
  assert.equal(rep.campanas[0].clave, "K1", "ordenado por ventas");
  assert.equal(rep.total.ventas, 1);
});

prueba("venta sin chat de anuncio: va a Orgánico / Marketplace / Otro", () => {
  const rep = r.armarReporte({ origenes: [origen("c1", "A1", "K1", "Combo")], ventas: [{ origen: null, monto: 500 }], gastos: null });
  assert.equal(rep.organico.nombre, "Orgánico / Marketplace / Otro");
  assert.equal(rep.organico.ventas, 1);
  assert.equal(rep.organico.monto, 500);
  assert.equal(rep.total.ventas, 0);
});

prueba("teléfono con 57 y sin 57 es el mismo cliente", () => {
  assert.ok(r.mismoTelefono("573001112233", "3001112233"));
  assert.ok(r.mismoTelefono("+57 300 111 2233", "300-111-2233"));
  assert.ok(!r.mismoTelefono("573001112233", "3009998877"));
  assert.deepEqual(r.variantesDeTelefono("3001112233").sort(), ["3001112233", "573001112233"]);
  assert.deepEqual(r.variantesDeTelefono("123"), []);
});

prueba("campaña sin gasto o sin ventas: el costo por venta es null (—), no un error", () => {
  const rep = r.armarReporte({
    origenes: [origen("c1", "A1", "K1", "Combo"), origen("c2", "A2", "K2", "Camillas")],
    ventas: [{ origen: { anuncioId: "A1", campanaId: "K1" }, monto: null }],
    gastos: [{ anuncioId: "A2", anuncioNombre: null, conjuntoNombre: null, campanaId: "K2", campanaNombre: "Camillas", gasto: 80_000 }],
  });
  const k1 = rep.campanas.find((c) => c.clave === "K1");
  const k2 = rep.campanas.find((c) => c.clave === "K2");
  assert.equal(k1.costoPorVenta, null, "con ventas pero sin gasto");
  assert.equal(k2.costoPorVenta, null, "con gasto pero sin ventas");
  assert.equal(k2.tasaCierre, 0);
  assert.equal(r.textoDinero(null), "—");
  assert.equal(r.textoTasa(null), "—");
  assert.equal(k1.monto, null, "sin monto conocido");
});

prueba("sin llave de Meta: gasto no disponible y se agrupa sin nombre de campaña", () => {
  const rep = r.armarReporte({ origenes: [origen("c1", "A1", null, null), origen("c2", "A2", null, null)], ventas: [], gastos: null });
  assert.equal(rep.gastoDisponible, false);
  assert.equal(rep.campanas.length, 1);
  assert.equal(rep.campanas[0].nombre, "Campaña sin identificar");
  assert.equal(rep.campanas[0].gasto, null);
  assert.equal(rep.campanas[0].anuncios.length, 2);
});

prueba("ficha sin anuncio guardado: queda sin origen; con anuncio, se lee lo que dejó el webhook", () => {
  const creada = new Date("2026-10-01T00:00:00Z");
  assert.equal(r.anuncioDeLaFicha(null, creada), null);
  assert.equal(r.anuncioDeLaFicha({ nombre: "x" }, creada), null);
  const a = r.anuncioDeLaFicha({ adSourceId: "123456789", adTitle: "Combo", adSourceApp: "Instagram", adCtwaClid: "abc", adCapturedAt: "2026-10-05T10:00:00.000Z" }, creada);
  assert.equal(a.anuncioId, "123456789");
  assert.equal(a.red, "instagram");
  assert.equal(a.llegoEn.toISOString(), "2026-10-05T10:00:00.000Z");
});

prueba("el resumen para decir nombra la campaña que más vendió", () => {
  const rep = r.armarReporte({
    origenes: [origen("c1", "A1", "K1", "Combo")],
    ventas: [{ origen: { anuncioId: "A1", campanaId: "K1" }, monto: 100 }],
    gastos: [{ anuncioId: "A1", anuncioNombre: null, conjuntoNombre: null, campanaId: "K1", campanaNombre: "Combo", gasto: 50 }],
  });
  const frase = r.resumenParaDecir(rep, { desde: "2026-10-01", hasta: "2026-10-26" });
  assert.ok(frase.includes('"Combo"') && frase.includes("1 ventas"));
});

prueba("Meta Ads: el código nuevo solo lee (GET), nunca escribe", () => {
  const meta = fs.readFileSync(`${RAIZ}/src/features/pauta/servicios/meta-ads-lectura.ts`, "utf8");
  const sinComentarios = meta.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/method:\s*["'](POST|PUT|PATCH|DELETE)["']/i.test(sinComentarios), "no hay método de escritura");
  assert.ok(/method:\s*"GET"/.test(sinComentarios));
  assert.equal((sinComentarios.match(/fetch\(/g) ?? []).length, 1, "un solo fetch");
  for (const archivo of ["origen-del-chat", "ventas-de-gestion", "leer-reporte", "correr-pauta"]) {
    const texto = fs.readFileSync(`${RAIZ}/src/features/pauta/servicios/${archivo}.ts`, "utf8");
    assert.ok(!/graph\.facebook\.com/.test(texto), `${archivo} no habla con Meta directamente`);
  }
  const gestion = fs.readFileSync(`${RAIZ}/src/features/pauta/servicios/ventas-de-gestion.ts`, "utf8");
  assert.ok(!/method:\s*["'](POST|PUT|PATCH|DELETE)["']/i.test(gestion), "a Gestión también solo se le lee");
});

console.log(`\n${pruebas} pruebas pasaron`);
