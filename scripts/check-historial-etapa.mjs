/**
 * Pruebas del historial de etapas del CRM (Embudo 1). No necesitan base ni red.
 * Correr: npm run test:historial-etapa
 *
 * 1. `registrarCambioDeEtapa` con cada tipo de origen (asesora, bot, automático, sistema, MCP):
 *    queda una fila con quién y cuándo. Si la etapa no cambió, no se escribe. Si la base falla,
 *    no lanza error (no bloquea el cambio de etapa).
 * 2. Cobertura: falla si un archivo de src/ escribe `crmStage` sin llamar a `registrarCambioDeEtapa`.
 * 3. `listar_conversaciones` usa la fecha real cuando hay fila y la aproximada cuando no.
 */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireNativo = createRequire(import.meta.url);
let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

// ── 1. La función, con una base de mentira en memoria ───────────────────────────────────────
const filasGuardadas = [];
let baseCaida = false;
const prismaFalso = {
  historialEtapa: {
    createMany: async ({ data }) => {
      if (baseCaida) throw new Error("la base no responde");
      for (const fila of data) filasGuardadas.push({ ...fila, creadoEn: new Date() });
      return { count: data.length };
    },
  },
};
const archivo = path.join(RAIZ, "src", "lib", "historial-etapa.ts");
const salida = ts.transpileModule(fs.readFileSync(archivo, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const modulo = { exports: {} };
new Function("exports", "require", "module", salida.outputText)(
  modulo.exports,
  (pedido) => (pedido === "@/lib/prisma" ? { prisma: prismaFalso } : requireNativo(pedido)),
  modulo,
);
const { registrarCambioDeEtapa, registrarCambiosDeEtapa } = modulo.exports;

const base = { workspaceId: "ws1", contactId: "ct1", conversationId: "cv1", etapaAnterior: "NUEVO", etapaNueva: "CALIFICADO" };

for (const [origen, quien] of [
  ["ASESORA", "usuaria-1"],
  ["BOT", null],
  ["AUTOMATICO", "regla"],
  ["SISTEMA", "usuaria-1"],
  ["MCP", "claude"],
]) {
  await (async () => {
    const antes = filasGuardadas.length;
    assert.equal(await registrarCambioDeEtapa({ ...base, origen, quien, nota: "prueba" }), true);
    assert.equal(filasGuardadas.length, antes + 1);
    const fila = filasGuardadas.at(-1);
    assert.equal(fila.origen, origen);
    assert.equal(fila.quien, quien);
    assert.equal(fila.etapaAnterior, "NUEVO");
    assert.equal(fila.etapaNueva, "CALIFICADO");
    assert.ok(fila.creadoEn instanceof Date, "queda con fecha y hora");
    pruebas += 1;
    console.log(`ok - origen ${origen}: queda una fila con quién y cuándo`);
  })();
}

await (async () => {
  const antes = filasGuardadas.length;
  assert.equal(await registrarCambioDeEtapa({ ...base, etapaAnterior: "PROPUESTA", etapaNueva: "PROPUESTA", origen: "BOT" }), false);
  assert.equal(filasGuardadas.length, antes);
  pruebas += 1;
  console.log("ok - si la etapa no cambia, no se escribe fila");
})();

await (async () => {
  const antes = filasGuardadas.length;
  const n = await registrarCambiosDeEtapa([
    { ...base, contactId: "a", origen: "SISTEMA" },
    { ...base, contactId: "b", origen: "SISTEMA" },
    { ...base, contactId: "c", etapaAnterior: "NUEVO", etapaNueva: "NUEVO", origen: "SISTEMA" },
  ]);
  assert.equal(n, 2);
  assert.equal(filasGuardadas.length, antes + 2);
  pruebas += 1;
  console.log("ok - varios cambios a la vez (vaciar CRM, descartes): una instrucción y sin los que no cambian");
})();

await (async () => {
  baseCaida = true;
  const silencio = console.error;
  console.error = () => {};
  try {
    assert.equal(await registrarCambioDeEtapa({ ...base, origen: "BOT" }), false);
  } finally {
    console.error = silencio;
    baseCaida = false;
  }
  pruebas += 1;
  console.log("ok - si la base falla, no lanza error (no bloquea el cambio de etapa)");
})();

// ── 2. Cobertura: quién escribe crmStage tiene que registrar ────────────────────────────────
function archivosDe(carpeta) {
  const salidaArchivos = [];
  for (const entrada of fs.readdirSync(carpeta, { withFileTypes: true })) {
    const ruta = path.join(carpeta, entrada.name);
    if (entrada.isDirectory()) salidaArchivos.push(...archivosDe(ruta));
    else if (/\.(ts|tsx)$/.test(entrada.name)) salidaArchivos.push(ruta);
  }
  return salidaArchivos;
}
// Excepciones a propósito: crear clientes (nacen en NUEVO por defecto) y fusionar chats duplicados
// (solo copia la etapa entre dos fichas, y vive en un archivo de chats protegido).
const EXCEPCIONES = new Set(["src/lib/fusionar-chat-duplicado.ts", "src/lib/historial-etapa.ts"]);
// Una escritura: SQL `SET "crmStage"`, o `crmStage:` con valor dentro de un `data: {...}`.
const ESCRIBE_SQL = /SET\s+"crmStage"/;
// (Solo sobre Contact: la campaña tiene su propio campo crmStage, que es un filtro y no una etapa.)
const ESCRIBE_PRISMA = /contact\.(?:update|updateMany|upsert)\(\{[\s\S]{0,400}?data:\s*\{[^}]*\bcrmStage\s*:/;
const ESCRIBE_SPREAD = /\?\s*\{\s*crmStage\s*:\s*"[A-Z]+"/;

prueba("cobertura: todo archivo que escribe crmStage llama a registrarCambioDeEtapa", () => {
  const sinRegistro = [];
  let escritores = 0;
  for (const ruta of archivosDe(path.join(RAIZ, "src"))) {
    const relativa = path.relative(RAIZ, ruta).split(path.sep).join("/");
    if (EXCEPCIONES.has(relativa)) continue;
    const texto = fs.readFileSync(ruta, "utf8");
    if (!(ESCRIBE_SQL.test(texto) || ESCRIBE_PRISMA.test(texto) || ESCRIBE_SPREAD.test(texto))) continue;
    escritores += 1;
    if (!/registrarCambios?DeEtapa/.test(texto)) sinRegistro.push(relativa);
  }
  assert.ok(escritores >= 9, `el detector casi no encuentra escritores (${escritores}): revisar las expresiones`);
  assert.deepEqual(sinRegistro, [], `escriben crmStage sin registrarCambioDeEtapa: ${sinRegistro.join(", ")}`);
});

// Los 16 lugares del plan: cada archivo, la cantidad mínima de llamadas.
prueba("cobertura: los archivos del plan registran el cambio en cada sitio", () => {
  const minimo = {
    "src/app/actions/crm-actions.ts": 1,
    "src/app/actions/workspace-actions.ts": 1,
    "src/lib/crm-stage-sync.ts": 3,
    "src/features/crm/services/lead-temperature.ts": 2,
    "src/features/crm/services/descarte-automatico.ts": 1,
    "src/features/llamadas/services/lead-cooldown.ts": 1,
    "src/features/automatizaciones/servicio.ts": 1,
    "src/features/seguimiento-inteligente/servicios/motor.ts": 1,
    "src/features/seguimiento-inteligente/servicios/recuperacion.ts": 2,
  };
  for (const [relativa, cuantas] of Object.entries(minimo)) {
    const texto = fs.readFileSync(path.join(RAIZ, relativa), "utf8");
    const llamadas = (texto.match(/\bregistrarCambios?DeEtapa\(/g) ?? []).length;
    assert.ok(llamadas >= cuantas, `${relativa}: ${llamadas} llamadas, se esperaban al menos ${cuantas}`);
  }
});

prueba("el registro va DESPUÉS del cambio guardado, nunca antes del UPDATE", () => {
  const texto = fs.readFileSync(path.join(RAIZ, "src/app/actions/crm-actions.ts"), "utf8");
  assert.ok(texto.indexOf('SET "crmStage"') < texto.indexOf("registrarCambioDeEtapa({"));
});

// ── 3. El MCP: fecha real cuando hay fila, aproximada cuando no ─────────────────────────────
prueba("listar_conversaciones usa el historial: filtro, fecha por chat y texto de fechado_por", () => {
  const texto = fs.readFileSync(path.join(RAIZ, "src/lib/mcp/herramientas.ts"), "utf8");
  assert.match(texto, /historialEtapas:\s*\{\s*some:\s*\{\s*etapaNueva:\s*etapa,\s*creadoEn:\s*rango/);
  assert.match(texto, /historialEtapas:\s*\{\s*none:\s*\{\s*etapaNueva:\s*etapa/);
  assert.match(texto, /etapa_fechada_por:\s*"real"/);
  assert.match(texto, /etapa_fechada_por:\s*"aproximada"/);
  assert.doesNotMatch(texto, /no hay fecha de cambio de etapa/);
  assert.match(texto, /prisma\.historialEtapa\.findMany/);
});

console.log(`\n${pruebas} pruebas, todas bien`);
