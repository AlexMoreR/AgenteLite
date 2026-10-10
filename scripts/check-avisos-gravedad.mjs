// Pruebas de los AVISOS POR GRAVEDAD (src/features/avisos-gravedad/dominio/reglas.ts): interruptor,
// clasificación de cada aviso (bot y Supervisor), canales, enfriamiento, detector de "ya pagué" y
// resumen del día. No necesita base ni red.
// Correr: npm run test:avisos-gravedad
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

const r = cargar("src/features/avisos-gravedad/dominio/reglas.ts");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}
const M = 60_000;
// Fechas fijas: martes 6-oct 10:00 Bogotá = 15:00 UTC (en horario laboral).
const EN_HORARIO = new Date("2026-10-06T15:00:00Z");
const FUERA = new Date("2026-10-07T02:00:00Z"); // martes 21:00 Bogotá

function hallazgo(extra = {}) {
  return {
    clave: "X",
    familia: "ATENCION",
    severidad: "IMPORTANTE",
    titulo: "t",
    que: "q",
    desde: new Date(EN_HORARIO.getTime() - 20 * M),
    producto: null,
    asesoraId: "ingrid",
    leadsAfectados: 1,
    evidencia: { chats: ["c1"], reglas: [], versiones: [] },
    metrica: "",
    esperado: "",
    observado: "",
    hechos: [],
    hipotesis: [],
    causaPosible: "",
    impacto: "",
    recomendacion: "",
    queCambiar: "",
    riesgo: "",
    comoMedir: "",
    tocaProduccion: false,
    ...extra,
  };
}
function inc(clave, severidad, extra = {}, h = {}) {
  const familia = extra.familia ?? (clave.startsWith("ATENCION") ? "ATENCION" : clave.startsWith("EMBUDO") ? "EMBUDO" : "BOT");
  return { clave, familia, severidad, desde: extra.desde ?? new Date(EN_HORARIO.getTime() - 20 * M), hallazgos: [hallazgo({ clave, familia, severidad, ...h })] };
}
const g = (i, ahora = EN_HORARIO) => r.clasificarIncidente(i, ahora).gravedad;

/* ------------------------------------------------------------------ interruptor */

prueba("interruptor: sin fila, JSON roto o activo≠true = APAGADO (lo de hoy)", () => {
  assert.equal(r.leerConfigGravedadDeTexto(null).activo, false);
  assert.equal(r.leerConfigGravedadDeTexto("{roto").activo, false);
  assert.equal(r.leerConfigGravedadDeTexto('{"activo":"si"}').activo, false);
  assert.deepEqual(r.leerConfigGravedadDeTexto(""), r.CONFIG_GRAVEDAD_POR_DEFECTO);
});

prueba("interruptor: lee número (solo dígitos), línea, enfriamiento con límites y WhatsApp apagable", () => {
  const c = r.leerConfigGravedadDeTexto(
    JSON.stringify({ activo: true, alexanderUserIds: ["u0", 3], whatsapp: { activo: false, numero: "+57 300 000 0000", canalId: "adm" }, enfriamientoMin: 1 }),
  );
  assert.equal(c.activo, true);
  assert.deepEqual(c.alexanderUserIds, ["u0"]);
  assert.equal(c.whatsapp.activo, false);
  assert.equal(c.whatsapp.numero, "573000000000");
  assert.equal(c.whatsapp.canalId, "adm");
  assert.equal(c.enfriamientoMin, 5);
  assert.equal(c.asignadoCriticoMin, 120);
});

/* ------------------------------------------------------------------ aviso del bot */

const destinos = [
  { numero: "570000002277", soloDe: null },
  { numero: "570000002225", soloDe: "ingrid", userId: "ingrid" },
  { numero: "570000006414", soloDe: "maria" },
];

prueba("bot: chat de Ingrid = OPERATIVO, solo a Ingrid; el administrador NO recibe WhatsApp", () => {
  const ruta = r.rutaDelAvisoDelBot({ duenoDelChat: "ingrid", destinos });
  assert.equal(ruta.gravedad, "OPERATIVO");
  assert.deepEqual(ruta.destinosWhatsApp.map((d) => d.numero.slice(-4)), ["2225"]);
  assert.equal(ruta.pushAlexander, false);
  assert.equal(ruta.pushAsesora, null);
});

prueba("bot: asesora sin número cargado = push del CRM a ella (no al administrador)", () => {
  const ruta = r.rutaDelAvisoDelBot({ duenoDelChat: "genesis", destinos });
  assert.equal(ruta.gravedad, "OPERATIVO");
  assert.equal(ruta.destinosWhatsApp.length, 0);
  assert.equal(ruta.pushAsesora, "genesis");
});

prueba("bot: sin dueña después del reparto (nadie disponible) = IMPORTANTE, push a Alexander sin WhatsApp", () => {
  const ruta = r.rutaDelAvisoDelBot({ duenoDelChat: null, destinos });
  assert.equal(ruta.gravedad, "IMPORTANTE");
  assert.equal(ruta.destinosWhatsApp.length, 0);
  assert.equal(ruta.pushAlexander, true);
  assert.deepEqual(r.canalesDe("IMPORTANTE", { whatsappActivo: true }), ["alexander_push"]);
});

/* ------------------------------------------------------------------ alertas del Supervisor */

prueba("caliente esperando 15–60 min = OPERATIVO (asesora); > 1 h en horario = CRÍTICO; fuera de horario = IMPORTANTE", () => {
  assert.equal(g(inc("ATENCION:caliente-esperando:ingrid", "IMPORTANTE")), "OPERATIVO");
  assert.equal(g(inc("ATENCION:caliente-esperando:ingrid", "CRITICO")), "CRITICO");
  assert.equal(g(inc("ATENCION:caliente-esperando:ingrid", "CRITICO"), FUERA), "IMPORTANTE");
});

prueba("asesora saturada (≥ 4 calientes) = IMPORTANTE; caliente sin dueña = IMPORTANTE", () => {
  assert.equal(g(inc("ATENCION:caliente-esperando:ingrid", "IMPORTANTE", {}, { leadsAfectados: 4 })), "IMPORTANTE");
  assert.equal(g(inc("ATENCION:caliente-esperando:sin-duena", "IMPORTANTE", {}, { asesoraId: null })), "IMPORTANTE");
});

prueba("asignado sin respuesta: < 2 h = OPERATIVO; > 2 h (aunque no sea Caliente) en horario = CRÍTICO", () => {
  assert.equal(g(inc("ATENCION:asignado-sin-respuesta:ingrid", "IMPORTANTE", {}, { valores: { minutosMaximo: 90 } })), "OPERATIVO");
  assert.equal(g(inc("ATENCION:asignado-sin-respuesta:ingrid", "IMPORTANTE", {}, { valores: { minutosMaximo: 130 } })), "CRITICO");
  assert.equal(g(inc("ATENCION:asignado-sin-respuesta:ingrid", "CRITICO", {}, { valores: { minutosMaximo: 130 } }), FUERA), "IMPORTANTE");
});

prueba("señal de compra sin asesora: < 30 min = OBSERVACIÓN (todavía nada); ≥ 30 min = IMPORTANTE", () => {
  const joven = inc("ATENCION:senal-sin-duena", "IMPORTANTE", { desde: new Date(EN_HORARIO.getTime() - 12 * M) }, { asesoraId: null });
  const vieja = inc("ATENCION:senal-sin-duena", "IMPORTANTE", { desde: new Date(EN_HORARIO.getTime() - 35 * M) }, { asesoraId: null });
  assert.equal(g(joven), "OBSERVACION");
  assert.equal(g(vieja), "IMPORTANTE");
});

prueba("oportunidades a retomar y tareas sin dueña de observación = OBSERVACIÓN (solo resumen)", () => {
  assert.equal(g(inc("ATENCION:oportunidades-a-retomar", "OBSERVACION", {}, { asesoraId: null })), "OBSERVACION");
  assert.equal(g(inc("ATENCION:tareas-sin-duena", "OBSERVACION", {}, { asesoraId: null })), "OBSERVACION");
  assert.deepEqual(r.canalesDe("OBSERVACION", { whatsappActivo: true }), ["resumen"]);
});

prueba("'ya pagué' sin respuesta = CRÍTICO en horario", () => {
  assert.equal(g(inc("ATENCION:pago-sin-respuesta:ingrid", "CRITICO")), "CRITICO");
  assert.equal(g(inc("ATENCION:pago-sin-respuesta:ingrid", "CRITICO"), FUERA), "IMPORTANTE");
});

prueba("bot / embudo / cambio del libro: CRÍTICO → CRÍTICO, IMPORTANTE → IMPORTANTE, OBSERVACIÓN → resumen", () => {
  assert.equal(g(inc("INC:libro-v182:combo-camilla", "CRITICO", { familia: "BOT" })), "CRITICO");
  assert.equal(g(inc("EMBUDO:respondio_2h:combo", "IMPORTANTE", { familia: "EMBUDO" })), "IMPORTANTE");
  assert.equal(g(inc("INC:libro-v209:combo-camilla", "OBSERVACION", { familia: "CAMBIO" })), "OBSERVACION");
  // Fuera de horario un incidente del bot sigue siendo crítico (no depende de las asesoras).
  assert.equal(g(inc("INC:libro-v182:combo-camilla", "CRITICO", { familia: "BOT" }), FUERA), "CRITICO");
});

prueba("canales: CRÍTICO = push + WhatsApp; con el WhatsApp apagado, solo push; OPERATIVO va a la asesora", () => {
  assert.deepEqual(r.canalesDe("CRITICO", { whatsappActivo: true }), ["alexander_push", "alexander_whatsapp"]);
  assert.deepEqual(r.canalesDe("CRITICO", { whatsappActivo: false }), ["alexander_push"]);
  assert.deepEqual(r.canalesDe("OPERATIVO", { whatsappActivo: true, asesoraTieneWhatsApp: true }), ["asesora_whatsapp"]);
  assert.deepEqual(r.canalesDe("OPERATIVO", { whatsappActivo: true }), ["asesora_push"]);
});

/* ------------------------------------------------------------------ enfriamiento */

const marca = (extra = {}) => ({ gravedad: "CRITICO", pushEn: null, pushLeads: 0, waEn: null, waLeads: 0, vistoEn: EN_HORARIO.toISOString(), ...extra });
const hace = (min) => new Date(EN_HORARIO.getTime() - min * M).toISOString();

prueba("WhatsApp: el primero sale; máximo 1 por incidente; otro solo si EMPEORÓ y pasaron 60 min", () => {
  const base = { ahora: EN_HORARIO, enfriamientoMin: 60 };
  assert.equal(r.decidirWhatsApp({ ...base, marca: null, leads: 1 }), true);
  assert.equal(r.decidirWhatsApp({ ...base, marca: marca({ waEn: hace(10), waLeads: 1 }), leads: 1 }), false);
  assert.equal(r.decidirWhatsApp({ ...base, marca: marca({ waEn: hace(10), waLeads: 1 }), leads: 5 }), false, "empeoró pero antes de 60 min");
  assert.equal(r.decidirWhatsApp({ ...base, marca: marca({ waEn: hace(90), waLeads: 1 }), leads: 1 }), false, "igual después de 60 min");
  assert.equal(r.decidirWhatsApp({ ...base, marca: marca({ waEn: hace(90), waLeads: 1 }), leads: 2 }), true, "empeoró y pasaron 60 min");
});

prueba("push: primero sí; sube de gravedad = sí ya; igual = no; recordatorio del Supervisor pasado el enfriamiento = sí", () => {
  const base = { ahora: EN_HORARIO, enfriamientoMin: 60 };
  assert.equal(r.decidirPush({ ...base, marca: null, gravedad: "IMPORTANTE", leads: 1 }), true);
  assert.equal(r.decidirPush({ ...base, marca: marca({ gravedad: "OPERATIVO", pushEn: hace(5), pushLeads: 1 }), gravedad: "CRITICO", leads: 1 }), true);
  assert.equal(r.decidirPush({ ...base, marca: marca({ gravedad: "IMPORTANTE", pushEn: hace(5), pushLeads: 1 }), gravedad: "IMPORTANTE", leads: 3 }), false);
  assert.equal(r.decidirPush({ ...base, marca: marca({ gravedad: "IMPORTANTE", pushEn: hace(70), pushLeads: 1 }), gravedad: "IMPORTANTE", leads: 1 }), false);
  assert.equal(r.decidirPush({ ...base, marca: marca({ gravedad: "IMPORTANTE", pushEn: hace(70), pushLeads: 1 }), gravedad: "IMPORTANTE", leads: 2 }), true);
  assert.equal(r.decidirPush({ ...base, marca: marca({ gravedad: "CRITICO", pushEn: hace(70), pushLeads: 1 }), gravedad: "CRITICO", leads: 1, recordatorio: true }), true);
});

/* ------------------------------------------------------------------ detector "ya pagué" */

function chat(extra = {}) {
  return {
    conversationId: "c1",
    asesoraId: "ingrid",
    asesoraNombre: "Ingrid",
    etapa: "NEGOCIACION",
    ultimoClienteEn: new Date(EN_HORARIO.getTime() - 35 * M),
    ultimaRespuestaHumanaEn: new Date(EN_HORARIO.getTime() - 90 * M),
    textosPendientes: ["Listo ya te transferí, te mando el comprobante"],
    telefono: "573000000000",
    ...extra,
  };
}

prueba("'ya pagué' / comprobante: 35 min sin respuesta = hallazgo CRÍTICO de la asesora; 20 min = nada", () => {
  const h = r.detectarPagoSinRespuesta([chat()], EN_HORARIO);
  assert.equal(h.length, 1);
  assert.equal(h[0].clave, "ATENCION:pago-sin-respuesta:ingrid");
  assert.equal(h[0].severidad, "CRITICO");
  assert.equal(h[0].familia, "ATENCION");
  assert.equal(r.detectarPagoSinRespuesta([chat({ ultimoClienteEn: new Date(EN_HORARIO.getTime() - 20 * M) })], EN_HORARIO).length, 0);
});

prueba("'ya pagué': no sale si la asesora ya respondió, si está GANADO o si no habla de pago", () => {
  assert.equal(r.detectarPagoSinRespuesta([chat({ ultimaRespuestaHumanaEn: new Date(EN_HORARIO.getTime() - 5 * M) })], EN_HORARIO).length, 0);
  assert.equal(r.detectarPagoSinRespuesta([chat({ etapa: "GANADO" })], EN_HORARIO).length, 0);
  assert.equal(r.detectarPagoSinRespuesta([chat({ textosPendientes: ["cuanto vale el envío?"] })], EN_HORARIO).length, 0);
});

/* ------------------------------------------------------------------ resumen */

prueba("resumen: cuenta incidentes únicos por gravedad (no por vuelta) y arma el bloque del Cierre del día", () => {
  let s = r.resumenVacio("2026-10-06");
  s = r.anotar(s, { clave: "a", gravedad: "OBSERVACION", titulo: "Oportunidades", canales: ["resumen"], en: EN_HORARIO });
  s = r.anotar(s, { clave: "a", gravedad: "OBSERVACION", titulo: "Oportunidades", canales: ["resumen"], en: EN_HORARIO });
  s = r.anotar(s, { clave: "b", gravedad: "OPERATIVO", titulo: "Necesita atención", canales: ["asesora_whatsapp"], en: EN_HORARIO });
  s = r.anotar(s, { clave: "b", gravedad: "CRITICO", titulo: "Escaló", canales: ["alexander_push", "alexander_whatsapp"], en: EN_HORARIO });
  const c = r.conteoPorGravedad(s);
  assert.deepEqual(c, { OPERATIVO: 0, IMPORTANTE: 0, CRITICO: 1, OBSERVACION: 1 });
  assert.equal(s.envios.alexander_whatsapp, 1);
  // a (una vez), b operativo y b cuando escaló: la escalada sí deja su ejemplo.
  assert.equal(s.ejemplos.length, 3);
  const bloque = r.bloqueDelCierreDelDia(s);
  assert.match(bloque, /Críticos: 1 \(WhatsApp a Alexander: 1\)/);
  assert.match(bloque, /Observaciones \(sin mensaje\): 1/);
  assert.doesNotMatch(bloque, /\d{10}/, "sin teléfonos");
});

prueba("fecha de Bogotá: 23:30 de Bogotá sigue siendo el mismo día", () => {
  assert.equal(r.fechaBogota(new Date("2026-10-07T04:30:00Z")), "2026-10-06");
});

console.log(`\n${pruebas} pruebas de avisos por gravedad OK`);
