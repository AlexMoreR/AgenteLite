// Pruebas de src/lib/deslizar-para-responder.ts (deslizar un mensaje para responderlo).
// Correr: npm run test:deslizar-para-responder
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import ts from "typescript";

const sourcePath = path.resolve("src/lib/deslizar-para-responder.ts");
const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
});
const mod = { exports: {} };
new Function("exports", "module", transpiled.outputText)(mod.exports, mod);
const { decidirDeslizamiento, desplazamientoDeLaBurbuja, debeResponder, UMBRAL_DESLIZAR_PX, TOPE_DESLIZAR_PX } = mod.exports;

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

prueba("un movimiento minimo todavia no decide", () => {
  assert.equal(decidirDeslizamiento(3, 2), "esperar");
});
prueba("arrastre a la derecha y horizontal cuenta como deslizar", () => {
  assert.equal(decidirDeslizamiento(30, 4), "horizontal");
});
prueba("un movimiento vertical no dispara nada (scroll)", () => {
  assert.equal(decidirDeslizamiento(4, 30), "vertical");
});
prueba("en diagonal gana el scroll", () => {
  assert.equal(decidirDeslizamiento(20, 18), "vertical");
});
prueba("arrastrar a la izquierda no cuenta", () => {
  assert.equal(decidirDeslizamiento(-40, 2), "vertical");
});
prueba("pasar el umbral al soltar responde", () => {
  assert.equal(debeResponder(UMBRAL_DESLIZAR_PX), true);
  assert.equal(debeResponder(UMBRAL_DESLIZAR_PX + 30), true);
});
prueba("deslizar poco no responde", () => {
  assert.equal(debeResponder(UMBRAL_DESLIZAR_PX - 1), false);
  assert.equal(debeResponder(0), false);
});
prueba("la burbuja sigue al dedo, con tope y sin ir a la izquierda", () => {
  assert.equal(desplazamientoDeLaBurbuja(25), 25);
  assert.equal(desplazamientoDeLaBurbuja(500), TOPE_DESLIZAR_PX);
  assert.equal(desplazamientoDeLaBurbuja(-30), 0);
});

// El cableado: la burbuja usa el gesto, lo apaga con la seleccion y no toca el envio.
const burbuja = fs.readFileSync("src/components/chats/chat-message-bubble.tsx", "utf8");
prueba("la burbuja deslizada llama a onReply con su mensaje", () => {
  assert.match(burbuja, /onReply\?\.\(message\)/);
  assert.match(burbuja, /useSwipeToReply\(responderAlDeslizar, Boolean\(onReply\) && !haySeleccion\)/);
});
prueba("el mantener apretado sigue conectado", () => {
  assert.match(burbuja, /useLongPress\(abrirMenuTactil, tieneAcciones\)/);
  assert.match(burbuja, /longPress\.onPointerDown\(evento\)/);
});
const gancho = fs.readFileSync("src/components/chats/use-swipe-to-reply.ts", "utf8");
prueba("no se activa sobre el reproductor de audio", () => {
  assert.match(gancho, /role="slider"/);
  assert.match(gancho, /audio/);
});
prueba("el gesto no envia nada por su cuenta", () => {
  assert.doesNotMatch(gancho, /sendMessage|fetch\(|actions\//);
});

console.log(`${pruebas} pruebas ok`);
