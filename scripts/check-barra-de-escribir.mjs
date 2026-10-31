// Pruebas de la barra de escribir del chat en escritorio (reabre T-314, tarjeta xk8pogwu).
// La caja "Escribe un mensaje..." salia cortada a la izquierda contra la lista de chats: la
// tarjeta del chat y la grilla de la bandeja usaban overflow-hidden, que tapa lo que sobra pero
// deja que el navegador corra la caja de lado. Esto revisa en el codigo que no vuelva.
// Correr: node scripts/check-barra-de-escribir.mjs
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const panel = fs.readFileSync(path.resolve("src/components/chats/chat-conversation-panel.tsx"), "utf8");
const bandeja = fs.readFileSync(path.resolve("src/components/chats/shared-inbox.tsx"), "utf8");

// Las clases del elemento cuyo className contiene `marca` (una sola coincidencia).
function clasesDe(codigo, marca, archivo) {
  const lineas = codigo.split("\n").filter((linea) => linea.includes("className") && linea.includes(marca));
  assert.equal(lineas.length, 1, `${archivo}: se esperaba un solo className con "${marca}", hay ${lineas.length}`);
  // Se parte por espacios, comillas y llaves: asi sirve tambien para className={`${...} ...`}.
  return lineas[0].split(/[\s`"{}]+/).filter(Boolean);
}

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

prueba("la tarjeta del chat recorta con overflow-clip (no overflow-hidden)", () => {
  const clases = clasesDe(panel, "chat-inbox-panel", "chat-conversation-panel.tsx");
  assert.ok(clases.includes("overflow-clip"), "falta overflow-clip en chat-inbox-panel");
  assert.ok(!clases.includes("overflow-hidden"), "chat-inbox-panel no debe usar overflow-hidden");
});

prueba("la grilla de la bandeja recorta con overflow-clip (no overflow-hidden)", () => {
  const clases = clasesDe(bandeja, "chat-inbox-grid", "shared-inbox.tsx");
  assert.ok(clases.includes("overflow-clip"), "falta overflow-clip en chat-inbox-grid");
  assert.ok(!clases.includes("overflow-hidden"), "chat-inbox-grid no debe usar overflow-hidden");
});

prueba("la columna del chat (@container/chathdr) no deja salir nada de su ancho", () => {
  const clases = clasesDe(panel, "@container/chathdr flex", "chat-conversation-panel.tsx");
  assert.ok(clases.includes("overflow-x-clip"), "falta overflow-x-clip en la columna del chat");
  assert.ok(clases.includes("min-w-0"), "falta min-w-0 en la columna del chat");
});

prueba("la segunda fila de botones y las pestañas se desplazan dentro de su fila", () => {
  for (const marca of ["gap-1.5 overflow-x-auto", "gap-4 overflow-x-auto"]) {
    const clases = clasesDe(panel, marca, "chat-conversation-panel.tsx");
    assert.ok(clases.includes("min-w-0"), `falta min-w-0 en la fila "${marca}"`);
    assert.ok(clases.includes("overflow-x-auto"), `falta overflow-x-auto en la fila "${marca}"`);
  }
});

prueba("la barra de escribir y los mensajes tienen el mismo margen en escritorio (md:px-5)", () => {
  const compositor = clasesDe(panel, "chat-composer", "chat-conversation-panel.tsx");
  const mensajes = clasesDe(panel, "chat-messages-scroll", "chat-conversation-panel.tsx");
  const margen = (clases) => clases.filter((c) => /^md:px-/.test(c));
  assert.deepEqual(margen(compositor), ["md:px-5"]);
  assert.deepEqual(margen(mensajes), ["md:px-5"]);
});

console.log(`OK: ${pruebas} pruebas de la barra de escribir`);
