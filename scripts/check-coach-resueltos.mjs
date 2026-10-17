// Pruebas de "chats ya cerrados en el Coach" (Alex, 16-10-2026): src/features/coach/dominio/chats-cerrados.ts
// y su uso en "Acciones de hoy". Un chat resuelto (CLOSED / ARCHIVED), descartado (PERDIDO) o ganado
// (GANADO) sale de los pendientes; la evidencia se queda con la etiqueta. Sin base ni red.
// Correr: npm run test:coach-resueltos
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const requireNativo = createRequire(import.meta.url);
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
  new Function("exports", "require", "module", "__filename", "__dirname", salida.outputText)(mod.exports, requerir, mod, absoluto, path.dirname(absoluto));
  return mod.exports;
}

const c = cargar("src/features/coach/dominio/chats-cerrados.ts");
const a = cargar("src/features/coach/dominio/acciones-de-hoy.ts");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const chat = (numero) => ({ ref: `#${numero}`, numero, ultimos4: "…0204", nombre: "" });

prueba("cierreDeChat: resuelto, descartado, ganado o abierto", () => {
  assert.equal(c.cierreDeChat({ estado: "CLOSED", crmStage: "NEGOCIACION" }), "resuelto");
  assert.equal(c.cierreDeChat({ estado: "ARCHIVED", crmStage: null }), "resuelto");
  assert.equal(c.cierreDeChat({ estado: "OPEN", crmStage: "PERDIDO" }), "descartado");
  assert.equal(c.cierreDeChat({ estado: "OPEN", crmStage: "GANADO" }), "ganado");
  // La etapa manda: el caso del dueño (resolvio y puso Descartado) dice "Descartado".
  assert.equal(c.cierreDeChat({ estado: "CLOSED", crmStage: "PERDIDO" }), "descartado");
  assert.equal(c.cierreDeChat({ estado: "CLOSED", crmStage: "GANADO" }), "ganado");
  assert.equal(c.cierreDeChat({ estado: "OPEN", crmStage: "PROPUESTA" }), null);
  assert.equal(c.cierreDeChat({ estado: "PENDING", crmStage: "NUEVO" }), null);
  assert.equal(c.cierreDeChat({ estado: null, crmStage: null }), null);
});

prueba("armarCierres: solo los cerrados, por numero", () => {
  const mapa = c.armarCierres([
    { numero: 1, estado: "CLOSED", crmStage: "PROPUESTA" },
    { numero: 2, estado: "OPEN", crmStage: "PERDIDO" },
    { numero: 3, estado: "OPEN", crmStage: "NEGOCIACION" },
    { numero: 4, estado: "OPEN", crmStage: "GANADO" },
    { numero: null, estado: "CLOSED", crmStage: null },
  ]);
  assert.deepEqual(mapa, { 1: "resuelto", 2: "descartado", 4: "ganado" });
});

prueba("sinChatsCerrados: quita los cerrados y deja los abiertos y los sin numero", () => {
  const cierres = { 10: "resuelto", 11: "descartado", 12: "ganado" };
  const lista = [chat(10), chat(11), chat(12), chat(13), { ...chat(0), numero: null }];
  const quedan = c.sinChatsCerrados(lista, cierres);
  assert.deepEqual(
    quedan.map((p) => p.numero),
    [13, null],
  );
  // Sin mapa (no se pudo leer la base): no se quita nada.
  assert.equal(c.sinChatsCerrados(lista, null).length, 5);
  // No cambia la lista original (el informe guardado).
  assert.equal(lista.length, 5);
});

prueba("numerosDeLaParte y cierresDe: una sola lista sin repetidos; solo los de la parte", () => {
  const parte = {
    errores: [chat(1), chat(2)],
    pendientes: [chat(2), chat(3)],
    aciertos: [chat(4)],
    resumen: { habilidad: { evidencia: [chat(1), chat(5)] } },
  };
  assert.deepEqual(c.numerosDeLaParte(parte).sort(), [1, 2, 3, 4, 5]);
  assert.deepEqual(c.cierresDe([1, 3], { 1: "ganado", 3: "resuelto", 9: "descartado" }), { 1: "ganado", 3: "resuelto" });
});

prueba("Acciones de hoy: la evidencia de un chat cerrado se queda con su etiqueta", () => {
  const habilidad = {
    version: "habilidad-v1",
    clave: "responder_a_tiempo",
    nombre: "Responder a tiempo",
    impacto: 3,
    ranking: [{ clave: "responder_a_tiempo", impacto: 3 }],
    etapaCritica: null,
    incluyeErrorDelEquipo: false,
    evidencia: [{ ...chat(20), texto: "Tardó 2 h" }, { ...chat(21), texto: "Tardó 1 h" }],
    queHacerDiferente: "Responder en menos de 15 min.",
    ejemplo: "Hola",
    metrica: { nombre: "demoras", hoy: 2, meta: 0, sentido: "bajar", texto: "0 demoras" },
    redactadoPor: "plantilla",
  };
  const parte = {
    userId: "u1",
    nombre: "Ingrid",
    chats: 3,
    puntaje: 7,
    puntajes: null,
    aciertos: [],
    errores: [{ ...chat(20), tipo: "demora", detalle: "Tardó 2 h" }],
    // Lo que deja leer-coach.ts: ya sin los pendientes cerrados.
    pendientes: c.sinChatsCerrados(
      [
        { ...chat(20), temperatura: "tibio", urgente: false, porque: "x", siguienteMensaje: "y", etapa: "" },
        { ...chat(22), temperatura: "caliente", urgente: true, porque: "x", siguienteMensaje: "y", etapa: "" },
      ],
      { 20: "descartado" },
    ),
    resumen: { loQueHizoBien: "", unaCosaAMejorar: "", ejemplo: "", habilidad, metricas: null },
    cierres: { 20: "descartado" },
  };
  const acciones = a.armarAccionesDeHoy({ dia: "2026-10-15", resumenEquipo: null, asesoras: [parte] });
  const t = acciones.tarjetas[0];
  assert.equal(t.evidencia.length, 2, "la evidencia no se filtra");
  assert.equal(t.evidencia[0].cierre, "descartado");
  assert.equal(t.evidencia[1].cierre, undefined, "un chat abierto no lleva etiqueta");
  assert.equal(t.errores[0].cierre, "descartado");
  assert.deepEqual(
    t.pendientes.map((p) => p.ref),
    ["#22"],
    "Pendientes para hoy: solo el abierto",
  );
  assert.equal(c.ETIQUETA_DE_CIERRE[t.evidencia[0].cierre], "Descartado");
});

prueba("enlaceDeChat sin cierres: igual que antes (sin campo cierre)", () => {
  const e = a.enlaceDeChat(chat(30), {});
  assert.equal("cierre" in e, false);
  assert.equal(a.enlaceDeChat(chat(30), {}, { 30: "ganado" }).cierre, "ganado");
});

console.log(`\n${pruebas} pruebas ok`);
