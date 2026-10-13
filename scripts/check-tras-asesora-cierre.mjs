// Pruebas de "TRAS ASESORA": NO enviar en un CIERRE y COMPROMISO → TAREA A LA HORA (Alexander,
// 13-10-2026: "No enviar + tarea a la hora"). Falla real: chat •••• 6626, Ventas 1, María.
// Sin base ni red. Correr: npm run test:tras-asesora-cierre
import assert from "node:assert/strict";

import { cargar } from "./supervisor-cargar.mjs";

const D = "src/features/seguimiento-inteligente/dominio";
const cf = cargar(`${D}/config.ts`);
const mo = cargar(`${D}/motor.ts`);
const ta = cargar(`${D}/tras-asesora.ts`);
const cp = cargar(`${D}/compromiso.ts`);
const cierre = cargar("src/lib/cierre-de-conversacion.ts");
const turno = cargar("src/lib/turno-de-la-conversacion.ts");
const det = cargar("src/features/supervisor/dominio/detectores-atencion.ts");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const MIN = 60_000;

// Hora de Bogotá (UTC-5) del día dado de octubre de 2026 → Date.
const bog = (dia, hora, minuto = 0, segundo = 0) => new Date(Date.UTC(2026, 9, dia, hora + 5, minuto, segundo));
const iso = (d) => d.toISOString();
const IN = (en, texto, tipo = "TEXT") => ({ direccion: "IN", tipo, texto, en, leidoEn: en, origen: "webhook" });
const BOT = (en, texto) => ({ direccion: "OUT", tipo: "TEXT", texto, en, leidoEn: en, estado: "READ", origen: null });
const ASESORA = (en, texto, tipo = "TEXT") => ({ direccion: "OUT", tipo, texto, en, leidoEn: en, estado: "READ", origen: "manual" });
const HORARIO = { desde: 8, hasta: 18, dias: [1, 2, 3, 4, 5, 6] };

/* ------------------------------------------------------------------------------------------------
   El caso real del 13-oct (martes): la clienta deja el compromiso a las 11:46.
------------------------------------------------------------------------------------------------ */
const CASO_REAL = [
  IN(bog(13, 10, 20), "Hola, me interesa el COMBO de estética (camilla, escalera, silla y auxiliar)"),
  BOT(bog(13, 10, 20, 20), "¡Hola! Bienvenid@ a Magilus 😊"),
  ASESORA(bog(13, 10, 35), "¡Hola! Soy María. Te comparto las fotos y el precio 😊"),
  ASESORA(bog(13, 10, 35, 30), null, "IMAGE"),
  IN(bog(13, 11, 40), "Me gusta, lo quiero en blanco"),
  ASESORA(bog(13, 11, 42), "¡Perfecto! Para separarlo es el 50% de anticipo"),
  IN(bog(13, 11, 46, 0), "En la tarde"),
  IN(bog(13, 11, 46, 10), "ella se llama Danna"),
  IN(bog(13, 11, 46, 20), "apenas ella esta alla"),
  IN(bog(13, 11, 46, 30), "te enviaria la transferencia"),
  IN(bog(13, 11, 46, 40), "es el 50%"),
  IN(bog(13, 11, 46, 50), "cierto"),
  ASESORA(bog(13, 11, 47), null, "AUDIO"),
  IN(bog(13, 11, 47, 40), "Mil gracias"),
  ASESORA(bog(13, 11, 49), "Gracias a ti"),
];

// La configuración de producción (motor en sombra con excepciones) + los toques en activo.
const PROD = { calificacion: { activo: true }, motor: { modo: "sombra", excepcionesActivas: ["formulario", "cotizacion"] }, trasAsesora: { modo: "activo" } };
const config = (extra = {}) => cf.leerConfigDeTexto(JSON.stringify({ ...PROD, ...extra, trasAsesora: { ...PROD.trasAsesora, ...(extra.trasAsesora ?? {}) } }));
const APAGADO = { trasAsesora: { respetarCierre: false, compromisoATarea: false } };

const entradaTA = (mensajes, parcial = {}) => ({
  mensajes,
  notas: [],
  inicio: mensajes[0].en,
  nombre: "Danna",
  pausado: true,
  pausadoEn: bog(13, 10, 35, 2),
  etapaCrm: "NEGOCIACION",
  noInteresa: false,
  dormido: false,
  pospuesto: false,
  caliente: true,
  config: config().trasAsesora,
  horario: HORARIO,
  ahora: bog(13, 12, 57),
  ...parcial,
});

const ficha = (mensajes, parcial = {}) => ({
  conversationId: "cvcasoreal00000000006626",
  nombre: "Danna",
  etapaCrm: "NEGOCIACION",
  pausado: true,
  asignadaA: "maria",
  pais: "CO",
  marcaExterior: false,
  inicioDeLaCharla: mensajes[0].en,
  familiaDelBot: "combo-camilla",
  flujosEnviados: [],
  cotizacion: { en: null, ref: null, total: null },
  mensajesUtiles: 0,
  mensajes,
  pausadoEn: bog(13, 10, 35, 2),
  historialCompleto: true,
  ...parcial,
});

prueba("Caso real 6626: a las 12:57 NO sale 'Tras asesora 1 h' (compromiso → tarea)", () => {
  const r = ta.decidirTrasAsesora(entradaTA(CASO_REAL));
  assert.equal(r.sale, false);
  assert.equal(r.motivo, "compromiso_a_tarea");
});

prueba("Caso real 6626: el motor deja la TAREA 'en la tarde' a las 15:00, prioridad A, para la asesora", () => {
  const cfg = config();
  // A las 12:57: esperando la hora (sin tarea todavía), con la hora exacta.
  const antes = mo.evaluarLead(ficha(CASO_REAL), cfg, bog(13, 12, 57)).decision;
  assert.equal(antes.accion, "esperar");
  assert.equal(antes.motivo, "compromiso_pendiente");
  assert.equal(antes.prioridad, "A");
  assert.equal(iso(antes.vence), iso(bog(13, 15, 0)));
  assert.equal(iso(antes.revisarEn), iso(bog(13, 15, 0)));
  // A las 15:01: la tarea, con el texto y el mensaje sugerido.
  const d = mo.evaluarLead(ficha(CASO_REAL), cfg, bog(13, 15, 1)).decision;
  assert.equal(d.accion, "tarea_asesora");
  assert.equal(d.motivo, "compromiso_pendiente");
  assert.equal(d.prioridad, "A");
  assert.equal(iso(d.vence), iso(bog(13, 15, 0)));
  assert.equal(d.toque, "en la tarde");
  assert.match(d.detalle, /^Recordarle lo que quedó: «En la tarde \/ ella se llama Danna \/ apenas ella esta alla \/ te enviaria la transferencia/);
  assert.equal(d.mensajeSugerido, "¡Hola, Danna! 😊 Te escribo por lo que quedamos: la transferencia que me ibas a enviar en la tarde. ¿Te ayudo con algo para completarlo?");
  // Con el motor en sombra, la excepción "compromiso" ACTÚA (tarea en Mi día, tope y reparto).
  assert.deepEqual(cf.excepcionesQueActuan(cfg), ["formulario", "cotizacion", "compromiso"]);
  assert.equal(mo.modoDeLaDecision(d, cfg), "activo");
  // Con los toques en sombra, el compromiso también queda en sombra (solo se anota).
  const sombra = config({ trasAsesora: { modo: "sombra" } });
  assert.equal(mo.modoDeLaDecision(d, sombra), "sombra");
  // La tarea sigue aunque sea turno del cliente (no la esconde el Supervisor).
  assert.equal(turno.tareaSigueConTurnoDelCliente("compromiso_pendiente", "A"), true);
});

prueba("Caso real 6626: si la clienta escribe antes, o la asesora le escribe cerca de la hora, se cae la tarea", () => {
  const cfg = config();
  const escribio = [...CASO_REAL, IN(bog(13, 13, 30), "Oye y el envío a Cali cuánto sale?")];
  assert.notEqual(mo.evaluarLead(ficha(escribio), cfg, bog(13, 15, 1)).decision.motivo, "compromiso_pendiente");
  const hizo = [...CASO_REAL, ASESORA(bog(13, 14, 30), "Hola Danna, ¿pudo hablar con ella?")];
  assert.notEqual(mo.evaluarLead(ficha(hizo), cfg, bog(13, 15, 1)).decision.motivo, "compromiso_pendiente");
  // Se ofrece 24 h; después, lo de siempre.
  assert.notEqual(mo.evaluarLead(ficha(CASO_REAL), cfg, bog(14, 15, 1)).decision.motivo, "compromiso_pendiente");
});

/* ------------------------------------------------------------------------------------------------
   Cierre sin compromiso.
------------------------------------------------------------------------------------------------ */
const CIERRE = [
  IN(bog(13, 9, 0), "Hola, me interesa la camilla"),
  ASESORA(bog(13, 9, 5), "¡Hola! Te comparto las fotos 😊"),
  ASESORA(bog(13, 9, 5, 30), null, "IMAGE"),
  IN(bog(13, 9, 20), "Cuánto vale el envío a Cali?"),
  ASESORA(bog(13, 9, 25), "El envío a Cali vale $50.000"),
  IN(bog(13, 9, 30), "Mil gracias"),
  ASESORA(bog(13, 9, 32), "Gracias a ti"),
];

prueba("'Mil gracias' + 'Gracias a ti' sin compromiso → no sale nada y no hay tarea", () => {
  const r = ta.decidirTrasAsesora(entradaTA(CIERRE, { pausadoEn: bog(13, 9, 5, 2), ahora: bog(13, 10, 35) }));
  assert.equal(r.sale, false);
  assert.equal(r.motivo, "cierre");
  // Tampoco al día siguiente.
  assert.equal(ta.decidirTrasAsesora(entradaTA(CIERRE, { pausadoEn: bog(13, 9, 5, 2), ahora: bog(14, 9, 40) })).motivo, "cierre");
  const d = mo.evaluarLead(ficha(CIERRE), config(), bog(13, 10, 35)).decision;
  assert.notEqual(d.motivo, "compromiso_pendiente");
  assert.notEqual(d.accion, "tarea_asesora");
  // Otras cortesías de la asesora.
  for (const texto of ["Con gusto", "A la orden 🙏", "Feliz día", "Con mucho gusto, quedo atenta"]) {
    assert.equal(ta.decidirTrasAsesora(entradaTA([...CIERRE.slice(0, -1), ASESORA(bog(13, 9, 32), texto)], { pausadoEn: bog(13, 9, 5, 2), ahora: bog(13, 10, 35) })).motivo, "cierre", texto);
  }
});

prueba("La asesora mandó fotos + pregunta y el cliente calla → SÍ sale (como hoy)", () => {
  const charla = [
    IN(bog(13, 9, 0), "Hola, me interesa la camilla"),
    BOT(bog(13, 9, 0, 20), "¡Hola! Bienvenid@"),
    IN(bog(13, 9, 5), "¿Hacen envíos a Cali?"),
    ASESORA(bog(13, 9, 10), "¡Hola! Sí, enviamos a Cali 😊"),
    ASESORA(bog(13, 9, 10, 20), null, "IMAGE"),
    ASESORA(bog(13, 9, 11), "¿En qué color la quieres?"),
  ];
  const r = ta.decidirTrasAsesora(entradaTA(charla, { pausadoEn: bog(13, 9, 10, 2), ahora: bog(13, 10, 12), caliente: false }));
  assert.equal(r.sale, true);
  assert.equal(r.horas, 1);
  // "Mil gracias" + la asesora respondió con información o pregunta: no es cierre, sale.
  const reabrio = [...CIERRE.slice(0, -1), ASESORA(bog(13, 9, 32), "Con gusto. ¿Te ayudo a separarla?")];
  assert.equal(ta.decidirTrasAsesora(entradaTA(reabrio, { pausadoEn: bog(13, 9, 5, 2), ahora: bog(13, 10, 35), caliente: false })).sale, true);
});

prueba("Cliente 'gracias, ¿y el envío cuánto?' → no es cierre: sale o es turno nuestro", () => {
  const charla = [...CIERRE.slice(0, 5), IN(bog(13, 9, 30), "Gracias, ¿y el envío a Medellín cuánto?"), ASESORA(bog(13, 9, 32), "Con gusto")];
  const r = ta.decidirTrasAsesora(entradaTA(charla, { pausadoEn: bog(13, 9, 5, 2), ahora: bog(13, 10, 35), caliente: false }));
  assert.ok(r.sale || /^turno_de_magilus/.test(r.motivo), JSON.stringify(r));
  assert.notEqual(r.motivo, "cierre");
  assert.equal(cierre.esAgradecimientoSinPendiente("Gracias, ¿y el envío cuánto?"), false);
  // Sin respuesta de la asesora: el turno es nuestro (no sale nada y no es cierre).
  const sinRespuesta = [...CIERRE.slice(0, 5), IN(bog(13, 9, 30), "Gracias, ¿y el envío a Medellín cuánto?")];
  assert.equal(ta.decidirTrasAsesora(entradaTA(sinRespuesta, { pausadoEn: bog(13, 9, 5, 2), ahora: bog(13, 10, 35) })).motivo, "sin_persona_despues_del_cliente");
});

prueba("Interruptores apagados = como hoy (el caso real y el cierre SÍ salen; sin tarea de compromiso)", () => {
  const cfg = config(APAGADO);
  assert.equal(cfg.trasAsesora.respetarCierre, false);
  assert.equal(cfg.trasAsesora.compromisoATarea, false);
  const real = ta.decidirTrasAsesora(entradaTA(CASO_REAL, { config: cfg.trasAsesora }));
  assert.equal(real.sale, true);
  assert.equal(real.nombreDelFollow, "Tras asesora: 1 h");
  assert.equal(ta.decidirTrasAsesora(entradaTA(CIERRE, { config: cfg.trasAsesora, pausadoEn: bog(13, 9, 5, 2), ahora: bog(13, 10, 35) })).sale, true);
  assert.notEqual(mo.evaluarLead(ficha(CASO_REAL), cfg, bog(13, 15, 1)).decision.motivo, "compromiso_pendiente");
  assert.deepEqual(cf.excepcionesQueActuan(cfg), ["formulario", "cotizacion"]);
  // Con los toques apagados el motor no busca compromisos (todo como antes).
  const sinToques = cf.leerConfigDeTexto(JSON.stringify({ ...PROD, trasAsesora: { modo: "apagado" } }));
  assert.equal(cf.compromisoPrendido(sinToques), false);
  assert.notEqual(mo.evaluarLead(ficha(CASO_REAL), sinToques, bog(13, 15, 1)).decision.motivo, "compromiso_pendiente");
  // Por defecto (aprobado para publicar): los dos prendidos.
  assert.equal(cf.CONFIG_POR_DEFECTO.trasAsesora.respetarCierre, true);
  assert.equal(cf.CONFIG_POR_DEFECTO.trasAsesora.compromisoATarea, true);
  assert.equal(cf.leerConfigDeTexto('{"trasAsesora":{"modo":"activo"}}').trasAsesora.compromisoATarea, true);
  assert.equal(cf.leerConfigDeTexto('{"trasAsesora":{"modo":"activo","respetarCierre":"false"}}').trasAsesora.respetarCierre, false);
});

/* ------------------------------------------------------------------------------------------------
   La hora de cada compromiso (horario laboral L–S 8–18, Bogotá).
------------------------------------------------------------------------------------------------ */
const conCompromiso = (dicho, texto, extra = []) => [IN(new Date(dicho.getTime() - 30 * MIN), "Hola, info de la camilla"), ASESORA(new Date(dicho.getTime() - 20 * MIN), "Vale $989.000 😊"), IN(dicho, texto), ASESORA(new Date(dicho.getTime() + MIN), "¡Listo! Quedo atenta"), ...extra];
const venceDe = (dicho, texto, extra) => cp.detectarCompromiso({ mensajes: conCompromiso(dicho, texto, extra), horario: HORARIO });

prueba("Las horas: tarde, mañana, día de la semana, otra semana, fin de mes, quincena, el 15, noche, más tarde, ambiguo", () => {
  const mar = (h, m = 0) => bog(13, h, m); // martes 13-oct
  const casos = [
    ["En la tarde te envío la transferencia", mar(11), bog(13, 15), "en la tarde", true],
    ["Esta tarde te confirmo", mar(16), bog(14, 8), "en la tarde", false], // ya pasó: siguiente apertura
    ["Mañana te confirmo", mar(11), bog(14, 10), "mañana", false],
    ["Mañana en la tarde te mando el comprobante", mar(11), bog(14, 15), "mañana en la tarde", true],
    ["El viernes te consigno", mar(11), bog(16, 10), "el viernes", true],
    ["el martes te aviso", mar(11), bog(20, 10), "el martes", false], // hoy es martes: el de la otra semana
    ["La otra semana te confirmo", mar(11), bog(19, 10), "la otra semana", false],
    ["A fin de mes la compro", mar(11), bog(30, 10), "a fin de mes", false],
    ["En la quincena te consigno", mar(11), bog(15, 10), "en la quincena", true],
    ["el 15 te hago el pago", mar(11), bog(15, 10), "el 15", true],
    ["Esta noche te envío el comprobante", mar(11), bog(14, 8), "esta noche", true],
    ["Más tarde te confirmo", mar(11), bog(13, 14), "más tarde", false],
    ["Más tarde te confirmo", mar(17), bog(14, 8), "más tarde", false], // 20:00 → apertura
    ["Apenas me paguen te consigno", mar(11), bog(14, 11), "cuando le paguen", true],
    ["Cuando me paguen la compro", mar(11), bog(14, 11), "cuando le paguen", true],
    ["Te envío el comprobante", mar(11), bog(14, 11), "sin momento claro", true],
    ["el sábado paso por ella", mar(11), bog(17, 10), "el sábado", false],
    ["el domingo te aviso", mar(11), bog(19, 8), "el domingo", false], // domingo → lunes 8:00
  ];
  for (const [texto, dicho, esperado, como, pago] of casos) {
    const c = venceDe(dicho, texto);
    assert.ok(c, `sin compromiso: ${texto}`);
    assert.equal(iso(c.vence), iso(esperado), `${texto} → ${c.como} ${iso(c.vence)}`);
    assert.equal(c.como, como, texto);
    assert.equal(c.pago, pago, `pago: ${texto}`);
  }
  // Sábado 17-oct "mañana te confirmo" → domingo no se trabaja → lunes 8:00.
  assert.equal(iso(venceDe(bog(17, 11), "Mañana te confirmo").vence), iso(bog(19, 8)));
});

prueba("No son compromiso: un acuse, un 'mañana' sin acción, una pregunta, '50%' no es una fecha; sin respuesta de la persona tampoco", () => {
  for (const texto of ["ok gracias", "mañana", "¿Mañana me lo envían?", "Lo voy a pensar", "es el 50%", "Gracias, ¿y el envío cuánto?"]) {
    assert.equal(venceDe(bog(13, 11), texto), null, texto);
  }
  // El compromiso sin respuesta de la persona: el turno es nuestro (lo maneja el motor de siempre).
  const sinRespuesta = [IN(bog(13, 10, 30), "Hola"), ASESORA(bog(13, 10, 40), "Vale $989.000"), IN(bog(13, 11), "Mañana te confirmo")];
  assert.equal(cp.detectarCompromiso({ mensajes: sinRespuesta, horario: HORARIO }), null);
  // Después del compromiso, una pregunta nueva del cliente lo corta; un acuse no.
  assert.equal(venceDe(bog(13, 11), "Mañana te confirmo", [IN(bog(13, 11, 5), "¿Y vienen en color negro?")]), null);
  assert.ok(venceDe(bog(13, 11), "Mañana te confirmo", [IN(bog(13, 11, 5), "Si señora está bien"), ASESORA(bog(13, 11, 6), "👍")]));
  assert.equal(cp.esAcuseDelCliente({ tipo: "TEXT", texto: "Si señora está bien" }), true);
  assert.equal(cp.esAcuseDelCliente({ tipo: "IMAGE", texto: null }), false);
});

prueba("Cortesías de la asesora y la regla 4 del Supervisor (la misma función, compartida)", () => {
  for (const t of ["Gracias a ti", "Con gusto", "A la orden", "Feliz día 😊", "Con mucho gusto, que tengas un lindo día"]) assert.equal(cierre.esCortesiaDeCierre(t), true, t);
  for (const t of ["Con gusto. ¿Te ayudo a separarla?", "El envío a Cali vale $50.000", "", null]) assert.equal(cierre.esCortesiaDeCierre(t), false, String(t));
  assert.equal(det.esAgradecimientoSinPendiente, cierre.esAgradecimientoSinPendiente);
  assert.equal(det.esAgradecimientoSinPendiente("Ah, bueno, visto, muy bien, muchas gracias."), true);
  assert.equal(det.esAgradecimientoSinPendiente("Gracias, ya pagué"), false);
  // Real (13-oct, •••• 893f): "tener en cuenta" no es la cuenta del banco.
  assert.equal(det.esAgradecimientoSinPendiente("A vale. Lo tendré en cuenta muchas gracias"), true);
  assert.equal(det.esAgradecimientoSinPendiente("Gracias, me pasas la cuenta"), false);
});

console.log(`\n${pruebas} pruebas de "tras asesora": cierre y compromiso → tarea: OK`);
