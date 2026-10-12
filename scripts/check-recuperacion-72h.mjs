// Pruebas de la RECUPERACIÓN 72 HORAS, los AUTOMÁTICOS DESPUÉS DE LA ASESORA y el TOPE 3 del
// anti-bloqueo (decisiones de Alexander del 12-10-2026). Sin base ni red.
// Correr: npm run test:recuperacion-72h
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { RAIZ, cargar } from "./supervisor-cargar.mjs";

const D = "src/features/seguimiento-inteligente/dominio";
const cf = cargar(`${D}/config.ts`);
const mo = cargar(`${D}/motor.ts`);
const rc = cargar(`${D}/recuperacion.ts`);
const ta = cargar(`${D}/tras-asesora.ts`);
const tp = cargar(`${D}/tope.ts`);
const ab = cargar("src/lib/anti-bloqueo/reglas.ts");
const turno = cargar("src/lib/turno-de-la-conversacion.ts");
const redaccion = cargar("src/lib/reglas-de-redaccion.ts");
const freno = cargar("src/lib/freno-de-automaticos.ts", {
  "@/lib/prisma": { prisma: {} },
  "@/lib/anti-bloqueo/servicio": { leerConfigAntiBloqueo: async () => ab.CONFIG_POR_DEFECTO },
});
const cv = cargar("src/features/seguimiento-inteligente/servicios/convivencia.ts", {
  "@/lib/prisma": { prisma: {} },
  "./config": { leerConfigSeguimiento: async () => cf.CONFIG_POR_DEFECTO },
});

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const MIN = 60_000;
const H = 60 * MIN;
const DIA = 24 * H;
// Lunes 12-oct-2026, 9:00 a. m. de Bogotá (14:00 UTC).
const T0 = new Date("2026-10-12T14:00:00Z");
const mas = (ms) => new Date(T0.getTime() + ms);
const IN = (min, texto) => ({ direccion: "IN", tipo: "TEXT", texto, en: mas(min * MIN), leidoEn: mas(min * MIN), origen: "webhook" });
const BOT = (min, texto) => ({ direccion: "OUT", tipo: "TEXT", texto, en: mas(min * MIN), leidoEn: mas((min + 1) * MIN), estado: "READ", origen: null });
const ASESORA = (min, texto) => ({ ...BOT(min, texto), origen: "manual" });
const CELULAR = (min, texto) => ({ ...BOT(min, texto), origen: "instance" });
const AUTO = (min, texto) => ({ ...BOT(min, texto), origen: "follow" });
const AUDIO = (min) => ({ ...BOT(min, null), tipo: "AUDIO", origen: "manual" });
const ANUNCIO = "Hola, me interesa el COMBO de estética (camilla, escalera, silla y auxiliar)";

function ficha(parcial = {}) {
  return {
    conversationId: "cvprueba0000000000000072",
    nombre: "Laura Gómez",
    etapaCrm: "NUEVO",
    pausado: true,
    asignadaA: "ingrid",
    pais: "CO",
    marcaExterior: false,
    inicioDeLaCharla: T0,
    familiaDelBot: "combo-camilla",
    flujosEnviados: [],
    cotizacion: { en: null, ref: null, total: null },
    mensajesUtiles: 0,
    mensajes: [],
    llamadas: [],
    historialCompleto: true,
    ...parcial,
  };
}

const conRec = (modo, extra = {}) =>
  cf.leerConfigDeTexto(JSON.stringify({ calificacion: { activo: true }, motor: { modo: "sombra" }, recuperacion72h: { modo, ...extra } }));

/* ================================================================================================
   B. TOPE DEL ANTI-BLOQUEO: de 2 a 3
================================================================================================ */

prueba("B: el tope por defecto es 3 (sin respuesta y por silencio); el JSON de producción manda", () => {
  const d = ab.leerConfigAntiBloqueoDeTexto(null);
  assert.equal(d.topeTotal.sinRespuesta, 3);
  assert.equal(d.topeTotal.porSilencio, 3);
  assert.equal(d.topeTotal.activo, false);
  assert.equal(d.topeTotal.contarDesdeLaPersona, false);
  // Producción hoy tiene 2 y 2 escritos: hasta cambiar el AppSetting, sigue 2.
  const prod = ab.leerConfigAntiBloqueoDeTexto('{"topeTotal":{"activo":true,"sinRespuesta":2,"porSilencio":2}}');
  assert.deepEqual([prod.topeTotal.sinRespuesta, prod.topeTotal.porSilencio], [2, 2]);
  // La cadencia del motor sigue al tope.
  assert.equal(cf.CONFIG_POR_DEFECTO.cadencia.maxAutomaticos, 3);
});

prueba("B: con tope 3, el 3.er automático del silencio sale y el 4.º no", () => {
  const base = { primerEntrante: mas(0), ultimoEntrante: mas(5 * MIN), entrantesDespuesDelAnuncio: 1 };
  const tope = { sinRespuesta: 3, porSilencio: 3 };
  assert.equal(ab.decidirTope({ ...base, automaticos: [mas(20 * MIN), mas(65 * MIN)] }, tope), null);
  assert.equal(ab.decidirTope({ ...base, automaticos: [mas(20 * MIN), mas(65 * MIN), mas(DIA)] }, tope), "tope_por_silencio");
  // Solo el anuncio: 3 en total.
  const anuncio = { primerEntrante: mas(0), ultimoEntrante: mas(0), entrantesDespuesDelAnuncio: 0 };
  assert.equal(ab.decidirTope({ ...anuncio, automaticos: [mas(H), mas(2 * H)] }, tope), null);
  assert.equal(ab.decidirTope({ ...anuncio, automaticos: [mas(H), mas(2 * H), mas(DIA)] }, tope), "tope_sin_respuesta");
});

prueba("B: `contarDesdeLaPersona` (apagado por defecto): lo de antes de la asesora no gasta el cupo", () => {
  const h = { primerEntrante: mas(0), ultimoEntrante: mas(5 * MIN), entrantesDespuesDelAnuncio: 1, automaticos: [mas(20 * MIN), mas(65 * MIN), mas(70 * MIN)], ultimoHumano: mas(2 * H) };
  assert.equal(ab.decidirTope(h, { sinRespuesta: 3, porSilencio: 3 }), "tope_por_silencio");
  assert.equal(ab.decidirTope(h, { sinRespuesta: 3, porSilencio: 3, contarDesdeLaPersona: true }), null);
  // El freno "dos seguidos hoy" igual.
  const filas = [
    { direction: "OUTBOUND", status: "READ", readAt: mas(H), createdAt: mas(2 * H), origen: "manual" },
    { direction: "OUTBOUND", status: "READ", readAt: mas(H), createdAt: mas(65 * MIN), origen: "agente-v3-seguimiento" },
    { direction: "OUTBOUND", status: "READ", readAt: mas(H), createdAt: mas(20 * MIN), origen: "agente-v3-seguimiento" },
    { direction: "INBOUND", status: "READ", readAt: null, createdAt: mas(5 * MIN), origen: "webhook" },
  ];
  assert.deepEqual(freno.decidirFreno(filas, mas(3 * H)), { enviar: false, motivo: "dos_sin_respuesta" });
  assert.deepEqual(freno.decidirFreno(filas, mas(3 * H), { frenarNoLeido: false, contarDesdeLaPersona: true }), { enviar: true });
});

/* ================================================================================================
   A. AUTOMÁTICOS DESPUÉS DE LA ASESORA
================================================================================================ */

const CHARLA_A = [IN(0, ANUNCIO), BOT(0.2, "Bienvenid@"), IN(5, "¿Hacen envíos a Cali?"), ASESORA(12, "¡Hola Laura! Sí, enviamos a Cali. Te comparto las fotos del combo 😊")];
const TA = cf.leerConfigDeTexto(JSON.stringify({ trasAsesora: { modo: "activo" } })).trasAsesora;
const entradaA = (parcial = {}) => ({
  mensajes: CHARLA_A,
  notas: [],
  inicio: T0,
  nombre: "Laura Gómez",
  pausado: true,
  pausadoEn: mas(12 * MIN + 2_000),
  etapaCrm: "PROPUESTA",
  noInteresa: false,
  dormido: false,
  pospuesto: false,
  caliente: false,
  config: TA,
  ahora: mas(12 * MIN + 61 * MIN),
  ...parcial,
});

prueba("A: asesora escribió y el cliente calla → a la 1 h sale el automático (la IA sigue pausada)", () => {
  const r = ta.decidirTrasAsesora(entradaA());
  assert.equal(r.sale, true);
  assert.equal(r.horas, 1);
  assert.equal(r.nombreDelFollow, "Tras asesora: 1 h");
  assert.match(r.texto, /^¡Hola, Laura!/);
  // A los 30 min todavía no (y dice cuándo).
  const antes = ta.decidirTrasAsesora(entradaA({ ahora: mas(42 * MIN) }));
  assert.equal(antes.sale, false);
  assert.equal(antes.motivo, "todavia_no");
  assert.equal(antes.revisarEn.toISOString(), mas(72 * MIN).toISOString());
  // Nada de esto despausa: el reloj del V3 sigue mirando solo chats NO pausados y el webhook no contesta pausados.
  const reloj = fs.readFileSync(path.join(RAIZ, "src/features/agente-v3/servicios/seguimientos.ts"), "utf8");
  assert.match(reloj, /automationPaused: false/);
  const servicio = fs.readFileSync(path.join(RAIZ, "src/features/seguimiento-inteligente/servicios/tras-asesora.ts"), "utf8");
  assert.doesNotMatch(servicio, /automationPaused\s*[:=]\s*false|setConversationAutomationPaused/);
});

prueba("A: al día siguiente sale el segundo; después de la gracia ya no; 2 toques y listo", () => {
  const con1 = [...CHARLA_A, AUTO(73, "¿Pudiste ver lo que te envié?")];
  const r = ta.decidirTrasAsesora(entradaA({ mensajes: con1, ahora: mas(12 * MIN + DIA + 5 * MIN) }));
  assert.equal(r.sale, true);
  assert.equal(r.horas, 24);
  assert.match(r.nombreDelFollow, /24 h/);
  assert.equal(ta.decidirTrasAsesora(entradaA({ mensajes: con1, ahora: mas(12 * MIN + DIA + 7 * H) })).motivo, "se_paso_la_gracia");
  const con2 = [...con1, AUTO(12 + 24 * 60 + 5, "Te escribo para saber…")];
  assert.equal(ta.decidirTrasAsesora(entradaA({ mensajes: con2, ahora: mas(2 * DIA) })).motivo, "toques_completos");
  // Si se pasaron los dos (por ejemplo, el de 1 h lo frenó el tope), sale solo el más avanzado.
  const r2 = ta.decidirTrasAsesora(entradaA({ ahora: mas(12 * MIN + DIA + 10 * MIN) }));
  assert.equal(r2.horas, 24);
});

prueba("A: pausa a mano (el interruptor, no coincide con un mensaje de la persona) → no sale nada", () => {
  const r = ta.decidirTrasAsesora(entradaA({ pausadoEn: mas(40 * MIN) }));
  assert.equal(r.sale, false);
  assert.equal(r.motivo, "pausa_manual");
  // Desde el celular también cuenta como persona (fuera del primer minuto de la charla).
  const celular = [IN(0, ANUNCIO), BOT(0.2, "Bienvenid@"), IN(5, "precio?"), CELULAR(15, "Hola, está en $989.000")];
  assert.equal(ta.decidirTrasAsesora(entradaA({ mensajes: celular, pausadoEn: mas(15 * MIN), ahora: mas(80 * MIN) })).sale, true);
});

prueba("A: la asesora prometió algo ('ya te envío…', 'déjame confirmar') → el turno es nuestro, no sale", () => {
  for (const texto of ["Ya te envío la cotización", "Déjame confirmar el envío y te cuento", "Te confirmo en un momento", "Estoy verificando con bodega"]) {
    const msgs = [...CHARLA_A.slice(0, 3), ASESORA(12, texto)];
    assert.equal(ta.decidirTrasAsesora(entradaA({ mensajes: msgs })).motivo, "asesora_prometio", texto);
  }
  assert.equal(ta.asesoraPrometio("¡Hola! Sí enviamos a Cali 😊 ¿Te comparto fotos?"), false);
});

prueba("A: interruptor apagado, IA activa, etapa cerrada, no le interesa, dormido, pospuesto o el cliente escribió → nada", () => {
  const apagado = cf.leerConfigDeTexto(null).trasAsesora;
  assert.equal(apagado.modo, "apagado");
  // Freno de seguridad: máximo 80 toques al día en el negocio (configurable).
  assert.equal(apagado.maxPorDia, 80);
  assert.equal(cf.leerConfigDeTexto('{"trasAsesora":{"maxPorDia":0}}').trasAsesora.maxPorDia, 0);
  assert.equal(ta.decidirTrasAsesora(entradaA({ config: apagado })).motivo, "apagado");
  assert.equal(ta.decidirTrasAsesora(entradaA({ pausado: false })).motivo, "ia_activa");
  assert.equal(ta.decidirTrasAsesora(entradaA({ etapaCrm: "PERDIDO" })).motivo, "etapa_cerrada");
  assert.equal(ta.decidirTrasAsesora(entradaA({ noInteresa: true })).motivo, "no_le_interesa");
  assert.equal(ta.decidirTrasAsesora(entradaA({ dormido: true })).motivo, "fecha_futura");
  assert.equal(ta.decidirTrasAsesora(entradaA({ pospuesto: true })).motivo, "pospuesto");
  const respondio = [...CHARLA_A, IN(30, "ok gracias")];
  assert.equal(ta.decidirTrasAsesora(entradaA({ mensajes: respondio })).motivo, "sin_persona_despues_del_cliente");
});

prueba("A: el Follow 'Tras asesora: …' es AUTOMÁTICO (tope, horario, espaciado, convivencia) y sus textos cumplen la redacción", () => {
  assert.equal(ab.clasificarFollow({ name: "Tras asesora: 1 h", followRuleId: null }), "automatico");
  assert.equal(ab.clasificarFollow({ name: "Recordatorio de María", followRuleId: null }), "humano");
  for (const plantilla of cf.CONFIG_POR_DEFECTO.trasAsesora.textos) {
    const texto = ta.textoDelToque(plantilla, "laura");
    assert.deepEqual(redaccion.frasesProhibidas(texto), [], texto);
    assert.doesNotMatch(texto, /contraentrega|env[ií]o gratis/i);
  }
  // La regla de envío: el anti-bloqueo no lo frena por "un solo dueño" pero sí por etapa cerrada.
  const follows = fs.readFileSync(path.join(RAIZ, "src/features/seguimientos/services/follows.ts"), "utf8");
  assert.match(follows, /dueno: esAutomatico && !esToqueDeCadencia && !esTrasAsesora, tope: esAutomatico, etapa: esTrasAsesora/);
  assert.match(follows, /asesora_escribio/);
});

/* ================================================================================================
   C. RECUPERACIÓN 72 HORAS
================================================================================================ */

// El cliente conversó; la asesora le respondió a los 12 min y él calló. Silencio desde 9:12 del lunes.
const CHARLA_C = [IN(0, ANUNCIO), BOT(0.2, "Bienvenid@"), IN(5, "¿Cuánto vale y hacen envíos a Cali?"), ASESORA(12, "¡Hola Laura! Está en $989.000 y sí enviamos a Cali 😊")];
const ENTRADA = mas(12 * MIN + 72 * H); // jueves 15-oct 9:12 Bogotá
const REC = conRec("activo");
const evalR = (f, ahora, config = REC) => mo.evaluarLead(f, config, ahora);

prueba("C: antes de las 72 h no entra (y dice cuándo despertar)", () => {
  const ev = evalR(ficha({ mensajes: CHARLA_C }), new Date(ENTRADA.getTime() - H));
  assert.equal(ev.recuperacion.tipo, "fuera");
  assert.equal(ev.recuperacion.motivo, "antes_de_las_72h");
  assert.equal(ev.recuperacion.despertarEn.toISOString(), ENTRADA.toISOString());
  assert.notEqual(ev.decision.motivo, "recuperacion_72h");
});

prueba("C: flujo completo — 72 h → Llamar → no contesta → Audio → 24 h → Descartado (activo)", () => {
  const t1 = new Date(ENTRADA.getTime() + 5 * MIN);
  let ev = evalR(ficha({ mensajes: CHARLA_C }), t1);
  assert.equal(ev.recuperacion.estado.fase, "llamar");
  assert.equal(ev.decision.accion, "tarea_asesora");
  assert.equal(ev.decision.motivo, "recuperacion_72h");
  assert.equal(ev.decision.toque, "llamar");
  assert.equal(ev.decision.prioridad, "B");
  assert.equal(ev.decision.supresion, "ninguna");
  assert.match(ev.decision.mensajeSugerido, /te habla \[tu nombre\], de Magilus/);
  assert.equal(ev.decision.recuperacion.entradaEn, ENTRADA.toISOString());
  // Llamó y no contestó → audio.
  const llamada = { en: new Date(ENTRADA.getTime() + 20 * MIN), resultado: "no_contesto" };
  ev = evalR(ficha({ mensajes: CHARLA_C, llamadas: [llamada] }), new Date(ENTRADA.getTime() + 25 * MIN));
  assert.equal(ev.decision.toque, "audio");
  assert.equal(ev.decision.accion, "tarea_asesora");
  // Mandó el audio → espera 24 h (no es tarea).
  const audioMin = 12 + 72 * 60 + 30;
  const conAudio = [...CHARLA_C, AUDIO(audioMin)];
  ev = evalR(ficha({ mensajes: conAudio, llamadas: [llamada] }), new Date(ENTRADA.getTime() + 2 * H));
  assert.equal(ev.decision.accion, "esperar");
  assert.equal(ev.decision.toque, "espera");
  assert.equal(ev.recuperacion.estado.plazoEn.toISOString(), mas(audioMin * MIN + DIA).toISOString());
  // 24 h después del audio (viernes 9:42, horario laboral) → descartar.
  ev = evalR(ficha({ mensajes: conAudio, llamadas: [llamada] }), mas(audioMin * MIN + DIA + MIN));
  assert.equal(ev.decision.accion, "descartar");
  assert.equal(ev.decision.motivo, "recuperacion_72h");
  assert.equal(ev.decision.recuperacion.llamadaEn, llamada.en.toISOString());
});

prueba("C: si responde, se cancela (mensaje del cliente o llamada contestada)", () => {
  const llamada = { en: new Date(ENTRADA.getTime() + 20 * MIN), resultado: "no_contesto" };
  const respondio = [...CHARLA_C, AUDIO(12 + 72 * 60 + 30), IN(12 + 72 * 60 + 300, "Hola, sí, todavía lo quiero")];
  const ev = evalR(ficha({ mensajes: respondio, llamadas: [llamada] }), mas((12 + 72 * 60 + 301) * MIN));
  assert.equal(ev.recuperacion.tipo, "fuera");
  assert.equal(ev.recuperacion.motivo, "cliente_esperando");
  assert.notEqual(ev.decision.motivo, "recuperacion_72h");
  assert.equal(rc.cortoUnSilencioLargo(respondio, 72), true);
  // Llamada contestada (o "por registrar": hablaron) → recuperado.
  for (const resultado of ["interesada", "lo_piensa", "por_registrar"]) {
    const ev2 = evalR(ficha({ mensajes: CHARLA_C, llamadas: [{ en: new Date(ENTRADA.getTime() + 20 * MIN), resultado }] }), new Date(ENTRADA.getTime() + H));
    assert.equal(ev2.recuperacion.tipo, "recuperado", resultado);
    assert.notEqual(ev2.decision.motivo, "recuperacion_72h");
  }
});

prueba("C: sin evidencia no hay descarte (audio sin llamada registrada, o nada)", () => {
  // Audio sin llamada: con la llamada exigida (por defecto), sigue en "Llamar".
  const soloAudio = [...CHARLA_C, AUDIO(12 + 72 * 60 + 30)];
  let ev = evalR(ficha({ mensajes: soloAudio }), new Date(ENTRADA.getTime() + 3 * DIA));
  assert.equal(ev.decision.toque, "llamar");
  assert.notEqual(ev.decision.accion, "descartar");
  // Aunque no se exija la llamada para el audio, sin llamada registrada NO se descarta.
  const sinExigir = conRec("activo", { exigirLlamada: false });
  ev = evalR(ficha({ mensajes: soloAudio }), new Date(ENTRADA.getTime() + 2 * DIA), sinExigir);
  assert.equal(ev.recuperacion.estado.fase, "espera");
  assert.notEqual(ev.decision.accion, "descartar");
  // Nada hecho y pasó una semana: sigue la tarea, nunca descarte.
  ev = evalR(ficha({ mensajes: CHARLA_C }), new Date(ENTRADA.getTime() + 5 * DIA));
  assert.equal(ev.decision.toque, "llamar");
});

prueba("C: intención fuerte → prioridad A, nunca descarte solo: segunda llamada en otra franja y aprobación", () => {
  const fuerte = [IN(0, ANUNCIO), BOT(0.2, "Bienvenid@"), IN(5, "Me gusta, ¿cómo hago para separarlo?"), ASESORA(12, "¡Hola Laura! Se separa con el 50 %")];
  const llamada = { en: new Date(ENTRADA.getTime() + 20 * MIN), resultado: "no_contesto" }; // 9:32 (mañana)
  const audioMin = 12 + 72 * 60 + 30;
  const msgs = [...fuerte, AUDIO(audioMin)];
  let ev = evalR(ficha({ mensajes: fuerte }), new Date(ENTRADA.getTime() + 5 * MIN));
  assert.equal(ev.decision.prioridad, "A");
  assert.equal(ev.recuperacion.estado.fuerte, true);
  // 24 h después del audio: segunda llamada (no descarte), en la otra franja (la primera fue de mañana → 14:00).
  const plazo = mas(audioMin * MIN + DIA);
  ev = evalR(ficha({ mensajes: msgs, llamadas: [llamada] }), new Date(plazo.getTime() + MIN));
  assert.equal(ev.recuperacion.estado.fase, "llamar_2");
  assert.equal(ev.decision.accion, "esperar"); // todavía no son las 2 p. m.
  assert.equal(ev.recuperacion.estado.venceTarea.toISOString(), "2026-10-16T19:00:00.000Z"); // viernes 14:00 Bogotá
  ev = evalR(ficha({ mensajes: msgs, llamadas: [llamada] }), new Date("2026-10-16T19:05:00Z"));
  assert.equal(ev.decision.accion, "tarea_asesora");
  assert.equal(ev.decision.toque, "llamar_2");
  assert.match(ev.decision.mensajeSugerido, /50 %/);
  assert.doesNotMatch(ev.decision.mensajeSugerido, /contraentrega|env[ií]o gratis/i);
  // Segunda llamada sin contestar → pendiente de aprobación. Ni una semana después descarta solo.
  const segunda = { en: new Date("2026-10-16T19:10:00Z"), resultado: "no_contesto" };
  ev = evalR(ficha({ mensajes: msgs, llamadas: [llamada, segunda] }), new Date("2026-10-16T19:15:00Z"));
  assert.equal(ev.decision.toque, "aprobacion");
  assert.equal(ev.decision.accion, "esperar");
  ev = evalR(ficha({ mensajes: msgs, llamadas: [llamada, segunda] }), new Date("2026-10-22T15:00:00Z"));
  assert.notEqual(ev.decision.accion, "descartar");
  // Otras señales fuertes: cotización enviada, caliente, mandó datos.
  assert.equal(rc.intencionFuerte({ senales: [], temperaturaBase: "TIBIO", etapaCrm: "PROPUESTA", cotizacionEn: mas(H), mensajes: [], inicio: T0 }).fuerte, true);
  assert.equal(rc.intencionFuerte({ senales: [], temperaturaBase: "TIBIO", etapaCrm: "NEGOCIACION", cotizacionEn: null, mensajes: [], inicio: T0 }).fuerte, true);
  assert.equal(rc.intencionFuerte({ senales: [{ tipo: "eligio_color", grupo: "fuerte" }], temperaturaBase: "TIBIO", etapaCrm: "PROPUESTA", cotizacionEn: null, mensajes: [], inicio: T0 }).fuerte, false);
});

prueba("C: fuera de horario / domingo: la tarea y el descarte esperan la apertura (8:00, lunes a sábado)", () => {
  // Silencio que empieza el jueves 15-oct 4 p. m. → 72 h = domingo 18-oct 4 p. m. → tarea el lunes 8:00.
  const jueves = (new Date("2026-10-15T21:00:00Z").getTime() - T0.getTime()) / MIN;
  const msgs = [IN(jueves - 20, ANUNCIO), BOT(jueves - 19.8, "Bienvenid@"), IN(jueves - 10, "¿Precio?"), ASESORA(jueves, "Está en $989.000")];
  const domingo = new Date("2026-10-18T21:05:00Z");
  let ev = evalR(ficha({ mensajes: msgs }), domingo);
  assert.equal(ev.recuperacion.estado.fase, "llamar");
  assert.equal(ev.decision.accion, "esperar");
  assert.equal(ev.decision.vence.toISOString(), "2026-10-19T13:00:00.000Z"); // lunes 8:00 Bogotá
  // El plazo del audio vence un sábado 7 p. m.: el descarte espera al lunes 8:00.
  const llamada = { en: new Date("2026-10-16T14:00:00Z"), resultado: "no_contesto" };
  const conAudio = [...CHARLA_C, { ...AUDIO(0), en: new Date("2026-10-17T00:00:00Z") }]; // viernes 7 p. m.
  ev = evalR(ficha({ mensajes: conAudio, llamadas: [{ ...llamada, en: new Date("2026-10-16T23:50:00Z") }] }), new Date("2026-10-18T00:30:00Z")); // sábado 7:30 p. m.
  assert.equal(ev.recuperacion.estado.fase, "espera");
  assert.equal(ev.recuperacion.estado.revisarEn.toISOString(), "2026-10-19T13:00:00.000Z");
  ev = evalR(ficha({ mensajes: conAudio, llamadas: [{ ...llamada, en: new Date("2026-10-16T23:50:00Z") }] }), new Date("2026-10-18T15:00:00Z")); // domingo 10 a. m.
  assert.notEqual(ev.decision.accion, "descartar");
  ev = evalR(ficha({ mensajes: conAudio, llamadas: [{ ...llamada, en: new Date("2026-10-16T23:50:00Z") }] }), new Date("2026-10-19T13:05:00Z")); // lunes 8:05
  assert.equal(ev.decision.accion, "descartar");
});

prueba("C: solo mandó el anuncio, cotización vigente, cerrada a mano, PERDIDO o fuera de la ventana → no entra", () => {
  const anuncio = [IN(0, ANUNCIO), BOT(0.2, "Bienvenid@"), ASESORA(12, "Hola, soy Ingrid")];
  const t = new Date(ENTRADA.getTime() + H);
  assert.equal(evalR(ficha({ mensajes: anuncio }), t).recuperacion.motivo, "solo_mando_el_anuncio");
  assert.equal(evalR(ficha({ mensajes: anuncio }), t, conRec("activo", { soloConversaron: false })).recuperacion.tipo, "dentro");
  const cot = ficha({ mensajes: CHARLA_C, cotizacion: { en: mas(12 * MIN), ref: "COT-1", total: "$989.000" } });
  assert.equal(evalR(cot, t).recuperacion.motivo, "cotizacion_vigente");
  const cerrada = ficha({ mensajes: CHARLA_C, recuperacionesCerradas: [ENTRADA.toISOString().slice(0, 16)] });
  assert.equal(evalR(cerrada, t).recuperacion.motivo, "cerrada_a_mano");
  assert.equal(evalR(ficha({ mensajes: CHARLA_C, etapaCrm: "PERDIDO" }), t).recuperacion.motivo, "etapa_cerrada");
  // Callado hace más de diasMaximos (7) sin ningún intento: al prender no se barre el historial.
  assert.equal(evalR(ficha({ mensajes: CHARLA_C }), new Date(ENTRADA.getTime() + 8 * DIA)).recuperacion.motivo, "fuera_de_la_ventana");
});

prueba("C: en SOMBRA la decisión del lead no cambia; la recuperación se evalúa aparte", () => {
  const sombra = conRec("sombra");
  const t = new Date(ENTRADA.getTime() + H);
  const ev = evalR(ficha({ mensajes: CHARLA_C }), t, sombra);
  assert.equal(ev.recuperacion.tipo, "dentro");
  assert.equal(ev.recuperacion.estado.fase, "llamar");
  const sinRec = evalR(ficha({ mensajes: CHARLA_C }), t, cf.leerConfigDeTexto(JSON.stringify({ calificacion: { activo: true }, motor: { modo: "sombra" } })));
  assert.deepEqual(ev.decision, sinRec.decision);
});

prueba("C: APAGADA (por defecto) = exactamente como hoy", () => {
  assert.equal(cf.CONFIG_POR_DEFECTO.recuperacion72h.modo, "apagado");
  assert.equal(cf.algoPrendido(cf.leerConfigDeTexto(null)), false);
  assert.equal(cf.algoPrendido(cf.leerConfigDeTexto('{"recuperacion72h":{"modo":"sombra"}}')), true);
  assert.equal(cf.algoPrendido(cf.leerConfigDeTexto('{"trasAsesora":{"modo":"sombra"}}')), true);
  const hoy = cf.leerConfigDeTexto(JSON.stringify({ calificacion: { activo: true }, motor: { modo: "activo" }, cadencia: { descarte: "activo" } }));
  const casos = [
    ficha({ mensajes: CHARLA_C, pausado: false }),
    ficha({ mensajes: [...CHARLA_C, AUDIO(12 + 72 * 60 + 30)], llamadas: [{ en: new Date(ENTRADA.getTime() + 20 * MIN), resultado: "no_contesto" }] }),
    ficha({ mensajes: [IN(0, ANUNCIO), BOT(0.2, "Bienvenid@")] }),
  ];
  for (const f of casos) {
    for (const t of [new Date(ENTRADA.getTime() + H), new Date(ENTRADA.getTime() + 2 * DIA), new Date(ENTRADA.getTime() + 6 * DIA)]) {
      const ev = evalR(f, t, hoy);
      assert.equal(ev.recuperacion, null);
      assert.notEqual(ev.decision.motivo, "recuperacion_72h");
    }
  }
  // Con la recuperación activa, la cadencia vieja no descarta por su cuenta a quien conversó.
  const conCadencia = ficha({ pausado: false, mensajes: [IN(0, ANUNCIO), BOT(0.2, "fotos"), IN(5, "¿hacen envíos a Cali?"), ASESORA(10, "Hola, sí enviamos a Cali"), ASESORA(10 + 3 * 1440 + 90, "?"), ASESORA(10 + 4 * 1440 + 60, "?"), ASESORA(10 + 7 * 1440 + 60, "?")] });
  const t8 = mas(10 * MIN + 8 * DIA + 2 * H);
  assert.equal(evalR(conCadencia, t8, hoy).decision.accion, "descartar");
  const conRecActiva = cf.leerConfigDeTexto(JSON.stringify({ calificacion: { activo: true }, motor: { modo: "activo" }, cadencia: { descarte: "activo" }, recuperacion72h: { modo: "activo", diasMaximos: 1 } }));
  assert.notEqual(evalR(conCadencia, t8, conRecActiva).decision.motivo, "sin_respuesta_tras_3_seguimientos");
});

prueba("C: la recuperación nunca frena un genérico, y el Supervisor la sigue avisando con turno del cliente", () => {
  const base = { motorActivo: true, exteriorActivo: false, esExterior: false, motor: "v3", convivencia: cf.CONFIG_POR_DEFECTO.convivencia };
  assert.equal(cv.decidirConvivencia({ ...base, accion: "tarea_asesora", supresion: "ninguna", motivo: "recuperacion_72h" }), null);
  assert.equal(cv.decidirConvivencia({ ...base, accion: "tarea_asesora", supresion: "siempre", motivo: "tibio_sin_asesora" }), "inteligente_tarea_humana");
  assert.equal(turno.tareaSigueConTurnoDelCliente("recuperacion_72h", "B"), true);
});

prueba("C: guion del audio y mensaje con la cifra: cortos, tuteo, sin frases prohibidas", () => {
  const guion = rc.guionDeAudio({ nombre: "laura gómez", producto: "combo de camilla", frase: "¿Cuánto vale y hacen envíos a Cali?" });
  assert.match(guion, /^Hola Laura, te habla \[tu nombre\], de Magilus/);
  assert.match(guion, /Cuánto vale/);
  assert.deepEqual(redaccion.frasesProhibidas(guion), []);
  const cifra = rc.mensajeConCifra({ nombre: "Laura", producto: "combo de camilla", total: "$989.000" });
  assert.deepEqual(redaccion.frasesProhibidas(cifra), []);
  assert.match(cifra, /\$989\.000/);
});

prueba("C: excedente de Ingrid sobre el tope de 15 → se REPARTE con la rueda; sin cupo, se pospone", () => {
  const rueda = ["ingrid", "maria", "genesis"];
  const ahora = new Date("2026-10-15T15:00:00Z");
  const tareas = Array.from({ length: 19 }, (_, i) => ({
    conversationId: `rec${String(i).padStart(2, "0")}`,
    prioridad: "B",
    temperatura: "TIBIO",
    vence: new Date(ahora.getTime() - (20 - i) * MIN),
    duena: "ingrid",
    elegibles: rueda,
    rueda: true,
  }));
  const planes = tp.planearTareas({ tareas, tope: 15, ahora });
  const de = (para, estado) => planes.filter((p) => p.para === para && p.estado === estado).length;
  assert.equal(de("ingrid", "propia"), 15);
  // La rueda: María, Génesis, María, Génesis (no "la de menos carga" siempre).
  assert.deepEqual(planes.filter((p) => p.estado === "redistribuida").map((p) => p.para), ["maria", "genesis", "maria", "genesis"]);
  // Prioridad A primero: con 16 tareas y una A, la A queda con su dueña.
  const conA = [...tareas.slice(0, 15), { ...tareas[15], prioridad: "A", conversationId: "recA" }];
  const p2 = tp.planearTareas({ tareas: conA, tope: 15, ahora });
  assert.equal(p2.find((p) => p.conversationId === "recA").estado, "propia");
  // Todas llenas → pospuesta (nunca se pierde).
  const llenas = tp.planearTareas({ tareas: tareas.slice(0, 2), tope: 1, ahora: ahora });
  assert.deepEqual(llenas.map((p) => p.estado), ["propia", "redistribuida"]);
  const sinNadie = tp.planearTareas({ tareas: tareas.slice(0, 2).map((t) => ({ ...t, elegibles: ["ingrid"] })), tope: 1, ahora });
  assert.deepEqual(sinNadie.map((p) => p.estado), ["propia", "pospuesta"]);
  assert.equal(tp.siguienteDeLaRueda(rueda, "genesis", () => true), "ingrid");
});

console.log(`\n${pruebas} pruebas de la Recuperación 72 h, los automáticos tras la asesora y el tope 3: OK`);
