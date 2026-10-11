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

console.log(`\n${pruebas} pruebas OK`);
