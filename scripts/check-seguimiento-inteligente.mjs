// Pruebas del SEGUIMIENTO INTELIGENTE (src/features/seguimiento-inteligente/dominio): país del
// teléfono, producto de interés y mensaje útil, fecha futura de compra, calificación F2, el motor de
// siguiente acción (frío / tibio / caliente / cotización / dormido / cadencia / descarte / exterior),
// la convivencia con los seguimientos de hoy y la configuración. Sin base ni red.
// Correr: npm run test:seguimiento-inteligente
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const requireNativo = createRequire(import.meta.url);
const cache = new Map();
function cargar(archivo) {
  const absoluto = path.resolve(archivo);
  if (cache.has(absoluto)) return cache.get(absoluto).exports;
  const salida = ts.transpileModule(fs.readFileSync(absoluto, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
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
  new Function("exports", "require", "module", "__filename", "__dirname", salida.outputText)(mod.exports, requerir, mod, absoluto, path.dirname(absoluto));
  return mod.exports;
}

const D = "src/features/seguimiento-inteligente/dominio";
const ex = cargar(`${D}/exterior.ts`);
const pr = cargar(`${D}/producto.ts`);
const ff = cargar(`${D}/fecha-futura.ts`);
const te = cargar(`${D}/temperatura.ts`);
const mo = cargar(`${D}/motor.ts`);
const tp = cargar(`${D}/tope.ts`);
const cf = cargar(`${D}/config.ts`);
const cv = (() => {
  // convivencia.ts importa prisma: se prueba solo su regla pura, cargando el archivo con dobles.
  const absoluto = path.resolve("src/features/seguimiento-inteligente/servicios/convivencia.ts");
  const salida = ts.transpileModule(fs.readFileSync(absoluto, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const mod = { exports: {} };
  const dobles = { "@/lib/prisma": { prisma: {} }, "./config": { leerConfigSeguimiento: async () => cf.CONFIG_POR_DEFECTO }, "../dominio/config": cf, "../dominio/exterior": ex, "../dominio/motor": mo };
  new Function("exports", "require", "module", salida.outputText)(mod.exports, (p) => dobles[p] ?? requireNativo(p), mod);
  return mod.exports;
})();

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const MIN = 60_000;
const H = 60 * MIN;
const DIA = 24 * H;
// Un miércoles a las 11:00 de Bogotá (16:00 UTC).
const T0 = new Date("2026-10-07T16:00:00Z");
const mas = (ms) => new Date(T0.getTime() + ms);

/** Config con todo prendido en modo activo (para probar el motor). */
const CONFIG = cf.leerConfigDeTexto(
  JSON.stringify({ calificacion: { activo: true }, motor: { modo: "activo" }, cadencia: { descarte: "activo" }, exterior: { activo: true } }),
);

function ficha(parcial = {}) {
  return {
    conversationId: "cvprueba0000000000000001",
    nombre: "Laura Gómez",
    etapaCrm: "NUEVO",
    pausado: false,
    asignadaA: null,
    pais: "CO",
    marcaExterior: false,
    inicioDeLaCharla: T0,
    familiaDelBot: "combo-camilla",
    flujosEnviados: [],
    cotizacion: { en: null, ref: null, total: null },
    mensajesUtiles: 0,
    mensajes: [],
    ...parcial,
  };
}
const IN = (minutos, texto) => ({ direccion: "IN", tipo: "TEXT", texto, en: mas(minutos * MIN), leidoEn: mas(minutos * MIN), origen: "webhook" });
const BOT = (minutos, texto, leidoMin = minutos + 1) => ({ direccion: "OUT", tipo: "TEXT", texto, en: mas(minutos * MIN), leidoEn: leidoMin === null ? null : mas(leidoMin * MIN), estado: leidoMin === null ? "DELIVERED" : "READ", origen: null });
const ASESORA = (minutos, texto, leidoMin = minutos + 1) => ({ ...BOT(minutos, texto, leidoMin), origen: "manual" });
const AUTO = (minutos, texto, leidoMin = minutos + 1) => ({ ...BOT(minutos, texto, leidoMin), origen: "follow" });
const ANUNCIO = "Hola, me interesa el COMBO de estética (camilla, escalera, silla y auxiliar)";

/* ---------------------------------------------------------------------------------------------- */

prueba("exterior: Brasil +55 (caso cv9b8466) es EXTERIOR; Colombia y LID no", () => {
  assert.deepEqual(ex.paisDelTelefono({ telefono: "554599887766" }), { pais: "EXTERIOR", prefijo: "+55" });
  assert.equal(ex.paisDelTelefono({ telefono: "5545999887766" }).pais, "EXTERIOR");
  assert.equal(ex.paisDelTelefono({ telefono: "573001234567" }).pais, "CO");
  assert.equal(ex.paisDelTelefono({ telefono: "3001234567" }).pais, "CO");
  assert.equal(ex.paisDelTelefono({ telefono: "13055551234" }).prefijo, "+1");
  assert.equal(ex.paisDelTelefono({ telefono: "584169102943" }).pais, "EXTERIOR");
  // LID: 14–15 dígitos, o marcado como LID, o 13 dígitos sin prefijo conocido: NO se decide.
  assert.equal(ex.paisDelTelefono({ telefono: "248211554433221" }).pais, "DESCONOCIDO");
  assert.equal(ex.paisDelTelefono({ telefono: "554599887766", esLid: true }).pais, "DESCONOCIDO");
  assert.equal(ex.paisDelTelefono({ telefono: "9912345678901" }).pais, "DESCONOCIDO");
  // LID con el teléfono real descubierto: manda el real.
  assert.equal(ex.paisDelTelefono({ telefono: "248211554433221", esLid: true, telefonoDescubierto: "573001112233" }).pais, "CO");
  assert.equal(ex.paisDelTelefono({ telefono: "248211554433221", esLid: true, telefonoDescubierto: "554599887766" }).pais, "EXTERIOR");
  assert.equal(ex.esDelExterior({ telefono: "573001234567", metadata: { fueraDeColombia: { en: "x" } } }), true);
  // Número extranjero de alguien EN Colombia (casos reales: "Pereira risaralda" con +1, "Planeta Rica Córdoba" con +52).
  assert.equal(ex.mencionaColombia("Pereira risaralda"), true);
  assert.equal(ex.mencionaColombia("que vale el envío a planeta rica Córdoba?"), true);
  assert.equal(ex.mencionaColombia("Estoy en Bogotá"), true);
  assert.equal(ex.mencionaColombia("Valor da cadeira de manicure?"), false);
  assert.equal(ex.esDelExterior({ telefono: "17735551234", textos: ["Pereira risaralda"] }), false);
  assert.equal(ex.esDelExterior({ telefono: "17735551234", textos: ["hola"] }), true);
});

prueba("producto: la familia sale de lo que nombra el cliente", () => {
  const casos = [
    ["Valor da cadeira de manicure?", "butacos-manicure"],
    [ANUNCIO, "combo-camilla"],
    ["precio del lavacabezas en fibra", "lavacabezas"],
    ["necesito una silla hidráulica para mi barbería", "sillas-peluqueria"],
    ["cuánto vale la mesa para uñas", "mesa-manicure"],
    ["combo mesa y sillas de manicure", "mesa-manicure"],
    ["tienen camillas para masajes?", "camillas"],
    ["y el butaco?", "butacos-manicure"],
    ["poltrona para pedicure", "poltronas"],
    ["hola buenas", null],
  ];
  for (const [texto, esperado] of casos) assert.equal(pr.familiaDelTexto(texto), esperado, texto);
  assert.equal(pr.familiaDelTexto("COMBO CAMILLA DIVAN"), "combo-camilla");
});

prueba("mensaje útil: combo = video armado + 50/50 (sin contraentrega ni envío gratis); catálogo una vez", () => {
  const combo = pr.mensajeUtilPara({ familia: "combo-camilla", recursos: pr.RECURSOS_POR_DEFECTO, flujosEnviados: [], mediasEnviadas: [] });
  assert.equal(combo.acciones[0].messageType, "VIDEO");
  assert.match(combo.acciones[1].content, /50 %/);
  assert.doesNotMatch(combo.acciones.map((a) => a.content ?? "").join(" "), /contra ?entrega|gratis/i);
  const yaVio = pr.mensajeUtilPara({ familia: "combo-camilla", recursos: pr.RECURSOS_POR_DEFECTO, flujosEnviados: [], mediasEnviadas: ["/uploads/chatbot-flows/1790998704867-WhatsApp_Video_2026-10-02_at_103757_PM.mp4"] });
  assert.equal(yaVio.acciones.length, 1);
  const butacos = pr.mensajeUtilPara({ familia: "butacos-manicure", recursos: pr.RECURSOS_POR_DEFECTO, flujosEnviados: [], mediasEnviadas: [] });
  assert.match(butacos.acciones[0].flowId, /fmhd0$/);
  const butacosVisto = pr.mensajeUtilPara({ familia: "butacos-manicure", recursos: pr.RECURSOS_POR_DEFECTO, flujosEnviados: [butacos.acciones[0].flowId], mediasEnviadas: [] });
  assert.equal(butacosVisto.acciones[0].flowId, undefined);
  assert.equal(pr.mensajeUtilPara({ familia: "tocador", recursos: pr.RECURSOS_POR_DEFECTO, flujosEnviados: [], mediasEnviadas: [] }), null);
  // Un recurso configurado que ofrece contraentrega NO sale.
  const malo = { ...pr.RECURSOS_POR_DEFECTO, camillas: { tipo: "texto", texto: "Puedes pagarlo contraentrega" } };
  assert.equal(pr.mensajeUtilPara({ familia: "camillas", recursos: malo, flujosEnviados: [], mediasEnviadas: [] }), null);
});

prueba("fecha futura: 'Finales de noviembre tal vez' (caso cv167d3a) y otras formas", () => {
  const cuando = new Date("2026-10-08T04:11:00Z"); // 7-oct 23:11 Bogotá
  const f = ff.detectarFechaFutura("Finales de noviembre tal vez", cuando);
  assert.equal(f.fecha.toISOString().slice(0, 10), "2026-11-25");
  assert.equal(f.como, "finales de noviembre");
  assert.equal(ff.detectarFechaFutura("para diciembre lo compro", cuando).fecha.toISOString().slice(0, 10), "2026-12-01");
  assert.equal(ff.detectarFechaFutura("el otro mes", cuando).fecha.toISOString().slice(0, 10), "2026-11-01");
  assert.equal(ff.detectarFechaFutura("en 15 días te confirmo", cuando).fecha.toISOString().slice(0, 10), "2026-10-23");
  assert.equal(ff.detectarFechaFutura("después de la prima", cuando).fecha.toISOString().slice(0, 10), "2026-12-20");
  assert.equal(ff.detectarFechaFutura("para enero", cuando).fecha.toISOString().slice(0, 10), "2027-01-01");
  assert.equal(ff.detectarFechaFutura("el 2 de enero", cuando).fecha.toISOString().slice(0, 10), "2027-01-02");
  // No son fechas de compra: preguntas de entrega y decisiones cercanas.
  assert.equal(ff.detectarFechaFutura("¿en cuántos días llega?", cuando), null);
  assert.equal(ff.detectarFechaFutura("cuanto se demora en 15 dias", cuando), null);
  assert.equal(ff.detectarFechaFutura("mañana te confirmo", cuando), null);
  assert.equal(ff.detectarFechaFutura("en 2 días", cuando), null);
});

prueba("F2: temperatura y motivo con el texto del cliente", () => {
  const ahora = mas(10 * MIN);
  const c1 = te.calificar({ mensajes: [{ texto: "En negro", en: T0 }], ahora, productoInteres: "combo-camilla" });
  assert.equal(c1.temperatura, "CALIENTE");
  assert.match(c1.motivo, /eligió color \('En negro'\)/);
  const c2 = te.calificar({ mensajes: [{ texto: "¿Qué colores tienen?", en: T0 }], ahora, productoInteres: null });
  assert.equal(c2.temperatura, "TIBIO");
  const c3 = te.calificar({ mensajes: [{ texto: "cuánto vale el butaco", en: T0 }], ahora, productoInteres: null });
  assert.equal(c3.temperatura, "TIBIO");
  assert.match(c3.motivo, /butacos de manicure/);
  const c4 = te.calificar({ mensajes: [{ texto: "cuánto vale", en: T0 }], ahora, productoInteres: null, precioConProductoEsTibio: true });
  assert.equal(c4.temperatura, "FRIO");
  const c5 = te.calificar({ mensajes: [{ texto: "necesito 3 camillas para mi spa", en: T0 }], ahora, productoInteres: null });
  assert.equal(c5.temperatura, "CALIENTE");
  const c6 = te.calificar({ mensajes: [{ texto: "Cómo hago para apartarlo", en: T0 }, { texto: "no gracias, ya no me interesa", en: mas(MIN) }], ahora, productoInteres: null });
  assert.equal(c6.temperatura, "FRIO");
  assert.equal(c6.noInteresa, true);
  // Caída por silencio: Tibio (3) dos días después queda Frío (1); la base no cae.
  const c7 = te.calificar({ mensajes: [{ texto: "¿hacen envíos a Pereira?", en: T0 }], ahora: mas(2 * DIA + H), productoInteres: null });
  assert.equal(c7.temperatura, "FRIO");
  assert.equal(c7.temperaturaBase, "TIBIO");
  assert.match(c7.motivo, /−2 por 2 día/);
  // Con cotización no cae; un Caliente del CRM tampoco.
  assert.equal(te.calificar({ mensajes: [{ texto: "ok", en: T0 }], ahora: mas(5 * DIA), productoInteres: null, etapaCrm: "NEGOCIACION" }).temperatura, "CALIENTE");
});

prueba("motor: FRÍO que LEYÓ y no respondió → 1 mensaje útil del combo (video 50/50), 8–20 h", () => {
  const f = ficha({ mensajes: [IN(0, ANUNCIO), BOT(0.2, "Bienvenid@"), BOT(0.3, "¿Qué servicios vas a ofrecer?", 5)] });
  const antes = mo.evaluarLead(f, CONFIG, mas(30 * MIN)).decision;
  assert.equal(antes.accion, "esperar");
  assert.equal(antes.supresion, "reemplazo");
  const d = mo.evaluarLead(f, CONFIG, mas(70 * MIN)).decision;
  assert.equal(d.accion, "mensaje_util_producto");
  assert.equal(d.mensajeUtil.familia, "combo-camilla");
  assert.equal(d.mensajeUtil.acciones[0].messageType, "VIDEO");
  assert.equal(d.programarPara.getTime(), mas(70 * MIN).getTime());
  // Ya se mandó uno: no insiste.
  assert.equal(mo.evaluarLead({ ...f, mensajesUtiles: 1 }, CONFIG, mas(3 * H)).decision.motivo, "ya_se_mando_el_mensaje_util");
  // De noche se corre a la mañana (8:00–8:30 Bogotá).
  const noche = mo.evaluarLead(f, CONFIG, new Date("2026-10-08T03:30:00Z")).decision; // 22:30 Bogotá
  assert.ok(noche.programarPara.getTime() >= new Date("2026-10-08T13:00:00Z").getTime());
  assert.ok(noche.programarPara.getTime() <= new Date("2026-10-08T13:30:00Z").getTime());
});

prueba("motor: NO LEYÓ → recibe igual que todos (freno no leído APAGADO por defecto, 11-10-2026)", () => {
  assert.equal(CONFIG.motor.respetarNoLeido, false);
  const f = ficha({ mensajes: [IN(0, ANUNCIO), BOT(0.2, "Bienvenid@", null)] });
  const d = mo.evaluarLead(f, CONFIG, mas(3 * H)).decision;
  assert.equal(d.accion, "mensaje_util_producto");
  assert.notEqual(d.motivo, "no_leyo");
  // Ni el JSON del seguimiento inteligente lo prende: solo el interruptor del anti-bloqueo.
  assert.equal(cf.leerConfigDeTexto(JSON.stringify({ motor: { respetarNoLeido: true } })).motor.respetarNoLeido, false);
});

prueba("motor: con el interruptor noLeido PRENDIDO vuelve el 'no leyó → no insistir'", () => {
  const conFreno = { ...CONFIG, motor: { ...CONFIG.motor, respetarNoLeido: true } };
  const f = ficha({ mensajes: [IN(0, ANUNCIO), BOT(0.2, "Bienvenid@", null)] });
  const d = mo.evaluarLead(f, conFreno, mas(3 * H)).decision;
  assert.equal(d.accion, "no_insistir");
  assert.equal(d.motivo, "no_leyo");
  const leido = ficha({ mensajes: [IN(0, ANUNCIO), BOT(0.2, "Bienvenid@", 200)] });
  assert.equal(mo.evaluarLead(leido, conFreno, mas(4 * H)).decision.accion, "mensaje_util_producto");
});

prueba("motor: cadencia — el toque del día 3 NO se salta si no leyó (salvo interruptor prendido)", () => {
  // La asesora escribió y el cliente no leyó: con el freno apagado, el toque sale como tarea.
  const f = ficha({ mensajes: [IN(0, ANUNCIO), BOT(0.2, "fotos"), IN(5, "¿hacen envíos a Cali?"), ASESORA(10, "Hola, sí enviamos a Cali", null)] });
  const t3 = mas(10 * MIN + 3 * DIA + H);
  const d3 = mo.evaluarLead(f, CONFIG, t3).decision;
  assert.equal(d3.accion, "tarea_asesora");
  assert.equal(d3.toque, "dia_3");
  const conFreno = { ...CONFIG, motor: { ...CONFIG.motor, respetarNoLeido: true } };
  assert.notEqual(mo.evaluarLead(f, conFreno, t3).decision.accion, "tarea_asesora");
  // Frío que no leyó: el toque es el mensaje útil, pero el tope de 2 automáticos sigue mandando.
  const frio = ficha({ mensajes: [IN(0, ANUNCIO), BOT(0.2, "fotos"), ASESORA(10, "Hola, soy María", null)] });
  assert.equal(mo.evaluarLead(frio, CONFIG, t3).decision.accion, "mensaje_util_producto");
  const tope = { ...frio, mensajes: [...frio.mensajes, AUTO(10 + 3 * 24 * 60 + 70, "a", null), AUTO(10 + 4 * 24 * 60 + 70, "b", null)] };
  // Con el tope de antes (2) el toque del día 7 ya no sale; con el de hoy (3, Alexander 12-10-2026) sí.
  const tope2 = { ...CONFIG, cadencia: { ...CONFIG.cadencia, maxAutomaticos: 2 } };
  assert.equal(mo.evaluarLead(tope, tope2, mas(10 * MIN + 7 * DIA + H)).decision.motivo, "gracia_antes_de_descartar");
  assert.equal(CONFIG.cadencia.maxAutomaticos, 3);
  assert.equal(mo.evaluarLead(tope, CONFIG, mas(10 * MIN + 7 * DIA + H)).decision.motivo, "cadencia_frio");
});

prueba("motor: el producto que PREGUNTÓ manda (butacos, no el combo)", () => {
  const f = ficha({ mensajes: [IN(0, "info del butaco para manicure"), BOT(0.5, "Te comparto el catálogo")], familiaDelBot: null, flujosEnviados: [] });
  const ev = mo.evaluarLead(f, CONFIG, mas(2 * H));
  assert.equal(ev.familia, "butacos-manicure");
  assert.equal(ev.decision.accion, "mensaje_util_producto");
  assert.match(ev.decision.mensajeUtil.acciones[0].flowId, /fmhd0$/);
});

prueba("motor: TIBIO → tarea B para la asesora con mensaje sugerido (no automático)", () => {
  const f = ficha({ mensajes: [IN(0, ANUNCIO), BOT(0.2, "fotos"), IN(5, "¿hacen envíos a Pereira?"), BOT(5.2, "Sí, enviamos")] });
  // Antes del plazo (30 min) es "esperar" sin automáticos: si la asesora contesta, no hace falta tarea.
  const antes = mo.evaluarLead(f, CONFIG, mas(20 * MIN)).decision;
  assert.equal(antes.accion, "esperar");
  assert.equal(antes.supresion, "siempre");
  const d = mo.evaluarLead(f, CONFIG, mas(40 * MIN)).decision;
  assert.equal(d.accion, "tarea_asesora");
  assert.equal(d.prioridad, "B");
  assert.equal(d.supresion, "siempre");
  assert.match(d.mensajeSugerido, /envío/);
  assert.doesNotMatch(d.mensajeSugerido, /contra ?entrega|gratis/i);
  assert.match(d.mensajeSugerido, /Hola, Laura/);
});

prueba("motor: CALIENTE → tarea A en 15 min y ningún automático encima", () => {
  const f = ficha({ mensajes: [IN(0, ANUNCIO), BOT(0.2, "fotos"), IN(3, "Cómo hago para apartarlo?")] });
  const espera = mo.evaluarLead(f, CONFIG, mas(4 * MIN)).decision;
  assert.equal(espera.accion, "esperar");
  assert.equal(espera.supresion, "siempre");
  assert.equal(espera.revisarEn.getTime(), mas(18 * MIN).getTime());
  const d = mo.evaluarLead(f, CONFIG, mas(19 * MIN)).decision;
  assert.equal(d.accion, "tarea_asesora");
  assert.equal(d.prioridad, "A");
  assert.equal(d.vence.getTime(), mas(18 * MIN).getTime());
  assert.equal(d.supresion, "siempre");
  // Si la asesora contesta antes, no hay tarea: pasa a la cadencia (próximo toque el día 3).
  const contestada = { ...f, mensajes: [...f.mensajes, ASESORA(10, "¡Hola! Te paso los datos")] };
  assert.equal(mo.evaluarLead(contestada, CONFIG, mas(19 * MIN)).decision.motivo, "cadencia_proximo_toque");
  assert.match(d.mensajeSugerido, /50 %/);
});

prueba("motor: COTIZACIÓN → tareas A a las 24 h y 72 h con total y pregunta de cierre", () => {
  const f = ficha({ mensajes: [IN(0, ANUNCIO), ASESORA(10, "Te envío la cotización COT-00123 por $1.250.000")] });
  const antes = mo.evaluarLead(f, CONFIG, mas(5 * H)).decision;
  assert.equal(antes.accion, "esperar");
  assert.equal(antes.supresion, "siempre");
  const d = mo.evaluarLead(f, CONFIG, mas(10 * MIN + 25 * H)).decision;
  assert.equal(d.accion, "tarea_asesora");
  assert.equal(d.toque, "cotizacion_24h");
  assert.match(d.mensajeSugerido, /COT-00123/);
  assert.match(d.mensajeSugerido, /\$1\.250\.000/);
  const hecha = { ...f, mensajes: [...f.mensajes, ASESORA(10 + 26 * 60, "¿Pudiste revisarla?")] };
  const d72 = mo.evaluarLead(hecha, CONFIG, mas(10 * MIN + 73 * H)).decision;
  assert.equal(d72.toque, "cotizacion_72h");
  // Con la cotización vigente no se descarta aunque pasen los toques.
  const todo = { ...hecha, mensajes: [...hecha.mensajes, ASESORA(10 + 74 * 60, "?"), ASESORA(10 + 4 * 24 * 60, "?"), ASESORA(10 + 7 * 24 * 60, "?")] };
  assert.notEqual(mo.evaluarLead(todo, CONFIG, mas(10 * DIA)).decision.accion, "descartar");
});

prueba("motor: FECHA FUTURA → dormido, tarea 7 días antes, se despierta si escribe", () => {
  const cuando = new Date("2026-10-08T04:11:00Z");
  const f = ficha({
    inicioDeLaCharla: new Date("2026-10-07T20:00:00Z"),
    mensajes: [
      { direccion: "IN", tipo: "TEXT", texto: "¿Para cuándo lo necesitas?", en: new Date("2026-10-07T20:00:00Z"), leidoEn: null, origen: "webhook" },
      { direccion: "OUT", tipo: "TEXT", texto: "¿Para cuándo?", en: new Date("2026-10-08T04:00:00Z"), leidoEn: new Date("2026-10-08T04:01:00Z"), origen: null },
      { direccion: "IN", tipo: "TEXT", texto: "Finales de noviembre tal vez", en: cuando, leidoEn: cuando, origen: "webhook" },
      { direccion: "OUT", tipo: "TEXT", texto: "Perfecto, te escribo", en: new Date("2026-10-08T04:15:00Z"), leidoEn: new Date("2026-10-08T04:16:00Z"), origen: "manual" },
    ],
  });
  const d = mo.evaluarLead(f, CONFIG, new Date("2026-10-10T15:00:00Z")).decision;
  assert.equal(d.accion, "dormido");
  assert.equal(d.supresion, "siempre");
  assert.equal(d.dormidoHasta.toISOString().slice(0, 10), "2026-11-25");
  assert.equal(d.revisarEn.toISOString().slice(0, 10), "2026-11-18");
  const cerca = mo.evaluarLead(f, CONFIG, new Date("2026-11-18T16:00:00Z")).decision;
  assert.equal(cerca.accion, "tarea_asesora");
  assert.equal(cerca.motivo, "fecha_futura_cerca");
  assert.match(cerca.mensajeSugerido, /finales de noviembre/);
  // Si escribe antes, se despierta (lo atiende el bot / la asesora como siempre).
  const escribe = { ...f, mensajes: [...f.mensajes, { direccion: "IN", tipo: "TEXT", texto: "Hola, ¿qué colores hay?", en: new Date("2026-10-20T15:00:00Z"), leidoEn: null, origen: "webhook" }] };
  assert.notEqual(mo.evaluarLead(escribe, CONFIG, new Date("2026-10-20T15:05:00Z")).decision.accion, "dormido");
});

prueba("motor: CADENCIA después de la asesora (días 3, 4 y 7) y DESCARTE tras el último", () => {
  const f = ficha({ mensajes: [IN(0, ANUNCIO), BOT(0.2, "fotos"), IN(5, "¿hacen envíos a Cali?"), ASESORA(10, "Hola, sí enviamos a Cali")] });
  const t = (dias, horas = 0) => mas(10 * MIN + dias * DIA + horas * H);
  assert.equal(mo.evaluarLead(f, CONFIG, t(1)).decision.motivo, "cadencia_proximo_toque");
  const d3 = mo.evaluarLead(f, CONFIG, t(3, 1)).decision;
  assert.equal(d3.accion, "tarea_asesora");
  assert.equal(d3.toque, "dia_3");
  assert.equal(d3.prioridad, "B");
  const con3 = { ...f, mensajes: [...f.mensajes, ASESORA(10 + 3 * 24 * 60 + 90, "¿Pudiste verlo?")] };
  assert.equal(mo.evaluarLead(con3, CONFIG, t(3, 5)).decision.accion, "esperar");
  assert.equal(mo.evaluarLead(con3, CONFIG, t(4, 1)).decision.toque, "dia_4");
  const con4 = { ...con3, mensajes: [...con3.mensajes, ASESORA(10 + 4 * 24 * 60 + 60, "?")] };
  const d7 = mo.evaluarLead(con4, CONFIG, t(7, 1)).decision;
  assert.equal(d7.toque, "dia_7");
  assert.match(d7.mensajeSugerido, /No quiero insistirte/);
  const con7 = { ...con4, mensajes: [...con4.mensajes, ASESORA(10 + 7 * 24 * 60 + 60, "?")] };
  assert.equal(mo.evaluarLead(con7, CONFIG, t(7, 12)).decision.motivo, "gracia_antes_de_descartar");
  const desc = mo.evaluarLead(con7, CONFIG, t(8, 2)).decision;
  assert.equal(desc.accion, "descartar");
  assert.equal(desc.motivo, "sin_respuesta_tras_3_seguimientos");
  // Toque atrasado: si no hizo el del día 3 y ya es día 4, queda UNA tarea (la del 4), no dos.
  assert.equal(mo.evaluarLead(f, CONFIG, t(4, 2)).decision.toque, "dia_4");
});

prueba("motor: cadencia de un FRÍO = mensaje útil automático (respeta el tope de automáticos)", () => {
  const f = ficha({ mensajes: [IN(0, ANUNCIO), BOT(0.2, "fotos"), ASESORA(10, "Hola, soy María")] });
  const d = mo.evaluarLead(f, CONFIG, mas(10 * MIN + 3 * DIA + H)).decision;
  assert.equal(d.accion, "mensaje_util_producto");
  assert.equal(d.toque, "dia_3");
  // Con 2 automáticos ya enviados en este silencio, el 3.er toque de un Frío se salta (el
  // anti-bloqueo lo frenaría y no vale una tarea humana) y, tras la gracia, se descarta.
  // (Con el tope de 2 de antes; desde el 12-10-2026 el tope es 3 y el del día 7 todavía sale.)
  const tope2 = { ...CONFIG, cadencia: { ...CONFIG.cadencia, maxAutomaticos: 2 } };
  const tope = { ...f, mensajes: [...f.mensajes, AUTO(10 + 3 * 24 * 60 + 70, "a"), AUTO(10 + 4 * 24 * 60 + 70, "b")] };
  const d7 = mo.evaluarLead(tope, tope2, mas(10 * MIN + 7 * DIA + H)).decision;
  assert.equal(d7.accion, "esperar");
  assert.equal(d7.motivo, "gracia_antes_de_descartar");
  assert.equal(mo.evaluarLead(tope, tope2, mas(10 * MIN + 8 * DIA + H)).decision.accion, "descartar");
  assert.equal(mo.evaluarLead(tope, CONFIG, mas(10 * MIN + 7 * DIA + H)).decision.accion, "mensaje_util_producto");
  // Un Frío sin mensaje útil para su producto (tocador): los toques se saltan, sin tareas.
  const tocador = ficha({ familiaDelBot: null, mensajes: [IN(0, "info del tocador"), BOT(0.2, "hola"), ASESORA(10, "Hola")] });
  assert.notEqual(mo.evaluarLead(tocador, CONFIG, mas(10 * MIN + 3 * DIA + H)).decision.accion, "tarea_asesora");
});

prueba("motor: fuera de Colombia, PERDIDO y 'no me interesa'", () => {
  const brasil = ficha({ pais: "EXTERIOR", mensajes: [IN(0, "Valor da cadeira de manicure?"), BOT(0.3, "Bienvenid@", null)] });
  assert.equal(mo.evaluarLead(brasil, CONFIG, mas(MIN)).decision.accion, "excluir_exterior");
  const enColombia = ficha({ pais: "EXTERIOR", mensajes: [IN(0, ANUNCIO), BOT(0.3, "¿En qué ciudad?"), IN(2, "Pereira risaralda")] });
  assert.notEqual(mo.evaluarLead(enColombia, CONFIG, mas(3 * MIN)).decision.accion, "excluir_exterior");
  const sinInterruptor = cf.leerConfigDeTexto(JSON.stringify({ motor: { modo: "sombra" } }));
  assert.notEqual(mo.evaluarLead(brasil, sinInterruptor, mas(MIN)).decision.accion, "excluir_exterior");
  assert.equal(mo.evaluarLead(ficha({ etapaCrm: "PERDIDO", mensajes: [IN(0, "hola")] }), CONFIG, mas(MIN)).decision.motivo, "etapa_cerrada");
  assert.equal(mo.evaluarLead(ficha({ mensajes: [IN(0, "no gracias, no me interesa"), BOT(1, "ok")] }), CONFIG, mas(2 * H)).decision.motivo, "no_le_interesa");
});

prueba("convivencia: qué genérico se frena con el motor activo", () => {
  const con = { reemplazarGenericosEnFrios: true, reglasV3: [], followsDeEtapa: true };
  const base = { motorActivo: true, exteriorActivo: false, esExterior: false, motor: "v3", convivencia: con };
  assert.equal(cv.decidirConvivencia({ ...base, accion: "tarea_asesora", supresion: "siempre" }), "inteligente_tarea_humana");
  assert.equal(cv.decidirConvivencia({ ...base, accion: "no_insistir", supresion: "siempre" }), "inteligente_no_insistir");
  assert.equal(cv.decidirConvivencia({ ...base, accion: "esperar", supresion: "reemplazo" }), "inteligente_reemplazado");
  assert.equal(cv.decidirConvivencia({ ...base, accion: "esperar", supresion: "reemplazo", convivencia: { ...con, reemplazarGenericosEnFrios: false } }), null);
  assert.equal(cv.decidirConvivencia({ ...base, accion: "esperar", supresion: "reemplazo", convivencia: { ...con, reglasV3: ["r1"] }, reglaId: "r2" }), null);
  assert.equal(cv.decidirConvivencia({ ...base, motor: "follow", accion: "esperar", supresion: "reemplazo", nombre: "Etapa OBJECIONES · 1 día" }), "inteligente_reemplazado");
  assert.equal(cv.decidirConvivencia({ ...base, motor: "follow", accion: "esperar", supresion: "reemplazo", nombre: "Mi recordatorio" }), null);
  assert.equal(cv.decidirConvivencia({ ...base, motor: "follow", accion: "tarea_asesora", supresion: "siempre", nombre: "Inteligente: combo-camilla" }), null);
  // Apagado (o decisión de sombra): no frena nada.
  assert.equal(cv.decidirConvivencia({ ...base, motorActivo: false, accion: "tarea_asesora", supresion: "siempre" }), null);
  assert.equal(cv.decidirConvivencia({ ...base, motorActivo: false, exteriorActivo: true, esExterior: true, accion: null, supresion: null }), "fuera_de_colombia");
});

prueba("config: sin fila o con JSON roto, TODO apagado; valores por defecto pedidos", () => {
  for (const texto of [null, "", "{roto", "[]"]) {
    const c = cf.leerConfigDeTexto(texto);
    assert.equal(c.calificacion.activo, false);
    assert.equal(c.motor.modo, "apagado");
    assert.equal(c.cadencia.descarte, "apagado");
    assert.equal(c.exterior.activo, false);
    assert.equal(cf.algoPrendido(c), false);
  }
  const d = cf.CONFIG_POR_DEFECTO;
  assert.deepEqual(d.cadencia.dias, [3, 4, 7]);
  assert.equal(d.fechaFutura.diasAntes, 7);
  assert.deepEqual(d.cotizacion.horas, [24, 72]);
  assert.equal(d.motor.desdeHora, 8);
  assert.equal(d.motor.hastaHora, 20);
  assert.equal(d.motor.maxMensajesUtiles, 1);
  assert.equal(cf.leerConfigDeTexto(JSON.stringify({ motor: { modo: "loco" } })).motor.modo, "apagado");
  assert.deepEqual(cf.leerConfigDeTexto(JSON.stringify({ cadencia: { dias: [7, 3, "x", 3] } })).cadencia.dias, [3, 7]);
  assert.doesNotMatch(d.exterior.texto, /contra ?entrega|gratis/i);
});

prueba("tope: 15 por asesora; A antes que B, caliente y antigua primero; excedente a quien tenga cupo", () => {
  const ahora = new Date("2026-10-08T15:00:00Z"); // 10:00 Bogotá
  const tarea = (i, prioridad, temperatura, minutosAtras, duena = "ingrid", elegibles = ["ingrid", "maria", "genesis"]) => ({
    conversationId: `c${String(i).padStart(3, "0")}`,
    prioridad,
    temperatura,
    vence: new Date(ahora.getTime() - minutosAtras * MIN),
    duena,
    elegibles,
  });
  // 20 de Ingrid: 5 A y 15 B. Tope 15 → se queda las 5 A + 10 B (las más calientes/antiguas); 5 B pasan.
  const tareas = [
    ...Array.from({ length: 15 }, (_, i) => tarea(i, "B", i < 5 ? "TIBIO" : "FRIO", 100 + i)),
    ...Array.from({ length: 5 }, (_, i) => tarea(100 + i, "A", "CALIENTE", 10 + i)),
  ];
  const planes = tp.planearTareas({ tareas, tope: 15, ahora });
  const deIngrid = planes.filter((p) => p.para === "ingrid" && p.estado === "propia").map((p) => p.conversationId);
  assert.equal(deIngrid.length, 15);
  for (let i = 100; i < 105; i += 1) assert.ok(deIngrid.includes(`c${i}`), "las A se quedan con su dueña");
  for (let i = 0; i < 5; i += 1) assert.ok(deIngrid.includes(`c00${i}`), "las B tibias antes que las frías");
  const pasadas = planes.filter((p) => p.estado === "redistribuida");
  assert.equal(pasadas.length, 5);
  assert.ok(pasadas.every((p) => p.de === "ingrid" && ["maria", "genesis"].includes(p.para)));
  // Se reparten a la de menos carga: 3 y 2.
  const porAsesora = pasadas.reduce((a, p) => ((a[p.para] = (a[p.para] ?? 0) + 1), a), {});
  assert.deepEqual(Object.values(porAsesora).sort(), [2, 3]);
  assert.equal(tp.ordenarTareas(tareas)[0].prioridad, "A");
});

prueba("tope: sin cupo en nadie → pospuesta a mañana 8:00 (no se pierde); lo planeado hoy no se mueve", () => {
  const ahora = new Date("2026-10-08T15:00:00Z");
  const t = (i, duena, elegibles, plan = null) => ({ conversationId: `p${i}`, prioridad: "B", temperatura: "TIBIO", vence: new Date(ahora.getTime() - i * MIN), duena, elegibles, plan });
  // María llena con 2 ya planeadas hoy (tope 2); Ingrid llena; Génesis fuera de horario (no elegible).
  const hoy = tp.diaBogota(ahora);
  const tareas = [
    t(1, "maria", ["maria"], { dia: hoy, para: "maria", estado: "propia" }),
    t(2, "maria", ["maria"], { dia: hoy, para: "maria", estado: "propia" }),
    t(3, "ingrid", ["ingrid", "maria"], { dia: hoy, para: "ingrid", estado: "propia" }),
    t(4, "ingrid", ["ingrid", "maria"], { dia: hoy, para: "ingrid", estado: "propia" }),
    t(5, "ingrid", ["ingrid", "maria"]),
    t(6, null, ["ingrid", "maria"]),
  ];
  const planes = tp.planearTareas({ tareas, tope: 2, ahora });
  assert.equal(planes.length, 2, "solo se planean las nuevas");
  const p5 = planes.find((p) => p.conversationId === "p5");
  assert.equal(p5.estado, "pospuesta");
  assert.equal(p5.pospuestaHasta, "2026-10-09T13:00:00.000Z");
  assert.equal(planes.find((p) => p.conversationId === "p6").estado, "sin_duena");
  // Mañana: la pospuesta vuelve a entrar con su antigüedad y, con cupo nuevo, es de su dueña.
  const manana = new Date("2026-10-09T13:05:00Z");
  const otra = tp.planearTareas({ tareas: [{ ...t(5, "ingrid", ["ingrid", "maria"]), plan: { dia: hoy, ...p5 } }], tope: 2, ahora: manana });
  assert.deepEqual([otra[0].estado, otra[0].para, otra[0].dia], ["propia", "ingrid", "2026-10-09"]);
  // Antes de las 8:00 de mañana sigue quieta.
  assert.equal(tp.planearTareas({ tareas: [{ ...t(5, "ingrid", ["ingrid"]), plan: { dia: hoy, ...p5 } }], tope: 2, ahora: new Date("2026-10-09T12:00:00Z") }).length, 0);
  // Tope 0 = sin tope.
  assert.ok(tp.planearTareas({ tareas: Array.from({ length: 40 }, (_, i) => t(100 + i, "ingrid", ["ingrid"])), tope: 0, ahora }).every((p) => p.estado === "propia"));
});

prueba("F2 recalibrado (10-oct): casos reales que quedaban Fríos pasan a Tibio; los Fríos genuinos siguen Fríos", () => {
  const ahora = mas(2 * H);
  const cal = (textos, productoInteres = "combo-camilla") =>
    te.calificar({ mensajes: textos.map((texto, i) => ({ texto, en: mas(i * MIN) })), ahora, productoInteres });
  // cv16c1a0: antes "Frío (1): pidió fotos o video ('Fotos')".
  const pestanas = cal([ANUNCIO, "Sirve para pestañas?", "Fotos"]);
  assert.equal(pestanas.temperaturaBase, "TIBIO");
  assert.match(pestanas.motivo, /sirve para su servicio \('Sirve para pestañas\?'\)/);
  // cv3639b6: antes Frío → mensaje_util_producto.
  const lavacabezas = cal(["Videos del lavacabezas"], "lavacabezas");
  assert.equal(lavacabezas.temperaturaBase, "TIBIO");
  assert.match(lavacabezas.motivo, /producto concreto/);
  // Respondió la pregunta de servicios y pidió información.
  assert.equal(cal([ANUNCIO, "Uñas", "Fotos"]).temperaturaBase, "TIBIO");
  assert.equal(cal([ANUNCIO, "Masajes y faciales", "cuánto vale"]).temperaturaBase, "TIBIO");
  assert.equal(cal(["Por favor catálogo de camilla fija"], "camillas").temperaturaBase, "TIBIO");
  // Fríos genuinos.
  assert.equal(cal([ANUNCIO]).temperaturaBase, "FRIO");
  assert.equal(cal([ANUNCIO, "ok"]).temperaturaBase, "FRIO");
  assert.equal(cal([ANUNCIO, "gracias"]).temperaturaBase, "FRIO");
  assert.equal(cal([ANUNCIO, "Fotos"]).temperaturaBase, "FRIO");
  assert.equal(cal([ANUNCIO, "Masajes"]).temperaturaBase, "FRIO");
  assert.equal(cal([ANUNCIO, "Uñas", "Fotos", "no me interesa"]).temperaturaBase, "FRIO");
});

prueba("motor: los casos reales Tibios son TAREA de la asesora asignada, no mensaje automático", () => {
  // cv16c1a0 (10-oct): ANUNCIO 10:21, "Sirve para pestañas?" 10:22, auto-asignado a Ingrid, "Fotos",
  // el bot manda fotos y precio, seguimientos del V3 a los 17 y 78 min, ninguna persona escribe.
  const pestanas = ficha({
    asignadaA: "ingrid",
    mensajes: [
      IN(0, ANUNCIO),
      BOT(0.25, "Bienvenid@ a Magilus"),
      BOT(0.26, "¿Qué servicios vas a ofrecer en tu espacio?"),
      IN(0.7, "Sirve para pestañas?"),
      BOT(0.95, "¡Perfecto! Nuestra camilla soporta hasta 200 kg"),
      IN(1.2, "Fotos"),
      BOT(1.5, "Ya te comparto las fotos, el precio el 989.000"),
      BOT(2.1, "¿En qué color lo quieres?"),
      AUTO(17.6, "Para apartar tu combo solo me falta el color"),
      AUTO(78.6, "¿En qué ciudad lo recibirías?", null),
    ],
  });
  const antes = mo.evaluarLead(pestanas, CONFIG, mas(20 * MIN)).decision;
  assert.equal(antes.accion, "esperar");
  assert.equal(antes.supresion, "siempre");
  const ev = mo.evaluarLead(pestanas, CONFIG, mas(3 * H));
  assert.equal(ev.calificacion.temperaturaBase, "TIBIO");
  assert.equal(ev.decision.accion, "tarea_asesora");
  assert.equal(ev.decision.prioridad, "B");
  assert.equal(ev.decision.supresion, "siempre");
  assert.match(ev.decision.mensajeSugerido, /pestañas/);
  assert.doesNotMatch(ev.decision.mensajeSugerido, /contra ?entrega|gratis/i);
  // cv3639b6: "Videos del lavacabezas" → antes mensaje_util_producto; ahora tarea.
  const lavacabezas = ficha({ familiaDelBot: null, mensajes: [IN(0, "Videos del lavacabezas"), BOT(0.5, "Catálogo de lavacabezas")] });
  const ev2 = mo.evaluarLead(lavacabezas, CONFIG, mas(2 * H));
  assert.equal(ev2.familia, "lavacabezas");
  assert.equal(ev2.decision.accion, "tarea_asesora");
  assert.equal(ev2.decision.mensajeUtil, null);
  // Un "Fotos" suelto sin servicio sigue Frío y recibe su mensaje útil (no gasta tiempo humano).
  const fotos = ficha({ mensajes: [IN(0, ANUNCIO), BOT(0.2, "¿Qué servicios vas a ofrecer?"), IN(1, "Fotos"), BOT(1.3, "Te comparto las fotos")] });
  assert.equal(mo.evaluarLead(fotos, CONFIG, mas(2 * H)).decision.accion, "mensaje_util_producto");
});

prueba("config: tope de tareas por defecto 15", () => {
  assert.equal(cf.CONFIG_POR_DEFECTO.tareas.maxPorAsesoraDia, 15);
  assert.equal(cf.leerConfigDeTexto(null).tareas.maxPorAsesoraDia, 15);
  assert.equal(cf.leerConfigDeTexto(JSON.stringify({ tareas: { maxPorAsesoraDia: 10 } })).tareas.maxPorAsesoraDia, 10);
});

/* ---------------------------------------------------------------------------------------------- */
/* Pedido de datos de la asesora (formulario) sin respuesta: 2 h / 24 h / 72 h (Alexander, 11-10-2026). */

const fm = cargar(`${D}/formulario.ts`);
const FORMULARIO =
  "Para continuar con el proceso de cotización formal por favor completa estos datos,\nDatos de Cotización ✨\n\n🌟 Nombre y Apellido:\n✍️ NIT / C.C:\n📧 Correo Electrónico:\n📞 Teléfono:\n🏠 Dirección:\n🏙️ Ciudad y Barrio:\n📍 Departamento:\n     Color:";
const EN = (iso, direccion, texto, origen) => ({ direccion, tipo: texto ? "TEXT" : "AUDIO", texto, en: new Date(iso), leidoEn: new Date(iso), estado: "READ", origen });
/** cv3a2aa2b2f953c5543ccca57e (sábado 10-oct): Caliente, eligió lila, preguntó precio; Ingrid manda el formulario a las 4:47 p. m. */
const casoLila = (extra = []) =>
  ficha({
    inicioDeLaCharla: new Date("2026-10-10T18:30:00Z"),
    asignadaA: "ingrid",
    pausado: true,
    mensajes: [
      EN("2026-10-10T18:37:47Z", "IN", "Lila", "webhook"),
      EN("2026-10-10T18:37:53Z", "OUT", "¿En qué color lo quieres?😊", null),
      EN("2026-10-10T18:38:59Z", "IN", "Hay color lila?", "webhook"),
      EN("2026-10-10T21:31:00Z", "OUT", "", "manual"),
      EN("2026-10-10T21:32:53Z", "IN", "Carrito lila", "webhook"),
      EN("2026-10-10T21:34:11Z", "OUT", "👩‍💻*Ingrid Sánchez*\nok reina listo cuentame en que ciudad te encuentras?", "manual"),
      EN("2026-10-10T21:35:24Z", "IN", "Tauramena, Casanare", "webhook"),
      EN("2026-10-10T21:37:01Z", "IN", "La camilla se dobla?", "webhook"),
      EN("2026-10-10T21:40:21Z", "OUT", "", "manual"),
      EN("2026-10-10T21:42:23Z", "IN", "Fija", "webhook"),
      EN("2026-10-10T21:44:54Z", "IN", "Entonces como sería el precio de la camilla fija?", "webhook"),
      EN("2026-10-10T21:45:07Z", "IN", "Color lila, que no sea morado", "webhook"),
      EN("2026-10-10T21:47:00Z", "OUT", "", "manual"),
      EN("2026-10-10T21:47:57Z", "OUT", FORMULARIO, "manual"),
      ...extra,
    ],
  });
const SIN_FORMULARIO = cf.leerConfigDeTexto(
  JSON.stringify({ calificacion: { activo: true }, motor: { modo: "activo" }, cadencia: { descarte: "activo" }, exterior: { activo: true }, formulario: { activo: false } }),
);

prueba("formulario: detecta el pedido de datos (formulario y frases) y no confunde nuestros datos de pago", () => {
  assert.equal(fm.esPedidoDeDatos(FORMULARIO), true);
  assert.equal(fm.esPedidoDeDatos("Nombre completo, cédula, dirección y ciudad por favor"), true);
  assert.equal(fm.esPedidoDeDatos("Listo reina, me regalas tus datos para la cotización?"), true);
  assert.equal(fm.esPedidoDeDatos("Me compartes por favor tus datos para separar"), true);
  assert.equal(fm.esPedidoDeDatos("Necesito los datos para el envío"), true);
  assert.equal(fm.esPedidoDeDatos("Por favor llena el formulario y te separo"), true);
  // Lo que NO es pedir datos.
  assert.equal(fm.esPedidoDeDatos("¡Hola! Te paso los datos"), false);
  assert.equal(fm.esPedidoDeDatos("Te paso los datos para consignar: Bancolombia ahorros"), false);
  assert.equal(fm.esPedidoDeDatos("¿En qué ciudad te encuentras?"), false);
  assert.equal(fm.esPedidoDeDatos("Te envío la cotización COT-00123 por $1.250.000"), false);
  assert.equal(fm.esPedidoDeDatos(""), false);
  // Casos reales de la simulación: nuestra dirección y los datos de una guía ya llenos no son pedidos.
  assert.equal(fm.esPedidoDeDatos("Dirección carrera 27 #72 x25 barrio omar Torrijos Cali Valle Celular 3046481994"), false);
  assert.equal(fm.esPedidoDeDatos("Cliente EMPRESA SAS\nCC/NIT: 900407222\nTeléfono: 3176131958\nDestino Ciudad: BOGOTA\nDirección: Cra 5 # 10-20"), false);
  assert.equal(fm.esPedidoDeDatos("*Datos de Cotización* ✨\n🌟 Nombre y Apellido:\n✍️ NIT / C.C:\n📞 Teléfono:\n🏠 Dirección:"), true);
  assert.equal(fm.esPedidoDeDatos("Nombre:\nCédula:\nCiudad:\nDirección:"), true);
  assert.equal(fm.esPedidoDeDatos("Me confirma por favor los datos para realizar la cotización"), true);
  // Color elegido: "Color lila, que no sea morado" = lila.
  assert.equal(fm.colorDelCliente(["Hola", "Color lila, que no sea morado"]), "lila");
  assert.equal(fm.colorDelCliente(["en negro", "ok"]), "negro");
  assert.equal(fm.colorDelCliente(["hola"]), null);
});

prueba("formulario: horario laboral = el del Supervisor (L–S 8–18 Bogotá); fuera → siguiente apertura", () => {
  const h = { desde: 8, hasta: 18, dias: [1, 2, 3, 4, 5, 6] };
  // Miércoles 13:00 Bogotá: dentro.
  assert.equal(fm.siguienteHoraLaboral(new Date("2026-10-07T18:00:00Z"), h).toISOString(), "2026-10-07T18:00:00.000Z");
  // Miércoles 19:00 Bogotá → jueves 8:00.
  assert.equal(fm.siguienteHoraLaboral(new Date("2026-10-08T00:00:00Z"), h).toISOString(), "2026-10-08T13:00:00.000Z");
  // Sábado 18:47 → lunes 8:00 (el domingo no se trabaja).
  assert.equal(fm.siguienteHoraLaboral(new Date("2026-10-10T23:47:57Z"), h).toISOString(), "2026-10-12T13:00:00.000Z");
  // Madrugada del martes 6:00 → martes 8:00.
  assert.equal(fm.siguienteHoraLaboral(new Date("2026-10-13T11:00:00Z"), h).toISOString(), "2026-10-13T13:00:00.000Z");
});

prueba("formulario: sin respuesta → tarea a las 2 h laborales (dentro del horario), A si es Caliente", () => {
  // Miércoles 11:00 Bogotá: el cliente elige color; 11:10 la asesora manda el formulario.
  const f = ficha({ asignadaA: "ingrid", mensajes: [IN(0, ANUNCIO), BOT(0.2, "fotos"), IN(4, "En negro"), IN(5, "cuánto vale?"), ASESORA(10, FORMULARIO)] });
  const antes = mo.evaluarLead(f, CONFIG, mas(70 * MIN)).decision;
  assert.equal(antes.accion, "esperar");
  assert.equal(antes.motivo, "formulario_esperando_escalon");
  assert.equal(antes.revisarEn.getTime(), mas(130 * MIN).getTime());
  assert.equal(antes.supresion, "siempre");
  const d = mo.evaluarLead(f, CONFIG, mas(131 * MIN)).decision;
  assert.equal(d.accion, "tarea_asesora");
  assert.equal(d.motivo, "formulario_sin_respuesta");
  assert.equal(d.toque, "formulario_2h");
  assert.equal(d.prioridad, "A");
  assert.equal(d.vence.getTime(), mas(130 * MIN).getTime());
  assert.match(d.mensajeSugerido, /Te ayudo a completar los datos/);
  assert.match(d.mensajeSugerido, /color \*negro\*/);
  assert.doesNotMatch(d.mensajeSugerido, /\$|\d{3}\.\d{3}|contra ?entrega|gratis/i);
  // Tibio → B.
  const tibio = ficha({ mensajes: [IN(0, ANUNCIO), BOT(0.2, "fotos"), IN(5, "¿hacen envíos a Pereira?"), ASESORA(10, "Me regalas tus datos para la cotización?")] });
  const dt = mo.evaluarLead(tibio, CONFIG, mas(131 * MIN)).decision;
  assert.equal(dt.motivo, "formulario_sin_respuesta");
  assert.equal(dt.prioridad, "B");
});

prueba("formulario: caso real cv3a2aa2 (sábado 4:47 p. m.) → tarea el lunes 8:00, no 24 h de silencio", () => {
  const f = casoLila();
  // Antes del cambio: "esperar / cotizacion_esperando_escalon" hasta el domingo 4:47 p. m.
  const hoy = mo.evaluarLead(f, SIN_FORMULARIO, new Date("2026-10-10T22:00:00Z")).decision;
  assert.equal(hoy.motivo, "cotizacion_esperando_escalon");
  assert.equal(hoy.revisarEn.toISOString(), "2026-10-11T21:47:57.000Z");
  // Ahora: 4:47 p. m. + 2 h = 6:47 p. m. (cerrado) → lunes 8:00 Bogotá.
  const ev = mo.evaluarLead(f, CONFIG, new Date("2026-10-10T22:00:00Z"));
  assert.equal(ev.decision.motivo, "formulario_esperando_escalon");
  assert.equal(ev.decision.revisarEn.toISOString(), "2026-10-12T13:00:00.000Z");
  const lunes = mo.evaluarLead(f, CONFIG, new Date("2026-10-12T13:01:00Z")).decision;
  assert.equal(lunes.accion, "tarea_asesora");
  assert.equal(lunes.toque, "formulario_2h");
  assert.equal(lunes.prioridad, "A");
  assert.equal(lunes.vence.toISOString(), "2026-10-12T13:00:00.000Z");
  assert.match(lunes.mensajeSugerido, /color \*lila\*/);
  // La de 24 h (domingo 4:47 p. m. → también lunes 8:00) se corre: un toque por vez, martes 8:00.
  const hecha = casoLila([EN("2026-10-12T13:05:00Z", "OUT", "¿Te ayudo a completar los datos?", "manual")]);
  const espera = mo.evaluarLead(hecha, CONFIG, new Date("2026-10-12T15:00:00Z")).decision;
  assert.equal(espera.motivo, "formulario_esperando_escalon");
  assert.equal(espera.toque, "formulario_24h");
  assert.equal(espera.revisarEn.toISOString(), "2026-10-13T13:00:00.000Z");
});

prueba("formulario: si el cliente responde se cancela; 24 h y 72 h; después sigue la cadencia de siempre", () => {
  const f = ficha({ asignadaA: "ingrid", mensajes: [IN(0, ANUNCIO), BOT(0.2, "fotos"), IN(4, "En negro"), IN(5, "cuánto vale?"), ASESORA(10, FORMULARIO)] });
  // Responde (aunque sea a medias): ya no hay tareas de formulario.
  const responde = { ...f, mensajes: [...f.mensajes, IN(60, "Laura Gómez, Cali")] };
  for (const t of [mas(131 * MIN), mas(25 * H), mas(73 * H)]) assert.notEqual(mo.evaluarLead(responde, CONFIG, t).decision.motivo, "formulario_sin_respuesta");
  // Hizo la de 2 h: espera la de 24 h (jueves 11:10, dentro del horario).
  const con2 = { ...f, mensajes: [...f.mensajes, ASESORA(135, "¿Te ayudo a completar los datos?")] };
  const espera24 = mo.evaluarLead(con2, CONFIG, mas(5 * H)).decision;
  assert.equal(espera24.motivo, "formulario_esperando_escalon");
  assert.equal(espera24.toque, "formulario_24h");
  assert.equal(espera24.revisarEn.getTime(), mas(10 * MIN + 24 * H).getTime());
  const d24 = mo.evaluarLead(con2, CONFIG, mas(10 * MIN + 24 * H + MIN)).decision;
  assert.equal(d24.accion, "tarea_asesora");
  assert.equal(d24.toque, "formulario_24h");
  // Hizo la de 24 h: la de 72 h (sábado 11:10, dentro del horario).
  const con24 = { ...con2, mensajes: [...con2.mensajes, ASESORA(10 + 24 * 60 + 20, "¿Pudiste ver los datos?")] };
  const d72 = mo.evaluarLead(con24, CONFIG, mas(10 * MIN + 72 * H + MIN)).decision;
  assert.equal(d72.toque, "formulario_72h");
  assert.match(d72.mensajeSugerido, /prefieres que te llame/);
  // Hizo la de 72 h: sigue la lógica de siempre (cadencia, próximo toque el día 4).
  const con72 = { ...con24, mensajes: [...con24.mensajes, ASESORA(10 + 72 * 60 + 30, "¿Te ayudo?")] };
  const despues = mo.evaluarLead(con72, CONFIG, mas(10 * MIN + 72 * H + 2 * H)).decision;
  assert.notEqual(despues.motivo, "formulario_sin_respuesta");
  assert.notEqual(despues.motivo, "formulario_esperando_escalon");
  assert.equal(mo.evaluarLead(con72, CONFIG, mas(10 * MIN + 4 * DIA + H)).decision.toque, "dia_4");
  // Atrasada: si no hizo la de 2 h y ya pasó la de 24 h, queda UNA tarea (la de 24 h).
  assert.equal(mo.evaluarLead(f, CONFIG, mas(10 * MIN + 24 * H + MIN)).decision.toque, "formulario_24h");
  // Un "quedo atenta" a los 5 min del formulario NO cuenta como el toque de 2 h.
  const atenta = { ...f, mensajes: [...f.mensajes, ASESORA(15, "Quedo atenta 😊")] };
  assert.equal(mo.evaluarLead(atenta, CONFIG, mas(131 * MIN)).decision.toque, "formulario_2h");
});

prueba("formulario: con el interruptor APAGADO todo queda exactamente como antes", () => {
  assert.equal(cf.CONFIG_POR_DEFECTO.formulario.activo, true);
  assert.deepEqual(cf.CONFIG_POR_DEFECTO.formulario.horas, [2, 24, 72]);
  assert.equal(cf.leerConfigDeTexto(null).formulario.activo, true);
  assert.equal(SIN_FORMULARIO.formulario.activo, false);
  const f = ficha({ asignadaA: "ingrid", mensajes: [IN(0, ANUNCIO), BOT(0.2, "fotos"), IN(4, "En negro"), IN(5, "cuánto vale?"), ASESORA(10, FORMULARIO)] });
  const caso = casoLila();
  // La decisión apagada es la misma que daría el motor sin el paso nuevo (motivos de antes).
  for (const [ficha_, t] of [[f, mas(131 * MIN)], [f, mas(25 * H)], [f, mas(73 * H)], [caso, new Date("2026-10-12T13:01:00Z")], [caso, new Date("2026-10-11T22:00:00Z")]]) {
    const d = mo.evaluarLead(ficha_, SIN_FORMULARIO, t).decision;
    assert.ok(!d.motivo.startsWith("formulario_"), d.motivo);
  }
  assert.equal(mo.evaluarLead(caso, SIN_FORMULARIO, new Date("2026-10-11T22:00:00Z")).decision.toque, "cotizacion_24h");
  // Con el motor apagado no hay nada (el interruptor del formulario solo actúa con el motor prendido).
  assert.equal(cf.algoPrendido(cf.leerConfigDeTexto(JSON.stringify({ formulario: { activo: true } }))), false);
});

prueba("formulario: sus tareas pasan por el mismo tope de 15 por asesora", () => {
  const ahora = new Date("2026-10-12T15:00:00Z");
  // 12 del motor de siempre + 6 de formulario (A, Caliente) para Ingrid, sin nadie más con cupo.
  const tareas = [
    ...Array.from({ length: 12 }, (_, i) => ({ conversationId: `s${i}`, prioridad: "B", temperatura: "TIBIO", vence: new Date(ahora.getTime() - (100 + i) * MIN), duena: "ingrid", elegibles: ["ingrid"] })),
    ...Array.from({ length: 6 }, (_, i) => ({ conversationId: `f${i}`, prioridad: "A", temperatura: "CALIENTE", vence: new Date(ahora.getTime() - (10 + i) * MIN), duena: "ingrid", elegibles: ["ingrid"] })),
  ];
  const planes = tp.planearTareas({ tareas, tope: cf.CONFIG_POR_DEFECTO.tareas.maxPorAsesoraDia, ahora });
  const propias = planes.filter((p) => p.estado === "propia");
  assert.equal(propias.length, 15);
  // Las de formulario (A) entran todas; 3 B se posponen a mañana (no se pierden).
  for (let i = 0; i < 6; i += 1) assert.ok(propias.some((p) => p.conversationId === `f${i}`));
  assert.equal(planes.filter((p) => p.estado === "pospuesta").length, 3);
});

prueba("color elegido / producto del chat (11-oct): solo elecciones claras; 'solo la camilla' no es combo", () => {
  for (const [texto, color] of [["Rosado", "rosado"], ["Color crema", "crema"], ["en negro porfa", "negro"], ["quiero la camilla en blanco", "blanco"], ["la negra", "negra"]]) {
    assert.equal(te.colorElegido(texto), color, texto);
  }
  for (const texto of ["tengo una camilla blanca vieja", "¿la tienen en negro?", "qué colores hay", "Ah, bueno, visto, muy bien, muchas gracias."]) {
    assert.equal(te.colorElegido(texto), null, texto);
  }
  const combo = "Hola, me interesa el COMBO de estética (camilla, escalera, silla y auxiliar)";
  assert.equal(pr.productoDelChat(["Solo la camilla"], [combo]), "camillas");
  assert.equal(pr.productoDelChat(["hola"], ["camilla sola", combo]), "camillas");
  assert.equal(pr.productoDelChat(["Rosado"], [combo]), "combo-camilla");
  assert.equal(pr.nombreEnSingular("camillas"), "camilla");
});

/* ------------------------------------------------------------------ pausa acordada (26-oct) */

const PA = cargar("src/features/supervisor/dominio/pausa-acordada.ts");
const CONFIG_PAUSA = cf.leerConfigDeTexto(JSON.stringify({ calificacion: { activo: true }, motor: { modo: "activo" }, pausaAcordada: { activo: true } }));
const CASO_26_OCT = [IN(0, "Espero que me organicen el lugar donde voy a trabajar"), ASESORA(5, "Quedamos al pendiente, cualquier cosa me escribes 😊")];

prueba("pausa acordada: el interruptor viene apagado y 'dias' se acota", () => {
  assert.equal(cf.CONFIG_POR_DEFECTO.pausaAcordada.activo, false);
  assert.equal(cf.leerConfigDeTexto("{}").pausaAcordada.dias, 3);
  assert.equal(cf.leerConfigDeTexto(JSON.stringify({ pausaAcordada: { activo: "true", dias: 500 } })).pausaAcordada.dias, 30);
});

prueba("pausa acordada: el caso real del 26-oct queda dormido a los 3 días (horario laboral) y no es tarea", () => {
  const e = mo.evaluarLead(ficha({ mensajes: CASO_26_OCT }), CONFIG_PAUSA, mas(2 * H));
  assert.equal(e.decision.accion, "dormido");
  assert.equal(e.decision.motivo, "pausa_acordada");
  assert.equal(e.decision.dormidoHasta.getTime(), mas(3 * DIA).getTime());
  assert.equal(e.decision.supresion, "siempre");
  assert.match(e.decision.detalle, /organicen el lugar/);
});

prueba("pausa acordada: con el interruptor apagado el resultado es idéntico al de hoy", () => {
  const apagada = cf.leerConfigDeTexto(JSON.stringify({ calificacion: { activo: true }, motor: { modo: "activo" } }));
  const a = mo.evaluarLead(ficha({ mensajes: CASO_26_OCT }), apagada, mas(2 * H));
  const b = mo.evaluarLead(ficha({ mensajes: CASO_26_OCT }), CONFIG, mas(2 * H));
  assert.deepEqual(a.decision, b.decision);
  assert.notEqual(a.decision.motivo, "pausa_acordada");
});

prueba("pausa acordada: el día de retomar sale una tarea de valor, sin presión; si ya la retomó, no", () => {
  const e = mo.evaluarLead(ficha({ mensajes: CASO_26_OCT }), CONFIG_PAUSA, mas(3 * DIA + H));
  assert.equal(e.decision.accion, "tarea_asesora");
  assert.equal(e.decision.motivo, "pausa_acordada_retomar");
  assert.match(e.decision.mensajeSugerido, /¿Cómo vas con el lugar donde vas a trabajar\?/);
  assert.match(e.decision.mensajeSugerido, /sin ningún afán/);
  assert.doesNotMatch(e.decision.mensajeSugerido, /urgente|última|ya casi|promoci|descuento/i);
  const retomada = mo.evaluarLead(ficha({ mensajes: [...CASO_26_OCT, ASESORA(3 * DIA / MIN + 10, "¡Hola! ¿Cómo vas con el local?")] }), CONFIG_PAUSA, mas(3 * DIA + H));
  assert.notEqual(retomada.decision.motivo, "pausa_acordada_retomar");
});

prueba("pausa acordada: la fecha que dio el cliente manda sobre los 3 días", () => {
  const f = ficha({ mensajes: [IN(0, "Estoy reuniendo la plata, a finales de noviembre te confirmo"), ASESORA(5, "Perfecto, quedamos atentos")] });
  const e = mo.evaluarLead(f, CONFIG_PAUSA, mas(2 * H));
  assert.equal(e.decision.accion, "dormido");
  assert.ok(e.decision.dormidoHasta.getTime() > mas(40 * DIA).getTime(), "finales de noviembre, no 3 días");
  const semana = mo.evaluarLead(ficha({ mensajes: [IN(0, "Yo te aviso la otra semana"), ASESORA(5, "Dale, quedo atenta")] }), CONFIG_PAUSA, mas(2 * H));
  assert.equal(semana.decision.motivo, "pausa_acordada");
  assert.ok(semana.decision.dormidoHasta.getTime() > mas(2 * DIA).getTime());
});

prueba("pausa acordada: otras frases de pausa se reconocen; los acuses después no la rompen", () => {
  for (const frase of ["Estoy reuniendo la plata", "Estoy organizando el local", "Espero un pago y te aviso", "te aviso", "Más adelante lo miro", "Cuando tenga la plata me comunico"]) {
    const p = PA.detectarPausaAcordada({ mensajes: [IN(0, frase), ASESORA(5, "Claro que sí")] }, mas(H));
    assert.ok(p, frase);
    assert.ok(p.retomarEn.getTime() > mas(H).getTime(), frase);
  }
  const conAcuse = PA.detectarPausaAcordada({ mensajes: [IN(0, "te aviso"), ASESORA(5, "Dale"), IN(8, "ok gracias")] }, mas(H));
  assert.ok(conAcuse);
});

prueba("pausa acordada: NO es pausa sin respuesta de una persona, con pregunta, señal de compra nueva, pago o media nueva", () => {
  const sinPersona = PA.detectarPausaAcordada({ mensajes: [IN(0, "Estoy reuniendo la plata")] }, mas(H));
  assert.equal(sinPersona, null);
  const soloBot = PA.detectarPausaAcordada({ mensajes: [IN(0, "Estoy reuniendo la plata"), BOT(1, "¡Claro!")] }, mas(H));
  assert.equal(soloBot, null);
  const pregunta = PA.detectarPausaAcordada({ mensajes: [IN(0, "te aviso"), ASESORA(5, "Dale"), IN(10, "¿y el envío cuánto cuesta?")] }, mas(H));
  assert.equal(pregunta, null);
  const compra = PA.detectarPausaAcordada({ mensajes: [IN(0, "te aviso"), ASESORA(5, "Dale"), IN(10, "mejor ya la quiero, dime a qué cuenta consigno")] }, mas(H));
  assert.equal(compra, null);
  for (const pagado of ["Ya pagué, te aviso cuando llegue", "Ya hice la transferencia, te aviso", "te aviso, aquí va el comprobante"]) {
    assert.equal(PA.detectarPausaAcordada({ mensajes: [IN(0, pagado), ASESORA(5, "Gracias")] }, mas(H)), null, pagado);
  }
  const foto = PA.detectarPausaAcordada({ mensajes: [IN(0, "te aviso"), ASESORA(5, "Dale"), { ...IN(10, ""), tipo: "IMAGE" }] }, mas(H));
  assert.equal(foto, null);
  // Espera algo NUESTRO: es turno del equipo, no pausa.
  assert.equal(PA.detectarPausaAcordada({ mensajes: [IN(0, "Espero tu respuesta"), ASESORA(5, "Ya te escribo")] }, mas(H)), null);
  assert.equal(PA.detectarPausaAcordada({ mensajes: [IN(0, "Espero que me respondas pronto"), ASESORA(5, "Claro")] }, mas(H)), null);
});

prueba("pausa acordada: el cliente vuelve a escribir y la pausa se cancela sola", () => {
  const vuelve = ficha({ mensajes: [...CASO_26_OCT, IN(2 * 24 * 60, "Hola, ya tengo el local listo, ¿me cotizas el combo?")] });
  const e = mo.evaluarLead(vuelve, CONFIG_PAUSA, mas(2 * DIA + H));
  assert.notEqual(e.decision.motivo, "pausa_acordada");
  assert.notEqual(e.decision.accion, "dormido");
});

console.log(`\n${pruebas} pruebas OK`);
