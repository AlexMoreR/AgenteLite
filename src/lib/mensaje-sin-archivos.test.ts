import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { guardarBytesDeChat } from "./guardar-archivo-de-chat";
import { operacionQueEscribeMensaje, sinArchivosEnMensaje, type GuardarArchivo } from "./mensaje-sin-archivos";

/*
  La red de prisma.ts (sinArchivosEnMensaje) con cada forma de escritura de Prisma, con el disco de
  verdad en una carpeta temporal y con un disco que falla. Lo que importa: el archivo queda en disco,
  el base64 sale del payload, lo demas queda igual, y si algo falla el mensaje se guarda como hoy.
*/

const archivo = randomBytes(12000);
const BASE64 = archivo.toString("base64");
const sha = createHash("sha256").update(archivo).digest("hex");

function payloadDeWaha() {
  return {
    source: "webhook",
    evolution: {
      data: {
        key: { id: "WA1", fromMe: false },
        status: "DELIVERY_ACK",
        message: { imageMessage: { mimetype: "image/jpeg", jpegThumbnail: "mini", caption: "mire" } },
        base64: BASE64,
        mimetype: "image/jpeg",
      },
    },
  };
}

function fila(extra: Record<string, unknown> = {}) {
  return {
    workspaceId: "ws",
    conversationId: "c1",
    channelId: "canal1",
    externalId: "WA1",
    direction: "INBOUND",
    type: "IMAGE",
    status: "RECEIVED",
    content: "mire",
    mediaUrl: "https://waha-1.magilus.com/api/files/x.jpg",
    rawPayload: payloadDeWaha(),
    ...extra,
  };
}

async function enCarpeta() {
  const carpeta = await mkdtemp(path.join(tmpdir(), "red-"));
  const guardar: GuardarArchivo = (input) => guardarBytesDeChat({ ...input, carpeta });
  const avisos: Array<{ texto: string; datos: Record<string, unknown> }> = [];
  return { carpeta, opciones: { guardar, avisar: (texto: string, datos: Record<string, unknown>) => avisos.push({ texto, datos }) }, avisos };
}

function sinBase64(valor: unknown) {
  return !JSON.stringify(valor).includes(BASE64);
}

test("solo mira las escrituras de Message", () => {
  for (const op of ["create", "createMany", "createManyAndReturn", "update", "updateMany", "upsert"]) {
    assert.equal(operacionQueEscribeMensaje("Message", op), true, op);
  }
  assert.equal(operacionQueEscribeMensaje("Message", "findMany"), false);
  assert.equal(operacionQueEscribeMensaje("Message", "delete"), false);
  assert.equal(operacionQueEscribeMensaje("Contact", "create"), false);
  assert.equal(operacionQueEscribeMensaje(undefined, "create"), false);
});

test("create: guarda el archivo, quita el base64, conserva todo lo demas y no toca los args originales", async () => {
  const { carpeta, opciones, avisos } = await enCarpeta();
  const args = { data: fila() };
  const copia = JSON.parse(JSON.stringify(args));

  const limpio = await sinArchivosEnMensaje("create", args, opciones);

  assert.deepEqual(args, copia, "el payload en memoria del webhook sigue con su base64");
  assert.ok(sinBase64(limpio));
  assert.deepEqual(await readdir(carpeta), [`${sha}.jpg`]);
  assert.deepEqual(await readFile(path.join(carpeta, `${sha}.jpg`)), archivo);

  const { rawPayload, ...resto } = limpio.data;
  assert.deepEqual({ ...resto, rawPayload: args.data.rawPayload }, args.data, "mediaUrl, tipo, ids y estado quedan iguales");
  const data = (rawPayload as ReturnType<typeof payloadDeWaha>).evolution.data as Record<string, unknown>;
  assert.equal(data.status, "DELIVERY_ACK");
  assert.equal(data.mimetype, "image/jpeg");
  assert.deepEqual(data.key, { id: "WA1", fromMe: false });
  assert.deepEqual(data.message, { imageMessage: { mimetype: "image/jpeg", jpegThumbnail: "mini", caption: "mire" } });
  const guardados = (rawPayload as Record<string, unknown>).archivosGuardados as Array<Record<string, unknown>>;
  assert.equal(guardados.length, 1);
  assert.equal(guardados[0].ruta, "evolution.data.base64");
  assert.equal(guardados[0].enlace, `/uploads/chat-media/${sha}.jpg`);
  assert.equal(guardados[0].bytes, archivo.length);
  assert.equal(guardados[0].sha256, sha);
  assert.equal(guardados[0].tipo, "image/jpeg");
  assert.deepEqual(avisos, []);
});

test("texto (el 99 %): devuelve los MISMOS args, sin tocar el disco", async () => {
  const { carpeta, opciones } = await enCarpeta();
  const args = { data: fila({ type: "TEXT", rawPayload: { source: "webhook", evolution: { data: { message: { conversation: "hola" } } } } }) };
  assert.equal(await sinArchivosEnMensaje("create", args, opciones), args);
  const sinPayload = { data: { status: "READ" }, where: { id: "m1" } };
  assert.equal(await sinArchivosEnMensaje("update", sinPayload, opciones), sinPayload);
  assert.deepEqual(await readdir(carpeta), []);
});

test("upsert: limpia create y update", async () => {
  const { carpeta, opciones } = await enCarpeta();
  const args = {
    where: { channelId_externalId: { channelId: "canal1", externalId: "WA1" } },
    create: fila(),
    update: { status: "READ", rawPayload: payloadDeWaha() },
  };
  const limpio = await sinArchivosEnMensaje("upsert", args, opciones);
  assert.ok(sinBase64(limpio.create) && sinBase64(limpio.update));
  assert.deepEqual(limpio.where, args.where);
  assert.equal(limpio.update.status, "READ");
  assert.deepEqual(await readdir(carpeta), [`${sha}.jpg`], "el mismo archivo, una sola vez");
});

test("createMany: cada fila; las que no traen archivo quedan iguales", async () => {
  const { opciones } = await enCarpeta();
  const texto = fila({ externalId: "T1", type: "TEXT", rawPayload: { source: "evolution-sync", evolution: { message: { conversation: "hola" } } } });
  const conArchivo = fila({ externalId: "H1", rawPayload: { source: "evolution-sync", evolution: { message: { videoMessage: { mimetype: "video/mp4", base64: BASE64 } } } } });
  const args = { data: [texto, conArchivo], skipDuplicates: true };
  const limpio = await sinArchivosEnMensaje("createMany", args, opciones);
  assert.equal(limpio.data[0], texto);
  assert.ok(sinBase64(limpio.data[1]));
  assert.equal(limpio.skipDuplicates, true);
  // Una sola fila como objeto (createMany acepta las dos formas).
  const una = await sinArchivosEnMensaje("createMany", { data: conArchivo }, opciones);
  assert.ok(sinBase64(una));
});

test("update y updateMany (mensaje editado): limpia el payload nuevo", async () => {
  const { opciones } = await enCarpeta();
  const update = await sinArchivosEnMensaje("update", { where: { id: "m1" }, data: { editedAt: new Date(0), rawPayload: payloadDeWaha() } }, opciones);
  assert.ok(sinBase64(update));
  assert.deepEqual(update.data.editedAt, new Date(0));
  const updateMany = await sinArchivosEnMensaje("updateMany", { where: { externalId: "WA1" }, data: { rawPayload: payloadDeWaha() } }, opciones);
  assert.ok(sinBase64(updateMany));
});

test("disco que falla: el base64 de ESA fila se queda y se anota [archivo-no-guardado]", async () => {
  const avisos: Array<{ texto: string; datos: Record<string, unknown> }> = [];
  const guardar: GuardarArchivo = async () => {
    throw new Error("ENOSPC: no space left on device");
  };
  const args = { data: fila() };
  const resultado = await sinArchivosEnMensaje("create", args, { guardar, avisar: (texto, datos) => avisos.push({ texto, datos }) });
  assert.equal(resultado, args, "se guarda como hoy");
  assert.equal(avisos.length, 1);
  assert.match(avisos[0].texto, /^\[archivo-no-guardado\]/);
  assert.equal(avisos[0].datos.messageId, "WA1");
  assert.equal(avisos[0].datos.channelId, "canal1");
  assert.equal(avisos[0].datos.peso, BASE64.length);
  assert.match(String(avisos[0].datos.error), /ENOSPC/);
});

test("disco lento: pasado el plazo se rinde, el mensaje se guarda con su base64 y no espera mas", async () => {
  const avisos: string[] = [];
  const guardar: GuardarArchivo = () => new Promise(() => {}); // nunca termina
  const args = { data: fila() };
  const inicio = Date.now();
  const resultado = await sinArchivosEnMensaje("create", args, { guardar, avisar: (texto) => avisos.push(texto), plazoPorArchivoMs: 50 });
  assert.equal(resultado, args);
  assert.ok(Date.now() - inicio < 1000);
  assert.match(avisos[0], /archivo-no-guardado/);
});

test("de dos archivos falla uno: se quita solo el que quedo guardado", async () => {
  const { carpeta } = await enCarpeta();
  let llamadas = 0;
  const guardar: GuardarArchivo = async (input) => {
    llamadas += 1;
    if (llamadas === 2) throw new Error("falla el segundo");
    return guardarBytesDeChat({ ...input, carpeta });
  };
  const otro = randomBytes(8000).toString("base64");
  const args = {
    data: fila({ rawPayload: { evolution: { data: [{ base64: BASE64 }, { base64: otro }] } } }),
  };
  const limpio = await sinArchivosEnMensaje("create", args, { guardar, avisar: () => {} });
  const texto = JSON.stringify(limpio);
  assert.equal(texto.includes(BASE64), false);
  assert.equal(texto.includes(otro), true);
});

test("base64 roto o args raros: no lanza y devuelve lo mismo", async () => {
  const { opciones } = await enCarpeta();
  const roto = { data: fila({ rawPayload: { evolution: { data: { base64: "!".repeat(6000) } } } }) };
  assert.equal(await sinArchivosEnMensaje("create", roto, opciones), roto);
  for (const raro of [null, undefined, 5, "x", { data: null }, { data: [null, 3] }, { create: null, update: undefined }]) {
    assert.equal(await sinArchivosEnMensaje("create", raro, opciones), raro);
    assert.equal(await sinArchivosEnMensaje("upsert", raro, opciones), raro);
  }
  // Un guardar que lanza algo que no es Error, y un avisar que tambien lanza: igual no rompe.
  const args = { data: fila() };
  const resultado = await sinArchivosEnMensaje("create", args, {
    guardar: () => Promise.reject("raro"),
    avisar: () => {
      throw new Error("el log fallo");
    },
  });
  assert.equal(resultado, args);
});
