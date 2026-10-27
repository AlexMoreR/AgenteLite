// Pruebas de la CAJA CORTA de las prioridades del Supervisor (src/features/supervisor-accionable/dominio/caja-corta.ts).
// Las tarjetas se arman con el mismo código que arma las alertas de la pantalla (reglas.ts).
// Correr: node scripts/check-caja-del-supervisor.mjs
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

const r = cargar("src/features/supervisor-accionable/dominio/reglas.ts");
const c = cargar("src/features/supervisor-accionable/dominio/caja-corta.ts");

const incidente = (titulo, que, extra = {}) =>
  r.tarjetaDeIncidente({
    clave: extra.clave ?? "BOT:comportamiento:rafagas",
    familia: "BOT",
    severidad: extra.severidad ?? "CRITICO",
    titulo,
    primeraVezEn: new Date(extra.desde ?? "2026-10-25T15:00:00Z"),
    hallazgos: [{ severidad: extra.severidad ?? "CRITICO", que, leadsAfectados: extra.leads ?? 47, impacto: "x", recomendacion: "y", queCambiar: "z" }],
  });

let pruebas = 0;
const ok = (nombre, fn) => {
  fn();
  pruebas++;
  console.log(`✔ ${nombre}`);
};

ok("ráfagas con 47 leads: frase sencilla, bot, CRÍTICO, sin recordatorios", () => {
  const t = incidente("El bot está soltando ráfagas de mensajes al entrar", "Hay ráfagas de más de 3 mensajes en 5 min (v12)");
  const k = c.cajaCortaDe(t);
  assert.equal(k.frase, "🤖 El bot habla demasiado en el primer contacto.");
  assert.equal(k.leads, 47);
  assert.equal(k.responsable, "Bot / sistema");
  assert.equal(k.insignia, "🚨 CRÍTICO");
  assert.match(k.colorInsignia, /red/);
  assert.equal(k.recordatorios, null);
  assert.equal(k.desde, "25-oct");
});

ok("las otras frases conocidas", () => {
  assert.equal(c.cajaCortaDe(incidente("El bot está repitiendo la misma pregunta", "x")).frase, "🤖 El bot repite la misma pregunta.");
  assert.equal(c.cajaCortaDe(incidente("El bot pregunta la ciudad cuando el cliente ya la dijo", "x")).frase, "🤖 El bot pregunta la ciudad cuando el cliente ya la dijo.");
  assert.equal(c.cajaCortaDe(incidente("El bot da precio o fotos antes de saber qué necesita el cliente", "x")).frase, "🤖 El bot da el precio antes de saber qué necesita el cliente.");
  assert.equal(c.cajaCortaDe(incidente("Alarma temprana: la respuesta de los clientes viene cayendo (CUSUM)", "x", { clave: "EMBUDO:respondio_2h_cusum:p" })).frase, "📉 Menos clientes están contestando.");
});

ok("la frase nunca trae términos técnicos", () => {
  const titulos = [
    "El cambio del libro V3 a la versión 12 rompe 2 escenario(s) dorado(s)",
    "Tasa de respuesta en 2 h (ventas): bajó 14 pts",
    "Vigilancia post-cambio del libro v12: empeoró",
    "Alarma CUSUM z = 3,2 en el embudo",
    "Una regla nueva se quedó con el primer mensaje del Combo ráfaga",
  ];
  for (const titulo of titulos) {
    const frase = c.cajaCortaDe(incidente(titulo, "x", { clave: "CAMBIO:libro:v12" })).frase;
    assert.ok(!/v\d+|versión|pts|CUSUM|z =|\(/i.test(frase.replace(/Combo ráfaga/, "")), `frase técnica: ${frase}`);
    assert.ok(frase.length > 6);
  }
  assert.ok(!/ráfaga/i.test(c.cajaCortaDe(incidente("El bot está soltando ráfagas de mensajes al entrar", "x")).frase));
});

const ahora = new Date("2026-10-26T15:00:00Z");
const accion = (extra = {}) => ({
  id: "chat-1",
  tipo: "caliente",
  conversationId: "chat-1",
  claveAlerta: null,
  responsableId: "ingrid",
  responsableNombre: "Ingrid Sanchez",
  responsableEsSupervisora: false,
  cliente: "Laura Gómez",
  telefono: "3001234567",
  numero: 1001,
  frase: "cuánto cuesta",
  motivo: "Cliente caliente esperando respuesta",
  mensajeSugerido: null,
  riesgo: "VENTA",
  esperandoDesde: "2026-10-26T13:30:00Z",
  plazoMin: 15,
  estado: "ESCALADA",
  detectadaEn: "2026-10-26T13:35:00Z",
  avisadaEn: "2026-10-26T13:40:00Z",
  venceEn: "2026-10-26T13:55:00Z",
  segundoAvisoEn: null,
  segundoAvisoA: null,
  escaladaEn: "2026-10-26T14:20:00Z",
  gravedadEscalada: "IMPORTANTE",
  ...extra,
});

ok("asesora con segundo aviso: su nombre y 'Ya se le recordó 2 veces'; sin segundo aviso, 1", () => {
  const dos = c.cajaCortaDe(r.tarjetaDeAccion(accion({ segundoAvisoEn: "2026-10-26T14:00:00Z" }), ahora));
  assert.equal(dos.responsable, "Ingrid Sanchez");
  assert.equal(dos.recordatorios, 2);
  assert.equal(dos.frase, "👤 Cliente caliente esperando respuesta.");
  assert.equal(dos.leads, 1);
  assert.equal(dos.insignia, "⚠️ IMPORTANTE");
  assert.match(dos.colorInsignia, /amber/);
  assert.ok(!/hace|cuánto|min/.test(dos.frase));
  assert.equal(c.cajaCortaDe(r.tarjetaDeAccion(accion(), ahora)).recordatorios, 1);
});

ok("patrón con 3 chats: salen 3 leads", () => {
  const patron = accion({
    id: "patron:ingrid:dia",
    tipo: "patron_dia",
    conversationId: null,
    motivo: "Ingrid Sanchez dejó vencer 3 plazos hoy (umbral 3)",
    cliente: "3 chats",
    idsDeChats: ["a", "b", "c"],
    segundoAvisoEn: "2026-10-26T14:00:00Z",
  });
  const estado = { acciones: {}, historial: [] };
  const k = c.cajaCortaDe(r.tarjetaDeAccion(patron, ahora, estado));
  assert.equal(k.leads, 3);
  assert.equal(k.frase, "👤 Ingrid Sanchez dejó vencer 3 plazos hoy.");
});

ok("fecha corta en hora de Bogotá, también cerca de la medianoche", () => {
  assert.equal(c.fechaCorta("2026-10-25T15:00:00Z"), "25-oct");
  assert.equal(c.fechaCorta("2026-10-26T04:59:00Z"), "25-oct"); // 11:59 p. m. del 25 en Bogotá
  assert.equal(c.fechaCorta("2026-10-26T05:00:00Z"), "26-oct"); // 12:00 a. m. del 26
  assert.equal(c.fechaCorta("nada"), null);
});

ok("observación: 👀 OBSERVACIÓN en gris", () => {
  const k = c.cajaCortaDe(r.tarjetaDeAccion(accion({ gravedadEscalada: "OBSERVACION" }), ahora));
  assert.equal(k.insignia, "👀 OBSERVACIÓN");
  assert.match(k.colorInsignia, /muted/);
});

ok("sin número de leads en el texto: no se inventa", () => {
  const t = { ...incidente("El bot repite la pregunta", "x"), cliente: "Todos los leads de la línea / producto" };
  assert.equal(c.cajaCortaDe(t).leads, null);
});

console.log(`\n${pruebas} pruebas OK`);
