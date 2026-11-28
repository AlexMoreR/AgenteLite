import { test } from "node:test";
import assert from "node:assert/strict";

import {
  COLUMNAS_INICIALES,
  agregarColumna,
  calzaConElTipo,
  cambiarTipoDeColumna,
  columnasConOpcionesNuevas,
  compararCeldas,
  duplicarColumna,
  esTipoBaseDeDatos,
  fechaNormalizada,
  leerColumnas,
  nombreLibre,
  numeroNormalizado,
  quitarColumna,
  renombrarColumna,
  valoresParaGuardar,
  type ColumnaDeBase,
} from "./reglas-base-de-datos";

test("reconoce el tipo Base de datos sin mirar mayúsculas", () => {
  assert.equal(esTipoBaseDeDatos("Base de datos"), true);
  assert.equal(esTipoBaseDeDatos(" base de DATOS "), true);
  assert.equal(esTipoBaseDeDatos("Área"), false);
  assert.equal(esTipoBaseDeDatos(null), false);
});

test("nace con dos columnas de texto (el # va aparte)", () => {
  assert.deepEqual(
    COLUMNAS_INICIALES.map((columna) => [columna.nombre, columna.tipo]),
    [
      ["Columna 1", "texto"],
      ["Columna 2", "texto"],
    ],
  );
});

test("agregar una columna le da un id nuevo, va donde se pide y no deja repetir el nombre", () => {
  const { columnas, nueva } = agregarColumna(COLUMNAS_INICIALES, "  Teléfono ");
  assert.deepEqual(nueva, { id: "c3", nombre: "Teléfono", tipo: "texto" });
  assert.deepEqual(columnas.map((c) => c.id), ["c1", "c2", "c3"]);
  assert.deepEqual(agregarColumna(COLUMNAS_INICIALES, "A la izquierda", { posicion: 0 }).columnas.map((c) => c.id), ["c3", "c1", "c2"]);
  assert.deepEqual(agregarColumna(COLUMNAS_INICIALES, "En medio", { posicion: 1 }).columnas.map((c) => c.id), ["c1", "c3", "c2"]);
  assert.throws(() => agregarColumna(columnas, "telefono"), /Ya hay una columna/);
  assert.throws(() => agregarColumna(columnas, "   "), /necesita un nombre/);
  assert.throws(() => agregarColumna(columnas, "#"), /Ya hay una columna/);
});

test("el id nuevo sale del mayor que queda (al quitar una columna se borran sus valores de las filas)", () => {
  const con3 = agregarColumna(COLUMNAS_INICIALES, "Ciudad").columnas;
  assert.equal(agregarColumna(quitarColumna(con3, "c3"), "Otra").nueva.id, "c3");
  assert.equal(agregarColumna(quitarColumna(con3, "c1"), "Otra").nueva.id, "c4");
});

test("renombrar deja el mismo nombre en la misma columna y no choca con otra", () => {
  assert.equal(renombrarColumna(COLUMNAS_INICIALES, "c1", "Nombre")[0].nombre, "Nombre");
  assert.equal(renombrarColumna(COLUMNAS_INICIALES, "c1", "columna 1")[0].nombre, "columna 1");
  assert.throws(() => renombrarColumna(COLUMNAS_INICIALES, "c1", "Columna 2"), /Ya hay una columna/);
  assert.throws(() => renombrarColumna(COLUMNAS_INICIALES, "c9", "X"), /ya no existe/);
});

test("no deja la base sin columnas", () => {
  assert.throws(() => quitarColumna(quitarColumna(COLUMNAS_INICIALES, "c1"), "c2"), /al menos una columna/);
});

test("duplicar copia tipo y opciones, a la derecha, con nombre libre", () => {
  const lista: ColumnaDeBase[] = [...COLUMNAS_INICIALES, { id: "c3", nombre: "Estado", tipo: "lista", opciones: ["Listo"] }];
  const { columnas, nueva } = duplicarColumna(lista, "c1");
  assert.deepEqual(columnas.map((c) => c.id), ["c1", "c4", "c2", "c3"]);
  assert.equal(nueva.nombre, "Columna 1 (copia)");
  const otra = duplicarColumna(columnas, "c1").nueva;
  assert.equal(otra.nombre, "Columna 1 (copia 2)");
  const copiaLista = duplicarColumna(lista, "c3").nueva;
  assert.deepEqual([copiaLista.tipo, copiaLista.opciones], ["lista", ["Listo"]]);
  assert.equal(nombreLibre(COLUMNAS_INICIALES), "Columna 3");
});

test("cambiar a lista arma las opciones con lo que ya hay; volver a texto las quita", () => {
  const enLista = cambiarTipoDeColumna(COLUMNAS_INICIALES, "c1", "lista", ["Pasto", " Cali ", "Pasto", ""]);
  assert.deepEqual(enLista[0], { id: "c1", nombre: "Columna 1", tipo: "lista", opciones: ["Pasto", "Cali"] });
  assert.deepEqual(cambiarTipoDeColumna(enLista, "c1", "texto")[0], { id: "c1", nombre: "Columna 1", tipo: "texto" });
  assert.throws(() => cambiarTipoDeColumna(COLUMNAS_INICIALES, "c1", "imagen"), /tipo de columna/);
});

test("números y fechas se normalizan y lo que no calza da error", () => {
  assert.equal(numeroNormalizado(" 1500 "), "1500");
  assert.equal(numeroNormalizado("2,5"), "2.5");
  assert.equal(numeroNormalizado("-3.0"), "-3");
  assert.equal(numeroNormalizado("1.500.000"), null);
  assert.equal(numeroNormalizado("abc"), null);
  assert.equal(fechaNormalizada("2026-11-28"), "2026-11-28");
  assert.equal(fechaNormalizada("28/11/2026"), "2026-11-28");
  assert.equal(fechaNormalizada("31/02/2026"), null);
  const columnas: ColumnaDeBase[] = [
    { id: "c1", nombre: "Valor", tipo: "numero" },
    { id: "c2", nombre: "Día", tipo: "fecha" },
  ];
  assert.deepEqual(valoresParaGuardar(columnas, { Valor: "2,5", dia: "1/12/2026" }), { c1: "2.5", c2: "2026-12-01" });
  assert.deepEqual(valoresParaGuardar(columnas, { Valor: "", c2: "  " }), { c1: "", c2: "" });
  assert.throws(() => valoresParaGuardar(columnas, { Valor: "mucho" }), /no es un número/);
  assert.throws(() => valoresParaGuardar(columnas, { c2: "mañana" }), /no es una fecha/);
  assert.equal(calzaConElTipo(columnas[0], "hola"), false);
  assert.equal(calzaConElTipo(columnas[0], "12"), true);
});

test("los valores se guardan por id, aceptando el nombre de la columna", () => {
  assert.deepEqual(valoresParaGuardar(COLUMNAS_INICIALES, { "columna 1": "Ana", c2: 12 }), { c1: "Ana", c2: "12" });
  assert.throws(() => valoresParaGuardar(COLUMNAS_INICIALES, { Ciudad: "Pasto" }), /No hay una columna «Ciudad»/);
  assert.throws(() => valoresParaGuardar(COLUMNAS_INICIALES, ["x"]), /Cada fila/);
});

test("una lista suma sola las opciones nuevas que se escriben", () => {
  const columnas: ColumnaDeBase[] = [{ id: "c1", nombre: "Estado", tipo: "lista", opciones: ["Listo"] }, COLUMNAS_INICIALES[1]];
  assert.equal(columnasConOpcionesNuevas(columnas, [{ c1: "Listo", c2: "x" }]), null);
  assert.deepEqual(columnasConOpcionesNuevas(columnas, [{ c1: "Pendiente" }, { c1: "" }])?.[0].opciones, ["Listo", "Pendiente"]);
});

test("ordenar: números como números y lo vacío al final", () => {
  const numero: ColumnaDeBase = { id: "c1", nombre: "N", tipo: "numero" };
  assert.deepEqual(["10", "", "9", "-1"].sort((a, b) => compararCeldas(numero, a, b)), ["-1", "9", "10", ""]);
  assert.deepEqual(["b", "", "Ábaco", "a"].sort((a, b) => compararCeldas(COLUMNAS_INICIALES[0], a, b)), ["a", "Ábaco", "b", ""]);
});

test("leerColumnas descarta lo que no sirve y las viejas quedan de texto", () => {
  assert.deepEqual(leerColumnas([{ id: "c1", nombre: "A" }, { id: "c1", nombre: "B" }, { nombre: "C" }, null, "x"]), [
    { id: "c1", nombre: "A", tipo: "texto" },
  ]);
  assert.deepEqual(leerColumnas([{ id: "c2", nombre: "E", tipo: "lista", opciones: ["a", 3] }]), [
    { id: "c2", nombre: "E", tipo: "lista", opciones: ["a"] },
  ]);
  assert.deepEqual(leerColumnas(null), []);
});
