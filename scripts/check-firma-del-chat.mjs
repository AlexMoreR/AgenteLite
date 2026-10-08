// Pruebas de src/lib/firma-del-chat.ts (regla unica de firma: servidor y burbuja optimista).
// Correr: npm run test:firma-del-chat
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const sourcePath = path.resolve("src/lib/firma-del-chat.ts");
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
const { aplicarFirmaDelChat } = mod.exports;

const FIRMA = "👩‍💻 *Ingrid Sánchez*";
let casos = 0;
const prueba = (nombre, fn) => {
  fn();
  casos += 1;
  console.log(`ok - ${nombre}`);
};

prueba("firma arriba y el texto debajo", () => {
  assert.equal(aplicarFirmaDelChat("Hola", FIRMA), `${FIRMA}\nHola`);
});
prueba("sin firma (null, undefined, vacia o espacios): el mensaje tal cual", () => {
  for (const firma of [null, undefined, "", "   \n "]) {
    assert.equal(aplicarFirmaDelChat("Hola", firma), "Hola");
  }
});
prueba("la firma se recorta antes de usarla", () => {
  assert.equal(aplicarFirmaDelChat("Hola", `  ${FIRMA}\n`), `${FIRMA}\nHola`);
});
prueba("quita espacios al inicio del texto al firmar", () => {
  assert.equal(aplicarFirmaDelChat("  \n Hola", FIRMA), `${FIRMA}\nHola`);
});
prueba("no duplica si el texto ya empieza con la firma", () => {
  const firmado = `${FIRMA}\nHola`;
  assert.equal(aplicarFirmaDelChat(firmado, FIRMA), firmado);
  assert.equal(aplicarFirmaDelChat(`  ${firmado}`, FIRMA), `  ${firmado}`);
});
prueba("texto multilinea conserva sus saltos", () => {
  assert.equal(aplicarFirmaDelChat("Linea 1\nLinea 2", FIRMA), `${FIRMA}\nLinea 1\nLinea 2`);
});
prueba("el mensaje real firmado TERMINA con el texto sin firma (conciliacion optimista)", () => {
  const normalizar = (v) => v.replace(/\s+/g, " ").trim();
  const escrito = "Claro, le envio el catalogo";
  const real = aplicarFirmaDelChat(escrito, FIRMA);
  assert.ok(normalizar(real).endsWith(normalizar(escrito)));
  // Aunque la firma haya cambiado en otra pestaña, sigue conciliando.
  const realConOtraFirma = aplicarFirmaDelChat(escrito, "Ingrid S.");
  assert.ok(normalizar(realConOtraFirma).endsWith(normalizar(escrito)));
});

console.log(`\n${casos} pruebas de firma-del-chat OK`);
