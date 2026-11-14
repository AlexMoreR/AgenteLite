// Pruebas del evento de conversión para Meta (src/features/pauta/dominio/evento-de-conversion.ts):
// qué lleva el evento "Purchase" y cuándo NO se manda. Con datos de prueba, sin red ni base.
// Correr: npm run test:conversiones-meta
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

const c = cargar("src/features/pauta/dominio/evento-de-conversion.ts");
let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const AHORA = new Date("2026-11-14T15:00:00Z");
const hace = (dias) => new Date(AHORA.getTime() - dias * 24 * 60 * 60 * 1000);
const base = (cambios = {}) => ({
  venta: { categoria: "PAUTA", pagadaEn: hace(1) },
  ctwaClid: "ARclid123",
  monto: 1_250_000,
  modo: "ACTIVO",
  yaEnviado: null,
  ahora: AHORA,
  ...cambios,
});

prueba("el evento Purchase solo lleva el clid y la cuenta de WhatsApp, en COP y por mensajería", () => {
  const pagadaEn = new Date("2026-11-13T10:30:45.900Z");
  const e = c.armarEventoPurchase({ ventaDePautaId: "vp1", pagadaEn, valor: 1_250_000, ctwaClid: "ARclid123", wabaId: "WABA9" });
  assert.deepEqual(Object.keys(e.user_data).sort(), ["ctwa_clid", "whatsapp_business_account_id"]);
  assert.equal(e.user_data.ctwa_clid, "ARclid123");
  assert.equal(e.user_data.whatsapp_business_account_id, "WABA9");
  assert.equal(e.custom_data.currency, "COP");
  assert.equal(e.custom_data.value, 1_250_000);
  assert.equal(e.action_source, "business_messaging");
  assert.equal(e.messaging_channel, "whatsapp");
  assert.equal(e.event_name, "Purchase");
  assert.equal(e.event_id, "vp1");
  assert.equal(e.event_time, Math.floor(pagadaEn.getTime() / 1000));
  assert.ok(Number.isInteger(e.event_time), "segundos, no milisegundos");
  assert.deepEqual(Object.keys(e).sort(), ["action_source", "custom_data", "event_id", "event_name", "event_time", "messaging_channel", "user_data"]);
  const texto = JSON.stringify(e);
  for (const prohibido of ["ph", "phone", "telefono", "fn", "ln", "nombre", "ct", "ciudad", "em"]) {
    assert.ok(!texto.includes(`"${prohibido}"`), `no lleva ${prohibido}`);
  }
});

prueba("venta de pauta con clid, monto y reciente: se manda", () => {
  assert.deepEqual(c.decidirEnvio(base()), { mandar: true });
  assert.deepEqual(c.decidirEnvio(base({ modo: "PRUEBA" })), { mandar: true });
});

prueba("no se manda: apagado, no es pauta, sin clid, sin monto, más de 7 días, ya enviado", () => {
  assert.deepEqual(c.decidirEnvio(base({ modo: "APAGADO" })), { mandar: false, motivo: "APAGADO" });
  assert.deepEqual(c.decidirEnvio(base({ venta: { categoria: "ORGANICO_OTRO", pagadaEn: hace(1) } })), { mandar: false, motivo: "NO_ES_PAUTA" });
  for (const clid of [null, undefined, "", "   "]) {
    assert.deepEqual(c.decidirEnvio(base({ ctwaClid: clid })), { mandar: false, motivo: "SIN_CLID" }, String(clid));
  }
  for (const monto of [null, undefined, 0, -5, "1000", Number.NaN, Infinity]) {
    assert.deepEqual(c.decidirEnvio(base({ monto })), { mandar: false, motivo: "SIN_MONTO" }, String(monto));
  }
  assert.deepEqual(c.decidirEnvio(base({ venta: { categoria: "PAUTA", pagadaEn: hace(8) } })), { mandar: false, motivo: "MUY_VIEJA" });
  assert.deepEqual(c.decidirEnvio(base({ venta: { categoria: "PAUTA", pagadaEn: "no-es-fecha" } })), { mandar: false, motivo: "MUY_VIEJA" });
  assert.deepEqual(c.decidirEnvio(base({ venta: { categoria: "PAUTA", pagadaEn: hace(6.9) } })), { mandar: true }, "6,9 días todavía sirve");
  assert.deepEqual(c.decidirEnvio(base({ yaEnviado: { estado: "ENVIADO", intentos: 1 } })), { mandar: false, motivo: "YA_ENVIADO" });
  assert.deepEqual(c.decidirEnvio(base({ yaEnviado: true })), { mandar: false, motivo: "YA_ENVIADO" });
});

prueba("un ERROR se reintenta hasta MAX_INTENTOS (3); con 3 cuenta como ya enviado", () => {
  assert.equal(c.MAX_INTENTOS, 3);
  assert.deepEqual(c.decidirEnvio(base({ yaEnviado: { estado: "ERROR", intentos: 2 } })), { mandar: true });
  assert.deepEqual(c.decidirEnvio(base({ yaEnviado: { estado: "ERROR", intentos: 3 } })), { mandar: false, motivo: "YA_ENVIADO" });
  assert.deepEqual(c.decidirEnvio(base({ yaEnviado: { estado: "ERROR", intentos: 5 } })), { mandar: false, motivo: "YA_ENVIADO" });
  assert.deepEqual(c.decidirEnvio(base({ yaEnviado: { estado: "SIN_MONTO", intentos: 0 } })), { mandar: true }, "si ya tiene monto, se manda");
});

prueba("test_event_code va solo en PRUEBA", () => {
  const e = c.armarEventoPurchase({ ventaDePautaId: "vp1", pagadaEn: hace(1), valor: 10, ctwaClid: "x", wabaId: "w" });
  assert.deepEqual(c.armarCuerpo([e], "PRUEBA", "TEST123"), { data: [e], test_event_code: "TEST123" });
  assert.deepEqual(c.armarCuerpo([e], "ACTIVO", "TEST123"), { data: [e] });
  assert.ok(!("test_event_code" in c.armarCuerpo([e], "ACTIVO", "TEST123")));
  assert.ok(!("test_event_code" in c.armarCuerpo([e], "APAGADO", "TEST123")));
});

prueba("un modo desconocido da APAGADO", () => {
  assert.equal(c.leerModo("ACTIVO"), "ACTIVO");
  assert.equal(c.leerModo("PRUEBA"), "PRUEBA");
  assert.equal(c.leerModo(" prueba "), "PRUEBA");
  for (const raro of ["APAGADO", "activo-ya", "", null, undefined, 1, true, {}, ["ACTIVO"]]) {
    assert.equal(c.leerModo(raro), "APAGADO", JSON.stringify(raro) ?? String(raro));
  }
  assert.deepEqual(c.decidirEnvio(base({ modo: "LO-QUE-SEA" })), { mandar: false, motivo: "APAGADO" });
});

prueba("faltanLlaves dice cuáles faltan, sin mostrar sus valores", () => {
  assert.deepEqual(c.faltanLlaves({}), ["META_CAPI_ACCESS_TOKEN", "META_CAPI_DATASET_ID", "META_CAPI_WABA_ID"]);
  assert.deepEqual(c.faltanLlaves({ META_CAPI_ACCESS_TOKEN: "secreto", META_CAPI_DATASET_ID: "  ", META_CAPI_WABA_ID: "w" }), ["META_CAPI_DATASET_ID"]);
  assert.deepEqual(c.faltanLlaves({ META_CAPI_ACCESS_TOKEN: "secreto", META_CAPI_DATASET_ID: "d", META_CAPI_WABA_ID: "w" }), []);
  assert.ok(!JSON.stringify(c.faltanLlaves({ META_CAPI_ACCESS_TOKEN: "secreto" })).includes("secreto"));
});

console.log(`\n${pruebas} pruebas pasaron`);
