import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { dibujarPaginaDeCarta, esFotoDeCarta, slugDeMaterial } from "./imagen-de-carta-de-colores";

/*
  JPG de 8×8 de un solo color, armado a mano (baseline, sin librerías): una tabla de cuantización de unos,
  la tabla DC estándar de luminancia y una tabla AC con un solo código (fin de bloque). Alcanza para
  tener fotos reales en la prueba sin instalar nada.
*/
function jpgDeColorLiso(r: number, g: number, b: number): Buffer {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  // Coeficiente DC de un bloque 8×8 parejo: 8 × (valor − 128).
  const dcs = [y, cb, cr].map((valor) => Math.round(8 * (valor - 128)));

  const codigosDc = ["00", "010", "011", "100", "101", "110", "1110", "11110", "111110", "1111110", "11111110", "111111110"];
  let bits = "";
  for (const dc of dcs) {
    const magnitud = Math.abs(dc);
    const categoria = magnitud === 0 ? 0 : Math.floor(Math.log2(magnitud)) + 1;
    bits += codigosDc[categoria];
    if (categoria > 0) {
      const valor = dc >= 0 ? dc : dc + (1 << categoria) - 1;
      bits += valor.toString(2).padStart(categoria, "0");
    }
    bits += "0"; // fin de bloque (todos los AC en cero)
  }
  while (bits.length % 8 !== 0) bits += "1";
  const datos: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    const byte = parseInt(bits.slice(i, i + 8), 2);
    datos.push(byte);
    if (byte === 0xff) datos.push(0x00);
  }

  const dht = (clase: number, cuentas: number[], valores: number[]) => {
    const largo = 2 + 1 + 16 + valores.length;
    return [0xff, 0xc4, largo >> 8, largo & 0xff, clase, ...cuentas, ...valores];
  };
  const cuentasDc = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
  const cuentasAc = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xdb, 0x00, 0x43, 0x00, ...new Array(64).fill(1),
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x08, 0x00, 0x08, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    ...dht(0x00, cuentasDc, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
    ...dht(0x10, cuentasAc, [0x00]),
    0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x00, 0x3f, 0x00,
    ...datos,
    0xff, 0xd9,
  ]);
}

test("dibuja una página de la carta en memoria y sale un PNG válido", async () => {
  const fotos: Record<string, Buffer> = {
    "/uploads/carta-colores/fotos/rojo.jpg": jpgDeColorLiso(200, 30, 40),
    "/uploads/carta-colores/fotos/beige.jpg": jpgDeColorLiso(220, 200, 160),
    "/uploads/carta-colores/fotos/negro.jpg": jpgDeColorLiso(20, 20, 20),
  };
  const logo = await readFile(path.join(process.cwd(), "public", "magilus-logo.svg"));
  const leidos: string[] = [];

  const png = await dibujarPaginaDeCarta({
    material: { nombre: "Cuerotex" },
    colores: [
      { codigo: "101", nombre: "Rojo pasión", fotoUrl: "/uploads/carta-colores/fotos/rojo.jpg" },
      { codigo: "102", nombre: "Beige", fotoUrl: "/uploads/carta-colores/fotos/beige.jpg" },
      { codigo: "103", nombre: "Negro", fotoUrl: "/uploads/carta-colores/fotos/negro.jpg" },
    ],
    pagina: 1,
    totalPaginas: 2,
    leerArchivo: async (ruta) => {
      leidos.push(ruta);
      return ruta === "/magilus-logo.svg" ? logo : (fotos[ruta] ?? null);
    },
  });

  assert.ok(Buffer.isBuffer(png));
  assert.ok(png.length > 0);
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  // Leyó el logo y las tres fotos.
  assert.ok(leidos.includes("/magilus-logo.svg"));
  assert.equal(leidos.filter((ruta) => ruta.endsWith(".jpg")).length, 3);
});

test("un color sin foto (o con una foto que no se puede leer) igual sale en la página", async () => {
  const png = await dibujarPaginaDeCarta({
    material: { nombre: "Telas" },
    colores: [
      { codigo: "T1", nombre: "Gris", fotoUrl: null },
      { codigo: "T2", nombre: "Azul", fotoUrl: "/uploads/carta-colores/fotos/no-existe.jpg" },
    ],
    pagina: 1,
    totalPaginas: 1,
    leerArchivo: async () => null,
  });
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
});

test("slugDeMaterial deja un nombre de archivo seguro", () => {
  assert.equal(slugDeMaterial("Cuerotex"), "cuerotex");
  assert.equal(slugDeMaterial("Telas Ñandú / Lino"), "telas-nandu-lino");
  assert.equal(slugDeMaterial("../../etc"), "etc");
  assert.equal(slugDeMaterial("¡¡!!"), "material");
});

test("esFotoDeCarta solo acepta fotos subidas a la carpeta de la carta", () => {
  assert.equal(esFotoDeCarta("/uploads/carta-colores/fotos/abc-123.jpg"), true);
  assert.equal(esFotoDeCarta("/uploads/carta-colores/fotos/abc.png"), true);
  assert.equal(esFotoDeCarta("/uploads/carta-colores/fotos/../../../.env"), false);
  assert.equal(esFotoDeCarta("https://otro.sitio/foto.jpg"), false);
  assert.equal(esFotoDeCarta("/uploads/otra-carpeta/foto.jpg"), false);
});
