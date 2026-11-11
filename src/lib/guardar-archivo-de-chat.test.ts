import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { ArchivoDistintoError, guardarBytesDeChat, tipoDeMedioPorMime } from "./guardar-archivo-de-chat";
import { persistChatMediaFromDataUrl } from "./chat-media-storage";

/*
  guardarBytesDeChat con carpetas de verdad: mismo contenido -> mismo nombre y no reescribe; nunca
  queda un temporal; nunca pisa un archivo que ya estaba con otro contenido; y el nombre es EL MISMO
  que el de persistChatMediaFromDataUrl (asi el webhook encuentra lo que guardo la red de prisma).
*/

const sha = (datos: Buffer) => createHash("sha256").update(datos).digest("hex");

async function carpeta() {
  return mkdtemp(path.join(tmpdir(), "chat-media-"));
}

test("guarda con <sha256>.<ext>, devuelve el enlace y no deja temporales", async () => {
  const destino = await carpeta();
  const bytes = randomBytes(5000);
  const guardado = await guardarBytesDeChat({ bytes, mimeType: "application/pdf", mediaType: "DOCUMENT", carpeta: destino });
  assert.equal(guardado.nombre, `${sha(bytes)}.pdf`);
  assert.equal(guardado.enlace, `/uploads/chat-media/${sha(bytes)}.pdf`);
  assert.equal(guardado.bytes, 5000);
  assert.equal(guardado.sha256, sha(bytes));
  assert.equal(guardado.yaExistia, false);
  assert.deepEqual(await readFile(path.join(destino, guardado.nombre)), bytes);
  assert.deepEqual(await readdir(destino), [guardado.nombre], "sin .tmp-*");
});

test("mismo contenido: mismo nombre y no reescribe (no cambia la fecha del archivo)", async () => {
  const destino = await carpeta();
  const bytes = randomBytes(3000);
  const primero = await guardarBytesDeChat({ bytes, mimeType: "image/jpeg", mediaType: "IMAGE", carpeta: destino });
  const antes = (await stat(primero.rutaEnDisco)).mtimeMs;
  await new Promise((resolve) => setTimeout(resolve, 30));
  const segundo = await guardarBytesDeChat({ bytes, mimeType: "image/jpeg", mediaType: "IMAGE", carpeta: destino, comprobar: "hash" });
  assert.equal(segundo.nombre, primero.nombre);
  assert.equal(segundo.yaExistia, true);
  assert.equal((await stat(primero.rutaEnDisco)).mtimeMs, antes);
});

test("extension por mimetype y por tipo de mensaje", async () => {
  const destino = await carpeta();
  const casos: Array<[string, "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT", string]> = [
    ["image/png", "IMAGE", ".png"],
    ["audio/ogg; codecs=opus", "AUDIO", ".ogg"],
    ["audio/mpeg", "AUDIO", ".mp3"],
    ["video/mp4", "VIDEO", ".mp4"],
    ["application/octet-stream", "STICKER", ".jpg"],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "DOCUMENT", ".docx"],
    ["", "DOCUMENT", ".bin"],
  ];
  for (const [mime, tipo, extension] of casos) {
    const guardado = await guardarBytesDeChat({ bytes: randomBytes(100), mimeType: mime, mediaType: tipo, carpeta: destino });
    assert.equal(path.extname(guardado.nombre), extension, `${mime} ${tipo}`);
  }
  assert.equal(tipoDeMedioPorMime("image/jpeg"), "IMAGE");
  assert.equal(tipoDeMedioPorMime("image/webp"), "STICKER");
  assert.equal(tipoDeMedioPorMime("audio/ogg"), "AUDIO");
  assert.equal(tipoDeMedioPorMime("video/mp4"), "VIDEO");
  assert.equal(tipoDeMedioPorMime(null), "DOCUMENT");
});

test("si ya hay un archivo con ese nombre y otro contenido: no lo pisa y avisa", async () => {
  const destino = await carpeta();
  const bytes = randomBytes(2000);
  const nombre = `${sha(bytes)}.pdf`;
  await mkdir(destino, { recursive: true });
  await writeFile(path.join(destino, nombre), Buffer.from("cortado"));

  await assert.rejects(
    guardarBytesDeChat({ bytes, mimeType: "application/pdf", mediaType: "DOCUMENT", carpeta: destino }),
    ArchivoDistintoError,
  );
  assert.deepEqual(await readFile(path.join(destino, nombre)), Buffer.from("cortado"), "el que estaba sigue igual");

  // Mismo tamano, otro contenido: solo lo ve la comprobacion por hash.
  const otro = randomBytes(2000);
  await writeFile(path.join(destino, nombre), otro);
  await assert.rejects(
    guardarBytesDeChat({ bytes, mimeType: "application/pdf", mediaType: "DOCUMENT", carpeta: destino, comprobar: "hash" }),
    ArchivoDistintoError,
  );
  const confiando = await guardarBytesDeChat({ bytes, mimeType: "application/pdf", mediaType: "DOCUMENT", carpeta: destino, comprobar: "nada" });
  assert.equal(confiando.yaExistia, true);
  assert.deepEqual(await readFile(path.join(destino, nombre)), otro);
  assert.deepEqual(await readdir(destino), [nombre]);
});

test("vacio o de mas de 60 MB: lanza sin escribir nada", async () => {
  const destino = await carpeta();
  await assert.rejects(guardarBytesDeChat({ bytes: Buffer.alloc(0), mimeType: "image/png", mediaType: "IMAGE", carpeta: destino }));
  await assert.rejects(
    guardarBytesDeChat({ bytes: Buffer.alloc(60 * 1024 * 1024 + 1), mimeType: "video/mp4", mediaType: "VIDEO", carpeta: destino }),
  );
  assert.deepEqual(await readdir(destino), []);
});

test("persistChatMediaFromDataUrl usa el MISMO nombre que la red (y sigue confiando en el que esta)", async () => {
  const raiz = await carpeta();
  const anterior = process.cwd();
  process.chdir(raiz);
  try {
    const bytes = randomBytes(6000);
    const red = await guardarBytesDeChat({ bytes, mimeType: "image/jpeg", mediaType: "IMAGE", comprobar: "tamano" });
    const delWebhook = await persistChatMediaFromDataUrl({
      dataUrl: `data:image/jpeg;base64,${bytes.toString("base64")}`,
      mediaType: "IMAGE",
    });
    assert.equal(delWebhook, red.enlace);
    assert.equal(red.rutaEnDisco, path.join(raiz, "public", "uploads", "chat-media", red.nombre));
    assert.deepEqual(await readdir(path.join(raiz, "public", "uploads", "chat-media")), [red.nombre]);
    assert.equal(await persistChatMediaFromDataUrl({ dataUrl: "no es data url", mediaType: "IMAGE" }), null);
  } finally {
    process.chdir(anterior);
  }
});
