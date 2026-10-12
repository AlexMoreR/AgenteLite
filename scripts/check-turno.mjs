// Pruebas del TURNO DE LA CONVERSACIÓN (src/lib/turno-de-la-conversacion.ts) y de su uso en el
// Supervisor (detectores de atención y pantalla), el Supervisor accionable (avisos / escaladas), el
// seguimiento inteligente (tareas de la asesora) y las tareas sin asesora. Sin base ni red.
// Correr: npm run test:turno
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

const t = cargar("src/lib/turno-de-la-conversacion.ts");
const det = cargar("src/features/supervisor/dominio/detectores-atencion.ts");
const tsd = cargar("src/features/supervisor/dominio/tareas-sin-duena.ts");
const r = cargar("src/features/supervisor-accionable/dominio/reglas.ts");
const mo = cargar("src/features/seguimiento-inteligente/dominio/motor.ts");
const cf = cargar("src/features/seguimiento-inteligente/dominio/config.ts");
const datos = cargar("src/features/supervisor/servicios/datos.ts", {
  "@/lib/prisma": { prisma: {} },
  "@/features/agente-v3/servicios/almacen": { leerHistorialDelLibro: async () => [], leerLibro: async () => ({}) },
  "@/features/embudo/servicios/config": { leerConfigEmbudo: async () => ({}) },
  "@/lib/agent-product-flow": { getFlowReply: async () => null },
});

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const MIN = 60_000;
// Lunes 12-oct-2026, 9:18 a. m. de Bogotá = 14:18 UTC (caso real •••• 5474).
const T0 = new Date("2026-10-12T14:18:01Z");
const en = (min) => new Date(T0.getTime() + min * MIN);
const IN = (min, texto) => ({ direccion: "IN", tipo: "TEXT", origen: "webhook", texto, en: en(min) });
const BOT = (min, texto) => ({ direccion: "OUT", tipo: "TEXT", origen: null, texto, en: en(min) });
const ASESORA = (min, texto) => ({ direccion: "OUT", tipo: "TEXT", origen: "manual", texto, en: en(min) });
const CELULAR = (min, texto) => ({ direccion: "OUT", tipo: "TEXT", origen: "instance", texto, en: en(min) });
const AUTO = (min, texto) => ({ direccion: "OUT", tipo: "TEXT", origen: "follow", texto, en: en(min) });
const NOTA = (min, texto) => ({ direccion: "OUT", tipo: "SYSTEM", origen: "activity", texto, en: en(min) });
const LLAMADA = (min, direccion, texto) => ({ direccion, tipo: "SYSTEM", origen: "llamada", texto, en: en(min) });
const SIN = { caliente: false, asignada: false };

const BIENVENIDA = "Bienvenid@ a *Magilus* 👑 Fabricantes de mobiliario para peluquerías…";
const PRECIO_COMBO = "El *Combo Camillas* está en *$989.000* 💆 (camilla, escalera, silla y auxiliar), con *garantía de 1 año*.  ¿Te comparto las *fotos* y en qué *ciudad* estás para confirmarte el envío?";
const NOTA_PRECIO = 'Agente V3: Ganó "Pide precio en el primer mensaje: activar el combo y dar el precio de una vez" porque el cliente dijo "precio" o "cuanto vale"';

/* ------------------------------------------------------------------------------------------------
   1. LA FUNCIÓN DEL TURNO
------------------------------------------------------------------------------------------------ */

const CASO_5474 = [IN(0, "Hola precio"), BOT(0.2, BIENVENIDA), BOT(0.25, PRECIO_COMBO), NOTA(0.26, NOTA_PRECIO)];
// •••• 4086 (11-oct): anuncio → bot → seguimiento → "Que precio" → auto-asignado a Ingrid → bot precio + ciudad.
const CASO_4086 = [
  IN(-800, "Hola, me interesa el COMBO de estética (camilla, escalera, silla y auxiliar)"),
  BOT(-799.7, BIENVENIDA),
  BOT(-799.6, "¿Qué servicios vas a ofrecer en tu espacio?"),
  NOTA(-799.6, 'Agente V3: Ganó "Llega del anuncio del combo…" porque el cliente dijo "…"'),
  AUTO(-60, "Así se ve el *combo armado*…"),
  IN(0, "Que precio"),
  NOTA(0.01, "Ingrid Sanchez auto-asignado a esta conversación"),
  BOT(0.25, "El *Combo Camillas* está en *$989.000* 💆 … ¿En qué *ciudad* estás para confirmarte el envío?"),
  NOTA(0.26, 'Agente V3: Ganó "Precio del combo (genérica: va SIEMPRE al final del libro)" porque el cliente dijo "precio"'),
];

prueba('"Hola precio" + el bot da el precio y pregunta (caso 5474) → turno del CLIENTE', () => {
  const turno = t.turnoDeLaConversacion(CASO_5474, SIN);
  assert.equal(turno.de, "CLIENTE");
  assert.equal(turno.motivo, "respondio_el_bot");
  assert.equal(turno.respondioEn.toISOString(), en(0.2).toISOString());
  // El orden de entrada no importa.
  assert.equal(t.turnoDeLaConversacion([...CASO_5474].reverse(), SIN).de, "CLIENTE");
});

prueba('"Que precio" tras un seguimiento, asignado, el bot da precio + ciudad (caso 4086) → CLIENTE', () => {
  const turno = t.turnoDeLaConversacion(CASO_4086, { caliente: false, asignada: true, tuvoContactoHumano: false });
  assert.equal(turno.de, "CLIENTE");
  assert.equal(turno.motivo, "respondio_el_bot");
});

prueba("el cliente escribió y nadie respondió → MAGILUS (sin_respuesta); un seguimiento automático no es respuesta", () => {
  assert.deepEqual(
    (({ de, motivo }) => ({ de, motivo }))(t.turnoDeLaConversacion([BOT(-60, "hola"), IN(0, "Hola precio")], SIN)),
    { de: "MAGILUS", motivo: "sin_respuesta" },
  );
  assert.equal(t.turnoDeLaConversacion([IN(0, "Cuánto vale el envío?"), AUTO(30, "¿Sigues interesada?")], SIN).motivo, "sin_respuesta");
  // Una nota sola tampoco es respuesta.
  assert.equal(t.turnoDeLaConversacion([IN(0, "Hola"), NOTA(0.1, "Ingrid Sanchez auto-asignado a esta conversación")], SIN).de, "MAGILUS");
});

prueba("el bot respondió pero pidió asesora → MAGILUS (bot_pidio_asesora)", () => {
  const casos = [
    "El agente pide un asesor: El cliente preguntó algo que el agente no tiene",
    "El agente pide un asesor: El agente iba a repetir un mensaje que ya envió y no tiene nada nuevo que decir",
    'Agente V3: Ganó "Precio del combo (genérica)" porque el cliente dijo "precio". Pero ese mensaje ya se había enviado en esta conversación, así que se avisó a un asesor en vez de repetirlo.',
    "Agente V3: Respondió el redactor y, como faltaba un dato, avisó a una asesora para confirmarlo.",
    'Agente V3: Ganó "Manda foto o captura de un producto y pregunta el precio: no es el combo, pasar a la asesora" porque la clienta mandó una foto',
  ];
  for (const nota of casos) {
    const turno = t.turnoDeLaConversacion([IN(0, "y la de 2 metros?"), BOT(0.2, "Ya te confirmo 🙌"), NOTA(0.21, nota)], SIN);
    assert.equal(turno.de, "MAGILUS", nota);
    assert.equal(turno.motivo, "bot_pidio_asesora", nota);
  }
});

prueba("el bot PROMETIÓ una asesora en su texto, o solo saludó sin regla → MAGILUS (casos de la simulación)", () => {
  const promesa = t.turnoDeLaConversacion([IN(0, "Hola, me interesa el COMBO de estética"), BOT(0.2, "En un momento una de nuestras asesoras te contacta 🙌")], SIN);
  assert.equal(promesa.de, "MAGILUS");
  assert.equal(promesa.motivo, "bot_pidio_asesora");
  const saludo = t.turnoDeLaConversacion([IN(0, "Hola, manejas catálogo?"), BOT(0.2, BIENVENIDA), NOTA(0.21, "Agente V3: Sale el saludo del primer mensaje; ninguna otra regla encajó.")], SIN);
  assert.equal(saludo.motivo, "bot_no_entendio");
  // Una llamada entrante de 0 s es una llamada perdida.
  assert.equal(t.turnoDeLaConversacion([IN(0, "Hola"), BOT(0.2, "¡Hola!"), LLAMADA(5, "IN", "Llamada entrante · 0s")], SIN).motivo, "llamada_perdida");
  assert.equal(t.turnoDeLaConversacion([IN(0, "Hola"), BOT(0.2, "¡Hola!"), LLAMADA(5, "IN", "Llamada entrante · 46s")], SIN).motivo, "respondio_persona");
});

prueba("el bot respondió con la red / fuera del libro → MAGILUS (bot_no_entendio)", () => {
  for (const nota of [
    'Agente V3: Ganó "Red del paso OBJECIONES: no se entendió, ofrecer los datos clave" porque no había ninguna regla más específica.',
    'Agente V3: Ganó "Pregunta algo que no está en el libro: pasar a un asesor en vez de repetirse" porque lo que pidió encaja con "…"',
    "Agente V3: Respondió el redactor: ninguna regla del libro aplicaba.",
  ]) {
    const turno = t.turnoDeLaConversacion([IN(0, "y eso viene con garantia de la tapiceria x2"), BOT(0.2, "…"), NOTA(0.21, nota)], SIN);
    assert.equal(turno.de, "MAGILUS", nota);
  }
  // "Pregunta algo que no está en el libro" pide asesora (gana la primera regla que aplica).
  const fuera = t.turnoDeLaConversacion([IN(0, "x"), BOT(0.2, "…"), NOTA(0.21, 'Agente V3: Ganó "Pregunta algo que no está en el libro: pasar a un asesor en vez de repetirse" porque…')], SIN);
  assert.equal(fuera.motivo, "bot_pidio_asesora");
});

prueba('"ya pagué" / comprobante aunque el bot respondió → MAGILUS (senal_fuerte)', () => {
  for (const texto of ["Ya pagué, te mando el comprobante", "ya consigne", "Cómo hago para separarlo?", "a qué cuenta consigno el anticipo", "Me lo llevo", "en negro porfa", "Llámame por favor", "quiero hablar con una asesora"]) {
    const turno = t.turnoDeLaConversacion([IN(0, texto), BOT(0.2, "¡Gracias! 🙌")], SIN);
    assert.equal(turno.de, "MAGILUS", texto);
    assert.equal(turno.motivo, "senal_fuerte", texto);
  }
  // Mira toda la última tanda (no solo el último mensaje).
  assert.equal(t.turnoDeLaConversacion([IN(0, "ya pagué"), IN(0.1, "👍"), BOT(0.2, "…")], SIN).motivo, "senal_fuerte");
  // Lo de una tanda anterior, ya contestada, no cuenta.
  assert.equal(t.turnoDeLaConversacion([IN(-30, "cómo separo?"), BOT(-29, "Con el 50 %"), IN(0, "ok gracias"), BOT(0.2, "¡A ti!")], SIN).de, "CLIENTE");
});

prueba("mandó el formulario / sus datos aunque el bot respondió → MAGILUS", () => {
  const datosDeCompra = "Nombre: Laura Gómez\nCédula: 1234567890\nDirección: Cra 10 # 20-30\nCiudad: Pasto\nTeléfono: 3001234567";
  const turno = t.turnoDeLaConversacion([ASESORA(-60, "Para separarlo me regalas: Nombre, Cédula, Dirección, Ciudad"), IN(0, datosDeCompra), BOT(0.2, "¡Gracias!")], SIN);
  assert.equal(turno.de, "MAGILUS");
  assert.equal(turno.motivo, "senal_fuerte");
  assert.equal(t.mandoSusDatos("Laura Gómez\n1234567890\nPasto barrio centro"), true);
  assert.equal(t.mandoSusDatos("Hola precio"), false);
});

prueba("caliente asignado que nunca tuvo contacto humano → MAGILUS aunque el bot contestó (regla d)", () => {
  const charla = [IN(0, "me gusta el de las fotos"), BOT(0.2, "¡Excelente! ¿En qué ciudad estás?")];
  assert.equal(t.turnoDeLaConversacion(charla, { caliente: true, asignada: true, tuvoContactoHumano: false }).motivo, "caliente_sin_humano");
  // Ya le escribió una persona antes → la cadencia normal (turno del cliente).
  assert.equal(t.turnoDeLaConversacion(charla, { caliente: true, asignada: true, tuvoContactoHumano: true }).de, "CLIENTE");
  // Sin asesora también (ampliada con los datos del 12-oct: calientes sin dueña desaparecían).
  assert.equal(t.turnoDeLaConversacion(charla, { caliente: true, asignada: false, tuvoContactoHumano: false }).motivo, "caliente_sin_humano");
  // Sin el dato, se mira en los eventos.
  assert.equal(t.turnoDeLaConversacion([CELULAR(-90, "Hola, soy Ingrid"), ...charla], { caliente: true, asignada: true }).de, "CLIENTE");
});

prueba("la asesora respondió y el cliente calló → CLIENTE (respondio_persona), aunque traiga señal fuerte", () => {
  assert.equal(t.turnoDeLaConversacion([IN(0, "Cuánto vale el envío a Pasto?"), ASESORA(5, "El envío a Pasto es $60.000")], SIN).motivo, "respondio_persona");
  assert.equal(t.turnoDeLaConversacion([IN(0, "ya pagué"), CELULAR(5, "Recibido, ya lo verifico")], SIN).de, "CLIENTE");
  // Una llamada saliente también es respuesta de una persona.
  assert.equal(t.turnoDeLaConversacion([IN(0, "llámame"), LLAMADA(5, "OUT", "Llamada saliente · 42s")], SIN).de, "CLIENTE");
});

prueba("llamada entrante perdida después de nuestra respuesta → MAGILUS; cliente que nunca escribió → CLIENTE", () => {
  const turno = t.turnoDeLaConversacion([IN(0, "Hola"), BOT(0.2, "¡Hola! ¿Qué buscas?"), LLAMADA(10, "IN", "Llamada entrante · perdida")], SIN);
  assert.equal(turno.de, "MAGILUS");
  assert.equal(turno.motivo, "llamada_perdida");
  assert.equal(t.turnoDeLaConversacion([BOT(0, "Hola")], SIN).motivo, "cliente_no_ha_escrito");
  assert.equal(t.turnoDeLaConversacion([], SIN).de, "CLIENTE");
});

prueba("interruptor: sin fila / JSON roto = APAGADO; las opciones se leen", () => {
  assert.deepEqual(t.leerConfigTurnoDeTexto(null), t.CONFIG_TURNO_APAGADO);
  assert.equal(t.leerConfigTurnoDeTexto("{roto").activo, false);
  assert.deepEqual(t.leerConfigTurnoDeTexto('{"activo":true}'), { activo: true, cadenciaSinTarea: true, asignadoSinRespuesta: "turno" });
  assert.deepEqual(t.leerConfigTurnoDeTexto('{"activo":true,"cadenciaSinTarea":false,"asignadoSinRespuesta":"siempre"}'), {
    activo: true,
    cadenciaSinTarea: false,
    asignadoSinRespuesta: "siempre",
  });
  assert.equal(t.claveConfigTurno("ws1"), "turno:config:ws1");
});

prueba("la fila de la base (JSON de Postgres sin zona = UTC) da el mismo turno", () => {
  const fila = {
    eventos: [
      { d: "INBOUND", t: "TEXT", o: "webhook", x: "Hola precio", en: "2026-10-12T14:18:01.509" },
      { d: "OUTBOUND", t: "TEXT", o: null, x: BIENVENIDA, en: "2026-10-12T14:18:15.987" },
      { d: "OUTBOUND", t: "TEXT", o: null, x: PRECIO_COMBO, en: "2026-10-12T14:18:16.695" },
      { d: "OUTBOUND", t: "SYSTEM", o: "activity", x: NOTA_PRECIO, en: "2026-10-12T14:18:17.272" },
    ],
    etapa: "NUEVO",
    temperatura: "TIBIO",
    asesoraId: null,
    ultimaRespuestaHumanaEn: null,
    textos: ["Hola precio"],
  };
  const turno = datos.turnoDeLaFila(fila);
  assert.equal(turno.de, "CLIENTE");
  assert.equal(turno.ultimoClienteEn.toISOString(), "2026-10-12T14:18:01.509Z");
});

/* ------------------------------------------------------------------------------------------------
   2. SUPERVISOR: DETECTORES DE ATENCIÓN Y PANTALLA
------------------------------------------------------------------------------------------------ */

function chat5474(conTurno) {
  const chat = {
    conversationId: "cv8f2c379f2661fb767c52692e",
    asesoraId: null,
    etapa: "NUEVO",
    ultimoClienteEn: T0,
    ultimaRespuestaHumanaEn: null,
    textosPendientes: ["Hola precio"],
    textosDelCliente: ["Hola precio"],
    telefono: "573000005474",
    temperatura: "TIBIO",
  };
  return conTurno ? { ...chat, turno: t.turnoDeLaConversacion(CASO_5474, SIN) } : chat;
}
function chat4086(conTurno) {
  const chat = {
    conversationId: "cvdfbb32f74603e46b9ad6df46",
    asesoraId: "ingrid",
    asesoraNombre: "Ingrid Sanchez",
    etapa: "NUEVO",
    ultimoClienteEn: T0,
    ultimaRespuestaHumanaEn: null,
    textosPendientes: ["Hola, me interesa el COMBO de estética (camilla, escalera, silla y auxiliar)", "Que precio"],
    textosDelCliente: ["Que precio", "Hola, me interesa el COMBO de estética (camilla, escalera, silla y auxiliar)"],
    telefono: "573000004086",
    asignadaEn: en(0.01),
    temperatura: "TIBIO",
  };
  return conTurno ? { ...chat, turno: t.turnoDeLaConversacion(CASO_4086, { caliente: false, asignada: true, tuvoContactoHumano: false }) } : chat;
}
/** Un chat que de verdad espera: preguntó cómo separar y nadie respondió. */
function chatQueEspera(conTurno) {
  const chat = {
    conversationId: "cvespera000000000000000001",
    asesoraId: null,
    etapa: "NUEVO",
    ultimoClienteEn: T0,
    ultimaRespuestaHumanaEn: null,
    textosPendientes: ["Cómo hago para separarlo?"],
    textosDelCliente: ["Cómo hago para separarlo?"],
    telefono: "573000001111",
  };
  return conTurno ? { ...chat, turno: t.turnoDeLaConversacion([IN(0, "Cómo hago para separarlo?")], SIN) } : chat;
}

const A_LAS_928 = en(10); // 9:28 a. m., cuando salió "señal sin dueña".

prueba("caso 5474: HOY sale 'señal sin dueña'; con el turno ya NO", () => {
  const hoy = det.detectarAtencion([chat5474(false)], A_LAS_928);
  assert.ok(hoy.some((h) => h.clave === "ATENCION:senal-sin-duena"), "sin el turno (= hoy) sí sale");
  const despues = det.detectarAtencion([chat5474(true)], A_LAS_928);
  assert.equal(despues.length, 0);
  assert.equal(det.estadoDeEspera(chat5474(true), A_LAS_928).esperando, false);
});

prueba("un chat que de verdad espera SIGUE saliendo con el turno prendido", () => {
  const conTurno = det.detectarAtencion([chatQueEspera(true)], A_LAS_928);
  const sinTurno = det.detectarAtencion([chatQueEspera(false)], A_LAS_928);
  assert.deepEqual(conTurno.map((h) => h.clave), sinTurno.map((h) => h.clave));
  assert.ok(conTurno.some((h) => h.clave === "ATENCION:senal-sin-duena"));
});

prueba("caso 4086: 'asignado sin respuesta' sale hoy y con el turno NO (salvo asignadoSinRespuesta=siempre)", () => {
  const tarde = en(60); // 10:18, 60 min laborales después de la asignación.
  assert.ok(det.detectarAtencion([chat4086(false)], tarde).some((h) => h.clave.startsWith("ATENCION:asignado-sin-respuesta:")));
  assert.equal(det.detectarAtencion([chat4086(true)], tarde).length, 0);
  assert.ok(
    det.detectarAtencion([chat4086(true)], tarde, undefined, { asignadoIgnoraTurno: true }).some((h) => h.clave.startsWith("ATENCION:asignado-sin-respuesta:")),
  );
  // Un caliente asignado sin humano (regla d) sí sigue saliendo.
  const caliente = { ...chat4086(false), temperatura: "CALIENTE" };
  caliente.turno = t.turnoDeLaConversacion(CASO_4086, { caliente: true, asignada: true, tuvoContactoHumano: false });
  assert.equal(caliente.turno.de, "MAGILUS");
  assert.ok(det.detectarAtencion([caliente], tarde).length > 0);
});

/* ------------------------------------------------------------------------------------------------
   3. SUPERVISOR ACCIONABLE: avisos, segundo aviso, escalada y pantalla de fuera de horario
------------------------------------------------------------------------------------------------ */

const CONFIG_ACC = r.leerConfigAccionableDeTexto(JSON.stringify({ activo: true, supervisoraId: "ingrid" }));
const INGRID = { id: "ingrid", nombre: "Ingrid Sanchez" };

function vuelta(estado, chats, ahora) {
  const hallazgos = det.detectarAtencion(chats, ahora);
  const candidatas = r.candidatasDeLaVuelta({ hallazgos, chats, ahora, supervisora: INGRID });
  return r.avanzar({ estado, candidatas, chats, atendidas: {}, ahora, config: CONFIG_ACC, supervisora: INGRID });
}

prueba("caso 5474 en el accionable: HOY aviso 9:28 → segundo aviso → escalada; con el turno, nada", () => {
  let hoy = r.estadoVacio();
  let eventosHoy = [];
  for (let m = 10; m <= 45; m += 5) {
    const { estado, eventos } = vuelta(hoy, [chat5474(false)], en(m));
    hoy = estado;
    eventosHoy = eventosHoy.concat(eventos);
  }
  assert.ok(eventosHoy.some((e) => e.tipo === "avisar"), "hoy: aviso a Ingrid");
  let con = r.estadoVacio();
  let eventosCon = [];
  for (let m = 10; m <= 45; m += 5) {
    const { estado, eventos } = vuelta(con, [chat5474(true)], en(m));
    con = estado;
    eventosCon = eventosCon.concat(eventos);
  }
  assert.equal(eventosCon.length, 0);
  assert.equal(Object.keys(con.acciones).length, 0);
});

prueba("una acción ya abierta (avisada o escalada) se cierra como YA_NO_APLICA cuando el turno pasa al cliente; un pago no", () => {
  const { estado } = vuelta(r.estadoVacio(), [chat5474(false)], A_LAS_928);
  assert.equal(estado.acciones[chat5474(false).conversationId].estado, "AVISADA");
  const sig = r.avanzar({ estado, candidatas: [], chats: [chat5474(true)], atendidas: {}, ahora: en(15), config: CONFIG_ACC, supervisora: INGRID });
  assert.equal(sig.estado.acciones[chat5474(false).conversationId].estado, "YA_NO_APLICA");
  assert.equal(sig.eventos.length, 0);
  const escalada = structuredClone(estado);
  escalada.acciones[chat5474(false).conversationId].estado = "ESCALADA";
  const sig2 = r.avanzar({ estado: escalada, candidatas: [], chats: [chat5474(true)], atendidas: {}, ahora: en(15), config: CONFIG_ACC, supervisora: INGRID });
  assert.equal(sig2.estado.acciones[chat5474(false).conversationId].estado, "YA_NO_APLICA");
  const pago = structuredClone(estado);
  pago.acciones[chat5474(false).conversationId].tipo = "pago";
  const sig3 = r.avanzar({ estado: pago, candidatas: [], chats: [chat5474(true)], atendidas: {}, ahora: en(15), config: CONFIG_ACC, supervisora: INGRID });
  assert.notEqual(sig3.estado.acciones[chat5474(false).conversationId].estado, "YA_NO_APLICA");
  // Sin el turno (interruptor apagado) sigue AVISADA, como hoy.
  const sig4 = r.avanzar({ estado, candidatas: [], chats: [chat5474(false)], atendidas: {}, ahora: en(15), config: CONFIG_ACC, supervisora: INGRID });
  assert.equal(sig4.estado.acciones[chat5474(false).conversationId].estado, "AVISADA");
});

prueba("pantalla 'clientes esperando fuera de horario': el 4086 sale hoy y con el turno no", () => {
  // Domingo 11-oct, 9:18 a. m. (fuera de horario L–S 8–18).
  const domingo = new Date("2026-10-11T14:18:00Z");
  const mover = (c) => ({ ...c, ultimoClienteEn: domingo, asignadaEn: domingo });
  const ahora = new Date(domingo.getTime() + 30 * MIN);
  const cfg = { ...CONFIG_ACC, fueraDeHorario: { ...(CONFIG_ACC.fueraDeHorario ?? {}), activo: true } };
  const hoy = r.esperandoFueraDeHorario({ chats: [mover(chat4086(false))], ahora, config: cfg, supervisora: INGRID });
  assert.equal(hoy.length, 1);
  const con = r.esperandoFueraDeHorario({ chats: [mover(chat4086(true))], ahora, config: cfg, supervisora: INGRID });
  assert.equal(con.length, 0);
});

/* ------------------------------------------------------------------------------------------------
   4. TAREAS SIN ASESORA
------------------------------------------------------------------------------------------------ */

prueba("tareas sin asesora: la del 5474 (tibio_sin_asesora, turno del cliente) sale; formulario / cotización / caliente / A siguen", () => {
  const tareas = [
    { conversationId: "c5474", prioridad: "B", vence: T0, motivo: "tibio_sin_asesora", nombre: "x" },
    { conversationId: "cform", prioridad: "B", vence: T0, motivo: "formulario_sin_respuesta", nombre: "x" },
    { conversationId: "ccot", prioridad: "A", vence: T0, motivo: "cotizacion_sin_respuesta", nombre: "x" },
    { conversationId: "ccal", prioridad: "A", vence: T0, motivo: "caliente_sin_asesora", nombre: "x" },
    { conversationId: "cfecha", prioridad: "B", vence: T0, motivo: "fecha_futura_cerca", nombre: "x" },
    { conversationId: "ccadA", prioridad: "A", vence: T0, motivo: "cadencia_sin_respuesta", nombre: "x" },
    { conversationId: "ccadB", prioridad: "B", vence: T0, motivo: "cadencia_sin_respuesta", nombre: "x" },
    { conversationId: "cespera", prioridad: "B", vence: T0, motivo: "tibio_sin_asesora", nombre: "x" },
    { conversationId: "cfuera", prioridad: "B", vence: T0, motivo: "tibio_sin_asesora", nombre: "x" },
  ];
  const cliente = { de: "CLIENTE", motivo: "respondio_el_bot" };
  const chats = ["c5474", "cform", "ccot", "ccal", "cfecha", "ccadA", "ccadB"].map((id) => ({ conversationId: id, turno: cliente }));
  chats.push({ conversationId: "cespera", turno: { de: "MAGILUS", motivo: "sin_respuesta" } });
  const quedan = tsd.tareasSinDuenaConTurno(tareas, chats).map((x) => x.conversationId);
  assert.deepEqual(quedan, ["cform", "ccot", "ccal", "cfecha", "ccadA", "cespera", "cfuera"]);
  // Sin el turno calculado (interruptor apagado) no se filtra nada.
  assert.equal(tsd.tareasSinDuenaConTurno(tareas, chats.map((c) => ({ conversationId: c.conversationId }))).length, tareas.length);
});

/* ------------------------------------------------------------------------------------------------
   5. SEGUIMIENTO INTELIGENTE: tarea_asesora
------------------------------------------------------------------------------------------------ */

const CONFIG_SI = cf.leerConfigDeTexto(JSON.stringify({ calificacion: { activo: true }, motor: { modo: "activo" }, cadencia: { descarte: "activo" } }));
const CONFIG_SI_TURNO = { ...CONFIG_SI, turno: { activo: true, cadenciaSinTarea: true } };
const MC = (e, leido = true) => ({ ...e, leidoEn: leido ? e.en : null, estado: e.direccion === "OUT" ? "READ" : null });

function ficha(parcial = {}) {
  return {
    conversationId: "cv8f2c379f2661fb767c52692e",
    nombre: null,
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

prueba("caso 5474 en el motor: HOY tarea tibio_sin_asesora a los 30 min; con el turno 'esperar' sin frenar los automáticos", () => {
  const f = ficha({ mensajes: CASO_5474.filter((e) => e.tipo !== "SYSTEM").map((e) => MC(e)), notas: CASO_5474.filter((e) => e.tipo === "SYSTEM").map((e) => MC(e)) });
  const hoy = mo.evaluarLead(f, CONFIG_SI, en(30)).decision;
  assert.equal(hoy.accion, "tarea_asesora");
  assert.equal(hoy.motivo, "tibio_sin_asesora");
  const con = mo.evaluarLead(f, CONFIG_SI_TURNO, en(30)).decision;
  assert.equal(con.accion, "esperar");
  assert.equal(con.motivo, "turno_del_cliente");
  assert.equal(con.supresion, "ninguna");
});

prueba("caso 4086 en el motor: con el turno ya no hay tarea tibio para Ingrid", () => {
  const f = ficha({
    asignadaA: "ingrid",
    mensajes: CASO_4086.filter((e) => e.tipo !== "SYSTEM").map((e) => MC(e)),
    notas: CASO_4086.filter((e) => e.tipo === "SYSTEM").map((e) => MC(e)),
  });
  const hoy = mo.evaluarLead(f, CONFIG_SI, en(40)).decision;
  const con = mo.evaluarLead(f, CONFIG_SI_TURNO, en(40)).decision;
  assert.equal(hoy.accion, "tarea_asesora");
  assert.equal(hoy.motivo, "tibio_sin_asesora");
  assert.equal(con.accion, "esperar");
  assert.equal(con.motivo, "turno_del_cliente");
});

prueba("motor: el bot pidió asesora → la tarea tibio SIGUE con el turno prendido", () => {
  const mensajes = [IN(0, "cuánto vale el envío a Pasto?"), BOT(0.2, "Ya te confirmo el envío 🙌")].map((e) => MC(e));
  const notas = [MC(NOTA(0.21, "El agente pide un asesor: Preguntó el envío y dijo su ciudad (está en el mensaje)"))];
  const d = mo.evaluarLead(ficha({ mensajes, notas }), CONFIG_SI_TURNO, en(40)).decision;
  assert.equal(d.accion, "tarea_asesora");
  assert.equal(d.motivo, "tibio_sin_asesora");
});

prueba("motor: un cliente sin respuesta de nadie sigue con su tarea (tibio_esperando)", () => {
  const d = mo.evaluarLead(ficha({ mensajes: [MC(IN(0, "cuánto vale el envío a Pasto?"))] }), CONFIG_SI_TURNO, en(40)).decision;
  assert.equal(d.accion, "tarea_asesora");
  assert.equal(d.motivo, "tibio_esperando");
});

prueba("motor: cadencia de un TIBIO tras la asesora: hoy tarea el día 3; con el turno no, y al final el descarte", () => {
  const mensajes = [IN(0, "cuánto vale el envío a Pasto?"), ASESORA(5, "El envío a Pasto es $60.000. ¿Te lo separo?")].map((e) => MC(e));
  const dia3 = en(5 + 3 * 24 * 60 + 10);
  const hoy = mo.evaluarLead(ficha({ mensajes }), CONFIG_SI, dia3).decision;
  assert.equal(hoy.accion, "tarea_asesora");
  assert.equal(hoy.motivo, "cadencia_sin_respuesta");
  const con = mo.evaluarLead(ficha({ mensajes }), CONFIG_SI_TURNO, dia3).decision;
  assert.equal(con.accion, "esperar");
  assert.equal(con.supresion, "ninguna");
  // Con cadenciaSinTarea = false, igual que hoy.
  const sinOpcion = mo.evaluarLead(ficha({ mensajes }), { ...CONFIG_SI, turno: { activo: true, cadenciaSinTarea: false } }, dia3).decision;
  assert.equal(sinOpcion.accion, hoy.accion);
  assert.equal(sinOpcion.motivo, hoy.motivo);
  const final = mo.evaluarLead(ficha({ mensajes }), CONFIG_SI_TURNO, en(5 + 9 * 24 * 60)).decision;
  assert.equal(final.accion, "descartar");
});

prueba("motor: excepciones aprobadas siguen creando tarea aunque sea turno del cliente (formulario, cotización, caliente)", () => {
  // Formulario de datos sin respuesta: tarea a las 2 h.
  const form = [IN(0, "lo quiero"), ASESORA(5, "Para separarlo me regalas: Nombre completo:\nCédula:\nDirección:\nCiudad:\nTeléfono:")].map((e) => MC(e));
  const dForm = mo.evaluarLead(ficha({ mensajes: form }), CONFIG_SI_TURNO, en(5 + 2 * 60 + 5)).decision;
  const dFormHoy = mo.evaluarLead(ficha({ mensajes: form }), CONFIG_SI, en(5 + 2 * 60 + 5)).decision;
  assert.equal(dForm.accion, dFormHoy.accion);
  assert.equal(dForm.motivo, dFormHoy.motivo);
  // Caliente (eligió color) con solo el bot: tarea A igual que hoy.
  const cal = [IN(0, "me gusta en negro, cómo hago para separarlo"), BOT(0.2, "¡Excelente elección! ¿En qué ciudad estás?")].map((e) => MC(e));
  const dCal = mo.evaluarLead(ficha({ mensajes: cal }), CONFIG_SI_TURNO, en(20)).decision;
  assert.equal(dCal.accion, "tarea_asesora");
  assert.equal(dCal.motivo, "caliente_sin_asesora");
  // Cotización enviada sin respuesta: tarea a las 24 h igual que hoy.
  const cot = [IN(0, "me cotizas el combo"), ASESORA(5, "Te envío la cotización COT-00121 por $989.000")].map((e) => MC(e));
  const dCot = mo.evaluarLead(ficha({ mensajes: cot }), CONFIG_SI_TURNO, en(5 + 24 * 60 + 5)).decision;
  const dCotHoy = mo.evaluarLead(ficha({ mensajes: cot }), CONFIG_SI, en(5 + 24 * 60 + 5)).decision;
  assert.equal(dCot.accion, dCotHoy.accion);
  assert.equal(dCot.motivo, dCotHoy.motivo);
  assert.equal(t.tareaSigueConTurnoDelCliente("formulario_sin_respuesta"), true);
  assert.equal(t.tareaSigueConTurnoDelCliente("tibio_sin_asesora"), false);
});

/* ------------------------------------------------------------------------------------------------
   6. CONVIVENCIA: en turno del cliente los automáticos (V3 15/60 min, Follow, 24/72 h) NO se frenan
------------------------------------------------------------------------------------------------ */

// La escena que ven los dobles de la base y de la ficha (se cambia en cada caso).
const escena = { config: null, mensajes: [], notas: [], guardada: null, asignadaA: null };
const conv = cargar("src/features/seguimiento-inteligente/servicios/convivencia.ts", {
  "@/lib/prisma": {
    prisma: {
      embudoLead: {
        findUnique: async () =>
          escena.guardada
            ? { accion: escena.guardada.accion, accionDatos: { supresion: escena.guardada.supresion, modo: "activo", motivo: escena.guardada.motivo }, exterior: false }
            : null,
      },
      contact: { findUnique: async () => ({ metadata: null }) },
    },
  },
  "./config": { leerConfigSeguimiento: async () => escena.config },
  "./ficha": {
    leerFicha: async () => ({ ficha: ficha({ conversationId: "cv9767", asignadaA: escena.asignadaA, mensajes: escena.mensajes }), workspaceId: "ws", channelId: "l1", contactId: "k1", lead: null }),
    leerNotasDelTurno: async () => escena.notas,
  },
});
const ENTRADA = { workspaceId: "ws", conversationId: "cv9767", contactId: "k1", channelId: "l1", motor: "v3", reglaId: "recordatorio-15" };
/** Los eventos relativos a AHORA (la convivencia decide con la hora real). */
function haceMin(min, e) {
  return { ...e, en: new Date(Date.now() - min * MIN), leidoEn: new Date(Date.now() - min * MIN), estado: e.direccion === "OUT" ? "READ" : null };
}
const asincronas = [];
function pruebaAsync(nombre, fn) {
  asincronas.push([nombre, fn]);
}

for (const minutos of [15, 60]) {
  pruebaAsync(`caso 9767: "Precio" → el bot da precio y pregunta → a los ${minutos} min el automático del V3 SÍ sale, sin tarea humana`, async () => {
    escena.mensajes = [haceMin(minutos, IN(0, "Precio")), haceMin(minutos - 0.2, BOT(0, BIENVENIDA)), haceMin(minutos - 0.25, BOT(0, PRECIO_COMBO))];
    escena.notas = [haceMin(minutos - 0.26, NOTA(0, NOTA_PRECIO))];
    // Lo que quedó guardado cuando llegó el mensaje (antes de que el bot respondiera).
    escena.guardada = { accion: "tarea_asesora", supresion: "siempre", motivo: "tibio_sin_asesora" };
    escena.config = CONFIG_SI;
    assert.equal(await conv.revisarConvivencia(ENTRADA), "inteligente_tarea_humana", "hoy (sin el turno) se frena");
    escena.config = CONFIG_SI_TURNO;
    assert.equal(await conv.revisarConvivencia(ENTRADA), null, "con el turno sale");
    assert.equal(await conv.revisarConvivencia({ ...ENTRADA, motor: "follow", reglaId: null, nombre: "Etapa Nuevo 1 día" }), null);
    // Y el motor no deja tarea humana.
    const d = mo.evaluarLead(ficha({ mensajes: escena.mensajes, notas: escena.notas }), CONFIG_SI_TURNO, new Date()).decision;
    assert.notEqual(d.accion, "tarea_asesora");
    assert.equal(d.supresion, "ninguna");
  });
}

pruebaAsync("un Frío guardado como 'reemplazo' (inteligente_reemplazado): con el turno el genérico sale", async () => {
  escena.mensajes = [haceMin(120, IN(0, "hola")), haceMin(119.8, BOT(0, "¡Hola! ¿Qué producto buscas: camillas, sillas o lavacabezas?"))];
  escena.notas = [];
  escena.guardada = { accion: "mensaje_util_producto", supresion: "reemplazo", motivo: "frio_leyo_sin_responder" };
  escena.config = CONFIG_SI;
  assert.equal(await conv.revisarConvivencia(ENTRADA), "inteligente_reemplazado");
  escena.config = CONFIG_SI_TURNO;
  assert.equal(await conv.revisarConvivencia(ENTRADA), null);
});

pruebaAsync("excepciones: caliente / 'ya pagué' / bot pidió asesora SIGUEN frenando el automático", async () => {
  escena.config = CONFIG_SI_TURNO;
  escena.guardada = { accion: "tarea_asesora", supresion: "siempre", motivo: "x" };
  escena.notas = [];
  escena.mensajes = [haceMin(20, IN(0, "me gusta en negro, cómo hago para separarlo")), haceMin(19.8, BOT(0, "¡Excelente elección! ¿En qué ciudad estás?"))];
  assert.equal(await conv.revisarConvivencia(ENTRADA), "inteligente_tarea_humana", "caliente");
  escena.mensajes = [haceMin(20, IN(0, "ya pagué, te mando el comprobante")), haceMin(19.8, BOT(0, "¡Gracias!"))];
  assert.equal(await conv.revisarConvivencia(ENTRADA), "inteligente_tarea_humana", "ya pagué");
  escena.mensajes = [haceMin(40, IN(0, "cuánto vale el envío a Pasto?")), haceMin(39.8, BOT(0, "Ya te confirmo el envío 🙌"))];
  escena.notas = [haceMin(39.7, NOTA(0, "El agente pide un asesor: Preguntó el envío y dijo su ciudad (está en el mensaje)"))];
  assert.equal(await conv.revisarConvivencia(ENTRADA), "inteligente_tarea_humana", "pidió asesora");
});

prueba("interruptor apagado = hoy: la config por defecto trae el turno apagado", () => {
  assert.equal(cf.CONFIG_POR_DEFECTO.turno.activo, false);
  assert.equal(cf.leerConfigDeTexto('{"turno":{"activo":true}}').turno.activo, false, "no se prende desde el JSON del seguimiento");
});

for (const [nombre, fn] of asincronas) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

console.log(`\n${pruebas} pruebas del turno de la conversación: OK`);
