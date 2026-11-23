// ¿El chat necesita asesora? (11-nov-2026; la (b) cambió el 22-nov-2026). Correr: npm run test:reparto-cuando-lo-necesita
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  chatNecesitaAsesora,
  decidirSiElChatNecesitaAsesora,
  hablaDePlataOEntrega,
  primerMensajeEsDeEntrada,
  type MensajeDelReparto,
} from "./reparto-cuando-lo-necesita";

const t = (minuto: number) => new Date(Date.UTC(2026, 10, 12, 3, minuto));
const cliente = (minuto: number, content: string): MensajeDelReparto => ({ direction: "INBOUND", type: "TEXT", content, createdAt: t(minuto) });
const bot = (minuto: number, content: string): MensajeDelReparto => ({ direction: "OUTBOUND", type: "TEXT", content, createdAt: t(minuto) });
const foto = (minuto: number): MensajeDelReparto => ({ direction: "OUTBOUND", type: "IMAGE", content: null, createdAt: t(minuto) });
const nota = (minuto: number, content: string): MensajeDelReparto => ({ direction: "OUTBOUND", type: "SYSTEM", content, createdAt: t(minuto) });

// El chat real 253948799807545, sin teléfono ni nombre.
const ANUNCIO = "Hola, me interesa el COMBO de estética (camilla, escalera, silla y auxiliar)";
const comienzo = [cliente(59, ANUNCIO), bot(60, "Bienvenid@ a *Magilus* 👑"), bot(60, "¿Qué servicios vas a ofrecer en tu espacio?")];

test("22-nov: el mensaje del anuncio solo NO asigna", () => {
  assert.equal(chatNecesitaAsesora(comienzo).asignar, false);
  assert.equal(chatNecesitaAsesora(comienzo).motivo, "sin_pedido");
  assert.equal(chatNecesitaAsesora([cliente(59, ANUNCIO)]).asignar, false);
});

test("22-nov: cualquier cosa que escriba después del anuncio SÍ asigna, con fotos o sin fotos ('estética facial', un 'sí', el precio)", () => {
  for (const frase of ["estética facial", "Sí", "ok", "¿cuánto vale?", "Donde estan ubicados", "Qué lindo 😍"]) {
    const decision = chatNecesitaAsesora([...comienzo, cliente(61, frase)]);
    assert.equal(decision.asignar, true, frase);
    assert.equal(decision.motivo, "clienta_escribio", frase);
  }
  assert.equal(chatNecesitaAsesora([...comienzo, foto(62), cliente(63, "Sí")]).asignar, true);
});

test("22-nov: la pregunta en la misma ráfaga que el anuncio (antes de la bienvenida) también asigna", () => {
  const decision = chatNecesitaAsesora([cliente(59, ANUNCIO), cliente(59, "Solo la camilla"), cliente(59, "Donde estan ubicados")]);
  assert.equal(decision.asignar, true);
  assert.equal(decision.detalle, "Solo la camilla");
});

test("22-nov: en un chat orgánico (no vino de anuncio ni de Marketplace) el primer mensaje ya cuenta", () => {
  const decision = decidirSiElChatNecesitaAsesora({ mensajes: [cliente(59, "Hola, ¿cuánto vale la silla?")], primerMensajeEsDeEntrada: false });
  assert.equal(decision.asignar, true);
  assert.equal(chatNecesitaAsesora([cliente(59, "Hola, ¿cuánto vale la silla?")]).asignar, false, "sin dato, el primero es de entrada");
});

test("22-nov: un audio o una foto de la clienta también cuentan; una nota del sistema no", () => {
  const audio: MensajeDelReparto = { direction: "INBOUND", type: "AUDIO", content: null, createdAt: t(61) };
  assert.equal(chatNecesitaAsesora([...comienzo, audio]).asignar, true);
  const notaEntrante: MensajeDelReparto = { direction: "INBOUND", type: "SYSTEM", content: "nota", createdAt: t(61) };
  assert.equal(chatNecesitaAsesora([...comienzo, notaEntrante]).asignar, false);
});

test("22-nov: con el interruptor (b) apagado, lo que escribe la clienta no asigna", () => {
  const decision = decidirSiElChatNecesitaAsesora({ mensajes: [...comienzo, cliente(61, "¿cuánto vale?")], config: { clientaPreguntaPlataOEntrega: false } });
  assert.equal(decision.asignar, false);
});

test("primerMensajeEsDeEntrada: anuncio de Meta, Marketplace o la línea de Marketplace sí; orgánico no", () => {
  assert.equal(primerMensajeEsDeEntrada({ metadataContacto: { adCapturedAt: "2026-11-20T10:00:00Z" } }), true);
  assert.equal(primerMensajeEsDeEntrada({ metadataContacto: { source: "Meta Ads" } }), true);
  assert.equal(primerMensajeEsDeEntrada({ metadataContacto: { origen: { canal: "marketplace" } } }), true);
  assert.equal(primerMensajeEsDeEntrada({ metadataContacto: {}, lineaEsMarketplace: true }), true);
  assert.equal(primerMensajeEsDeEntrada({ metadataContacto: { origen: { canal: "web" } } }), false);
  assert.equal(primerMensajeEsDeEntrada({ metadataContacto: null }), false);
});

test("si el agente pide asesora, se asigna aunque no haya fotos (caso 'Quiropodia' del 11-11)", () => {
  const decision = chatNecesitaAsesora([
    ...comienzo,
    cliente(61, "Quiropodia"),
    nota(61, "El agente pide un asesor: El agente no pudo redactar una respuesta: que conteste una persona"),
  ]);
  assert.equal(decision.asignar, true);
  assert.equal(decision.motivo, "agente_pide_asesora");
});

test("la nota 'El agente pide un asesor' con las fotos mandadas SÍ asigna", () => {
  const decision = chatNecesitaAsesora([...comienzo, foto(62), cliente(63, "ok"), nota(64, "El agente pide un asesor: que conteste una persona")]);
  assert.equal(decision.asignar, true);
  assert.equal(decision.motivo, "agente_pide_asesora");
});

test("frases que NO son plata ni ciudad", () => {
  for (const frase of [ANUNCIO, "estética facial", "masajes", "Me encanta", "Quiero un plato de comida", "Mi meta es abrir mi spa", "Me llamo Florencia", "¿De qué color hay?", "La página no abre", "ok gracias"]) {
    assert.equal(hablaDePlataOEntrega(frase), false, frase);
  }
});

test("un mensaje borrado no cuenta", () => {
  const borrado: MensajeDelReparto = { ...cliente(63, "¿cuánto vale?"), borrado: true };
  assert.equal(chatNecesitaAsesora([...comienzo, foto(62), borrado]).asignar, false);
  assert.equal(chatNecesitaAsesora([...comienzo, borrado]).asignar, false);
});
