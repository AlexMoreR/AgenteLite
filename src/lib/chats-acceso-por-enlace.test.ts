import assert from "node:assert/strict";
import test from "node:test";

import { puedeAbrirChat, type QuienAbre } from "./chats-acceso-por-enlace";

const ventas = "canal-ventas";
const administrativa = "canal-admin";

const asesora: QuienAbre = { userId: "maria", esJefe: false, canalesVisibles: [ventas], canalesMonitoreados: [] };
const dueno: QuienAbre = { userId: "alex", esJefe: true, canalesVisibles: null, canalesMonitoreados: [] };
const supervisora: QuienAbre = { userId: "sofia", esJefe: true, canalesVisibles: [ventas], canalesMonitoreados: [] };
const monitora: QuienAbre = { userId: "lina", esJefe: false, canalesVisibles: [ventas, administrativa], canalesMonitoreados: [ventas] };

const chat = (channelId: string | null, assignedToUserId: string | null) => ({
  fuente: "agent" as const,
  channelId,
  assignedToUserId,
});
const oficial = (assignedToUserId: string | null) => ({ fuente: "official" as const, channelId: null, assignedToUserId });

test("la asesora no abre el chat de otra por enlace", () => {
  assert.equal(puedeAbrirChat(chat(ventas, "ingrid"), asesora), false);
  assert.equal(puedeAbrirChat(chat(ventas, null), asesora), false);
});

test("la asesora no abre un chat suyo de una linea que no ve", () => {
  assert.equal(puedeAbrirChat(chat(administrativa, "maria"), asesora), false);
});

test("la dueña del chat si lo abre", () => {
  assert.equal(puedeAbrirChat(chat(ventas, "maria"), asesora), true);
});

test("la asesora no abre un chat oficial de otra, y si el suyo", () => {
  assert.equal(puedeAbrirChat(oficial("ingrid"), asesora), false);
  assert.equal(puedeAbrirChat(oficial(null), asesora), false);
  assert.equal(puedeAbrirChat(oficial("maria"), asesora), true);
});

test("el dueño y el administrador abren cualquiera", () => {
  assert.equal(puedeAbrirChat(chat(administrativa, "ingrid"), dueno), true);
  assert.equal(puedeAbrirChat(chat(null, null), dueno), true);
  assert.equal(puedeAbrirChat(oficial("ingrid"), dueno), true);
});

test("la supervisora abre cualquiera pero solo dentro de sus lineas", () => {
  assert.equal(puedeAbrirChat(chat(ventas, "ingrid"), supervisora), true);
  assert.equal(puedeAbrirChat(chat(administrativa, "ingrid"), supervisora), false);
  assert.equal(puedeAbrirChat(oficial("ingrid"), supervisora), true);
});

test("quien monitorea abre los de su linea y no los de otra", () => {
  assert.equal(puedeAbrirChat(chat(ventas, "ingrid"), monitora), true);
  assert.equal(puedeAbrirChat(chat(ventas, null), monitora), true);
  assert.equal(puedeAbrirChat(chat(administrativa, "lina"), monitora), false);
  assert.equal(puedeAbrirChat(oficial("ingrid"), monitora), true);
});

test("un chat sin linea solo lo abre quien ve todas las lineas", () => {
  assert.equal(puedeAbrirChat(chat(null, "maria"), asesora), false);
  assert.equal(puedeAbrirChat(chat(null, "ingrid"), dueno), true);
});
