// Pruebas del EMBUDO POR PASO (dominio/eventos.ts y dominio/por-paso.ts): historial y paso anterior,
// "se quedó aquí" a las 24 h, tasas de paso a paso, mayor caída, grupo de asesora y marca del V2.
// No necesita base ni red. Correr: npm run test:embudo-por-paso
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const requireNativo = createRequire(import.meta.url);

/** Carga un .ts transpilado, resolviendo sus imports relativos a otros .ts. */
const cache = new Map();
function cargar(archivo) {
  const absoluto = path.resolve(archivo);
  if (cache.has(absoluto)) return cache.get(absoluto).exports;
  const salida = ts.transpileModule(fs.readFileSync(absoluto, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: absoluto,
  });
  const mod = { exports: {} };
  cache.set(absoluto, mod);
  const requerir = (pedido) => {
    if (pedido.startsWith(".")) {
      const base = path.resolve(path.dirname(absoluto), pedido);
      for (const candidato of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
        if (fs.existsSync(candidato) && fs.statSync(candidato).isFile()) return cargar(candidato);
      }
    }
    return requireNativo(pedido);
  };
  new Function("exports", "require", "module", "__filename", "__dirname", salida.outputText)(
    mod.exports,
    requerir,
    mod,
    absoluto,
    path.dirname(absoluto),
  );
  return mod.exports;
}

const ev = cargar("src/features/embudo/dominio/eventos.ts");
const pp = cargar("src/features/embudo/dominio/por-paso.ts");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const T0 = new Date("2026-10-20T15:00:00Z");
const h = (horas) => new Date(T0.getTime() + horas * 3_600_000);
const ctx = { conversationId: "c1", contactId: "k1", workspaceId: "ws", channelId: "ch", inicioDeLaCharla: T0 };
const paso = (p, horas, datos = null, producto = "combo-camilla") => ({ tipo: "PASO_ENTRA", origen: "motor", paso: p, producto, datos, createdAt: h(horas) });

prueba("guarda paso anterior, fecha de entrada e historial", () => {
  let foto = null;
  foto = ev.aplicarEvento(foto, paso("PRESENTACION", 0), ctx);
  assert.equal(foto.pasoAnterior, null);
  foto = ev.aplicarEvento(foto, paso("PRODUCTO", 2), ctx);
  assert.equal(foto.pasoAnterior, "PRESENTACION");
  assert.equal(foto.pasoActual, "PRODUCTO");
  assert.equal(foto.pasoDesde.getTime(), h(2).getTime());
  assert.deepEqual(foto.pasoHistorial.map((c) => c.paso), ["PRESENTACION", "PRODUCTO"]);
  assert.equal(foto.pasoHistorial[1].agente, "V3");
});

prueba("el mismo paso otra vez no mueve la fecha ni el historial", () => {
  let foto = ev.aplicarEvento(null, paso("PRODUCTO", 1), ctx);
  foto = ev.aplicarEvento(foto, paso("PRODUCTO", 5), ctx);
  assert.equal(foto.pasoDesde.getTime(), h(1).getTime());
  assert.equal(foto.pasoHistorial.length, 1);
});

prueba("el historial no pasa de 10 cambios", () => {
  let foto = null;
  const orden = ["PRESENTACION", "PRODUCTO"];
  for (let i = 0; i < 25; i += 1) foto = ev.aplicarEvento(foto, paso(orden[i % 2], i), ctx);
  assert.equal(foto.pasoHistorial.length, 10);
  assert.equal(foto.pasoHistorial.at(-1).en, h(24).toISOString());
});

prueba("volver a un paso anterior queda en el historial y no baja el paso más alto", () => {
  let foto = ev.aplicarEvento(null, paso("OBJECIONES", 0), ctx);
  foto = ev.aplicarEvento(foto, paso("PRODUCTO", 3), ctx);
  assert.equal(foto.pasoAnterior, "OBJECIONES");
  assert.equal(foto.pasoMaximo, "OBJECIONES");
  assert.equal(foto.pasoHistorial.length, 2);
});

prueba("el aviso del V2 queda marcado como del V2", () => {
  const foto = ev.aplicarEvento(null, paso("PRODUCTO", 0, { agente: "V2" }), ctx);
  assert.equal(foto.pasoHistorial[0].agente, "V2");
  const servicio = fs.readFileSync("src/features/embudo/servicios/eventos.ts", "utf8");
  assert.ok(servicio.includes('datos: { agente: "V2" }'));
  const sync = fs.readFileSync("src/lib/funnel-stage-sync.ts", "utf8");
  assert.ok(sync.includes("registrarPasoDelV2("));
});

const ahora = h(100);
const lead = (id, actual, maximo, sinEscribirHoras, extra = {}) => ({
  conversationId: id,
  pasoActual: actual,
  pasoMaximo: maximo,
  pasoDesde: h(0),
  entradaEn: h(0),
  ultimoClienteEn: new Date(ahora.getTime() - sinEscribirHoras * 3_600_000),
  historial: null,
  conAsesora: false,
  ...extra,
});

prueba("25 horas sin escribir = se quedó; 23 horas no", () => {
  assert.equal(pp.seQuedoAqui(lead("a", "PRODUCTO", "PRODUCTO", 25), ahora), true);
  assert.equal(pp.seQuedoAqui(lead("b", "PRODUCTO", "PRODUCTO", 23), ahora), false);
  const g = pp.medirGrupo([lead("a", "PRODUCTO", "PRODUCTO", 25), lead("b", "PRODUCTO", "PRODUCTO", 23)], ahora);
  assert.equal(g.pasos.find((p) => p.clave === "PRODUCTO").seQuedaron, 1);
});

prueba("llegaron, tasas y mayor caída", () => {
  const leads = [];
  for (let i = 0; i < 100; i += 1) leads.push(lead(`p${i}`, "PRESENTACION", "PRESENTACION", 30));
  for (let i = 0; i < 60; i += 1) leads.push(lead(`q${i}`, "PRODUCTO", "PRODUCTO", 30));
  for (let i = 0; i < 40; i += 1) leads.push(lead(`o${i}`, "OBJECIONES", "OBJECIONES", 1));
  for (let i = 0; i < 4; i += 1) leads.push(lead(`c${i}`, "CIERRE", "CIERRE", 1));
  // Presentación: 204 llegaron; Producto: 104; Objeciones: 44; Cierre: 4.
  const g = pp.medirGrupo(leads, ahora);
  const por = Object.fromEntries(g.pasos.map((p) => [p.clave, p]));
  assert.deepEqual([por.PRESENTACION.llegaron, por.PRODUCTO.llegaron, por.OBJECIONES.llegaron, por.CIERRE.llegaron], [204, 104, 44, 4]);
  assert.equal(por.PRODUCTO.pasaDesdeAnterior, 51);
  assert.equal(por.OBJECIONES.pasaDesdeAnterior, 42);
  assert.equal(por.CIERRE.pasaDesdeAnterior, 9);
  assert.equal(por.CIERRE.pocosDatos, false);
  assert.equal(por.PRESENTACION.seQuedaron, 100);
  assert.equal(g.mayorCaida.hasta, "Cierre");
  assert.equal(g.mayorCaida.seCaen, 40);
});

prueba("con pocos datos avisa y la caída prefiere los pasos con datos", () => {
  const leads = [];
  for (let i = 0; i < 50; i += 1) leads.push(lead(`p${i}`, "PRESENTACION", "PRESENTACION", 30));
  for (let i = 0; i < 10; i += 1) leads.push(lead(`q${i}`, "PRODUCTO", "PRODUCTO", 30));
  leads.push(lead("o", "OBJECIONES", "OBJECIONES", 1));
  const g = pp.medirGrupo(leads, ahora);
  assert.equal(g.pasos.find((p) => p.clave === "OBJECIONES").pocosDatos, true);
  assert.equal(g.mayorCaida.hasta, "Producto");
});

prueba("los chats con asesora van en su grupo aparte", () => {
  const e = pp.armarEmbudoPorPaso([lead("a", "PRODUCTO", "PRODUCTO", 30), lead("b", "CIERRE", "CIERRE", 1, { conAsesora: true })], ahora);
  assert.equal(e.soloBot.chats, 1);
  assert.equal(e.conAsesora.chats, 1);
  assert.equal(e.soloBot.pasos.find((p) => p.clave === "CIERRE").llegaron, 0);
  assert.equal(e.conAsesora.pasos.find((p) => p.clave === "CIERRE").llegaron, 1);
  assert.ok(pp.textoPorPaso(e, "Combo camilla").includes("una asesora"));
});

prueba("tiempo promedio por paso sale del historial", () => {
  const historial = [
    { paso: "PRESENTACION", producto: null, en: h(0).toISOString(), agente: "V3" },
    { paso: "PRODUCTO", producto: null, en: h(2).toISOString(), agente: "V3" },
    { paso: "OBJECIONES", producto: null, en: h(6).toISOString(), agente: "V3" },
  ];
  const g = pp.medirGrupo([lead("a", "OBJECIONES", "OBJECIONES", 1, { historial })], ahora);
  assert.equal(g.pasos.find((p) => p.clave === "PRESENTACION").horasPromedio, 2);
  assert.equal(g.pasos.find((p) => p.clave === "PRODUCTO").horasPromedio, 4);
});

console.log(`\n${pruebas} pruebas ok`);
