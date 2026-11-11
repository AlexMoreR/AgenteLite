import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import {
  CLAVE_ARCHIVOS_GUARDADOS,
  buscarArchivosEnPayload,
  decodificarBase64,
  quitarArchivosDelPayload,
  rutaComoTextoDePostgres,
  sqlPayloadSinArchivos,
} from "./payload-sin-archivos";

/*
  Pruebas del modulo puro que encuentra y saca el archivo en base64 de un rawPayload, con payloads
  armados como los que guardan de verdad el webhook (WAHA, Evolution API, evogo) y el historial.
*/

const archivo = randomBytes(9000);
const BASE64 = archivo.toString("base64");
const MINIATURA = randomBytes(3000).toString("base64"); // < 4 KB: no es un archivo
const ONDA = randomBytes(64).toString("base64");

function deWaha() {
  return {
    source: "webhook",
    evolution: {
      event: "messages.upsert",
      instance: "linea-1",
      data: {
        key: { id: "ABC123", fromMe: false, remoteJid: "573001112233@s.whatsapp.net" },
        status: "DELIVERY_ACK",
        messageType: "documentMessage",
        message: {
          documentMessage: {
            mimetype: "application/pdf",
            fileName: "catalogo.pdf",
            fileLength: 9000,
            jpegThumbnail: MINIATURA,
          },
        },
        base64: BASE64,
        mimetype: "application/pdf",
      },
    },
  };
}

function deEvolutionApi() {
  return {
    source: "webhook",
    evolution: {
      data: {
        key: { id: "EV1" },
        status: "SERVER_ACK",
        message: {
          audioMessage: { mimetype: "audio/ogg; codecs=opus", seconds: 7, waveform: ONDA, ptt: true },
          base64: BASE64,
        },
      },
    },
  };
}

function deEvogo() {
  return {
    source: "webhook",
    evolution: {
      data: {
        Info: { ID: "EG1", Type: "media" },
        Message: {
          ImageMessage: { Mimetype: "image/jpeg", JPEGThumbnail: MINIATURA, FileLength: 9000 },
          base64: BASE64,
        },
      },
    },
  };
}

test("WAHA: encuentra data.base64 con el mimetype y el nombre del documento", () => {
  const encontrados = buscarArchivosEnPayload(deWaha());
  assert.equal(encontrados.length, 1);
  assert.deepEqual(encontrados[0].ruta, ["evolution", "data", "base64"]);
  assert.equal(encontrados[0].mimetype, "application/pdf");
  assert.equal(encontrados[0].nombre, "catalogo.pdf");
  assert.equal(encontrados[0].texto, BASE64);
});

test("Evolution API: data.message.base64, mimetype del audioMessage hermano", () => {
  const [encontrado] = buscarArchivosEnPayload(deEvolutionApi());
  assert.deepEqual(encontrado.ruta, ["evolution", "data", "message", "base64"]);
  assert.equal(encontrado.mimetype, "audio/ogg; codecs=opus");
});

test("evogo: data.Message.base64, mimetype con mayuscula", () => {
  const [encontrado] = buscarArchivosEnPayload(deEvogo());
  assert.deepEqual(encontrado.ruta, ["evolution", "data", "Message", "base64"]);
  assert.equal(encontrado.mimetype, "image/jpeg");
});

test("historial y respuestas de envio: base64 en evolution.message y dentro de un <tipo>Message", () => {
  const historial = {
    source: "evolution-sync",
    evolution: {
      key: { id: "H1" },
      message: {
        documentWithCaptionMessage: {
          message: { documentMessage: { mimetype: "application/pdf", fileName: "a.pdf", base64: BASE64 } },
        },
        videoMessage: { mimetype: "video/mp4", base64: BASE64 },
      },
    },
  };
  const rutas = buscarArchivosEnPayload(historial).map((a) => a.ruta.join("."));
  assert.deepEqual(rutas.sort(), [
    "evolution.message.documentWithCaptionMessage.message.documentMessage.base64",
    "evolution.message.videoMessage.base64",
  ]);
  const documento = buscarArchivosEnPayload(historial).find((a) => a.ruta.includes("documentMessage"))!;
  assert.equal(documento.nombre, "a.pdf");
});

test("una lista en data: encuentra cada elemento con su indice", () => {
  const payload = { evolution: { data: [{ message: { base64: BASE64 } }, { key: { id: "x" } }, { base64: BASE64 }] } };
  const rutas = buscarArchivosEnPayload(payload).map((a) => a.ruta.join("."));
  assert.deepEqual(rutas.sort(), ["evolution.data.0.message.base64", "evolution.data.2.base64"]);
});

test("texto, base64 chico, miniatura y onda: no encuentra nada", () => {
  assert.deepEqual(buscarArchivosEnPayload({ source: "webhook", evolution: { data: { message: { conversation: "hola" } } } }), []);
  assert.deepEqual(buscarArchivosEnPayload({ evolution: { data: { base64: "aGVsbG8=" } } }), []);
  assert.deepEqual(buscarArchivosEnPayload(null), []);
  assert.deepEqual(buscarArchivosEnPayload("x".repeat(10000)), []);
  assert.deepEqual(buscarArchivosEnPayload([{ base64: BASE64 }]), []);
  const sinArchivo = deEvolutionApi();
  delete (sinArchivo.evolution.data.message as Record<string, unknown>).base64;
  assert.deepEqual(buscarArchivosEnPayload(sinArchivo), []);
});

test("no recorre rutas desconocidas (es rapido a proposito)", () => {
  // Un base64 en un lugar que ningun gateway usa no se busca; lo cubre stripHeavyBase64 al leer.
  assert.deepEqual(buscarArchivosEnPayload({ a: { b: { c: { base64: BASE64 } } } }), []);
  // Un JSON enorme sin base64 en las rutas conocidas no se recorre: tarda casi nada.
  const enorme = { evolution: { data: { message: { conversation: "hola" } }, otros: Array.from({ length: 200000 }, (_, i) => ({ i })) } };
  const inicio = performance.now();
  for (let i = 0; i < 1000; i += 1) buscarArchivosEnPayload(enorme);
  assert.ok(performance.now() - inicio < 200, "mil busquedas deberian tardar menos de 200 ms");
});

test("quitar: saca solo base64 y conserva todo lo que usa la pantalla; no toca el original", () => {
  const original = deWaha();
  const copiaDelOriginal = JSON.parse(JSON.stringify(original));
  const [encontrado] = buscarArchivosEnPayload(original);
  const limpio = quitarArchivosDelPayload(original, [
    {
      ruta: encontrado.ruta.join("."),
      rutaClaves: encontrado.ruta,
      enlace: "/uploads/chat-media/abc.pdf",
      bytes: 9000,
      sha256: "abc",
      tipo: "application/pdf",
      fecha: "2026-11-10T00:00:00.000Z",
    },
  ]);

  assert.deepEqual(original, copiaDelOriginal, "el payload en memoria del webhook no cambia");
  const data = limpio.evolution.data as Record<string, unknown>;
  assert.equal("base64" in data, false);
  assert.equal(data.mimetype, "application/pdf");
  assert.equal(data.status, "DELIVERY_ACK");
  assert.deepEqual(data.key, original.evolution.data.key);
  assert.deepEqual(data.message, original.evolution.data.message, "jpegThumbnail, fileName y fileLength siguen");
  assert.equal(limpio.source, "webhook");

  const guardados = (limpio as Record<string, unknown>)[CLAVE_ARCHIVOS_GUARDADOS] as Array<Record<string, unknown>>;
  assert.equal(guardados.length, 1);
  assert.deepEqual(Object.keys(guardados[0]).sort(), ["bytes", "enlace", "fecha", "ruta", "sha256", "tipo"]);
  const prohibidas = ["url", "mediaUrl", "fileName", "filename", "mimetype", "base64"];
  for (const clave of Object.keys(guardados[0])) assert.ok(!prohibidas.includes(clave), `clave prohibida ${clave}`);
});

test("quitar: varias rutas, listas, y se suma a un archivosGuardados que ya estaba", () => {
  const payload = {
    archivosGuardados: [{ ruta: "vieja" }],
    evolution: { data: [{ base64: BASE64, key: { id: "1" } }, { message: { base64: BASE64, imageMessage: { mimetype: "image/png" } } }] },
  };
  const encontrados = buscarArchivosEnPayload(payload);
  assert.equal(encontrados.length, 2);
  const limpio = quitarArchivosDelPayload(
    payload,
    encontrados.map((e) => ({ ruta: e.ruta.join("."), rutaClaves: e.ruta, enlace: "/x", bytes: 1, sha256: "s", tipo: e.mimetype, fecha: "f" })),
  );
  assert.equal(JSON.stringify(limpio).includes(BASE64), false);
  assert.deepEqual(limpio.evolution.data[0], { key: { id: "1" } });
  assert.deepEqual(limpio.evolution.data[1], { message: { imageMessage: { mimetype: "image/png" } } });
  assert.equal(limpio.archivosGuardados.length, 3);
  assert.equal(JSON.stringify(payload).includes(BASE64), true, "el original sigue entero");
});

test("decodificar: base64, data: URL, base64url sin relleno; rechaza lo roto", () => {
  assert.deepEqual(decodificarBase64(BASE64)?.bytes, archivo);
  const conPrefijo = decodificarBase64(`data:application/pdf;base64,${BASE64}`);
  assert.equal(conPrefijo?.mimetype, "application/pdf");
  assert.deepEqual(conPrefijo?.bytes, archivo);
  const corto = Buffer.from("hola mundo!");
  assert.deepEqual(decodificarBase64(corto.toString("base64url"))?.bytes, corto);
  assert.deepEqual(decodificarBase64(BASE64.replace(/(.{76})/g, "$1\n"))?.bytes, archivo, "con saltos de linea");
  assert.equal(decodificarBase64("esto no es base64 !!!"), null);
  assert.equal(decodificarBase64(`${BASE64.slice(0, -1)}`.slice(0, 4 * 100 + 1)), null, "largo imposible");
  assert.equal(decodificarBase64("data:text/plain,hola"), null, "data: sin base64");
  assert.equal(decodificarBase64(""), null);
});

test("SQL: la ruta en texto de Postgres y la expresion de recorte", () => {
  assert.equal(rutaComoTextoDePostgres(["evolution", "data", "base64"]), "{evolution,data,base64}");
  assert.equal(rutaComoTextoDePostgres(["a b", "0"]), '{"a b",0}');
  const sql = sqlPayloadSinArchivos('m."rawPayload"');
  assert.match(sql, /^CASE WHEN pg_column_size\(m\."rawPayload"\) > 65536 THEN /);
  assert.match(sql, /#- '\{evolution,data,base64\}'/);
  assert.match(sql, /#- '\{evolution,data,message,base64\}'/);
  assert.match(sql, /#- '\{evolution,data,Message,base64\}'/);
  assert.match(sql, / ELSE m\."rawPayload" END$/);
});
