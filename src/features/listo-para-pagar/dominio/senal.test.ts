// Pruebas de la señal "Listo para pagar". Correr: npm run test:listo-para-pagar
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  armarAvisoParaElLider,
  armarEncabezadoDelAviso,
  decidirMarca,
  esListoParaPagar,
  mensajeDeCierre,
  mitadDelPrecio,
  TITULO_PARA_EL_LIDER,
} from "./senal";

test("los motivos de señal de compra dan true", () => {
  assert.equal(esListoParaPagar("Dijo para cuándo lo necesita: señal de compra…"), true);
  assert.equal(esListoParaPagar("Quiere separar o comprar el combo…"), true);
  assert.equal(esListoParaPagar("El cliente entregó datos de compra"), true);
  assert.equal(esListoParaPagar("Pidió la cuenta para consignar…"), true);
  assert.equal(esListoParaPagar("SEÑAL DE COMPRA"), true);
});

test("los motivos normales dan false", () => {
  assert.equal(esListoParaPagar("El cliente pidió hablar con una persona"), false);
  assert.equal(esListoParaPagar("Zona sin cobertura"), false);
  assert.equal(esListoParaPagar("El cliente escribió hace 20 minutos y nadie le ha respondido"), false);
  assert.equal(esListoParaPagar(""), false);
});

test("la mitad del precio con formato colombiano", () => {
  assert.equal(mitadDelPrecio(989000), "494.500");
  assert.equal(mitadDelPrecio(1001), "501");
  assert.equal(mitadDelPrecio(Number.NaN), null);
  assert.equal(mitadDelPrecio(0), null);
  assert.equal(mitadDelPrecio(null), null);
});

test("el mensaje de cierre con cifra y sin cifra", () => {
  assert.equal(
    mensajeDeCierre(989000),
    "¡Listo! Te lo aparto con el 50 % (494.500) y el resto antes del despacho. Te paso la cuenta: ¿en qué color lo quieres?",
  );
  assert.equal(
    mensajeDeCierre(null),
    "¡Listo! Te lo aparto con el 50 % y el resto antes del despacho. Te paso la cuenta: ¿en qué color lo quieres?",
  );
  assert.equal(mensajeDeCierre(Number.NaN), mensajeDeCierre(null));
});

test("el encabezado del aviso", () => {
  const normal = armarEncabezadoDelAviso({ cliente: "Ana", telefono: "573001112233", motivo: "Zona sin cobertura" });
  assert.equal(normal[0], "🔔 *Necesita atención*");
  assert.deepEqual(normal.slice(1), ["", "👤 Ana", "📱 573001112233", "📌 Zona sin cobertura"]);
  const listo = armarEncabezadoDelAviso({
    cliente: "Ana",
    telefono: "573001112233",
    motivo: "Quiere separar o comprar el combo",
  });
  assert.equal(listo[0], "🔥 *LISTO PARA PAGAR*");
});

// ---- Parte 3: pasarle el aviso al líder a los 5 minutos sin respuesta ----

const AVISADO = new Date("2026-11-04T15:00:00.000Z"); // miércoles 10 a. m. en Bogotá
const minutosDespues = (minutos: number) => new Date(AVISADO.getTime() + minutos * 60_000);
const marca = (cambios: Partial<Parameters<typeof decidirMarca>[0]> = {}) =>
  decidirMarca({
    estado: "pendiente",
    avisadoEn: AVISADO,
    ahora: minutosDespues(5),
    huboRespuestaHumana: false,
    enHorario: true,
    ...cambios,
  });

test("con 4 minutos no escala; con 5 sí", () => {
  assert.equal(marca({ ahora: minutosDespues(4) }), "nada");
  assert.equal(marca({ ahora: minutosDespues(5) }), "escalar");
});

test("con respuesta humana queda atendido y no escala", () => {
  assert.equal(marca({ huboRespuestaHumana: true }), "atendido");
});

test("no escala si ya está escalado, ni fuera de horario", () => {
  assert.equal(marca({ estado: "escalado" }), "nada");
  assert.equal(marca({ estado: "sin_destino" }), "nada");
  assert.equal(marca({ enHorario: false }), "nada");
});

test("a más de 24 h se cierra, aunque sea fuera de horario", () => {
  assert.equal(marca({ ahora: minutosDespues(24 * 60 + 1) }), "cerrar");
  assert.equal(marca({ ahora: minutosDespues(24 * 60 + 1), enHorario: false }), "cerrar");
});

test("el aviso para el líder", () => {
  const texto = armarAvisoParaElLider({
    cliente: "Ana",
    asesora: "Luisa",
    enlace: "https://app.aizenbot.com/c/1234",
    cierre: "¡Listo! Te lo aparto",
  });
  assert.equal(TITULO_PARA_EL_LIDER, "🔥 LISTO PARA PAGAR — sin respuesta en 5 min");
  assert.ok(texto.startsWith(`*${TITULO_PARA_EL_LIDER}*`));
  assert.ok(texto.includes("👤 Ana"));
  assert.ok(texto.includes("Luisa"));
  assert.ok(texto.includes("https://app.aizenbot.com/c/1234"));
  assert.ok(texto.endsWith("¡Listo! Te lo aparto"));
  assert.ok(armarAvisoParaElLider({ cliente: "Ana", asesora: null, enlace: "x", cierre: "y" }).includes("nadie todavía"));
});
