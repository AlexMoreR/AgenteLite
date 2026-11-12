import test from "node:test";
import assert from "node:assert/strict";
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
