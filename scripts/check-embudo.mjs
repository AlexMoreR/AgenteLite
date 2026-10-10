// Pruebas del embudo F1 (src/features/embudo/dominio): detector de señales de compra con frases
// reales, puntaje en sombra, qué es Combo de Camilla, eventos de un turno del V3 y la foto del lead.
// No necesita base ni red.
// Correr: npm run test:embudo
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const requireNativo = createRequire(import.meta.url);

/** Carga un .ts transpilado, resolviendo sus imports relativos a otros .ts. */
const cache = new Map();
function cargar(archivo) {
  const absoluto = path.resolve(archivo);
  if (cache.has(absoluto)) return cache.get(absoluto).exports;
  const salida = ts.transpileModule(fs.readFileSync(absoluto, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: absoluto,
  });
  const mod = { exports: {} };
  cache.set(absoluto, mod);
  const requerir = (pedido) => {
    if (pedido.startsWith(".")) {
      const base = path.resolve(path.dirname(absoluto), pedido);
      for (const candidato of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
        if (fs.existsSync(candidato) && fs.statSync(candidato).isFile()) return cargar(candidato);
      }
    }
    return requireNativo(pedido);
  };
  new Function("exports", "require", "module", "__filename", "__dirname", salida.outputText)(
    mod.exports,
    requerir,
    mod,
    absoluto,
    path.dirname(absoluto),
  );
  return mod.exports;
}

const s = cargar("src/features/embudo/dominio/senales.ts");
const c = cargar("src/features/embudo/dominio/combo.ts");
const e = cargar("src/features/embudo/dominio/eventos.ts");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const tipos = (texto) => s.detectarSenales(texto).map((senal) => senal.tipo).sort();

/* ---------------------------------------------------------------------------------------------- */

prueba("frases reales: cada una da la señal esperada", () => {
  const casos = [
    ["Cómo hago para apartarlo?", ["separar"]],
    ["Quiero separar el combo rosado", ["color_medidas", "separar"]],
    ["A qué cuenta te consigno el anticipo?", ["anticipo_pago"]],
    ["Me pasas el Nequi porfa", ["anticipo_pago"]],
    ["Listo, me sirve. Lo quiero", ["acepta_precio"]],
    ["Me regalas una cotización a nombre de mi spa", ["pide_cotizacion"]],
    ["Mi dirección es Calle 45 # 12-30, barrio El Prado", ["direccion_fecha"]],
    ["Ya te consigné, ahí te mando el comprobante", ["comprobante"]],
    ["Te pago el viernes sin falta", ["decision_proxima"]],
    ["Hacen envíos a Pereira?", ["envio_ciudad"]],
    ["Cuánto se demora en llegar a Pasto?", ["envio_ciudad", "tiempo_fabricacion"]],
    ["La tienen en color negro?", ["color_medidas"]],
    ["Cuánto mide la camilla?", ["color_medidas"]],
    ["Tiene garantía?", ["garantia"]],
    ["Se puede pagar a cuotas con Addi?", ["forma_pago"]],
    ["Manejan contraentrega?", ["forma_pago"]],
    ["Buenas, qué precio tiene el combo?", ["precio"]],
    ["Cuánto vale la silla?", ["precio"]],
    ["Me mandas fotos del combo porfa", ["fotos_video"]],
    ["Solo estoy mirando, gracias", ["solo_mirando"]],
    ["Uy está muy caro", ["muy_caro"]],
    ["No me interesa, gracias", ["no_interesa"]],
    ["Lo voy a pensar y te aviso", ["solo_mirando"]],
  ];
  assert.ok(casos.length >= 15);
  for (const [frase, esperado] of casos) {
    assert.deepEqual(tipos(frase), [...esperado].sort(), `"${frase}"`);
  }
});

prueba("lo que NO es señal: saludos, cortesía, 'vale' como ok, 'aparte'", () => {
  assert.deepEqual(tipos("Hola buenas tardes"), []);
  assert.deepEqual(tipos("ok gracias"), []);
  assert.deepEqual(tipos("Vale, perfecto"), []);
  assert.deepEqual(tipos("aparte de eso todo bien"), []);
  assert.deepEqual(tipos(""), []);
  assert.deepEqual(tipos(null), []);
});

prueba("negaciones: 'no lo quiero' no es aceptar; 'no me interesa' anula 'me interesa comprar'", () => {
  assert.ok(!tipos("No lo quiero así").includes("acepta_precio"));
  assert.ok(!tipos("no me interesa comprarlo").includes("acepta_precio"));
  assert.deepEqual(tipos("no me interesa comprarlo"), ["no_interesa"]);
});

prueba("el fragmento sale del texto original, con tildes", () => {
  const [senal] = s.detectarSenales("Hola! Cómo hago para apartarlo?");
  assert.equal(senal.tipo, "separar");
  assert.ok(senal.fragmento.includes("apartarlo"));
  assert.ok(senal.fragmento.includes("Cómo"));
  assert.equal(s.normalizarConservando("Mañana 🙌 envío").length, "Mañana 🙌 envío".length);
});

prueba("puntaje en sombra: fuerte = Caliente, medias suman, negativas restan, 'no me interesa' = 0", () => {
  assert.equal(s.puntajeSombra(["separar"]), 6);
  assert.equal(s.temperaturaDelPuntaje(s.puntajeSombra(["separar"])), "CALIENTE");
  assert.equal(s.puntajeSombra(["envio_ciudad", "precio"]), 3);
  assert.equal(s.temperaturaDelPuntaje(3), "TIBIO");
  assert.equal(s.puntajeSombra(["precio", "fotos_video"]), 2);
  assert.equal(s.temperaturaDelPuntaje(2), "FRIO");
  assert.equal(s.puntajeSombra(["precio", "solo_mirando"]), 0);
  assert.equal(s.puntajeSombra(["separar", "envio_ciudad", "garantia"]), 8);
  assert.equal(s.puntajeSombra(["separar", "no_interesa"]), 0);
  assert.equal(s.puntajeSombra(["precio", "precio", "precio"]), 1);
  const motivo = s.motivoDelPuntaje(
    [
      { tipo: "envio_ciudad", fragmento: "envíos a Pereira" },
      { tipo: "separar", fragmento: "cómo hago para apartarlo" },
    ],
    8,
  );
  assert.ok(motivo.startsWith("Caliente: preguntó cómo separar"));
  assert.ok(motivo.includes("Pereira"));
});

prueba("combo de camilla: por anuncio, primer mensaje, producto y config", () => {
  assert.equal(c.esAnuncioDelCombo({ titulo: "Equipa tu espacio de estética 💆" }), true);
  assert.equal(c.esAnuncioDelCombo({ titulo: "COMBO Camilla + Silla" }), true);
  assert.equal(c.esAnuncioDelCombo({ titulo: "Sillas de barbería" }), false);
  assert.equal(c.esAnuncioDelCombo(null), false);
  assert.equal(c.primerMensajeEsDelCombo("Hola Magilus, QUIERO EL COMBO"), true);
  assert.equal(c.primerMensajeEsDelCombo("Hola, info de la silla"), false);
  assert.equal(c.esProductoDelCombo({ id: "p1", nombre: "COMBO CAMILLA ESTÉTICA ROSA" }), true);
  assert.equal(c.esProductoDelCombo({ id: "p2", nombre: "Camilla sola" }), false);
  const config = c.leerConfigEmbudoDeTexto(JSON.stringify({ comboProductoIds: ["p2"], comboAnuncioIds: ["ad9"], comboTituloPatrones: ["spa"] }));
  assert.equal(c.esProductoDelCombo({ id: "p2", nombre: "Camilla sola" }, config), true);
  assert.equal(c.esAnuncioDelCombo({ titulo: "otra cosa", id: "ad9" }, config), true);
  assert.equal(c.esAnuncioDelCombo({ titulo: "COMBO" }, config), false);
  assert.deepEqual(c.leerConfigEmbudoDeTexto("{malo"), c.CONFIG_EMBUDO_POR_DEFECTO);
  assert.equal(c.claveDeProducto({ id: "p1", nombre: "Combo camilla" }), c.CLAVE_COMBO);
  assert.equal(c.claveDeProducto({ id: "p9", nombre: "Silla" }), "p9");
  assert.equal(c.productoDeEntrada({ anuncio: null, primerMensaje: "Quiero el combo" }), c.CLAVE_COMBO);
  assert.equal(c.productoDeEntrada({ anuncio: { titulo: "Sillas" }, primerMensaje: "hola" }), null);
  assert.equal(c.hayMezcla({ productoEntrada: c.CLAVE_COMBO, productoActual: "p9" }), true);
  assert.equal(c.hayMezcla({ productoEntrada: c.CLAVE_COMBO, productoActual: c.CLAVE_COMBO }), false);
  assert.equal(c.hayMezcla({ mezclaAntes: true, productoEntrada: "a", productoActual: "a" }), true);
});

const traza = (parcial = {}) => ({
  libroVersion: 12,
  antes: { pasoActual: null, producto: null, esPrimerMensaje: true },
  despues: { pasoActual: null, producto: null },
  intenciones: [],
  tiposDeAccion: [],
  conSaludo: false,
  envioFlujo: false,
  mensajesEnviados: 0,
  reglaId: null,
  reglaNombre: null,
  cuando: "2026-10-09T15:00:00.000Z",
  ...parcial,
});
const tiposDeEventos = (lista) => lista.map((evento) => evento.tipo);
const claveCombo = (id) => (id === "combo1" ? c.CLAVE_COMBO : id);

prueba("turno 1: bienvenida + entra al combo (PRESENTACION) — no cuenta como 'respondió'", () => {
  const eventos = e.eventosDelTurno({
    conversationId: "c1",
    traza: traza({
      conSaludo: true,
      mensajesEnviados: 2,
      despues: { pasoActual: "PRESENTACION", producto: "combo1" },
      tiposDeAccion: ["mensaje", "activar_producto", "mensaje"],
      reglaId: "r1",
      reglaNombre: "Pide el combo",
    }),
    atendido: true,
    mensajeCliente: "Hola, quiero info del combo",
    claveProducto: claveCombo,
  });
  assert.deepEqual(tiposDeEventos(eventos), ["BIENVENIDA_ENVIADA", "PASO_ENTRA", "TURNO_V3"]);
  assert.equal(eventos[0].claveUnica, "BIENVENIDA:c1");
  assert.equal(eventos[1].producto, c.CLAVE_COMBO);
  assert.equal(eventos[1].claveUnica, "PASO:c1:combo-camilla:PRESENTACION");
  assert.equal(eventos[2].datos.mensajes, 2);
  assert.equal(eventos[2].libroVersion, 12);
});

prueba("turno 2: responde con contenido en PRESENTACION, pasa a IDENTIFICACION; un 'ok' no cuenta", () => {
  const base = {
    antes: { pasoActual: "PRESENTACION", producto: "combo1", esPrimerMensaje: false },
    despues: { pasoActual: "IDENTIFICACION", producto: "combo1" },
    mensajesEnviados: 1,
  };
  const eventos = e.eventosDelTurno({ conversationId: "c1", traza: traza(base), atendido: true, mensajeCliente: "pestañas y cejas", claveProducto: claveCombo });
  assert.deepEqual(tiposDeEventos(eventos), ["CLIENTE_RESPONDIO", "PASO_ENTRA", "TURNO_V3"]);
  assert.equal(eventos[0].paso, "PRESENTACION");
  assert.equal(eventos[0].claveUnica, "RESPONDIO:c1:PRESENTACION");
  const soloOk = e.eventosDelTurno({ conversationId: "c1", traza: traza(base), atendido: true, mensajeCliente: "ok", claveProducto: claveCombo });
  assert.ok(!tiposDeEventos(soloOk).includes("CLIENTE_RESPONDIO"));
  const audio = e.eventosDelTurno({ conversationId: "c1", traza: traza(base), atendido: true, mensajeCliente: "", tipoMensaje: "AUDIO", claveProducto: claveCombo });
  assert.ok(tiposDeEventos(audio).includes("CLIENTE_RESPONDIO"));
});

prueba("turno 3: recomendación (flujo) + señales del texto", () => {
  const eventos = e.eventosDelTurno({
    conversationId: "c1",
    traza: traza({
      antes: { pasoActual: "IDENTIFICACION", producto: "combo1", esPrimerMensaje: false },
      despues: { pasoActual: "PRODUCTO", producto: "combo1" },
      envioFlujo: true,
      mensajesEnviados: 4,
    }),
    atendido: true,
    mensajeCliente: "Soy de Pereira, cuánto vale y hacen envíos?",
    claveProducto: claveCombo,
    idDelTurno: "m77",
  });
  assert.deepEqual(tiposDeEventos(eventos), ["CLIENTE_RESPONDIO", "PASO_ENTRA", "RECOMENDACION_ENVIADA", "SENAL", "SENAL", "TURNO_V3"]);
  const senales = eventos.filter((evento) => evento.tipo === "SENAL").map((evento) => evento.datos.senal).sort();
  assert.deepEqual(senales, ["envio_ciudad", "precio"]);
  assert.equal(eventos.find((evento) => evento.tipo === "SENAL").claveUnica.startsWith("SENAL:c1:m77:"), true);
  assert.equal(eventos.at(-1).claveUnica, "TURNO:c1:m77");
});

prueba("la foto del lead: entrada, paso máximo, señales/puntaje, transferencia, mezcla", () => {
  const contexto = { conversationId: "c1", contactId: "k1", workspaceId: "w", channelId: "ch", inicioDeLaCharla: new Date("2026-10-09T14:59:00Z") };
  const t = (min) => new Date(Date.UTC(2026, 9, 9, 15, min));
  let lead = e.aplicarEvento(null, { tipo: "ENTRADA", origen: "webhook", producto: c.CLAVE_COMBO, createdAt: t(0), datos: { anuncioTitulo: "Equipa tu espacio", anuncioRed: "facebook", anuncioId: "ad1" } }, contexto);
  assert.equal(lead.productoEntrada, c.CLAVE_COMBO);
  assert.equal(lead.anuncioTitulo, "Equipa tu espacio");
  assert.equal(lead.entradaEn.toISOString(), t(0).toISOString());
  lead = e.aplicarEvento(lead, { tipo: "PASO_ENTRA", origen: "motor", paso: "PRODUCTO", producto: c.CLAVE_COMBO, createdAt: t(5) }, contexto);
  lead = e.aplicarEvento(lead, { tipo: "PASO_ENTRA", origen: "motor", paso: "IDENTIFICACION", producto: c.CLAVE_COMBO, createdAt: t(6) }, contexto);
  assert.equal(lead.pasoActual, "IDENTIFICACION");
  assert.equal(lead.pasoMaximo, "PRODUCTO");
  lead = e.aplicarEvento(lead, { tipo: "SENAL", origen: "motor", datos: { senal: "envio_ciudad", fragmento: "envíos a Pereira" }, createdAt: t(7) }, contexto);
  lead = e.aplicarEvento(lead, { tipo: "SENAL", origen: "motor", datos: { senal: "precio", fragmento: "cuánto vale" }, createdAt: t(7) }, contexto);
  assert.equal(lead.puntaje, 3);
  lead = e.aplicarEvento(lead, { tipo: "SENAL", origen: "motor", datos: { senal: "separar", fragmento: "cómo lo aparto" }, createdAt: t(8) }, contexto);
  assert.equal(lead.puntaje, 7);
  assert.ok(lead.motivo.startsWith("Caliente"));
  assert.equal(lead.temperatura, null, "F1 no fija temperatura");
  lead = e.aplicarEvento(lead, { tipo: "ESCALADO", origen: "motor", datos: { motivo: "eligió color" }, createdAt: t(9) }, contexto);
  assert.equal(lead.transferencia, "ESCALADO");
  lead = e.aplicarEvento(lead, { tipo: "ASIGNADA", origen: "motor", datos: { asesora: "u-ingrid" }, createdAt: t(9) }, contexto);
  lead = e.aplicarEvento(lead, { tipo: "ESCALADO", origen: "motor", createdAt: t(10) }, contexto);
  assert.equal(lead.transferencia, "ASIGNADA");
  assert.equal(lead.asignadaA, "u-ingrid");
  lead = e.aplicarEvento(lead, { tipo: "ASESORA_RESPONDIO", origen: "asesora", createdAt: t(20) }, contexto);
  assert.equal(lead.primeraRespuestaAsesoraEn.toISOString(), t(20).toISOString());
  assert.equal(lead.mezcla, false);
  lead = e.aplicarEvento(lead, { tipo: "PASO_ENTRA", origen: "motor", paso: "PRESENTACION", producto: "silla-9", createdAt: t(30) }, contexto);
  assert.equal(lead.mezcla, true);
  lead = e.aplicarEvento(lead, { tipo: "PASO_ENTRA", origen: "motor", paso: "PRODUCTO", producto: c.CLAVE_COMBO, createdAt: t(31) }, contexto);
  assert.equal(lead.mezcla, true, "una vez mezcla, siempre mezcla");
  lead = e.aplicarEvento(lead, { tipo: "VENTA", origen: "asesora", datos: { cotizacion: "COT-00123" }, createdAt: t(60) }, contexto);
  assert.equal(lead.cotizacionRef, "COT-00123");
  assert.equal(lead.ventaEn.toISOString(), t(60).toISOString());
});

prueba("un lead que nace sin ENTRADA toma la fecha de inicio de la charla", () => {
  const contexto = { conversationId: "c2", contactId: "k", workspaceId: "w", channelId: "ch", inicioDeLaCharla: new Date("2026-10-01T10:00:00Z") };
  const lead = e.aplicarEvento(null, { tipo: "TURNO_V3", origen: "motor", paso: "PRESENTACION", libroVersion: 9, datos: { mensajes: 1 }, createdAt: new Date("2026-10-09T10:00:00Z") }, contexto);
  assert.equal(lead.entradaEn.toISOString(), "2026-10-01T10:00:00.000Z");
  assert.equal(lead.libroVersionEntrada, 9);
  assert.equal(lead.ultimoBotEn.toISOString(), "2026-10-09T10:00:00.000Z");
  assert.equal(e.pasoMayor("CIERRE", "PRODUCTO"), "CIERRE");
  assert.equal(e.pasoMayor(null, "IDENTIFICACION"), "IDENTIFICACION");
});

console.log(`\n${pruebas} pruebas del embudo en verde`);
