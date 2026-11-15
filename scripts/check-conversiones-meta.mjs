// Pruebas del evento de conversión para Meta (src/features/pauta/dominio/evento-de-conversion.ts).
// Con datos de prueba, sin red ni base. Correr: npm run test:conversiones-meta
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

const c = cargar("src/features/pauta/dominio/evento-de-conversion.ts");
let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const AHORA = new Date("2026-11-15T12:00:00Z");
const haceDias = (dias) => new Date(AHORA.getTime() - dias * 24 * 60 * 60 * 1000);
const base = (cambios = {}) => ({
  venta: { categoria: "PAUTA", pagadaEn: haceDias(1) },
  ctwaClid: "ARclid123",
  monto: 1_250_000,
  modo: "ACTIVO",
  yaEnviado: null,
  ahora: AHORA,
  ...cambios,
});

prueba("el evento Purchase solo lleva el clid y la cuenta de WhatsApp, en COP y con el monto", () => {
  const pagadaEn = new Date("2026-11-14T15:30:45.900Z");
  const ev = c.armarEventoPurchase({ ventaDePautaId: "vp1", pagadaEn, valor: 1_250_000, ctwaClid: "ARclid123", wabaId: "WABA9" });
  assert.deepEqual(ev, {
    event_name: "Purchase",
    event_time: Math.floor(pagadaEn.getTime() / 1000),
    action_source: "business_messaging",
    messaging_channel: "whatsapp",
    event_id: "vp1",
    user_data: { whatsapp_business_account_id: "WABA9", ctwa_clid: "ARclid123" },
    custom_data: { currency: "COP", value: 1_250_000 },
  });
  assert.deepEqual(Object.keys(ev.user_data).sort(), ["ctwa_clid", "whatsapp_business_account_id"]);
  assert.equal(Number.isInteger(ev.event_time), true, "segundos, no milisegundos");
  const texto = JSON.stringify(ev);
  for (const prohibido of ["ph", "fn", "ln", "ct", "telefono", "nombre", "ciudad"]) assert.ok(!(prohibido in ev.user_data), prohibido);
  assert.ok(!/telefono|nombre|ciudad/i.test(texto));
});

prueba("con clid, monto, pauta y menos de 7 días: se manda (PRUEBA y ACTIVO)", () => {
  assert.deepEqual(c.decidirEnvio(base()), { mandar: true });
  assert.deepEqual(c.decidirEnvio(base({ modo: "PRUEBA" })), { mandar: true });
  assert.deepEqual(c.decidirEnvio(base({ venta: { categoria: "PAUTA", pagadaEn: haceDias(6.9) } })), { mandar: true });
});

prueba("no se manda: apagado, no es pauta, sin clid, sin monto o más de 7 días", () => {
  assert.deepEqual(c.decidirEnvio(base({ modo: "APAGADO" })), { mandar: false, motivo: "APAGADO" });
  assert.deepEqual(c.decidirEnvio(base({ venta: { categoria: "ORGANICO_OTRO", pagadaEn: haceDias(1) } })), { mandar: false, motivo: "NO_ES_PAUTA" });
  for (const ctwaClid of [null, undefined, "", "   "]) assert.deepEqual(c.decidirEnvio(base({ ctwaClid })), { mandar: false, motivo: "SIN_CLID" });
  for (const monto of [null, undefined, 0, -5, NaN, "1000", Infinity]) {
    assert.deepEqual(c.decidirEnvio(base({ monto })), { mandar: false, motivo: "SIN_MONTO" }, String(monto));
  }
  assert.deepEqual(c.decidirEnvio(base({ venta: { categoria: "PAUTA", pagadaEn: haceDias(7.01) } })), { mandar: false, motivo: "MUY_VIEJA" });
  assert.deepEqual(c.decidirEnvio(base({ venta: { categoria: "PAUTA", pagadaEn: new Date("no-fecha") } })), { mandar: false, motivo: "MUY_VIEJA" });
});

prueba("ya enviado o ERROR con 3 intentos: no se manda; ERROR con menos o SIN_MONTO: se reintenta", () => {
  assert.equal(c.MAX_INTENTOS, 3);
  assert.deepEqual(c.decidirEnvio(base({ yaEnviado: { estado: "ENVIADO", intentos: 1 } })), { mandar: false, motivo: "YA_ENVIADO" });
  assert.deepEqual(c.decidirEnvio(base({ yaEnviado: { estado: "ERROR", intentos: 3 } })), { mandar: false, motivo: "YA_ENVIADO" });
  assert.deepEqual(c.decidirEnvio(base({ yaEnviado: { estado: "ERROR", intentos: 4 } })), { mandar: false, motivo: "YA_ENVIADO" });
  assert.deepEqual(c.decidirEnvio(base({ yaEnviado: { estado: "ERROR", intentos: 2 } })), { mandar: true });
  assert.deepEqual(c.decidirEnvio(base({ yaEnviado: { estado: "SIN_MONTO", intentos: 0 } })), { mandar: true });
});

prueba("test_event_code solo va en PRUEBA", () => {
  const ev = c.armarEventoPurchase({ ventaDePautaId: "vp1", pagadaEn: haceDias(1), valor: 10, ctwaClid: "x", wabaId: "w" });
  assert.deepEqual(c.armarCuerpo([ev], "PRUEBA", "TEST123"), { data: [ev], test_event_code: "TEST123" });
  assert.deepEqual(c.armarCuerpo([ev], "ACTIVO", "TEST123"), { data: [ev] });
  assert.deepEqual(c.armarCuerpo([ev], "APAGADO", "TEST123"), { data: [ev] });
  assert.ok(!("test_event_code" in c.armarCuerpo([ev], "PRUEBA", "")));
  assert.ok(!("test_event_code" in c.armarCuerpo([ev], "PRUEBA", null)));
});

prueba("un modo desconocido da APAGADO", () => {
  assert.equal(c.leerModo("PRUEBA"), "PRUEBA");
  assert.equal(c.leerModo(" activo "), "ACTIVO");
  assert.equal(c.leerModo("APAGADO"), "APAGADO");
  for (const valor of [undefined, null, "", "PRENDIDO", "si", 1, true, {}, []]) assert.equal(c.leerModo(valor), "APAGADO", String(valor));
});

prueba("faltanLlaves dice cuáles faltan (o están vacías) y no devuelve valores", () => {
  assert.deepEqual(c.faltanLlaves({}), ["META_CAPI_ACCESS_TOKEN", "META_CAPI_DATASET_ID", "META_CAPI_WABA_ID"]);
  assert.deepEqual(c.faltanLlaves({ META_CAPI_ACCESS_TOKEN: "secreto", META_CAPI_DATASET_ID: "  ", META_CAPI_WABA_ID: "1" }), ["META_CAPI_DATASET_ID"]);
  assert.deepEqual(c.faltanLlaves({ META_CAPI_ACCESS_TOKEN: "secreto", META_CAPI_DATASET_ID: "2", META_CAPI_WABA_ID: "1" }), []);
  assert.ok(!c.faltanLlaves({ META_CAPI_ACCESS_TOKEN: "secreto" }).includes("secreto"));
});

console.log(`\n${pruebas} pruebas pasaron`);
