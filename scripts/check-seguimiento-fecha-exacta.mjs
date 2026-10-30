// Pruebas de src/features/seguimientos/dominio/fecha-exacta.ts (fecha exacta en hora de Colombia).
// Correr: npm run test:seguimiento-fecha-exacta
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const sourcePath = path.resolve("src/features/seguimientos/dominio/fecha-exacta.ts");
const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
});
const mod = { exports: {} };
new Function("exports", "require", "module", "__filename", "__dirname", transpiled.outputText)(
  mod.exports,
  require,
  mod,
  sourcePath,
  path.dirname(sourcePath),
);
const { horaDeBogotaAUtc, validarFechaExacta, ahoraEnBogotaParaInput, formatoBogota } = mod.exports;

const AHORA = new Date("2026-11-03T20:30:00Z");
const desde = (ms) => new Date(AHORA.getTime() + ms);
let casos = 0;
const prueba = (nombre, fn) => {
  fn();
  casos += 1;
  console.log(`ok - ${nombre}`);
};

prueba("horaDeBogotaAUtc toma el valor como hora de Colombia", () => {
  assert.equal(horaDeBogotaAUtc("2026-11-03T15:30").toISOString(), "2026-11-03T20:30:00.000Z");
});
prueba("horaDeBogotaAUtc cruza la medianoche UTC", () => {
  assert.equal(horaDeBogotaAUtc("2026-12-31T22:00").toISOString(), "2027-01-01T03:00:00.000Z");
});
prueba("un valor mal escrito da null", () => {
  for (const v of ["", "hola", "2026-11-03", "2026-11-03 15:30", "2026-13-03T15:30", "2026-02-31T10:00", "2026-11-03T25:00"]) {
    assert.equal(horaDeBogotaAUtc(v), null, v);
  }
});
prueba("1 minuto antes de ahora es pasada", () => {
  assert.deepEqual(validarFechaExacta(desde(-60_000), AHORA), { ok: false, motivo: "pasada" });
});
prueba("30 segundos adelante también es pasada", () => {
  assert.deepEqual(validarFechaExacta(desde(30_000), AHORA), { ok: false, motivo: "pasada" });
});
prueba("91 días es muy lejana", () => {
  assert.deepEqual(validarFechaExacta(desde(91 * 86_400_000), AHORA), { ok: false, motivo: "muy lejana" });
});
prueba("2 horas adelante está bien", () => {
  assert.deepEqual(validarFechaExacta(desde(2 * 3_600_000), AHORA), { ok: true });
});
prueba("ahoraEnBogotaParaInput da la hora de Colombia", () => {
  assert.equal(ahoraEnBogotaParaInput(AHORA), "2026-11-03T15:30");
});
prueba("formatoBogota muestra la hora de Colombia", () => {
  assert.ok(formatoBogota(AHORA).includes("3:30"), formatoBogota(AHORA));
});

console.log(`${casos} pruebas ok`);
