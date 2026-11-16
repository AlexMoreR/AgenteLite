// Prueba del texto de la rutina del Analista SEO (agentes-de-area/analista-seo/PROMPT.md).
// La rutina vive en claude.ai; aquí se revisa que la copia del repo tenga las reglas que decidió Alexander el 16-nov-2026.
//   node agentes-de-area/pruebas/probar-analista-seo.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CARPETA = path.join(RAIZ, "agentes-de-area", "analista-seo");
const prompt = fs.readFileSync(path.join(CARPETA, "PROMPT.md"), "utf8");
const readme = fs.readFileSync(path.join(CARPETA, "README.md"), "utf8");
const nota = fs.readFileSync(path.join(RAIZ, "docs", "cambios-pendientes", "e60t09wv.md"), "utf8");

let pruebas = 0;
const fallas = [];
function prueba(nombre, fn) {
  pruebas += 1;
  try {
    fn();
    console.log(`ok - ${nombre}`);
  } catch (error) {
    fallas.push(nombre);
    console.log(`FALLA - ${nombre}\n${error.message}`);
  }
}

const contiene = (texto, buscado) => assert.ok(texto.includes(buscado), `falta "${buscado}"`);
const noContiene = (texto, buscado) =>
  assert.ok(!texto.toLowerCase().includes(buscado.toLowerCase()), `no debería decir "${buscado}"`);

prueba("la regla de mínimo 2 tarjetas en cada corrida, incluido el lunes", () => {
  contiene(prompt, "MÍNIMO 2 tarjetas Tarea en Features (T-736) en cada corrida, incluido el lunes");
  contiene(prompt, "cmwbcu28700b732qmru2nd890");
  contiene(prompt, "`gestion`");
  contiene(prompt, "`SEO:`");
});

prueba("cada tarjeta pide página, cambio y número de Search Console", () => {
  contiene(prompt, "**Qué página**");
  contiene(prompt, "**Qué cambio**");
  contiene(prompt, "**Qué número de Search Console debe mejorar**");
});

prueba("prohíbe repetir T-812 o tarjetas abiertas y prohíbe inventar", () => {
  contiene(prompt, "T-812");
  contiene(prompt, "tarjetas abiertas");
  contiene(prompt, "**No inventar**");
});

prueba("ya no limita a una mejora al día ni deja el lunes vacío", () => {
  noContiene(prompt, "UNA mejora al día");
  noContiene(prompt, "sin tarjetas");
  noContiene(prompt, "solo informe");
  noContiene(prompt, "Máximo 3");
});

prueba("trae las direcciones de magilus.com que WebFetch puede abrir y el respaldo con curl", () => {
  for (const url of ["https://magilus.com/", "https://magilus.com/robots.txt", "https://magilus.com/sitemap.xml"]) {
    contiene(prompt, url);
  }
  contiene(prompt, "curl -sL --max-time 30 '<dirección>'");
  contiene(prompt, "empieza\nexactamente por `https://magilus.com/` o `https://www.magilus.com/`");
});

prueba("la competencia en Colombia se marca como aproximada y Chromium tiene su paso", () => {
  contiene(prompt, "APROXIMADO");
  contiene(prompt, "posición de Search Console");
  contiene(prompt, "Chromium");
});

prueba("el README nombra la rutina, el ambiente y cómo actualizarla y correrla", () => {
  contiene(readme, "trig_01NTU1CvjmNKfUHPXiScPdPi");
  contiene(readme, "env_011111111111111111111117");
  contiene(readme, "## Cómo actualizar el texto");
  contiene(readme, "## Cómo correrla a mano");
});

prueba("la nota del manual va bajo Advertencias de operación con su clave", () => {
  const seccion = nota.split("## Advertencias de operación")[1] ?? "";
  assert.match(seccion, /^- `analista_seo_rutina`: .*claude\.ai.*PROMPT\.md/m);
});

console.log(`\n${pruebas - fallas.length}/${pruebas} pruebas bien`);
if (fallas.length) {
  console.log(`Fallaron: ${fallas.join(", ")}`);
  process.exit(1);
}
