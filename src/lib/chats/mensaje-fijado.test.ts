import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { armarMensajeFijado } from "./mensaje-fijado";

test("mensaje con texto: sale id, texto y tipo", () => {
  assert.deepEqual(armarMensajeFijado("m1", { id: "m1", content: "  Hola, ¿precio?  ", type: "TEXT", deletedAt: null }), {
    id: "m1",
    texto: "Hola, ¿precio?",
    tipo: "TEXT",
  });
});

test("foto con pie: el texto es el pie", () => {
  assert.deepEqual(armarMensajeFijado("m2", { id: "m2", content: "Este modelo", type: "IMAGE" }), {
    id: "m2",
    texto: "Este modelo",
    tipo: "IMAGE",
  });
});

test("foto sin texto: texto vacio y tipo IMAGE (la pantalla dice Foto)", () => {
  assert.deepEqual(armarMensajeFijado("m3", { id: "m3", content: null, type: "IMAGE", deletedAt: null }), {
    id: "m3",
    texto: "",
    tipo: "IMAGE",
  });
});

test("mensaje borrado con Eliminar: null", () => {
  assert.equal(armarMensajeFijado("m4", { id: "m4", content: "Hola", type: "TEXT", deletedAt: new Date() }), null);
  assert.equal(armarMensajeFijado("m4", { id: "m4", content: "Hola", type: "TEXT", deletedAt: "2026-11-12T10:00:00.000Z" }), null);
});

test("sin fijado: null", () => {
  assert.equal(armarMensajeFijado(null, { id: "m5", content: "Hola", type: "TEXT" }), null);
  assert.equal(armarMensajeFijado(undefined, null), null);
  assert.equal(armarMensajeFijado("  ", null), null);
});

test("el mensaje ya no existe o es otro: null", () => {
  assert.equal(armarMensajeFijado("m6", null), null);
  assert.equal(armarMensajeFijado("m6", { id: "otro", content: "Hola", type: "TEXT" }), null);
});

test("sin tipo guardado: TEXT", () => {
  assert.deepEqual(armarMensajeFijado("m7", { id: "m7", content: "ok", type: null }), { id: "m7", texto: "ok", tipo: "TEXT" });
});

/*
  Sin base aca: se revisa el codigo de que el fijado viaja por /live en los dos canales (null incluido)
  y de que la accion solo acepta un mensaje de ESE chat y de ESE negocio, sin llamar a WhatsApp.
*/
const leer = (ruta: string) => fs.readFileSync(path.resolve(ruta), "utf8");

test("/live manda mensajeFijado en el canal oficial y en el viejo, siempre (null si no hay)", () => {
  const live = leer("src/app/api/cliente/chats/live/route.ts");
  assert.match(live, /mensajeFijado: detalle\.mensajeFijado \?\? null/);
  assert.match(live, /mensajeFijado: conversation\.mensajeFijado \?\? null/);
  const cargador = leer("src/lib/chat-message-loader.ts");
  assert.match(cargador, /mensajeFijadoId: true/);
  assert.match(cargador, /where: \{ id, conversationId: input\.conversationId, workspaceId: input\.workspaceId \}/);
  const oficial = leer("src/features/official-api/services/getOfficialApiChatsData.ts");
  assert.match(oficial, /ON fm\."id" = c\."mensajeFijadoId"\s+AND fm\."conversationId" = c\."id"/);
});

test("la accion valida chat, negocio y mensaje, y no llama a WhatsApp", () => {
  const accion = leer("src/app/actions/mensaje-fijado-actions.ts");
  assert.match(accion, /requireClientWorkspaceAccess\("chats"\)/);
  assert.match(accion, /estaEnModoMonitoreo/);
  assert.match(accion, /puedeAbrirChatPorClave\(/);
  assert.match(accion, /prisma\.message\.findFirst\(\{\s*where: \{ id: messageId, conversationId, workspaceId \}/);
  assert.match(accion, /prisma\.officialApiMessage\.findFirst\(\{\s*where: \{ id: messageId, conversationId, configId \}/);
  assert.match(accion, /prisma\.conversation\.updateMany\(\{\s*where: \{ id: conversationId, workspaceId \}/);
  assert.match(accion, /prisma\.officialApiConversation\.updateMany\(\{\s*where: \{ id: conversationId, configId \}/);
  for (const importado of accion.matchAll(/from\s+"([^"]+)"/g)) {
    assert.doesNotMatch(importado[1], /evolution|waha|official-api|gateway|meta/i, `la accion importa ${importado[1]}`);
  }
  const ruta = leer("src/app/api/cliente/chats/fijar/route.ts");
  assert.match(ruta, /atenderRutaDeEnvio\(request, "fijar", fijarMensajeAction\)/);
});
