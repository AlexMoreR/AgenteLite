// ¿El chat necesita asesora? (11-nov-2026). Correr: npm run test:reparto-cuando-lo-necesita
import assert from "node:assert/strict";
import { test } from "node:test";

import { chatNecesitaAsesora, hablaDePlataOEntrega, type MensajeDelReparto } from "./reparto-cuando-lo-necesita";

const t = (minuto: number) => new Date(Date.UTC(2026, 10, 12, 3, minuto));
const cliente = (minuto: number, content: string): MensajeDelReparto => ({ direction: "INBOUND", type: "TEXT", content, createdAt: t(minuto) });
const bot = (minuto: number, content: string): MensajeDelReparto => ({ direction: "OUTBOUND", type: "TEXT", content, createdAt: t(minuto) });
const foto = (minuto: number): MensajeDelReparto => ({ direction: "OUTBOUND", type: "IMAGE", content: null, createdAt: t(minuto) });
const nota = (minuto: number, content: string): MensajeDelReparto => ({ direction: "OUTBOUND", type: "SYSTEM", content, createdAt: t(minuto) });

// El chat real 253948799807545, sin teléfono ni nombre.
const ANUNCIO = "Hola, me interesa el COMBO de estética (camilla, escalera, silla y auxiliar)";
const comienzo = [cliente(59, ANUNCIO), bot(60, "Bienvenid@ a *Magilus* 👑"), bot(60, "¿Qué servicios vas a ofrecer en tu espacio?")];

test("el caso de Alex: 'estética facial' antes de las fotos NO asigna", () => {
  assert.equal(chatNecesitaAsesora([...comienzo, cliente(61, "estética facial")]).asignar, false);
  assert.equal(chatNecesitaAsesora([...comienzo, cliente(61, "estética facial")]).motivo, "sin_fotos");
});

test("antes de las fotos no asigna NADA, ni preguntando precio ni con la nota del agente", () => {
  assert.equal(chatNecesitaAsesora([...comienzo, cliente(61, "¿cuánto vale?")]).asignar, false);
  assert.equal(chatNecesitaAsesora([...comienzo, nota(61, "El agente pide un asesor: no entendió")]).asignar, false);
});

test("con las fotos mandadas, 'sí' o 'qué lindo' no asignan", () => {
  const conFotos = [...comienzo, cliente(61, "estética facial"), foto(62), bot(62, "¿Te comparto fotos?")];
  assert.equal(chatNecesitaAsesora([...conFotos, cliente(63, "Sí")]).asignar, false);
  assert.equal(chatNecesitaAsesora([...conFotos, cliente(63, "Qué lindo 😍")]).motivo, "sin_pedido");
});

test("con las fotos mandadas, precio, pago, envío, contraentrega o ciudad SÍ asignan", () => {
  const conFotos = [...comienzo, foto(62)];
  for (const frase of ["¿Cuánto vale?", "cuanto cuesta el combo", "Qué precio tiene", "¿hacen contraentrega?", "Cómo pago", "¿Hacen envíos?", "soy de Medellín", "Bogotá", "Estoy en cali", "¿Aceptan Nequi?"]) {
    const decision = chatNecesitaAsesora([...conFotos, cliente(63, frase)]);
    assert.equal(decision.asignar, true, frase);
    assert.equal(decision.motivo, "plata_o_entrega", frase);
  }
});

test("la nota 'El agente pide un asesor' con las fotos mandadas SÍ asigna", () => {
  const decision = chatNecesitaAsesora([...comienzo, foto(62), cliente(63, "ok"), nota(64, "El agente pide un asesor: que conteste una persona")]);
  assert.equal(decision.asignar, true);
  assert.equal(decision.motivo, "agente_pide_asesora");
});

test("si preguntó el precio en el primer mensaje, se asigna apenas llegan las fotos", () => {
  const chat = [cliente(59, ANUNCIO), cliente(59, "Precio en Bogotá"), bot(60, "Bienvenid@"), cliente(61, "Podología?")];
  assert.equal(chatNecesitaAsesora(chat).asignar, false);
  assert.equal(chatNecesitaAsesora([...chat, foto(62)]).asignar, true);
});

test("frases que NO son plata ni ciudad", () => {
  for (const frase of [ANUNCIO, "estética facial", "masajes", "Me encanta", "Quiero un plato de comida", "Mi meta es abrir mi spa", "Me llamo Florencia", "¿De qué color hay?", "La página no abre", "ok gracias"]) {
    assert.equal(hablaDePlataOEntrega(frase), false, frase);
  }
});

test("un mensaje borrado no cuenta", () => {
  const borrado: MensajeDelReparto = { ...cliente(63, "¿cuánto vale?"), borrado: true };
  assert.equal(chatNecesitaAsesora([...comienzo, foto(62), borrado]).asignar, false);
});
