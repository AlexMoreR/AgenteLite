// Pruebas del FRENO GENERAL DE SEGUIMIENTOS AUTOMÁTICOS (src/features/seguimientos/dominio/seguimientos-automaticos-apagados.ts,
// decisión del dueño del 9-11-2026): el bot se queda solo con los de 15 min y 1 h del reloj V3; todo lo
// posterior a 1 hora (Follow automáticos) lo hace el equipo a mano. Esta parte construye el freno sin prenderlo.
// Sin base ni red. Correr: npm run test:seguimientos-solo-reloj-v3
import assert from "node:assert/strict";
import fs from "node:fs";

import { cargar } from "./supervisor-cargar.mjs";

const fr = cargar("src/features/seguimientos/dominio/seguimientos-automaticos-apagados.ts");
const ab = cargar("src/lib/anti-bloqueo/reglas.ts");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const cancela = (follow, valor) => fr.seCancelaPorSeguimientosAutomaticosApagados(ab.clasificarFollow(follow), valor);

// Los Follow que son "lo posterior a 1 hora" (todos de clase automatico).
const AUTOMATICOS = [
  { name: "Etapa Bienvenida · día siguiente", followRuleId: null, timeValue: 1 },
  { name: "Sin responder 1", followRuleId: null, timeValue: 2 },
  { name: "Inteligente: útil", followRuleId: null, timeValue: 3 },
  { name: "Tras asesora: 1 h", followRuleId: null, timeValue: 1 },
  // Los "Tras asesora" se guardan con timeValue 0: por eso se decide por la clase y no por el plazo.
  { name: "Tras asesora: 1 h", followRuleId: null, timeValue: 0 },
  { name: null, followRuleId: "regla1", timeValue: 1 },
];

// Los que decide una persona: nunca los frena.
const DE_PERSONAS = [
  [{ name: "Llamar mañana", followRuleId: null }, "humano"],
  [{ name: null, followRuleId: null }, "humano"],
  [{ name: "Campaña: noviembre", followRuleId: null }, "campana"],
  [{ name: "Automatización: Recuperación 72 h", followRuleId: null }, "automatizacion"],
  [{ name: ab.NOMBRE_FOLLOW_REACTIVACION, followRuleId: null }, "reactivacion"],
];

prueba("la clave de la fila es seguimientos-automaticos:apagado", () => {
  assert.equal(fr.CLAVE_SEGUIMIENTOS_AUTOMATICOS_APAGADOS, "seguimientos-automaticos:apagado");
});

prueba("(a) con 'si': se cancelan embudo, Sin responder, Inteligente, Tras asesora (también con timeValue 0) y reglas", () => {
  for (const follow of AUTOMATICOS) {
    assert.equal(ab.clasificarFollow(follow), "automatico", JSON.stringify(follow));
    for (const valor of ["si", "SI", "  Si  "]) assert.equal(cancela(follow, valor), true, `${JSON.stringify(follow)} con ${valor}`);
  }
});

prueba("(b) con 'si': NO se cancelan humano, campaña, automatización ni reactivación", () => {
  for (const [follow, clase] of DE_PERSONAS) {
    assert.equal(ab.clasificarFollow(follow), clase, JSON.stringify(follow));
    assert.equal(cancela(follow, "si"), false, clase);
  }
  for (const clase of ["humano", "campana", "automatizacion", "reactivacion"]) {
    assert.equal(fr.seCancelaPorSeguimientosAutomaticosApagados(clase, "si"), false, clase);
  }
});

prueba("(c) sin fila, con 'no' o con otro valor: no se cancela nada", () => {
  for (const valor of [null, undefined, "", "no", "NO", "off", "sí"]) {
    for (const follow of [...AUTOMATICOS, ...DE_PERSONAS.map(([f]) => f)]) {
      assert.equal(cancela(follow, valor), false, `${JSON.stringify(follow)} con ${String(valor)}`);
    }
  }
});

prueba("(d) cableado: en executeFollowRecord el freno va antes de revisarDiaSiguienteAlEnviar(follow) y usa seguimiento_apagado", () => {
  const src = fs.readFileSync("src/features/seguimientos/services/follows.ts", "utf8");
  const inicio = src.indexOf("async function executeFollowRecord");
  assert.ok(inicio > 0, "existe executeFollowRecord");
  const cuerpo = src.slice(inicio, src.indexOf("\n}\n", inicio));
  const iTry = cuerpo.indexOf("try {");
  const iLectura = cuerpo.indexOf("CLAVE_SEGUIMIENTOS_AUTOMATICOS_APAGADOS");
  const iFreno = cuerpo.indexOf("seCancelaPorSeguimientosAutomaticosApagados(");
  const iDia = cuerpo.indexOf("revisarDiaSiguienteAlEnviar(follow)");
  const iCatch = cuerpo.indexOf("} catch (error) {");
  assert.ok(iTry > 0 && iTry < iLectura && iLectura < iFreno && iFreno < iDia && iDia < iCatch, "orden: try → freno general → día siguiente → catch");
  const bloque = cuerpo.slice(iLectura, iDia);
  assert.match(bloque, /motivo: "seguimiento_apagado", reprogramarPara: null/);
  assert.match(cuerpo.slice(cuerpo.indexOf('if (clase === "automatico") {'), iLectura), /prisma\.appSetting\.findUnique/);
  assert.match(cuerpo.slice(iFreno, iDia + 40), /if \(!antiBloqueo\) \{\s*const frenoDiaSiguiente = await revisarDiaSiguienteAlEnviar\(follow\)/);
  // "seguimiento_apagado" no se reprograma: cancela por el camino normal.
  const reglas = fs.readFileSync("src/lib/anti-bloqueo/reglas.ts", "utf8");
  assert.match(reglas, /\| "seguimiento_apagado"/);
  assert.equal(ab.MOTIVOS_QUE_REPROGRAMAN.includes("seguimiento_apagado"), false);
});

prueba("el reloj del V3 (15 min y 1 h) no pasa por este freno: no usa la clave", () => {
  const v3 = fs.readFileSync("src/features/agente-v3/servicios/seguimientos.ts", "utf8");
  assert.doesNotMatch(v3, /seguimientos-automaticos:apagado|seguimientos-automaticos-apagados/);
});

prueba("la herramienta del MCP muestra el estado seguimientos_automaticos", () => {
  const mcp = fs.readFileSync("src/lib/mcp/que-es-esta-aplicacion.ts", "utf8");
  assert.match(mcp, /bandera\("seguimientos-automaticos:apagado"\)/);
  assert.match(mcp, /seguimientos_automaticos:/);
  assert.match(mcp, /solo salen los seguimientos de 15 min y 1 h del reloj V3/);
});

console.log(`\n${pruebas} pruebas del freno general de seguimientos automáticos: todas pasaron.`);
