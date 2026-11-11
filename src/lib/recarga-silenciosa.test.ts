import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SEGUNDO_PLANO_MINIMO_MS,
  debeRecargarEnSilencio,
  tiempoEnSegundoPlano,
  type EstadoParaRecargar,
} from "./recarga-silenciosa";

const MIN = 60_000;

const oculta = (cambios: Partial<EstadoParaRecargar> = {}): EstadoParaRecargar => ({
  visible: false,
  msEnSegundoPlano: 11 * MIN,
  hayTextoEscrito: false,
  hayEnviosPendientes: false,
  hayVersionNueva: true,
  ...cambios,
});

test("a) 9 minutos en segundo plano: no recarga", () => {
  assert.equal(debeRecargarEnSilencio(oculta({ msEnSegundoPlano: 9 * MIN })), false);
});

test("b) 11 minutos con la barra vacia y version nueva: recarga", () => {
  assert.equal(debeRecargarEnSilencio(oculta()), true);
});

test("c) 11 minutos con texto escrito: no recarga", () => {
  assert.equal(debeRecargarEnSilencio(oculta({ hayTextoEscrito: true })), false);
});

test("d) con texto y luego vaciada, todavia oculta: en la siguiente vuelta si recarga", () => {
  assert.equal(debeRecargarEnSilencio(oculta({ msEnSegundoPlano: 11 * MIN, hayTextoEscrito: true })), false);
  assert.equal(debeRecargarEnSilencio(oculta({ msEnSegundoPlano: 12 * MIN, hayTextoEscrito: false })), true);
});

test("e) a la vista: nunca, aunque haya version nueva y nada escrito", () => {
  assert.equal(debeRecargarEnSilencio(oculta({ visible: true })), false);
  assert.equal(debeRecargarEnSilencio(oculta({ visible: true, msEnSegundoPlano: 60 * MIN })), false);
});

test("f) con un envio pendiente (cola o texto en camino): no recarga", () => {
  assert.equal(debeRecargarEnSilencio(oculta({ hayEnviosPendientes: true })), false);
});

test("g) sin version nueva: no recarga", () => {
  assert.equal(debeRecargarEnSilencio(oculta({ hayVersionNueva: false })), false);
});

test("h) exactamente 10 minutos no alcanza: tiene que ser MAS", () => {
  assert.equal(debeRecargarEnSilencio(oculta({ msEnSegundoPlano: SEGUNDO_PLANO_MINIMO_MS })), false);
  assert.equal(debeRecargarEnSilencio(oculta({ msEnSegundoPlano: SEGUNDO_PLANO_MINIMO_MS + 1 })), true);
  assert.equal(debeRecargarEnSilencio(oculta({ msEnSegundoPlano: Number.NaN })), false);
});

test("i) una sola vez por version: si ya recargo por esta, no vuelve a recargar", () => {
  assert.equal(debeRecargarEnSilencio(oculta({ yaSeRecargoPorEstaVersion: true })), false);
});

test("j) tiempo en segundo plano: 0 a la vista o con reloj corrido para atras", () => {
  assert.equal(tiempoEnSegundoPlano(null, 1_000), 0);
  assert.equal(tiempoEnSegundoPlano(5_000, 1_000), 0);
  assert.equal(tiempoEnSegundoPlano(1_000, 1_000 + 11 * MIN), 11 * MIN);
});
