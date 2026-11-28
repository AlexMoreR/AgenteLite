import { test } from "node:test";
import assert from "node:assert/strict";

import {
  COLUMNAS_INICIALES,
  agregarColumna,
  esTipoBaseDeDatos,
  leerColumnas,
  quitarColumna,
  renombrarColumna,
  valoresParaGuardar,
} from "./reglas-base-de-datos";

test("reconoce el tipo Base de datos sin mirar mayúsculas", () => {
  assert.equal(esTipoBaseDeDatos("Base de datos"), true);
  assert.equal(esTipoBaseDeDatos(" base de DATOS "), true);
  assert.equal(esTipoBaseDeDatos("Área"), false);
  assert.equal(esTipoBaseDeDatos(null), false);
});

test("nace con dos columnas de texto (el # va aparte)", () => {
  assert.deepEqual(COLUMNAS_INICIALES.map((columna) => columna.nombre), ["Columna 1", "Columna 2"]);
});

test("agregar una columna le da un id nuevo y no deja repetir el nombre", () => {
  const { columnas, nueva } = agregarColumna(COLUMNAS_INICIALES, "  Teléfono ");
  assert.deepEqual(nueva, { id: "c3", nombre: "Teléfono" });
  assert.equal(columnas.length, 3);
  assert.throws(() => agregarColumna(columnas, "telefono"), /Ya hay una columna/);
  assert.throws(() => agregarColumna(columnas, "   "), /necesita un nombre/);
  assert.throws(() => agregarColumna(columnas, "#"), /Ya hay una columna/);
});

test("el id nuevo sale del mayor que queda (al quitar una columna se borran sus valores de las filas)", () => {
  const con3 = agregarColumna(COLUMNAS_INICIALES, "Ciudad").columnas;
  const sin3 = quitarColumna(con3, "c3");
  assert.equal(agregarColumna(sin3, "Otra").nueva.id, "c3");
  const sin1 = quitarColumna(con3, "c1");
  assert.equal(agregarColumna(sin1, "Otra").nueva.id, "c4");
});

test("renombrar deja el mismo nombre en la misma columna y no choca con otra", () => {
  assert.equal(renombrarColumna(COLUMNAS_INICIALES, "c1", "Nombre")[0].nombre, "Nombre");
  assert.equal(renombrarColumna(COLUMNAS_INICIALES, "c1", "columna 1")[0].nombre, "columna 1");
  assert.throws(() => renombrarColumna(COLUMNAS_INICIALES, "c1", "Columna 2"), /Ya hay una columna/);
  assert.throws(() => renombrarColumna(COLUMNAS_INICIALES, "c9", "X"), /ya no existe/);
});

test("no deja la base sin columnas", () => {
  const una = quitarColumna(COLUMNAS_INICIALES, "c1");
  assert.throws(() => quitarColumna(una, "c2"), /al menos una columna/);
});

test("los valores se guardan por id, aceptando el nombre de la columna", () => {
  assert.deepEqual(valoresParaGuardar(COLUMNAS_INICIALES, { "columna 1": "Ana", c2: 12 }), { c1: "Ana", c2: "12" });
  assert.throws(() => valoresParaGuardar(COLUMNAS_INICIALES, { Ciudad: "Pasto" }), /No hay una columna «Ciudad»/);
  assert.throws(() => valoresParaGuardar(COLUMNAS_INICIALES, ["x"]), /Cada fila/);
});

test("leerColumnas descarta lo que no sirve", () => {
  assert.deepEqual(leerColumnas([{ id: "c1", nombre: "A" }, { id: "c1", nombre: "B" }, { nombre: "C" }, null, "x"]), [
    { id: "c1", nombre: "A" },
  ]);
  assert.deepEqual(leerColumnas(null), []);
});
