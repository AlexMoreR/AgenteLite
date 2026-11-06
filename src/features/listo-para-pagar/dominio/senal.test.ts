// Pruebas de la señal "Listo para pagar". Correr: npm run test:listo-para-pagar
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  TITULO_PARA_EL_LIDER,
  armarAvisoParaElLider,
  armarEncabezadoDelAviso,
  decidirMarca,
  esListoParaPagar,
  mensajeDeCierre,
  mitadDelPrecio,
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

/* Parte 3: pasarle el aviso al líder a los 5 minutos sin respuesta. */
const AVISADO = new Date("2026-11-06T15:00:00.000Z");
const minutosDespues = (min: number) => new Date(AVISADO.getTime() + min * 60_000);
const base = { estado: "pendiente", avisadoEn: AVISADO, huboRespuestaHumana: false, enHorario: true };

test("con 4 minutos no escala; con 5 sí", () => {
  assert.equal(decidirMarca({ ...base, ahora: minutosDespues(4) }), "nada");
  assert.equal(decidirMarca({ ...base, ahora: minutosDespues(5) }), "escalar");
});

test("con respuesta humana queda atendido y no escala", () => {
  assert.equal(decidirMarca({ ...base, ahora: minutosDespues(6), huboRespuestaHumana: true }), "atendido");
});

test("no escala si ya está escalado (ni otro estado)", () => {
  assert.equal(decidirMarca({ ...base, estado: "escalado", ahora: minutosDespues(6) }), "nada");
  assert.equal(decidirMarca({ ...base, estado: "sin_destino", ahora: minutosDespues(6) }), "nada");
});

test("fuera de horario no escala y sigue pendiente", () => {
  assert.equal(decidirMarca({ ...base, ahora: minutosDespues(30), enHorario: false }), "nada");
});

test("a más de 24 h se cierra, aunque sea fuera de horario", () => {
  assert.equal(decidirMarca({ ...base, ahora: minutosDespues(24 * 60 + 1) }), "cerrar");
  assert.equal(decidirMarca({ ...base, ahora: minutosDespues(24 * 60 + 1), enHorario: false }), "cerrar");
});

test("el aviso al líder trae título, cliente, asesora, enlace y cierre", () => {
  const texto = armarAvisoParaElLider({
    cliente: "Ana",
    asesora: "Laura",
    enlace: "https://app.aizenbot.com/c/1234",
    cierre: mensajeDeCierre(989000),
  });
  assert.equal(texto.split("\n")[0], `*${TITULO_PARA_EL_LIDER}*`);
  assert.equal(TITULO_PARA_EL_LIDER, "🔥 LISTO PARA PAGAR — sin respuesta en 5 min");
  assert.ok(texto.includes("👤 Ana"));
  assert.ok(texto.includes("Asesora: Laura"));
  assert.ok(texto.includes("https://app.aizenbot.com/c/1234"));
  assert.ok(texto.includes("494.500"));
  assert.ok(armarAvisoParaElLider({ cliente: "Ana", asesora: null, enlace: "x", cierre: "y" }).includes("nadie todavía"));
});
