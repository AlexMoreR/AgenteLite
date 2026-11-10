// Pruebas del FRENO GENERAL DE SEGUIMIENTOS AUTOMÁTICOS (src/features/seguimientos/dominio/
// seguimientos-automaticos-apagados.ts, decisión del dueño del 9-11-2026): el bot se queda solo con los
// seguimientos de 15 min y 1 h del reloj V3; lo posterior a 1 h (filas de Follow) lo hace el equipo a mano.
// Sin base ni red. Correr: npm run test:seguimientos-solo-reloj-v3
import assert from "node:assert/strict";
import fs from "node:fs";

import { cargar } from "./supervisor-cargar.mjs";

const fr = cargar("src/features/seguimientos/dominio/seguimientos-automaticos-apagados.ts");
const rg = cargar("src/lib/anti-bloqueo/reglas.ts");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const seCancela = (follow, valor) => fr.seCancelaPorSeguimientosAutomaticosApagados(rg.clasificarFollow(follow), valor);

const AUTOMATICOS = [
  { name: "Etapa Bienvenida · día siguiente", followRuleId: null, timeValue: 1 },
  { name: "Sin responder 24 h", followRuleId: null, timeValue: 24 },
  { name: "Inteligente: te cuento del combo", followRuleId: null, timeValue: 2 },
  { name: "Tras asesora: 1 h", followRuleId: null, timeValue: 1 },
  // Los "Tras asesora" se guardan con timeValue 0: se decide por la clase, no por el plazo.
  { name: "Tras asesora: 24 h", followRuleId: null, timeValue: 0 },
  { name: "Seguimiento de la regla", followRuleId: "regla-1", timeValue: 3 },
];

prueba("la clave es seguimientos-automaticos:apagado", () => {
  assert.equal(fr.CLAVE_SEGUIMIENTOS_AUTOMATICOS_APAGADOS, "seguimientos-automaticos:apagado");
});

prueba("con 'si': se cancelan los automáticos de Follow (embudo, sin responder, inteligente, tras asesora, regla)", () => {
  for (const follow of AUTOMATICOS) {
    assert.equal(rg.clasificarFollow(follow), "automatico", follow.name);
    for (const valor of ["si", " SI ", "Si\n"]) assert.equal(seCancela(follow, valor), true, `${follow.name} con ${JSON.stringify(valor)}`);
  }
});

prueba("con 'si': NO se cancelan humano, campaña, automatización ni reactivación", () => {
  const otros = [
    [{ name: "Llamar el lunes", followRuleId: null }, "humano"],
    [{ name: null, followRuleId: null }, "humano"],
    [{ name: "Campaña: Black Friday", followRuleId: null }, "campana"],
    [{ name: "Automatización: Recuperación 72 h", followRuleId: null }, "automatizacion"],
    [{ name: rg.NOMBRE_FOLLOW_REACTIVACION, followRuleId: null }, "reactivacion"],
  ];
  for (const [follow, clase] of otros) {
    assert.equal(rg.clasificarFollow(follow), clase, String(follow.name));
    assert.equal(seCancela(follow, "si"), false, String(follow.name));
  }
  for (const clase of ["humano", "campana", "automatizacion", "reactivacion"]) {
    assert.equal(fr.seCancelaPorSeguimientosAutomaticosApagados(clase, "si"), false, clase);
  }
});

prueba("sin fila, vacía o con 'no': no se cancela nada", () => {
  for (const valor of [null, undefined, "", "no", "NO", "off", "sí-no"]) {
    for (const follow of AUTOMATICOS) assert.equal(seCancela(follow, valor), false, `${follow.name} con ${JSON.stringify(valor)}`);
  }
});

prueba("follows.ts: el freno va dentro de executeFollowRecord, antes de revisarDiaSiguienteAlEnviar(follow), y usa seguimiento_apagado", () => {
  const src = fs.readFileSync(new URL("../src/features/seguimientos/services/follows.ts", import.meta.url), "utf8");
  const inicio = src.indexOf("async function executeFollowRecord");
  assert.ok(inicio > 0, "existe executeFollowRecord");
  const cuerpo = src.slice(inicio, src.indexOf("\n}\n", inicio));
  const freno = cuerpo.indexOf("seCancelaPorSeguimientosAutomaticosApagados(");
  const lectura = cuerpo.indexOf("CLAVE_SEGUIMIENTOS_AUTOMATICOS_APAGADOS");
  const diaSiguiente = cuerpo.indexOf("revisarDiaSiguienteAlEnviar(follow)");
  const elTry = cuerpo.indexOf("try {");
  const elCatch = cuerpo.indexOf("} catch (error)");
  assert.ok(freno > 0 && lectura > 0 && diaSiguiente > 0, "están el freno, la lectura de la fila y el día siguiente");
  assert.ok(elTry < lectura && lectura < freno && freno < diaSiguiente && diaSiguiente < elCatch, "dentro del try y antes del día siguiente");
  const bloque = cuerpo.slice(freno, diaSiguiente);
  assert.match(bloque, /motivo: "seguimiento_apagado", reprogramarPara: null/);
  assert.match(bloque, /if \(!antiBloqueo\) \{/, "el día siguiente solo corre si el freno no canceló");
  assert.match(cuerpo.slice(elTry, freno), /if \(clase === "automatico"\)/, "solo lee la fila para los automáticos");
  // Motivo existente y que NO se reprograma: cancela por el camino normal.
  const reglas = fs.readFileSync(new URL("../src/lib/anti-bloqueo/reglas.ts", import.meta.url), "utf8");
  assert.ok(reglas.includes('| "seguimiento_apagado"'));
  assert.ok(!rg.MOTIVOS_QUE_REPROGRAMAN.includes("seguimiento_apagado"));
});

console.log(`\n${pruebas} pruebas OK`);
