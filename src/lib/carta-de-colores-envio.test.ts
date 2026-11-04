import assert from "node:assert/strict";
import test from "node:test";

import { TEXTO_CARTA_DE_COLORES } from "./carta-de-colores";
import { imagenesDeCartaParaEnviar, OPCION_TODOS, type MaterialDeCartaParaChat } from "./carta-de-colores-envio";

const materiales: MaterialDeCartaParaChat[] = [
  { id: "a", nombre: "Cuerotex", imagenesUrl: ["/uploads/carta-colores/cuerotex-1.png", "/uploads/carta-colores/cuerotex-2.png"] },
  { id: "b", nombre: "Prana", imagenesUrl: [] },
  { id: "c", nombre: "Telas", imagenesUrl: ["/uploads/carta-colores/telas-1.png"] },
];

test("un material: sus imágenes en orden y solo la última con el texto", () => {
  const imagenes = imagenesDeCartaParaEnviar(materiales, "a");
  assert.deepEqual(
    imagenes.map((imagen) => imagen.url),
    ["/uploads/carta-colores/cuerotex-1.png", "/uploads/carta-colores/cuerotex-2.png"],
  );
  assert.equal(imagenes[0].caption, undefined);
  assert.equal(imagenes[1].caption, TEXTO_CARTA_DE_COLORES);
  assert.equal(imagenes[1].fileName, "cuerotex-2.png");
});

test("Todos: junta las de cada material en orden y se salta los que no tienen", () => {
  const imagenes = imagenesDeCartaParaEnviar(materiales, OPCION_TODOS);
  assert.deepEqual(
    imagenes.map((imagen) => imagen.fileName),
    ["cuerotex-1.png", "cuerotex-2.png", "telas-1.png"],
  );
  assert.deepEqual(
    imagenes.map((imagen) => imagen.caption),
    [undefined, undefined, TEXTO_CARTA_DE_COLORES],
  );
});

test("sin elegir, con un material que ya no está o sin imágenes: no se manda nada", () => {
  assert.deepEqual(imagenesDeCartaParaEnviar(materiales, null), []);
  assert.deepEqual(imagenesDeCartaParaEnviar(materiales, "no-existe"), []);
  assert.deepEqual(imagenesDeCartaParaEnviar(materiales, "b"), []);
  assert.deepEqual(imagenesDeCartaParaEnviar([], OPCION_TODOS), []);
});

test("una sola imagen lleva el texto", () => {
  const imagenes = imagenesDeCartaParaEnviar(materiales, "c");
  assert.equal(imagenes.length, 1);
  assert.equal(imagenes[0].caption, TEXTO_CARTA_DE_COLORES);
});
