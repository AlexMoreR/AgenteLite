// Pruebas de las firmas del módulo Reuniones: los links firmados para escuchar los audios
// (link-firmado.ts), la firma de los avisos de LiveKit y el pase de entrada a la sala (livekit.ts).
// Correr: npm run test:reuniones-link-firmado
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cargar } from "./supervisor-cargar.mjs";

const { linkFirmado, linkFirmadoValido, LINK_DURA_MS, identidadFirmada, leerIdentidadFirmada } = cargar("src/features/reuniones/servicios/link-firmado.ts");
const { firmarJwt, verificarJwt, crearPaseDeEntrada, verificarAvisoDeLivekit, urlDeLaApi, PASE_SEGUNDOS } = cargar(
  "src/features/reuniones/servicios/livekit.ts",
);

let casos = 0;
const prueba = (nombre, fn) => {
  fn();
  casos += 1;
  console.log(`ok - ${nombre}`);
};

const SECRETO = "secreto-de-prueba-del-crm";
const AHORA = Date.parse("2026-10-23T15:00:00.000Z");

/** Saca vence y firma de un link firmado. */
function partes(link) {
  const url = new URL(link, "https://crm.local");
  return {
    pistaId: decodeURIComponent(url.pathname.split("/").at(-1)),
    vence: url.searchParams.get("vence"),
    firma: url.searchParams.get("firma"),
  };
}

// ── Links firmados de los audios ─────────────────────────────────────────────────────────────
prueba("link firmado válido: ruta, vence en 1 hora y firma que se acepta", () => {
  const link = linkFirmado("pista_1", SECRETO, AHORA);
  assert.match(link, /^\/api\/reuniones\/audio\/pista_1\?vence=\d+&firma=[A-Za-z0-9_-]+$/);
  const { pistaId, vence, firma } = partes(link);
  assert.equal(pistaId, "pista_1");
  assert.equal(Number(vence), AHORA + LINK_DURA_MS);
  assert.equal(LINK_DURA_MS, 60 * 60 * 1000);
  assert.equal(linkFirmadoValido(pistaId, vence, firma, SECRETO, AHORA), true);
  // Sigue sirviendo justo antes de vencer.
  assert.equal(linkFirmadoValido(pistaId, vence, firma, SECRETO, AHORA + LINK_DURA_MS), true);
});

prueba("link vencido no sirve", () => {
  const { pistaId, vence, firma } = partes(linkFirmado("pista_1", SECRETO, AHORA));
  assert.equal(linkFirmadoValido(pistaId, vence, firma, SECRETO, AHORA + LINK_DURA_MS + 1), false);
});

prueba("link alterado no sirve: firma, pistaId o vence cambiados, u otro secreto", () => {
  const { pistaId, vence, firma } = partes(linkFirmado("pista_1", SECRETO, AHORA));
  const otraFirma = (firma[0] === "A" ? "B" : "A") + firma.slice(1);
  assert.equal(linkFirmadoValido(pistaId, vence, otraFirma, SECRETO, AHORA), false);
  assert.equal(linkFirmadoValido(pistaId, vence, firma.slice(0, -1), SECRETO, AHORA), false);
  assert.equal(linkFirmadoValido("pista_2", vence, firma, SECRETO, AHORA), false);
  assert.equal(linkFirmadoValido(pistaId, String(Number(vence) - 1000), firma, SECRETO, AHORA), false);
  assert.equal(linkFirmadoValido(pistaId, vence, firma, "otro-secreto", AHORA), false);
});

prueba("link sin firma o con vence que no es número no sirve", () => {
  const { pistaId, vence, firma } = partes(linkFirmado("pista_1", SECRETO, AHORA));
  assert.equal(linkFirmadoValido(pistaId, vence, null, SECRETO, AHORA), false);
  assert.equal(linkFirmadoValido(pistaId, vence, "", SECRETO, AHORA), false);
  assert.equal(linkFirmadoValido(pistaId, null, firma, SECRETO, AHORA), false);
  assert.equal(linkFirmadoValido(pistaId, "mañana", firma, SECRETO, AHORA), false);
});

prueba("un vence demasiado lejano se rechaza aunque la firma sea correcta", () => {
  // Alguien con el secreto (o un error) firmó un link que vence en 1 día: no se acepta.
  const lejos = AHORA + 24 * LINK_DURA_MS;
  const { vence, firma } = partes(linkFirmado("pista_1", SECRETO, lejos - LINK_DURA_MS));
  assert.equal(Number(vence), lejos);
  assert.equal(linkFirmadoValido("pista_1", vence, firma, SECRETO, AHORA), false);
  // Dentro del minuto de margen sí.
  const { vence: cerca, firma: firmaCerca } = partes(linkFirmado("pista_1", SECRETO, AHORA + 30_000));
  assert.equal(linkFirmadoValido("pista_1", cerca, firmaCerca, SECRETO, AHORA), true);
});

prueba("pistaId con caracteres raros va codificado en la ruta y la firma sigue sirviendo", () => {
  const { pistaId, vence, firma } = partes(linkFirmado("a b/c", SECRETO, AHORA));
  assert.equal(pistaId, "a b/c");
  assert.equal(linkFirmadoValido(pistaId, vence, firma, SECRETO, AHORA), true);
});

// ── Avisos de LiveKit ────────────────────────────────────────────────────────────────────────
const CONFIG = { apiKey: "APIclave", apiSecret: "secreto-de-livekit" };
const CUERPO = JSON.stringify({ event: "room_finished", room: { name: "reunion-abc" } });
const sha = (texto) => createHash("sha256").update(texto, "utf8").digest("base64");
const ahoraS = Math.floor(AHORA / 1000);
const avisoFirmado = (cambios = {}, secreto = CONFIG.apiSecret) =>
  firmarJwt({ iss: CONFIG.apiKey, sha256: sha(CUERPO), exp: ahoraS + 300, ...cambios }, secreto);

prueba("aviso de LiveKit válido se acepta", () => {
  assert.equal(verificarAvisoDeLivekit(CUERPO, avisoFirmado(), CONFIG, AHORA), true);
});

prueba("aviso con 'Bearer ' adelante también se acepta", () => {
  assert.equal(verificarAvisoDeLivekit(CUERPO, `Bearer ${avisoFirmado()}`, CONFIG, AHORA), true);
  assert.equal(verificarAvisoDeLivekit(CUERPO, `bearer   ${avisoFirmado()}`, CONFIG, AHORA), true);
});

prueba("aviso con sha256 sin relleno o en base64url se acepta", () => {
  const sinRelleno = sha(CUERPO).replace(/=+$/, "");
  const url = createHash("sha256").update(CUERPO, "utf8").digest("base64url");
  assert.equal(verificarAvisoDeLivekit(CUERPO, avisoFirmado({ sha256: sinRelleno }), CONFIG, AHORA), true);
  assert.equal(verificarAvisoDeLivekit(CUERPO, avisoFirmado({ sha256: url }), CONFIG, AHORA), true);
});

prueba("aviso con el cuerpo alterado se rechaza", () => {
  const alterado = CUERPO.replace("room_finished", "room_started");
  assert.equal(verificarAvisoDeLivekit(alterado, avisoFirmado(), CONFIG, AHORA), false);
  assert.equal(verificarAvisoDeLivekit(`${CUERPO} `, avisoFirmado(), CONFIG, AHORA), false);
});

prueba("aviso de otra clave (iss) se rechaza", () => {
  assert.equal(verificarAvisoDeLivekit(CUERPO, avisoFirmado({ iss: "OTRAclave" }), CONFIG, AHORA), false);
  assert.equal(verificarAvisoDeLivekit(CUERPO, avisoFirmado({ iss: undefined }), CONFIG, AHORA), false);
});

prueba("aviso firmado con otro secreto se rechaza", () => {
  assert.equal(verificarAvisoDeLivekit(CUERPO, avisoFirmado({}, "otro-secreto"), CONFIG, AHORA), false);
});

prueba("aviso vencido se rechaza (con un minuto de margen)", () => {
  assert.equal(verificarAvisoDeLivekit(CUERPO, avisoFirmado({ exp: ahoraS - 61 }), CONFIG, AHORA), false);
  assert.equal(verificarAvisoDeLivekit(CUERPO, avisoFirmado({ exp: ahoraS - 30 }), CONFIG, AHORA), true);
});

prueba("aviso sin Authorization, vacío o sin sha256 se rechaza", () => {
  assert.equal(verificarAvisoDeLivekit(CUERPO, null, CONFIG, AHORA), false);
  assert.equal(verificarAvisoDeLivekit(CUERPO, "", CONFIG, AHORA), false);
  assert.equal(verificarAvisoDeLivekit(CUERPO, "Bearer ", CONFIG, AHORA), false);
  assert.equal(verificarAvisoDeLivekit(CUERPO, "no.es.jwt", CONFIG, AHORA), false);
  assert.equal(verificarAvisoDeLivekit(CUERPO, avisoFirmado({ sha256: undefined }), CONFIG, AHORA), false);
});

prueba("verificarJwt rechaza alg distinto de HS256, partes de más y nbf futuro", () => {
  const token = firmarJwt({ a: 1 }, "s");
  assert.deepEqual(verificarJwt(token, "s", AHORA), { a: 1 });
  const [, datos, firma] = token.split(".");
  const cabeceraNone = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  assert.equal(verificarJwt(`${cabeceraNone}.${datos}.${firma}`, "s", AHORA), null);
  assert.equal(verificarJwt(`${token}.extra`, "s", AHORA), null);
  assert.equal(verificarJwt(firmarJwt({ nbf: ahoraS + 120 }, "s"), "s", AHORA), null);
});

// ── Pase de entrada ──────────────────────────────────────────────────────────────────────────
prueba("crearPaseDeEntrada: dura 10 minutos, entra solo a su sala y sin roomAdmin ni roomRecord", () => {
  const pase = crearPaseDeEntrada(CONFIG, { sala: "reunion-abc", identidad: "u_alex", nombre: "Alex", ahoraMs: AHORA });
  const cuerpo = JSON.parse(Buffer.from(pase.split(".")[1], "base64url").toString("utf8"));
  assert.equal(PASE_SEGUNDOS, 600);
  assert.equal(cuerpo.exp - ahoraS, 600);
  assert.equal(cuerpo.iss, CONFIG.apiKey);
  assert.equal(cuerpo.sub, "u_alex");
  assert.equal(cuerpo.name, "Alex");
  assert.equal(cuerpo.video.room, "reunion-abc");
  assert.equal(cuerpo.video.roomJoin, true);
  assert.equal("roomAdmin" in cuerpo.video, false);
  assert.equal("roomRecord" in cuerpo.video, false);
  assert.equal("roomCreate" in cuerpo.video, false);
  assert.equal("roomList" in cuerpo.video, false);
  // El pase deja publicar el micrófono y la pantalla (con su audio), nunca la cámara.
  assert.deepEqual(cuerpo.video.canPublishSources, ["microphone", "screen_share", "screen_share_audio"]);
  // Firmado con el secreto: se verifica con él y no con otro.
  assert.ok(verificarJwt(pase, CONFIG.apiSecret, AHORA));
  assert.equal(verificarJwt(pase, "otro", AHORA), null);
  // A los 11 minutos (más el minuto de margen) ya no sirve.
  assert.equal(verificarJwt(pase, CONFIG.apiSecret, AHORA + 11 * 60_000 + 1000), null);
});

prueba("urlDeLaApi: wss -> https, ws -> http y sin barra al final", () => {
  assert.equal(urlDeLaApi("wss://video.magilus.com"), "https://video.magilus.com");
  assert.equal(urlDeLaApi("WSS://video.magilus.com/"), "https://video.magilus.com");
  assert.equal(urlDeLaApi("ws://localhost:7880//"), "http://localhost:7880");
  assert.equal(urlDeLaApi("https://ya.es"), "https://ya.es");
});

prueba("aviso de LiveKit sin vencimiento (exp) se rechaza", () => {
  const cuerpo = JSON.stringify({ event: "room_finished" });
  const sha256 = createHash("sha256").update(cuerpo).digest("base64");
  const token = firmarJwt({ iss: CONFIG.apiKey, sha256 }, CONFIG.apiSecret);
  assert.equal(verificarAvisoDeLivekit(cuerpo, token, CONFIG, AHORA), false);
});

prueba("identidad del invitado: vuelve firmada, y una ajena o alterada no se acepta", () => {
  const firmada = identidadFirmada("i_abcdefghij12", "secreto");
  assert.equal(leerIdentidadFirmada(firmada, "secreto"), "i_abcdefghij12");
  assert.equal(leerIdentidadFirmada(firmada, "otro"), null);
  assert.equal(leerIdentidadFirmada("i_abcdefghij12", "secreto"), null);
  assert.equal(leerIdentidadFirmada(firmada.replace("i_abc", "i_xyz"), "secreto"), null);
});

prueba("link firmado: el vencimiento va redondeado (no cambia en cada refresco) y dura entre 50 y 60 min", () => {
  const a = linkFirmado("pista-1", "secreto", AHORA);
  const b = linkFirmado("pista-1", "secreto", AHORA + 15_000);
  const vence = Number(new URL(a, "http://x").searchParams.get("vence"));
  assert.ok(vence - AHORA <= LINK_DURA_MS && vence - AHORA > LINK_DURA_MS - 10 * 60_000);
  if (Math.floor((AHORA + LINK_DURA_MS) / 600_000) === Math.floor((AHORA + 15_000 + LINK_DURA_MS) / 600_000)) {
    assert.equal(a, b);
  }
});

console.log(`\n${casos} pruebas de links firmados y firmas de LiveKit OK`);
