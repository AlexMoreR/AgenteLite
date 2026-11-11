import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

import {
  CACHE_NOMBRE_UNICO,
  CACHE_REVALIDAR,
  esNombreUnico,
  leerRango,
  resolverRutaSubida,
} from "./archivos-subidos";
import { GET, HEAD } from "../app/uploads/[...path]/route";

/*
  /uploads/[...path] de punta a punta: se llama GET y HEAD de la ruta de verdad con un NextRequest,
  sobre una carpeta temporal (process.chdir), como lo pide el navegador, WAHA o la migracion.
*/

const HASH = "a".repeat(64);
const PDF = `${HASH}.pdf`;
const UUID = "1731234567890-0f8fad5b-d9cb-469f-a165-70867728950e.mp4";
const contenido = randomBytes(1000);
let raiz = "";
let anterior = "";

before(async () => {
  anterior = process.cwd();
  raiz = await mkdtemp(path.join(tmpdir(), "uploads-"));
  const uploads = path.join(raiz, "public", "uploads");
  await mkdir(path.join(uploads, "chat-media"), { recursive: true });
  await mkdir(path.join(uploads, "categories"), { recursive: true });
  await mkdir(path.join(raiz, "public", "uploads-x"), { recursive: true });
  await writeFile(path.join(uploads, "chat-media", PDF), contenido);
  await writeFile(path.join(uploads, "chat-media", UUID), contenido);
  await writeFile(path.join(uploads, "categories", "tapetes.png"), contenido);
  await writeFile(path.join(uploads, "categories", "logo.svg"), "<svg/>");
  await writeFile(path.join(uploads, "vacio.txt"), "");
  await writeFile(path.join(raiz, "public", "uploads-x", "secreto.txt"), "no");
  await writeFile(path.join(raiz, "public", "fuera.txt"), "no");
  process.chdir(raiz);
});

after(async () => {
  process.chdir(anterior);
  await rm(raiz, { recursive: true, force: true }).catch(() => {});
});

function pedir(metodo: "GET" | "HEAD", segmentos: string[], cabeceras: Record<string, string> = {}) {
  const request = new NextRequest(`http://localhost/uploads/${segmentos.join("/")}`, { method: metodo, headers: cabeceras });
  const context = { params: Promise.resolve({ path: segmentos }) };
  return metodo === "GET" ? GET(request, context) : HEAD(request, context);
}

async function cuerpo(respuesta: Response) {
  return Buffer.from(await respuesta.arrayBuffer());
}

test("200 con el archivo entero, por partes, y los encabezados de cache", async () => {
  const respuesta = await pedir("GET", ["chat-media", PDF]);
  assert.equal(respuesta.status, 200);
  assert.equal(respuesta.headers.get("content-type"), "application/pdf");
  assert.equal(respuesta.headers.get("content-length"), "1000");
  assert.equal(respuesta.headers.get("accept-ranges"), "bytes");
  assert.equal(respuesta.headers.get("cache-control"), CACHE_NOMBRE_UNICO);
  assert.equal(respuesta.headers.get("x-content-type-options"), "nosniff");
  assert.match(respuesta.headers.get("etag") ?? "", /^W\/"[0-9a-f]+-[0-9a-f]+"$/);
  assert.ok(respuesta.headers.get("last-modified"));
  assert.equal(respuesta.headers.get("content-disposition"), null, "el PDF sigue abriendo en el navegador");
  assert.deepEqual(await cuerpo(respuesta), contenido);
});

test("Cache-Control: un año solo para nombres unicos; los demas revalidan", async () => {
  assert.equal((await pedir("GET", ["chat-media", UUID])).headers.get("cache-control"), CACHE_NOMBRE_UNICO);
  assert.equal((await pedir("GET", ["categories", "tapetes.png"])).headers.get("cache-control"), CACHE_REVALIDAR);
  assert.equal(CACHE_NOMBRE_UNICO, "public, max-age=31536000, immutable");
  assert.equal(CACHE_REVALIDAR, "private, max-age=0, must-revalidate");
  assert.equal(esNombreUnico(PDF), true);
  assert.equal(esNombreUnico(UUID), true);
  assert.equal(esNombreUnico("tapetes.png"), false);
  assert.equal(esNombreUnico(`${HASH}.pdf.tmp-1-abc`), false);
  assert.equal(esNombreUnico("a".repeat(63) + ".pdf"), false);
});

test("304 por If-None-Match y por If-Modified-Since, sin cuerpo", async () => {
  const primera = await pedir("GET", ["categories", "tapetes.png"]);
  const etag = primera.headers.get("etag")!;
  const fecha = primera.headers.get("last-modified")!;
  await cuerpo(primera);

  const porEtag = await pedir("GET", ["categories", "tapetes.png"], { "if-none-match": etag });
  assert.equal(porEtag.status, 304);
  assert.equal(porEtag.headers.get("etag"), etag);
  assert.equal(porEtag.headers.get("cache-control"), CACHE_REVALIDAR);
  assert.equal((await cuerpo(porEtag)).length, 0);

  assert.equal((await pedir("GET", ["categories", "tapetes.png"], { "if-none-match": `"otro", ${etag.slice(2)}` })).status, 304, "lista y comparacion debil");
  assert.equal((await pedir("GET", ["categories", "tapetes.png"], { "if-modified-since": fecha })).status, 304);
  assert.equal((await pedir("HEAD", ["categories", "tapetes.png"], { "if-none-match": etag })).status, 304);

  const cambiada = await pedir("GET", ["categories", "tapetes.png"], { "if-none-match": 'W/"otro"' });
  assert.equal(cambiada.status, 200);
  await cuerpo(cambiada);
  const vieja = await pedir("GET", ["categories", "tapetes.png"], { "if-modified-since": new Date(0).toUTCString() });
  assert.equal(vieja.status, 200);
  await cuerpo(vieja);
});

test("206 con Range (audio y video en iPhone), 416 fuera de rango, If-Range", async () => {
  const inicio = await pedir("GET", ["chat-media", UUID], { range: "bytes=0-99" });
  assert.equal(inicio.status, 206);
  assert.equal(inicio.headers.get("content-range"), "bytes 0-99/1000");
  assert.equal(inicio.headers.get("content-length"), "100");
  assert.deepEqual(await cuerpo(inicio), contenido.subarray(0, 100));

  const final = await pedir("GET", ["chat-media", UUID], { range: "bytes=-10" });
  assert.equal(final.status, 206);
  assert.equal(final.headers.get("content-range"), "bytes 990-999/1000");
  assert.deepEqual(await cuerpo(final), contenido.subarray(990));

  const abierto = await pedir("GET", ["chat-media", UUID], { range: "bytes=900-" });
  assert.equal(abierto.headers.get("content-range"), "bytes 900-999/1000");
  assert.deepEqual(await cuerpo(abierto), contenido.subarray(900));

  const pasado = await pedir("GET", ["chat-media", UUID], { range: "bytes=0-5000" });
  assert.equal(pasado.headers.get("content-range"), "bytes 0-999/1000");
  await cuerpo(pasado);

  const fuera = await pedir("GET", ["chat-media", UUID], { range: "bytes=1000-1010" });
  assert.equal(fuera.status, 416);
  assert.equal(fuera.headers.get("content-range"), "bytes */1000");

  const etag = inicio.headers.get("etag")!;
  const conIfRange = await pedir("GET", ["chat-media", UUID], { range: "bytes=0-9", "if-range": etag });
  assert.equal(conIfRange.status, 206);
  await cuerpo(conIfRange);
  const otroIfRange = await pedir("GET", ["chat-media", UUID], { range: "bytes=0-9", "if-range": 'W/"viejo"' });
  assert.equal(otroIfRange.status, 200, "cambio el archivo: va entero");
  assert.equal((await cuerpo(otroIfRange)).length, 1000);

  const varios = await pedir("GET", ["chat-media", UUID], { range: "bytes=0-1,5-6" });
  assert.equal(varios.status, 200, "varios rangos: archivo entero");
  await cuerpo(varios);

  assert.equal((await pedir("GET", ["vacio.txt"], { range: "bytes=0-" })).status, 416);
  const vacio = await pedir("GET", ["vacio.txt"]);
  assert.equal(vacio.status, 200);
  assert.equal(vacio.headers.get("content-length"), "0");
});

test("HEAD: los mismos encabezados, sin cuerpo", async () => {
  const cabeza = await pedir("HEAD", ["chat-media", PDF]);
  assert.equal(cabeza.status, 200);
  assert.equal(cabeza.headers.get("content-length"), "1000");
  assert.equal(cabeza.headers.get("cache-control"), CACHE_NOMBRE_UNICO);
  assert.equal((await cuerpo(cabeza)).length, 0);
  const parcial = await pedir("HEAD", ["chat-media", PDF], { range: "bytes=0-0" });
  assert.equal(parcial.status, 206);
  assert.equal(parcial.headers.get("content-range"), "bytes 0-0/1000");
});

test("SVG sin permisos para correr codigo", async () => {
  const svg = await pedir("GET", ["categories", "logo.svg"]);
  assert.equal(svg.headers.get("content-type"), "image/svg+xml");
  assert.match(svg.headers.get("content-security-policy") ?? "", /default-src 'none'.*sandbox/);
  await cuerpo(svg);
});

test("ruta segura: carpetas vecinas, subir de carpeta, carpetas y lo que no existe -> 404", async () => {
  for (const segmentos of [
    ["..", "uploads-x", "secreto.txt"],
    ["..", "fuera.txt"],
    ["chat-media", "..", "..", "fuera.txt"],
    ["chat-media"],
    ["no-existe.pdf"],
    [],
    ["a\0b"],
  ]) {
    const respuesta = await pedir("GET", segmentos);
    assert.equal(respuesta.status, 404, segmentos.join("/"));
  }
  const base = path.join(raiz, "public", "uploads");
  assert.equal(resolverRutaSubida(base, ["..", "uploads-x", "secreto.txt"]), null);
  assert.equal(resolverRutaSubida(base, ["."]), null);
  assert.equal(resolverRutaSubida(base, ["chat-media", PDF]), path.join(base, "chat-media", PDF));
});

test("leerRango: las formas de la norma", () => {
  assert.deepEqual(leerRango("bytes=0-0", 10), { desde: 0, hasta: 0 });
  assert.deepEqual(leerRango("bytes=-3", 10), { desde: 7, hasta: 9 });
  assert.deepEqual(leerRango("bytes=-30", 10), { desde: 0, hasta: 9 });
  assert.equal(leerRango("bytes=-0", 10), "fuera");
  assert.equal(leerRango("bytes=10-", 10), "fuera");
  assert.equal(leerRango("bytes=5-2", 10), null);
  assert.equal(leerRango("items=0-1", 10), null);
  assert.equal(leerRango("bytes=-", 10), null);
  assert.equal(leerRango(null, 10), null);
});
