// Pruebas del modo SOLO EXCEPCIONES del seguimiento inteligente (Alexander, 13-10-2026: "prender el
// inteligente solo para formulario y cotización"): motor en sombra + motor.excepcionesActivas.
//  - formulario sin respuesta → tarea a las 2 h (activa); cotización → tarea a las 24 h (activa);
//  - tibio con turno del cliente → sin tarea y sin freno; los automáticos salen;
//  - sin el modo nuevo = comportamiento de hoy (sombra no frena nada; activo frena como antes).
// Sin base ni red. Correr: npm run test:solo-excepciones
import assert from "node:assert/strict";

import { cargar } from "./supervisor-cargar.mjs";

const D = "src/features/seguimiento-inteligente/dominio";
const cf = cargar(`${D}/config.ts`);
const mo = cargar(`${D}/motor.ts`);

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const MIN = 60_000;
const H = 60 * MIN;
// Miércoles 7-oct-2026, 11:00 de Bogotá (16:00 UTC).
const T0 = new Date("2026-10-07T16:00:00Z");
const mas = (ms) => new Date(T0.getTime() + ms);

const IN = (m, texto) => ({ direccion: "IN", tipo: "TEXT", texto, en: mas(m * MIN), leidoEn: mas(m * MIN), origen: "webhook" });
const BOT = (m, texto) => ({ direccion: "OUT", tipo: "TEXT", texto, en: mas(m * MIN), leidoEn: mas((m + 1) * MIN), estado: "READ", origen: null });
const ASESORA = (m, texto) => ({ ...BOT(m, texto), origen: "manual" });
const NOTA = (m, texto) => ({ direccion: "OUT", tipo: "SYSTEM", texto, en: mas(m * MIN), leidoEn: null, estado: null, origen: "activity" });

const ANUNCIO = "Hola, me interesa el COMBO de estética (camilla, escalera, silla y auxiliar)";
const FORMULARIO =
  "Para continuar con el proceso de cotización formal por favor completa estos datos,\nDatos de Cotización ✨\n\n🌟 Nombre y Apellido:\n✍️ NIT / C.C:\n📧 Correo Electrónico:\n📞 Teléfono:\n🏠 Dirección:\n🏙️ Ciudad y Barrio:\n📍 Departamento:\n     Color:";
const PRECIO_COMBO =
  "El *Combo Camillas* está en *$989.000* 💆 (camilla, escalera, silla y auxiliar), con *garantía de 1 año*.  ¿Te comparto las *fotos* y en qué *ciudad* estás para confirmarte el envío?";
const NOTA_PRECIO = 'Agente V3: Ganó "Pide precio en el primer mensaje: activar el combo y dar el precio de una vez" porque el cliente dijo "precio" o "cuanto vale"';

function ficha(parcial = {}) {
  return {
    conversationId: "cvsoloexcepciones00000001",
    nombre: "Laura Gómez",
    etapaCrm: "NUEVO",
    pausado: false,
    asignadaA: "ingrid",
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

/** Lo que hay hoy en producción (sombra) + las excepciones; y las dos referencias. */
// El compromiso del cliente (13-10-2026) se prueba en check-tras-asesora-cierre.mjs: acá, apagado.
const BASE = { calificacion: { activo: true }, exterior: { activo: true }, trasAsesora: { modo: "activo", compromisoATarea: false }, recuperacion72h: { modo: "activo" } };
const EXCEPCIONES = cf.leerConfigDeTexto(JSON.stringify({ ...BASE, motor: { modo: "sombra", excepcionesActivas: ["formulario", "cotizacion"] } }));
const SOMBRA = cf.leerConfigDeTexto(JSON.stringify({ ...BASE, motor: { modo: "sombra" } }));
const ACTIVO = cf.leerConfigDeTexto(JSON.stringify({ ...BASE, motor: { modo: "activo" } }));
const conTurno = (config) => ({ ...config, turno: { activo: true, cadenciaSinTarea: true } });

/* ------------------------------------------------------------------------------------------------
   1. CONFIGURACIÓN
------------------------------------------------------------------------------------------------ */

prueba("config: excepcionesActivas se lee filtrada; por defecto vacía; solo actúa con el motor en sombra", () => {
  assert.deepEqual(cf.CONFIG_POR_DEFECTO.motor.excepcionesActivas, []);
  assert.deepEqual(cf.leerConfigDeTexto(null).motor.excepcionesActivas, []);
  assert.deepEqual(EXCEPCIONES.motor.excepcionesActivas, ["formulario", "cotizacion"]);
  assert.deepEqual(cf.leerConfigDeTexto('{"motor":{"modo":"sombra","excepcionesActivas":["cotizacion","otra",3]}}').motor.excepcionesActivas, ["cotizacion"]);
  assert.deepEqual(cf.leerConfigDeTexto('{"motor":{"modo":"sombra","excepcionesActivas":"formulario"}}').motor.excepcionesActivas, []);
  assert.deepEqual(cf.excepcionesQueActuan(EXCEPCIONES), ["formulario", "cotizacion"]);
  assert.deepEqual(cf.excepcionesQueActuan(SOMBRA), []);
  // Con `trasAsesora.compromisoATarea` (por defecto) y los toques en activo, el compromiso también actúa.
  const conCompromiso = cf.leerConfigDeTexto(JSON.stringify({ ...BASE, trasAsesora: { modo: "activo" }, motor: { modo: "sombra", excepcionesActivas: ["formulario", "cotizacion"] } }));
  assert.deepEqual(cf.excepcionesQueActuan(conCompromiso), ["formulario", "cotizacion", "compromiso"]);
  assert.equal(cf.esExcepcionQueActua("compromiso_pendiente", conCompromiso), true);
  assert.equal(cf.esExcepcionQueActua("compromiso_pendiente", EXCEPCIONES), false);
  // En activo ya actúa todo; en apagado nada: las excepciones no cambian nada.
  assert.deepEqual(cf.excepcionesQueActuan(cf.leerConfigDeTexto('{"motor":{"modo":"activo","excepcionesActivas":["formulario"]}}')), []);
  assert.deepEqual(cf.excepcionesQueActuan(cf.leerConfigDeTexto('{"motor":{"modo":"apagado","excepcionesActivas":["formulario"]}}')), []);
  assert.equal(cf.esExcepcionQueActua("formulario_sin_respuesta", EXCEPCIONES), true);
  assert.equal(cf.esExcepcionQueActua("cotizacion_sin_respuesta", EXCEPCIONES), true);
  assert.equal(cf.esExcepcionQueActua("caliente_sin_asesora", EXCEPCIONES), false);
  assert.equal(cf.esExcepcionQueActua("tibio_sin_asesora", EXCEPCIONES), false);
  assert.equal(cf.esExcepcionQueActua("formulario_sin_respuesta", SOMBRA), false);
  const soloForm = cf.leerConfigDeTexto('{"motor":{"modo":"sombra","excepcionesActivas":["formulario"]}}');
  assert.equal(cf.esExcepcionQueActua("formulario_sin_respuesta", soloForm), true);
  assert.equal(cf.esExcepcionQueActua("cotizacion_sin_respuesta", soloForm), false);
});

/* ------------------------------------------------------------------------------------------------
   2. EL MOTOR: qué se ejecuta
------------------------------------------------------------------------------------------------ */

prueba("formulario sin respuesta → tarea a las 2 h, en ACTIVO (Mi día); antes de vencer, esperar sin tarea", () => {
  const f = ficha({ mensajes: [IN(0, ANUNCIO), BOT(0.2, "fotos"), IN(4, "En negro"), IN(5, "cuánto vale?"), ASESORA(10, FORMULARIO)] });
  const antes = mo.evaluarLead(f, EXCEPCIONES, mas(70 * MIN)).decision;
  assert.equal(antes.accion, "esperar");
  assert.equal(antes.motivo, "formulario_esperando_escalon");
  const d = mo.evaluarLead(f, EXCEPCIONES, mas(131 * MIN)).decision;
  assert.equal(d.accion, "tarea_asesora");
  assert.equal(d.motivo, "formulario_sin_respuesta");
  assert.equal(d.toque, "formulario_2h");
  assert.equal(d.prioridad, "A", "Caliente (eligió color y preguntó precio) → A");
  assert.equal(mo.modoDeLaDecision(d, EXCEPCIONES), "activo");
  // 24 h y 72 h también son del formulario (activo).
  const d24 = mo.evaluarLead({ ...f, mensajes: [...f.mensajes, ASESORA(135, "¿Te ayudo a completar los datos?")] }, EXCEPCIONES, mas(10 * MIN + 25 * H)).decision;
  assert.equal(d24.toque, "formulario_24h");
  assert.equal(mo.modoDeLaDecision(d24, EXCEPCIONES), "activo");
  // Hoy (solo sombra) la misma decisión queda en sombra: nadie la ve (hueco 4 de la auditoría).
  assert.equal(mo.modoDeLaDecision(mo.evaluarLead(f, SOMBRA, mas(131 * MIN)).decision, SOMBRA), "sombra");
});

prueba("cotización enviada sin respuesta → tarea A a las 24 h, en ACTIVO", () => {
  const f = ficha({ mensajes: [IN(0, ANUNCIO), ASESORA(10, "Te envío la cotización COT-00123 por $1.250.000")] });
  const antes = mo.evaluarLead(f, EXCEPCIONES, mas(5 * H)).decision;
  assert.equal(antes.motivo, "cotizacion_esperando_escalon");
  assert.equal(antes.accion, "esperar");
  const d = mo.evaluarLead(f, EXCEPCIONES, mas(10 * MIN + 25 * H)).decision;
  assert.equal(d.accion, "tarea_asesora");
  assert.equal(d.motivo, "cotizacion_sin_respuesta");
  assert.equal(d.toque, "cotizacion_24h");
  assert.equal(d.prioridad, "A");
  assert.match(d.mensajeSugerido, /COT-00123/);
  assert.equal(mo.modoDeLaDecision(d, EXCEPCIONES), "activo");
  // Solo formulario prendido: la cotización sigue en sombra.
  const soloForm = cf.leerConfigDeTexto(JSON.stringify({ ...BASE, motor: { modo: "sombra", excepcionesActivas: ["formulario"] } }));
  assert.equal(mo.modoDeLaDecision(d, soloForm), "sombra");
});

prueba("tibio con turno del cliente → sin tarea y sin freno (sombra, supresión ninguna)", () => {
  const mensajes = [IN(0, "Precio"), BOT(0.2, "Bienvenid@ a *Magilus* 👑"), BOT(0.25, PRECIO_COMBO)];
  const notas = [NOTA(0.26, NOTA_PRECIO)];
  const d = mo.evaluarLead(ficha({ asignadaA: null, mensajes, notas }), conTurno(EXCEPCIONES), mas(30 * MIN)).decision;
  assert.notEqual(d.accion, "tarea_asesora");
  assert.equal(d.motivo, "turno_del_cliente");
  assert.equal(d.supresion, "ninguna");
  assert.equal(mo.modoDeLaDecision(d, EXCEPCIONES), "sombra");
  // Sin el turno el tibio sería tarea, pero en SOMBRA: no aparece y no frena.
  const sinTurno = mo.evaluarLead(ficha({ asignadaA: null, mensajes, notas }), EXCEPCIONES, mas(31 * MIN)).decision;
  assert.equal(sinTurno.motivo, "tibio_sin_asesora");
  assert.equal(mo.modoDeLaDecision(sinTurno, EXCEPCIONES), "sombra");
});

prueba("caliente SIN formulario ni cotización → sigue en sombra (no es excepción)", () => {
  const f = ficha({ asignadaA: null, mensajes: [IN(0, "me gusta en negro, cómo hago para separarlo"), BOT(0.2, "¡Excelente elección! ¿En qué ciudad estás?")] });
  const d = mo.evaluarLead(f, EXCEPCIONES, mas(30 * MIN)).decision;
  assert.equal(d.accion, "tarea_asesora");
  assert.match(d.motivo, /^caliente_/);
  assert.equal(mo.modoDeLaDecision(d, EXCEPCIONES), "sombra");
});

prueba("los demás interruptores siguen igual: recuperación, exterior y descarte con su propio modo", () => {
  assert.equal(mo.modoDeLaDecision({ accion: "tarea_asesora", motivo: "recuperacion_72h" }, EXCEPCIONES), "activo");
  assert.equal(mo.modoDeLaDecision({ accion: "excluir_exterior", motivo: "telefono_fuera_de_colombia" }, EXCEPCIONES), "activo");
  assert.equal(mo.modoDeLaDecision({ accion: "descartar", motivo: "sin_respuesta_tras_3_seguimientos" }, EXCEPCIONES), "apagado");
  assert.equal(mo.modoDeLaDecision({ accion: "mensaje_util_producto", motivo: "frio_leyo_sin_responder" }, EXCEPCIONES), "sombra");
});

prueba("recuperación 72 h: con formulario pendiente manda el formulario (una sola decisión, no se duplica)", () => {
  // El cliente calló hace más de 72 h y la asesora le mandó el formulario: el escalón de 72 h es la tarea.
  const f = ficha({ mensajes: [IN(0, ANUNCIO), BOT(0.2, "fotos"), IN(4, "En negro"), IN(5, "cuánto vale?"), ASESORA(10, FORMULARIO), ASESORA(135, "¿Te ayudo?"), ASESORA(10 + 24 * 60 + 5, "¿Pudiste?")] });
  const ev = mo.evaluarLead(f, EXCEPCIONES, mas(10 * MIN + 73 * H));
  assert.equal(ev.decision.motivo, "formulario_sin_respuesta");
  assert.equal(ev.decision.toque, "formulario_72h");
  assert.equal(mo.modoDeLaDecision(ev.decision, EXCEPCIONES), "activo");
});

/* ------------------------------------------------------------------------------------------------
   3. CONVIVENCIA: los automáticos salen salvo con tarea humana ACTIVA de formulario / cotización
------------------------------------------------------------------------------------------------ */

const escena = { config: EXCEPCIONES, guardada: null, mensajes: [], notas: [], fichaCalls: 0 };
const conv = cargar("src/features/seguimiento-inteligente/servicios/convivencia.ts", {
  "@/lib/prisma": {
    prisma: {
      embudoLead: {
        findUnique: async () =>
          escena.guardada
            ? { accion: escena.guardada.accion, accionDatos: { supresion: escena.guardada.supresion, modo: escena.guardada.modo, motivo: escena.guardada.motivo }, exterior: false }
            : null,
      },
      contact: { findUnique: async () => ({ metadata: null }) },
    },
  },
  "./config": { leerConfigSeguimiento: async () => escena.config },
  "./ficha": {
    leerFicha: async () => {
      escena.fichaCalls += 1;
      return { ficha: ficha({ mensajes: escena.mensajes }), workspaceId: "ws", channelId: "l1", contactId: "k1", lead: null };
    },
    leerNotasDelTurno: async () => escena.notas,
  },
});
const ENTRADA = { workspaceId: "ws", conversationId: "cvsoloexcepciones00000001", contactId: "k1", channelId: "l1", motor: "v3", reglaId: "recordatorio-15" };
const ETAPA = { ...ENTRADA, motor: "follow", reglaId: null, nombre: "Etapa Dudas y objeciones · 1" };
const haceMin = (min, e) => ({ ...e, en: new Date(Date.now() - min * MIN), leidoEn: new Date(Date.now() - min * MIN), estado: e.direccion === "OUT" ? "READ" : null });

const asincronas = [];
const pruebaAsync = (nombre, fn) => asincronas.push([nombre, fn]);

prueba("regla pura: en solo excepciones solo frena una tarea_asesora de excepción", () => {
  const base = {
    motorActivo: true,
    exteriorActivo: false,
    esExterior: false,
    motor: "v3",
    convivencia: EXCEPCIONES.convivencia,
    soloExcepciones: true,
  };
  assert.equal(conv.decidirConvivencia({ ...base, accion: "tarea_asesora", supresion: "siempre", motivo: "formulario_sin_respuesta", esExcepcion: true }), "inteligente_tarea_humana");
  assert.equal(conv.decidirConvivencia({ ...base, accion: "esperar", supresion: "siempre", motivo: "formulario_esperando_escalon", esExcepcion: true }), null);
  assert.equal(conv.decidirConvivencia({ ...base, accion: "tarea_asesora", supresion: "siempre", motivo: "caliente_sin_asesora", esExcepcion: false }), null);
  assert.equal(conv.decidirConvivencia({ ...base, accion: "esperar", supresion: "reemplazo", motivo: "el_bot_responde", esExcepcion: false }), null);
  assert.equal(conv.decidirConvivencia({ ...base, accion: "dormido", supresion: "siempre", motivo: "fecha_futura", esExcepcion: false }), null);
  // Sin el modo nuevo: igual que antes.
  assert.equal(conv.decidirConvivencia({ ...base, soloExcepciones: false, accion: "tarea_asesora", supresion: "siempre", motivo: "caliente_sin_asesora" }), "inteligente_tarea_humana");
  assert.equal(conv.decidirConvivencia({ ...base, soloExcepciones: false, accion: "esperar", supresion: "reemplazo", motivo: "el_bot_responde" }), "inteligente_reemplazado");
});

pruebaAsync("formulario con tarea ACTIVA vigente (decidida otra vez ahora) → frena el automático", async () => {
  escena.config = EXCEPCIONES;
  escena.guardada = { accion: "tarea_asesora", supresion: "siempre", modo: "activo", motivo: "formulario_sin_respuesta" };
  // La convivencia decide con la hora real: pedido hace 50 h → el escalón de 2 h ya venció pase lo
  // que pase con el horario laboral (fin de semana incluido) y nadie le escribió.
  escena.mensajes = [haceMin(3010, IN(0, ANUNCIO)), haceMin(3006, IN(0, "En negro")), haceMin(3005, IN(0, "cuánto vale?")), haceMin(3000, ASESORA(0, FORMULARIO))];
  escena.fichaCalls = 0;
  assert.equal(await conv.revisarConvivencia(ENTRADA), "inteligente_tarea_humana");
  assert.equal(await conv.revisarConvivencia(ETAPA), "inteligente_tarea_humana");
  assert.equal(escena.fichaCalls, 2, "se decide otra vez en vivo");
});

pruebaAsync("formulario guardado como tarea pero la asesora YA escribió → sale el automático", async () => {
  escena.config = EXCEPCIONES;
  escena.guardada = { accion: "tarea_asesora", supresion: "siempre", modo: "activo", motivo: "formulario_sin_respuesta" };
  escena.mensajes = [haceMin(200, IN(0, ANUNCIO)), haceMin(195, IN(0, "cuánto vale?")), haceMin(190, ASESORA(0, FORMULARIO)), haceMin(20, ASESORA(0, "¿Te ayudo a completar los datos?"))];
  assert.equal(await conv.revisarConvivencia(ENTRADA), null);
});

pruebaAsync("cliente respondió después de la tarea guardada → sale el automático", async () => {
  escena.config = EXCEPCIONES;
  escena.guardada = { accion: "tarea_asesora", supresion: "siempre", modo: "activo", motivo: "cotizacion_sin_respuesta" };
  escena.mensajes = [haceMin(3000, IN(0, ANUNCIO)), haceMin(2990, ASESORA(0, "Te envío la cotización COT-00123 por $1.250.000")), haceMin(30, IN(0, "listo, ya la vi")), haceMin(29, BOT(0, "¡Genial! 😊"))];
  assert.equal(await conv.revisarConvivencia(ENTRADA), null);
});

pruebaAsync("tibio / caliente / frío guardados en SOMBRA → los automáticos (V3 y Etapa) salen y ni se lee la ficha", async () => {
  escena.config = conTurno(EXCEPCIONES);
  escena.fichaCalls = 0;
  for (const g of [
    { accion: "tarea_asesora", supresion: "siempre", modo: "sombra", motivo: "tibio_sin_asesora" },
    { accion: "tarea_asesora", supresion: "siempre", modo: "sombra", motivo: "caliente_sin_asesora" },
    { accion: "esperar", supresion: "reemplazo", modo: "sombra", motivo: "el_bot_responde" },
    { accion: "esperar", supresion: "ninguna", modo: "sombra", motivo: "turno_del_cliente" },
    { accion: "esperar", supresion: "siempre", modo: "activo", motivo: "formulario_esperando_escalon" },
    { accion: "tarea_asesora", supresion: "ninguna", modo: "activo", motivo: "recuperacion_72h" },
  ]) {
    escena.guardada = g;
    assert.equal(await conv.revisarConvivencia(ENTRADA), null, g.motivo);
    assert.equal(await conv.revisarConvivencia(ETAPA), null, `${g.motivo} (Etapa)`);
  }
  assert.equal(escena.fichaCalls, 0);
});

pruebaAsync("sin el modo nuevo = hoy: sombra no frena nada; activo frena la tarea humana", async () => {
  escena.guardada = { accion: "tarea_asesora", supresion: "siempre", modo: "sombra", motivo: "formulario_sin_respuesta" };
  escena.config = SOMBRA;
  assert.equal(await conv.revisarConvivencia(ENTRADA), null);
  escena.config = ACTIVO;
  escena.guardada = { accion: "tarea_asesora", supresion: "siempre", modo: "activo", motivo: "tibio_sin_asesora" };
  assert.equal(await conv.revisarConvivencia(ENTRADA), "inteligente_tarea_humana");
});

for (const [nombre, fn] of asincronas) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

console.log(`\n${pruebas} pruebas OK`);
