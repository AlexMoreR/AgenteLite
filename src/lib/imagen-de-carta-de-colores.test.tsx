import { test } from "node:test";
import assert from "node:assert/strict";

import { dibujarPaginaDeCarta, rutaEnDisco, slugDeMaterial, type LeerArchivoPublico } from "./imagen-de-carta-de-colores";

/*
  Arma un JPG de 8×8 de un solo color, sin librerías: una sola cuadra por canal (Y, Cb, Cr), con la
  tabla de cuantización en 1 y solo el coeficiente DC (todo el resto en cero). Alcanza para que la
  prueba use fotos JPG de verdad sin instalar nada.
*/
function jpgDeUnColor(r: number, g: number, b: number): Buffer {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;

  // Huffman DC: categorías 0..11, todas con código de 4 bits (0000..1011). AC: solo fin de bloque, código "0".
  const bits: number[] = [];
  const poner = (valor: number, largo: number) => {
    for (let i = largo - 1; i >= 0; i -= 1) bits.push((valor >> i) & 1);
  };
  for (const canal of [y, cb, cr]) {
    const dc = Math.round(8 * (canal - 128));
    const categoria = dc === 0 ? 0 : Math.floor(Math.log2(Math.abs(dc))) + 1;
    poner(categoria, 4);
    if (categoria > 0) poner(dc > 0 ? dc : dc + (1 << categoria) - 1, categoria);
    poner(0, 1);
  }
  while (bits.length % 8 !== 0) bits.push(1);
  const datos: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    const byte = bits.slice(i, i + 8).reduce((acumulado, bit) => (acumulado << 1) | bit, 0);
    datos.push(byte);
    if (byte === 0xff) datos.push(0x00);
  }

  const contarDc = Array(16).fill(0);
  contarDc[3] = 12;
  const contarAc = Array(16).fill(0);
  contarAc[0] = 1;
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xdb, 0x00, 0x43, 0x00, ...Array(64).fill(1),
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x08, 0x00, 0x08, 0x03,
    0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xc4, 0x00, 0x31,
    0x00, ...contarDc, ...Array.from({ length: 12 }, (_, i) => i),
    0x10, ...contarAc, 0x00,
    0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x00, 0x3f, 0x00,
    ...datos,
    0xff, 0xd9,
  ]);
}

const LOGO_DE_PRUEBA = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="108"><rect width="300" height="108" fill="#111827"/></svg>',
);

const FIRMA_PNG = [0x89, 0x50, 0x4e, 0x47];

test("dibuja una página de la carta como PNG válido con 3 colores", async () => {
  const archivos = new Map<string, Buffer>([
    ["/magilus-logo.svg", LOGO_DE_PRUEBA],
    ["/uploads/carta-colores/fotos/rojo.jpg", jpgDeUnColor(200, 30, 30)],
    ["/uploads/carta-colores/fotos/verde.jpg", jpgDeUnColor(30, 160, 60)],
    ["/uploads/carta-colores/fotos/azul.jpg", jpgDeUnColor(30, 60, 200)],
  ]);
  const leidos: string[] = [];
  const leerArchivo: LeerArchivoPublico = async (ruta) => {
    leidos.push(ruta);
    return archivos.get(ruta) ?? null;
  };

  const png = await dibujarPaginaDeCarta({
    material: { nombre: "Cuerotex" },
    colores: [
      { codigo: "101", nombre: "Rojo", fotoUrl: "/uploads/carta-colores/fotos/rojo.jpg" },
      { codigo: "102", nombre: "Verde", fotoUrl: "/uploads/carta-colores/fotos/verde.jpg" },
      { codigo: "103", nombre: "Azul", fotoUrl: "/uploads/carta-colores/fotos/azul.jpg" },
    ],
    pagina: 1,
    totalPaginas: 2,
    leerArchivo,
  });

  assert.ok(Buffer.isBuffer(png));
  assert.ok(png.length > 0);
  assert.deepEqual([...png.subarray(0, 4)], FIRMA_PNG);
  assert.ok(leidos.includes("/magilus-logo.svg"), "lee el logo");
  assert.equal(leidos.filter((ruta) => ruta.endsWith(".jpg")).length, 3, "lee las 3 fotos");
});

test("un color sin foto o con la foto perdida no rompe la imagen", async () => {
  const png = await dibujarPaginaDeCarta({
    material: { nombre: "Telas" },
    colores: [
      { codigo: "T1", nombre: "Sin foto", fotoUrl: null },
      { codigo: "T2", nombre: "Foto perdida", fotoUrl: "/uploads/carta-colores/fotos/no-esta.jpg" },
    ],
    pagina: 1,
    totalPaginas: 1,
    leerArchivo: async () => null,
  });
  assert.deepEqual([...png.subarray(0, 4)], FIRMA_PNG);
});

test("las rutas públicas no pueden salir de public/", () => {
  assert.ok(rutaEnDisco("/uploads/carta-colores/fotos/a.jpg")?.endsWith("/public/uploads/carta-colores/fotos/a.jpg"));
  assert.equal(rutaEnDisco("/../package.json"), rutaEnDisco("/package.json"));
  assert.ok(rutaEnDisco("/%2e%2e/%2e%2e/etc/passwd")?.includes("/public/"), "queda dentro de public/");
  assert.equal(rutaEnDisco("/uploads/%2F..%2F..%2F..%2Fetc"), null);
  assert.equal(rutaEnDisco(""), null);
});

test("el nombre del material queda listo para un archivo", () => {
  assert.equal(slugDeMaterial("Cuerotex"), "cuerotex");
  assert.equal(slugDeMaterial("Telas Piña"), "telas-pina");
  assert.equal(slugDeMaterial("¡¡!!"), "material");
});
