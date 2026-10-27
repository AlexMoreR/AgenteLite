// Pruebas de la caja corta de "Prioridades de Alexander" (src/features/supervisor-accionable/dominio/caja-corta.ts).
// Las tarjetas las arma el mismo código que usa el Supervisor. Correr: node scripts/check-caja-del-supervisor.mjs
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

const r = cargar("src/features/supervisor-accionable/dominio/reglas.ts", {});
const c = cargar("src/features/supervisor-accionable/dominio/caja-corta.ts", {});

let n = 0;
const prueba = (nombre, fn) => {
  fn();
  n++;
  console.log(`ok - ${nombre}`);
};

const incidente = (titulo, leads, severidad = "CRITICO", familia = "BOT") =>
  r.tarjetaDeIncidente({
    clave: "bot:rafagas",
    familia,
    severidad,
    titulo,
    primeraVezEn: new Date("2026-10-25T15:00:00Z"),
    hallazgos: [{ severidad, leadsAfectados: leads, que: "En v12 hubo +8 pts de ráfagas (CUSUM)", impacto: "x", recomendacion: "y" }],
  });

const accion = (extra = {}) => ({
  id: "conv1",
  tipo: "caliente",
  conversationId: "conv1",
  claveAlerta: null,
  responsableId: "ingrid",
  responsableNombre: "Ingrid Sanchez",
  responsableEsSupervisora: false,
  cliente: "Laura Gómez",
  telefono: "Laura Gómez",
  numero: 12,
  frase: "cuánto cuesta",
  motivo: "Cliente caliente esperando respuesta",
  mensajeSugerido: null,
  riesgo: "VENTA",
  esperandoDesde: "2026-10-26T14:00:00Z",
  plazoMin: 15,
  estado: "ESCALADA",
  detectadaEn: "2026-10-26T14:05:00Z",
  avisadaEn: "2026-10-26T14:10:00Z",
  venceEn: "2026-10-26T14:25:00Z",
  segundoAvisoEn: null,
  segundoAvisoA: null,
  escaladaEn: "2026-10-26T15:00:00Z",
  gravedadEscalada: "CRITICO",
  motivoEscalada: "Venció el plazo",
  resueltaEn: null,
  resueltaPor: null,
  resueltaPorNombre: null,
  minutosHastaResolver: null,
  atendidaEn: null,
  atendidaPor: null,
  incumplida: true,
  vistoEn: "2026-10-26T15:00:00Z",
  ...extra,
});

prueba("ráfagas con 47 leads: frase, leads, responsable, insignia y sin recordatorios", () => {
  const t = incidente("El bot está soltando ráfagas de mensajes al entrar", 47);
  const k = c.cajaCorta(t);
  assert.equal(k.frase, "🤖 El bot habla demasiado en el primer contacto.");
  assert.equal(k.leads, 47);
  assert.equal(k.responsable, "Bot / sistema");
  assert.equal(k.insignia, "🚨 CRÍTICO");
  assert.equal(k.recordatorios, null);
  assert.equal(k.desde, "25-oct");
});

prueba("las frases del bot conocidas", () => {
  const f = (titulo) => c.cajaCorta(incidente(titulo, 3)).frase;
  assert.equal(f("El bot está repitiendo la misma pregunta"), "🤖 El bot repite la misma pregunta.");
  assert.equal(f("El bot pregunta la ciudad cuando el cliente ya la dijo"), "🤖 El bot pregunta la ciudad cuando el cliente ya la dijo.");
  assert.equal(f("El bot da precio o fotos antes de saber qué necesita el cliente"), "🤖 El bot da el precio antes de saber qué necesita el cliente.");
  assert.equal(f("Alarma temprana: la respuesta de los clientes viene cayendo (CUSUM)"), "📉 Menos clientes están contestando.");
});

prueba("la frase nunca trae términos técnicos", () => {
  const prohibido = /v\d+|versi[oó]n|\bpts?\b|r[aá]faga|cusum/i;
  for (const titulo of [
    "El bot está soltando ráfagas de mensajes al entrar",
    "Calificación F2 v12 bajó 8 pts (CUSUM)",
    "Regresión de la versión 14 del libro",
  ]) {
    const frase = c.cajaCorta(incidente(titulo, 5)).frase;
    assert.ok(!prohibido.test(frase), `"${frase}" trae un término técnico`);
  }
});

prueba("alerta de una asesora con segundo aviso: nombre y 2 recordatorios", () => {
  const a = accion({ estado: "SEGUNDO_AVISO", segundoAvisoEn: "2026-10-26T14:30:00Z" });
  const k = c.cajaCorta(r.tarjetaDeAccion(a, new Date("2026-10-26T16:00:00Z")));
  assert.equal(k.responsable, "Ingrid Sanchez");
  assert.equal(k.recordatorios, 2);
  assert.equal(c.textoDeRecordatorios(2), "🔁 Ya se le recordó 2 veces");
  assert.equal(k.leads, 1);
  assert.equal(k.frase, "👤 Cliente caliente sin respuesta.");
});

prueba("sin segundo aviso: 1 vez", () => {
  const k = c.cajaCorta(r.tarjetaDeAccion(accion(), new Date("2026-10-26T16:00:00Z")));
  assert.equal(k.recordatorios, 1);
  assert.equal(c.textoDeRecordatorios(1), "🔁 Ya se le recordó 1 vez");
});

prueba("patrón con 3 chats: 3 leads", () => {
  const chats = [1, 2, 3].map((i) => ({ conversationId: `c${i}`, cliente: `Cliente ${i}`, espera: "", plazo: null, situacion: "SIN_RESPUESTA", estado: "Sigue sin respuesta", enlace: "/x" }));
  const t = { ...r.tarjetaDeAccion(accion({ id: "patron:dia:ingrid:2026-10-26", tipo: "patron_dia", conversationId: null, motivo: "Respuesta lenta repetida de Ingrid", cliente: "3 chats" }), new Date("2026-10-26T16:00:00Z")), chats };
  assert.equal(c.cajaCorta(t).leads, 3);
});

prueba("sin número de leads, la línea no se inventa", () => {
  const t = incidente("El bot está repitiendo la misma pregunta", 0);
  assert.equal(c.cajaCorta(t).leads, null);
});

prueba("fecha en hora de Bogotá, también cerca de la medianoche", () => {
  assert.equal(c.fechaCorta("2026-10-25T15:00:00Z"), "25-oct");
  assert.equal(c.fechaCorta("2026-10-26T04:59:00Z"), "25-oct"); // 23:59 en Bogotá
  assert.equal(c.fechaCorta("2026-10-26T05:00:00Z"), "26-oct"); // 00:00 en Bogotá
  assert.equal(c.fechaCorta("nada"), "");
});

prueba("gravedad de observación: gris", () => {
  const t = { ...incidente("El bot está repitiendo la misma pregunta", 2), gravedad: "OBSERVACION" };
  assert.equal(c.cajaCorta(t).insignia, "👀 OBSERVACIÓN");
  assert.equal(c.INSIGNIA_DE_GRAVEDAD.IMPORTANTE, "⚠️ IMPORTANTE");
});

console.log(`\n${n} pruebas de la caja del Supervisor pasaron`);
