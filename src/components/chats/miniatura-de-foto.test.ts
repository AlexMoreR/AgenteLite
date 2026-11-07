import assert from "node:assert/strict";
import { test } from "node:test";

import { miniaturaDeFoto } from "./miniatura-de-foto";

test("una foto guardada en /uploads/chat-media sale por el optimizador a 96 px y q=75", () => {
  assert.equal(
    miniaturaDeFoto("/uploads/chat-media/abc123.jpg"),
    "/_next/image?url=%2Fuploads%2Fchat-media%2Fabc123.jpg&w=96&q=75",
  );
});

test("cualquier otra ruta de /uploads/ tambien se achica", () => {
  assert.equal(
    miniaturaDeFoto("/uploads/otra/foto.png"),
    "/_next/image?url=%2Fuploads%2Fotra%2Ffoto.png&w=96&q=75",
  );
});

test("los espacios de los lados no impiden reconocerla", () => {
  assert.equal(
    miniaturaDeFoto("  /uploads/chat-media/abc.webp "),
    "/_next/image?url=%2Fuploads%2Fchat-media%2Fabc.webp&w=96&q=75",
  );
});

test("los caracteres raros del nombre quedan codificados", () => {
  assert.equal(
    miniaturaDeFoto("/uploads/chat-media/a b&c=1.jpg"),
    "/_next/image?url=%2Fuploads%2Fchat-media%2Fa%20b%26c%3D1.jpg&w=96&q=75",
  );
});

test("una foto con direccion de WhatsApp queda igual", () => {
  const url = "https://pps.whatsapp.net/v/t61.24694-24/123_n.jpg?ccb=11-4&oh=abc&oe=def";
  assert.equal(miniaturaDeFoto(url), url);
});

test("una foto data: queda igual", () => {
  const url = "data:image/png;base64,iVBORw0KGgo=";
  assert.equal(miniaturaDeFoto(url), url);
});

test("una direccion vacia queda igual", () => {
  assert.equal(miniaturaDeFoto(""), "");
});

test("una direccion que solo contiene /uploads/ en el medio queda igual", () => {
  const url = "https://otro.com/uploads/foto.jpg";
  assert.equal(miniaturaDeFoto(url), url);
  assert.equal(miniaturaDeFoto("//uploads/foto.jpg"), "//uploads/foto.jpg");
});
