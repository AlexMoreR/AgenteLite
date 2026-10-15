// Pruebas de src/lib/reenviar-mensaje.ts (reenviar audios, 15-10-2026).
// Correr: npm run test:reenviar
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const sourcePath = path.resolve("src/lib/reenviar-mensaje.ts");
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
const { comoSeReenvia, esArchivoDeNuestroServidor, claveDeNotaDeVoz, urlAbsolutaParaEnviar } = mod.exports;

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

prueba("el audio se reenvia como audio, no como texto", () => {
  assert.equal(comoSeReenvia("AUDIO"), "audio");
  assert.equal(comoSeReenvia("audio"), "audio");
});

prueba("foto, video y documento siguen como archivo", () => {
  for (const tipo of ["IMAGE", "VIDEO", "DOCUMENT"]) assert.equal(comoSeReenvia(tipo), "archivo");
});

prueba("texto y tipos desconocidos van como texto", () => {
  assert.equal(comoSeReenvia("TEXT"), "texto");
  assert.equal(comoSeReenvia(null), "texto");
  assert.equal(comoSeReenvia(undefined), "texto");
});

prueba("archivo de nuestro servidor: relativo y absoluto", () => {
  assert.equal(esArchivoDeNuestroServidor("/uploads/chat-media/a.ogg"), true);
  assert.equal(esArchivoDeNuestroServidor("https://app.aizenbot.com/uploads/chat-audio/a.m4a"), true);
  assert.equal(esArchivoDeNuestroServidor("https://mmg.whatsapp.net/v/t62/a.enc"), false);
  assert.equal(esArchivoDeNuestroServidor(""), false);
  assert.equal(esArchivoDeNuestroServidor(null), false);
});

prueba("mismo audio a OTRO chat = clave distinta (no es repetido)", () => {
  const url = "https://app.aizenbot.com/uploads/chat-media/a.ogg";
  assert.notEqual(claveDeNotaDeVoz("chat-a", url), claveDeNotaDeVoz("chat-b", url));
});

prueba("mismo audio al MISMO chat = misma clave (doble toque protegido)", () => {
  const url = "https://app.aizenbot.com/uploads/chat-audio/1-x.m4a";
  assert.equal(claveDeNotaDeVoz("chat-a", url), claveDeNotaDeVoz("chat-a", ` ${url} `));
});

prueba("sin audio no hay clave", () => {
  assert.equal(claveDeNotaDeVoz("chat-a", ""), "");
  assert.equal(claveDeNotaDeVoz("chat-a", undefined), "");
});

prueba("url para el gateway: relativa se vuelve absoluta, absoluta queda igual", () => {
  assert.equal(urlAbsolutaParaEnviar("/uploads/chat-media/a.ogg", "https://app.aizenbot.com/"), "https://app.aizenbot.com/uploads/chat-media/a.ogg");
  assert.equal(urlAbsolutaParaEnviar("https://x.com/uploads/a.ogg", "https://app.aizenbot.com"), "https://x.com/uploads/a.ogg");
  assert.equal(urlAbsolutaParaEnviar("/uploads/a.ogg", ""), "/uploads/a.ogg");
});

console.log(`\n${pruebas} pruebas ok`);
