// Pruebas de src/lib/version-del-crm.ts (versión "v1.0.N" que sube sola en cada despliegue) y de que
// el flujo de GitHub y el Dockerfile le pasan el número de corrida a la app.
// Correr: npm run test:version-del-crm
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);

function cargar(relativo, alias = {}) {
  const sourcePath = path.resolve(relativo);
  const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  });
  const mod = { exports: {} };
  new Function("exports", "require", "module", "__filename", "__dirname", transpiled.outputText)(
    mod.exports,
    (nombre) => (nombre in alias ? alias[nombre] : require(nombre)),
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

// Parte 3: Equipo muestra qué versión tiene abierta cada persona.
const pendientes = [];
function pruebaAsincrona(nombre, fn) {
  pendientes.push(
    fn().then(() => {
      pruebas += 1;
      console.log(`ok - ${nombre}`);
    }),
  );
}

// actividad-del-equipo.ts con una base de prueba: devuelve el JSON que se le dé.
let valorGuardado = null;
const prismaDePrueba = {
  appSetting: {
    findUnique: async () => (valorGuardado === null ? null : { value: valorGuardado }),
    upsert: async ({ create }) => {
      valorGuardado = create.value;
    },
  },
};
const A = cargar("src/lib/actividad-del-equipo.ts", {
  "@/lib/prisma": { prisma: prismaDePrueba },
  "@/lib/version-del-crm": V,
});

pruebaAsincrona("lee un JSON viejo sin version sin fallar", async () => {
  valorGuardado = JSON.stringify({
    u1: { cuando: "2026-11-27T10:00:00.000Z", ruta: "/cliente/chats", donde: "Chats", dispositivo: "Android" },
  });
  const actividad = await A.leerActividadDelEquipo("w1");
  assert.equal(actividad.u1.cuando, "2026-11-27T10:00:00.000Z");
  assert.equal(actividad.u1.donde, "Chats");
  assert.equal("version" in actividad.u1, false, "un JSON viejo sale sin versión");
});

pruebaAsincrona("lee la versión si viene y es válida; si no, la descarta", async () => {
  valorGuardado = JSON.stringify({
    u1: { cuando: "2026-11-27T10:00:00.000Z", ruta: "/cliente", donde: "Inicio", dispositivo: "Mac", version: "810" },
    u2: { cuando: "2026-11-27T10:00:00.000Z", ruta: "/cliente", donde: "Inicio", dispositivo: "Mac", version: "<script>" },
    u3: { cuando: "2026-11-27T10:00:00.000Z", ruta: "/cliente", donde: "Inicio", dispositivo: "Mac", version: 812 },
  });
  const actividad = await A.leerActividadDelEquipo("w1");
  assert.equal(actividad.u1.version, "810");
  assert.equal("version" in actividad.u2, false, "una versión con HTML no se lee");
  assert.equal("version" in actividad.u3, false, "una versión que no es texto no se lee");
});

pruebaAsincrona("el latido guarda la versión válida y descarta la inválida", async () => {
  valorGuardado = null;
  await A.anotarActividad({ workspaceId: "w1", userId: "u1", ruta: "/cliente/chats", version: "812" });
  await A.anotarActividad({ workspaceId: "w1", userId: "u2", ruta: "/cliente/crm", version: "<b>" });
  await A.anotarActividad({ workspaceId: "w1", userId: "u3", ruta: "/cliente/crm" });
  const guardado = JSON.parse(valorGuardado);
  assert.equal(guardado.u1.version, "812");
  assert.equal("version" in guardado.u2, false);
  assert.equal("version" in guardado.u3, false);
  assert.equal(guardado.u3.donde, "CRM", "sin versión el latido se guarda igual");
});

prueba("latido-de-actividad.tsx manda version con NEXT_PUBLIC_VERSION_NUMERO", () => {
  const fuente = leer("src/components/latido-de-actividad.tsx");
  assert.match(fuente, /JSON\.stringify\(\{[^}]*version: process\.env\.NEXT_PUBLIC_VERSION_NUMERO[^}]*\}\)/);
});

prueba("route.ts del latido revisa la versión con numeroDeVersionValido", () => {
  const fuente = leer("src/app/api/cliente/actividad/latido/route.ts");
  assert.match(fuente, /import \{ numeroDeVersionValido \} from "@\/lib\/version-del-crm";/);
  assert.match(fuente, /version: numeroDeVersionValido\(cuerpo\?\.version\)/);
  // Una versión inválida no corta el latido: no hay respuesta de error por la versión.
  assert.doesNotMatch(fuente, /status: 400[^\n]*[Vv]ersi/);
});

prueba("UltimaActividad tiene version?: string", () => {
  const fuente = leer("src/lib/actividad-del-equipo.ts");
  const tipo = fuente.match(/export type UltimaActividad = \{[\s\S]*?\n\};/)?.[0] ?? "";
  assert.match(tipo, /^\s*version\?: string;$/m);
});

prueba("ultima-accion-del-equipo.tsx muestra 'Versión abierta'", () => {
  const fuente = leer("src/app/cliente/equipo/ultima-accion-del-equipo.tsx");
  assert.match(fuente, /Versión abierta: /);
  assert.match(fuente, / · vieja \(la actual es /);
  assert.match(fuente, /esVersionVieja\(/);
  assert.match(fuente, /versionDelServidor\(\)/);
});

await Promise.all(pendientes);

console.log(`\n${pruebas} pruebas OK`);
console.log("OK");
