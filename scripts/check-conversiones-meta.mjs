// Pruebas del evento de conversión para Meta (src/features/pauta/dominio/evento-de-conversion.ts).
// Con datos de prueba, sin red ni base. Correr: npm run test:conversiones-meta
import assert from "node:assert/strict";
import fs from "node:fs";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

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

/* ------------------------------------------------------------------------------------------------
   El servicio que manda a Meta (src/features/pauta/servicios/conversiones-meta.ts), con base y red falsas.
------------------------------------------------------------------------------------------------ */

async function pruebaAsync(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const WS = "ws1";
const LLAVES = { META_CAPI_ACCESS_TOKEN: "token-secreto-123", META_CAPI_DATASET_ID: "DS77", META_CAPI_WABA_ID: "WABA9" };

// Base falsa: AppSetting, VentaDePauta, OrigenDePauta y EventoDeConversion en memoria.
const db = { ajustes: new Map(), ventas: [], origenes: [], eventos: [] };
const prismaFalso = {
  appSetting: { findUnique: async ({ where }) => (db.ajustes.has(where.key) ? { key: where.key, value: db.ajustes.get(where.key) } : null) },
  ventaDePauta: {
    findMany: async ({ where }) =>
      db.ventas.filter(
        (v) => v.workspaceId === where.workspaceId && v.categoria === where.categoria && v.pagadaEn >= where.pagadaEn.gte && v.pagadaEn <= where.pagadaEn.lte,
      ),
  },
  origenDePauta: { findMany: async ({ where }) => db.origenes.filter((o) => o.workspaceId === where.workspaceId && where.id.in.includes(o.id)) },
  eventoDeConversion: {
    findMany: async ({ where }) =>
      db.eventos.filter(
        (e) => e.workspaceId === where.workspaceId && e.evento === where.evento && e.modo === where.modo && where.ventaDePautaId.in.includes(e.ventaDePautaId),
      ),
    upsert: async ({ where, create, update }) => {
      const k = where.workspaceId_ventaDePautaId_evento_modo;
      const fila = db.eventos.find((e) => e.workspaceId === k.workspaceId && e.ventaDePautaId === k.ventaDePautaId && e.evento === k.evento && e.modo === k.modo);
      if (fila) Object.assign(fila, update);
      else db.eventos.push({ intentos: 0, ...create });
    },
  },
};
const mocks = {
  "@/lib/prisma": { prisma: prismaFalso },
  "@/lib/sincronizacion-gestion": { leerConexionConGestion: async () => null },
};
const s = cargar("src/features/pauta/servicios/conversiones-meta.ts", mocks);
const g = cargar("src/features/mejoras-vs-ventas/servicios/leer-gestion.ts", mocks);

function reiniciar({ modo = "ACTIVO", codigo = null, ventas = [], origenes = [], eventos = [] } = {}) {
  db.ajustes = new Map();
  if (modo !== null) db.ajustes.set(`meta-conversiones:modo:${WS}`, modo);
  if (codigo !== null) db.ajustes.set(`meta-conversiones:codigo-prueba:${WS}`, codigo);
  db.ventas = ventas;
  db.origenes = origenes;
  db.eventos = eventos;
}
const venta = (id, cambios = {}) => ({
  id, workspaceId: WS, categoria: "PAUTA", cotizacion: null, monto: 500_000, pagadaEn: haceDias(1), origenDePautaId: `o-${id}`, ...cambios,
});
const origenDe = (id, ctwaClid = `clid-${id}`) => ({ id: `o-${id}`, workspaceId: WS, ctwaClid });
function fetchFalso(status = 200, texto = '{"events_received":1}') {
  const llamadas = [];
  const fn = async (url, init) => {
    llamadas.push({ url: String(url), init, cuerpo: JSON.parse(init.body) });
    return { ok: status >= 200 && status < 300, status, text: async () => texto };
  };
  return { fn, llamadas };
}

await pruebaAsync("(a) modo APAGADO (o sin ajuste): no hay ninguna llamada a fetch y el motivo es APAGADO", async () => {
  for (const modo of ["APAGADO", null, "PRENDIDO"]) {
    reiniciar({ modo, ventas: [venta("v1")], origenes: [origenDe("v1")] });
    const f = fetchFalso();
    const r = await s.mandarConversionesDePauta(WS, AHORA, { fetch: f.fn, env: LLAVES, gestion: null });
    assert.equal(f.llamadas.length, 0, String(modo));
    assert.equal(r.motivo, "APAGADO");
    assert.equal(r.mandados, 0);
    assert.equal(db.eventos.length, 0, "tampoco se guarda nada");
  }
});

await pruebaAsync("(b) falta una de las tres llaves: no hay fetch y el motivo es FALTAN_LLAVES con su nombre (sin valores)", async () => {
  for (const llave of Object.keys(LLAVES)) {
    reiniciar({ ventas: [venta("v1")], origenes: [origenDe("v1")] });
    const f = fetchFalso();
    const env = { ...LLAVES, [llave]: "" };
    const r = await s.mandarConversionesDePauta(WS, AHORA, { fetch: f.fn, env, gestion: null });
    assert.equal(f.llamadas.length, 0, llave);
    assert.equal(r.motivo, "FALTAN_LLAVES");
    assert.deepEqual(r.faltan, [llave]);
    assert.ok(!JSON.stringify(r).includes("token-secreto-123"), "la llave no sale en el resultado");
  }
});

await pruebaAsync("(c) en PRUEBA el cuerpo lleva test_event_code; sin código no se manda (SIN_CODIGO_PRUEBA)", async () => {
  reiniciar({ modo: "PRUEBA", ventas: [venta("v1")], origenes: [origenDe("v1")] });
  let f = fetchFalso();
  let r = await s.mandarConversionesDePauta(WS, AHORA, { fetch: f.fn, env: LLAVES, gestion: null });
  assert.equal(f.llamadas.length, 0);
  assert.equal(r.motivo, "SIN_CODIGO_PRUEBA");

  reiniciar({ modo: "PRUEBA", codigo: "TEST42", ventas: [venta("v1")], origenes: [origenDe("v1")] });
  f = fetchFalso();
  r = await s.mandarConversionesDePauta(WS, AHORA, { fetch: f.fn, env: LLAVES, gestion: null });
  assert.equal(f.llamadas.length, 1);
  const { url, init, cuerpo } = f.llamadas[0];
  assert.equal(cuerpo.test_event_code, "TEST42");
  assert.equal(cuerpo.data.length, 1);
  assert.equal(cuerpo.data[0].user_data.ctwa_clid, "clid-v1");
  assert.equal(cuerpo.data[0].custom_data.value, 500_000);
  assert.equal(init.method, "POST");
  assert.match(url, /^https:\/\/graph\.facebook\.com\/v\d+\.\d+\/DS77\/events$/);
  assert.equal(init.headers.Authorization, "Bearer token-secreto-123");
  assert.ok(!url.includes("token-secreto-123"), "la llave no va en la URL");
  assert.ok(!init.body.includes("token-secreto-123"), "ni en el cuerpo");
  assert.equal(r.modo, "PRUEBA");
  assert.equal(r.mandados, 1);
  const ev = db.eventos.find((e) => e.ventaDePautaId === "v1");
  assert.equal(ev.estado, "ENVIADO");
  assert.equal(ev.modo, "PRUEBA");
  assert.equal(ev.valor, 500_000);
  assert.ok(ev.enviadoEn instanceof Date);
});

await pruebaAsync("(d) una venta ya ENVIADO no se manda otra vez; las nuevas van en un solo POST", async () => {
  reiniciar({
    ventas: [venta("v1"), venta("v2"), venta("v3")],
    origenes: [origenDe("v1"), origenDe("v2"), origenDe("v3")],
    eventos: [{ workspaceId: WS, ventaDePautaId: "v1", evento: "Purchase", modo: "ACTIVO", estado: "ENVIADO", intentos: 1 }],
  });
  const f = fetchFalso();
  const r = await s.mandarConversionesDePauta(WS, AHORA, { fetch: f.fn, env: LLAVES, gestion: null });
  assert.equal(f.llamadas.length, 1, "un solo POST");
  assert.deepEqual(f.llamadas[0].cuerpo.data.map((e) => e.event_id).sort(), ["v2", "v3"]);
  assert.ok(!("test_event_code" in f.llamadas[0].cuerpo), "en ACTIVO no va el código de prueba");
  assert.equal(r.mandados, 2);

  // Todo enviado: ninguna llamada.
  const f2 = fetchFalso();
  const r2 = await s.mandarConversionesDePauta(WS, AHORA, { fetch: f2.fn, env: LLAVES, gestion: null });
  assert.equal(f2.llamadas.length, 0);
  assert.equal(r2.mandados, 0);
});

await pruebaAsync("Meta responde error: ERROR con intentos+1 y mensaje corto sin la llave; con 3 intentos ya no se reintenta", async () => {
  reiniciar({ ventas: [venta("v1")], origenes: [origenDe("v1")] });
  const error = JSON.stringify({ error: { message: "Invalid parameter token-secreto-123", code: 100 } });
  for (let vuelta = 1; vuelta <= 3; vuelta += 1) {
    const f = fetchFalso(400, error);
    const r = await s.mandarConversionesDePauta(WS, AHORA, { fetch: f.fn, env: LLAVES, gestion: null });
    assert.equal(f.llamadas.length, 1, `vuelta ${vuelta}`);
    assert.equal(r.errores, 1);
    const ev = db.eventos.find((e) => e.ventaDePautaId === "v1");
    assert.equal(ev.estado, "ERROR");
    assert.equal(ev.intentos, vuelta);
    assert.ok(ev.respuesta.includes("Invalid parameter"));
    assert.ok(!ev.respuesta.includes("token-secreto-123"), "la llave no se guarda");
    assert.ok(ev.respuesta.length <= 200);
  }
  const f = fetchFalso();
  await s.mandarConversionesDePauta(WS, AHORA, { fetch: f.fn, env: LLAVES, gestion: null });
  assert.equal(f.llamadas.length, 0, "con 3 intentos ya no se manda");
});

await pruebaAsync("sin monto: se busca en listar_ventas de Gestión; si no está, SIN_MONTO y no se manda", async () => {
  const llamadasGestion = [];
  const gestion = {
    llamar: async (herramienta, args) => {
      llamadasGestion.push([herramienta, args]);
      return { ventas: [{ codigo: "V-1", cotizacion: "COT-9", total: "1250000" }, { codigo: "V-2", cotizacion: "COT-8", total: 0 }] };
    },
  };
  reiniciar({
    ventas: [venta("v1", { monto: null, cotizacion: "cot-9" }), venta("v2", { monto: null, cotizacion: "COT-8" }), venta("v3", { monto: null })],
    origenes: [origenDe("v1"), origenDe("v2"), origenDe("v3")],
  });
  const f = fetchFalso();
  const r = await s.mandarConversionesDePauta(WS, AHORA, { fetch: f.fn, env: LLAVES, gestion });
  assert.equal(llamadasGestion.length, 1, "Gestión se lee una sola vez");
  assert.equal(llamadasGestion[0][0], "listar_ventas");
  assert.deepEqual(f.llamadas[0].cuerpo.data.map((e) => [e.event_id, e.custom_data.value]), [["v1", 1_250_000]]);
  assert.equal(r.mandados, 1);
  assert.equal(r.sinMonto, 2);
  assert.deepEqual(db.eventos.filter((e) => e.estado === "SIN_MONTO").map((e) => e.ventaDePautaId).sort(), ["v2", "v3"]);
});

await pruebaAsync("sin ctwa_clid o de más de 7 días: no se manda ni se guarda", async () => {
  reiniciar({
    ventas: [venta("v1"), venta("v2", { pagadaEn: haceDias(8) }), venta("v3", { origenDePautaId: null })],
    origenes: [origenDe("v1", null)],
  });
  const f = fetchFalso();
  const r = await s.mandarConversionesDePauta(WS, AHORA, { fetch: f.fn, env: LLAVES, gestion: null });
  assert.equal(f.llamadas.length, 0);
  assert.equal(r.sinClid, 2);
  assert.equal(r.motivo, "NADA_QUE_MANDAR");
  assert.equal(db.eventos.length, 0);
});

prueba("montoDeVentaPorCotizacion: total, valorTotal o valor_total; nunca inventa", () => {
  assert.equal(g.montoDeVentaPorCotizacion([{ cotizacion: "COT-1", total: 100 }], "COT-1"), 100);
  assert.equal(g.montoDeVentaPorCotizacion([{ cotizacion: "COT-1", valorTotal: "200" }], " cot-1 "), 200);
  assert.equal(g.montoDeVentaPorCotizacion([{ cotizacion_numero: "COT-1", valor_total: 300 }], "COT-1"), 300);
  assert.equal(g.montoDeVentaPorCotizacion([{ cotizacion: { numero: "COT-1" }, total: 400 }], "COT-1"), 400);
  assert.equal(g.montoDeVentaPorCotizacion([{ cotizacion: "COT-2", total: 100 }], "COT-1"), null);
  assert.equal(g.montoDeVentaPorCotizacion([{ cotizacion: "COT-1", total: 0 }], "COT-1"), null);
  assert.equal(g.montoDeVentaPorCotizacion([{ cotizacion: "COT-1", total: "abc" }], "COT-1"), null);
  assert.equal(g.montoDeVentaPorCotizacion([{ cotizacion: "COT-1" }], "COT-1"), null);
  assert.equal(g.montoDeVentaPorCotizacion([{ cotizacion: "COT-1", total: 100 }], null), null);
  assert.deepEqual([...g.HERRAMIENTAS_DE_LECTURA], ["listar_cotizaciones", "listar_abonos", "listar_ventas"], "no cambia");
});

prueba("(e) el código solo hace un POST a .../events: nada de campañas, conjuntos, anuncios ni presupuesto", () => {
  const texto = fs.readFileSync(`${RAIZ}/src/features/pauta/servicios/conversiones-meta.ts`, "utf8");
  const urls = texto.match(/https:\/\/graph\.facebook\.com[^\s"'`]*/g) ?? [];
  assert.equal(urls.length, 1, "una sola URL de graph.facebook.com");
  assert.ok(urls[0].endsWith("/events"), urls[0]);
  const metodos = texto.match(/method:\s*["'][A-Z]+["']/g) ?? [];
  assert.deepEqual(metodos, ['method: "POST"']);
  for (const prohibido of ["campaigns", "adsets", "/ads", "budget", "daily_budget"]) {
    assert.ok(!texto.toLowerCase().includes(prohibido), `no aparece ${prohibido}`);
  }
  assert.ok(!/console\.[a-z]+\([^)]*llave/.test(texto), "la llave no va al log");
});

prueba("el MCP (que_es_esta_aplicacion) muestra la automatización conversiones_meta", () => {
  const texto = fs.readFileSync(`${RAIZ}/src/lib/mcp/que-es-esta-aplicacion.ts`, "utf8");
  assert.ok(/\bconversiones_meta:/.test(texto), "aparece la clave conversiones_meta en automatizaciones()");
  for (const campo of ["modo:", "llaves_completas:", "enviados", "con_error:", "sin_monto:", "ultimo_envio:", "ultimo_error:"]) {
    assert.ok(texto.includes(campo), `muestra ${campo}`);
  }
  assert.ok(texto.includes("faltanLlaves(process.env)"), "las llaves se miran con faltanLlaves, sin sus valores");
  assert.ok(texto.includes('seguro("conversiones_meta"'), "si la base no responde sale no_se_pudo_leer");
});

prueba("la nota del manual tiene conversiones_meta y EventoDeConversion bajo títulos que existen", () => {
  const manual = fs.readFileSync(`${RAIZ}/docs/que-es-esta-aplicacion.md`, "utf8");
  const nota = fs.readFileSync(`${RAIZ}/docs/cambios-pendientes/26bf4l8g.md`, "utf8");
  const titulosDelManual = new Set(manual.split(/\r?\n/).filter((l) => l.startsWith("## ")).map((l) => l.trim()));
  let titulo = null;
  const claves = new Map();
  for (const linea of nota.split(/\r?\n/)) {
    if (linea.startsWith("## ")) {
      titulo = linea.trim();
      assert.ok(titulosDelManual.has(titulo), `el título "${titulo}" existe en el manual`);
      continue;
    }
    const m = linea.match(/^- `([^`]+)`: \S/);
    if (m) {
      assert.ok(titulo, `la línea ${m[1]} va bajo un título`);
      claves.set(m[1], titulo);
    }
  }
  assert.equal(claves.get("conversiones_meta"), "## Automatizaciones");
  assert.equal(claves.get("EventoDeConversion"), "## Entidades");
});

console.log(`\n${pruebas} pruebas pasaron`);
