import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CALIDADES_JPEG,
  LADO_MAXIMO_PX,
  PESO_ACEPTABLE_BYTES,
  PESO_MAXIMO_BYTES,
  comprimirFotoParaEnviar,
  debeComprimirFoto,
  medidasParaEnviar,
  nombreJpg,
} from "./comprimir-foto";

/*
  La decision, las medidas y el nombre se prueban sin navegador. El dibujo real (orientacion, fondo
  blanco, nitidez) solo se comprueba a mano con un celular. En Node no existe `createImageBitmap`, asi
  que comprimir un JPEG aca falla de verdad: sirve para ver que sale el original.
*/

const KB = 1024;

test("los topes son 1600 px, 400 KB y las calidades 0,8 → 0,7 → 0,6", () => {
  assert.equal(LADO_MAXIMO_PX, 1600);
  assert.equal(PESO_MAXIMO_BYTES, 400 * KB);
  assert.deepEqual([...CALIDADES_JPEG], [0.8, 0.7, 0.6]);
});

test("se acepta la primera pasada hasta 900 KB: entra en un solo pedido de 1 MB", () => {
  assert.equal(PESO_ACEPTABLE_BYTES, 900 * KB);
  assert.ok(PESO_ACEPTABLE_BYTES <= 1024 * KB);
});

test("una foto chica sale tal cual", () => {
  assert.equal(debeComprimirFoto({ tipo: "image/jpeg", peso: 200 * KB, ancho: 1200, alto: 900 }), false);
  // Justo en los topes, tambien.
  assert.equal(debeComprimirFoto({ tipo: "image/png", peso: 400 * KB, ancho: 1600, alto: 1600 }), false);
  assert.deepEqual(medidasParaEnviar(1200, 900), { ancho: 1200, alto: 900 });
});

test("una foto de menos de 400 KB pero de mas de 1600 px se comprime", () => {
  assert.equal(debeComprimirFoto({ tipo: "image/webp", peso: 300 * KB, ancho: 2000, alto: 1000 }), true);
});

test("una foto de mas de 400 KB y de menos de 1600 px se comprime", () => {
  assert.equal(debeComprimirFoto({ tipo: "image/jpeg", peso: 900 * KB, ancho: 1200, alto: 900 }), true);
});

test("horizontal: 4000×3000 pasa a 1600×1200", () => {
  assert.deepEqual(medidasParaEnviar(4000, 3000), { ancho: 1600, alto: 1200 });
});

test("vertical: 3000×4000 pasa a 1200×1600", () => {
  assert.deepEqual(medidasParaEnviar(3000, 4000), { ancho: 1200, alto: 1600 });
});

test("nunca se agranda", () => {
  assert.deepEqual(medidasParaEnviar(800, 600), { ancho: 800, alto: 600 });
});

test("GIF, PDF y video no se comprimen, por grandes que sean", () => {
  for (const tipo of ["image/gif", "application/pdf", "video/mp4"]) {
    assert.equal(debeComprimirFoto({ tipo, peso: 10_000 * KB, ancho: 4000, alto: 3000 }), false, tipo);
  }
});

test("el nombre conserva la base y termina en .jpg", () => {
  assert.equal(nombreJpg("foto.png"), "foto.jpg");
  assert.equal(nombreJpg("foto.final.jpeg"), "foto.final.jpg");
  assert.equal(nombreJpg("foto"), "foto.jpg");
  assert.equal(nombreJpg(""), "foto.jpg");
});

test("GIF, PDF, video y un JPEG cuya compresion falla salen exactamente iguales", async () => {
  const pesado = new Uint8Array(600 * KB);
  const archivos = [
    new File([pesado], "animado.gif", { type: "image/gif" }),
    new File([pesado], "catalogo.pdf", { type: "application/pdf" }),
    new File([pesado], "video.mp4", { type: "video/mp4" }),
    // En Node no hay createImageBitmap: la compresion falla y tiene que salir el original.
    new File([pesado], "foto.jpg", { type: "image/jpeg" }),
  ];
  for (const archivo of archivos) {
    assert.equal(await comprimirFotoParaEnviar(archivo), archivo, archivo.name);
  }
});
