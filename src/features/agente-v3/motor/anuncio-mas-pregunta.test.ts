// Llega del anuncio y ademas pregunta algo (chat 573162585763, 10-nov-2026). Correr: npm run test:agente-v3-anuncio
import assert from "node:assert/strict";
import { test } from "node:test";

import type { LibroDeReglas, ReglaV3 } from "../domain/reglas";
import { decidir, type EstadoDeLaCharla } from "./decidir";

const BIENVENIDA = "evolution:canal:workflow-bienvenida-general";
const COMBO = "producto-combo";
const ANUNCIO = "Hola, me interesa el COMBO de estética (camilla, escalera, silla y auxiliar)";

const reglas: ReglaV3[] = [
  {
    id: "saludo",
    nombre: "Solo saluda sin decir qué busca: Bienvenida General + preguntar la referencia",
    activa: true,
    cuando: { tipo: "frase", exacta: true, frases: ["hola", "buenas tardes"] },
    entonces: [{ tipo: "flujo", flujoId: BIENVENIDA, titulo: "Bienvenida General" }],
  },
  {
    id: "portatil",
    nombre: "Pregunta por la camilla portátil: pasar a un asesor",
    activa: true,
    cuando: { tipo: "frase", frases: ["portatil", "plegable"] },
    entonces: [
      { tipo: "mensaje", texto: "¡Claro que sí! También manejamos camilla portátil. Una asesora te confirma el precio." },
      { tipo: "activar_producto", productoId: COMBO, nombre: "Combo Camillas" },
      { tipo: "avisar_asesor", motivo: "Preguntó por camilla portátil" },
      { tipo: "pausar_ia" },
    ],
  },
  {
    id: "lavacabezas",
    nombre: "Pide el lavacabezas",
    activa: true,
    cuando: { tipo: "frase", frases: ["lavacabezas"] },
    entonces: [{ tipo: "mensaje", texto: "Te muestro los lavacabezas." }],
  },
  {
    id: "cierre",
    nombre: "Cierre: pedir los datos (pasa a la asesora)",
    activa: true,
    cuando: { tipo: "frase", frases: ["lo quiero"] },
    entonces: [
      { tipo: "mensaje", texto: "¡Perfecto! Te pido tus datos." },
      { tipo: "ir_al_paso", paso: "CIERRE" },
      { tipo: "avisar_asesor", motivo: "Quiere comprar" },
      { tipo: "pausar_ia" },
    ],
  },
  {
    id: "anuncio",
    nombre: "Llega del anuncio del combo (texto exacto del anuncio): Bienvenida General",
    activa: true,
    cuando: { tipo: "frase", exacta: true, frases: [ANUNCIO] },
    soloSi: { noSiYaSeEnvio: BIENVENIDA },
    entonces: [
      { tipo: "flujo", flujoId: BIENVENIDA, titulo: "Bienvenida General" },
      { tipo: "activar_producto", productoId: COMBO, nombre: "Combo Camillas" },
      { tipo: "ir_al_paso", paso: "PRESENTACION" },
    ],
  },
  {
    id: "paso1",
    nombre: "Paso 1 del Combo: qué servicios va a ofrecer",
    activa: true,
    cuando: { tipo: "paso", producto: COMBO, paso: "PRESENTACION" },
    entonces: [{ tipo: "mensaje", texto: "¿Qué servicios vas a ofrecer en tu espacio?" }],
  },
  {
    id: "paso-cierre",
    nombre: "Paso Cierre del Combo",
    activa: true,
    cuando: { tipo: "paso", producto: COMBO, paso: "CIERRE" },
    entonces: [{ tipo: "mensaje", texto: "¿A qué nombre dejamos el pedido?" }],
  },
] as ReglaV3[];

const libro: LibroDeReglas = { version: 1, actualizadoEl: "", comoHablamos: "", reglas };
const primerMensaje: EstadoDeLaCharla = { productoActivo: null, pasoActual: null, flujosEnviados: [], esPrimerMensaje: true };
const tipos = (d: ReturnType<typeof decidir>) => [...d.saludo, ...d.acciones].map((a) => a.tipo);
const textos = (d: ReturnType<typeof decidir>) =>
  [...d.saludo, ...d.acciones].flatMap((a) => (a.tipo === "mensaje" ? [a.texto] : a.tipo === "flujo" ? [`flujo:${a.titulo}`] : []));

test("el texto del anuncio + una pregunta: primero la bienvenida y despues la respuesta a lo que pregunto", () => {
  const d = decidir({ libro, mensaje: `${ANUNCIO} disculpa tienes la camilla portátil.?`, estado: primerMensaje });
  assert.equal(d.regla?.id, "anuncio");
  assert.deepEqual(textos(d), [
    "flujo:Bienvenida General",
    "¡Claro que sí! También manejamos camilla portátil. Una asesora te confirma el precio.",
  ]);
  assert.ok(tipos(d).includes("avisar_asesor"));
  assert.ok(tipos(d).includes("pausar_ia"));
  assert.ok(!textos(d).includes("¿Qué servicios vas a ofrecer en tu espacio?"), "si pasa a la asesora, no pregunta mas");
  assert.equal(tipos(d).filter((t) => t === "activar_producto").length, 1, "el combo se activa una sola vez");
});

test("el texto del anuncio solo, como siempre: bienvenida y la pregunta del paso 1", () => {
  const d = decidir({ libro, mensaje: ANUNCIO, estado: primerMensaje });
  assert.equal(d.regla?.id, "anuncio");
  assert.deepEqual(textos(d), ["flujo:Bienvenida General", "¿Qué servicios vas a ofrecer en tu espacio?"]);
});

test("el texto del anuncio + algo que no pasa a asesora: bienvenida y paso 1 (como si fuera solo el anuncio)", () => {
  const d = decidir({ libro, mensaje: `${ANUNCIO} muchas gracias`, estado: primerMensaje });
  assert.equal(d.regla?.id, "anuncio");
  assert.deepEqual(textos(d), ["flujo:Bienvenida General", "¿Qué servicios vas a ofrecer en tu espacio?"]);
});

test("una frase exacta CORTA sigue pidiendo el mensaje entero: 'hola, quiero el lavacabezas' no es 'solo saluda'", () => {
  const d = decidir({ libro, mensaje: "Hola, quiero el lavacabezas", estado: primerMensaje });
  assert.equal(d.regla?.id, "lavacabezas");
  const soloHola = decidir({ libro, mensaje: "Hola", estado: primerMensaje });
  assert.equal(soloHola.regla?.id, "saludo");
});

test("cuando pasa a la asesora, el agente no pregunta mas: el cierre no encadena la pregunta de su paso", () => {
  const enElCombo: EstadoDeLaCharla = { productoActivo: COMBO, pasoActual: "PRODUCTO", flujosEnviados: [BIENVENIDA], esPrimerMensaje: false };
  const d = decidir({ libro, mensaje: "Sí, lo quiero", estado: enElCombo });
  assert.equal(d.regla?.id, "cierre");
  assert.deepEqual(textos(d), ["¡Perfecto! Te pido tus datos."]);
  assert.ok(!textos(d).includes("¿A qué nombre dejamos el pedido?"));
});

test("la portatil fuera del primer mensaje: igual que antes (avisa y pausa, sin pregunta del paso)", () => {
  const d = decidir({ libro, mensaje: "y la camilla portátil?", estado: { ...primerMensaje, esPrimerMensaje: false } });
  assert.equal(d.regla?.id, "portatil");
  assert.deepEqual(textos(d), ["¡Claro que sí! También manejamos camilla portátil. Una asesora te confirma el precio."]);
});
