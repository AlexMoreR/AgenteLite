import { test } from "node:test";
import assert from "node:assert/strict";
import webpush from "web-push";

import { lineaDeFalla, queHacerConFallaDePush } from "./linea-de-falla";
// El mismo criterio que usa la vigilancia de 30 minutos para decidir si una linea es una falla.
import { esLineaDeErrorReal } from "../../trabajador-tablero/lib/zonas.mjs";

/*
  Las fallas del push y del webhook de Evolution quedan en UNA linea: un corte de red pasajero va
  como informativo (la vigilancia no lo cuenta) y una falla de verdad sigue contando.
*/

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abcdefghijklmnopqrstuvwxyz0123456789";
// Lo que lanza el DNS cuando no encuentra el servidor de Google un momento.
const EAI_AGAIN = Object.assign(new Error("getaddrinfo EAI_AGAIN fcm.googleapis.com"), {
  code: "EAI_AGAIN",
  errno: -3001,
  syscall: "getaddrinfo",
  hostname: "fcm.googleapis.com",
});
// Lo que lanza fetch con AbortSignal.timeout() (src/lib/waha.ts:163).
const TIEMPO = new DOMException("The operation was aborted due to timeout", "TimeoutError");
/** El error de web-push cuando el servicio contesta con un codigo que no es 2xx. */
function errorDePush(statusCode: number) {
  return new webpush.WebPushError("Received unexpected response code", statusCode, {}, "boom", ENDPOINT);
}
/** Un error de Prisma: mensaje de varias lineas y `code` Pxxxx. */
const PRISMA_P2002 = Object.assign(
  new Error(
    "\nInvalid `prisma.message.update()` invocation in\n/app/.next/server/chunks/123.js:1:2\n\nUnique constraint failed on the fields: (`externalId`)",
  ),
  { name: "PrismaClientKnownRequestError", code: "P2002" },
);

/** Comun a todas las lineas: una sola linea, empieza como se espera y el JSON se puede leer. */
function comprobarUnaLinea(linea: string, comienzo: string) {
  assert.ok(!/[\r\n]/.test(linea), `una sola linea: ${JSON.stringify(linea)}`);
  assert.ok(linea.startsWith(`${comienzo} {`), linea);
  return JSON.parse(linea.slice(comienzo.length + 1)) as Record<string, unknown>;
}

test("push con EAI_AGAIN: informativa, una linea, sin la palabra error", () => {
  const resultado = queHacerConFallaDePush(ENDPOINT, undefined, EAI_AGAIN);
  assert.notEqual(resultado, "podar");
  if (resultado === "podar") return;
  assert.equal(resultado.nivel, "info");
  const datos = comprobarUnaLinea(resultado.linea, "[web-push] no_entregado");
  assert.deepEqual(datos, { endpoint: ENDPOINT.slice(0, 48), statusCode: null, causa: "sin-conexion" });
  assert.ok(!/error/i.test(resultado.linea), resultado.linea);
  assert.equal(esLineaDeErrorReal(resultado.linea), false, resultado.linea);
});

test("push con tiempo agotado: informativa", () => {
  const resultado = queHacerConFallaDePush(ENDPOINT, undefined, TIEMPO);
  assert.notEqual(resultado, "podar");
  if (resultado === "podar") return;
  assert.equal(resultado.nivel, "info");
  const datos = comprobarUnaLinea(resultado.linea, "[web-push] no_entregado");
  assert.equal(datos.causa, "tardo-demasiado");
  assert.equal(esLineaDeErrorReal(resultado.linea), false, resultado.linea);
});

test("push con 500: aviso, una linea, con statusCode 500 y el texto corto", () => {
  const error = errorDePush(500);
  const resultado = queHacerConFallaDePush(ENDPOINT, error.statusCode, error);
  assert.notEqual(resultado, "podar");
  if (resultado === "podar") return;
  assert.equal(resultado.nivel, "warn");
  const datos = comprobarUnaLinea(resultado.linea, "[web-push] send_failed");
  assert.equal(datos.statusCode, 500);
  assert.equal(datos.endpoint, ENDPOINT.slice(0, 48));
  assert.equal(datos.error, "Received unexpected response code");
  assert.equal(typeof datos.causa, "string");
  assert.equal(esLineaDeErrorReal(resultado.linea), true, resultado.linea);
});

test("push con 410 y 404: se poda la suscripcion, sin linea", () => {
  assert.equal(queHacerConFallaDePush(ENDPOINT, 410, errorDePush(410)), "podar");
  assert.equal(queHacerConFallaDePush(ENDPOINT, 404, errorDePush(404)), "podar");
});

test("webhook: timeout en gap_sync_error → informativa, etiqueta 'gap_sync corte', sin error", () => {
  const { linea, nivel } = lineaDeFalla("[EVOLUTION]", "gap_sync_error", { instanceName: "ventas-1", channelId: "c1" }, TIEMPO, "error");
  assert.equal(nivel, "info");
  const datos = comprobarUnaLinea(linea, "[EVOLUTION] gap_sync corte");
  assert.deepEqual(datos, { instanceName: "ventas-1", channelId: "c1", causa: "tardo-demasiado" });
  assert.ok(!/error|failed|fallo/i.test(linea), linea);
  assert.equal(esLineaDeErrorReal(linea), false, linea);
});

test("webhook: las etiquetas de corte pierden el final de falla", () => {
  const casos: Array<[string, string, string]> = [
    ["[EVOLUTION]", "media_persist_failed", "[EVOLUTION] media_persist corte"],
    ["[EVOLUTION]", "v3_asignar_fallo", "[EVOLUTION] v3_asignar corte"],
    ["[EVOLUTION]", "agent_v2_stage_follows_error", "[EVOLUTION] agent_v2_stage_follows corte"],
    ["[reparto-por-turno]", "fallo", "[reparto-por-turno] corte"],
    ["[EVOLUTION]", "no se pudo resolver el LID del telefono", "[EVOLUTION] no se pudo resolver el LID del telefono corte"],
  ];
  for (const [prefijo, etiqueta, comienzo] of casos) {
    const { linea, nivel } = lineaDeFalla(prefijo, etiqueta, { conversationId: "conv-1" }, EAI_AGAIN, "warn");
    assert.equal(nivel, "info", linea);
    comprobarUnaLinea(linea, comienzo);
    assert.equal(esLineaDeErrorReal(linea), false, linea);
  }
});

test("webhook: error de Prisma de varias lineas en media_persist_failed → aviso, una linea, texto cortado", () => {
  const { linea, nivel } = lineaDeFalla("[EVOLUTION]", "media_persist_failed", { messageId: "m1" }, PRISMA_P2002, "warn");
  assert.equal(nivel, "warn");
  const datos = comprobarUnaLinea(linea, "[EVOLUTION] media_persist_failed");
  assert.deepEqual(datos, {
    messageId: "m1",
    causa: "base-P2002",
    codigo: "P2002",
    error: "Invalid `prisma.message.update()` invocation in",
  });
  assert.equal(esLineaDeErrorReal(linea), true, linea);
});

test("webhook: el texto corto no pasa de 200 letras", () => {
  const { linea } = lineaDeFalla("[EVOLUTION]", "welcome_flow_failed", {}, new Error("x".repeat(500)), "warn");
  const datos = comprobarUnaLinea(linea, "[EVOLUTION] welcome_flow_failed");
  assert.equal(String(datos.error).length, 200);
});

test("v3_error y auto_reply_failed siguen como error aunque el corte sea pasajero", () => {
  for (const etiqueta of ["v3_error", "auto_reply_failed"]) {
    for (const error of [TIEMPO, EAI_AGAIN]) {
      const { linea, nivel } = lineaDeFalla("[EVOLUTION]", etiqueta, { conversationId: "conv-1" }, error, "error");
      assert.equal(nivel, "error", linea);
      const datos = comprobarUnaLinea(linea, `[EVOLUTION] ${etiqueta}`);
      assert.equal(typeof datos.error, "string");
      assert.equal(esLineaDeErrorReal(linea), true, linea);
    }
  }
});
