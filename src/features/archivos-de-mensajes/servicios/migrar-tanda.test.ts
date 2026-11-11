import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

import { servirArchivoSubido } from "@/lib/archivos-subidos";

import { migrarTanda, type BaseDeLaMigracion, type Dependencias } from "./migrar-tanda";

/*
  La tanda de la migracion contra un Postgres embebido (PGlite) y una carpeta temporal como
  /uploads. La comprobacion "por HTTP" usa la ruta de /uploads de verdad (servirArchivoSubido con HEAD).
  No toca ninguna base real ni ningun disco de produccion.
*/

const db = new PGlite();
let raiz = "";
let progreso: string | null = null;
let antesDelUpdate: ((sql: string, params: unknown[]) => Promise<void>) | null = null;

const base: BaseDeLaMigracion = {
  async consultar(sql, params = []) {
    if (antesDelUpdate && /^\s*UPDATE/i.test(sql)) await antesDelUpdate(sql, params);
    return db.transaction(async (tx) => {
      await tx.exec("SET LOCAL statement_timeout = '5s'");
      await tx.exec("SET LOCAL lock_timeout = '1s'");
      return (await tx.query(sql, params)).rows as never;
    });
  },
  async leerProgreso() {
    return progreso;
  },
  async guardarProgreso(valor) {
    progreso = valor;
  },
};

const comprobarPorHttp = async (enlace: string, bytes: number) => {
  const segmentos = enlace.replace(/^\/uploads\//, "").split("/");
  const respuesta = await servirArchivoSubido(new Request(`http://x${enlace}`, { method: "HEAD" }), segmentos, {
    raiz: path.join(raiz, "uploads"),
    soloEncabezados: true,
  });
  return respuesta.status === 200 && Number(respuesta.headers.get("content-length")) === bytes;
};

let convertidos = 0;
function deps(extra: Partial<Dependencias> = {}): Dependencias {
  return {
    base,
    raizDeUploads: path.join(raiz, "uploads"),
    medirCarga: async () => null,
    comprobarPorHttp,
    probarEnlaceExterno: async (url) => url.includes("abre"),
    convertirAudio: async () => {
      convertidos += 1;
      return "/uploads/chat-media/convertido.m4a";
    },
    ahora: () => new Date("2026-11-11T15:00:00.000Z"),
    ...extra,
  };
}

// Mas de 64 KB despues de comprimir: bytes al azar no se comprimen.
const grande = () => randomBytes(120_000);
const sha = (datos: Buffer) => createHash("sha256").update(datos).digest("hex");
const archivos: Record<string, Buffer> = {};

async function sembrar() {
  await db.exec(`DROP TABLE IF EXISTS "Message"; CREATE TABLE "Message" (
    "id" text PRIMARY KEY, "type" text NOT NULL, "mediaUrl" text, "rawPayload" jsonb)`);
  const filas: Array<[string, string, string | null, unknown]> = [];
  const conArchivo = (id: string, tipo: string, mediaUrl: string | null, armar: (b64: string) => unknown) => {
    archivos[id] = grande();
    filas.push([id, tipo, mediaUrl, armar(archivos[id].toString("base64"))]);
  };
  conArchivo("m01", "DOCUMENT", "https://waha-1.magilus.com/api/files/linea/abc.pdf", (b64) => ({
    source: "webhook",
    evolution: { data: { key: { id: "A" }, status: "READ", base64: b64, mimetype: "application/pdf", message: { documentMessage: { fileName: "catalogo.pdf", mimetype: "application/pdf" } } } },
  }));
  filas.push(["m02", "TEXT", null, { source: "webhook", evolution: { data: { message: { conversation: "hola" } } } }]);
  conArchivo("m03", "IMAGE", "/uploads/chat-media/ya-esta.jpg", (b64) => ({
    source: "webhook",
    evolution: { data: { message: { imageMessage: { mimetype: "image/jpeg", jpegThumbnail: "mini" }, base64: b64 } } },
  }));
  archivos.m04 = grande();
  filas.push(["m04", "IMAGE", `data:image/png;base64,${archivos.m04.toString("base64")}`, { source: "evolution-sync" }]);
  conArchivo("m05", "VIDEO", "https://otro.servidor/abre/video.mp4", (b64) => ({
    evolution: { data: { Message: { VideoMessage: { Mimetype: "video/mp4" }, base64: b64 } } },
  }));
  conArchivo("m06", "AUDIO", null, (b64) => ({ evolution: { data: { message: { audioMessage: { mimetype: "audio/ogg" }, base64: b64 } } } }));
  // Roto: no es base64 (y al azar, para que pese de verdad despues de comprimir).
  filas.push(["m07", "DOCUMENT", null, { evolution: { data: { base64: `${randomBytes(90_000).toString("base64")}!!!!` } } }]);
  conArchivo("m08", "DOCUMENT", "https://otro.servidor/muerto.pdf", (b64) => ({
    evolution: { data: { base64: b64, mimetype: "application/pdf" } },
  }));
  for (const [id, tipo, mediaUrl, payload] of filas) {
    await db.query(`INSERT INTO "Message" VALUES ($1, $2, $3, $4::jsonb)`, [id, tipo, mediaUrl, JSON.stringify(payload)]);
  }
}

async function foto() {
  return (await db.query<{ id: string; mediaUrl: string | null; rawPayload: unknown }>(`SELECT "id", "mediaUrl", "rawPayload" FROM "Message" ORDER BY "id"`)).rows;
}

async function enDisco() {
  return (await readdir(path.join(raiz, "uploads", "chat-media")).catch(() => [] as string[])).sort();
}

before(async () => {
  raiz = await mkdtemp(path.join(tmpdir(), "migracion-"));
});

after(async () => {
  await db.close();
  await rm(raiz, { recursive: true, force: true }).catch(() => {});
});

beforeEach(async () => {
  progreso = null;
  antesDelUpdate = null;
  convertidos = 0;
  await rm(path.join(raiz, "uploads"), { recursive: true, force: true });
  await mkdir(path.join(raiz, "uploads", "chat-media"), { recursive: true });
  await writeFile(path.join(raiz, "uploads", "chat-media", "ya-esta.jpg"), "foto");
  await sembrar();
});

test("simulacion: cuenta todo y no escribe nada (ni base, ni disco, ni progreso)", async () => {
  const antes = await foto();
  const resultado = await migrarTanda({ tanda: 50 }, deps());
  assert.equal(resultado.simulacion, true);
  assert.equal(resultado.procesados, 7, "todos menos el de texto");
  assert.equal(resultado.migrados, 6);
  assert.deepEqual(resultado.saltados.map((s) => s.id), ["m07"]);
  assert.match(resultado.saltados[0].motivo, /base64 roto/);
  assert.deepEqual(resultado.casosDeMediaUrl, {
    externo_con_clave: 1,
    se_queda_local: 1,
    data_url: 1,
    externo_que_abre: 1,
    sin_media_url: 1,
    externo_que_no_abre: 1,
  });
  assert.ok(resultado.mbAArchivo > 0.6);
  assert.equal(resultado.terminado, true);
  assert.deepEqual(await foto(), antes);
  assert.deepEqual(await enDisco(), ["ya-esta.jpg"]);
  assert.equal(progreso, null);
  assert.equal(convertidos, 0);
});

test("de verdad: archivo en disco y verificado, base64 fuera, lo demas igual, mediaUrl segun el caso", async () => {
  const resultado = await migrarTanda({ simulacion: false, tanda: 50 }, deps());
  assert.equal(resultado.migrados, 6);
  assert.deepEqual(resultado.saltados.map((s) => s.id), ["m07"]);
  assert.ok(resultado.mbLiberadosEnBase > 0.6, `liberados ${resultado.mbLiberadosEnBase}`);

  const filas = Object.fromEntries((await foto()).map((f) => [f.id, f]));
  for (const id of ["m01", "m03", "m04", "m05", "m06", "m08"]) {
    assert.equal(JSON.stringify(filas[id]).includes(archivos[id].toString("base64")), false, `${id} sin base64`);
  }
  const m01 = filas.m01.rawPayload as { evolution: { data: Record<string, unknown> }; archivosGuardados: Array<Record<string, unknown>> };
  assert.equal(m01.evolution.data.status, "READ");
  assert.equal(m01.evolution.data.mimetype, "application/pdf");
  assert.deepEqual(m01.evolution.data.message, { documentMessage: { fileName: "catalogo.pdf", mimetype: "application/pdf" } });
  assert.deepEqual(m01.archivosGuardados, [
    {
      ruta: "evolution.data.base64",
      enlace: `/uploads/chat-media/${sha(archivos.m01)}.pdf`,
      bytes: 120_000,
      sha256: sha(archivos.m01),
      tipo: "application/pdf",
      fecha: "2026-11-11T15:00:00.000Z",
    },
  ]);
  assert.deepEqual(await readFile(path.join(raiz, "uploads", "chat-media", `${sha(archivos.m01)}.pdf`)), archivos.m01);

  assert.equal(filas.m01.mediaUrl, `/uploads/chat-media/${sha(archivos.m01)}.pdf`, "WAHA con clave -> local");
  assert.equal(filas.m03.mediaUrl, "/uploads/chat-media/ya-esta.jpg", "local que existe: no se toca");
  assert.equal(filas.m04.mediaUrl, `/uploads/chat-media/${sha(archivos.m04)}.png`, "data: -> local");
  assert.deepEqual(filas.m04.rawPayload, { source: "evolution-sync" });
  assert.equal(filas.m05.mediaUrl, "https://otro.servidor/abre/video.mp4", "externo que abre: se queda");
  assert.equal(filas.m06.mediaUrl, "/uploads/chat-media/convertido.m4a", "audio: la copia convertida de siempre");
  assert.equal(convertidos, 1);
  assert.equal(filas.m08.mediaUrl, `/uploads/chat-media/${sha(archivos.m08)}.pdf`, "externo muerto -> local");
  assert.match(String(filas.m07.rawPayload && JSON.stringify(filas.m07.rawPayload)), /!!!!/, "el roto queda como estaba");
  assert.ok((await enDisco()).includes("ya-esta.jpg"), "nunca se borra un archivo");

  const guardado = JSON.parse(progreso!);
  assert.equal(guardado.ultimoId, "m08");
  assert.equal(guardado.totales.migrados, 6);
  assert.equal(guardado.saltados.length, 1);

  // Segunda corrida: idempotente, no queda nada pesado.
  const otra = await migrarTanda({ simulacion: false, tanda: 50, desdeId: "" }, deps());
  assert.equal(otra.migrados, 0);
  assert.deepEqual(otra.saltados.map((s) => s.id), ["m07"]);
});

test("por tandas: sigue desde el progreso guardado", async () => {
  const primera = await migrarTanda({ simulacion: false, tanda: 2 }, deps());
  assert.equal(primera.procesados, 2);
  assert.equal(primera.ultimoId, "m03");
  assert.equal(primera.terminado, false);
  const segunda = await migrarTanda({ simulacion: false, tanda: 2 }, deps());
  assert.deepEqual(segunda.ultimoId, "m05");
  assert.equal(JSON.parse(progreso!).totales.procesados, 4);
});

test("si la app no sirve el archivo con el tamano esperado: no se actualiza nada", async () => {
  const antes = await foto();
  const resultado = await migrarTanda({ simulacion: false, tanda: 50 }, deps({ comprobarPorHttp: async () => false }));
  assert.equal(resultado.migrados, 0);
  assert.ok(resultado.saltados.every((s) => /no sirve|base64 roto/.test(s.motivo)));
  assert.deepEqual(await foto(), antes);
});

test("si la fila cambio en el medio (el WHERE no coincide): 0 filas, se anota y no se pisa", async () => {
  antesDelUpdate = async (_sql, params) => {
    if (params[0] === "m01") {
      await db.query(`UPDATE "Message" SET "rawPayload" = jsonb_set("rawPayload", '{evolution,data,base64}', to_jsonb($1::text)) WHERE "id" = 'm01'`, [
        randomBytes(100_000).toString("base64"),
      ]);
    }
  };
  const resultado = await migrarTanda({ simulacion: false, tanda: 1 }, deps());
  assert.equal(resultado.migrados, 0);
  assert.deepEqual(resultado.saltados, [{ id: "m01", motivo: "cambio mientras se migraba; reintentar" }]);
  const [m01] = await foto();
  assert.equal((m01.rawPayload as { archivosGuardados?: unknown }).archivosGuardados, undefined);
  assert.equal(m01.mediaUrl, "https://waha-1.magilus.com/api/files/linea/abc.pdf");
});

test("payload con base64 Y mediaUrl data: distinto: se guardan los dos y mediaUrl apunta al suyo", async () => {
  await db.exec(`DELETE FROM "Message"`);
  const delPayload = grande();
  const delMediaUrl = grande();
  await db.query(`INSERT INTO "Message" VALUES ('m20', 'IMAGE', $1, $2::jsonb)`, [
    `data:image/png;base64,${delMediaUrl.toString("base64")}`,
    JSON.stringify({ evolution: { data: { base64: delPayload.toString("base64"), mimetype: "image/jpeg" } } }),
  ]);
  const resultado = await migrarTanda({ simulacion: false }, deps());
  assert.equal(resultado.migrados, 1);
  const [m20] = await foto();
  assert.equal(m20.mediaUrl, `/uploads/chat-media/${sha(delMediaUrl)}.png`);
  assert.equal(JSON.stringify(m20).includes(delPayload.toString("base64")), false);
  const nombres = await enDisco();
  assert.ok(nombres.includes(`${sha(delPayload)}.jpg`) && nombres.includes(`${sha(delMediaUrl)}.png`));
});

test("freno por carga: no empieza", async () => {
  const antes = await foto();
  const resultado = await migrarTanda({ simulacion: false }, deps({ medirCarga: async () => "cpu 0.95 por nucleo" }));
  assert.equal(resultado.parado, "carga: cpu 0.95 por nucleo");
  assert.equal(resultado.procesados, 0);
  assert.deepEqual(await foto(), antes);
  assert.equal(progreso, null);
});

test("un archivo que ya esta en disco con otro contenido: no se pisa y el mensaje se salta", async () => {
  const nombre = `${sha(archivos.m01)}.pdf`;
  await writeFile(path.join(raiz, "uploads", "chat-media", nombre), "otro contenido");
  const resultado = await migrarTanda({ simulacion: false, tanda: 1 }, deps());
  assert.equal(resultado.migrados, 0);
  assert.match(resultado.saltados[0].motivo, /no se pudo guardar/);
  assert.equal(await readFile(path.join(raiz, "uploads", "chat-media", nombre), "utf8"), "otro contenido");
});
