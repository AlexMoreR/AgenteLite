// La biblioteca guardada (11-nov-2026). Correr: npx tsx --test src/components/chats/biblioteca-guardada.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { rutaParaMostrar } from "./biblioteca-guardada";

test("las tapas guardadas con el dominio viejo o el nuevo se muestran desde la ruta propia", () => {
  assert.equal(rutaParaMostrar("https://app.aizenbot.com/uploads/chat-media/1786809276357-a.png"), "/uploads/chat-media/1786809276357-a.png");
  assert.equal(rutaParaMostrar("https://crm.magilus.com/uploads/chat-media/b.png?v=2"), "/uploads/chat-media/b.png?v=2");
  assert.equal(rutaParaMostrar("/uploads/chat-media/c.png"), "/uploads/chat-media/c.png");
});

test("lo de afuera o lo que no es /uploads se deja como esta, y sin direccion no hay nada", () => {
  assert.equal(rutaParaMostrar("https://mmg.whatsapp.net/v/t62/foto.jpg"), "https://mmg.whatsapp.net/v/t62/foto.jpg");
  assert.equal(rutaParaMostrar("https://app.aizenbot.com/api/files/x"), "https://app.aizenbot.com/api/files/x");
  assert.equal(rutaParaMostrar(null), null);
});
