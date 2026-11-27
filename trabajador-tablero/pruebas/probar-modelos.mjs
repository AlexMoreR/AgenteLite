// Pruebas de los modelos por paso del Coordinador (23-oct-2026):
//   npm run test:trabajador-tablero   (o: node trabajador-tablero/pruebas/probar-modelos.mjs)
// Reglas fijas en código (lib/modelos.mjs), sin IA para decidir, y el texto que ve el dueño en la tarjeta.
import assert from "node:assert/strict";

import { cargar } from "../../scripts/supervisor-cargar.mjs";
import { esLimiteDeUso } from "../lib/diagnostico.mjs";
import { completarConfig } from "../lib/config.mjs";
import { DETALLE_LARGO, dificultadDeLaTarea, modeloDelPaso, nombreDelModelo } from "../lib/modelos.mjs";

const textos = cargar("src/features/tableros-inteligentes/services/modelos-del-coordinador.ts");
const reglas = cargar("src/features/tableros-inteligentes/services/reglas-trabajador.ts");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const base = { urlCrm: "https://app.aizenbot.com", claveTrabajador: "aizen_trab_x", repos: { aizencrm: { ruta: ".", subirSolo: false } } };
const sencilla = { titulo: "Cambiar el color del botón Guardar", detalle: "Ponerlo verde en la ficha.", intentos: 1 };
// Las reglas de antes de la regla del dueño del 27-nov-2026 (CAMBIOS_DE_MODELO_DEL_CODIGO) se prueban con esta fecha.
const ANTES_DEL_27_NOV = Date.parse("2026-11-26T12:00:00Z");

prueba("antes del 27-nov, tarea sencilla: Sonnet; el resto de pasos también Sonnet y leer con Haiku", () => {
  const config = completarConfig(base);
  assert.deepEqual(dificultadDeLaTarea(sencilla), { dificil: false, motivos: [] });
  assert.equal(modeloDelPaso(config, "planear", sencilla, ANTES_DEL_27_NOV), "sonnet");
  assert.equal(modeloDelPaso(config, "construir", sencilla, ANTES_DEL_27_NOV), "sonnet");
  assert.equal(modeloDelPaso(config, "revisar", sencilla, ANTES_DEL_27_NOV), "sonnet");
  assert.equal(modeloDelPaso(config, "subagentes", sencilla, ANTES_DEL_27_NOV), "sonnet");
  assert.equal(modeloDelPaso(config, "leer"), "haiku");
});

prueba("cada regla de tarea difícil, sola, manda el plan a Opus", () => {
  const config = completarConfig(base);
  const casos = {
    "reintento después de un fallo": { ...sencilla, intentos: 2 },
    "marca #dificil": { ...sencilla, detalle: "Ponerlo verde. #dificil" },
    "marca [Opus]": { ...sencilla, titulo: "Botón [Opus]" },
    "toca prisma": { ...sencilla, detalle: "Agregar un campo en prisma/schema.prisma" },
    "dice migración": { ...sencilla, titulo: "Nueva migración para tarjetas" },
    "tres módulos": { ...sencilla, detalle: "Tocar src/features/coach/a.ts, src/lib/mcp/b.ts y src/app/api/cron/c/route.ts" },
    "los dos repos": { ...sencilla, detalle: "Cambiar aizencrm y gestion a la vez" },
    "detalle largo": { ...sencilla, detalle: "x".repeat(DETALLE_LARGO + 1) },
    "palabra arquitectura": { ...sencilla, detalle: "Repensar la arquitectura del tablero" },
    "palabra seguridad": { ...sencilla, titulo: "Revisar la seguridad del login" },
  };
  for (const [que, tarjeta] of Object.entries(casos)) {
    const { dificil, motivos } = dificultadDeLaTarea(tarjeta);
    assert.equal(dificil, true, que);
    assert.ok(motivos.length >= 1, que);
    assert.equal(modeloDelPaso(config, "planear", tarjeta), "opus", que);
    assert.equal(modeloDelPaso(config, "construir", tarjeta), "sonnet", `${que}: construir sigue en Sonnet`);
  }
});

prueba("no se pasa de lista: dos módulos y detalle justo en el límite siguen siendo sencillos", () => {
  const dosModulos = { ...sencilla, detalle: "Tocar src/features/coach/a.ts y src/lib/mcp/b.ts" };
  assert.equal(dificultadDeLaTarea(dosModulos).dificil, false);
  assert.equal(dificultadDeLaTarea({ ...sencilla, detalle: "x".repeat(DETALLE_LARGO) }).dificil, false);
  assert.equal(dificultadDeLaTarea({}).dificil, false, "una tarjeta vacía no rompe");
});

prueba("la config manda: cambiar los nombres por paso, y una config vieja (sin planearSencillo/leer) sigue andando", () => {
  const vieja = completarConfig({ ...base, modelos: { planear: "opus", construir: "sonnet", revisar: "sonnet", subagentes: "sonnet" } });
  assert.equal(vieja.modelos.planearSencillo, "sonnet");
  assert.equal(vieja.modelos.leer, "haiku");
  const propia = completarConfig({ ...base, modelos: { planear: "claude-opus-4-1", planearSencillo: "haiku", leer: "sonnet", construir: "opus" } });
  assert.equal(modeloDelPaso(propia, "planear", sencilla, ANTES_DEL_27_NOV), "haiku");
  assert.equal(modeloDelPaso(propia, "planear", { ...sencilla, intentos: 3 }, ANTES_DEL_27_NOV), "claude-opus-4-1");
  assert.equal(modeloDelPaso(propia, "leer"), "sonnet", "leer no lo toca la regla del 27-nov");
  assert.equal(modeloDelPaso(propia, "construir", sencilla, ANTES_DEL_27_NOV), "opus");
  assert.throws(() => completarConfig({ ...base, modelos: { leer: "haiku 3" } }), /modelos\.leer/);
  assert.throws(() => completarConfig({ ...base, modelos: { planearSencillo: "" } }), /modelos\.planearSencillo/);
});

prueba("29-oct: el revisor de seguridad va en Opus (revisarSeguridad); los otros 3 revisores en revisar (Sonnet)", () => {
  const config = completarConfig(base);
  assert.equal(modeloDelPaso(config, "revisarSeguridad", sencilla, ANTES_DEL_27_NOV), "opus");
  assert.equal(modeloDelPaso(config, "revisar", sencilla, ANTES_DEL_27_NOV), "sonnet");
  assert.equal(modeloDelPaso(completarConfig({ ...base, modelos: { revisarSeguridad: "sonnet" } }), "revisarSeguridad", null, ANTES_DEL_27_NOV), "sonnet", "se cambia en la config");
});

prueba("29-oct: cambios de modelo con fecha (modelos.desde): antes de la fecha Sonnet, después Opus; sin desde, igual que siempre", () => {
  const desde = [{ fecha: "2026-10-30T12:00:00Z", paso: "construir", modelo: "opus" }];
  const config = completarConfig({ ...base, modelos: { desde } });
  assert.deepEqual(config.modelos.desde, [{ fecha: "2026-10-30T12:00:00.000Z", paso: "construir", modelo: "opus" }], "normalizada");
  const antes = Date.parse("2026-10-30T11:59:59Z");
  const despues = Date.parse("2026-10-30T12:00:00Z");
  assert.equal(modeloDelPaso(config, "construir", sencilla, antes), "sonnet", "antes de las 7:00 a. m. de Bogotá");
  assert.equal(modeloDelPaso(config, "construir", sencilla, despues), "opus", "desde las 7:00 a. m. de Bogotá");
  assert.equal(modeloDelPaso(config, "revisar", sencilla, despues), "sonnet", "solo cambia el paso de la entrada");
  // La entrada más reciente que ya pasó manda (el orden en la lista no importa).
  const dos = completarConfig({ ...base, modelos: { desde: [{ fecha: "2026-11-05T12:00:00Z", paso: "construir", modelo: "sonnet" }, ...desde] } });
  assert.equal(modeloDelPaso(dos, "construir", sencilla, Date.parse("2026-11-01T00:00:00Z")), "opus");
  assert.equal(modeloDelPaso(dos, "construir", sencilla, Date.parse("2026-11-06T00:00:00Z")), "sonnet");
  // Sin desde: igual que siempre (y la config de hoy no cambia nada).
  const sin = completarConfig(base);
  assert.deepEqual(sin.modelos.desde, []);
  assert.equal(modeloDelPaso(sin, "construir", sencilla, despues), "sonnet");
  // Planear difícil también se puede cambiar con fecha (el paso "planear").
  const plan = completarConfig({ ...base, modelos: { desde: [{ fecha: "2026-10-01T00:00:00Z", paso: "planearSencillo", modelo: "haiku" }] } });
  assert.equal(modeloDelPaso(plan, "planear", sencilla, despues), "haiku");
  // Validación: fecha ISO, paso conocido y modelo no vacío.
  assert.throws(() => completarConfig({ ...base, modelos: { desde: [{ fecha: "30/10/2026", paso: "construir", modelo: "opus" }] } }), /modelos\.desde\[0\]\.fecha/);
  assert.throws(() => completarConfig({ ...base, modelos: { desde: [{ fecha: "2026-10-30T12:00:00Z", paso: "volar", modelo: "opus" }] } }), /modelos\.desde\[0\]\.paso/);
  assert.throws(() => completarConfig({ ...base, modelos: { desde: [{ fecha: "2026-10-30T12:00:00Z", paso: "construir", modelo: " " }] } }), /modelos\.desde\[0\]\.modelo/);
  assert.throws(() => completarConfig({ ...base, modelos: { desde: { paso: "construir" } } }), /modelos\.desde: una lista/);
});

// 27-nov-2026: la regla del dueño (planear con Opus; construir, revisar, revisarSeguridad, subagentes y reparar con Sonnet).
// La config de aizen1 de hoy: planearSencillo en Opus y construir en Opus desde el 30-oct.
const configDeAizen1 = { ...base, modelos: { planearSencillo: "opus", desde: [{ fecha: "2026-10-30T12:00:00Z", paso: "construir", modelo: "opus" }] } };
const EL_28_NOV = Date.parse("2026-11-28T12:00:00Z");

prueba("27-nov: con la config de aizen1, planear (sencilla y difícil) en Opus; construir, revisar, seguridad, subagentes y reparar en Sonnet", () => {
  const config = completarConfig(configDeAizen1);
  const dificil = { ...sencilla, detalle: "Cambiar la arquitectura del tablero" };
  for (const paso of ["construir", "revisar", "revisarSeguridad", "subagentes", "reparar"]) {
    assert.equal(modeloDelPaso(config, paso, sencilla, EL_28_NOV), "sonnet", paso);
  }
  assert.equal(modeloDelPaso(config, "planear", sencilla, EL_28_NOV), "opus", "planear sencilla");
  assert.equal(modeloDelPaso(config, "planear", dificil, EL_28_NOV), "opus", "planear difícil");
  assert.equal(modeloDelPaso(config, "leer", null, EL_28_NOV), "haiku", "leer no se toca");
  // El día antes seguía construyendo con Opus (la línea del 30-oct de la config).
  assert.equal(modeloDelPaso(config, "construir", sencilla, ANTES_DEL_27_NOV), "opus");
  // reparar es un paso conocido: por defecto Sonnet y se valida como los otros.
  assert.equal(completarConfig(base).modelos.reparar, "sonnet");
  assert.throws(() => completarConfig({ ...base, modelos: { reparar: "son net" } }), /modelos\.reparar/);
});

prueba("27-nov: una línea de modelos.desde con fecha posterior todavía cambia el paso", () => {
  const config = completarConfig({ ...configDeAizen1, modelos: { ...configDeAizen1.modelos, desde: [...configDeAizen1.modelos.desde, { fecha: "2026-12-01T00:00:00Z", paso: "construir", modelo: "opus" }] } });
  assert.equal(modeloDelPaso(config, "construir", sencilla, EL_28_NOV), "sonnet", "antes del 1-dic");
  assert.equal(modeloDelPaso(config, "construir", sencilla, Date.parse("2026-12-02T00:00:00Z")), "opus", "desde el 1-dic");
  assert.equal(modeloDelPaso(config, "revisar", sencilla, Date.parse("2026-12-02T00:00:00Z")), "sonnet", "solo el paso de la línea");
  const reparar = completarConfig({ ...base, modelos: { desde: [{ fecha: "2026-12-01T00:00:00Z", paso: "reparar", modelo: "opus" }] } });
  assert.equal(modeloDelPaso(reparar, "reparar", null, Date.parse("2026-12-02T00:00:00Z")), "opus", "reparar también se cambia con fecha");
});

prueba("nombres para mostrar", () => {
  assert.equal(nombreDelModelo("opus"), "Opus");
  assert.equal(nombreDelModelo("claude-sonnet-4-5"), "Sonnet");
  assert.equal(nombreDelModelo("haiku"), "Haiku");
  assert.equal(nombreDelModelo("otro-modelo"), "otro-modelo");
  assert.equal(textos.nombreDelModelo("claude-opus-4-1"), "Opus");
});

prueba("la tarjeta muestra qué modelo usó cada paso", () => {
  assert.equal(textos.textoDeModelos(null, { plan: "Opus", construir: "sonnet" }), "Planeado con Opus · Construido con Sonnet");
  assert.equal(textos.textoDeModelos(null, { plan: "Opus", construir: "sonnet", revisar: "sonnet", subagentes: "sonnet" }), "Planeado con Opus · Construido con Sonnet · Revisado con Sonnet");
  // Con el plan listo todavía no hay resultado: el modelo sale de la firma del plan.
  assert.equal(textos.textoDeModelos("1. Qué se cambia\n\nPlan escrito con: Claude Code (Sonnet)", null), "Planeado con Sonnet");
  assert.equal(textos.textoDeModelos("Plan escrito con: Codex", null), "", "Codex: no hay modelo que mostrar");
  assert.equal(textos.textoDeModelos(null, null), "");
});

prueba("un modelo no disponible se trata como límite (espera y reintenta); construir nunca sube a Opus", () => {
  for (const aviso of ["API Error: model claude-sonnet is not available", "There's an issue with the selected model (sonnet)", "El modelo pedido no está disponible"]) {
    assert.ok(esLimiteDeUso(aviso), aviso);
  }
  for (const normal of ["Error: build falló en src/model.ts", "Model User not found", "ENOENT: src/models/user.ts does not exist", "Invalid model name en el formulario"]) {
    assert.ok(!esLimiteDeUso(normal), `no es un límite: ${normal}`);
  }
  // Un reintento (intentos 3, por ejemplo tras esperar el límite) sube el PLAN a Opus, pero construir sigue en Sonnet.
  const config = completarConfig(base);
  assert.equal(modeloDelPaso(config, "construir", { intentos: 3, titulo: "x", detalle: "" }), "sonnet");
});

prueba("el CRM guarda el modelo del resultado, limpio", () => {
  const resultado = reglas.resultadoDeEntrada({ resumen: "listo", modelo: { plan: "Opus", construir: "sonnet", revisar: "x<script>", otro: "no", subagentes: "sonnet" } });
  assert.deepEqual(resultado.modelo, { plan: "Opus", construir: "sonnet", subagentes: "sonnet" });
  assert.equal("modelo" in reglas.resultadoDeEntrada({ resumen: "listo" }), false, "sin modelo, el resultado queda como antes");
  assert.equal("modelo" in reglas.resultadoDeEntrada({ resumen: "listo", modelo: "opus" }), false);
});

console.log(`\n${pruebas} pruebas, todas bien`);
