import { test } from "node:test";
import assert from "node:assert/strict";

import { imagenesDelPortapapeles } from "./imagenes-del-portapapeles";

// Portapapeles simulado: solo lo que la funcion lee (`items` y `files`).
function portapapeles(items: File[], files: File[], textos: string[] = []): DataTransfer {
  const lista = [
    ...items.map((archivo) => ({ kind: "file", type: archivo.type, getAsFile: () => archivo })),
    ...textos.map(() => ({ kind: "string", type: "text/plain", getAsFile: () => null })),
  ];
  return { items: lista, files } as unknown as DataTransfer;
}

function imagen(nombre: string, bytes: number, tipo = "image/png", hora = 1_700_000_000_000): File {
  return new File([new Uint8Array(bytes)], nombre, { type: tipo, lastModified: hora });
}

test("a) escritorio: la misma imagen en items y en files con horas distintas queda 1 vez", () => {
  const enItems = imagen("foto.png", 500, "image/png", 1_700_000_000_123);
  const enFiles = imagen("foto.png", 500, "image/png", 1_700_000_000_987);
  const resultado = imagenesDelPortapapeles(portapapeles([enItems], [enFiles]));
  assert.equal(resultado.length, 1);
  assert.equal(resultado[0], enItems);
});

test("b) celular: items vacio y la imagen solo en files queda 1 vez", () => {
  const enFiles = imagen("foto.jpg", 800, "image/jpeg");
  const resultado = imagenesDelPortapapeles(portapapeles([], [enFiles]));
  assert.equal(resultado.length, 1);
  assert.equal(resultado[0], enFiles);
});

test("c) dos imagenes distintas en items (y las mismas en files) quedan 2", () => {
  const uno = imagen("uno.png", 300);
  const dos = imagen("dos.png", 300);
  const resultado = imagenesDelPortapapeles(
    portapapeles([uno, dos], [imagen("uno.png", 300, "image/png", 1), imagen("dos.png", 300, "image/png", 2)]),
  );
  assert.equal(resultado.length, 2);
  assert.deepEqual(
    resultado.map((archivo) => archivo.name),
    ["uno.png", "dos.png"],
  );
});

test("d) solo texto: 0 imagenes (el texto se pega normal)", () => {
  assert.equal(imagenesDelPortapapeles(portapapeles([], [], ["hola"])).length, 0);
  assert.equal(imagenesDelPortapapeles(null).length, 0);
  assert.equal(imagenesDelPortapapeles(undefined).length, 0);
});

test("e) imagen sin nombre o llamada image.png queda imagen-pegada-...png con tipo image/png", () => {
  const generica = imagen("image.png", 200);
  const resultadoGenerica = imagenesDelPortapapeles(portapapeles([generica], [generica]));
  assert.equal(resultadoGenerica.length, 1);
  assert.match(resultadoGenerica[0].name, /^imagen-pegada-\d+-1\.png$/);
  assert.equal(resultadoGenerica[0].type, "image/png");

  const sinNombreNiTipo = new File([new Uint8Array(100)], "", { type: "" });
  const resultadoSinNombre = imagenesDelPortapapeles(portapapeles([], [sinNombreNiTipo]));
  assert.equal(resultadoSinNombre.length, 1);
  assert.match(resultadoSinNombre[0].name, /^imagen-pegada-\d+-1\.png$/);
  assert.equal(resultadoSinNombre[0].type, "image/png");
});

test("un documento en el portapapeles no se toma como imagen", () => {
  const pdf = new File([new Uint8Array(10)], "doc.pdf", { type: "application/pdf" });
  assert.equal(imagenesDelPortapapeles(portapapeles([], [pdf])).length, 0);
});
