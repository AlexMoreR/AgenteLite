// Pruebas del botón de la regla de demora de asesora. Correr: npm run test:demora-asesora-ajuste
import assert from "node:assert/strict";
import { test } from "node:test";

import { PREFIJO_CONFIG_DEMORA, leerConfigDemoraDeTexto } from "@/features/chats/domain/demora-de-asesora";
import {
  MAXIMO_CAMBIOS_EN_HISTORIAL,
  agregarAlHistorial,
  claveConfigDemora,
  claveHistorialDemora,
  estadoDelBotonDeTexto,
  leerHistorialDemoraDeTexto,
  textoDeConfigNueva,
  validarPedidoDeDemora,
  type CambioDeDemora,
} from "./demora-de-asesora-ajuste";

const prendida = { activo: true, minutosAviso: 5, minutosReasignar: 10 };
const apagada = { ...prendida, activo: false };

test("la clave de la config es la misma que lee la regla; la del historial no la confunde", () => {
  assert.equal(claveConfigDemora("ws1"), `${PREFIJO_CONFIG_DEMORA}ws1`);
  assert.equal(claveHistorialDemora("ws1").startsWith(PREFIJO_CONFIG_DEMORA), false);
});

test("prender guarda activo true y apagar guarda activo false", () => {
  assert.equal(JSON.parse(textoDeConfigNueva(null, prendida)).activo, true);
  assert.equal(JSON.parse(textoDeConfigNueva(JSON.stringify({ activo: true }), apagada)).activo, false);
});

test("se mantienen minutosActiva y las demás claves de la fila", () => {
  const nuevo = JSON.parse(textoDeConfigNueva(JSON.stringify({ activo: false, minutosActiva: 15, otra: "x" }), prendida));
  assert.deepEqual(nuevo, { activo: true, minutosAviso: 5, minutosReasignar: 10, minutosActiva: 15, otra: "x" });
});

test("una fila rota queda bien escrita", () => {
  assert.deepEqual(JSON.parse(textoDeConfigNueva("{roto", prendida)), prendida);
  assert.deepEqual(JSON.parse(textoDeConfigNueva("[1,2]", prendida)), prendida);
});

test("leerConfigDemoraDeTexto lee lo guardado con los mismos valores", () => {
  const texto = textoDeConfigNueva(JSON.stringify({ minutosActiva: 20 }), { activo: true, minutosAviso: 7, minutosReasignar: 12 });
  assert.deepEqual(leerConfigDemoraDeTexto(texto), { activo: true, minutosAviso: 7, minutosReasignar: 12, minutosActiva: 20 });
  assert.deepEqual(estadoDelBotonDeTexto(texto), { activo: true, minutosAviso: 7, minutosReasignar: 12 });
});

test("sin fila o con fila dañada el botón muestra Apagada, 5 y 10", () => {
  assert.deepEqual(estadoDelBotonDeTexto(null), apagada);
  assert.deepEqual(estadoDelBotonDeTexto("{roto"), apagada);
});

test("los minutos válidos se aceptan, también como texto", () => {
  assert.deepEqual(validarPedidoDeDemora({ activo: true, minutosAviso: "5", minutosReasignar: "10" }), { ok: true, estado: prendida });
  assert.deepEqual(validarPedidoDeDemora({ activo: false, minutosAviso: 1, minutosReasignar: 120 }), {
    ok: true,
    estado: { activo: false, minutosAviso: 1, minutosReasignar: 120 },
  });
});

test("los minutos inválidos se rechazan", () => {
  const malos: Array<[unknown, unknown]> = [
    [0, 10],
    [-5, 10],
    [5, 121],
    [5, 500],
    [10, 10],
    [10, 5],
    [5.5, 10],
    ["", 10],
    ["abc", 10],
    [null, 10],
  ];
  for (const [minutosAviso, minutosReasignar] of malos) {
    assert.ok("error" in validarPedidoDeDemora({ activo: true, minutosAviso, minutosReasignar }), `${minutosAviso}/${minutosReasignar}`);
  }
  assert.ok("error" in validarPedidoDeDemora({ activo: "true", minutosAviso: 5, minutosReasignar: 10 }));
});

function cambio(n: number): CambioDeDemora {
  return { en: `2026-11-10T12:00:${String(n % 60).padStart(2, "0")}Z`, quienId: `u${n}`, quienNombre: `Persona ${n}`, antes: apagada, despues: prendida };
}

test("el historial pone primero el cambio nuevo y guarda como máximo 50", () => {
  const viejo = [cambio(1), cambio(2)];
  assert.deepEqual(agregarAlHistorial(viejo, cambio(3)).map((c) => c.quienId), ["u3", "u1", "u2"]);
  const lleno = Array.from({ length: MAXIMO_CAMBIOS_EN_HISTORIAL }, (_, i) => cambio(i));
  const nuevo = agregarAlHistorial(lleno, cambio(99));
  assert.equal(nuevo.length, MAXIMO_CAMBIOS_EN_HISTORIAL);
  assert.equal(nuevo[0].quienId, "u99");
});

test("el historial guardado se lee; JSON roto o entradas raras no rompen", () => {
  const texto = JSON.stringify([cambio(1), { en: "x" }, cambio(2)]);
  assert.deepEqual(leerHistorialDemoraDeTexto(texto).map((c) => c.quienId), ["u1", "u2"]);
  assert.deepEqual(leerHistorialDemoraDeTexto("{roto"), []);
  assert.deepEqual(leerHistorialDemoraDeTexto(null), []);
});
