import assert from "node:assert/strict";
import { test } from "node:test";

import {
  contarNuevosAlFinal,
  debeBajarAlFinal,
  debeVerseElBotonDeBajar,
  distanciaAlFinal,
  estaCercaDelFinal,
  leerLlaveDelHilo,
} from "./scroll-del-hilo";

test("abrir el chat siempre baja al final", () => {
  assert.equal(debeBajarAlFinal({ tipo: "abrir" }), true);
});

test("los reintentos de la apertura se cancelan si la asesora ya se movio", () => {
  assert.equal(debeBajarAlFinal({ tipo: "reintento-apertura", asesoraSeMovio: false }), true);
  assert.equal(debeBajarAlFinal({ tipo: "reintento-apertura", asesoraSeMovio: true }), false);
});

test("enviar un mensaje baja al final aunque este arriba", () => {
  assert.equal(debeBajarAlFinal({ tipo: "enviar" }), true);
});

test("entra un mensaje a menos de 100 px del final: baja", () => {
  assert.equal(debeBajarAlFinal({ tipo: "mensaje-nuevo", distancia: 0, asesoraSeMovio: false }), true);
  assert.equal(debeBajarAlFinal({ tipo: "mensaje-nuevo", distancia: 60, asesoraSeMovio: false }), true);
  assert.equal(debeBajarAlFinal({ tipo: "mensaje-nuevo", distancia: 100, asesoraSeMovio: false }), true);
});

test("entra un mensaje con la asesora mas arriba: no se mueve", () => {
  assert.equal(debeBajarAlFinal({ tipo: "mensaje-nuevo", distancia: 101, asesoraSeMovio: false }), false);
  assert.equal(debeBajarAlFinal({ tipo: "mensaje-nuevo", distancia: 900, asesoraSeMovio: false }), false);
  // Y si se movio despues de que se programo la bajada, tampoco.
  assert.equal(debeBajarAlFinal({ tipo: "mensaje-nuevo", distancia: 10, asesoraSeMovio: true }), false);
});

test("crece el contenido con la asesora arriba: nunca baja", () => {
  for (const distancia of [25, 60, 100, 250, 5000]) {
    assert.equal(
      debeBajarAlFinal({ tipo: "crecio-contenido", distancia, asesoraSeMovio: false, enApertura: false }),
      false,
      `a ${distancia} px no debe bajar`,
    );
  }
  // Ni en la apertura, si ella ya toco la rueda o el dedo.
  assert.equal(
    debeBajarAlFinal({ tipo: "crecio-contenido", distancia: 0, asesoraSeMovio: true, enApertura: true }),
    false,
  );
});

test("crece el contenido con la asesora pegada al final o recien abierto: la acompaña", () => {
  assert.equal(
    debeBajarAlFinal({ tipo: "crecio-contenido", distancia: 0, asesoraSeMovio: false, enApertura: false }),
    true,
  );
  assert.equal(
    debeBajarAlFinal({ tipo: "crecio-contenido", distancia: 24, asesoraSeMovio: false, enApertura: false }),
    true,
  );
  assert.equal(
    debeBajarAlFinal({ tipo: "crecio-contenido", distancia: 400, asesoraSeMovio: false, enApertura: true }),
    true,
  );
});

test("distancia al final y boton para bajar", () => {
  assert.equal(distanciaAlFinal({ scrollHeight: 2000, scrollTop: 1300, clientHeight: 700 }), 0);
  assert.equal(distanciaAlFinal({ scrollHeight: 2000, scrollTop: 1000, clientHeight: 700 }), 300);
  assert.equal(distanciaAlFinal({ scrollHeight: 2000, scrollTop: 1400, clientHeight: 700 }), 0);
  assert.equal(estaCercaDelFinal(99), true);
  assert.equal(debeVerseElBotonDeBajar(220), false);
  assert.equal(debeVerseElBotonDeBajar(221), true);
});

test("contador: suma solo mensajes del cliente que entraron al final", () => {
  const antes = [
    { id: "a", direction: "INBOUND" },
    { id: "b", direction: "OUTBOUND" },
  ];
  assert.equal(contarNuevosAlFinal("b", [...antes, { id: "c", direction: "INBOUND" }]), 1);
  assert.equal(
    contarNuevosAlFinal("b", [...antes, { id: "c", direction: "INBOUND" }, { id: "d", direction: "INBOUND" }]),
    2,
  );
  assert.equal(contarNuevosAlFinal("b", [...antes, { id: "c", direction: "OUTBOUND" }]), 0);
});

test("contador: cargar mensajes antiguos no suma", () => {
  const antiguos = [
    { id: "x", direction: "INBOUND" },
    { id: "y", direction: "INBOUND" },
  ];
  const actuales = [
    { id: "a", direction: "INBOUND" },
    { id: "b", direction: "INBOUND" },
  ];
  assert.equal(contarNuevosAlFinal("b", [...antiguos, ...actuales]), 0);
  assert.equal(contarNuevosAlFinal("", actuales), 0);
  assert.equal(contarNuevosAlFinal("b", []), 0);
});

test("contador: si el ultimo anterior ya no esta, cuenta solo el ultimo del cliente", () => {
  assert.equal(contarNuevosAlFinal("optimistic:1", [{ id: "z", direction: "INBOUND" }]), 1);
  assert.equal(contarNuevosAlFinal("optimistic:1", [{ id: "z", direction: "OUTBOUND" }]), 0);
});

test("la llave del hilo se lee aunque el id traiga dos puntos", () => {
  assert.deepEqual(leerLlaveDelHilo("agent:abc|12|m-9"), { chatId: "agent:abc", cantidad: 12, ultimoId: "m-9" });
  assert.deepEqual(leerLlaveDelHilo("empty"), { chatId: "empty", cantidad: 0, ultimoId: "" });
});
