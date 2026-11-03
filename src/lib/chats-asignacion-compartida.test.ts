import assert from "node:assert/strict";
import test from "node:test";

import { asignadosDelChat, esDeQuien, whereEsMio } from "./chats-asignacion-compartida";

test("whereEsMio pide el chat como principal o como segundo asesor", () => {
  assert.deepEqual(whereEsMio("u1"), { OR: [{ assignedToUserId: "u1" }, { segundoAsesorId: "u1" }] });
});

test("esDeQuien: sí para el principal y para el segundo, no para un tercero", () => {
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

test("asignadosDelChat quita los vacíos y los repetidos", () => {
  assert.deepEqual(asignadosDelChat({ assignedToUserId: "u1", segundoAsesorId: "u2" }), ["u1", "u2"]);
  assert.deepEqual(asignadosDelChat({ assignedToUserId: "u1", segundoAsesorId: "u1" }), ["u1"]);
  assert.deepEqual(asignadosDelChat({ assignedToUserId: null, segundoAsesorId: "u2" }), ["u2"]);
  assert.deepEqual(asignadosDelChat({ assignedToUserId: "u1", segundoAsesorId: null }), ["u1"]);
  assert.deepEqual(asignadosDelChat({ assignedToUserId: null }), []);
});
