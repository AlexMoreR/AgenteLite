// Pruebas de "una tarjeta que vuelve a un estado abierto se desarchiva sola" (regla del cliente de la base). Sin base ni red.
// Desde el 8-nov-2026 el archivado de las HECHO va aparte (archivadas.ts: archivarAlTerminar; npm run test:tablero-archivadas).
// Correr: npm run test:tablero-archivar-al-terminar
import assert from "node:assert/strict";
import { test } from "node:test";
import { conDesarchivadoAlReabrir } from "./archivar-al-terminar";

/** Los datos que quedan, sin importar la forma exacta de la escritura. */
const datosDe = (resultado: unknown) => (resultado as { data: Record<string, unknown> }).data;

test("HECHO no se archiva aquí: va aparte, después de guardar (y una madre con hijas abiertas se queda)", () => {
  const args = { where: { id: "t1" }, data: { estado: "HECHO", trabajoVenceEn: null } };
  assert.equal(conDesarchivadoAlReabrir("TarjetaTablero", "updateMany", args), args);
  const conSet = { where: { id: "t1" }, data: { estado: { set: "HECHO" } } };
  assert.equal(conDesarchivadoAlReabrir("TarjetaTablero", "update", conSet), conSet);
});

test("FALLIDO no se toca: sigue con sus 3 días", () => {
  const args = { where: { id: "t1" }, data: { estado: "FALLIDO" } };
  assert.equal(conDesarchivadoAlReabrir("TarjetaTablero", "updateMany", args), args);
});

test("las ediciones sin estado no se tocan", () => {
  for (const data of [{ titulo: "otro" }, { urgente: true }]) {
    const args = { where: { id: "t1" }, data };
    assert.equal(conDesarchivadoAlReabrir("TarjetaTablero", "updateMany", args), args);
  }
});

test("un estado abierto la desarchiva (reabrir, reintentar, deshacer)", () => {
  for (const estado of ["EN_CURSO", "IDEA", "ERROR", "POR_REVISAR", "APROBADO"]) {
    const resultado = conDesarchivadoAlReabrir("TarjetaTablero", "updateMany", { where: {}, data: { estado } });
    assert.equal(datosDe(resultado).archivadaEn, null, estado);
    assert.equal(datosDe(resultado).terminadaEn, null, estado);
  }
  const conSet = conDesarchivadoAlReabrir("TarjetaTablero", "update", { where: {}, data: { estado: { set: "EN_CURSO" } } });
  assert.equal(datosDe(conSet).archivadaEn, null);
  // Si ya lo dice la escritura (alReabrir), se respeta.
  const propio = { where: {}, data: { estado: "EN_CURSO", archivadaEn: null, terminadaEn: null } };
  assert.equal(conDesarchivadoAlReabrir("TarjetaTablero", "updateMany", propio), propio);
});

test("otro modelo u otra operación no se tocan", () => {
  const args = { where: {}, data: { estado: "EN_CURSO" } };
  assert.equal(conDesarchivadoAlReabrir("Conversation", "updateMany", args), args);
  assert.equal(conDesarchivadoAlReabrir("TarjetaTablero", "create", args), args);
  assert.equal(conDesarchivadoAlReabrir("TarjetaTablero", "findMany", args), args);
  assert.equal(conDesarchivadoAlReabrir(undefined, "updateMany", args), args);
});

test("argumentos raros no lanzan", () => {
  assert.equal(conDesarchivadoAlReabrir("TarjetaTablero", "updateMany", undefined), undefined);
  assert.equal(conDesarchivadoAlReabrir("TarjetaTablero", "updateMany", { where: {} }).where !== undefined, true);
});
