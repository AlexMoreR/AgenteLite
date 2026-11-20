// Pruebas de la caja de escribir de un chat (pedido del 20-nov-2026): el texto de ayuda dice solo "Mensaje" (en el
// celular "Escribe un mensaje..." se partia en dos lineas) y los botones +, carita, chispa de IA, microfono y enviar
// miden 32 px de ancho y conservan el alto (40 px celular, 36 px compu), para que los iconos queden juntos como en
// WhatsApp y el campo de texto tenga mas espacio. Lee el codigo fuente; no necesita base ni red.
// Correr: node scripts/check-caja-de-mensaje.mjs
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const panel = fs.readFileSync(path.resolve("src/components/chats/chat-conversation-panel.tsx"), "utf8");
const composer = fs.readFileSync(path.resolve("src/components/chats/chat-composer.tsx"), "utf8");
const ayuda = fs.readFileSync(path.resolve("src/lib/help-assistant/knowledge.ts"), "utf8");

// 1. Texto de ayuda.
assert.ok(
  panel.includes('placeholder={composer.placeholder || "Mensaje"}'),
  'el texto de ayuda de la caja debe ser "Mensaje"',
);
assert.ok(!panel.includes("Escribe un mensaje..."), 'el panel ya no debe decir "Escribe un mensaje..."');
assert.ok(ayuda.includes('("Mensaje")'), 'la ayuda debe nombrar la casilla como ("Mensaje")');
assert.ok(!ayuda.includes('("Escribe un mensaje...")'), "la ayuda no debe nombrar la casilla vieja");

// 2. Botones: las clases del boton (Button o button) que lleva cada aria-label.
function clasesDelBoton(fuente, ariaLabel) {
  const inicio = fuente.indexOf(ariaLabel);
  assert.ok(inicio >= 0, `no se encontro el boton ${ariaLabel}`);
  // La etiqueta va desde el "<Button" anterior hasta su primer hijo (el icono, "<Plus", "<Mic", ...).
  const apertura = fuente.lastIndexOf("<Button", inicio);
  const etiqueta = fuente.slice(apertura, fuente.indexOf("\n", fuente.indexOf(">\n", inicio)));
  const clase = etiqueta.match(/className="([^"]+)"/);
  assert.ok(clase, `el boton ${ariaLabel} no tiene className`);
  return new Set(clase[1].split(/\s+/));
}

const botones = [
  [panel, 'aria-label="Adjuntar"'],
  [panel, 'aria-label="Abrir selector de emoticones"'],
  [panel, 'aria-label="Respuesta sugerida con IA"'],
  [panel, 'aria-label="Grabar nota de voz"'],
  [composer, 'aria-label={pending ? "Enviando mensaje"'],
];
for (const [fuente, ariaLabel] of botones) {
  const clases = clasesDelBoton(fuente, ariaLabel);
  for (const debe of ["w-8", "h-10", "md:h-9"]) {
    assert.ok(clases.has(debe), `el boton ${ariaLabel} debe tener ${debe}`);
  }
  for (const noDebe of ["size-10", "md:size-9"]) {
    assert.ok(!clases.has(noDebe), `el boton ${ariaLabel} ya no debe tener ${noDebe}`);
  }
}

console.log("check-caja-de-mensaje: OK");
