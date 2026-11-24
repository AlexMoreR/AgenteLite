import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOriginLabel } from "./getCrmData";

// Los chats de la página web guardan crmOrigin: "web" y deben salir como "Página web", no "Genérico".
test("el origen web sale como WEB", () => {
  assert.equal(normalizeOriginLabel("web"), "WEB");
  assert.equal(normalizeOriginLabel(" Web "), "WEB");
  assert.equal(normalizeOriginLabel("https://magilus.com/producto"), "WEB");
  assert.equal(normalizeOriginLabel("Página web"), "WEB");
  assert.equal(normalizeOriginLabel("pagina web"), "WEB");
});

test("los demás orígenes no cambian", () => {
  assert.equal(normalizeOriginLabel("facebook"), "FACEBOOK");
  assert.equal(normalizeOriginLabel("meta ads"), "FACEBOOK");
  assert.equal(normalizeOriginLabel("marketplace"), "MARKETPLACE");
  assert.equal(normalizeOriginLabel("referido"), "RECOMENDADO");
  assert.equal(normalizeOriginLabel("whatsapp"), "GENERICO");
  assert.equal(normalizeOriginLabel("webinar"), "GENERICO");
});
