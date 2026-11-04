import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { inflateSync } from "node:zlib";

import {
  VERSION_DEL_DISENO,
  dibujarPaginaDeCarta,
  esImagenDeCarta,
  imagenesConDisenoActual,
  medidasDePagina,
  rehacerImagenesDeMaterial,
  rutaEnDisco,
  slugDeMaterial,
  type LeerArchivoPublico,
} from "./imagen-de-carta-de-colores";

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

/** Ancho y alto de un PNG (vienen en el bloque IHDR, justo después de la firma). */
function medidasDelPng(png: Buffer) {
  return { ancho: png.readUInt32BE(16), alto: png.readUInt32BE(20) };
}

/** Color de un punto del PNG (8 bits, RGB o RGBA, sin entrelazado), sin librerías: zlib + los 5 filtros. */
function colorEnElPng(png: Buffer, x: number, y: number): [number, number, number] {
  const { ancho, alto } = medidasDelPng(png);
  assert.equal(png[24], 8, "8 bits por canal");
  const canales = png[25] === 6 ? 4 : png[25] === 2 ? 3 : 0;
  assert.ok(canales > 0, "PNG RGB o RGBA");
  const partes: Buffer[] = [];
  for (let i = 8; i < png.length; ) {
    const largo = png.readUInt32BE(i);
    const tipo = png.toString("ascii", i + 4, i + 8);
    if (tipo === "IDAT") partes.push(png.subarray(i + 8, i + 8 + largo));
    i += 12 + largo;
  }
  const crudo = inflateSync(Buffer.concat(partes));
  const fila = ancho * canales;
  let anterior = Buffer.alloc(fila);
  for (let f = 0; f <= y && f < alto; f += 1) {
    const filtro = crudo[f * (fila + 1)];
    const datos = crudo.subarray(f * (fila + 1) + 1, (f + 1) * (fila + 1));
    const actual = Buffer.alloc(fila);
    for (let i = 0; i < fila; i += 1) {
      const a = i >= canales ? actual[i - canales] : 0;
      const b = anterior[i];
      const c = i >= canales ? anterior[i - canales] : 0;
      let prediccion = 0;
      if (filtro === 1) prediccion = a;
      else if (filtro === 2) prediccion = b;
      else if (filtro === 3) prediccion = (a + b) >> 1;
      else if (filtro === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        prediccion = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      actual[i] = (datos[i] + prediccion) & 0xff;
    }
    anterior = actual;
  }
  const inicio = x * canales;
  return [anterior[inicio], anterior[inicio + 1], anterior[inicio + 2]];
}

function coloresDePrueba(cantidad: number) {
  return Array.from({ length: cantidad }, (_, i) => ({
    codigo: `C${i + 1}`,
    nombre: `Color ${i + 1}`,
    fotoUrl: "/uploads/carta-colores/fotos/rojo.jpg",
  }));
}

const leerConRojo: LeerArchivoPublico = async (ruta) =>
  ruta === "/magilus-logo.svg"
    ? LOGO_DE_PRUEBA
    : ruta === "/uploads/carta-colores/fotos/rojo.jpg"
      ? jpgDeUnColor(200, 30, 30)
      : null;

test("con 1 color la muestra ocupa casi todo el ancho y la imagen no queda alta y vacía", async () => {
  const medidas = medidasDePagina(1);
  assert.equal(medidas.columnas, 1);
  assert.ok(medidas.ladoFoto >= 900, `la muestra mide ${medidas.ladoFoto} px`);

  const png = await dibujarPaginaDeCarta({
    material: { nombre: "Lila Cuerotex" },
    colores: coloresDePrueba(1),
    pagina: 1,
    totalPaginas: 1,
    leerArchivo: leerConRojo,
  });
  const { ancho, alto } = medidasDelPng(png);
  assert.equal(ancho, 1080);
  assert.ok(alto < 1500, `alto ${alto} px`);

  // Cerca del borde derecho de la muestra (x = 1000) y en su mitad, el punto es de la foto (rojo).
  const [r, g, b] = colorEnElPng(png, 1000, 250 + Math.floor(medidas.ladoFoto / 2));
  assert.ok(r > 150 && g < 90 && b < 90, `el punto es rojo: ${r},${g},${b}`);
});

test("con 2 a 4 colores salen 2 columnas y con 5 o más, 3", () => {
  for (const cantidad of [2, 3, 4]) {
    const medidas = medidasDePagina(cantidad);
    assert.equal(medidas.columnas, 2, `${cantidad} colores`);
    assert.ok(medidas.ladoFoto >= 450, `muestra de ${medidas.ladoFoto} px`);
  }
  assert.equal(medidasDePagina(3).filas, 2, "3 colores van en 2 filas");
  for (const cantidad of [5, 9, 12]) assert.equal(medidasDePagina(cantidad).columnas, 3, `${cantidad} colores`);
  // El alto crece solo con las filas que se usan.
  assert.ok(medidasDePagina(1).alto < medidasDePagina(12).alto);
  assert.ok(medidasDePagina(5).alto < medidasDePagina(12).alto);
});

test("con 12 colores mantiene 3 columnas y el alto de antes", async () => {
  const medidas = medidasDePagina(12);
  assert.equal(medidas.columnas, 3);
  assert.equal(medidas.filas, 4);
  assert.equal(medidas.ladoFoto, 293);
  // El alto de siempre: 250 + 4 × (293 + 136) + 3 × 28 + 60.
  assert.equal(medidas.alto, 2110);

  const png = await dibujarPaginaDeCarta({
    material: { nombre: "Cuerotex" },
    colores: coloresDePrueba(12),
    pagina: 1,
    totalPaginas: 1,
    leerArchivo: leerConRojo,
  });
  assert.deepEqual(medidasDelPng(png), { ancho: 1080, alto: 2110 });
  assert.ok(medidasDelPng(png).alto > 1.4 * 1406, "con 1 color el alto es mucho menor");
});

test("los nombres con la versión del diseño siguen siendo imágenes de la carta", () => {
  assert.equal(VERSION_DEL_DISENO, "d2");
  assert.ok(esImagenDeCarta("/uploads/carta-colores/cuerotex-0123456789ab-d2-1.png"));
  assert.ok(esImagenDeCarta("/uploads/carta-colores/cuerotex-0123456789ab-1.png"), "las viejas también, para borrarlas");
  assert.equal(esImagenDeCarta("/uploads/carta-colores/fotos/a.jpg"), false);
  assert.equal(esImagenDeCarta("/uploads/otra/cuerotex-d2-1.png"), false);

  assert.ok(imagenesConDisenoActual([]), "sin imágenes no hay nada que rehacer");
  assert.ok(imagenesConDisenoActual(["/uploads/carta-colores/cuerotex-0123456789ab-d2-1.png"]));
  assert.equal(imagenesConDisenoActual(["/uploads/carta-colores/cuerotex-0123456789ab-1.png"]), false);
  assert.equal(
    imagenesConDisenoActual([
      "/uploads/carta-colores/cuerotex-0123456789ab-d2-1.png",
      "/uploads/carta-colores/cuerotex-0123456789ab-2.png",
    ]),
    false,
  );
});

test("rehacer un material con la imagen del diseño viejo la cambia por una con -d2- y borra la vieja", async () => {
  const carpeta = path.join(process.cwd(), "public", "uploads", "carta-colores");
  const yaExistia = existsSync(carpeta);
  const antes = yaExistia ? new Set(await readdir(carpeta)) : new Set<string>();
  const vieja = "/uploads/carta-colores/prueba-rehacer-000000000000-1.png";
  await mkdir(carpeta, { recursive: true });
  await writeFile(path.join(carpeta, "prueba-rehacer-000000000000-1.png"), Buffer.from(FIRMA_PNG));

  let guardado = null as { imagenesUrl: string[] } | null;
  const prisma = {
    materialDeColores: {
      findUnique: async () => ({
        id: "m1",
        nombre: "Prueba Rehacer",
        imagenesUrl: [vieja],
        colores: [{ id: "c1", codigo: "01", nombre: "Lila 01", fotoUrl: "/uploads/carta-colores/fotos/rojo.jpg", oculto: false, orden: 0 }],
      }),
      update: async ({ data }: { data: { imagenesUrl: string[] } }) => {
        guardado = data;
        return data;
      },
    },
  } as unknown as Parameters<typeof rehacerImagenesDeMaterial>[0];

  try {
    const nuevas = await rehacerImagenesDeMaterial(prisma, "m1", leerConRojo);
    assert.equal(nuevas.length, 1);
    assert.match(nuevas[0], /^\/uploads\/carta-colores\/prueba-rehacer-[0-9a-f]{12}-d2-1\.png$/);
    assert.deepEqual(guardado?.imagenesUrl, nuevas);
    assert.ok(imagenesConDisenoActual(nuevas));
    assert.equal(existsSync(path.join(carpeta, "prueba-rehacer-000000000000-1.png")), false, "la vieja se borró");
    assert.ok(existsSync(rutaEnDisco(nuevas[0]) ?? ""), "la nueva quedó en el disco");
  } finally {
    // Deja la carpeta como estaba: solo se borra lo que creó esta prueba.
    for (const archivo of await readdir(carpeta)) {
      if (archivo.startsWith("prueba-rehacer-") && !antes.has(archivo)) await rm(path.join(carpeta, archivo));
    }
    if (!yaExistia) await rm(carpeta, { recursive: true, force: true });
  }
});
