// Pruebas de src/lib/version-del-crm.ts (versión "v1.0.N" que sube sola en cada despliegue) y de que
// el flujo de GitHub y el Dockerfile le pasan el número de corrida a la app.
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

const V = cargar("src/lib/version-del-crm.ts");
const leer = (archivo) => fs.readFileSync(archivo, "utf8").replace(/\r\n/g, "\n");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

prueba("solo acepta de 1 a 9 dígitos", () => {
  for (const malo of ["<script>", "1.0.5", "-3", "12345678901234567890", "1234567890", "", " 812", "812 ", "+3", undefined, null, 812]) {
    assert.equal(V.numeroDeVersionValido(malo), null, `debe rechazar ${JSON.stringify(malo)}`);
  }
  assert.equal(V.numeroDeVersionValido("812"), "812");
  assert.equal(V.numeroDeVersionValido("123456789"), "123456789");
  assert.equal(V.numeroDeVersionValido("1"), "1");
});

prueba("arma la etiqueta v1.0.N", () => {
  assert.equal(V.etiquetaDeVersion("812"), "v1.0.812");
  assert.equal(V.etiquetaDeVersion(""), "v1.0.dev");
  assert.equal(V.etiquetaDeVersion(undefined), "v1.0.dev");
  assert.equal(V.etiquetaDeVersion("<script>"), "v1.0.dev");
  assert.equal(V.etiquetaDeVersion("1.0.5"), "v1.0.dev");
});

prueba("dice si una versión es vieja", () => {
  assert.equal(V.esVersionVieja("810", "812"), true);
  assert.equal(V.esVersionVieja("812", "812"), false);
  assert.equal(V.esVersionVieja("813", "812"), false);
  assert.equal(V.esVersionVieja("99", "100"), true, "compara como número, no como texto");
  assert.equal(V.esVersionVieja(undefined, "812"), null);
  assert.equal(V.esVersionVieja("812", undefined), null);
  assert.equal(V.esVersionVieja("", ""), null);
  assert.equal(V.esVersionVieja("<script>", "812"), null);
});

prueba("la versión del servidor sale de NEXT_PUBLIC_VERSION_NUMERO", () => {
  const antes = process.env.NEXT_PUBLIC_VERSION_NUMERO;
  try {
    process.env.NEXT_PUBLIC_VERSION_NUMERO = "812";
    assert.equal(V.versionDelServidor(), "812");
    process.env.NEXT_PUBLIC_VERSION_NUMERO = "1.0.5";
    assert.equal(V.versionDelServidor(), null);
    delete process.env.NEXT_PUBLIC_VERSION_NUMERO;
    assert.equal(V.versionDelServidor(), null);
  } finally {
    if (antes === undefined) delete process.env.NEXT_PUBLIC_VERSION_NUMERO;
    else process.env.NEXT_PUBLIC_VERSION_NUMERO = antes;
  }
  const fuente = leer("src/lib/version-del-crm.ts");
  assert.match(fuente, /"1\.0"/, "el 1.0 va fijo en el código");
  assert.match(fuente, /process\.env\.NEXT_PUBLIC_VERSION_NUMERO/);
});

prueba("el flujo de GitHub pasa el número de corrida", () => {
  const flujo = leer(".github/workflows/docker-image.yml");
  assert.match(flujo, /^\s*VERSION_NUMERO=\$\{\{ github\.run_number \}\}$/m);
  assert.match(flujo, /^\s*DEPLOYMENT_ID=\$\{\{ github\.sha \}\}$/m);
});

prueba("el Dockerfile recibe el número y lo deja visible para la app", () => {
  const docker = leer("Dockerfile");
  const builder = docker.split(/^FROM /m).find((etapa) => /AS builder/.test(etapa)) ?? "";
  assert.match(builder, /^ARG VERSION_NUMERO$/m);
  assert.match(builder, /^ENV NEXT_PUBLIC_VERSION_NUMERO=\$\{VERSION_NUMERO\}$/m);
  assert.match(builder, /^ENV NEXT_PUBLIC_DEPLOYMENT_ID=\$\{DEPLOYMENT_ID\}$/m);
});

console.log(`\n${pruebas} pruebas OK`);
console.log("OK");
