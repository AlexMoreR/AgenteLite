// Aviso "te paso con una asesora" (12-nov-2026). Correr: npm run test:reparto-aviso-a-la-clienta
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  debeAvisarPasoAAsesora,
  TEXTO_AVISO_PASO_A_ASESORA,
  type EntradaDelAviso,
  type MensajeDelAviso,
} from "./reparto-aviso-a-la-clienta";

// Hora de Bogotá (UTC-5) del 12-nov-2026.
const t = (hora: number, minuto: number, segundo = 0) => new Date(Date.UTC(2026, 10, 12, hora + 5, minuto, segundo));
const cliente = (en: Date, texto: string, externalId?: string): MensajeDelAviso => ({ direccion: "IN", tipo: "TEXT", origen: null, texto, en, externalId });
const bot = (en: Date, texto: string): MensajeDelAviso => ({ direccion: "OUT", tipo: "TEXT", origen: null, texto, en });
const foto = (en: Date): MensajeDelAviso => ({ direccion: "OUT", tipo: "IMAGE", origen: null, texto: null, en });
const nota = (en: Date, texto: string): MensajeDelAviso => ({ direccion: "OUT", tipo: "SYSTEM", origen: "activity", texto, en });
const asesora = (en: Date, texto: string): MensajeDelAviso => ({ direccion: "OUT", tipo: "TEXT", origen: "manual", texto, en });

// El chat real del 12-nov (sin teléfono ni nombre): pidió fotos y precio a las 12:08.
const turnoDeLas1208 = [
  cliente(t(12, 1), "Hola, me interesa el combo de estética"),
  bot(t(12, 1, 20), "Bienvenid@ a *Magilus* 👑"),
  bot(t(12, 1, 25), "¿Qué servicios vas a ofrecer en tu espacio?"),
  cliente(t(12, 8), "Fotos y precio por favor", "msg-1208"),
  nota(t(12, 8, 15), "María auto-asignado a esta conversación"),
  bot(t(12, 8, 20), "Este es nuestro combo de estética 💆"),
  foto(t(12, 8, 25)),
  foto(t(12, 8, 30)),
  foto(t(12, 8, 35)),
];

const entrada = (cambios: Partial<EntradaDelAviso> = {}): EntradaDelAviso => ({
  asignada: true,
  lineaDeVentas: true,
  primeraAsignacionEn: t(12, 8, 15),
  yaSeMando: false,
  mensajes: turnoDeLas1208,
  externalIdDeEstePaso: "msg-1208",
  ...cambios,
});

test("el texto es el que pidió el dueño y no nombra a nadie", () => {
  assert.equal(TEXTO_AVISO_PASO_A_ASESORA, "Te paso con una asesora para que te ayude a separar tu combo. Ya te escribe 🙌");
});

test("caso 1: se asigna en este turno después de las fotos → avisa", () => {
  assert.deepEqual(debeAvisarPasoAAsesora(entrada()), { avisar: true, motivo: "avisar" });
});

test("caso 2: reasignación por demora (ya había una nota de asignado antes) → no avisa", () => {
  const mensajes = [...turnoDeLas1208, cliente(t(12, 20), "¿Hacen envíos?", "msg-1220"), nota(t(12, 20, 5), "Génesis asignado por demora"), bot(t(12, 20, 10), "Sí, enviamos a todo el país")];
  const decision = debeAvisarPasoAAsesora(entrada({ mensajes, externalIdDeEstePaso: "msg-1220" }));
  assert.deepEqual(decision, { avisar: false, motivo: "asignado_antes" });
});

test("caso 3: ya avisado (el texto ya está en el chat) → no avisa", () => {
  const decision = debeAvisarPasoAAsesora(entrada({ yaSeMando: true, mensajes: [...turnoDeLas1208, bot(t(12, 8, 40), TEXTO_AVISO_PASO_A_ASESORA)] }));
  assert.deepEqual(decision, { avisar: false, motivo: "ya_avisado" });
});

test("caso 4: una persona escribió → no avisa", () => {
  const mensajes = [...turnoDeLas1208.slice(0, 5), asesora(t(12, 8, 18), "Hola, soy de Magilus, ya te ayudo"), ...turnoDeLas1208.slice(5)];
  assert.deepEqual(debeAvisarPasoAAsesora(entrada({ mensajes })), { avisar: false, motivo: "escribio_una_persona" });
  // También si escribió desde el celular de la línea.
  const celular = [...turnoDeLas1208, { ...asesora(t(12, 8, 38), "Ya te escribo"), origen: "instance" }];
  assert.equal(debeAvisarPasoAAsesora(entrada({ mensajes: celular })).avisar, false);
});

test("caso 5: tanda cedida (el último mensaje es de la clienta) → no avisa", () => {
  const cedida = [...turnoDeLas1208.slice(0, 5), cliente(t(12, 8, 12), "Y en qué colores hay", "msg-120812")];
  assert.deepEqual(
    debeAvisarPasoAAsesora(entrada({ mensajes: cedida, primeraAsignacionEn: t(12, 8, 15), externalIdDeEstePaso: "msg-1208" })),
    { avisar: false, motivo: "otro_paso_de_la_tanda" },
  );
  // El paso que sí contestó la tanda, pero el bot todavía no respondió: tampoco.
  assert.deepEqual(
    debeAvisarPasoAAsesora(entrada({ mensajes: cedida, primeraAsignacionEn: t(12, 8, 15), externalIdDeEstePaso: "msg-120812" })),
    { avisar: false, motivo: "bot_no_ha_respondido" },
  );
});

test("caso 6: el chat no tiene asesora → no avisa", () => {
  assert.deepEqual(debeAvisarPasoAAsesora(entrada({ asignada: false, primeraAsignacionEn: null })), { avisar: false, motivo: "sin_asesora" });
  assert.deepEqual(debeAvisarPasoAAsesora(entrada({ lineaDeVentas: false })), { avisar: false, motivo: "no_es_ventas" });
});

test("caso 7: chat asignado ayer en el que la clienta vuelve a escribir → no avisa", () => {
  const ayer = new Date(t(12, 8).getTime() - 24 * 60 * 60 * 1000);
  const mensajes = [nota(ayer, "María auto-asignado a esta conversación"), ...turnoDeLas1208.slice(3).filter((m) => m.tipo !== "SYSTEM")];
  assert.deepEqual(debeAvisarPasoAAsesora(entrada({ mensajes, primeraAsignacionEn: ayer })), { avisar: false, motivo: "asignado_antes" });
});

test("si el bot ya dijo en esta respuesta que pasa con una asesora, se omite", () => {
  const mensajes = [...turnoDeLas1208, bot(t(12, 8, 40), "En un momento una de nuestras asesoras te contacta 🙌")];
  assert.deepEqual(debeAvisarPasoAAsesora(entrada({ mensajes })), { avisar: false, motivo: "bot_ya_dijo_asesora" });
});

test("sin nota de asignación no se avisa (chats asignados sin registro)", () => {
  assert.deepEqual(debeAvisarPasoAAsesora(entrada({ primeraAsignacionEn: null })), { avisar: false, motivo: "sin_nota_de_asignacion" });
});

test("un seguimiento automático al final no cuenta como respuesta del bot", () => {
  const mensajes = [...turnoDeLas1208, { ...bot(t(12, 9), "¿Pudiste ver las fotos?"), origen: "agente-v3-seguimiento" }];
  assert.deepEqual(debeAvisarPasoAAsesora(entrada({ mensajes })), { avisar: false, motivo: "bot_no_ha_respondido" });
});
