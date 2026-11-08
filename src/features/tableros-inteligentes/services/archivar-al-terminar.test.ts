// Pruebas de "una tarjeta que pasa a HECHO se archiva al instante" (T-691). Sin base ni red.
// Correr: npm run test:tablero-archivar-al-terminar
import assert from "node:assert/strict";
import { test } from "node:test";
import { conArchivadoAlTerminar } from "./archivar-al-terminar";

const AHORA = new Date("2026-11-07T15:00:00Z");

/** Los datos que quedan, sin importar la forma exacta de la escritura. */
const datosDe = (resultado: unknown) => (resultado as { data: Record<string, unknown> }).data;

test("HECHO: se archiva y queda con la fecha en que terminó", () => {
  const args = { where: { id: "t1" }, data: { estado: "HECHO", trabajoVenceEn: null } };
  const resultado = conArchivadoAlTerminar("TarjetaTablero", "updateMany", args, AHORA);
  assert.deepEqual(resultado.data, { estado: "HECHO", trabajoVenceEn: null, archivadaEn: AHORA, terminadaEn: AHORA });
  assert.deepEqual(resultado.where, { id: "t1" });
});

test("HECHO con update y con la forma { set }", () => {
  const uno = conArchivadoAlTerminar("TarjetaTablero", "update", { where: { id: "t1" }, data: { estado: { set: "HECHO" } } }, AHORA);
  assert.equal(datosDe(uno).archivadaEn, AHORA);
});

test("FALLIDO no se archiva al instante: sigue con sus 3 días", () => {
  const args = { where: { id: "t1" }, data: { estado: "FALLIDO" } };
  assert.equal(conArchivadoAlTerminar("TarjetaTablero", "updateMany", args, AHORA), args);
});

test("las ediciones sin estado no se tocan", () => {
  for (const data of [{ titulo: "otro" }, { urgente: true }]) {
    const args = { where: { id: "t1" }, data };
    assert.equal(conArchivadoAlTerminar("TarjetaTablero", "updateMany", args, AHORA), args);
  }
});

test("un estado abierto la desarchiva (reabrir, reintentar, deshacer)", () => {
  for (const estado of ["EN_CURSO", "IDEA", "ERROR", "POR_REVISAR", "APROBADO"]) {
    const resultado = conArchivadoAlTerminar("TarjetaTablero", "updateMany", { where: {}, data: { estado } }, AHORA);
    assert.equal(datosDe(resultado).archivadaEn, null, estado);
    assert.equal(datosDe(resultado).terminadaEn, null, estado);
  }
  // Si ya lo dice la escritura (alReabrir), se respeta.
  const propio = { where: {}, data: { estado: "EN_CURSO", archivadaEn: null, terminadaEn: null } };
  assert.equal(conArchivadoAlTerminar("TarjetaTablero", "updateMany", propio, AHORA), propio);
});

test("si la escritura ya trae archivadaEn (el reloj, desarchivar) se respeta", () => {
  const args = { where: { id: "t1" }, data: { estado: "HECHO", archivadaEn: null } };
  assert.equal(conArchivadoAlTerminar("TarjetaTablero", "updateMany", args, AHORA), args);
});

test("si ya trae terminadaEn, esa fecha se conserva", () => {
  const antes = new Date("2026-11-01T12:00:00Z");
  const resultado = conArchivadoAlTerminar("TarjetaTablero", "updateMany", { where: {}, data: { estado: "HECHO", terminadaEn: antes } }, AHORA);
  assert.equal(datosDe(resultado).terminadaEn, antes);
  assert.equal(datosDe(resultado).archivadaEn, AHORA);
});

test("otro modelo u otra operación no se tocan", () => {
  const args = { where: {}, data: { estado: "HECHO" } };
  assert.equal(conArchivadoAlTerminar("Conversation", "updateMany", args, AHORA), args);
  assert.equal(conArchivadoAlTerminar("TarjetaTablero", "create", args, AHORA), args);
  assert.equal(conArchivadoAlTerminar("TarjetaTablero", "findMany", args, AHORA), args);
  assert.equal(conArchivadoAlTerminar(undefined, "updateMany", args, AHORA), args);
});

test("argumentos raros no lanzan", () => {
  assert.equal(conArchivadoAlTerminar("TarjetaTablero", "updateMany", undefined, AHORA), undefined);
  assert.equal(conArchivadoAlTerminar("TarjetaTablero", "updateMany", { where: {} }, AHORA).where !== undefined, true);
});
