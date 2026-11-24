// Pruebas de la parte 2 del origen web: src/lib/origen-web.ts y su uso en el webhook de Evolution.
// Revisa el código (sin base): no manda mensajes, no toca etapa ni asesora, y el webhook solo oculta
// la ficha de la línea Admin si NO es un chat de la web. Correr: npm run test:origen-web
import fs from "node:fs";
import assert from "node:assert/strict";

const lib = fs.readFileSync("src/lib/origen-web.ts", "utf8");
const webhook = fs.readFileSync("src/app/api/webhooks/evolution/route.ts", "utf8");
const sinComentarios = lib.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

let casos = 0;
function caso(nombre, fn) {
  fn();
  casos += 1;
  console.log(`ok - ${nombre}`);
}

caso("exporta registrarOrigenWeb", () => {
  assert.match(lib, /export async function registrarOrigenWeb\(/);
});
caso("usa detectarOrigenWeb de origen-de-venta", () => {
  assert.match(lib, /import \{ detectarOrigenWeb \} from "@\/lib\/origen-de-venta";/);
  assert.match(lib, /if \(!detectarOrigenWeb\(input\.texto\)\) return;/);
});
caso("no manda WhatsApp", () => {
  assert.doesNotMatch(sinComentarios, /sendText|enviarMensaje|sendMessage|evolution|waha/i);
});
caso("no toca etapa ni asesora", () => {
  assert.doesNotMatch(sinComentarios, /crmStage|assignedToUserId/);
});
caso("respeta bloqueados y primer mensaje", () => {
  assert.match(lib, /if \(contacto\.bloqueadoEn\) return;/);
  assert.match(lib, /direction: "INBOUND"/);
  assert.match(lib, /if \(entrantes > 1\) return;/);
});
caso("etiqueta Web con slug web sin duplicar", () => {
  assert.match(lib, /const TAG_SLUG = "web";/);
  assert.match(lib, /const TAG_NOMBRE = "Web";/);
  assert.match(lib, /skipDuplicates: true/);
});
caso("origen web solo si no había uno y deja la ficha visible", () => {
  assert.match(lib, /excludedFromCrm: false/);
  assert.match(lib, /crmOrigin: "web"/);
  assert.match(lib, /canal: "web"/);
  assert.match(lib, /yaTieneOrigen\s*\n?\s*\? \{\}/);
});
caso("se traga sus errores", () => {
  assert.match(lib, /\} catch \(error\) \{\s*console\.warn\("\[ORIGEN\] web_failed"/);
});
caso("webhook: Admin solo se oculta si no es de la web, y llama a registrarOrigenWeb", () => {
  assert.match(
    webhook,
    /channel\.purpose === "ADMIN" && !detectarOrigenWeb\(messageText\)\s*\?\s*\{ excludedFromCrm: true \}/,
  );
  assert.match(webhook, /after\(\(\) => registrarOrigenWeb\(datosOrigenWeb\)\);/);
  assert.match(webhook, /after\(\(\) => registrarOrigenMarketplace\(datosOrigen\)\);/);
});

console.log(`origen-web: ${casos} casos OK`);
