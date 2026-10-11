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
  assert.equal(c.maxPrioridades, 3, "nunca más de 3 prioridades");
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

await prueba("Prioridades de Alexander: máximo 3, críticas primero (pago > sistema > venta), luego las más viejas", () => {
  const base = { ...tarjetaEscalada };
  const tarjetas = [
    { ...base, id: "a", gravedad: "IMPORTANTE", riesgoOrden: "PATRON", desde: mas(T0, -50).toISOString() },
    { ...base, id: "b", gravedad: "CRITICO", riesgoOrden: "VENTA", desde: mas(T0, -10).toISOString() },
    { ...base, id: "c", gravedad: "CRITICO", riesgoOrden: "PAGO", desde: mas(T0, -5).toISOString() },
    { ...base, id: "d", gravedad: "CRITICO", riesgoOrden: "VENTA", desde: mas(T0, -30).toISOString() },
    { ...base, id: "e", gravedad: "CRITICO", riesgoOrden: "SISTEMA", desde: mas(T0, -1).toISOString() },
  ];
  const { visibles, resto } = r.prioridadesDeAlexander(tarjetas, 3);
  assert.deepEqual(visibles.map((t) => t.id), ["c", "e", "d"]);
  assert.deepEqual(resto.map((t) => t.id), ["b", "a"]);
  assert.equal(r.prioridadesDeAlexander(tarjetas, 10).visibles.length, 3, "nunca más de 3");
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

console.log(`\n${pruebas} pruebas OK`);
