// Pruebas de src/lib/version-del-crm.ts (versión v1.0.N) y de que el despliegue le pasa el número
// de corrida de GitHub a la imagen (flujo docker-image.yml y Dockerfile).
// Correr: npm run test:version-del-crm
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);

function cargar(relativo) {
  const sourcePath = path.resolve(relativo);
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
  return mod.exports;
}

const leer = (archivo) => fs.readFileSync(archivo, "utf8").replace(/\r\n/g, "\n");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const anterior = process.env.NEXT_PUBLIC_VERSION_NUMERO;
process.env.NEXT_PUBLIC_VERSION_NUMERO = "812";
const V = cargar("src/lib/version-del-crm.ts");
delete process.env.NEXT_PUBLIC_VERSION_NUMERO;
const sinNumero = cargar("src/lib/version-del-crm.ts");
if (anterior === undefined) delete process.env.NEXT_PUBLIC_VERSION_NUMERO;
else process.env.NEXT_PUBLIC_VERSION_NUMERO = anterior;

prueba("un número válido arma la etiqueta v1.0.N", () => {
  assert.equal(V.numeroDeVersionValido("812"), "812");
  assert.equal(V.etiquetaDeVersion("812"), "v1.0.812");
  assert.equal(V.numeroDeVersionValido(" 812 "), "812");
  assert.equal(V.numeroDeVersionValido("123456789"), "123456789");
});

prueba("lo que no es un número de 1 a 9 cifras se rechaza y sale v1.0.dev", () => {
  for (const malo of ["", undefined, null, "<script>", "1.0.5", "-3", "+3", "12a", "12345678901234567890", "1234567890", 812]) {
    assert.equal(V.numeroDeVersionValido(malo), null, `debía rechazar ${String(malo)}`);
    assert.equal(V.etiquetaDeVersion(malo), "v1.0.dev", `etiqueta de ${String(malo)}`);
  }
});

prueba("compara versiones: vieja, igual y sin datos", () => {
  assert.equal(V.esVersionVieja("810", "812"), true);
  assert.equal(V.esVersionVieja("812", "812"), false);
  assert.equal(V.esVersionVieja("813", "812"), false);
  assert.equal(V.esVersionVieja("99", "100"), true, "compara como enteros, no como texto");
  assert.equal(V.esVersionVieja(undefined, "812"), null);
  assert.equal(V.esVersionVieja("810", undefined), null);
  assert.equal(V.esVersionVieja("", "812"), null);
  assert.equal(V.esVersionVieja("810", "<script>"), null);
});

prueba("la versión del servidor sale de NEXT_PUBLIC_VERSION_NUMERO", () => {
  assert.equal(V.VERSION_DEL_SERVIDOR, "812");
  assert.equal(sinNumero.VERSION_DEL_SERVIDOR, null);
  const fuente = leer("src/lib/version-del-crm.ts");
  assert.match(fuente, /process\.env\.NEXT_PUBLIC_VERSION_NUMERO/);
  assert.match(fuente, /"v1\.0\."/, "el 1.0 va fijo en el código");
});

prueba("el flujo de GitHub le pasa el número de corrida a la imagen", () => {
  const flujo = leer(".github/workflows/docker-image.yml");
  const bloque = flujo.match(/build-args: \|\n((?: {12}.+\n)+)/);
  assert.ok(bloque, "falta build-args en el flujo");
  assert.match(bloque[1], /^ {12}VERSION_NUMERO=\$\{\{ github\.run_number \}\}$/m);
  assert.match(bloque[1], /^ {12}DEPLOYMENT_ID=\$\{\{ github\.sha \}\}$/m);
});

prueba("el Dockerfile recibe el número y lo deja visible para Next", () => {
  const docker = leer("Dockerfile");
  const builder = docker.split(/^FROM /m).find((etapa) => /AS builder/.test(etapa.split("\n")[0]));
  assert.ok(builder, "falta la etapa builder");
  assert.match(builder, /^ARG VERSION_NUMERO$/m);
  assert.match(builder, /^ENV NEXT_PUBLIC_VERSION_NUMERO=\$\{VERSION_NUMERO\}$/m);
  assert.match(builder, /^ARG DEPLOYMENT_ID$/m);
  assert.match(builder, /^ENV NEXT_PUBLIC_DEPLOYMENT_ID=\$\{DEPLOYMENT_ID\}$/m);
});

console.log(`${pruebas} pruebas pasaron`);
console.log("OK");
