// Pruebas del "DÍA SIGUIENTE" QUE SE RE-ARMA en cada silencio (Alexander, 13-10-2026).
// Sin base ni red: la regla pura y el servicio con una base de mentira en memoria.
// Correr: npm run test:dia-siguiente
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { RAIZ, cargar } from "./supervisor-cargar.mjs";

const D = "src/features/seguimiento-inteligente/dominio";
const cf = cargar(`${D}/config.ts`);
const ds = cargar(`${D}/dia-siguiente.ts`);
const ta = cargar(`${D}/tras-asesora.ts`);
const ab = cargar("src/lib/anti-bloqueo/reglas.ts");
const cv = cargar("src/features/seguimiento-inteligente/servicios/convivencia.ts", {
  "@/lib/prisma": { prisma: {} },
  "./config": { leerConfigSeguimiento: async () => cf.CONFIG_POR_DEFECTO },
});

let pruebas = 0;
const asincronas = [];
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}
function pruebaAsync(nombre, fn) {
  asincronas.push([nombre, fn]);
}

const MIN = 60_000;

// Lunes 12-oct-2026, 9:00 a. m. de Bogotá (14:00 UTC).
const T0 = new Date("2026-10-12T14:00:00Z");
const en = (min) => new Date(T0.getTime() + min * MIN);
const IN = (min) => ({ direccion: "IN", origen: "webhook", en: en(min) });
const BOT = (min) => ({ direccion: "OUT", origen: null, en: en(min) });
const ASESORA = (min) => ({ direccion: "OUT", origen: "manual", en: en(min) });
const V3_15 = (min) => ({ direccion: "OUT", origen: "agente-v3-seguimiento", en: en(min) });
const FOLLOW = (min) => ({ direccion: "OUT", origen: "follow", en: en(min) });

const DIA1_PRESENTACION = { timeType: "DAYS", timeValue: 1, content: "¡Hola! 😊 Sigo atenta para ayudarte…", flowId: null, cancelOnActivity: true, minutos: 1440 };
const DIA1_PRODUCTO = { timeType: "DAYS", timeValue: 1, content: "¡Hola! 😊 Te escribo por el *Combo Camillas*…", flowId: null, cancelOnActivity: true, minutos: 1440 };

let siguienteId = 1;
function follow(parcial) {
  return {
    id: `f${siguienteId++}`,
    name: "Etapa Bienvenida · día siguiente",
    status: "PENDING",
    content: DIA1_PRESENTACION.content,
    timeType: "DAYS",
    timeValue: 1,
    executeAt: en(24 * 60),
    createdAt: en(5),
    ...parcial,
  };
}

function base(parcial = {}) {
  return {
    activo: true,
    esAdmin: false,
    v3Atendio: true,
    pausado: false,
    etapaCrm: "NUEVO",
    mensajes: [IN(0), BOT(1)],
    paso: "PRESENTACION",
    productoId: "combo",
    seguimiento: DIA1_PRESENTACION,
    follows: [],
    minutosDeCalma: 3,
    ahora: en(10),
    ...parcial,
  };
}

/* ================================================================================================
   1. EL INTERRUPTOR (apagado = hoy)
================================================================================================ */

const PRODUCCION = {
  motor: { modo: "sombra", excepcionesActivas: ["formulario", "cotizacion"] },
  tareas: { maxPorAsesoraDia: 15 },
  cadencia: { descarte: "sombra" },
  trasAsesora: { modo: "activo" },
  calificacion: { activo: true },
  recuperacion72h: { modo: "activo" },
};

prueba("apagado = hoy: sin la clave (y con el JSON de producción de hoy) diaSiguiente.rearmar es false", () => {
  assert.equal(cf.leerConfigDeTexto(null).diaSiguiente.rearmar, false);
  assert.equal(cf.leerConfigDeTexto("{roto").diaSiguiente.rearmar, false);
  assert.equal(cf.leerConfigDeTexto(JSON.stringify(PRODUCCION)).diaSiguiente.rearmar, false);
  assert.equal(cf.leerConfigDeTexto(JSON.stringify({ diaSiguiente: { rearmar: "si" } })).diaSiguiente.rearmar, false);
  assert.equal(cf.leerConfigDeTexto(JSON.stringify({ diaSiguiente: {} })).diaSiguiente.minutosDeCalma, 3);
});

prueba("prender: { ...lo de hoy, diaSiguiente: { rearmar: true } } lo prende sin tocar lo demás", () => {
  const c = cf.leerConfigDeTexto(JSON.stringify({ ...PRODUCCION, diaSiguiente: { rearmar: true } }));
  assert.equal(c.diaSiguiente.rearmar, true);
  assert.equal(c.motor.modo, "sombra");
  assert.deepEqual(c.motor.excepcionesActivas, ["formulario", "cotizacion"]);
  assert.equal(c.trasAsesora.modo, "activo");
  // No prende el motor: algoPrendido no cambia por esta clave.
  assert.equal(cf.algoPrendido(cf.leerConfigDeTexto(JSON.stringify({ diaSiguiente: { rearmar: true } }))), false);
});

prueba("apagado = hoy: la regla no arma ni cancela nada", () => {
  const d = ds.decidirDiaSiguiente(base({ activo: false, follows: [follow({ executeAt: en(999) })] }));
  assert.equal(d.accion, "nada");
  assert.equal(d.motivo, "apagado");
  assert.deepEqual(d.cancelar, []);
});

/* ================================================================================================
   2. SE RE-ARMA TRAS NUESTRA RESPUESTA
================================================================================================ */

prueba("cliente escribe → el bot responde → se calla: día 1 del paso actual a las 24 h de NUESTRO último mensaje", () => {
  const d = ds.decidirDiaSiguiente(base({ mensajes: [IN(0), BOT(1), BOT(2)] }));
  assert.equal(d.accion, "armar");
  assert.equal(d.motivo, "armado");
  assert.equal(d.executeAt.toISOString(), en(2 + 24 * 60).toISOString());
  assert.equal(d.seguimiento, DIA1_PRESENTACION);
});

prueba("también cuenta la respuesta de la asesora (si el chat no está pausado)", () => {
  const d = ds.decidirDiaSiguiente(base({ mensajes: [IN(0), BOT(1), ASESORA(4)] }));
  assert.equal(d.accion, "armar");
  assert.equal(d.executeAt.toISOString(), en(4 + 24 * 60).toISOString());
});

prueba("el recordatorio de 15 min / 1 h del V3 o un Follow NO corren el reloj del día siguiente", () => {
  const d = ds.decidirDiaSiguiente(base({ mensajes: [IN(0), BOT(1), V3_15(16), FOLLOW(61)], ahora: en(70) }));
  assert.equal(d.accion, "armar");
  assert.equal(d.executeAt.toISOString(), en(1 + 24 * 60).toISOString());
});

prueba("espera la calma (3 min) para no re-armar en cada mensaje de la tanda del bot", () => {
  const d = ds.decidirDiaSiguiente(base({ mensajes: [IN(0), BOT(1)], ahora: en(2) }));
  assert.equal(d.accion, "nada");
  assert.equal(d.motivo, "esperando_calma");
  assert.equal(d.revisarEn.toISOString(), en(4).toISOString());
});

prueba("segundo silencio: el cliente volvió a escribir, respondimos de nuevo → nuevo día 1 del paso NUEVO; el viejo se cancela", () => {
  // El de la primera vuelta quedó vivo (cancelar_si_escribe apagado en el Playbook).
  const viejo = follow({ executeAt: en(1 + 24 * 60), cancelOnActivity: false });
  const d = ds.decidirDiaSiguiente(
    base({ mensajes: [IN(0), BOT(1), IN(300), BOT(301)], paso: "PRODUCTO", seguimiento: DIA1_PRODUCTO, follows: [viejo], ahora: en(310) }),
  );
  assert.equal(d.accion, "armar");
  assert.equal(d.motivo, "rearmado");
  assert.deepEqual(d.cancelar, [viejo.id]);
  assert.equal(d.executeAt.toISOString(), en(301 + 24 * 60).toISOString());
  assert.equal(d.seguimiento, DIA1_PRODUCTO);
});

prueba("respondimos otra vez sin que el cliente escriba (bot / asesora): se corre a 24 h del último", () => {
  const viejo = follow({ executeAt: en(1 + 24 * 60) });
  const d = ds.decidirDiaSiguiente(base({ mensajes: [IN(0), BOT(1), ASESORA(120)], follows: [viejo], ahora: en(130) }));
  assert.equal(d.accion, "armar");
  assert.deepEqual(d.cancelar, [viejo.id]);
  assert.equal(d.executeAt.toISOString(), en(120 + 24 * 60).toISOString());
});

prueba("no recupera hacia atrás: si las 24 h ya pasaron, ese silencio no tiene toque (sin ráfaga al prender)", () => {
  const d = ds.decidirDiaSiguiente(base({ mensajes: [IN(0), BOT(1)], ahora: en(1 + 24 * 60 + 1) }));
  assert.equal(d.accion, "nada");
  assert.equal(d.motivo, "ya_vencio");
});

/* ================================================================================================
   3. SI EL CLIENTE ESCRIBE
================================================================================================ */

prueba("el cliente escribe (lo último es suyo): no se arma; lo pendiente lo cancela el webhook (cancelar_si_escribe)", () => {
  const d = ds.decidirDiaSiguiente(base({ mensajes: [IN(0), BOT(1), IN(30)], ahora: en(40) }));
  assert.equal(d.accion, "nada");
  assert.equal(d.motivo, "le_toca_a_magilus");
  assert.deepEqual(d.cancelar, [], "no lo toca: si el Playbook dice cancelar_si_escribe = no, se respeta");
});

prueba("el cliente escribe y no le respondemos (solo salió un automático): no se arma", () => {
  const d = ds.decidirDiaSiguiente(base({ mensajes: [IN(0), V3_15(15)], ahora: en(40) }));
  assert.equal(d.accion, "nada");
  assert.equal(d.motivo, "sin_respuesta_nuestra");
});

prueba("el webhook cancela en cada mensaje del cliente (los Follow con cancelOnActivity) y el armado copia cancelar_si_escribe del paso", () => {
  const webhook = fs.readFileSync(path.join(RAIZ, "src/app/api/webhooks/evolution/route.ts"), "utf8");
  assert.match(webhook, /if \(!fromMe && !isCallEvent\) \{\s*await cancelPendingFollowsByContact\(/);
  const servicio = fs.readFileSync(path.join(RAIZ, "src/features/seguimiento-inteligente/servicios/dia-siguiente.ts"), "utf8");
  assert.match(servicio, /cancelOnActivity: s\.cancelOnActivity/);
  const conCancelarNo = ds.elegirSeguimientoDelDia1([{ ...DIA1_PRESENTACION, cancelOnActivity: false }]);
  assert.equal(conCancelarNo.cancelOnActivity, false);
});

/* ================================================================================================
   4. UN SOLO PENDIENTE
================================================================================================ */

prueba("ya armado a la hora correcta: se deja (no se re-crea en cada vuelta)", () => {
  const bueno = follow({ executeAt: en(1 + 24 * 60) });
  const d = ds.decidirDiaSiguiente(base({ follows: [bueno] }));
  assert.equal(d.accion, "mantener");
  assert.equal(d.followId, bueno.id);
  assert.deepEqual(d.cancelar, []);
});

prueba("el de la ENTRADA al paso ('Etapa Bienvenida · 1', mismo texto, ±15 min) cuenta como el día 1: no se duplica", () => {
  const entrada = follow({ name: "Etapa Bienvenida · 1", executeAt: en(0.5 + 24 * 60) });
  const d = ds.decidirDiaSiguiente(base({ follows: [entrada] }));
  assert.equal(d.accion, "mantener");
  assert.equal(d.followId, entrada.id);
});

prueba("dos día 1 pendientes (entrada + re-armado viejo): queda uno solo", () => {
  const entrada = follow({ name: "Etapa Bienvenida · 1", executeAt: en(-500 + 24 * 60) });
  const viejo = follow({ executeAt: en(-400 + 24 * 60) });
  const dia3 = follow({ name: "Etapa Bienvenida · 2", timeValue: 3, executeAt: en(-500 + 72 * 60) });
  const d = ds.decidirDiaSiguiente(base({ follows: [entrada, viejo, dia3] }));
  assert.equal(d.accion, "armar");
  assert.deepEqual(d.cancelar.sort(), [entrada.id, viejo.id].sort(), "el de día 3 no se toca");
});

prueba("otro Follow pendiente que no es de etapa (asesora, regla, campaña, inteligente): no se apila", () => {
  for (const name of ["Llamar mañana", "Campaña: octubre", "Inteligente: útil", null]) {
    const otro = follow({ name, content: "x" });
    const nuestro = follow({ executeAt: en(1 + 24 * 60) });
    const d = ds.decidirDiaSiguiente(base({ follows: [otro, nuestro] }));
    assert.equal(d.accion, "nada", String(name));
    assert.equal(d.motivo, "otro_pendiente");
    assert.deepEqual(d.cancelar, [nuestro.id]);
  }
});

pruebaAsync("servicio: cancela el viejo y crea UNO nuevo 'Etapa Presentación del producto · día siguiente' a las 24 h", async () => {
  const base_ = crearBaseDeMentira();
  base_.estado = { productoActivo: "combo", pasoActual: "PRODUCTO" };
  base_.mensajes = [msg("INBOUND", 0), msg("OUTBOUND", 1), msg("INBOUND", 300), msg("OUTBOUND", 301, null), msg("OUTBOUND", 302, "agente-v3-seguimiento")];
  const viejo = follow({ id: "viejo", executeAt: en(1 + 24 * 60) });
  base_.follows = [viejo];
  const sv = cargarServicio(base_);
  const r = await sv.rearmarDiaSiguienteDelChat("cv1", configCon(true), en(320));
  assert.equal(r.armado, true);
  assert.equal(r.motivo, "rearmado");
  assert.deepEqual(base_.cancelados, [{ ids: ["viejo"], motivo: "Re-armado: dia siguiente" }]);
  assert.equal(base_.creados.length, 1);
  const c = base_.creados[0];
  assert.equal(c.name, "Etapa Presentación del producto · día siguiente");
  assert.equal(c.executeAt.toISOString(), en(301 + 24 * 60).toISOString());
  assert.equal(c.content, DIA1_PRODUCTO.content);
  assert.equal(c.cancelOnActivity, true);
  assert.equal(c.channelId, "l1");
  // Segunda vuelta con lo que quedó: no crea otro.
  base_.follows = [{ ...follow({ id: "nuevo", name: c.name, content: c.content, executeAt: c.executeAt }) }];
  const r2 = await sv.rearmarDiaSiguienteDelChat("cv1", configCon(true), en(330));
  assert.equal(r2.motivo, "ya_armado");
  assert.equal(base_.creados.length, 1);
});

pruebaAsync("servicio apagado: el barrido no consulta la base", async () => {
  const base_ = crearBaseDeMentira();
  base_.explotar = true;
  const sv = cargarServicio(base_);
  const r = await sv.barrerDiaSiguiente("ws", configCon(false), en(10));
  assert.deepEqual(r, { armados: 0, cancelados: 0, mirados: 0 });
});

pruebaAsync("al enviar: un 'Etapa … · 1' de siempre no se revisa (ni lee la base); un día siguiente con el interruptor apagado se cancela", async () => {
  const explota = new Proxy({}, { get: () => { throw new Error("no debía consultar la base"); } });
  const mocksDe = (rearmar, pausado) => ({
    "@/lib/prisma": { prisma: pausado === "explota" ? explota : {
      conversation: { findFirst: async () => ({ id: "cv1", automationPaused: pausado, contact: { crmStage: "NUEVO" } }) },
      follow: { count: async () => 0 },
    } },
    "@/features/agente-v3/motor/estado": { elV3AtendioLaCharla: async () => true },
    "./config": { leerConfigSeguimiento: async () => configCon(rearmar) },
  });
  const ruta = path.join(RAIZ, "src/features/seguimiento-inteligente/servicios/dia-siguiente-al-enviar.ts");
  const F = { workspaceId: "ws", contactId: "k1", channelId: "l1", createdAt: en(0) };
  assert.equal(await cargarSinCache(ruta, mocksDe(true, "explota")).revisarDiaSiguienteAlEnviar({ ...F, name: "Etapa Bienvenida · 1" }), null);
  assert.equal(await cargarSinCache(ruta, mocksDe(false, false)).revisarDiaSiguienteAlEnviar({ ...F, name: "Etapa Bienvenida · día siguiente" }), "seguimiento_apagado");
  assert.equal(await cargarSinCache(ruta, mocksDe(true, false)).revisarDiaSiguienteAlEnviar({ ...F, name: "Etapa Bienvenida · día siguiente" }), null);
  assert.equal(await cargarSinCache(ruta, mocksDe(true, true)).revisarDiaSiguienteAlEnviar({ ...F, name: "Etapa Bienvenida · día siguiente" }), "chat_pausado");
});

/* ================================================================================================
   5. LOS FRENOS
================================================================================================ */

prueba("frenos al armar: pausado (a mano o por la asesora), etapa cerrada, chat del equipo, línea ADMIN, sin paso, paso sin día 1", () => {
  const nuestro = follow({ executeAt: en(1 + 24 * 60) });
  const casos = [
    [{ pausado: true }, "chat_pausado"],
    [{ etapaCrm: "GANADO" }, "etapa_cerrada"],
    [{ etapaCrm: "PERDIDO" }, "etapa_cerrada"],
    [{ v3Atendio: false }, "chat_del_equipo"],
    [{ esAdmin: true }, "linea_admin"],
    [{ paso: null }, "sin_paso"],
    [{ seguimiento: null }, "paso_sin_dia_1"],
  ];
  for (const [cambio, motivo] of casos) {
    const d = ds.decidirDiaSiguiente(base({ ...cambio, follows: [nuestro] }));
    assert.equal(d.accion, "nada", motivo);
    assert.equal(d.motivo, motivo);
    assert.deepEqual(d.cancelar, [nuestro.id], `${motivo}: el que estaba armado se cancela`);
  }
});

prueba("solo seguimientos de ≥ 24 h: los de 15 min / 1 h del paso no son el día 1 (los manda el libro del V3)", () => {
  const s = ds.elegirSeguimientoDelDia1([
    { timeType: "MINUTES", timeValue: 15, content: "a", flowId: null, cancelOnActivity: true },
    { timeType: "HOURS", timeValue: 1, content: "b", flowId: null, cancelOnActivity: true },
    { timeType: "DAYS", timeValue: 1, content: "c", flowId: null, cancelOnActivity: true },
    { timeType: "DAYS", timeValue: 3, content: "d", flowId: null, cancelOnActivity: true },
  ]);
  assert.equal(s.content, "c");
  assert.equal(s.minutos, 1440);
  assert.equal(ds.elegirSeguimientoDelDia1([{ timeType: "HOURS", timeValue: 1, content: "b", flowId: null, cancelOnActivity: true }]), null);
  assert.equal(ds.elegirSeguimientoDelDia1([{ timeType: "DAYS", timeValue: 1, content: "  ", flowId: null, cancelOnActivity: true }]), null);
  const conFlujo = ds.elegirSeguimientoDelDia1([{ timeType: "DAYS", timeValue: 1, content: null, flowId: "evolution:x:y", cancelOnActivity: true }]);
  assert.equal(ds.contenidoDelFollow(conFlujo), "Flujo del embudo");
});

prueba("frenos al enviar: apagado, pausado, etapa cerrada, chat del equipo, tras asesora; si no, sale", () => {
  const ok = { activo: true, pausado: false, etapaCrm: "NUEVO", v3Atendio: true, trasAsesoraDespues: false };
  assert.equal(ds.frenoDelDiaSiguienteAlEnviar(ok), null);
  assert.equal(ds.frenoDelDiaSiguienteAlEnviar({ ...ok, activo: false }), "seguimiento_apagado");
  assert.equal(ds.frenoDelDiaSiguienteAlEnviar({ ...ok, pausado: true }), "chat_pausado");
  assert.equal(ds.frenoDelDiaSiguienteAlEnviar({ ...ok, etapaCrm: "GANADO" }), "etapa_cerrada");
  assert.equal(ds.frenoDelDiaSiguienteAlEnviar({ ...ok, v3Atendio: false }), "chat_del_equipo");
  assert.equal(ds.frenoDelDiaSiguienteAlEnviar({ ...ok, trasAsesoraDespues: true }), "tras_asesora");
});

prueba("es un automático 'Etapa …': le tocan TODAS las medidas (horario, tope, dueño, espaciado, texto vigente)", () => {
  assert.equal(ab.clasificarFollow({ name: "Etapa Bienvenida · día siguiente", followRuleId: null }), "automatico");
  assert.equal(ds.esDiaSiguiente("Etapa Bienvenida · día siguiente"), true);
  assert.equal(ds.esDiaSiguiente("Etapa Bienvenida · 1"), false);
  assert.equal(ds.esDiaSiguiente("Tras asesora: 24 h"), false);
  // Un solo dueño: pausado / la asesora escribió → no sale.
  assert.equal(ab.decidirDueno({ automationPaused: true, crmStage: "NUEVO", inicioDeLaCharla: T0, mensajesHumanos: [] }), "chat_pausado");
  // Tope 3 contando desde la persona: tres automáticos en el silencio → no sale el cuarto.
  const historial = {
    primerEntrante: en(0),
    ultimoEntrante: en(30),
    entrantesDespuesDelAnuncio: 3,
    automaticos: [en(45), en(90), en(60 * 20)],
    ultimoHumano: en(31),
  };
  assert.equal(ab.decidirTope(historial, { sinRespuesta: 3, porSilencio: 3, contarDesdeLaPersona: true }), "tope_por_silencio");
  assert.equal(ab.decidirTope({ ...historial, automaticos: [en(45), en(90)] }, { sinRespuesta: 3, porSilencio: 3, contarDesdeLaPersona: true }), null);
  // Horario 8–20 (Bogotá): a las 6 a. m. no sale, se corre.
  const horario = { activo: true, desdeHora: 8, hastaHora: 20, desfaseMaxMinutos: 30 };
  assert.equal(ab.dentroDelHorario(new Date("2026-10-13T11:00:00Z"), horario), false);
  assert.equal(ab.dentroDelHorario(new Date("2026-10-13T15:00:00Z"), horario), true);
});

prueba("convivencia del seguimiento inteligente: en sombra con excepciones solo frena la tarea de formulario / cotización; exterior frena", () => {
  const entrada = {
    motorActivo: true,
    soloExcepciones: true,
    exteriorActivo: false,
    esExterior: false,
    accion: "tarea_asesora",
    supresion: "siempre",
    motor: "follow",
    nombre: "Etapa Bienvenida · día siguiente",
    convivencia: cf.CONFIG_POR_DEFECTO.convivencia,
  };
  assert.equal(cv.decidirConvivencia({ ...entrada, esExcepcion: true }), "inteligente_tarea_humana");
  assert.equal(cv.decidirConvivencia({ ...entrada, esExcepcion: false }), null);
  assert.equal(cv.decidirConvivencia({ ...entrada, esExcepcion: false, exteriorActivo: true, esExterior: true }), "fuera_de_colombia");
});

prueba("el motor de seguimientos revisa el día siguiente ANTES de la convivencia y del anti-bloqueo", () => {
  const src = fs.readFileSync(path.join(RAIZ, "src/features/seguimientos/services/follows.ts"), "utf8");
  const cuerpo = src.slice(src.indexOf("async function executeFollowRecord"));
  const a = cuerpo.indexOf("revisarDiaSiguienteAlEnviar(follow)");
  const b = cuerpo.indexOf("revisarConvivencia(");
  const c = cuerpo.indexOf("revisarAntiBloqueoDelFollow(follow, clase)");
  const f = cuerpo.indexOf("revisarFrenoDeAutomatico(");
  assert.ok(a > 0 && a < b && b < c && c < f, "orden: día siguiente → convivencia → anti-bloqueo → freno de dos seguidos");
});

/* ================================================================================================
   6. NO DUPLICA CON "TRAS ASESORA"
================================================================================================ */

prueba("tras asesora PENDIENTE → no se arma (y se cancela el nuestro)", () => {
  const tras = follow({ name: "Tras asesora: 24 h", content: "x", executeAt: en(100) });
  const nuestro = follow({ executeAt: en(1 + 24 * 60) });
  const d = ds.decidirDiaSiguiente(base({ follows: [tras, nuestro] }));
  assert.equal(d.motivo, "tras_asesora_pendiente");
  assert.deepEqual(d.cancelar, [nuestro.id]);
});

prueba("tras asesora ya salió EN ESTE silencio → no se arma; uno de un silencio anterior no estorba", () => {
  const salio = follow({ name: "Tras asesora: 24 h", status: "EXECUTED", content: "x", createdAt: en(5) });
  assert.equal(ds.decidirDiaSiguiente(base({ mensajes: [IN(0), BOT(1)], follows: [salio] })).motivo, "tras_asesora_en_este_silencio");
  const anterior = follow({ name: "Tras asesora: 24 h", status: "EXECUTED", content: "x", createdAt: en(-2000) });
  assert.equal(ds.decidirDiaSiguiente(base({ mensajes: [IN(0), BOT(1)], follows: [anterior] })).accion, "armar");
});

prueba("y al revés: 'Tras asesora' solo actúa con el chat pausado, donde el día siguiente nunca se arma", () => {
  const cfg = cf.leerConfigDeTexto(JSON.stringify({ trasAsesora: { modo: "activo" } })).trasAsesora;
  const r = ta.decidirTrasAsesora({
    mensajes: [],
    inicio: T0,
    nombre: null,
    pausado: false,
    pausadoEn: null,
    etapaCrm: "NUEVO",
    noInteresa: false,
    dormido: false,
    pospuesto: false,
    caliente: false,
    config: cfg,
    ahora: en(10),
  });
  assert.equal(r.sale, false);
  assert.equal(r.motivo, "ia_activa");
  assert.equal(ds.decidirDiaSiguiente(base({ pausado: true })).motivo, "chat_pausado");
});

/* ================================================================================================
   6. SIN RESPUESTA A LA BIENVENIDA: los Follow automáticos salen sin IA (y el texto del combo)
================================================================================================ */

const bv = cargar("src/features/seguimientos/dominio/sin-respuesta-a-la-bienvenida.ts");
const COMBO = bv.PRODUCTO_COMBO_CAMILLAS_ID;
const TEXTO_COMBO = "¿Quieres el combo completo de camilla, escalera, silla y carrito o prefieres solo algunas piezas?";
const AGENDADO = "¡Hola! 😊 Te escribo por el *Combo Camillas*…";
const DIA1 = { name: "Etapa Presentación del producto · día siguiente", timeType: "MINUTES", timeValue: 1 };
const ETAPA_1_DE_1_DIA = { name: "Etapa Presentación del producto · 1", timeType: "DAYS", timeValue: 1 };
const SIN_RESPONDER = [{ direction: "INBOUND", type: "TEXT", createdAt: en(0) }, { direction: "OUTBOUND", type: "TEXT", createdAt: en(1) }];
const RESPONDIO = [...SIN_RESPONDER, { direction: "INBOUND", type: "TEXT", createdAt: en(5) }];

prueba("sin respuesta: constantes y cuál es el día siguiente", () => {
  assert.equal(COMBO, "cmp7lojx700bj2hn6z2vrv0i9");
  assert.equal(bv.TEXTO_COMBO_DIA_SIGUIENTE, TEXTO_COMBO);
  assert.equal(bv.esDelDiaSiguiente(DIA1), true);
  assert.equal(bv.esDelDiaSiguiente(ETAPA_1_DE_1_DIA), true);
  assert.equal(bv.esDelDiaSiguiente({ name: "Etapa Presentación del producto · 2", timeType: "HOURS", timeValue: 24 }), true);
  assert.equal(bv.esDelDiaSiguiente({ name: "Etapa Presentación del producto · 1", timeType: "MINUTES", timeValue: 15 }), false);
  assert.equal(bv.esDelDiaSiguiente({ name: "Etapa Presentación del producto · 3", timeType: "DAYS", timeValue: 3 }), false);
  assert.equal(bv.esDelDiaSiguiente({ name: "Tras asesora: 24 h", timeType: "DAYS", timeValue: 1 }), false);
  assert.equal(bv.esDelDiaSiguiente({ name: null, timeType: "DAYS", timeValue: 1 }), false);
  assert.deepEqual(bv.textoSinRespuesta({ productoId: COMBO, delDiaSiguiente: true, esFlujo: false, textoFijo: "x" }), { texto: TEXTO_COMBO, esElDelCombo: true });
  assert.deepEqual(bv.textoSinRespuesta({ productoId: COMBO, delDiaSiguiente: true, esFlujo: true, textoFijo: "x" }), { texto: "x", esElDelCombo: false });
  assert.deepEqual(bv.textoSinRespuesta({ productoId: "otro", delDiaSiguiente: true, esFlujo: false, textoFijo: "x" }), { texto: "x", esElDelCombo: false });
  assert.deepEqual(bv.textoSinRespuesta({ productoId: COMBO, delDiaSiguiente: false, esFlujo: false, textoFijo: "x" }), { texto: "x", esElDelCombo: false });
});

function cargarSinRespuesta({ mensajes, productoActivo = COMBO, activeProductContext = null, existe = true, estadoExplota = false }) {
  const ruta = path.join(RAIZ, "src/features/seguimientos/services/sin-respuesta-a-la-bienvenida.ts");
  const lecturas = { estado: 0 };
  const prisma = {
    conversation: {
      findFirst: async ({ where }) => (existe && where.id === "cv1" && where.workspaceId === "ws" ? { activeProductContext, messages: mensajes } : null),
    },
  };
  const sv = cargarSinCache(ruta, {
    "@/lib/prisma": { prisma },
    "@/features/agente-v3/motor/estado": {
      leerEstado: async () => {
        lecturas.estado += 1;
        if (estadoExplota) throw new Error("se cayó la base");
        return { productoActivo, pasoActual: "PRESENTACION", flujosEnviados: [], seguimientosEnviados: [] };
      },
    },
  });
  return { sv, lecturas };
}

// Sin IA: si alguien llama a la red (OpenAI), la prueba falla.
async function sinRed(fn) {
  const fetchReal = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("no debía llamar a la IA");
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = fetchReal;
  }
}

const pedir = (follow, origen = "follow", textoFijo = AGENDADO) => ({ workspaceId: "ws", conversationId: "cv1", follow, textoFijo, origen });

pruebaAsync("sin respuesta: el combo en su día siguiente ('· día siguiente' y '· 1' de 1 día) sale con el texto exacto, sin IA", async () => {
  await sinRed(async () => {
    for (const follow of [DIA1, ETAPA_1_DE_1_DIA]) {
      const { sv } = cargarSinRespuesta({ mensajes: SIN_RESPONDER });
      const r = await sv.resolverSinRespuesta(pedir(follow));
      assert.equal(r.enviar, true);
      assert.equal(r.texto, TEXTO_COMBO);
      assert.equal(r.deIA, false);
      assert.equal(r.textoReemplazado, AGENDADO);
    }
  });
});

pruebaAsync("sin respuesta: el producto sale del chat (activeProductContext) si el V3 no lo tiene o falla", async () => {
  await sinRed(async () => {
    const a = cargarSinRespuesta({ mensajes: SIN_RESPONDER, productoActivo: null, activeProductContext: { productId: COMBO } });
    assert.equal((await a.sv.resolverSinRespuesta(pedir(DIA1))).texto, TEXTO_COMBO);
    const b = cargarSinRespuesta({ mensajes: SIN_RESPONDER, estadoExplota: true, activeProductContext: { productId: COMBO } });
    assert.equal((await b.sv.resolverSinRespuesta(pedir(DIA1))).texto, TEXTO_COMBO);
    const c = cargarSinRespuesta({ mensajes: SIN_RESPONDER, productoActivo: null, activeProductContext: null });
    const r = await c.sv.resolverSinRespuesta(pedir(DIA1));
    assert.deepEqual([r.texto, r.deIA, r.textoReemplazado], [AGENDADO, false, null]);
  });
});

pruebaAsync("sin respuesta: otro producto, o un automático que no es del día siguiente, sale con su texto agendado, sin IA", async () => {
  await sinRed(async () => {
    const otro = cargarSinRespuesta({ mensajes: SIN_RESPONDER, productoActivo: "otro-producto" });
    const r1 = await otro.sv.resolverSinRespuesta(pedir(DIA1));
    assert.deepEqual({ enviar: r1.enviar, texto: r1.texto, deIA: r1.deIA, textoReemplazado: r1.textoReemplazado }, { enviar: true, texto: AGENDADO, deIA: false, textoReemplazado: null });
    for (const follow of [
      { name: "Tras asesora: 24 h", timeType: "DAYS", timeValue: 1 },
      { name: "Inteligente: cotización", timeType: "HOURS", timeValue: 3 },
      { name: "Etapa Presentación del producto · 3", timeType: "DAYS", timeValue: 3 },
    ]) {
      const { sv, lecturas } = cargarSinRespuesta({ mensajes: SIN_RESPONDER });
      const r = await sv.resolverSinRespuesta(pedir(follow, "follow", "Texto agendado"));
      assert.deepEqual([r.enviar, r.texto, r.deIA, r.textoReemplazado], [true, "Texto agendado", false, null]);
      assert.equal(lecturas.estado, 0, "fuera del día siguiente no hace falta leer el producto");
    }
  });
});

pruebaAsync("sin respuesta: si el cliente ya respondió (o el chat no existe) devuelve null y sigue el redactor", async () => {
  const { sv } = cargarSinRespuesta({ mensajes: RESPONDIO });
  assert.equal(await sv.resolverSinRespuesta(pedir(DIA1)), null);
  const noExiste = cargarSinRespuesta({ mensajes: SIN_RESPONDER, existe: false });
  assert.equal(await noExiste.sv.resolverSinRespuesta(pedir(DIA1)), null);
});

pruebaAsync("sin respuesta: el texto del combo sale sin OPENAI_API_KEY y con el interruptor apagado (no los lee)", async () => {
  const claveAntes = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    await sinRed(async () => {
      const { sv } = cargarSinRespuesta({ mensajes: SIN_RESPONDER });
      // El mock de prisma no tiene appSetting: si leyera "seguimientos-que-escuchan:apagado", explotaría.
      const r = await sv.resolverSinRespuesta(pedir(DIA1));
      assert.equal(r.texto, TEXTO_COMBO);
    });
  } finally {
    if (claveAntes !== undefined) process.env.OPENAI_API_KEY = claveAntes;
  }
  const codigo = fs.readFileSync(path.join(RAIZ, "src/features/seguimientos/services/sin-respuesta-a-la-bienvenida.ts"), "utf8");
  assert.doesNotMatch(codigo, /process\.env|\.appSetting|"seguimientos-que-escuchan/);
});

pruebaAsync("sin respuesta: un flujo del día siguiente del combo sale con sus textos tal cual (nunca el del combo)", async () => {
  await sinRed(async () => {
    const { sv } = cargarSinRespuesta({ mensajes: SIN_RESPONDER });
    for (const paso of ["Paso 1 del flujo", "Paso 2 del flujo"]) {
      const r = await sv.resolverSinRespuesta(pedir(DIA1, "flujo", paso));
      assert.deepEqual([r.enviar, r.texto, r.deIA, r.textoReemplazado], [true, paso, false, null]);
    }
  });
});

pruebaAsync("sin respuesta: con varias acciones de texto el combo sale solo en la primera; las demás con su texto", async () => {
  const { sv } = cargarSinRespuesta({ mensajes: SIN_RESPONDER });
  let yaSalio = false;
  const salidas = [];
  for (const textoFijo of ["Acción 1", "Acción 2", "Acción 3"]) {
    const r = await sv.resolverSinRespuesta(pedir(DIA1, "follow", textoFijo));
    const unaVez = sv.sinRepetirElCombo(r, yaSalio, textoFijo);
    yaSalio = unaVez.comboYaSalio;
    salidas.push([unaVez.redactado.texto, unaVez.redactado.deIA, unaVez.redactado.textoReemplazado]);
  }
  assert.deepEqual(salidas, [[TEXTO_COMBO, false, "Acción 1"], ["Acción 2", false, null], ["Acción 3", false, null]]);
  // Un texto agendado (no el combo) no gasta el turno del combo.
  const agendado = { enviar: true, texto: "x", deIA: false, textoReemplazado: null, motivo: "m" };
  assert.deepEqual(sv.sinRepetirElCombo(agendado, false, "x"), { redactado: agendado, comboYaSalio: false });
});

prueba("sin respuesta: follows.ts consulta la regla antes del redactor, y solo en los automáticos", () => {
  const codigo = fs.readFileSync(path.join(RAIZ, "src/features/seguimientos/services/follows.ts"), "utf8");
  const inicio = codigo.indexOf("function redactorDelFollow(");
  const cuerpo = codigo.slice(inicio, codigo.indexOf("\n}\n", inicio));
  const iSin = cuerpo.indexOf("resolverSinRespuesta(");
  const iIa = cuerpo.indexOf("redactarSeguimientoQueEscucha(");
  const iChat = cuerpo.indexOf("if (!conversationId) return null;");
  assert.ok(iChat > 0 && iSin > iChat && iIa > iSin, "orden: chat → sin respuesta → redactor");
  assert.match(cuerpo, /sinRepetirElCombo\(/);
  assert.match(codigo, /clase === "automatico" \? redactorDelFollow\(follow, actions\) : null/);
});

/* ================================================================================================
   BASE DE MENTIRA para el servicio
================================================================================================ */

function msg(direction, min, origen = null) {
  return { direction, createdAt: en(min), origen };
}

function crearBaseDeMentira() {
  return {
    explotar: false,
    estado: { productoActivo: "combo", pasoActual: "PRESENTACION" },
    mensajes: [],
    follows: [],
    creados: [],
    cancelados: [],
  };
}

function configCon(rearmar) {
  return cf.leerConfigDeTexto(JSON.stringify({ diaSiguiente: { rearmar } }));
}

function cargarServicio(b) {
  const ruta = path.join(RAIZ, "src/features/seguimiento-inteligente/servicios/dia-siguiente.ts");
  const guardia = () => {
    if (b.explotar) throw new Error("no debía consultar la base");
  };
  const prisma = {
    $queryRaw: async () => {
      guardia();
      return [...b.mensajes].sort((x, y) => y.createdAt - x.createdAt);
    },
    conversation: {
      findUnique: async () => {
        guardia();
        return { workspaceId: "ws", contactId: "k1", channelId: "l1", automationPaused: false, contact: { crmStage: "NUEVO" }, channel: { purpose: "SALES" } };
      },
    },
    follow: {
      findMany: async () => {
        guardia();
        return b.follows;
      },
      updateMany: async ({ where, data }) => {
        b.cancelados.push({ ids: where.id.in, motivo: data.executionError });
        return { count: where.id.in.length };
      },
    },
    productFunnelStage: {
      findFirst: async ({ where }) => ({
        followUps: where.stage === "PRODUCTO"
          ? [{ timeType: "MINUTES", timeValue: 15, content: "15", flowId: null, cancelOnActivity: true }, DIA1_PRODUCTO]
          : [DIA1_PRESENTACION],
      }),
    },
  };
  const mocks = {
    "@/lib/prisma": { prisma },
    "@/features/agente-v3/motor/estado": {
      elV3AtendioLaCharla: async () => true,
      leerEstado: async () => ({ ...b.estado, flujosEnviados: [], seguimientosEnviados: [] }),
    },
    "@/features/seguimientos/services/follows": {
      createFollow: async (input) => {
        b.creados.push(input);
        return { id: `nuevo${b.creados.length}` };
      },
    },
    "@prisma/client": { Prisma: { sql: (...x) => x } },
  };
  return cargarSinCache(ruta, mocks);
}

// cargar() guarda en caché por archivo; el servicio se carga de nuevo para cada base de mentira.
function cargarSinCache(ruta, mocks) {
  const copia = ruta.replace(/\.ts$/, `.prueba-${Math.random().toString(36).slice(2)}.ts`);
  fs.writeFileSync(copia, fs.readFileSync(ruta, "utf8"));
  try {
    return cargar(copia, mocks);
  } finally {
    fs.unlinkSync(copia);
  }
}

for (const [nombre, fn] of asincronas) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}
console.log(`\n${pruebas} pruebas del día siguiente: todas bien`);
