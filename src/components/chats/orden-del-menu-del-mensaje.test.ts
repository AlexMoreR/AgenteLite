import { test } from "node:test";
import assert from "node:assert/strict";

import { accionesDelMensaje } from "./orden-del-menu-del-mensaje";

/*
  El menu del mensaje en el orden de WhatsApp (Chats, parte 2): Responder, Reenviar, Copiar,
  (Fijar), Eliminar. La hoja del celular y el menu de la compu usan esta misma lista.
*/

const base = { tieneTexto: true, puedeEditar: false, tieneAudio: false, puedeFijar: false, estaFijado: false };

test("a) el orden base es Responder, Reenviar, Copiar, Eliminar", () => {
  assert.deepEqual(accionesDelMensaje(base), ["responder", "reenviar", "copiar", "eliminar"]);
});

test("b) sin texto no sale Copiar", () => {
  assert.deepEqual(accionesDelMensaje({ ...base, tieneTexto: false }), ["responder", "reenviar", "eliminar"]);
});

test("c) Editar va despues de Copiar", () => {
  assert.deepEqual(accionesDelMensaje({ ...base, puedeEditar: true }), [
    "responder",
    "reenviar",
    "copiar",
    "editar",
    "eliminar",
  ]);
});

test("d) Descargar audio va despues de Copiar (y de Editar si esta)", () => {
  assert.deepEqual(accionesDelMensaje({ ...base, tieneTexto: false, tieneAudio: true }), [
    "responder",
    "reenviar",
    "descargar-audio",
    "eliminar",
  ]);
  assert.deepEqual(accionesDelMensaje({ ...base, tieneAudio: true }), [
    "responder",
    "reenviar",
    "copiar",
    "descargar-audio",
    "eliminar",
  ]);
  assert.deepEqual(accionesDelMensaje({ ...base, puedeEditar: true, tieneAudio: true }), [
    "responder",
    "reenviar",
    "copiar",
    "editar",
    "descargar-audio",
    "eliminar",
  ]);
});

test("e) con puedeFijar, Fijar va entre Copiar y Eliminar", () => {
  assert.deepEqual(accionesDelMensaje({ ...base, puedeFijar: true }), [
    "responder",
    "reenviar",
    "copiar",
    "fijar",
    "eliminar",
  ]);
});

test("f) con estaFijado sale Desfijar en vez de Fijar", () => {
  const acciones = accionesDelMensaje({ ...base, puedeFijar: true, estaFijado: true });
  assert.deepEqual(acciones, ["responder", "reenviar", "copiar", "desfijar", "eliminar"]);
  assert.ok(!acciones.includes("fijar"));
});

test("g) sin puedeFijar no sale Fijar ni Desfijar, aunque este fijado", () => {
  const acciones = accionesDelMensaje({ ...base, estaFijado: true });
  assert.ok(!acciones.includes("fijar"));
  assert.ok(!acciones.includes("desfijar"));
});

test("h) 'destacar' no sale en ninguna combinacion; siempre empieza en Responder y termina en Eliminar", () => {
  const valores = [true, false];
  for (const tieneTexto of valores)
    for (const puedeEditar of valores)
      for (const tieneAudio of valores)
        for (const puedeFijar of valores)
          for (const estaFijado of valores) {
            const acciones: string[] = accionesDelMensaje({ tieneTexto, puedeEditar, tieneAudio, puedeFijar, estaFijado });
            assert.ok(!acciones.includes("destacar"));
            assert.equal(acciones[0], "responder");
            assert.equal(acciones[1], "reenviar");
            assert.equal(acciones.at(-1), "eliminar");
            assert.equal(new Set(acciones).size, acciones.length);
          }
});
