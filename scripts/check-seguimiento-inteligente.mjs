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
const cf = cargar(`${D}/config.ts`);
const cv = (() => {
  // convivencia.ts importa prisma: se prueba solo su regla pura, cargando el archivo con dobles.
  const absoluto = path.resolve("src/features/seguimiento-inteligente/servicios/convivencia.ts");
  const salida = ts.transpileModule(fs.readFileSync(absoluto, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const mod = { exports: {} };
  const dobles = { "@/lib/prisma": { prisma: {} }, "./config": { leerConfigSeguimiento: async () => cf.CONFIG_POR_DEFECTO }, "../dominio/exterior": ex };
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

prueba("motor: NO LEYÓ → no insistir (y se reactiva si lee)", () => {
  const f = ficha({ mensajes: [IN(0, ANUNCIO), BOT(0.2, "Bienvenid@", null)] });
  const d = mo.evaluarLead(f, CONFIG, mas(3 * H)).decision;
  assert.equal(d.accion, "no_insistir");
  assert.equal(d.motivo, "no_leyo");
  const leido = ficha({ mensajes: [IN(0, ANUNCIO), BOT(0.2, "Bienvenid@", 200)] });
  assert.equal(mo.evaluarLead(leido, CONFIG, mas(4 * H)).decision.accion, "mensaje_util_producto");
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
  const tope = { ...f, mensajes: [...f.mensajes, AUTO(10 + 3 * 24 * 60 + 70, "a"), AUTO(10 + 4 * 24 * 60 + 70, "b")] };
  const d7 = mo.evaluarLead(tope, CONFIG, mas(10 * MIN + 7 * DIA + H)).decision;
  assert.equal(d7.accion, "esperar");
  assert.equal(d7.motivo, "gracia_antes_de_descartar");
  assert.equal(mo.evaluarLead(tope, CONFIG, mas(10 * MIN + 8 * DIA + H)).decision.accion, "descartar");
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

console.log(`\n${pruebas} pruebas OK`);
