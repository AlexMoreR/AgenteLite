// Pruebas de COMPARAR EMBUDOS (src/features/embudo/dominio/comparar.ts): % por paso, tasa de cierre,
// paso donde más se cae, días hasta la venta, diferencia verde/roja, aviso "faltan datos", filtros,
// casos vacíos y plata "no disponible". Sin base ni red. Correr: npm run test:comparar-embudos
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

const comparar = cargar("src/features/embudo/dominio/comparar.ts");

let pruebas = 0;
const fallas = [];
function prueba(nombre, fn) {
  try {
    fn();
    pruebas += 1;
    console.log(`ok - ${nombre}`);
  } catch (error) {
    fallas.push(nombre);
    console.log(`FALLA - ${nombre}\n  ${String(error?.stack ?? error).split("\n").slice(0, 6).join("\n  ")}`);
  }
}

let n = 0;
function lead(extra = {}) {
  n += 1;
  return {
    conversationId: `c${n}`,
    entradaEn: "2026-10-01T15:00:00.000Z",
    libroVersion: 3,
    familia: "combo",
    canalId: "L1",
    origen: "anuncio",
    respondio: false,
    dioCiudad: false,
    caliente: false,
    compro: false,
    ventaEn: null,
    monto: null,
    ...extra,
  };
}
/** `cuantos` chats con las banderas dadas. */
const muchos = (cuantos, extra) => Array.from({ length: cuantos }, () => lead(extra));

// Versión 3: 100 chats -> 60 respondieron -> 30 ciudad -> 10 caliente -> 4 compraron.
const v3 = [
  ...muchos(40, {}),
  ...muchos(30, { respondio: true }),
  ...muchos(20, { respondio: true, dioCiudad: true }),
  ...muchos(6, { respondio: true, dioCiudad: true, caliente: true }),
  ...muchos(4, { respondio: true, dioCiudad: true, caliente: true, compro: true, ventaEn: "2026-10-05T15:00:00.000Z" }),
];
// Versión 4: 100 chats -> 70 -> 50 -> 20 -> 8.
const v4 = [
  ...muchos(30, { libroVersion: 4 }),
  ...muchos(20, { libroVersion: 4, respondio: true }),
  ...muchos(30, { libroVersion: 4, respondio: true, dioCiudad: true }),
  ...muchos(12, { libroVersion: 4, respondio: true, dioCiudad: true, caliente: true }),
  ...muchos(8, { libroVersion: 4, respondio: true, dioCiudad: true, caliente: true, compro: true, ventaEn: "2026-10-03T15:00:00.000Z" }),
];

prueba("porcentajes acumulativos y tasa de cierre", () => {
  const r = comparar.resumirVersion(3, v3);
  assert.equal(r.chats, 100);
  assert.equal(r.pctRespondio, 60);
  assert.equal(r.pctCiudad, 30);
  assert.equal(r.pctCaliente, 10);
  assert.equal(r.tasaCierre, 4);
  assert.equal(r.compraron, 4);
  assert.deepEqual(r.pasos.map((p) => p.leads), [100, 60, 30, 10, 4]);
  assert.equal(r.faltanDatos, false);
});

prueba("un paso avanzado cuenta en los anteriores aunque falte su bandera", () => {
  const r = comparar.resumirVersion(3, [lead({ compro: true })]);
  assert.deepEqual(r.pasos.map((p) => p.leads), [1, 1, 1, 1, 1]);
});

prueba("el paso donde más se cae", () => {
  const r = comparar.resumirVersion(3, v3);
  assert.equal(r.mayorCaida.desde, "entro");
  assert.equal(r.mayorCaida.hacia, "respondio");
  assert.equal(r.mayorCaida.quedaron, 40);
  assert.equal(r.mayorCaida.pctQuedaron, 40);
  const otro = comparar.resumirVersion(5, [...muchos(10, { libroVersion: 5, respondio: true, dioCiudad: true, caliente: true }), ...muchos(30, { libroVersion: 5, respondio: true, dioCiudad: true })]);
  assert.equal(otro.mayorCaida.desde, "ciudad");
});

prueba("días promedio hasta la venta", () => {
  const r = comparar.resumirVersion(3, v3);
  assert.equal(r.diasHastaVenta, 4);
  assert.equal(comparar.resumirVersion(3, muchos(3, {})).diasHastaVenta, null);
});

prueba("diferencia verde si mejora, roja si empeora", () => {
  const c = comparar.compararVersiones([...v3, ...v4], 3, 4);
  assert.equal(c.diferencias.cierre.tono, "mejor");
  assert.equal(c.diferencias.cierre.texto, "+4 puntos");
  assert.equal(c.diferencias.dias.tono, "mejor"); // 2 días contra 4: menos es mejor
  const al_reves = comparar.compararVersiones([...v3, ...v4], 4, 3);
  assert.equal(al_reves.diferencias.cierre.tono, "peor");
  assert.equal(al_reves.diferencias.cierre.texto, "−4 puntos");
  assert.equal(al_reves.diferencias.dias.tono, "peor");
  assert.equal(c.diferencias.chats.tono, "igual");
});

prueba("quién vende más", () => {
  assert.equal(comparar.compararVersiones([...v3, ...v4], 3, 4).ganadora, "b");
  assert.equal(comparar.compararVersiones([...v3, ...v4], 4, 3).ganadora, "a");
  assert.equal(comparar.compararVersiones(v3, 3, 3).ganadora, null);
});

prueba('aviso "faltan datos" con menos de 100 chats', () => {
  const pocos = comparar.compararVersiones([...v3, ...muchos(20, { libroVersion: 9, compro: true })], 3, 9);
  assert.equal(pocos.b.faltanDatos, true);
  assert.equal(pocos.a.faltanDatos, false);
  assert.ok(pocos.avisos.some((aviso) => aviso.includes("Faltan datos") && aviso.includes("Versión 9")));
  assert.equal(comparar.MINIMO_DE_CHATS, 100);
});

prueba("casos vacíos y división por cero no rompen", () => {
  const vacio = comparar.resumirVersion(7, []);
  assert.equal(vacio.chats, 0);
  assert.equal(vacio.tasaCierre, null);
  assert.equal(vacio.mayorCaida, null);
  assert.equal(vacio.faltanDatos, true);
  const c = comparar.compararVersiones(v3, 3, 7);
  assert.equal(c.diferencias.cierre.tono, "nada");
  assert.equal(c.ganadora, null);
  assert.ok(comparar.textoDeComparacion(c).length > 0);
});

prueba("plata: no disponible sin monto, suma con monto", () => {
  const sin = comparar.compararVersiones(v3, 3, 3);
  assert.equal(sin.a.plata, null);
  assert.ok(sin.avisos.some((a) => a.includes("plata vendida no está disponible")));
  const con = comparar.resumirVersion(3, [lead({ compro: true, monto: 1_000_000 }), lead({ compro: true, monto: 500_000 }), lead({})]);
  assert.equal(con.plata, 1_500_000);
  assert.ok(comparar.textoDeComparacion(comparar.compararResumenes(con, con)).includes("$1.500.000"));
});

prueba("filtros: fechas (Bogotá), línea, origen y producto", () => {
  const base = [
    lead({ entradaEn: "2026-10-01T04:59:00.000Z" }), // 30-sep 23:59 en Bogotá
    lead({ entradaEn: "2026-10-01T05:00:00.000Z" }), // 1-oct 00:00 en Bogotá
    lead({ entradaEn: "2026-10-02T12:00:00.000Z", canalId: "L2", origen: "marketplace", familia: "camillas" }),
  ];
  assert.equal(comparar.filtrarLeads(base, { desde: "2026-10-01" }).length, 2);
  assert.equal(comparar.filtrarLeads(base, { hasta: "2026-10-01" }).length, 2);
  assert.equal(comparar.filtrarLeads(base, { canalId: "L2" }).length, 1);
  assert.equal(comparar.filtrarLeads(base, { origen: "marketplace" }).length, 1);
  assert.equal(comparar.filtrarLeads(base, { familia: "combo" }).length, 2);
  assert.equal(comparar.filtrarLeads(base, { desde: "basura" }).length, 3);
});

prueba("versiones disponibles y sin versión", () => {
  const todos = [...v3, ...v4.slice(0, 5), lead({ libroVersion: null })];
  assert.deepEqual(comparar.versionesDisponibles(todos), [{ version: 3, chats: 100 }, { version: 4, chats: 5 }]);
  assert.equal(comparar.etiquetaDeVersion(null), "Sin versión");
});

prueba("el texto para decir por voz nombra la ganadora y la caída", () => {
  const texto = comparar.textoDeComparacion(comparar.compararVersiones([...v3, ...v4], 3, 4));
  assert.ok(texto.startsWith("Versión 4 vende más"));
  assert.ok(texto.includes("se cae sobre todo entre"));
});

prueba("familiaDePedido", () => {
  assert.equal(comparar.familiaDePedido("camillas"), "camillas");
  assert.equal(comparar.familiaDePedido("Marketplace"), "marketplace");
  assert.equal(comparar.familiaDePedido("nada"), null);
});

console.log(`\n${pruebas} pruebas ok, ${fallas.length} con falla`);
if (fallas.length) {
  console.log("Fallaron:", fallas.join(" | "));
  process.exit(1);
}
