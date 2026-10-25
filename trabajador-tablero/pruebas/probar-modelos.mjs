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

const base = { urlCrm: "https://app.aizenbot.com", claveTrabajador: "aizen_trab_x", repos: { aizencrm: { ruta: "." } } };
const sencilla = { titulo: "Cambiar el color del botón Guardar", detalle: "Ponerlo verde en la ficha.", intentos: 1 };

prueba("tarea sencilla: Sonnet; el resto de pasos también Sonnet y leer con Haiku", () => {
  const config = completarConfig(base);
  assert.deepEqual(dificultadDeLaTarea(sencilla), { dificil: false, motivos: [] });
  assert.equal(modeloDelPaso(config, "planear", sencilla), "sonnet");
  assert.equal(modeloDelPaso(config, "construir", sencilla), "sonnet");
  assert.equal(modeloDelPaso(config, "revisar", sencilla), "sonnet");
  assert.equal(modeloDelPaso(config, "subagentes", sencilla), "sonnet");
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
  assert.equal(modeloDelPaso(propia, "planear", sencilla), "haiku");
  assert.equal(modeloDelPaso(propia, "planear", { ...sencilla, intentos: 3 }), "claude-opus-4-1");
  assert.equal(modeloDelPaso(propia, "leer"), "sonnet");
  assert.equal(modeloDelPaso(propia, "construir", sencilla), "opus");
  assert.throws(() => completarConfig({ ...base, modelos: { leer: "haiku 3" } }), /modelos\.leer/);
  assert.throws(() => completarConfig({ ...base, modelos: { planearSencillo: "" } }), /modelos\.planearSencillo/);
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
