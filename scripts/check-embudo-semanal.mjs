// Pruebas del EMBUDO SEMANAL (src/features/embudo/dominio/semanal.ts): familia del lead, pasos de
// cada lead desde sus mensajes, embudo con maduración de 72 h, deltas y la mayor fuga.
// No necesita base ni red. Correr: npm run test:embudo-semanal
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

const d = cargar("src/features/embudo/dominio/semanal.ts");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const T0 = new Date("2026-10-06T15:00:00Z");
const t = (minutos) => new Date(T0.getTime() + minutos * 60_000);
const ANUNCIO = "Hola, me interesa el COMBO de estética (camilla, escalera, silla y auxiliar)";
const entra = (texto, min = 0, tipo = "TEXT") => ({ direccion: "INBOUND", tipo, texto, en: t(min) });
const bot = (texto, min, tipo = "TEXT", origen = null) => ({ direccion: "OUTBOUND", tipo, texto, origen, en: t(min) });
const asesora = (texto, min) => ({ direccion: "OUTBOUND", tipo: "TEXT", texto, origen: "manual", en: t(min) });
let n = 0;
const lead = (mensajes, extra = {}) => ({
  conversationId: `c${++n}`,
  esMarketplace: false,
  entradaEn: T0,
  mensajes,
  ...extra,
});

/* ------------------------------------------------------------------------------------ familia */

prueba("familia: Ventas 2 es Marketplace pida lo que pida", () => {
  assert.equal(d.familiaDelLead({ esMarketplace: true, productoInteres: "combo-camilla", primerMensaje: ANUNCIO }), "marketplace");
});

prueba("familia: productoInteres manda; una clave sin familia es Otros", () => {
  assert.equal(d.familiaDelLead({ esMarketplace: false, productoInteres: "camillas", primerMensaje: ANUNCIO }), "camillas");
  assert.equal(d.familiaDelLead({ esMarketplace: false, productoInteres: "mesa-manicure" }), "manicura");
  assert.equal(d.familiaDelLead({ esMarketplace: false, productoInteres: "butacos-manicure" }), "manicura");
  assert.equal(d.familiaDelLead({ esMarketplace: false, productoInteres: "sillas-peluqueria" }), "sillas");
  assert.equal(d.familiaDelLead({ esMarketplace: false, productoInteres: "lavacabezas" }), "lavacabezas");
  assert.equal(d.familiaDelLead({ esMarketplace: false, productoInteres: "auxiliares", primerMensaje: ANUNCIO }), "otros");
});

prueba("familia: sin productoInteres, productoActual, V3, primer mensaje y anuncio, en ese orden", () => {
  assert.equal(d.familiaDelLead({ esMarketplace: false, productoActual: "combo-camilla" }), "combo");
  // productoActual con un id que no dice nada: sigue al V3.
  assert.equal(d.familiaDelLead({ esMarketplace: false, productoActual: "cmp7lojx700bj2hn6z2vrv0i9", productoV3: "Lavacabezas Roma" }), "lavacabezas");
  assert.equal(d.familiaDelLead({ esMarketplace: false, primerMensaje: ANUNCIO, anuncioTitulo: "Camilla reclinable y accesorios" }), "combo");
  assert.equal(d.familiaDelLead({ esMarketplace: false, primerMensaje: "Hola", anuncioTitulo: "Camillas Contra entrega Cali" }), "camillas");
  assert.equal(d.familiaDelLead({ esMarketplace: false, primerMensaje: "Hola, tienen sillas de barbería?" }), "sillas");
  assert.equal(d.familiaDelLead({ esMarketplace: false, primerMensaje: "Hola" }), "otros");
});

/* -------------------------------------------------------------------------------------- pasos */

prueba("pasos: solo llegó (nadie le respondió)", () => {
  const p = d.pasosDelLead(lead([entra(ANUNCIO)]));
  assert.deepEqual(p, { llego: true, vioPrecio: false, converso: false, intencion: false, cotizacion: false, venta: false });
});

prueba("pasos: vio precio o fotos solo si lo mandó el bot, un flujo o un seguimiento", () => {
  assert.equal(d.pasosDelLead(lead([entra(ANUNCIO), bot("El combo vale $989.000", 1)])).vioPrecio, true);
  assert.equal(d.pasosDelLead(lead([entra(ANUNCIO), bot(null, 1, "IMAGE")])).vioPrecio, true);
  assert.equal(d.pasosDelLead(lead([entra(ANUNCIO), bot("Mira el catálogo", 1, "DOCUMENT", "follow")])).vioPrecio, true);
  assert.equal(d.pasosDelLead(lead([entra(ANUNCIO), bot("¿Qué servicios vas a ofrecer?", 1)])).vioPrecio, false);
  assert.equal(d.pasosDelLead(lead([entra(ANUNCIO), asesora("Vale $989.000", 1)])).vioPrecio, false);
  // "200 kg" no es precio.
  assert.equal(d.pasosDelLead(lead([entra(ANUNCIO), bot("Soporta hasta 200 kg", 1)])).vioPrecio, false);
});

prueba("pasos: conversó = 2 mensajes y al menos uno después de nuestra primera respuesta", () => {
  assert.equal(d.pasosDelLead(lead([entra(ANUNCIO), bot("¿Qué servicios?", 1), entra("masajes", 3)])).converso, true);
  // Dos mensajes seguidos sin que nadie le conteste: no conversó.
  assert.equal(d.pasosDelLead(lead([entra(ANUNCIO), entra("hola?", 2), bot("¿Qué servicios?", 5)])).converso, false);
  // Contestó la asesora (Marketplace): también cuenta como primera respuesta.
  assert.equal(d.pasosDelLead(lead([entra("Hola, sigue disponible?"), asesora("Sí señora", 2), entra("ok", 3)])).converso, true);
  // Las notas de actividad no son una respuesta.
  assert.equal(d.pasosDelLead(lead([entra(ANUNCIO), bot("María se asignó", 1, "TEXT", "activity"), entra("?", 2)])).converso, false);
});

prueba("pasos: intención por señales fuertes o medias, no por el texto del anuncio", () => {
  const conCiudad = d.pasosDelLead(lead([entra(ANUNCIO), bot("$989.000", 1), entra("Hacen envíos a Pasto?", 4)]));
  assert.equal(conCiudad.intencion, true);
  assert.equal(conCiudad.converso, true);
  // "Camillas Contra entrega Cali" como primer mensaje: no es intención.
  assert.equal(d.pasosDelLead(lead([entra("Me interesa la camilla contra entrega Cali"), bot("Hola", 1)])).intencion, false);
  // "¿sirve para pestañas?" es pregunta de información, no intención.
  assert.equal(d.pasosDelLead(lead([entra(ANUNCIO), bot("Hola", 1), entra("Sirve para pestañas?", 3)])).intencion, false);
  assert.equal(d.pasosDelLead(lead([entra(ANUNCIO), bot("Hola", 1), entra("cómo hago para apartarlo", 3)])).intencion, true);
  assert.equal(d.pasosDelLead(lead([entra(ANUNCIO), bot("Hola", 1), entra(null, 3, "LOCATION")])).intencion, true);
  // Un audio transcrito cuenta igual que un texto.
  assert.equal(d.pasosDelLead(lead([entra(ANUNCIO), bot("Hola", 1), entra("que formas de pago tienen", 3, "AUDIO")])).intencion, true);
});

prueba("pasos: cotización por el formulario de la asesora o el CRM; venta por Ganado; acumulativos", () => {
  const formulario = d.pasosDelLead(
    lead([entra(ANUNCIO), bot("Hola", 1), entra("ok", 2), asesora("Para continuar con el proceso de cotización formal por favor completa estos datos", 30)]),
  );
  assert.equal(formulario.cotizacion, true);
  assert.equal(formulario.intencion, true);
  // El mismo texto mandado por el bot no es el formulario de la asesora.
  assert.equal(d.pasosDelLead(lead([entra(ANUNCIO), bot("Datos de Cotización", 1)])).cotizacion, false);
  assert.equal(d.pasosDelLead(lead([entra(ANUNCIO)], { cotizacionCrm: true })).cotizacion, true);
  const venta = d.pasosDelLead(lead([entra(ANUNCIO)], { ventaCrm: true }));
  assert.deepEqual(venta, { llego: true, vioPrecio: false, converso: true, intencion: true, cotizacion: true, venta: true });
});

prueba("pasos: lo que pasa después de 14 días no cuenta para vio precio / conversó / intención", () => {
  const tarde = 15 * 24 * 60;
  const p = d.pasosDelLead(lead([entra(ANUNCIO), bot("$989.000", tarde), entra("dónde pago", tarde + 5)]));
  assert.equal(p.vioPrecio, false);
  assert.equal(p.intencion, false);
});

/* ------------------------------------------------------------------------- embudo y mayor fuga */

function embudoDePrueba() {
  const leads = [];
  // 10 llegan; 8 ven precio; 6 conversan; 2 muestran intención; 1 cotiza; 0 venden. + 3 en curso.
  for (let i = 0; i < 10; i += 1) {
    const m = [entra(ANUNCIO)];
    if (i < 8) m.push(bot("Vale $989.000", 1));
    else m.push(bot("¿Qué servicios?", 1));
    if (i < 6) m.push(entra("masajes", 3));
    if (i < 2) m.push(entra("Envían a Cali?", 4));
    leads.push(lead(m, { cotizacionCrm: i === 0 }));
  }
  const ahora = new Date(T0.getTime() + 5 * 86_400_000);
  for (let i = 0; i < 3; i += 1) leads.push(lead([entra(ANUNCIO)], { entradaEn: new Date(ahora.getTime() - 3_600_000) }));
  return d.armarEmbudo(leads, ahora);
}

prueba("embudo: números, % de los que llegaron y en curso aparte", () => {
  const e = embudoDePrueba();
  assert.equal(e.llegaron, 10);
  assert.equal(e.enCurso, 3);
  assert.deepEqual(e.pasos.map((p) => p.leads), [10, 8, 6, 2, 1, 0]);
  assert.deepEqual(e.pasos.map((p) => p.pct), [100, 80, 60, 20, 10, 0]);
  assert.equal(e.quedaron.converso.length, 4);
});

prueba("mayor fuga: la caída absoluta más grande; la última solo con base >= 20", () => {
  const e = embudoDePrueba();
  const f = d.mayorFuga(e);
  assert.equal(f.desde, "converso");
  assert.equal(f.hacia, "intencion");
  assert.equal(f.titulo, "De 6 que conversaron, solo 2 mostraron intención de compra");
  assert.equal(f.quedaron, 4);
  assert.equal(f.ids.length, 4);
  assert.match(f.queRevisar, /ciudad, color o forma de pago/);
  // Base chica en el último paso: 1 -> 0 no compite aunque fuera la mayor.
  const soloCotizan = {
    llegaron: 1,
    enCurso: 0,
    pasos: d.PASOS_SEMANALES.map((p) => ({ ...p, leads: p.clave === "venta" ? 0 : 1, pct: null })),
    quedaron: { llego: [], vioPrecio: [], converso: [], intencion: [], cotizacion: ["x"], venta: [] },
  };
  assert.equal(d.mayorFuga(soloCotizan), null);
  // Singular: "De 1 que conversó, solo 0 mostraron…"
  const uno = d.armarEmbudo([lead([entra(ANUNCIO), bot("Vale $989.000", 1), entra("masajes", 2)])], new Date(T0.getTime() + 5 * 86_400_000));
  assert.equal(d.mayorFuga(uno).titulo, "De 1 que conversó, solo 0 mostraron intención de compra");
});

prueba("deltas: Llegó en leads; los demás en puntos; = igual", () => {
  const paso = (clave, leads, pct) => ({ n: 1, clave, nombre: clave, leads, pct });
  assert.deepEqual(d.deltaDelPaso(paso("llego", 505, 100), paso("llego", 417, 100)), { texto: "↑ 88 más que la semana pasada", tono: "sube" });
  assert.deepEqual(d.deltaDelPaso(paso("converso", 271, 54), paso("converso", 300, 71)), { texto: "↓ 17 puntos", tono: "baja" });
  assert.deepEqual(d.deltaDelPaso(paso("venta", 1, 0.2), paso("venta", 1, 0.2)), { texto: "= igual", tono: "igual" });
  assert.deepEqual(d.deltaDelPaso(paso("venta", 2, 0.5), paso("venta", 1, 0.2)), { texto: "↑ 0,3 puntos", tono: "sube" });
  assert.equal(d.deltaDelPaso(paso("converso", 1, 50), null).tono, "nada");
  assert.equal(d.textoPct(87.7), "88 %");
  assert.equal(d.textoPct(0.24), "0,2 %");
  assert.equal(d.textoPct(null), "—");
});

/* ----------------------------------------------------------------------------- semanas y otros */

prueba("semanas: por defecto la semana pasada completa (lunes a domingo, hora Bogotá)", () => {
  // Lunes 12-oct 20:00 Bogotá (13-oct 01:00 UTC) -> semana del 5 al 11.
  assert.equal(d.semanaPorDefecto(new Date("2026-10-13T01:00:00Z")), "2026-10-05");
  // Domingo 11-oct 23:00 Bogotá -> todavía es la semana del 5: la pasada es la del 28-sep.
  assert.equal(d.semanaPorDefecto(new Date("2026-10-12T04:00:00Z")), "2026-09-28");
  assert.equal(d.semanaPedida("2026-10-08", new Date("2026-10-13T01:00:00Z")), "2026-10-05");
  assert.equal(d.semanaPedida("2026-12-01", new Date("2026-10-13T01:00:00Z")), "2026-10-05");
  assert.equal(d.semanaPedida("basura", new Date("2026-10-13T01:00:00Z")), "2026-10-05");
  const r = d.rangoDeSemana("2026-10-05");
  assert.equal(r.inicio.toISOString(), "2026-10-05T05:00:00.000Z");
  assert.equal(r.fin.toISOString(), "2026-10-12T05:00:00.000Z");
  assert.equal(d.etiquetaDeSemana("2026-10-05"), "5–11 oct");
  assert.equal(d.etiquetaDeSemana("2026-09-28"), "28 sep – 4 oct");
});

prueba("chat: teléfono enmascarado y enlace al chat", () => {
  assert.equal(d.telefonoEnmascarado("573001234567"), "•••• 4567");
  assert.equal(d.telefonoEnmascarado("12"), "••••");
  assert.equal(d.hrefDelChat("cabc"), "/cliente/chats?chatKey=agent%3Acabc&assigned=all");
});

console.log(`\n${pruebas} pruebas del embudo semanal en verde`);
