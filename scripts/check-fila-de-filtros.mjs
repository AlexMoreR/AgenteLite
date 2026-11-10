// Reglas de la fila de filtros de la bandeja de Chats (src/components/chats/appsidebar.tsx).
//
// Problema que cuidan (Yair, laptop de 1280 px): la fila se deslizaba de lado con la barra
// escondida, y en la computadora las ultimas listas y el "+" quedaban tapados a la derecha.
//
//   1. El "+" (Nueva lista) esta FUERA del contenedor que se desliza, como ultimo elemento.
//   2. En la computadora el contenedor pasa a otra linea (md:flex-wrap) y no se desliza
//      (md:overflow-visible); en el celular sigue deslizandose (overflow-x-auto).
//   3. El nombre de cada lista va en un <span> con truncate y ancho maximo, y el boton
//      conserva el title con el nombre completo.
//   4. "No leído" sigue fuera del map de Todas/Mias (la asesora comun lo ve).
//
// Se corre con: node scripts/check-fila-de-filtros.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const barra = fs.readFileSync(path.join(raiz, "src/components/chats/appsidebar.tsx"), "utf8");

let fallas = 0;
function prueba(nombre, fn) {
  try {
    fn();
    console.log(`ok   ${nombre}`);
  } catch (error) {
    fallas += 1;
    console.error(`FALLA ${nombre}\n      ${error.message}`);
  }
}

// Devuelve el indice donde cierra el <div> que abre en `inicio` (cuenta <div y </div>).
function cierreDelDiv(texto, inicio) {
  const patron = /<div\b|<\/div>/g;
  patron.lastIndex = inicio;
  let profundidad = 0;
  let coincidencia;
  while ((coincidencia = patron.exec(texto))) {
    profundidad += coincidencia[0] === "</div>" ? -1 : 1;
    if (profundidad === 0) return coincidencia.index;
  }
  throw new Error("no se encontro el cierre del contenedor");
}

const inicioDesliza = barra.search(/<div className="[^"]*overflow-x-auto[^"]*md:flex-wrap/);
const inicioDelPlus = barra.indexOf('aria-label="Nueva lista"');

prueba("hay un solo contenedor de pastillas que se desliza y pasa a otra linea en computadora", () => {
  assert.ok(inicioDesliza >= 0, "no esta el contenedor con overflow-x-auto y md:flex-wrap");
  const clases = barra.slice(inicioDesliza).match(/className="([^"]*)"/)[1].split(/\s+/);
  for (const clase of ["flex", "min-w-0", "flex-1", "overflow-x-auto", "md:flex-wrap", "md:overflow-visible"]) {
    assert.ok(clases.includes(clase), `al contenedor le falta la clase ${clase}`);
  }
});

prueba('el "+" (Nueva lista) esta fuera del contenedor que se desliza y es el ultimo de la fila', () => {
  assert.equal(barra.split('aria-label="Nueva lista"').length - 1, 1, 'tiene que haber un solo boton "Nueva lista"');
  const finDesliza = cierreDelDiv(barra, inicioDesliza);
  assert.ok(inicioDelPlus > finDesliza, 'el "+" quedo dentro del contenedor que se desliza');
  // Despues del boton "+" solo cierra la fila: nada mas queda a su derecha.
  const despues = barra.slice(inicioDelPlus).replace(/^[\s\S]*?<\/button>/, "").trimStart();
  assert.match(despues, /^<\/div>/, 'hay algo despues del "+" dentro de la fila');
  const clasesDelPlus = barra.slice(inicioDelPlus).match(/className="([^"]*)"/)[1];
  assert.match(clasesDelPlus, /\bshrink-0\b/, 'el "+" se tiene que poder ver entero (shrink-0)');
});

prueba('el nombre de la lista se corta con "…" y el title tiene el nombre completo', () => {
  const inicioListas = barra.indexOf("{listas.map((lista) =>");
  assert.ok(inicioListas >= 0, "no esta el map de listas");
  const bloque = barra.slice(inicioListas, barra.indexOf("})}", inicioListas));
  assert.match(bloque, /title=\{`\$\{lista\.nombre\} \(mantén presionado para editar\)`\}/);
  assert.match(bloque, /<span className="[^"]*\bmax-w-\[[^\]]+\][^"]*\btruncate\b[^"]*">\{lista\.nombre\}<\/span>/);
});

prueba('"No leído" sigue fuera del map de Todas/Mias (la ve la asesora)', () => {
  const inicioMap = barra.indexOf("PASTILLAS_A_LA_VISTA : ([\"mine\"] as const)).map(");
  assert.ok(inicioMap >= 0, "no esta el map de Todas/Mias");
  const finMap = barra.indexOf("})}", inicioMap);
  const noLeido = barra.indexOf("No leído", finMap);
  assert.ok(noLeido > finMap, '"No leído" no esta despues del map de Todas/Mias');
  assert.ok(noLeido < inicioDelPlus, '"No leído" tiene que estar en la fila, antes del "+"');
});

if (fallas) {
  console.error(`\n${fallas} prueba(s) fallaron`);
  process.exit(1);
}
console.log("\nfila de filtros: todo ok");
