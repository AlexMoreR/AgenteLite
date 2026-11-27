// Comprueba como texto que la barra lateral (src/components/app-sidebar.tsx) muestre la marca Magilus:
// el logo /magilus-logo.svg en lugar del robot y, debajo del nombre, la versión "v1.0.N" armada con
// src/lib/version-del-crm.ts en lugar de la palabra "Workspace".
// Correr: npm run test:marca-magilus
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const archivo = path.resolve("src/components/app-sidebar.tsx");
const texto = fs.readFileSync(archivo, "utf8").replace(/\r\n/g, "\n");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

prueba("usa el logo de Magilus", () => {
  assert.ok(texto.includes('src="/magilus-logo.svg"'), 'falta src="/magilus-logo.svg"');
  assert.ok(texto.includes('alt="Magilus"'), 'falta alt="Magilus"');
  assert.ok(fs.existsSync(path.resolve("public/magilus-logo.svg")), "falta public/magilus-logo.svg");
});

prueba("ya no muestra el robot ni la palabra Workspace arriba", () => {
  assert.ok(!texto.includes('plan: "Workspace"'), 'sigue plan: "Workspace"');
  assert.ok(!/logo:\s*<Bot\s*\/>/.test(texto), "sigue logo: <Bot />");
  assert.ok(!texto.includes('brandName = "Workspace"'), 'sigue brandName = "Workspace"');
  assert.ok(texto.includes('brandName = "Magilus"'), 'falta brandName = "Magilus"');
});

prueba("el robot sigue en el menú de agentes", () => {
  assert.ok(/agents:\s*Bot\b/.test(texto), "falta agents: Bot");
});

prueba("la versión sale de version-del-crm", () => {
  assert.match(texto, /import\s*\{[^}]*\betiquetaDeVersion\b[^}]*\}\s*from\s*["']@\/lib\/version-del-crm["']/);
  assert.ok(
    texto.includes("etiquetaDeVersion(process.env.NEXT_PUBLIC_VERSION_NUMERO)"),
    "falta etiquetaDeVersion(process.env.NEXT_PUBLIC_VERSION_NUMERO)",
  );
});

console.log(`OK: ${pruebas} pruebas de la marca Magilus pasaron.`);
