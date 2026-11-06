import { test } from "node:test";
import assert from "node:assert/strict";

import { armarEncabezadoDelAviso, esListoParaPagar, mensajeDeCierre, mitadDelPrecio } from "./senal";

test("los motivos de señal de compra dan true", () => {
  assert.equal(esListoParaPagar("Dijo para cuándo lo necesita: señal de compra, cerrar ya"), true);
  assert.equal(esListoParaPagar("Quiere separar o comprar el combo de la sala"), true);
  assert.equal(esListoParaPagar("El cliente entregó datos de compra"), true);
  assert.equal(esListoParaPagar("Pidió la cuenta para consignar el anticipo"), true);
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
  assert.equal(mitadDelPrecio(0), null);
  assert.equal(mitadDelPrecio(Number.NaN), null);
  assert.equal(mitadDelPrecio(null), null);
});

test("el mensaje de cierre con y sin precio", () => {
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
  const compra = armarEncabezadoDelAviso({ cliente: "Ana", telefono: "573001112233", motivo: "Señal de compra" });
  assert.equal(compra[0], "🔥 *LISTO PARA PAGAR*");
});
