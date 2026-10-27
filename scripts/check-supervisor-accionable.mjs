// Pruebas del SUPERVISOR ACCIONABLE (src/features/supervisor-accionable): detecta → avisa a la
// responsable → verifica → resuelve abajo → escala a Alexander solo las excepciones.
// Reglas puras + el servicio con la base y los envíos simulados (sin red ni base real).
// Correr: npm run test:supervisor-accionable
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

/* ------------------------------------------------------------------ base y envíos simulados */

const settings = new Map();
const enviados = { push: [], whatsapp: [] };
const MIEMBROS = [
  { userId: "alex", role: "OWNER", isActive: true, name: "Magilus" },
  { userId: "ingrid", role: "MEMBER", isActive: true, name: "Ingrid Sanchez" },
  { userId: "maria", role: "MEMBER", isActive: true, name: "Maria Bautista" },
];
const prisma = {
  appSetting: {
    findUnique: async ({ where }) => (settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null),
    findMany: async () => [...settings.entries()].map(([key, value]) => ({ key, value })),
    upsert: async ({ where, create, update }) => {
      settings.set(where.key, settings.has(where.key) ? update.value : create.value);
      return {};
    },
  },
  workspaceMember: {
    findMany: async ({ where }) =>
      MIEMBROS.filter((m) => m.isActive && (!where.role || where.role.in.includes(m.role))).map((m) => ({ userId: m.userId })),
    findFirst: async ({ where }) => {
      const m = MIEMBROS.find((x) => x.userId === where.userId && x.isActive);
      return m ? { user: { name: m.name, email: null } } : null;
    },
  },
  conversation: {
    findMany: async ({ where }) => where.id.in.map((id, i) => ({ id, numero: 1000 + i })),
    findFirst: async ({ where }) => ({ numero: 4321, id: where.id }),
  },
  embudoLead: { findMany: async () => [] },
  whatsAppChannel: { findFirst: async ({ where }) => ({ id: where.id, evolutionInstanceName: "admin" }) },
};
const mocks = {
  "@/lib/prisma": { prisma },
  "@/lib/web-push": {
    sendPushToUser: async ({ userId, payload }) => {
      enviados.push.push({ userId, ...payload });
      return 1;
    },
  },
  "@/lib/evolution": {
    sendEvolutionTextMessageWithReconnect: async ({ phoneNumber, text }) => {
      enviados.whatsapp.push({ phoneNumber, text });
    },
  },
  "@/lib/anti-bloqueo/servicio": { leerConfigAntiBloqueo: async () => ({ avisos: { canalInternoId: "linea-admin" } }) },
};

const r = cargar("src/features/supervisor-accionable/dominio/reglas.ts", mocks);
const servicio = cargar("src/features/supervisor-accionable/servicios/accionable.ts", mocks);
const avisar = cargar("src/features/supervisor/servicios/avisar.ts", mocks);
const enrutador = cargar("src/features/avisos-gravedad/servicios/enrutador.ts", mocks);

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const M = 60_000;
const WS = "ws1";
// Martes 6-oct-2026 10:00 Bogotá = 15:00 UTC (en horario laboral).
const T0 = new Date("2026-10-06T15:00:00Z");
const NOCHE = new Date("2026-10-07T02:00:00Z"); // martes 21:00 Bogotá
const mas = (fecha, min) => new Date(fecha.getTime() + min * M);

function chat(extra = {}) {
  return {
    conversationId: "c1",
    asesoraId: "ingrid",
    asesoraNombre: "Ingrid Sanchez",
    etapa: "NEGOCIACION",
    ultimoClienteEn: mas(T0, -20),
    ultimaRespuestaHumanaEn: null,
    textosPendientes: ["cómo hago para separar el combo"],
    textosDelCliente: ["hola", "cómo hago para separar el combo"],
    telefono: "573001234567",
    nombreCliente: "Laura Gómez",
    asignadaEn: mas(T0, -60),
    ...extra,
  };
}
function hallazgo(clave, chats, extra = {}) {
  return {
    clave,
    familia: clave.split(":")[0] === "ATENCION" ? "ATENCION" : "BOT",
    severidad: "IMPORTANTE",
    titulo: `alerta ${clave}`,
    que: "qué",
    desde: mas(T0, -20),
    producto: null,
    asesoraId: "ingrid",
    leadsAfectados: chats.length,
    evidencia: { chats, reglas: [], versiones: [] },
    metrica: "",
    esperado: "",
    observado: "",
    hechos: [],
    hipotesis: [],
    causaPosible: "",
    impacto: "Se pierden ventas.",
    recomendacion: "Arreglar la regla del primer mensaje.",
    queCambiar: "Volver la regla a la v186.",
    riesgo: "",
    comoMedir: "",
    tocaProduccion: true,
    ...extra,
  };
}
const CONFIG = { ...r.CONFIG_ACCIONABLE_POR_DEFECTO, activo: true };
const INGRID = { id: "ingrid", nombre: "Ingrid Sanchez" };
const CALIENTE = "ATENCION:caliente-esperando:maria";

/** Una vuelta pura. */
function vuelta(estado, { chats, hallazgos = [], ahora, atendidas = {}, supervisora = INGRID, config = CONFIG }) {
  const candidatas = r.candidatasDeLaVuelta({ hallazgos, chats, ahora, supervisora });
  return r.avanzar({ estado, candidatas, chats, atendidas, ahora, config, supervisora });
}
const maria = (extra = {}) => chat({ asesoraId: "maria", asesoraNombre: "Maria Bautista", ...extra });

/* ------------------------------------------------------------------ configuración */

await prueba("interruptor: sin fila, JSON roto o activo≠true = APAGADO; los valores se acotan", () => {
  assert.equal(r.leerConfigAccionableDeTexto(null).activo, false);
  assert.equal(r.leerConfigAccionableDeTexto("{roto").activo, false);
  assert.equal(r.leerConfigAccionableDeTexto('{"activo":"si"}').activo, false);
  assert.deepEqual(r.leerConfigAccionableDeTexto(""), r.CONFIG_ACCIONABLE_POR_DEFECTO);
  const c = r.leerConfigAccionableDeTexto('{"activo":true,"maxPrioridades":9,"plazos":{"caliente":1},"asesoraWhatsApp":false}');
  assert.equal(c.activo, true);
  assert.equal(c.maxPrioridades, 5, "nunca más de 5 prioridades");
  assert.equal(r.leerConfigAccionableDeTexto("{\"activo\":true}").maxPrioridades, 5, "por defecto 5");
  assert.equal(c.plazos.caliente, 5);
  assert.equal(c.asesoraWhatsApp, false);
});

await prueba("qué alertas maneja: chats de atención sí; bot, embudo, tareas y retomar no", () => {
  assert.equal(r.tipoDeLaClave("ATENCION:caliente-esperando:maria"), "caliente");
  assert.equal(r.tipoDeLaClave("ATENCION:caliente-esperando:sin-duena"), "sin_duena");
  assert.equal(r.tipoDeLaClave("ATENCION:asignado-sin-respuesta:maria"), "asignado");
  assert.equal(r.tipoDeLaClave("ATENCION:pago-sin-respuesta:maria"), "pago");
  assert.equal(r.tipoDeLaClave("ATENCION:senal-sin-duena"), "sin_duena");
  assert.equal(r.manejaElAccionable("ATENCION:tareas-sin-duena"), false);
  assert.equal(r.manejaElAccionable("ATENCION:oportunidades-a-retomar"), false);
  assert.equal(r.manejaElAccionable("INC:libro-v187:combo-camilla"), false);
});

/* ------------------------------------------------------------------ el ciclo */

await prueba("caliente sin respuesta → aviso a la ASESORA (plazo 15 min), nada a Alexander", () => {
  const { estado, eventos } = vuelta(r.estadoVacio(), { chats: [maria()], hallazgos: [hallazgo(CALIENTE, ["c1"])], ahora: T0 });
  assert.deepEqual(eventos.map((e) => e.tipo), ["avisar"]);
  assert.equal(eventos[0].responsableId, "maria");
  const a = estado.acciones.c1;
  assert.equal(a.estado, "AVISADA");
  assert.equal(a.tipo, "caliente");
  assert.equal(a.plazoMin, 15);
  assert.equal(a.cliente, "Laura Gómez");
  assert.equal(a.telefono, "•••• 4567");
  assert.equal(r.horaBogota(a.venceEn), "10:15");
  assert.ok(a.mensajeSugerido && a.mensajeSugerido.length > 10, "trae mensaje sugerido");
  assert.ok(!eventos.some((e) => e.tipo === "escalar"));
});

await prueba("la asesora responde dentro del plazo → RESUELTA_ABAJO (quién y en cuánto), sin Alexander", () => {
  let { estado } = vuelta(r.estadoVacio(), { chats: [maria()], hallazgos: [hallazgo(CALIENTE, ["c1"])], ahora: T0 });
  const respondido = maria({ ultimaRespuestaHumanaEn: mas(T0, 7) });
  const res = vuelta(estado, { chats: [respondido], hallazgos: [], ahora: mas(T0, 10) });
  estado = res.estado;
  assert.deepEqual(res.eventos.map((e) => e.tipo), ["resuelta_abajo"]);
  const a = estado.acciones.c1;
  assert.equal(a.estado, "RESUELTA_ABAJO");
  assert.equal(a.resueltaPor, "maria");
  assert.equal(a.minutosHastaResolver, 7);
  // Vueltas siguientes: nada más.
  const otra = vuelta(estado, { chats: [respondido], hallazgos: [], ahora: mas(T0, 40) });
  assert.equal(otra.eventos.length, 0);
  const m = r.metricasDelDia(otra.estado, mas(T0, 40));
  assert.equal(m.resueltasAbajo, 1);
  assert.equal(m.escaladas, 0);
  assert.equal(m.medianaMinutos, 7);
});

await prueba("un mensaje humano ANTERIOR al aviso no cuenta como respuesta", () => {
  const { estado } = vuelta(r.estadoVacio(), { chats: [maria({ ultimaRespuestaHumanaEn: mas(T0, -30) })], hallazgos: [hallazgo(CALIENTE, ["c1"])], ahora: T0 });
  const res = vuelta(estado, { chats: [maria({ ultimaRespuestaHumanaEn: mas(T0, -30) })], ahora: mas(T0, 5) });
  assert.equal(res.estado.acciones.c1.estado, "AVISADA");
});

let tarjetaEscalada = null;
await prueba("no responde → segundo aviso (asesora + supervisora) → ESCALA con el formato completo", () => {
  let { estado } = vuelta(r.estadoVacio(), { chats: [maria()], hallazgos: [hallazgo(CALIENTE, ["c1"])], ahora: T0 });
  let res = vuelta(estado, { chats: [maria()], hallazgos: [hallazgo(CALIENTE, ["c1"])], ahora: mas(T0, 10) });
  assert.equal(res.eventos.length, 0, "dentro del plazo: nada");
  res = vuelta(res.estado, { chats: [maria()], hallazgos: [hallazgo(CALIENTE, ["c1"])], ahora: mas(T0, 15) });
  assert.deepEqual(res.eventos.map((e) => e.tipo), ["segundo_aviso"]);
  assert.equal(res.eventos[0].supervisoraId, "ingrid");
  assert.equal(res.estado.acciones.c1.estado, "SEGUNDO_AVISO");
  assert.equal(res.estado.acciones.c1.incumplida, true);
  res = vuelta(res.estado, { chats: [maria()], ahora: mas(T0, 20) });
  assert.equal(res.eventos.length, 0);
  res = vuelta(res.estado, { chats: [maria()], ahora: mas(T0, 25) });
  assert.deepEqual(res.eventos.map((e) => e.tipo), ["escalar"]);
  assert.equal(res.eventos[0].gravedad, "IMPORTANTE", "caliente sin monto: push, sin WhatsApp");
  const a = res.estado.acciones.c1;
  assert.equal(a.estado, "ESCALADA");
  const t = r.tarjetaDeAccion(a, mas(T0, 25));
  tarjetaEscalada = t;
  for (const campo of ["quePaso", "cliente", "responsable", "intentos", "porQue", "riesgo", "solucion", "accionDeAlexander", "enlace"]) {
    assert.ok(typeof t[campo] === "string" && t[campo].length > 5, `la tarjeta trae ${campo}`);
  }
  assert.match(t.intentos, /Aviso a Maria Bautista a las 10:00 · plazo vencido 10:15 · segundo aviso 10:15 \(también a Ingrid Sanchez\) · escalado 10:25/);
  assert.match(t.cliente, /Laura Gómez \(•••• 4567\)/);
  assert.match(t.enlace, /chatKey=agent%3Ac1/);
  const wa = r.textoWhatsAppDeLaTarjeta(t);
  assert.ok(!wa.includes("573001234567"), "nunca el teléfono completo");
  assert.match(wa, /Tu acción/);
  assert.ok(r.textoPushDeLaTarjeta(t).title.length <= 60);
  assert.ok(r.textoPushDeLaTarjeta(t).body.length <= 180);
});

await prueba("escalada que luego se responde → RESUELTA_TRAS_ESCALAR y sale de las prioridades", () => {
  let estado = r.estadoVacio();
  for (const [min, h] of [[0, true], [15, false], [25, false]]) estado = vuelta(estado, { chats: [maria()], hallazgos: h ? [hallazgo(CALIENTE, ["c1"])] : [], ahora: mas(T0, min) }).estado;
  assert.equal(estado.acciones.c1.estado, "ESCALADA");
  const res = vuelta(estado, { chats: [maria({ ultimaRespuestaHumanaEn: mas(T0, 30) })], ahora: mas(T0, 31) });
  assert.equal(res.estado.acciones.c1.estado, "RESUELTA_TRAS_ESCALAR");
});

await prueba("Alexander marca atendido → ATENDIDA_POR_ALEXANDER", () => {
  let estado = r.estadoVacio();
  for (const min of [0, 15, 25]) estado = vuelta(estado, { chats: [maria()], hallazgos: min === 0 ? [hallazgo(CALIENTE, ["c1"])] : [], ahora: mas(T0, min) }).estado;
  const res = vuelta(estado, { chats: [maria()], ahora: mas(T0, 30), atendidas: { c1: { en: mas(T0, 29).toISOString(), por: "alex" } } });
  assert.equal(res.estado.acciones.c1.estado, "ATENDIDA_POR_ALEXANDER");
  assert.equal(res.estado.acciones.c1.atendidaPor, "alex");
});

await prueba("'ya pagué' sin respuesta: plazo 10 min de reloj, SIN segunda oportunidad → crítico", () => {
  const pago = hallazgo("ATENCION:pago-sin-respuesta:maria", ["c1"]);
  const c = maria({ textosPendientes: ["ya pagué, te mando el comprobante"] });
  let res = vuelta(r.estadoVacio(), { chats: [c], hallazgos: [pago], ahora: T0 });
  assert.equal(res.estado.acciones.c1.tipo, "pago");
  assert.equal(res.estado.acciones.c1.riesgo, "PAGO");
  assert.match(res.estado.acciones.c1.mensajeSugerido, /Lo verifico/);
  res = vuelta(res.estado, { chats: [c], hallazgos: [pago], ahora: mas(T0, 10) });
  assert.deepEqual(res.eventos.map((e) => e.tipo), ["escalar"]);
  assert.equal(res.eventos[0].gravedad, "CRITICO");
  assert.match(res.estado.acciones.c1.motivoEscalada, /pago/);
});

await prueba("un chat que empeora (asignado → ya pagué) se re-avisa con el plazo nuevo", () => {
  const asig = hallazgo("ATENCION:asignado-sin-respuesta:maria", ["c1"]);
  let res = vuelta(r.estadoVacio(), { chats: [maria()], hallazgos: [asig], ahora: T0 });
  assert.equal(res.estado.acciones.c1.plazoMin, 20);
  res = vuelta(res.estado, { chats: [maria()], hallazgos: [asig, hallazgo("ATENCION:pago-sin-respuesta:maria", ["c1"])], ahora: mas(T0, 5) });
  assert.deepEqual(res.eventos.map((e) => e.tipo), ["avisar"]);
  assert.equal(res.estado.acciones.c1.tipo, "pago");
  assert.equal(res.estado.acciones.c1.plazoMin, 10);
});

await prueba("fuera de horario: nada nuevo (salvo un pago), el plazo laboral se congela y de noche nunca hay WhatsApp", () => {
  const res = vuelta(r.estadoVacio(), { chats: [maria()], hallazgos: [hallazgo(CALIENTE, ["c1"])], ahora: NOCHE });
  assert.equal(res.eventos.length, 0, "a las 21:00 no se le avisa a una asesora que no está");
  assert.equal(res.estado.acciones.c1, undefined);
  // Abierta a las 17:55: a las 23:00 su plazo sigue corriendo solo en horario.
  const tarde = new Date("2026-10-06T22:55:00Z");
  const abierta = vuelta(r.estadoVacio(), { chats: [maria()], hallazgos: [hallazgo(CALIENTE, ["c1"])], ahora: tarde });
  const luego = vuelta(abierta.estado, { chats: [maria()], ahora: mas(tarde, 300) });
  assert.equal(luego.estado.acciones.c1.estado, "AVISADA", "a las 23:00 no vence un plazo laboral");
  const pago = hallazgo("ATENCION:pago-sin-respuesta:maria", ["c1"]);
  let p = vuelta(r.estadoVacio(), { chats: [maria()], hallazgos: [pago], ahora: NOCHE });
  p = vuelta(p.estado, { chats: [maria()], ahora: mas(NOCHE, 10) });
  assert.equal(p.eventos[0].tipo, "escalar");
  assert.equal(p.eventos[0].gravedad, "IMPORTANTE");
});

await prueba("canal de la escalada: WhatsApp solo con plata en juego; lead tibio = solo pantalla", () => {
  const ahora = T0;
  assert.equal(r.gravedadDeEscalada("PAGO", ahora), "CRITICO");
  assert.equal(r.gravedadDeEscalada("COTIZACION", ahora), "CRITICO");
  assert.equal(r.gravedadDeEscalada("VENTA", ahora), "IMPORTANTE");
  assert.equal(r.gravedadDeEscalada("PATRON", ahora), "IMPORTANTE");
  assert.equal(r.gravedadDeEscalada("INTERES", ahora), "OBSERVACION");
  assert.equal(r.gravedadDeEscalada("INTERES", ahora, false), "IMPORTANTE", "sin nadie a quién avisar sí interrumpe");
  assert.equal(r.gravedadDeEscalada("COTIZACION", NOCHE), "IMPORTANTE");
  // Un chat con cotización registrada en el embudo es COTIZACION.
  const cands = r.candidatasDeLaVuelta({
    hallazgos: [hallazgo(CALIENTE, ["c1"])],
    chats: [maria()],
    ahora,
    supervisora: INGRID,
    extras: new Map([["c1", { cotizacionEn: mas(T0, -120), anticipoEn: null }]]),
  });
  assert.equal(cands[0].riesgo, "COTIZACION");
  // Un asignado tibio que vence: escala a la pantalla, sin push.
  const tibio = maria({ etapa: "NUEVO", textosPendientes: ["precio"], textosDelCliente: ["precio"] });
  const asig = hallazgo("ATENCION:asignado-sin-respuesta:maria", ["c1"]);
  let res = vuelta(r.estadoVacio(), { chats: [tibio], hallazgos: [asig], ahora });
  assert.equal(res.estado.acciones.c1.riesgo, "INTERES");
  res = vuelta(res.estado, { chats: [tibio], ahora: mas(T0, 20) });
  res = vuelta(res.estado, { chats: [tibio], ahora: mas(T0, 30) });
  assert.deepEqual(res.eventos.map((e) => [e.tipo, e.gravedad]), [["escalar", "OBSERVACION"]]);
});

await prueba("sin asesora → la supervisora es responsable; sin supervisora → escala directo", () => {
  const sin = hallazgo("ATENCION:caliente-esperando:sin-duena", ["c1"]);
  const libre = chat({ asesoraId: null, asesoraNombre: null });
  const conSup = vuelta(r.estadoVacio(), { chats: [libre], hallazgos: [sin], ahora: T0 });
  assert.equal(conSup.estado.acciones.c1.responsableId, "ingrid");
  assert.equal(conSup.estado.acciones.c1.responsableEsSupervisora, true);
  assert.deepEqual(conSup.eventos.map((e) => e.tipo), ["avisar"]);
  const sinSup = vuelta(r.estadoVacio(), { chats: [libre], hallazgos: [sin], ahora: T0, supervisora: null });
  assert.deepEqual(sinSup.eventos.map((e) => e.tipo), ["escalar"]);
});

await prueba("reasignado a otra asesora → se le avisa a ella y su plazo empieza de cero", () => {
  const { estado } = vuelta(r.estadoVacio(), { chats: [maria()], hallazgos: [hallazgo(CALIENTE, ["c1"])], ahora: T0 });
  const res = vuelta(estado, { chats: [chat({ asesoraId: "genesis", asesoraNombre: "Genesis Moreno" })], ahora: mas(T0, 10) });
  assert.deepEqual(res.eventos.map((e) => [e.tipo, e.responsableId]), [["avisar", "genesis"]]);
  assert.equal(r.horaBogota(res.estado.acciones.c1.avisadaEn), "10:10");
});

await prueba("chat ganado/perdido o cerrado → YA_NO_APLICA (no cuenta ni como resuelta ni como escalada)", () => {
  const { estado } = vuelta(r.estadoVacio(), { chats: [maria()], hallazgos: [hallazgo(CALIENTE, ["c1"])], ahora: T0 });
  assert.equal(vuelta(estado, { chats: [maria({ etapa: "GANADO" })], ahora: mas(T0, 30) }).estado.acciones.c1.estado, "YA_NO_APLICA");
  assert.equal(vuelta(estado, { chats: [], ahora: mas(T0, 30) }).estado.acciones.c1.estado, "YA_NO_APLICA");
});

await prueba("repetición: 3 plazos vencidos de la misma asesora en el día → UNA tarjeta de patrón (push, sin WhatsApp)", () => {
  let estado = r.estadoVacio();
  const ids = ["c1", "c2", "c3"];
  const chats = ids.map((id) => maria({ conversationId: id }));
  let res = vuelta(estado, { chats, hallazgos: [hallazgo(CALIENTE, ids)], ahora: T0 });
  assert.equal(res.eventos.filter((e) => e.tipo === "avisar").length, 1, "un solo aviso agrupado para los 3 chats");
  assert.equal(res.eventos[0].accionIds.length, 3);
  // Responde a todos en la segunda oportunidad: igual cuentan como plazos vencidos.
  res = vuelta(res.estado, { chats, ahora: mas(T0, 15) });
  const patron = res.eventos.filter((e) => e.tipo === "escalar");
  assert.equal(patron.length, 1);
  assert.equal(patron[0].gravedad, "IMPORTANTE");
  const p = res.estado.acciones[patron[0].accionId];
  assert.equal(p.tipo, "patron_dia");
  assert.equal(p.conteo, 3);
  estado = res.estado;
  const otra = vuelta(estado, { chats: chats.map((c) => ({ ...c, ultimaRespuestaHumanaEn: mas(T0, 18) })), ahora: mas(T0, 20) });
  assert.equal(otra.eventos.filter((e) => e.tipo === "escalar").length, 0, "el patrón del día no se repite");
  assert.equal(otra.eventos.filter((e) => e.tipo === "resuelta_abajo").length, 3);
});

await prueba("incidente crítico del bot → tarjeta directa (responsable técnico, sin intentos de asesora)", () => {
  const inc = {
    clave: "INC:libro-v187:combo-camilla",
    familia: "BOT",
    severidad: "CRITICO",
    titulo: "Libro V3 v187: ráfaga inicial",
    primeraVezEn: T0,
    hallazgos: [hallazgo("BOT:rafaga_inicial:combo", [], { severidad: "CRITICO", leadsAfectados: 12 })],
  };
  const t = r.tarjetaDeIncidente(inc);
  assert.equal(t.gravedad, "CRITICO");
  assert.match(t.responsable, /Bot/);
  assert.match(t.porQue, /solo Alexander la autoriza/);
  assert.match(t.accionDeAlexander, /Volver la regla a la v186/);
  assert.equal(t.id, `inc:INC:libro-v187:combo-camilla:${T0.getTime()}`);
});

await prueba("Prioridades de Alexander: máximo 5, críticas primero (pago > sistema > venta), luego las más viejas", () => {
  const base = { ...tarjetaEscalada };
  const tarjetas = [
    { ...base, id: "a", grupo: "a", gravedad: "IMPORTANTE", riesgoOrden: "PATRON", desde: mas(T0, -50).toISOString() },
    { ...base, id: "b", grupo: "b", gravedad: "CRITICO", riesgoOrden: "VENTA", desde: mas(T0, -10).toISOString() },
    { ...base, id: "c", grupo: "c", gravedad: "CRITICO", riesgoOrden: "PAGO", desde: mas(T0, -5).toISOString() },
    { ...base, id: "d", grupo: "d", gravedad: "CRITICO", riesgoOrden: "VENTA", desde: mas(T0, -30).toISOString() },
    { ...base, id: "e", grupo: "e", gravedad: "CRITICO", riesgoOrden: "SISTEMA", desde: mas(T0, -1).toISOString() },
  ];
  const { visibles, resto } = r.prioridadesDeAlexander(tarjetas, 3);
  assert.deepEqual(visibles.map((t) => t.id), ["c", "e", "d"]);
  assert.deepEqual(resto.map((t) => t.id), ["b", "a"]);
  assert.equal(r.prioridadesDeAlexander(tarjetas, 10).visibles.length, 5, "nunca más de 5");
});

await prueba("8 críticos distintos: 5 visibles ordenados y 3 en el desplegable", () => {
  const tarjetas = Array.from({ length: 8 }, (_, i) => ({ ...tarjetaEscalada, id: `k${i}`, grupo: `k${i}`, gravedad: "CRITICO", riesgoOrden: "VENTA", desde: mas(T0, -i).toISOString() }));
  const { visibles, resto } = r.prioridadesDeAlexander(tarjetas);
  assert.equal(visibles.length, 5);
  assert.equal(resto.length, 3);
  assert.deepEqual(visibles.map((t) => t.id), ["k7", "k6", "k5", "k4", "k3"], "los más viejos primero");
});

await prueba("OBSERVACIÓN va al historial y no cuenta como prioridad", () => {
  const tarjetas = [
    { ...tarjetaEscalada, id: "x", grupo: "x", gravedad: "OBSERVACION" },
    { ...tarjetaEscalada, id: "y", grupo: "y", gravedad: "IMPORTANTE" },
  ];
  const p = r.prioridadesDeAlexander(tarjetas);
  assert.deepEqual(p.visibles.map((t) => t.id), ["y"]);
  assert.deepEqual(p.historial.map((t) => t.id), ["x"]);
  assert.equal(p.resto.length, 0);
});

await prueba("cambio de libro aprobado y avisos de versiones viejas son informativos; lo vigente no", () => {
  const h = (v) => ({ ...hallazgo("CAMBIO:libro:v" + v, []), familia: "CAMBIO", evidencia: { chats: [], reglas: [], versiones: [v] } });
  assert.equal(r.esAvisoDeVersionVieja({ familia: "CAMBIO", hallazgos: [h(180)] }, 187), true);
  assert.equal(r.esAvisoDeVersionVieja({ familia: "CAMBIO", hallazgos: [h(187)] }, 187), false);
  assert.equal(r.esAvisoDeVersionVieja({ familia: "BOT", hallazgos: [h(180)] }, 187), false, "solo los cambios del libro");
  assert.equal(r.esAvisoDeVersionVieja({ familia: "CAMBIO", hallazgos: [h(180)] }, null), false, "sin versión actual no se oculta nada");
});

await prueba("un mismo problema = una sola tarjeta: 3 incidentes con la misma clave (distinta versión) salen ×3", () => {
  const inc = (v, min) => ({
    clave: `INC:libro-v${v}:combo`,
    familia: "BOT",
    severidad: "CRITICO",
    titulo: `Libro V3 v${v}: ráfaga inicial`,
    primeraVezEn: mas(T0, min),
    hallazgos: [hallazgo("BOT:rafaga_inicial:combo", [], { severidad: "CRITICO" })],
  });
  const tarjetas = [inc(185, 0), inc(186, 10), inc(187, 20)].map((i) => r.tarjetaDeIncidente(i));
  const p = r.prioridadesDeAlexander(tarjetas);
  assert.equal(p.visibles.length, 1);
  assert.equal(p.visibles[0].repeticiones, 3);
  assert.equal(p.visibles[0].desde, mas(T0, 20).toISOString(), "indica el más reciente");
  assert.equal(r.claveSinVersion("INC:libro-v12:combo"), "INC:libro-v*:combo");
  // Dos problemas distintos nunca se juntan.
  const otro = r.tarjetaDeIncidente({ ...inc(187, 5), clave: "INC:embudo:combo" });
  assert.equal(r.prioridadesDeAlexander([...tarjetas, otro]).visibles.length, 2);
});

await prueba("varias escaladas del mismo cliente y tipo se juntan; de otro cliente no", () => {
  const base = { ...tarjetaEscalada, gravedad: "IMPORTANTE", riesgoOrden: "VENTA" };
  const p = r.prioridadesDeAlexander([
    { ...base, id: "1", grupo: "accion:c1:caliente", desde: mas(T0, 0).toISOString() },
    { ...base, id: "2", grupo: "accion:c1:caliente", desde: mas(T0, 30).toISOString() },
    { ...base, id: "3", grupo: "accion:c2:caliente" },
  ]);
  assert.equal(p.visibles.length, 2);
  assert.equal(p.visibles.find((t) => t.repeticiones)?.repeticiones, 2);
});

await prueba("escalada con chat cerrado, ganado, perdido o ya respondido no sigue vigente", () => {
  const a = { avisadaEn: T0.toISOString(), detectadaEn: T0.toISOString() };
  assert.equal(r.escaladaSigueVigente(a, null), false, "chat cerrado o inexistente");
  assert.equal(r.escaladaSigueVigente(a, { etapa: "GANADO", ultimaRespuestaHumanaEn: null }), false);
  assert.equal(r.escaladaSigueVigente(a, { etapa: "PERDIDO", ultimaRespuestaHumanaEn: null }), false);
  assert.equal(r.escaladaSigueVigente(a, { etapa: "NEGOCIACION", ultimaRespuestaHumanaEn: mas(T0, 5) }), false, "la asesora respondió");
  assert.equal(r.escaladaSigueVigente(a, { etapa: "NEGOCIACION", ultimaRespuestaHumanaEn: mas(T0, -5) }), true, "respuesta anterior al aviso");
  assert.equal(r.escaladaSigueVigente(a, { etapa: "NEGOCIACION", ultimaRespuestaHumanaEn: null }), true);
});

await prueba("el aviso a la asesora: cliente, motivo, espera, qué responder, plazo y enlace; sin teléfono completo", () => {
  const { estado } = vuelta(r.estadoVacio(), { chats: [maria()], hallazgos: [hallazgo(CALIENTE, ["c1"])], ahora: T0 });
  const a = estado.acciones.c1;
  const texto = r.textoParaLaAsesora({ acciones: [a], enlaces: new Map([["c1", "https://app.aizenbot.com/c/1000"]]), ahora: T0 });
  assert.match(texto, /Laura Gómez/);
  assert.match(texto, /•••• 4567/);
  assert.match(texto, /espera 20 min/);
  assert.match(texto, /Responde: "/);
  assert.match(texto, /Plazo: antes de las 10:15/);
  assert.match(texto, /app\.aizenbot\.com\/c\/1000/);
  assert.ok(!texto.includes("3001234567"));
});

await prueba("limpieza: lo cerrado hace más de 24 h pasa al historial y el historial guarda 8 días", () => {
  let res = vuelta(r.estadoVacio(), { chats: [maria()], hallazgos: [hallazgo(CALIENTE, ["c1"])], ahora: T0 });
  res = vuelta(res.estado, { chats: [maria({ ultimaRespuestaHumanaEn: mas(T0, 3) })], ahora: mas(T0, 5) });
  res = vuelta(res.estado, { chats: [], ahora: mas(T0, 25 * 60) });
  assert.equal(res.estado.acciones.c1, undefined);
  assert.equal(res.estado.historial.length, 1);
  res = vuelta(res.estado, { chats: [], ahora: mas(T0, 9 * 24 * 60) });
  assert.equal(res.estado.historial.length, 0);
});

/* ------------------------------------------------------------------ el servicio (base y envíos simulados) */

function reiniciar() {
  settings.clear();
  enviados.push.length = 0;
  enviados.whatsapp.length = 0;
  servicio.olvidarConfigAccionable();
  enrutador.olvidarConfigGravedad();
  settings.set("agente-v3:avisos:ws1", JSON.stringify({ canalId: "linea-admin", destinos: [{ numero: "573000002277", soloDe: null }, { numero: "573000001111", soloDe: "maria", userId: "maria" }] }));
  settings.set("equipo:supervisoras:ws1", JSON.stringify(["ingrid"]));
}

function incidente(clave, severidad, chats = ["c1"], familia = "ATENCION") {
  return {
    clave,
    familia,
    severidad,
    titulo: `t ${clave}`,
    producto: null,
    primeraVezEn: T0,
    ultimaVezEn: T0,
    desde: T0,
    vecesVista: 1,
    estado: "ABIERTA",
    resueltaEn: null,
    notificadaEn: T0,
    severidadNotificada: severidad,
    hallazgos: [hallazgo(clave, chats, { severidad, familia })],
  };
}

await prueba("INTERRUPTOR APAGADO = IGUAL QUE HOY: la alerta del chat caliente le llega a Alexander por push", async () => {
  reiniciar();
  const n = await avisar.avisarAlDueno({ workspaceId: WS, avisos: [{ incidente: incidente(CALIENTE, "IMPORTANTE"), motivo: "nuevo" }], incidentes: [], ahora: T0 });
  assert.equal(n, 1);
  assert.deepEqual(enviados.push.map((p) => p.userId), ["alex"]);
  assert.equal(enviados.push[0].tag, `supervisor:${CALIENTE}`);
  assert.equal(enviados.whatsapp.length, 0);
});

await prueba("ENCENDIDO: la alerta de chat NO va a Alexander por el camino de hoy; el crítico del bot sí", async () => {
  reiniciar();
  settings.set("supervisor:accionable:ws1", JSON.stringify({ activo: true }));
  const bot = incidente("INC:libro-v187:combo-camilla", "CRITICO", [], "BOT");
  await avisar.avisarAlDueno({
    workspaceId: WS,
    avisos: [{ incidente: incidente(CALIENTE, "CRITICO"), motivo: "nuevo" }, { incidente: bot, motivo: "nuevo" }],
    incidentes: [],
    ahora: T0,
  });
  assert.deepEqual(enviados.push.map((p) => p.tag), ["supervisor:INC:libro-v187:combo-camilla"]);
});

await prueba("ENCENDIDO + avisos por gravedad: el crítico del bot sale por WhatsApp con el formato completo", async () => {
  reiniciar();
  settings.set("supervisor:accionable:ws1", JSON.stringify({ activo: true }));
  settings.set("avisos:gravedad:ws1", JSON.stringify({ activo: true }));
  const bot = incidente("INC:libro-v187:combo-camilla", "CRITICO", [], "BOT");
  await avisar.avisarAlDueno({ workspaceId: WS, avisos: [{ incidente: bot, motivo: "nuevo" }, { incidente: incidente(CALIENTE, "CRITICO"), motivo: "nuevo" }], incidentes: [], ahora: T0 });
  assert.equal(enviados.whatsapp.length, 1);
  assert.equal(enviados.whatsapp[0].phoneNumber, "573000002277");
  assert.match(enviados.whatsapp[0].text, /Tu acción/);
  assert.match(enviados.whatsapp[0].text, /Bot \/ sistema/);
});

await prueba("servicio: caliente → push + WhatsApp (línea interna) a la asesora; vence → escala a Alexander (UN push, sin WhatsApp)", async () => {
  reiniciar();
  settings.set("supervisor:accionable:ws1", JSON.stringify({ activo: true }));
  const config = await servicio.leerConfigAccionable(WS);
  const h = [hallazgo(CALIENTE, ["c1"])];
  await servicio.gestionarAcciones({ workspaceId: WS, hallazgos: h, chats: [maria()], ahora: T0, config });
  assert.deepEqual(enviados.push.map((p) => p.userId), ["maria"]);
  assert.deepEqual(enviados.whatsapp.map((w) => w.phoneNumber), ["573000001111"]);
  assert.match(enviados.whatsapp[0].text, /app\.aizenbot\.com\/c\/1000/);
  enviados.push.length = 0;
  enviados.whatsapp.length = 0;
  await servicio.gestionarAcciones({ workspaceId: WS, hallazgos: h, chats: [maria()], ahora: mas(T0, 15), config });
  assert.deepEqual(enviados.push.map((p) => p.userId).sort(), ["ingrid", "maria"], "segundo aviso: asesora + supervisora");
  enviados.push.length = 0;
  enviados.whatsapp.length = 0;
  await servicio.gestionarAcciones({ workspaceId: WS, hallazgos: [], chats: [maria()], ahora: mas(T0, 25), config });
  assert.deepEqual(enviados.push.map((p) => p.userId), ["alex"]);
  assert.match(enviados.push[0].body, /Maria Bautista/);
  assert.equal(enviados.whatsapp.length, 0, "sin plata en juego no hay WhatsApp");
  const panel = await servicio.leerPanelAccionable(WS, [], mas(T0, 26));
  assert.equal(panel.prioridades.visibles.length, 1);
  await servicio.marcarAtendida(WS, "c1", "alex", mas(T0, 27));
  const despues = await servicio.leerPanelAccionable(WS, [], mas(T0, 28));
  assert.equal(despues.prioridades.visibles.length, 0, "marcada atendida: sale de inmediato");
});

await prueba("servicio: 'ya pagué' que vence → push + UN WhatsApp a Alexander con el formato completo", async () => {
  reiniciar();
  settings.set("supervisor:accionable:ws1", JSON.stringify({ activo: true }));
  servicio.olvidarConfigAccionable();
  const config = await servicio.leerConfigAccionable(WS);
  const h = [hallazgo("ATENCION:pago-sin-respuesta:maria", ["c1"])];
  const c = maria({ textosPendientes: ["ya pagué"] });
  await servicio.gestionarAcciones({ workspaceId: WS, hallazgos: h, chats: [c], ahora: T0, config });
  enviados.push.length = 0;
  enviados.whatsapp.length = 0;
  await servicio.gestionarAcciones({ workspaceId: WS, hallazgos: h, chats: [c], ahora: mas(T0, 10), config });
  assert.deepEqual(enviados.push.map((p) => p.userId), ["alex"]);
  assert.equal(enviados.whatsapp.length, 1);
  assert.equal(enviados.whatsapp[0].phoneNumber, "573000002277");
  for (const parte of ["CRÍTICO", "Laura Gómez", "Maria Bautista", "Aviso a Maria Bautista a las 10:00", "Tu acción", "app.aizenbot.com/c/1000"]) {
    assert.ok(enviados.whatsapp[0].text.includes(parte), `el WhatsApp trae "${parte}"`);
  }
  assert.ok(!enviados.whatsapp[0].text.includes("3001234567"));
  // La vuelta siguiente no repite.
  enviados.push.length = 0;
  enviados.whatsapp.length = 0;
  await servicio.gestionarAcciones({ workspaceId: WS, hallazgos: h, chats: [c], ahora: mas(T0, 15), config });
  assert.equal(enviados.push.length + enviados.whatsapp.length, 0);
});

await prueba("servicio: Mi Día muestra a la asesora sus pedidos (y nada con el interruptor apagado)", async () => {
  reiniciar();
  assert.equal(await servicio.leerPedidosDelSupervisor(WS, "maria"), null);
  settings.set("supervisor:accionable:ws1", JSON.stringify({ activo: true }));
  servicio.olvidarConfigAccionable();
  const config = await servicio.leerConfigAccionable(WS);
  await servicio.gestionarAcciones({ workspaceId: WS, hallazgos: [hallazgo(CALIENTE, ["c1"])], chats: [maria()], ahora: T0, config });
  const pedidos = await servicio.leerPedidosDelSupervisor(WS, "maria");
  assert.equal(pedidos.length, 1);
  assert.equal(pedidos[0].cliente, "Laura Gómez");
  assert.equal((await servicio.leerPedidosDelSupervisor(WS, "genesis")).length, 0);
});

/* ------------------------------------------------------------------ fuera de horario → Ingrid (11-10-2026) */

const det = cargar("src/features/supervisor/dominio/detectores-atencion.ts", mocks);
// Domingo 11-oct-2026 15:00 Bogotá = 20:00 UTC. Sábado 10-oct 19:00 = 00:00 UTC del 11.
const DOMINGO = new Date("2026-10-11T20:00:00Z");
const SABADO_19 = new Date("2026-10-11T00:00:00Z");
const MADRUGADA = new Date("2026-10-11T07:00:00Z"); // domingo 02:00
const LUNES_8 = new Date("2026-10-12T13:00:00Z");
const NOCHE_CFG = { ...CONFIG, fueraDeHorario: r.leerFueraDeHorario({ activo: true }) };
const enNoche = (estado, opciones) => vueltaNoche(estado, opciones);
function vueltaNoche(estado, { chats, hallazgos = [], ahora, supervisora = INGRID, config = NOCHE_CFG }) {
  const candidatas = r.candidatasDeLaVuelta({ hallazgos, chats, ahora, supervisora, config });
  return r.avanzar({ estado, candidatas, chats, atendidas: {}, ahora, config, supervisora });
}
const mariaDomingo = (extra = {}) => maria({ ultimoClienteEn: mas(DOMINGO, -30), asignadaEn: mas(DOMINGO, -300), ...extra });

await prueba("fuera de horario · config: sin la clave = null (lo de hoy); con {activo:true} = ventana 18–21 L–S y domingo 9–19, plazo 30", () => {
  assert.equal(r.leerConfigAccionableDeTexto('{"activo":true}').fueraDeHorario, null);
  assert.equal(r.leerConfigAccionableDeTexto('{"activo":true,"fueraDeHorario":"si"}').fueraDeHorario, null);
  const f = r.leerConfigAccionableDeTexto('{"activo":true,"fueraDeHorario":{"activo":true}}').fueraDeHorario;
  assert.deepEqual(f, { activo: true, desde: 18, hasta: 21, domingo: true, domingoDesde: 9, domingoHasta: 19, plazoMin: 30, esperaMin: 15 });
  assert.equal(r.leerConfigAccionableDeTexto('{"fueraDeHorario":{"activo":"no"}}').fueraDeHorario.activo, false);
  const v = (fecha) => r.enVentanaFueraDeHorario(fecha, f);
  assert.equal(v(SABADO_19), true, "sábado 19:00");
  assert.equal(v(mas(SABADO_19, 180)), false, "sábado 22:00");
  assert.equal(v(MADRUGADA), false, "domingo 02:00");
  assert.equal(v(DOMINGO), true, "domingo 15:00");
  assert.equal(v(mas(DOMINGO, 240)), false, "domingo 19:00");
  assert.equal(v(T0), false, "en horario no es 'fuera de horario'");
  assert.equal(v(mas(LUNES_8, -60)), false, "lunes 07:00 (fuera de la ventana)");
  assert.equal(r.enVentanaFueraDeHorario(DOMINGO, { ...f, activo: false }), false);
  assert.equal(r.enVentanaFueraDeHorario(DOMINGO, { ...f, domingo: false }), false);
  assert.equal(r.enVentanaFueraDeHorario(new Date("2026-10-13T04:00:00Z"), { ...f, desde: 22, hasta: 2 }), true, "ventana que cruza la medianoche (lunes 23:00)");
});

await prueba("fuera de horario · SIN la clave nueva = igual que hoy: domingo con caliente → nada", () => {
  const res = vuelta(r.estadoVacio(), { chats: [mariaDomingo()], hallazgos: [hallazgo(CALIENTE, ["c1"])], ahora: DOMINGO });
  assert.equal(res.eventos.length, 0);
  assert.equal(res.estado.acciones.c1, undefined);
  // Con la clave pero "activo": false, también igual que hoy.
  const apagada = { ...CONFIG, fueraDeHorario: { ...NOCHE_CFG.fueraDeHorario, activo: false } };
  assert.equal(enNoche(r.estadoVacio(), { chats: [mariaDomingo()], ahora: DOMINGO, config: apagada }).eventos.length, 0);
});

let estadoDomingo;
await prueba("fuera de horario · caliente el domingo (sin alerta del detector) → aviso a INGRID, nada a Alexander; nunca el teléfono completo", () => {
  const res = enNoche(r.estadoVacio(), { chats: [mariaDomingo()], ahora: DOMINGO });
  assert.deepEqual(res.eventos.map((e) => [e.tipo, e.responsableId, e.fueraDeHorario]), [["avisar", "ingrid", true]]);
  assert.ok(!res.eventos.some((e) => e.tipo === "escalar"), "no se escala a Alexander");
  const a = res.estado.acciones.c1;
  assert.equal(a.responsableId, "ingrid");
  assert.equal(a.fueraDeHorario, true);
  assert.equal(a.duenaNombre, "Maria Bautista");
  assert.equal(a.plazoMin, 30);
  assert.equal(r.horaBogota(a.venceEn), "15:30", "plazo de RELOJ: 30 min");
  const texto = r.textoParaLaAsesora({ acciones: [a], enlaces: new Map([["c1", "https://app.aizenbot.com/c/1000"]]), ahora: DOMINGO, fueraDeHorario: true });
  for (const parte of ["fuera de horario", "Laura Gómez", "•••• 4567", "Chat de Maria Bautista", "espera 30 min", "Responde: \"", "Plazo: antes de las 15:30", "app.aizenbot.com/c/1000"]) {
    assert.ok(texto.includes(parte), `el aviso trae "${parte}"`);
  }
  assert.ok(!texto.includes("3001234567"), "nunca el teléfono completo");
  const push = r.pushParaLaAsesora([a], false, true);
  assert.match(push.title, /Fuera de horario/);
  assert.ok(!push.body.includes("3001234567"));
  estadoDomingo = res.estado;
});

await prueba("fuera de horario · Ingrid no actúa → segundo aviso a ella a los 30 min; después queda pendiente (nunca escala)", () => {
  let res = enNoche(estadoDomingo, { chats: [mariaDomingo()], ahora: mas(DOMINGO, 20) });
  assert.equal(res.eventos.length, 0, "dentro del plazo: nada");
  res = enNoche(res.estado, { chats: [mariaDomingo()], ahora: mas(DOMINGO, 30) });
  assert.deepEqual(res.eventos.map((e) => [e.tipo, e.responsableId, e.supervisoraId, e.fueraDeHorario]), [["segundo_aviso", "ingrid", null, true]]);
  assert.equal(res.estado.acciones.c1.estado, "SEGUNDO_AVISO");
  assert.equal(res.estado.acciones.c1.incumplida, false, "fuera de horario no cuenta para el patrón");
  const texto = r.textoParaLaAsesora({ acciones: [res.estado.acciones.c1], enlaces: new Map(), ahora: mas(DOMINGO, 30), segundo: true, fueraDeHorario: true });
  assert.match(texto, /a las 8 a\. m\. pasa a su asesora/);
  for (const min of [60, 120, 600]) {
    res = enNoche(res.estado, { chats: [mariaDomingo()], hallazgos: [hallazgo(CALIENTE, ["c1"])], ahora: mas(DOMINGO, min) });
    assert.equal(res.eventos.length, 0, `a los ${min} min: nada (ni a Alexander)`);
  }
  estadoDomingo = res.estado;
});

await prueba("fuera de horario · a las 8 a. m. pasa a la asesora DUEÑA con el flujo normal (plazo 15 laboral → segundo aviso → escala)", () => {
  const c = mariaDomingo();
  let res = enNoche(estadoDomingo, { chats: [c], ahora: LUNES_8 });
  assert.deepEqual(res.eventos.map((e) => [e.tipo, e.responsableId, Boolean(e.fueraDeHorario)]), [["avisar", "maria", false]]);
  const a = res.estado.acciones.c1;
  assert.equal(a.fueraDeHorario, false);
  assert.equal(a.responsableId, "maria");
  assert.equal(a.plazoMin, 15);
  assert.equal(r.horaBogota(a.venceEn), "08:15");
  assert.ok(a.nocturnaEn, "queda la marca de que la tuvo Ingrid de noche");
  res = enNoche(res.estado, { chats: [c], ahora: mas(LUNES_8, 15) });
  assert.deepEqual(res.eventos.map((e) => [e.tipo, e.supervisoraId]), [["segundo_aviso", "ingrid"]]);
  res = enNoche(res.estado, { chats: [c], ahora: mas(LUNES_8, 25) });
  assert.deepEqual(res.eventos.map((e) => e.tipo), ["escalar"], "la escalación normal sigue en horario");
});

await prueba("fuera de horario · si alguien responde de noche → RESUELTA_ABAJO; a las 8 a. m. no se le avisa a nadie", () => {
  const respondido = mariaDomingo({ ultimaRespuestaHumanaEn: mas(DOMINGO, 12) });
  let res = enNoche(r.estadoVacio(), { chats: [mariaDomingo()], ahora: DOMINGO });
  res = enNoche(res.estado, { chats: [respondido], ahora: mas(DOMINGO, 15) });
  assert.deepEqual(res.eventos.map((e) => e.tipo), ["resuelta_abajo"]);
  assert.equal(res.estado.acciones.c1.minutosHastaResolver, 12);
  res = enNoche(res.estado, { chats: [respondido], ahora: LUNES_8 });
  assert.equal(res.eventos.length, 0);
});

await prueba("fuera de horario · madrugada (fuera de la ventana) → nada; al abrir la ventana (domingo 9:00) sí, a Ingrid", () => {
  const c = maria({ ultimoClienteEn: mas(MADRUGADA, -60) }); // escribió a la 01:00
  let res = enNoche(r.estadoVacio(), { chats: [c], hallazgos: [hallazgo(CALIENTE, ["c1"])], ahora: MADRUGADA });
  assert.equal(res.eventos.length, 0, "a las 02:00 no se le escribe a Ingrid");
  assert.equal(res.estado.acciones.c1, undefined);
  res = enNoche(res.estado, { chats: [c], ahora: mas(MADRUGADA, 6 * 60) }); // 08:00 domingo: aún cerrada
  assert.equal(res.eventos.length, 0);
  res = enNoche(res.estado, { chats: [c], ahora: mas(MADRUGADA, 7 * 60) }); // 09:00 domingo
  assert.deepEqual(res.eventos.map((e) => [e.tipo, e.responsableId]), [["avisar", "ingrid"]]);
  // Lunes 22:30 → nada hasta el martes 8 a. m.; a las 8:15 el detector (laboral) lo ve y va a la asesora.
  const lunes2230 = new Date("2026-10-13T03:30:00Z");
  const c2 = maria({ conversationId: "c2", ultimoClienteEn: mas(lunes2230, -20) });
  let n = enNoche(r.estadoVacio(), { chats: [c2], ahora: lunes2230 });
  assert.equal(n.eventos.length, 0);
  const martes815 = new Date("2026-10-13T13:15:00Z");
  n = enNoche(n.estado, { chats: [c2], hallazgos: [hallazgo(CALIENTE, ["c2"])], ahora: martes815 });
  assert.deepEqual(n.eventos.map((e) => [e.tipo, e.responsableId, Boolean(e.fueraDeHorario)]), [["avisar", "maria", false]]);
});

await prueba("fuera de horario · asignado y sin dueña siguen como hoy (esperan a la mañana); pago igual que hoy", () => {
  const libre = chat({ asesoraId: null, asesoraNombre: null, ultimoClienteEn: mas(DOMINGO, -30) });
  const sin = enNoche(r.estadoVacio(), { chats: [libre], hallazgos: [hallazgo("ATENCION:caliente-esperando:sin-duena", ["c1"])], ahora: DOMINGO });
  assert.equal(sin.eventos.length, 0, "sin dueña: nada de noche");
  const tibio = mariaDomingo({ etapa: "NUEVO", textosPendientes: ["precio"], textosDelCliente: ["precio"] });
  const asig = enNoche(r.estadoVacio(), { chats: [tibio], hallazgos: [hallazgo("ATENCION:asignado-sin-respuesta:maria", ["c1"])], ahora: DOMINGO });
  assert.equal(asig.eventos.length, 0, "asignado tibio: nada de noche");
  const pago = enNoche(r.estadoVacio(), { chats: [mariaDomingo({ textosPendientes: ["ya pagué"] })], hallazgos: [hallazgo("ATENCION:pago-sin-respuesta:maria", ["c1"])], ahora: DOMINGO });
  assert.deepEqual(pago.eventos.map((e) => [e.tipo, e.responsableId, Boolean(e.fueraDeHorario)]), [["avisar", "maria", false]], "'ya pagué' sigue su camino de hoy");
});

await prueba("fuera de horario · chat de la propia Ingrid → igual se le avisa a ella ('Chat tuyo')", () => {
  const propio = chat({ ultimoClienteEn: mas(DOMINGO, -30) });
  const res = enNoche(r.estadoVacio(), { chats: [propio], ahora: DOMINGO });
  assert.deepEqual(res.eventos.map((e) => [e.tipo, e.responsableId]), [["avisar", "ingrid"]]);
  assert.equal(res.estado.acciones.c1.duenaNombre, null);
  assert.match(r.textoParaLaAsesora({ acciones: [res.estado.acciones.c1], enlaces: new Map(), ahora: DOMINGO, fueraDeHorario: true }), /Chat tuyo/);
});

await prueba("fuera de horario · sin spam: varios chats = UN aviso agrupado; máx. 1 aviso por chat por noche (+ el segundo)", () => {
  const chats = ["c1", "c2", "c3"].map((id) => mariaDomingo({ conversationId: id }));
  let res = enNoche(r.estadoVacio(), { chats, ahora: DOMINGO });
  assert.equal(res.eventos.length, 1);
  assert.equal(res.eventos[0].accionIds.length, 3);
  // c1: Ingrid responde, el cliente vuelve a escribir esa misma noche → no hay un aviso nuevo.
  const respondido = mariaDomingo({ ultimaRespuestaHumanaEn: mas(DOMINGO, 10) });
  res = enNoche(res.estado, { chats: [respondido, chats[1], chats[2]], ahora: mas(DOMINGO, 15) });
  const otraVez = mariaDomingo({ ultimaRespuestaHumanaEn: mas(DOMINGO, 10), ultimoClienteEn: mas(DOMINGO, 20) });
  res = enNoche(res.estado, { chats: [otraVez, chats[1], chats[2]], ahora: mas(DOMINGO, 40) });
  assert.ok(!res.eventos.some((e) => e.tipo === "avisar" && e.accionIds.includes("c1")), "c1 no se re-avisa la misma noche");
  // Con 3 chats en la misma vuelta el segundo aviso también va agrupado.
  const seg = res.eventos.filter((e) => e.tipo === "segundo_aviso");
  assert.equal(seg.length, 1);
  assert.deepEqual(seg[0].accionIds.sort(), ["c2", "c3"]);
});

await prueba("fuera de horario · lo que la asesora dejó abierto a las 17:50 lo toma Ingrid a las 18:05", () => {
  const sabado1750 = new Date("2026-10-10T22:50:00Z");
  const c = maria({ ultimoClienteEn: mas(sabado1750, -20) });
  let res = enNoche(r.estadoVacio(), { chats: [c], hallazgos: [hallazgo(CALIENTE, ["c1"])], ahora: sabado1750 });
  assert.deepEqual(res.eventos.map((e) => e.responsableId), ["maria"]);
  res = enNoche(res.estado, { chats: [c], ahora: mas(sabado1750, 15) });
  assert.deepEqual(res.eventos.map((e) => [e.tipo, e.responsableId, e.fueraDeHorario]), [["avisar", "ingrid", true]]);
  assert.equal(res.estado.acciones.c1.duenaNombre, "Maria Bautista");
});

/* ------------------------------------------------------------------ despedidas / auto-respuestas no son "esperando" */

await prueba("cierres: despedidas, gracias, emojis, sin texto y auto-respuestas NO cuentan como 'caliente esperando'", () => {
  for (const t of ["Feliz noche", "muchas gracias!!", "Mil gracias, bendiciones 🙏", "👍🙏", "", "  ", "ok gracias", "Gracias igualmente, buenas noches",
    "Gracias por tu mensaje. En este momento no podemos responder", "Gracias por comunicarte con Salón Bella, te responderemos lo antes posible", "jajaja gracias", "Chao, que esté bien", "Hola buenas noches, listo dale muchas gracias", "."]) {
    assert.equal(det.esCierreOAutoRespuesta(t), true, `"${t}" es un cierre`);
  }
  for (const t of ["Muchas gracias, ¿y cuánto vale el envío?", "sí", "listo", "perfecto, ¿cómo pago?", "gracias, quiero separar el combo", "ok", "cuánto cuesta la camilla", "buenas noches, info del combo", "Hola buenas noches", "Ok linda está bien"]) {
    assert.equal(det.esCierreOAutoRespuesta(t), false, `"${t}" NO es un cierre`);
  }
  const base = { ...maria(), ultimoClienteEn: mas(T0, -40) };
  const conCierre = { ...base, conversationId: "x1", textosPendientes: ["cómo hago para separar el combo", "muchas gracias, feliz noche"] };
  const sinCierre = { ...base, conversationId: "x2" };
  const h = det.detectarAtencion([conCierre, sinCierre], T0).find((x) => x.clave.startsWith("ATENCION:caliente-esperando:"));
  assert.deepEqual(h.evidencia.chats, ["x2"], "el 'feliz noche' sale de los calientes esperando");
  // Fuera de horario tampoco se le avisa a Ingrid por un "gracias".
  const noche = enNoche(r.estadoVacio(), { chats: [mariaDomingo({ textosPendientes: ["separar el combo", "Gracias por tu mensaje. En este momento no podemos responder"] })], ahora: DOMINGO });
  assert.equal(noche.eventos.length, 0);
});

await prueba("pantalla fuera de horario: N clientes esperando (caliente y precio), quién los atiende; cierres fuera; en horario vacío", () => {
  const chats = [
    mariaDomingo(),
    chat({ conversationId: "c2", asesoraId: null, asesoraNombre: null, etapa: "NUEVO", textosPendientes: ["cuánto cuesta la camilla?"], textosDelCliente: ["cuánto cuesta la camilla?"], ultimoClienteEn: mas(DOMINGO, -90), telefono: "573009998877", nombreCliente: null }),
    mariaDomingo({ conversationId: "c3", textosPendientes: ["separar", "feliz noche"] }),
  ];
  const lista = r.esperandoFueraDeHorario({ chats, ahora: DOMINGO, config: NOCHE_CFG, supervisora: INGRID });
  assert.deepEqual(lista.map((e) => [e.conversationId, e.nivel]), [["c1", "caliente"], ["c2", "precio"]]);
  assert.equal(lista[0].quien, "Lo atiende Ingrid ahora");
  assert.equal(lista[0].asesora, "Maria Bautista");
  assert.equal(lista[1].asesora, "sin asesora");
  assert.equal(lista[1].cliente, "•••• 8877");
  assert.match(lista[1].quien, /8 a\. m\./);
  assert.equal(lista[0].minutos, 30);
  assert.ok(!JSON.stringify(lista).includes("3009998877"), "nunca el teléfono completo");
  const sinClave = r.esperandoFueraDeHorario({ chats, ahora: DOMINGO, config: CONFIG, supervisora: INGRID });
  assert.equal(sinClave[0].quien, "Se avisa a las 8 a. m. a Maria Bautista");
  assert.equal(r.esperandoFueraDeHorario({ chats, ahora: T0, config: NOCHE_CFG, supervisora: INGRID }).length, 0);
});

await prueba("servicio fuera de horario: push + WhatsApp (línea interna) a Ingrid; Alexander no recibe nada; Mi Día de Ingrid lo muestra", async () => {
  reiniciar();
  settings.set("agente-v3:avisos:ws1", JSON.stringify({ canalId: "linea-admin", destinos: [{ numero: "573000002277", soloDe: null }, { numero: "573000003333", soloDe: "ingrid", userId: "ingrid" }] }));
  settings.set("supervisor:accionable:ws1", JSON.stringify({ activo: true, supervisoraId: "ingrid", fueraDeHorario: { activo: true } }));
  servicio.olvidarConfigAccionable();
  const config = await servicio.leerConfigAccionable(WS);
  await servicio.gestionarAcciones({ workspaceId: WS, hallazgos: [], chats: [mariaDomingo()], ahora: DOMINGO, config });
  assert.deepEqual(enviados.push.map((p) => p.userId), ["ingrid"]);
  assert.match(enviados.push[0].title, /Fuera de horario/);
  assert.deepEqual(enviados.whatsapp.map((w) => w.phoneNumber), ["573000003333"]);
  assert.match(enviados.whatsapp[0].text, /fuera de horario/);
  assert.match(enviados.whatsapp[0].text, /app\.aizenbot\.com\/c\/1000/);
  assert.ok(!enviados.whatsapp[0].text.includes("3001234567"));
  const pedidos = await servicio.leerPedidosDelSupervisor(WS, "ingrid");
  assert.equal(pedidos.length, 1);
  enviados.push.length = 0;
  enviados.whatsapp.length = 0;
  for (const min of [30, 60, 120]) await servicio.gestionarAcciones({ workspaceId: WS, hallazgos: [], chats: [mariaDomingo()], ahora: mas(DOMINGO, min), config });
  assert.deepEqual(enviados.push.map((p) => p.userId), ["ingrid"], "solo el segundo aviso, a Ingrid; nada a Alexander");
  const panel = await servicio.leerPanelAccionable(WS, [], mas(DOMINGO, 121), [mariaDomingo()]);
  assert.equal(panel.esperando.length, 1);
  assert.equal(panel.prioridades.visibles.length, 0);
});

/* ------------------------------------------------------------------ tareas de seguimiento sin asesora → Ingrid */

const TAREAS = "ATENCION:tareas-sin-duena";
const tarea = (id, extra = {}) => ({ conversationId: id, nombre: "Paola Ruiz", telefonoFinal: "…4567", prioridad: "A", motivo: "cotizacion_sin_respuesta", mensajeSugerido: null, ...extra });

await prueba("tareas sin dueña · accionable APAGADO = igual que hoy: push a Alexander", async () => {
  reiniciar();
  await avisar.avisarAlDueno({ workspaceId: WS, avisos: [{ incidente: incidente(TAREAS, "IMPORTANTE"), motivo: "nuevo" }], incidentes: [], ahora: T0 });
  assert.deepEqual(enviados.push.map((p) => [p.userId, p.tag]), [["alex", `supervisor:${TAREAS}`]]);
  assert.equal(r.avisoDeTareasSinDuena({ tareas: [tarea("t1")], previo: r.estadoTareasVacio(), ahora: T0, config: r.CONFIG_ACCIONABLE_POR_DEFECTO, supervisora: INGRID }).aviso, null);
});

await prueba("tareas sin dueña · accionable ENCENDIDO: 0 a Alexander (camino de hoy y avisos por gravedad)", async () => {
  reiniciar();
  settings.set("supervisor:accionable:ws1", JSON.stringify({ activo: true, supervisoraId: "ingrid" }));
  servicio.olvidarConfigAccionable();
  await avisar.avisarAlDueno({ workspaceId: WS, avisos: [{ incidente: incidente(TAREAS, "IMPORTANTE"), motivo: "nuevo" }], incidentes: [incidente(TAREAS, "IMPORTANTE")], ahora: T0 });
  assert.equal(enviados.push.length + enviados.whatsapp.length, 0);
  settings.set("avisos:gravedad:ws1", JSON.stringify({ activo: true }));
  enrutador.olvidarConfigGravedad();
  await avisar.avisarAlDueno({ workspaceId: WS, avisos: [{ incidente: incidente(TAREAS, "IMPORTANTE"), motivo: "nuevo" }], incidentes: [incidente(TAREAS, "IMPORTANTE")], ahora: T0 });
  assert.ok(!enviados.push.some((p) => p.userId === "alex"), "nada a Alexander con avisos por gravedad");
  assert.equal(enviados.whatsapp.length, 0);
});

await prueba("tareas sin dueña · aviso a Ingrid: push + WhatsApp en horario, agrupado, sin repetir el mismo set; Mi día las muestra", async () => {
  reiniciar();
  settings.set("agente-v3:avisos:ws1", JSON.stringify({ canalId: "linea-admin", destinos: [{ numero: "573000002277", soloDe: null }, { numero: "573000003333", soloDe: "ingrid", userId: "ingrid" }] }));
  settings.set("supervisor:accionable:ws1", JSON.stringify({ activo: true, supervisoraId: "ingrid" }));
  servicio.olvidarConfigAccionable();
  const config = await servicio.leerConfigAccionable(WS);
  await servicio.avisarTareasSinDuena({ workspaceId: WS, tareas: [tarea("t1"), tarea("t2", { nombre: "573001112233", telefonoFinal: "2233" })], ahora: T0, config });
  assert.deepEqual(enviados.push.map((p) => p.userId), ["ingrid"], "un solo push, a Ingrid");
  assert.deepEqual(enviados.whatsapp.map((w) => w.phoneNumber), ["573000003333"], "un solo WhatsApp agrupado, a Ingrid");
  assert.match(enviados.whatsapp[0].text, /2 tareas sin asesora/);
  assert.match(enviados.whatsapp[0].text, /•••• 2233/);
  assert.ok(!enviados.whatsapp[0].text.includes("573001112233"), "nunca el teléfono completo");
  const pedidos = await servicio.leerPedidosDelSupervisor(WS, "ingrid");
  assert.deepEqual(pedidos.map((p) => p.id).sort(), ["tarea:t1", "tarea:t2"]);
  assert.equal((await servicio.leerPedidosDelSupervisor(WS, "maria")).length, 0);
  enviados.push.length = 0;
  enviados.whatsapp.length = 0;
  await servicio.avisarTareasSinDuena({ workspaceId: WS, tareas: [tarea("t1"), tarea("t2")], ahora: mas(T0, 5), config });
  assert.equal(enviados.push.length + enviados.whatsapp.length, 0, "el mismo set no se repite");
  await servicio.avisarTareasSinDuena({ workspaceId: WS, tareas: [tarea("t1"), tarea("t2"), tarea("t3")], ahora: mas(T0, 10), config });
  assert.equal(enviados.push.length, 1);
  assert.equal(enviados.whatsapp.length, 1);
  assert.match(enviados.whatsapp[0].text, /tarea sin asesora/, "solo la nueva");
  // Madrugada (fuera de la ventana): push y Mi día, sin WhatsApp.
  enviados.push.length = 0;
  enviados.whatsapp.length = 0;
  await servicio.avisarTareasSinDuena({ workspaceId: WS, tareas: [tarea("t4")], ahora: MADRUGADA, config });
  assert.deepEqual(enviados.push.map((p) => p.userId), ["ingrid"]);
  assert.equal(enviados.whatsapp.length, 0, "de madrugada no hay WhatsApp");
  // Dentro de la ventana fuera de horario (domingo 15:00, con fueraDeHorario) sí hay WhatsApp.
  const conVentana = { ...config, fueraDeHorario: r.leerFueraDeHorario({ activo: true }) };
  const v = r.avisoDeTareasSinDuena({ tareas: [tarea("t5")], previo: r.estadoTareasVacio(), ahora: DOMINGO, config: conVentana, supervisora: INGRID });
  assert.equal(v.aviso.whatsapp, true);
  assert.equal(r.avisoDeTareasSinDuena({ tareas: [tarea("t5")], previo: r.estadoTareasVacio(), ahora: DOMINGO, config, supervisora: INGRID }).aviso.whatsapp, false, "domingo sin ventana: sin WhatsApp");
});

/* ------------------------------------------------------------------ caliente = etapa NEGOCIACION o temperatura CALIENTE del embudo */

await prueba("caliente: temperatura CALIENTE sin etapa → caliente; NEGOCIACION sin temperatura → caliente; TIBIO sin etapa → no", () => {
  const sinSenal = { textosPendientes: ["¿No tiene créditos?"], textosDelCliente: ["hola", "¿No tiene créditos?"] };
  const temp = maria({ etapa: null, temperatura: "CALIENTE", ...sinSenal });
  const etapa = maria({ etapa: "NEGOCIACION", temperatura: null, ...sinSenal });
  const tibio = maria({ etapa: null, temperatura: "TIBIO", ...sinSenal });
  assert.equal(det.estadoDeEspera(temp, T0).caliente, true);
  assert.equal(det.estadoDeEspera(etapa, T0).caliente, true);
  assert.equal(det.estadoDeEspera(tibio, T0).caliente, false);
  assert.equal(det.estadoDeEspera(tibio, T0).senalFuerte, false, "el texto de prueba no trae señal fuerte");
  // Una negativa pendiente le gana a la temperatura guardada (la etapa a mano sigue mandando).
  assert.equal(det.estadoDeEspera({ ...temp, textosPendientes: ["no me interesa, gracias"] }, T0).caliente, false);
  assert.equal(det.estadoDeEspera({ ...etapa, textosPendientes: ["no me interesa"] }, T0).caliente, true);
  // Detector de día: el CALIENTE del embudo con etapa vacía ahora sale en "caliente esperando".
  const chats = [
    { ...temp, conversationId: "e1" },
    { ...etapa, conversationId: "e2" },
    { ...tibio, conversationId: "e3" },
    { ...temp, conversationId: "e4", textosPendientes: ["¿No tiene créditos?", "Muchas gracias, feliz noche"] },
    { ...temp, conversationId: "e5", etapa: "PERDIDO" },
  ];
  const h = det.detectarAtencion(chats, T0).find((x) => x.clave === "ATENCION:caliente-esperando:maria");
  assert.deepEqual([...h.evidencia.chats].sort(), ["e1", "e2"], "tibio, despedida y perdido no");
  assert.ok(h.hechos.some((x) => x.includes("Caliente en el embudo")));
  // Fuera de horario: también lo toma Ingrid.
  const noche = enNoche(r.estadoVacio(), { chats: [mariaDomingo({ etapa: null, temperatura: "CALIENTE", ...sinSenal })], ahora: DOMINGO });
  assert.deepEqual(noche.eventos.map((e) => [e.tipo, e.responsableId]), [["avisar", "ingrid"]]);
  assert.equal(enNoche(r.estadoVacio(), { chats: [mariaDomingo({ etapa: null, temperatura: "TIBIO", ...sinSenal })], ahora: DOMINGO }).eventos.length, 0);
});

/* ------------------------------------------------------------------ falla real del domingo 11-oct: cierres largos, sugerido y plazo */

const REAL_8462 = "Ah, bueno, visto, muy bien, muchas gracias.";
const REAL_5903 = "Pero igual muchas gracias, hay que saber dar buenas respuestas";

await prueba("cierres largos (11-oct): los 2 textos reales NO esperan; con pregunta o señal de compra SÍ; 'Listo' solo igual que antes", () => {
  for (const t of [REAL_8462, REAL_5903, "Bueno muchas gracias, voy a revisar con mi esposo y le aviso", "Vale, perfecto gracias, que Dios la bendiga mucho", "dale gracias", "bueno gracias", "Ok gracias", "Perfecto gracias"]) {
    assert.equal(det.esCierreOAutoRespuesta(t), true, `"${t}" es un cierre`);
  }
  for (const t of ["gracias, ¿y cuánto vale el envío?", "gracias y cuanto vale el envio", "ok gracias, me lo separas en crema", "Gracias, ya pagué", "gracias, mañana le consigno", "?", "??",
    "Muchas gracias, tienen la camilla en negro", "gracias, me regalas la información del combo", "gracias, hay disponible para entrega", "gracias, quiero el combo", "Listo", "listo", "ok", "Muy bien", "visto"]) {
    assert.equal(det.esCierreOAutoRespuesta(t), false, `"${t}" NO es un cierre`);
  }
  assert.equal(det.esAgradecimientoSinPendiente("Gracias, ya pagué"), false, "'ya pagué' nunca es cierre");
  // Detector de día: caliente esperando, asignado sin respuesta y sin dueña.
  const base = maria({ ultimoClienteEn: mas(T0, -40), etapa: "NEGOCIACION" });
  const c8462 = { ...base, conversationId: "r1", textosPendientes: [REAL_8462] };
  const c5903 = { ...base, conversationId: "r2", textosPendientes: ["No hablo de eso", REAL_5903] };
  const pregunta = { ...base, conversationId: "r3", textosPendientes: ["gracias, ¿y cuánto vale el envío?"] };
  const separa = { ...base, conversationId: "r4", textosPendientes: ["ok gracias, me lo separas en crema"] };
  const h = det.detectarAtencion([c8462, c5903, pregunta, separa], T0).find((x) => x.clave === "ATENCION:caliente-esperando:maria");
  assert.deepEqual([...h.evidencia.chats].sort(), ["r3", "r4"]);
  const asignado = (id, textos) => ({ ...maria({ conversationId: id, etapa: "NUEVO", temperatura: "CALIENTE", asignadaEn: mas(T0, -90), ultimoClienteEn: mas(T0, -80) }), textosPendientes: textos, textosDelCliente: ["me interesa el combo, cuánto vale?", ...textos] });
  const a = det.detectarAsignadoSinRespuesta([asignado("s1", [REAL_8462]), asignado("s2", ["gracias, ¿y cuánto vale el envío?"])], T0);
  assert.deepEqual(a.flatMap((x) => x.evidencia.chats), ["s2"], "asignado sin respuesta: el cierre no sale");
  const libre = (id, textos) => ({ ...chat({ conversationId: id, asesoraId: null, asesoraNombre: null, ultimoClienteEn: mas(T0, -40) }), textosPendientes: textos });
  const sd = det.detectarAtencion([libre("l1", ["separar el combo", REAL_5903]), libre("l2", ["ok gracias, quiero separar el combo en crema"])], T0).find((x) => x.clave === "ATENCION:senal-sin-duena");
  assert.deepEqual(sd.evidencia.chats, ["l2"], "sin dueña: el cierre no sale");
  // Fuera de horario (domingo 6:15 p. m.): ni 8462 ni 5903; el que pregunta sí.
  const domingo1815 = new Date("2026-10-11T23:15:00Z");
  const noche = (id, textos, extra = {}) => ({ ...chat({ conversationId: id, etapa: "NUEVO", temperatura: "CALIENTE", ultimoClienteEn: mas(domingo1815, -20 * 60) }), textosPendientes: textos, ...extra });
  const res = enNoche(r.estadoVacio(), { chats: [noche("n1", [REAL_8462]), noche("n2", ["No hablo de eso", REAL_5903]), noche("n3", ["gracias, ¿y cuánto vale el envío?"])], ahora: domingo1815 });
  assert.deepEqual(res.eventos.flatMap((e) => e.accionIds), ["n3"]);
});

await prueba("sugerido (11-oct): sin color elegido → neutro; 'solo la camilla' + color → camilla (no combo); nunca 'en ese color'", () => {
  const sug = (pendientes, delCliente = []) => det.sugeridoParaElChat({ ...chat(), textosPendientes: pendientes, textosDelCliente: delCliente }, T0, null);
  // Sin color ni otra señal → neutro.
  assert.equal(sug(["hola"], ["Hola, me interesa el COMBO de estética (camilla, escalera, silla y auxiliar)", "hola"]), "¡Hola! ¿Te quedó alguna duda? Con gusto te ayudo 😊");
  // Nombra un color sin elegirlo ("tengo una camilla blanca") → no "Excelente elección".
  assert.doesNotMatch(sug(["tengo una camilla blanca vieja"]), /Excelente elección/);
  // Caso 5903: pidió SOLO la camilla y eligió crema → camilla, no combo.
  const t5903 = ["Hola, me interesa el COMBO de estética (camilla, escalera, silla y auxiliar)", "Solo camilla", "Color crema", "Solo la camilla"];
  const s = sug(["Color crema"], t5903);
  assert.match(s, /Excelente elección/);
  assert.match(s, /\*camilla\* en color \*crema\*/);
  assert.doesNotMatch(s, /[Cc]ombo|ese color|camillas/);
  // Combo con color elegido ("Rosado") → combo en rosado.
  const combo = sug(["Rosado"], ["Rosado", "Hola, me interesa el COMBO de estética (camilla, escalera, silla y auxiliar)"]);
  assert.match(combo, /\*Combo de Camilla\* en color \*rosado\*/);
  // Color elegido pero sin producto claro → no "Excelente elección".
  assert.doesNotMatch(sug(["Rosado"], ["Rosado"]), /Excelente elección/);
  // Pidió fotos (esperando) → se le ofrecen las fotos, no "¿pudiste ver las fotos?".
  assert.match(sug(["Puedes enviarme foto"], ["Puedes enviarme foto", "Hola, me interesa el COMBO de estética (camilla, escalera, silla y auxiliar)"]), /Te comparto las fotos de tu \*Combo de Camilla\*/);
  // El accionable usa el mismo criterio.
  const c = chat({ conversationId: "z1", etapa: "NEGOCIACION", textosPendientes: ["hola"], textosDelCliente: ["Hola, me interesa el COMBO de estética (camilla, escalera, silla y auxiliar)", "hola"], nombreCliente: null });
  const cand = r.candidatasDeLaVuelta({ hallazgos: [hallazgo("ATENCION:caliente-esperando:ingrid", ["z1"])], chats: [c], ahora: T0, supervisora: INGRID });
  assert.equal(cand[0].mensajeSugerido, "¡Hola! ¿Te quedó alguna duda? Con gusto te ayudo 😊");
});

await prueba("plazo (11-oct): nunca 'Plazo: YA'; segundo aviso fuera de horario = antes de las HH:MM (plazoMin de reloj); de día = segunda oportunidad", () => {
  // Fuera de horario: aviso 22:48 UTC (17:48), segundo aviso 23:18 UTC (18:18) → plazo 18:48.
  let res = enNoche(r.estadoVacio(), { chats: [mariaDomingo()], ahora: DOMINGO });
  res = enNoche(res.estado, { chats: [mariaDomingo()], ahora: mas(DOMINGO, 30) });
  const a = res.estado.acciones.c1;
  const texto = r.textoParaLaAsesora({ acciones: [a], enlaces: new Map(), ahora: mas(DOMINGO, 30), segundo: true, fueraDeHorario: true });
  assert.ok(!/Plazo: YA/.test(texto), "sin 'Plazo: YA'");
  assert.match(texto, /⏱️ Plazo: antes de las 16:00/, "segundo aviso 15:30 + 30 min de reloj");
  assert.match(r.pushParaLaAsesora([a], true, true, mas(DOMINGO, 30)).body, /Plazo: antes de las 16:00/);
  // De día: segundo aviso 10:15 + 10 min laborales = 10:25 (cuando se escala).
  let dia = vuelta(r.estadoVacio(), { chats: [chat()], hallazgos: [hallazgo("ATENCION:caliente-esperando:ingrid", ["c1"])], ahora: T0 });
  dia = vuelta(dia.estado, { chats: [chat()], ahora: mas(T0, 15) });
  const d = dia.estado.acciones.c1;
  assert.equal(d.estado, "SEGUNDO_AVISO");
  assert.match(r.textoParaLaAsesora({ acciones: [d], enlaces: new Map(), ahora: mas(T0, 15), segundo: true, segundaOportunidadMin: 10 }), /⏱️ Plazo: antes de las 10:25/);
  // Sin con qué calcular → "en los próximos N min" (N = plazoMin).
  assert.equal(r.textoDelPlazo({ ...d, venceEn: mas(T0, -5).toISOString(), plazoMin: 30 }, T0), "en los próximos 30 min");
});

/* ------------------------------------------------------------------ revalidación de incidentes viejos (11-oct) */

const reval = cargar("src/features/supervisor/dominio/revalidacion.ts", mocks);

await prueba("Prioridades + revalidación: el revalidado RESUELTO y el PENDIENTE salen; el que SIGUE entra con evidencia y decisión", async () => {
  reiniciar();
  settings.set("supervisor:accionable:ws1", JSON.stringify({ activo: true }));
  servicio.olvidarConfigAccionable();
  const ahora = mas(T0, 60);
  const viejo = (clave) => ({
    clave,
    familia: "BOT",
    severidad: "CRITICO",
    titulo: `Después del cambio del libro V3 (${clave})`,
    producto: "combo-camilla",
    primeraVezEn: mas(T0, -3 * 24 * 60),
    ultimaVezEn: mas(T0, -60),
    desde: mas(T0, -4 * 24 * 60),
    vecesVista: 40,
    estado: "ABIERTA",
    resueltaEn: null,
    notificadaEn: mas(T0, -30),
    severidadNotificada: "CRITICO",
    hallazgos: [hallazgo("BOT:rafaga_inicial:combo-camilla", ["c9"], { severidad: "IMPORTANTE", tocaProduccion: true, queCambiar: "La regla del primer turno (libro V3)", recomendacion: "Corregir la regla en el simulador" })],
  });
  const incidentes = [viejo("INC:libro-v182:combo-camilla"), viejo("INC:libro-v187:combo-camilla"), viejo("INC:libro-v188:combo-camilla")];
  const antes = await servicio.leerPanelAccionable(WS, incidentes, ahora);
  assert.equal(antes.prioridades.visibles.length, 1, "los tres viejos son el mismo problema: una sola tarjeta");
  assert.equal(antes.prioridades.visibles[0].repeticiones, 3, "…con ×3");
  const decision = { "INC:libro-v182:combo-camilla": "RESUELTA", "INC:libro-v187:combo-camilla": "PENDIENTE", "INC:libro-v188:combo-camilla": "SIGUE" };
  const revalidacion = (inc) => ({
    clave: inc.clave,
    decision: decision[inc.clave],
    en: ahora,
    versionDelIncidente: Number(/v(\d+)/.exec(inc.clave)[1]),
    versionActual: 222,
    versionDesde: 212,
    desde: mas(T0, -2 * 24 * 60),
    leads: 59,
    porVersion: { v212: 21, v213: 37, v216: 1 },
    metricas: [{ indicador: "rafaga_inicial", principal: true, actual: { exitos: 30, total: 51 }, reciente: { exitos: 0, total: 0 }, base: null, delIncidente: null, veredicto: decision[inc.clave] === "SIGUE" ? "sigue" : "ya_no", linea: "línea", chats: ["c9"] }],
    guardian: { corrido: false, fallaHoy: false, lineas: [], regla: null },
    hechos: ["evidencia"],
    afectados: decision[inc.clave] === "SIGUE" ? { n: 30, total: 51, indicador: "rafaga_inicial" } : { n: 0, total: 59, indicador: null },
    chats: decision[inc.clave] === "SIGUE" ? ["c9"] : [],
  });
  const r2 = reval.aplicarRevalidaciones({
    incidentes,
    avisar: [],
    abiertasAntes: new Set(incidentes.map((i) => i.clave)),
    versionActual: 222,
    ahora,
    inicioDe: (inc) => inc.desde,
    revalidar: revalidacion,
  });
  const abiertos = r2.incidentes.filter((i) => i.estado === "ABIERTA");
  const despues = await servicio.leerPanelAccionable(WS, abiertos, ahora);
  assert.equal(despues.prioridades.visibles.length, 1);
  const t = despues.prioridades.visibles[0];
  assert.match(t.quePaso, /^Sigue con la versión 222 \(revalidado\)/);
  assert.match(t.quePaso, /Afectados hoy: 30 de 51 leads/);
  assert.match(t.riesgo, /30 de 51 leads/);
  assert.match(t.solucion, /Corregir la regla/);
  assert.match(t.accionDeAlexander, /^Autoriza o descarta: La regla del primer turno/);
  assert.equal(r2.incidentes.find((i) => i.clave.includes("v182")).estado, "RESUELTA");
  // El PENDIENTE de una versión vieja ya no se queda: la limpieza del libro lo cierra como "Reemplazado".
  const v187 = r2.incidentes.find((i) => i.clave.includes("v187"));
  assert.equal(v187.estado, "RESUELTA");
  assert.match(v187.titulo, /^Reemplazado: el libro ya está en la versión 222: /);
  assert.equal(enviados.push.length + enviados.whatsapp.length, 0, "revalidar no manda nada por sí solo");
});

await prueba("Prioridades + limpieza del libro: las viejas cerradas y las repetidas ya no salen; queda solo la de la versión vigente", async () => {
  reiniciar();
  settings.set("supervisor:accionable:ws1", JSON.stringify({ activo: true }));
  servicio.olvidarConfigAccionable();
  const ahora = mas(T0, 60);
  const alerta = (version, severidad) => ({
    clave: `INC:libro-v${version}:combo-camilla`,
    familia: "BOT",
    severidad,
    titulo: `Libro V3 v${version}: ráfaga del combo`,
    producto: "combo-camilla",
    primeraVezEn: mas(T0, -version),
    ultimaVezEn: mas(T0, -60),
    desde: mas(T0, -version),
    vecesVista: 10,
    estado: "ABIERTA",
    resueltaEn: null,
    notificadaEn: null,
    severidadNotificada: null,
    hallazgos: [hallazgo(`CAMBIO:post-cambio:v${version}:combo-camilla`, ["c9"], { severidad, tocaProduccion: true, queCambiar: "La regla del primer turno (libro V3)", recomendacion: "Revisar" })],
  });
  const incidentes = [alerta(292, "CRITICO"), alerta(311, "CRITICO"), alerta(317, "CRITICO"), alerta(320, "CRITICO")];
  const antes = await servicio.leerPanelAccionable(WS, incidentes, ahora);
  assert.equal(antes.prioridades.visibles.length + antes.prioridades.resto.length, 1, "las repetidas ya se juntan en una sola tarjeta");
  assert.equal(antes.prioridades.visibles[0].repeticiones, 4);
  const limpio = reval.aplicarRevalidaciones({
    incidentes, avisar: [], abiertasAntes: new Set(incidentes.map((i) => i.clave)), versionActual: 320, ahora, inicioDe: (inc) => inc.desde, revalidar: () => null,
  });
  const abiertas = limpio.incidentes.filter((i) => i.estado === "ABIERTA");
  assert.deepEqual(abiertas.map((i) => i.clave), ["INC:libro-v320:combo-camilla"]);
  const despues = await servicio.leerPanelAccionable(WS, abiertas, ahora);
  assert.equal(despues.prioridades.visibles.length + despues.prioridades.resto.length, 1);
  assert.equal(enviados.push.length + enviados.whatsapp.length, 0, "limpiar no manda nada");
});

/* ------------------------------------------------------------------ botones de las prioridades (12-oct-2026) */

await prueba("tarjeta de patrón: trae sus chats (enlace al chat, teléfono tapado) y su enlace es un ancla, no la misma página", async () => {
  const ids = ["c1", "c2", "c3"];
  // c3 sin nombre: se muestra "•••• 4567", nunca el número completo.
  const chats = ids.map((id) => maria({ conversationId: id, ...(id === "c3" ? { nombreCliente: null } : {}) }));
  let res = vuelta(r.estadoVacio(), { chats, hallazgos: [hallazgo(CALIENTE, ids)], ahora: T0 });
  res = vuelta(res.estado, { chats, ahora: mas(T0, 15) });
  const p = Object.values(res.estado.acciones).find((a) => a.tipo === "patron_dia");
  assert.deepEqual([...p.idsDeChats].sort(), ids, "el patrón guarda los chats que lo dispararon");
  // c1 respondido después: queda RESUELTA; los otros siguen sin respuesta.
  res = vuelta(res.estado, { chats: chats.map((c) => (c.conversationId === "c1" ? { ...c, ultimaRespuestaHumanaEn: mas(T0, 18) } : c)), ahora: mas(T0, 20) });
  const t = r.tarjetaDeAccion(res.estado.acciones[p.id], mas(T0, 25), res.estado);
  assert.equal(t.chats.length, 3);
  for (const c of t.chats) assert.equal(c.enlace, r.enlaceAlChat(c.conversationId));
  assert.equal(t.chats[2].situacion, "RESUELTA", "los que siguen sin respuesta van primero");
  assert.match(t.chats[2].estado, /^Resuelta 10:18 por Maria Bautista/);
  assert.equal(t.chats.filter((c) => c.situacion === "SIN_RESPUESTA").length, 2);
  assert.ok(t.chats.every((c) => c.plazo && /^Plazo vencido \d{1,2}:\d{2}$/.test(c.plazo)), "cada chat dice a qué hora venció el plazo");
  assert.ok(t.chats.some((c) => c.cliente === "•••• 4567"));
  assert.ok(!JSON.stringify(t).includes("3001234567"), "nunca el teléfono completo");
  assert.equal(t.enlace, `/cliente/direccion/supervisor#${r.anclaDePrioridad(p.id)}`);
  assert.match(r.anclaDePrioridad(p.id), /^prioridad-[A-Za-z0-9_-]+$/);
  assert.ok(t.chats.every((c) => !/ya no aplica/i.test(c.estado)), "ninguna fila «Ya no aplica» en los chats del patrón");
  // Patrones viejos (sin idsDeChats): se arman con los incumplidos de la misma asesora ese día.
  const viejo = { ...res.estado.acciones[p.id] };
  delete viejo.idsDeChats;
  assert.deepEqual(r.chatsDelPatron(viejo, res.estado, mas(T0, 25)).map((c) => c.conversationId).sort(), ids);
  // Sin estado (el push / WhatsApp) no trae chats, pero el enlace igual es el ancla.
  assert.equal(r.tarjetaDeAccion(res.estado.acciones[p.id], mas(T0, 25)).chats, undefined);
});

await prueba("tarjeta de incidente: lleva a la alerta concreta (?alerta=<clave>#alerta-…) y ningún enlace del panel es la misma página", async () => {
  const inc = {
    clave: "INC:libro-v187:combo-camilla",
    familia: "BOT",
    severidad: "CRITICO",
    estado: "ABIERTA",
    titulo: "Libro V3 v187: ráfaga inicial",
    primeraVezEn: T0,
    hallazgos: [hallazgo("BOT:rafaga_inicial:combo", [], { severidad: "CRITICO", leadsAfectados: 12 })],
  };
  const t = r.tarjetaDeIncidente(inc);
  assert.equal(t.claveAlerta, inc.clave);
  assert.equal(t.enlace, `/cliente/direccion/supervisor?alerta=${encodeURIComponent(inc.clave)}#alerta-INC-libro-v187-combo-camilla`);
  assert.equal(r.anclaDeAlerta(inc.clave), "alerta-INC-libro-v187-combo-camilla");
  assert.ok(r.textoWhatsAppDeLaTarjeta(t).includes(`https://app.aizenbot.com/cliente/direccion/supervisor?alerta=`));

  // El panel completo: patrón escalado + incidente crítico.
  settings.clear();
  servicio.olvidarConfigAccionable();
  settings.set("supervisor:accionable:ws1", JSON.stringify({ activo: true }));
  const ids = ["c1", "c2", "c3"];
  const chats = ids.map((id) => maria({ conversationId: id }));
  let res = vuelta(r.estadoVacio(), { chats, hallazgos: [hallazgo(CALIENTE, ids)], ahora: T0 });
  res = vuelta(res.estado, { chats, ahora: mas(T0, 15) });
  settings.set(servicio.claveEstadoAccionable(WS), JSON.stringify(res.estado));
  const panel = await servicio.leerPanelAccionable(WS, [inc], mas(T0, 20));
  const tarjetas = [...panel.prioridades.visibles, ...panel.prioridades.resto];
  assert.ok(tarjetas.some((x) => x.chats?.length === 3), "la tarjeta de patrón del panel trae sus 3 chats");
  assert.ok(tarjetas.some((x) => x.claveAlerta === inc.clave));
  const enlaces = tarjetas.flatMap((x) => [x.enlace, ...(x.chats ?? []).map((c) => c.enlace)]);
  assert.ok(enlaces.length >= 5);
  for (const e of enlaces) assert.notEqual(e, "/cliente/direccion/supervisor", `enlace a la misma página sin ancla: ${e}`);
  settings.clear();
  servicio.olvidarConfigAccionable();
});

/* ------------------------------------------------------------------ solo acusa recibo de un acuerdo (13-10-2026) */

const acuse = cargar("src/features/supervisor/dominio/acuse-con-acuerdo.ts", mocks);
const exclusionesAcuse = cargar("src/features/supervisor/dominio/exclusiones.ts", mocks);
// Martes 13-oct-2026, horas de Bogotá (UTC-5).
const bog = (hhmm) => new Date(`2026-10-13T${String(Number(hhmm.slice(0, 2)) + 5).padStart(2, "0")}:${hhmm.slice(3)}:00Z`);
const ev = (direccion, hhmm, texto, extra = {}) => ({ direccion, tipo: "TEXT", origen: direccion === "OUT" ? "manual" : null, texto, en: bog(hhmm), ...extra });
const DATOS_COTIZACION = "Datos de Cotización\nNombre: Danna\nCiudad: Bogotá\nDirección: Calle 10 # 5-20\nProducto: combo camilla";
/** La charla real (13-oct, Ventas 1, etapa Caliente, asesora María), sin teléfonos. */
const CHARLA_REAL = [
  ev("IN", "11:30", DATOS_COTIZACION),
  ev("OUT", "11:38", null, { tipo: "AUDIO" }),
  ev("IN", "11:42", "Si señora esta correcto"),
  ev("IN", "11:46", "En la tarde"),
  ev("IN", "11:46", "ella se llama Danna"),
  ev("IN", "11:46", "apenas ella esta alla"),
  ev("IN", "11:46", "te enviaria la transferencia"),
  ev("IN", "11:46", "es el 50%"),
  ev("IN", "11:46", "cierto"),
  ev("OUT", "11:47", null, { tipo: "AUDIO" }),
  ev("IN", "11:48", "Mil gracias"),
  ev("OUT", "11:49", "Gracias a ti"),
  ev("OUT", "12:57", "¡Hola! ¿Pudiste ver lo que te envié? 😊 Si tienes alguna duda, aquí estoy.", { origen: "follow" }),
  ev("IN", "13:20", "Si señora está bien"),
];
const AHORA_REAL = bog("15:20");
function chatReal(extra = {}, mensajes = CHARLA_REAL) {
  const delCliente = mensajes.filter((m) => m.direccion === "IN");
  const ultimaHumana = [...mensajes].reverse().find((m) => m.direccion === "OUT" && m.origen === "manual");
  return maria({
    conversationId: "real",
    etapa: "NEGOCIACION",
    nombreCliente: "Danna",
    asignadaEn: null,
    ultimoClienteEn: delCliente.at(-1).en,
    ultimaRespuestaHumanaEn: ultimaHumana.en,
    textosPendientes: delCliente.filter((m) => m.en > ultimaHumana.en).map((m) => m.texto ?? ""),
    textosDelCliente: delCliente.map((m) => m.texto ?? ""),
    mensajes,
    ...extra,
  });
}
const conPendiente = (...textos) => [...CHARLA_REAL.slice(0, -1), ...textos.map((t) => ev("IN", "13:20", t))];

await prueba("acuse real (13-oct): «Si señora está bien» tras datos + compromiso de pago + cierre → NO es caliente esperando, ni aviso ni escalada", () => {
  const sin = chatReal({ mensajes: undefined });
  // Sin los mensajes del chat (como antes): el detector lo tomaba como caliente esperando 2 h.
  assert.ok(det.detectarAtencion([sin], AHORA_REAL).some((h) => h.clave === "ATENCION:caliente-esperando:maria"), "reproduce la falla sin mensajes");
  const real = chatReal();
  const e = det.estadoDeEspera(real, AHORA_REAL);
  assert.equal(e.esperando, true);
  assert.equal(e.cierre, true);
  assert.ok(e.acuse, "solo acusa recibo de un acuerdo");
  assert.equal(e.acuse.tipo, "compromiso");
  assert.ok(!det.detectarAtencion([real], AHORA_REAL).some((h) => h.evidencia.chats.includes("real")), "ningún hallazgo con el chat");
  assert.deepEqual(r.calientesFueraDeHorario([real], AHORA_REAL, 15), []);
  const res = vuelta(r.estadoVacio(), { chats: [real], hallazgos: det.detectarAtencion([real], AHORA_REAL), ahora: AHORA_REAL });
  assert.deepEqual(res.eventos, []);
  assert.deepEqual(Object.keys(res.estado.acciones), []);
});

await prueba("acuse: el mensaje sugerido no pide cotización / ciudad y cantidad a quien ya dio sus datos y prometió pagar", () => {
  for (const chat of [chatReal(), chatReal({ mensajes: undefined })]) {
    const s = det.sugeridoParaElChat(chat, AHORA_REAL, "Danna");
    assert.ok(!/cotizaci[oó]n|ciudad y la cantidad/i.test(s), `sugerido incoherente: ${s}`);
  }
  assert.match(det.sugeridoParaElChat(chatReal(), AHORA_REAL, "Danna"), /la transferencia que me ibas a enviar en la tarde/);
  // Solo con los textos del cliente (sin mensajes): retoma los datos ya enviados.
  const soloDatos = chatReal({ mensajes: undefined, textosDelCliente: [DATOS_COTIZACION, "Si señora esta correcto"] });
  assert.match(det.sugeridoParaElChat(soloDatos, AHORA_REAL, "Danna"), /Ya tengo tus datos del pedido/);
  // Sin acuerdo, el que pide cotización sigue recibiendo la plantilla de cotización.
  const pide = maria({ textosPendientes: ["me puedes enviar la cotización"], textosDelCliente: ["me puedes enviar la cotización"] });
  assert.match(det.sugeridoParaElChat(pide, T0, "Laura"), /Te preparo la cotización/);
});

await prueba("acuse: SIGUE siendo tarea si el acuse trae pregunta o señal de compra nueva, o contesta una pregunta de la asesora", () => {
  const sigue = (mensajes, motivo) => {
    const chat = chatReal({}, mensajes);
    const e = det.estadoDeEspera(chat, AHORA_REAL);
    assert.equal(e.acuse, null, motivo);
    assert.equal(e.cierre, false, motivo);
    assert.ok(det.detectarAtencion([chat], AHORA_REAL).some((h) => h.clave === "ATENCION:caliente-esperando:maria"), motivo);
  };
  sigue(conPendiente("ok, y el envío cuánto?"), "pregunta por el envío");
  sigue(conPendiente("ok y el envio cuanto sale"), "pregunta sin signo");
  sigue(conPendiente("de una"), "aceptar es señal de compra");
  sigue(conPendiente("listo", "quiero también la silla"), "pide algo nuevo");
  // La asesora preguntó y el cliente dice "sí": es una respuesta, no un acuse.
  const pregunta = [...CHARLA_REAL.slice(0, 11), ev("OUT", "11:49", "¿Te separo también el lavacabezas?"), ev("IN", "13:20", "Si señora")];
  sigue(pregunta, "sí a una pregunta de la asesora");
  // Sin persona en el chat no hay acuerdo con nadie.
  const soloBot = [ev("IN", "11:30", DATOS_COTIZACION), ev("OUT", "11:31", "Gracias, ya te atiende una asesora", { origen: null }), ev("IN", "13:20", "ok")];
  assert.equal(acuse.soloAcusaReciboDeUnAcuerdo({ mensajes: soloBot }), null);
});

await prueba("acuse: cierre solo, y acuse que contesta a un seguimiento automático, tampoco son tarea", () => {
  const cierre = [
    ev("IN", "10:00", "Cuánto vale la camilla?"),
    ev("OUT", "10:05", "Vale $890.000 con envío incluido"),
    ev("IN", "10:10", "Muchas gracias"),
    ev("OUT", "10:11", "Con gusto"),
    ev("IN", "10:30", "👍"),
  ];
  assert.equal(acuse.soloAcusaReciboDeUnAcuerdo({ mensajes: cierre })?.tipo, "cierre");
  const automatico = [
    ev("IN", "10:00", "Me mandas fotos del lavacabezas"),
    ev("OUT", "10:05", "Claro, aquí están las fotos 😊"),
    ev("OUT", "11:05", "¡Hola! ¿Pudiste ver lo que te envié? 😊", { origen: "follow" }),
    ev("IN", "11:30", "Si"),
  ];
  assert.equal(acuse.soloAcusaReciboDeUnAcuerdo({ mensajes: automatico })?.tipo, "seguimiento_automatico");
  // La asesora había preguntado: el "sí" al automático no basta (puede ser un sí a la compra).
  const pregunto = [automatico[0], ev("OUT", "10:05", "Aquí están las fotos. ¿Te lo separo?"), ...automatico.slice(2)];
  assert.equal(acuse.soloAcusaReciboDeUnAcuerdo({ mensajes: pregunto }), null);
  // Sticker después del cierre también es acuse.
  const sticker = [...CHARLA_REAL.slice(0, -1), ev("IN", "13:20", null, { tipo: "STICKER" })];
  assert.ok(acuse.soloAcusaReciboDeUnAcuerdo({ mensajes: sticker }));
});

await prueba("acuse: una acción abierta (aunque ESCALADA) se cierra como YA_NO_APLICA en la siguiente vuelta; un PAGO no", () => {
  const sin = chatReal({ mensajes: undefined });
  const h = det.detectarAtencion([sin], AHORA_REAL);
  let res = vuelta(r.estadoVacio(), { chats: [sin], hallazgos: h, ahora: AHORA_REAL });
  res = vuelta(res.estado, { chats: [sin], hallazgos: h, ahora: mas(AHORA_REAL, 15) });
  res = vuelta(res.estado, { chats: [sin], ahora: mas(AHORA_REAL, 25) });
  assert.equal(res.estado.acciones.real.estado, "ESCALADA");
  res = vuelta(res.estado, { chats: [chatReal()], ahora: mas(AHORA_REAL, 30) });
  assert.equal(res.estado.acciones.real.estado, "YA_NO_APLICA");
  assert.deepEqual(res.eventos, []);
  // Pago: nunca se cierra por acuse.
  const pago = vuelta(r.estadoVacio(), { chats: [sin], hallazgos: [hallazgo("ATENCION:pago-sin-respuesta:maria", ["real"])], ahora: AHORA_REAL });
  assert.equal(pago.estado.acciones.real.tipo, "pago");
  const despues = vuelta(pago.estado, { chats: [chatReal()], ahora: mas(AHORA_REAL, 5) });
  assert.equal(despues.estado.acciones.real.estado, "AVISADA");
});

await prueba("acuse: la alerta de atención abierta suelta el chat y se cierra RESUELTA si queda vacía; la de pago no se toca", () => {
  const inc = (clave, chats) => ({ clave, familia: "ATENCION", severidad: "IMPORTANTE", estado: "ABIERTA", titulo: clave, primeraVezEn: T0, hallazgos: [hallazgo(clave, chats)] });
  const abiertos = [
    inc("ATENCION:caliente-esperando:maria", ["real"]),
    inc("ATENCION:caliente-esperando:ingrid", ["real", "otro"]),
    inc("ATENCION:pago-sin-respuesta:maria", ["real"]),
  ];
  const { incidentes, cambiados } = exclusionesAcuse.purgarAcusesConAcuerdo(abiertos, new Set(["real"]), AHORA_REAL);
  assert.equal(cambiados, 2);
  assert.equal(incidentes[0].estado, "RESUELTA");
  assert.equal(incidentes[1].estado, "ABIERTA");
  assert.deepEqual(incidentes[1].hallazgos[0].evidencia.chats, ["otro"]);
  assert.deepEqual(incidentes[2], abiertos[2]);
});


await prueba("acuse: cierre corto (\"Ok\" tras la asesora, sin pregunta ni promesa) no es espera; con pregunta, promesa, compra o sin persona sí", () => {
  const charla = (asesora, cliente, extra = {}) => [ev("IN", "08:00", "Hola, info del combo"), ev("OUT", "09:01", asesora), ev("IN", "09:02", cliente, extra)];
  const cierraCorto = (asesora, cliente, extra) => assert.equal(acuse.soloAcusaReciboDeUnAcuerdo({ mensajes: charla(asesora, cliente, extra) })?.tipo, "cierre_corto", `${asesora} / ${cliente}`);
  cierraCorto("Quedamos al pendiente", "Ok"); // María 573112022514
  cierraCorto("Te quedamos atentos a lo que necesites", "Ok"); // Ingrid 573206587833
  for (const t of ["Listo", "Gracias", "Dale", "Perfecto", "👍", "okey"]) {
    const e = acuse.soloAcusaReciboDeUnAcuerdo({ mensajes: charla("Quedamos al pendiente", t) });
    // "dale" puede ser un sí a la compra: solo cuenta si no es señal de compra.
    if (t !== "Dale") assert.equal(e?.tipo, "cierre_corto", t);
  }
  assert.equal(acuse.soloAcusaReciboDeUnAcuerdo({ mensajes: charla("Quedamos al pendiente", null, { tipo: "STICKER" }) })?.tipo, "cierre_corto");
  assert.equal(acuse.soloAcusaReciboDeUnAcuerdo({ mensajes: charla("Quedamos al pendiente", "👍", { tipo: "REACTION" }) })?.tipo, "cierre_corto");
  // Sí debe quedar como espera.
  assert.equal(acuse.soloAcusaReciboDeUnAcuerdo({ mensajes: charla("¿Te separo el combo?", "ok") }), null, "la asesora preguntó");
  assert.equal(acuse.soloAcusaReciboDeUnAcuerdo({ mensajes: charla("Ya te envío las fotos", "ok") }), null, "promesa sin cumplir");
  assert.equal(acuse.soloAcusaReciboDeUnAcuerdo({ mensajes: charla("Quedamos al pendiente", "Ok, ¿y el envío?") }), null, "pregunta del cliente");
  assert.equal(acuse.soloAcusaReciboDeUnAcuerdo({ mensajes: charla("Quedamos al pendiente", "de una") }), null, "señal de compra");
  assert.equal(acuse.soloAcusaReciboDeUnAcuerdo({ mensajes: charla("Quedamos al pendiente", "Ya pagué") }), null, "pago");
  assert.equal(acuse.soloAcusaReciboDeUnAcuerdo({ mensajes: [ev("IN", "09:01", "ok")] }), null, "nadie respondió");
  // El detector no avisa y la alerta ya abierta se cierra en la siguiente vuelta.
  const chat = chatReal({}, charla("Quedamos al pendiente", "Ok"));
  const e = det.estadoDeEspera(chat, AHORA_REAL);
  assert.ok(e.acuse && e.cierre, "estadoDeEspera lo trata como cierre");
  assert.equal(det.detectarAtencion([chat], AHORA_REAL).some((h) => h.clave === "ATENCION:caliente-esperando:maria"), false);
});

console.log(`\n${pruebas} pruebas OK`);
