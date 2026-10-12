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

prueba("motor: TURNO DEL CLIENTE tras la asesora — sin tareas, automáticos libres, descarte a las 72 h", () => {
  // La asesora contestó y el cliente no responde: es su turno. Ni tarea del día 3 ni aviso, lea o no.
  const f = ficha({ mensajes: [IN(0, ANUNCIO), BOT(0.2, "fotos"), IN(5, "¿hacen envíos a Cali?"), ASESORA(10, "Hola, sí enviamos a Cali", null)] });
  const d1 = mo.evaluarLead(f, CONFIG, mas(10 * MIN + DIA)).decision;
  assert.equal(d1.accion, "esperar");
  assert.equal(d1.motivo, "turno_del_cliente");
  assert.equal(d1.supresion, "ninguna", "los seguimientos automáticos de siempre siguen");
  assert.equal(d1.revisarEn.getTime(), mas(10 * MIN + 72 * H).getTime());
  const conFreno = { ...CONFIG, motor: { ...CONFIG.motor, respetarNoLeido: true } };
  for (const config of [CONFIG, conFreno]) {
    for (const t of [mas(10 * MIN + 2 * H), mas(10 * MIN + DIA), mas(10 * MIN + 71 * H)]) {
      assert.notEqual(mo.evaluarLead(f, config, t).decision.accion, "tarea_asesora");
    }
  }
  // Los automáticos no reinician el reloj del descarte: cuenta desde la asesora.
  const conAuto = { ...f, mensajes: [...f.mensajes, AUTO(10 + 24 * 60, "¿Pudiste verlo?"), AUTO(10 + 48 * 60, "¿Te ayudo?")] };
  const desc = mo.evaluarLead(conAuto, CONFIG, mas(10 * MIN + 72 * H + MIN)).decision;
  assert.equal(desc.accion, "descartar");
  assert.equal(desc.motivo, "turno_del_cliente_sin_respuesta");
  // Si escribe otra vez, vuelve a ser turno de Magilus.
  const vuelve = { ...f, mensajes: [...f.mensajes, IN(10 + 60 * 60, "¿y cuánto vale el envío?")] };
  assert.equal(mo.evaluarLead(vuelve, CONFIG, mas(10 * MIN + 60 * H + 40 * MIN)).decision.accion, "tarea_asesora");
});

prueba("motor: el producto que PREGUNTÓ manda (butacos, no el combo)", () => {
  const f = ficha({ mensajes: [IN(0, "info del butaco para manicure"), BOT(0.5, "Te comparto el catálogo")], familiaDelBot: null, flujosEnviados: [] });
  const ev = mo.evaluarLead(f, CONFIG, mas(2 * H));
  assert.equal(ev.familia, "butacos-manicure");
  assert.equal(ev.decision.accion, "mensaje_util_producto");
  assert.match(ev.decision.mensajeUtil.acciones[0].flowId, /fmhd0$/);
});

prueba("motor: TIBIO esperando sin respuesta → tarea B; si el bot ya contestó, es turno del cliente", () => {
  // Nadie le contestó (bot pausado): tarea B a los 30 min.
  const f = ficha({ pausado: true, mensajes: [IN(0, ANUNCIO), BOT(0.2, "fotos"), IN(5, "¿hacen envíos a Pereira?")] });
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
  // El bot le contestó bien y quedó esperando: turno del cliente, sin tarea (12-10-2026).
  const contestada = ficha({ mensajes: [IN(0, ANUNCIO), BOT(0.2, "fotos"), IN(5, "¿hacen envíos a Pereira?"), BOT(5.2, "Sí, enviamos. ¿En qué color lo quieres?")] });
  const dc = mo.evaluarLead(contestada, CONFIG, mas(40 * MIN)).decision;
  assert.equal(dc.accion, "esperar");
  assert.equal(dc.motivo, "turno_del_cliente");
  assert.equal(dc.supresion, "ninguna");
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
  // Si la asesora contesta antes, no hay tarea: es turno del cliente.
  const contestada = { ...f, mensajes: [...f.mensajes, ASESORA(10, "¡Hola! Te paso los datos")] };
  assert.equal(mo.evaluarLead(contestada, CONFIG, mas(19 * MIN)).decision.motivo, "turno_del_cliente");
  // Si solo le contestó el bot, sigue siendo de Magilus (intención fuerte sin persona): tarea A.
  const soloBot = { ...f, mensajes: [...f.mensajes, BOT(3.2, "¡Claro! Se separa con el 50 %. ¿En qué ciudad estás?")] };
  const db = mo.evaluarLead(soloBot, CONFIG, mas(19 * MIN)).decision;
  assert.equal(db.accion, "tarea_asesora");
  assert.equal(db.prioridad, "A");
  assert.equal(db.motivo, "intencion_fuerte_sin_persona");
  assert.match(d.mensajeSugerido, /50 %/);
});

prueba("motor: COTIZACIÓN enviada y sin respuesta = turno del cliente: sin tareas y nunca se descarta", () => {
  const f = ficha({ mensajes: [IN(0, ANUNCIO), ASESORA(10, "Te envío la cotización COT-00123 por $1.250.000")] });
  for (const t of [mas(5 * H), mas(10 * MIN + 25 * H), mas(10 * MIN + 73 * H), mas(10 * DIA)]) {
    const d = mo.evaluarLead(f, CONFIG, t).decision;
    assert.equal(d.accion, "esperar");
    assert.equal(d.motivo, "turno_del_cliente_cotizacion_vigente");
    assert.equal(d.supresion, "ninguna");
  }
  // Pasada la vigencia (30 días) sí se descarta.
  assert.equal(mo.evaluarLead(f, CONFIG, mas(31 * DIA)).decision.accion, "descartar");
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

prueba("motor: el bot PASÓ el chat a una persona → turno de Magilus (tarea) hasta que una persona escriba", () => {
  // Con la frase del bot.
  const frase = ficha({ mensajes: [IN(0, ANUNCIO), BOT(0.2, "fotos"), IN(5, "Ya tengo camilla, me falta la silla"), BOT(5.3, "¡Perfecto! 🛒 En un momento una asesora te escribe para confirmarte el envío y finalizar tu compra.")] });
  const d = mo.evaluarLead(frase, CONFIG, mas(40 * MIN)).decision;
  assert.equal(d.accion, "tarea_asesora");
  assert.equal(d.motivo, "bot_paso_a_asesora");
  // Con la nota del sistema "El agente pide un asesor…" (aunque el texto del bot no lo diga).
  const nota = ficha({ notasDelBot: [{ en: mas(5.3 * MIN), texto: "El agente pide un asesor: el cliente pide una persona" }], mensajes: [IN(0, ANUNCIO), BOT(0.2, "fotos"), IN(5, "quiero hablar con alguien"), BOT(5.3, "Claro 😊")] });
  assert.equal(mo.evaluarLead(nota, CONFIG, mas(40 * MIN)).decision.motivo, "bot_paso_a_asesora");
  // Cuando la persona escribe, pasa a turno del cliente.
  const atendida = { ...frase, mensajes: [...frase.mensajes, ASESORA(20, "Hola, soy Ingrid. ¿A qué ciudad te la enviamos?")] };
  assert.equal(mo.evaluarLead(atendida, CONFIG, mas(40 * MIN)).decision.motivo, "turno_del_cliente");
});

prueba("motor: FRÍO después de la asesora = turno del cliente: sin tareas ni mensaje útil, descarte a las 72 h", () => {
  const f = ficha({ mensajes: [IN(0, ANUNCIO), BOT(0.2, "fotos"), ASESORA(10, "Hola, soy María")] });
  const d = mo.evaluarLead(f, CONFIG, mas(10 * MIN + 2 * DIA)).decision;
  assert.equal(d.accion, "esperar");
  assert.equal(d.motivo, "turno_del_cliente");
  assert.equal(mo.evaluarLead(f, CONFIG, mas(10 * MIN + 3 * DIA + H)).decision.accion, "descartar");
  // Con el descarte apagado, la decisión es la misma; el servicio solo la registra (no descarta).
  const sinDescarte = { ...CONFIG, cadencia: { ...CONFIG.cadencia, descarte: "apagado" } };
  assert.equal(mo.evaluarLead(f, sinDescarte, mas(10 * MIN + 3 * DIA + H)).decision.accion, "descartar");
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
  assert.equal(d.cadencia.horasTurnoDelCliente, 72);
  assert.equal(cf.leerConfigDeTexto(JSON.stringify({ cadencia: { horasTurnoDelCliente: 96 } })).cadencia.horasTurnoDelCliente, 96);
  assert.equal(cf.leerConfigDeTexto(JSON.stringify({ cadencia: { horasTurnoDelCliente: 2 } })).cadencia.horasTurnoDelCliente, 24);
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

prueba("motor: caso real cv16c1a0 — el bot contestó (fotos y precio) y quedó esperando: turno del cliente, sin tarea", () => {
  // cv16c1a0 (10-oct): ANUNCIO 10:21, "Sirve para pestañas?" 10:22, auto-asignado a Ingrid, "Fotos",
  // el bot manda fotos y precio, seguimientos del V3 a los 17 y 78 min, ninguna persona escribe.
  // Hasta el 11-10 esto era tarea; desde el 12-10 (Alexander) "sin asesora" o "sin persona" solo
  // no es un problema: el bot respondió bien y espera al cliente.
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
  const ev = mo.evaluarLead(pestanas, CONFIG, mas(3 * H));
  assert.equal(ev.calificacion.temperaturaBase, "TIBIO");
  assert.equal(ev.decision.accion, "esperar");
  assert.equal(ev.decision.motivo, "turno_del_cliente");
  assert.equal(ev.decision.supresion, "ninguna");
  // El descarte cuenta desde el último mensaje del bot (2.1 min), no desde los automáticos.
  assert.equal(ev.decision.revisarEn.getTime(), mas(2.1 * MIN + 72 * H).getTime());
  // Si en cambio dice "lo quiero, ¿cómo lo separo?" y solo le contesta el bot: tarea A.
  const fuerte = { ...pestanas, mensajes: [...pestanas.mensajes, IN(90, "Lo quiero, ¿cómo hago para separarlo?"), BOT(90.3, "Se separa con el 50 %")] };
  const df = mo.evaluarLead(fuerte, CONFIG, mas(2 * H)).decision;
  assert.equal(df.accion, "tarea_asesora");
  assert.equal(df.prioridad, "A");
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

prueba("formulario: la asesora pidió los datos y el cliente no responde = turno del cliente, sin tareas", () => {
  const f = ficha({ asignadaA: "ingrid", mensajes: [IN(0, ANUNCIO), BOT(0.2, "fotos"), IN(4, "En negro"), IN(5, "cuánto vale?"), ASESORA(10, FORMULARIO)] });
  for (const t of [mas(70 * MIN), mas(131 * MIN), mas(25 * H), mas(71 * H)]) {
    const d = mo.evaluarLead(f, CONFIG, t).decision;
    assert.equal(d.accion, "esperar");
    // "Datos de Cotización" cuenta como cotización enviada: vigente, no se descarta.
    assert.equal(d.motivo, "turno_del_cliente_cotizacion_vigente");
  }
  assert.notEqual(mo.evaluarLead(f, CONFIG, mas(10 * MIN + 72 * H + MIN)).decision.accion, "descartar");
  // Caso real cv3a2aa2 (sábado 4:47 p. m.): tampoco hay tarea el lunes.
  const lunes = mo.evaluarLead(casoLila(), CONFIG, new Date("2026-10-12T13:01:00Z")).decision;
  assert.notEqual(lunes.accion, "tarea_asesora");
  assert.match(lunes.motivo, /^turno_del_cliente/);
  // Si responde, vuelve a ser de Magilus.
  const responde = { ...f, mensajes: [...f.mensajes, IN(60, "Laura Gómez, Cali")] };
  assert.equal(mo.evaluarLead(responde, CONFIG, mas(100 * MIN)).decision.accion, "tarea_asesora");
});

prueba("formulario: el interruptor sigue leyéndose (sin efecto en el turno del cliente)", () => {
  assert.equal(cf.CONFIG_POR_DEFECTO.formulario.activo, true);
  assert.deepEqual(cf.CONFIG_POR_DEFECTO.formulario.horas, [2, 24, 72]);
  assert.equal(SIN_FORMULARIO.formulario.activo, false);
  const caso = casoLila();
  for (const config of [CONFIG, SIN_FORMULARIO]) assert.match(mo.evaluarLead(caso, config, new Date("2026-10-11T22:00:00Z")).decision.motivo, /^turno_del_cliente/);
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

console.log(`\n${pruebas} pruebas OK`);
