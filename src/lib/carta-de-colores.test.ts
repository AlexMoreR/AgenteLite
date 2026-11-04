import { test } from "node:test";
import assert from "node:assert/strict";

import {
  COLORES_POR_IMAGEN,
  LARGO_MAXIMO_CODIGO,
  MATERIALES_BASE,
  TEXTO_CARTA_DE_COLORES,
  codigoRepetido,
  huellaDeMaterial,
  normalizarCodigo,
  partirEnPaginas,
  validarCodigo,
  type ColorParaCarta,
} from "./carta-de-colores";
import { ELECCION_TODOS, imagenesParaMandar, mandarEnOrden } from "./carta-de-colores-chat";

function color(numero: number, cambios: Partial<ColorParaCarta> = {}): ColorParaCarta {
  return {
    id: `c${numero}`,
    codigo: String(numero),
    nombre: `Color ${numero}`,
    fotoUrl: `https://ejemplo.test/${numero}.jpg`,
    oculto: false,
    orden: 0,
    ...cambios,
  };
}

function colores(cuantos: number): ColorParaCarta[] {
  return Array.from({ length: cuantos }, (_, i) => color(i + 1));
}

test("30 colores dan 3 páginas: 12, 12 y 6", () => {
  assert.equal(COLORES_POR_IMAGEN, 12);
  const paginas = partirEnPaginas(colores(30));
  assert.deepEqual(
    paginas.map((pagina) => pagina.length),
    [12, 12, 6],
  );
  // El código numérico va como lo lee una persona: 1, 2, ..., 10, no 1, 10, 11.
  assert.deepEqual(
    paginas[0].map((c) => c.codigo),
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"],
  );
});

test("sin colores visibles no hay páginas", () => {
  assert.deepEqual(partirEnPaginas([]), []);
  assert.deepEqual(partirEnPaginas([color(1, { oculto: true })]), []);
});

test("los ocultos no entran en la carta", () => {
  const lista = colores(13);
  lista[0].oculto = true;
  const paginas = partirEnPaginas(lista);
  assert.deepEqual(
    paginas.map((pagina) => pagina.length),
    [12],
  );
  assert.ok(!paginas.flat().some((c) => c.id === "c1"));
});

test("ordena por orden y luego por código", () => {
  const lista = [color(3, { orden: 1 }), color(1, { orden: 2 }), color(2, { orden: 1 })];
  assert.deepEqual(
    partirEnPaginas(lista)[0].map((c) => c.codigo),
    ["2", "3", "1"],
  );
  // No cambia el arreglo que le pasan.
  assert.deepEqual(
    lista.map((c) => c.codigo),
    ["3", "1", "2"],
  );
});

test("el texto de la carta es exacto", () => {
  assert.equal(TEXTO_CARTA_DE_COLORES, "Escríbeme el código del color que te gustó 😊");
});

test("normalizarCodigo y validarCodigo recortan espacios, no aceptan vacío ni demasiado largo", () => {
  assert.equal(normalizarCodigo("  C 12  "), "C 12");
  assert.equal(normalizarCodigo("A   7"), "A 7");
  assert.deepEqual(validarCodigo("  C12 "), { ok: true, codigo: "C12" });
  assert.equal(validarCodigo("   ").ok, false);
  assert.equal(validarCodigo("").ok, false);
  assert.equal(validarCodigo("x".repeat(LARGO_MAXIMO_CODIGO)).ok, true);
  assert.equal(validarCodigo("x".repeat(LARGO_MAXIMO_CODIGO + 1)).ok, false);
});

test("detecta el código repetido dentro de un material", () => {
  const lista = [color(1, { codigo: "C12" }), color(2, { codigo: "C13" })];
  assert.equal(codigoRepetido(lista, "C12"), true);
  assert.equal(codigoRepetido(lista, "  c12 "), true);
  assert.equal(codigoRepetido(lista, "C14"), false);
  // Al editar el mismo color, su propio código no cuenta como repetido.
  assert.equal(codigoRepetido(lista, "C12", "c1"), false);
  assert.equal(codigoRepetido(lista, "C12", "c2"), true);
  assert.equal(codigoRepetido(lista, "   "), false);
});

test("los 4 materiales base tienen nombre, tipo y orden correctos", () => {
  assert.deepEqual(
    MATERIALES_BASE.map((m) => [m.nombre, m.tipo, m.orden]),
    [
      ["Cuerotex", "CUERO", 0],
      ["Prana", "CUERO", 1],
      ["Corsos", "CUERO", 2],
      ["Telas", "TELA", 3],
    ],
  );
});

test("la lista de materiales base no trae colores", () => {
  for (const material of MATERIALES_BASE) {
    assert.deepEqual(Object.keys(material).sort(), ["nombre", "orden", "tipo"]);
  }
});

test("la huella es corta, estable y cambia solo si cambia lo que se ve", () => {
  const lista = colores(5);
  const huella = huellaDeMaterial(lista);
  assert.match(huella, /^[0-9a-f]{12}$/);
  assert.equal(huellaDeMaterial([...lista].reverse()), huella);
  assert.notEqual(huellaDeMaterial(lista.map((c, i) => (i === 0 ? { ...c, nombre: "Otro" } : c))), huella);
  assert.notEqual(huellaDeMaterial(lista.map((c, i) => (i === 0 ? { ...c, fotoUrl: null } : c))), huella);
  assert.notEqual(huellaDeMaterial(lista.map((c, i) => (i === 0 ? { ...c, orden: 9 } : c))), huella);
  assert.notEqual(huellaDeMaterial(lista.map((c, i) => (i === 0 ? { ...c, oculto: true } : c))), huella);
  // Un oculto que cambia no mueve la huella: no sale en la carta.
  const conOculto = [...lista, color(99, { oculto: true })];
  assert.equal(huellaDeMaterial(conOculto), huella);
  assert.equal(huellaDeMaterial(conOculto.map((c) => (c.id === "c99" ? { ...c, nombre: "X" } : c))), huella);
});

const CARTA = [
  { id: "m1", nombre: "Cuerotex", imagenesUrl: ["/uploads/a-1.png", "/uploads/a-2.png"] },
  { id: "m2", nombre: "Prana", imagenesUrl: [] },
  { id: "m3", nombre: "Telas", imagenesUrl: ["/uploads/t-1.png"] },
];

test("un material: salen sus imágenes en orden y solo la última lleva el texto", () => {
  assert.deepEqual(imagenesParaMandar(CARTA, "m1"), [
    { url: "/uploads/a-1.png" },
    { url: "/uploads/a-2.png", texto: TEXTO_CARTA_DE_COLORES },
  ]);
});

test("Todos junta las de cada material en orden y se salta los que no tienen", () => {
  const lista = imagenesParaMandar(CARTA, ELECCION_TODOS);
  assert.deepEqual(lista.map((i) => i.url), ["/uploads/a-1.png", "/uploads/a-2.png", "/uploads/t-1.png"]);
  assert.deepEqual(lista.map((i) => i.texto), [undefined, undefined, TEXTO_CARTA_DE_COLORES]);
});

test("sin imágenes o con un id que no existe no sale nada", () => {
  assert.deepEqual(imagenesParaMandar(CARTA, "m2"), []);
  assert.deepEqual(imagenesParaMandar(CARTA, "no-existe"), []);
  assert.deepEqual(imagenesParaMandar([], ELECCION_TODOS), []);
});

test("mandarEnOrden espera cada envío y manda todas si salen bien", async () => {
  const vistas: string[] = [];
  const resultado = await mandarEnOrden(imagenesParaMandar(CARTA, ELECCION_TODOS), async (imagen) => {
    await new Promise((listo) => setTimeout(listo, 1));
    vistas.push(imagen.url);
    return { ok: true };
  });
  assert.deepEqual(resultado, { enviadas: 3 });
  assert.deepEqual(vistas, ["/uploads/a-1.png", "/uploads/a-2.png", "/uploads/t-1.png"]);
});

test("mandarEnOrden se para en la primera que falla y devuelve su error", async () => {
  const vistas: string[] = [];
  const resultado = await mandarEnOrden(imagenesParaMandar(CARTA, ELECCION_TODOS), async (imagen, indice) => {
    vistas.push(imagen.url);
    return indice === 1 ? { error: "Fuera de la ventana de 24 h" } : { ok: true };
  });
  assert.deepEqual(resultado, { enviadas: 1, error: "Fuera de la ventana de 24 h" });
  assert.equal(vistas.length, 2);
});

test("mandarEnOrden se para si el envío se cae", async () => {
  const resultado = await mandarEnOrden(imagenesParaMandar(CARTA, "m1"), async () => {
    throw new Error("red");
  });
  assert.equal(resultado.enviadas, 0);
  assert.ok(resultado.error);
});
