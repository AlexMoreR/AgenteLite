// Pruebas de la barra de escribir del chat en escritorio (reapertura de la T-314): la tarjeta del chat y la grilla de
// la bandeja no se pueden correr de lado (overflow-clip, no overflow-hidden), la columna del chat recorta lo que se sale
// de su ancho y la barra tiene el mismo margen que los mensajes. Lee el código fuente; no necesita base ni red.
// Correr: node scripts/check-barra-de-escribir.mjs
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const panel = fs.readFileSync(path.resolve("src/components/chats/chat-conversation-panel.tsx"), "utf8");
const bandeja = fs.readFileSync(path.resolve("src/components/chats/shared-inbox.tsx"), "utf8");

// Las clases de la primera etiqueta cuyo className contiene `marca`.
function clasesDe(fuente, marca) {
  const linea = fuente.split("\n").find((l) => l.includes("className=") && l.includes(marca));
  assert.ok(linea, `no se encontró el className con "${marca}"`);
  return new Set(linea.replace(/^.*className=\{?[`"]/, "").split(/[\s`"]+/).filter(Boolean));
}

const tarjeta = clasesDe(panel, "chat-inbox-panel");
assert.ok(tarjeta.has("overflow-clip"), "la tarjeta chat-inbox-panel debe usar overflow-clip");
assert.ok(!tarjeta.has("overflow-hidden"), "la tarjeta chat-inbox-panel no debe usar overflow-hidden");

const grilla = clasesDe(bandeja, "chat-inbox-grid");
assert.ok(grilla.has("overflow-clip"), "la grilla chat-inbox-grid debe usar overflow-clip");
assert.ok(!grilla.has("overflow-hidden"), "la grilla chat-inbox-grid no debe usar overflow-hidden");

const columna = clasesDe(panel, "@container/chathdr");
assert.ok(columna.has("overflow-x-clip"), "la columna @container/chathdr debe tener overflow-x-clip");
assert.ok(columna.has("min-w-0"), "la columna @container/chathdr debe tener min-w-0");

const filaBotones = clasesDe(panel, "px-3 py-1.5 @min-[520px]/chathdr:hidden");
assert.ok(filaBotones.has("min-w-0") && filaBotones.has("overflow-x-auto"), "la segunda fila de botones debe desplazarse en su fila");

const pestanas = clasesDe(panel, "items-center gap-4");
// overflow-x-clip y no auto: auto también recortaría en vertical el subrayado de la pestaña activa (-mb-px).
assert.ok(pestanas.has("min-w-0") && pestanas.has("overflow-x-clip"), "la fila de pestañas no debe salirse del ancho del chat");
assert.ok(!pestanas.has("overflow-x-auto"), "la fila de pestañas no debe recortar el subrayado de la pestaña activa");

const compositor = clasesDe(panel, "chat-composer z-20");
const mensajes = clasesDe(panel, "chat-messages-scroll");
assert.ok(compositor.has("md:px-5"), "el contenedor chat-composer debe tener md:px-5");
assert.ok(mensajes.has("md:px-5"), "chat-messages-scroll debe tener md:px-5");
// En escritorio la barra no se queda en 1024 px mientras los mensajes ocupan todo el ancho.
const formulario = clasesDe(panel, "mx-auto w-full min-w-0 max-w-5xl");
assert.ok(formulario.has("md:max-w-none"), "en escritorio la barra debe medir lo mismo que los mensajes (md:max-w-none)");
// En celular la barra se queda como estaba.
assert.ok(compositor.has("px-1.5"), "en celular la barra conserva px-1.5");

console.log("OK barra de escribir: tarjeta y grilla con overflow-clip, columna recortada y mismo margen que los mensajes");
