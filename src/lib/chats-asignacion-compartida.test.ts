import assert from "node:assert/strict";
import test from "node:test";

import { asignadosDelChat, esDeQuien, queVeDelSegundoAsesor, whereEsMio } from "./chats-asignacion-compartida";

test("whereEsMio: el chat es mío si soy el principal o el segundo", () => {
  assert.deepEqual(whereEsMio("u1"), { OR: [{ assignedToUserId: "u1" }, { segundoAsesorId: "u1" }] });
});

test("esDeQuien: verdadero para el principal y el segundo, falso para un tercero", () => {
  const chat = { assignedToUserId: "u1", segundoAsesorId: "u2" };
  assert.equal(esDeQuien(chat, "u1"), true);
  assert.equal(esDeQuien(chat, "u2"), true);
  assert.equal(esDeQuien(chat, "u3"), false);
});

test("esDeQuien: un chat sin segundo asesor queda como hoy", () => {
  assert.equal(esDeQuien({ assignedToUserId: "u1" }, "u1"), true);
  assert.equal(esDeQuien({ assignedToUserId: "u1", segundoAsesorId: null }, "u2"), false);
  assert.equal(esDeQuien({ assignedToUserId: null, segundoAsesorId: null }, "u1"), false);
});

test("asignadosDelChat: quita los vacíos y los repetidos", () => {
  assert.deepEqual(asignadosDelChat({ assignedToUserId: "u1", segundoAsesorId: "u2" }), ["u1", "u2"]);
  assert.deepEqual(asignadosDelChat({ assignedToUserId: "u1", segundoAsesorId: "u1" }), ["u1"]);
  assert.deepEqual(asignadosDelChat({ assignedToUserId: null, segundoAsesorId: "u2" }), ["u2"]);
  assert.deepEqual(asignadosDelChat({ assignedToUserId: "u1", segundoAsesorId: null }), ["u1"]);
  assert.deepEqual(asignadosDelChat({ assignedToUserId: null }), []);
});

test("queVeDelSegundoAsesor: el jefe y el principal agregan cuando hay principal y no hay segundo", () => {
  const base = { principalId: "p", segundoId: null };
  assert.deepEqual(queVeDelSegundoAsesor({ ...base, usuarioId: "jefe", esJefe: true }), { puedeAgregar: true, puedeQuitar: false });
  assert.deepEqual(queVeDelSegundoAsesor({ ...base, usuarioId: "p", esJefe: false }), { puedeAgregar: true, puedeQuitar: false });
  // Una compañera que no es la dueña del chat no ve nada.
  assert.deepEqual(queVeDelSegundoAsesor({ ...base, usuarioId: "otra", esJefe: false }), { puedeAgregar: false, puedeQuitar: false });
});

test("queVeDelSegundoAsesor: sin principal no se puede agregar a nadie", () => {
  assert.deepEqual(
    queVeDelSegundoAsesor({ principalId: null, segundoId: null, usuarioId: "jefe", esJefe: true }),
    { puedeAgregar: false, puedeQuitar: false },
  );
});

test("queVeDelSegundoAsesor: con segundo asesor, la x la ven el jefe, el principal y el segundo", () => {
  const base = { principalId: "p", segundoId: "s" };
  assert.deepEqual(queVeDelSegundoAsesor({ ...base, usuarioId: "jefe", esJefe: true }), { puedeAgregar: false, puedeQuitar: true });
  assert.deepEqual(queVeDelSegundoAsesor({ ...base, usuarioId: "p", esJefe: false }), { puedeAgregar: false, puedeQuitar: true });
  assert.deepEqual(queVeDelSegundoAsesor({ ...base, usuarioId: "s", esJefe: false }), { puedeAgregar: false, puedeQuitar: true });
  assert.deepEqual(queVeDelSegundoAsesor({ ...base, usuarioId: "otra", esJefe: false }), { puedeAgregar: false, puedeQuitar: false });
  // Sin saber quién mira (la lista del equipo no llegó), no se ofrece nada a quien no es jefe.
  assert.deepEqual(queVeDelSegundoAsesor({ ...base, usuarioId: null, esJefe: false }), { puedeAgregar: false, puedeQuitar: false });
});
