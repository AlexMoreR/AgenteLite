import assert from "node:assert/strict";

import { lineasDeLaPersona } from "../src/features/actividad/services/lineas-de-la-persona";

// 24 nov 2026, 3:42 p. m. en Bogotá = 20:42 UTC.
const ahora = new Date("2026-11-24T20:42:00Z");

// Sin datos: los dos textos de vacío.
assert.deepEqual(lineasDeLaPersona({ latido: null, ultimaAccion: null, ahora }), {
  conexion: "Sin registro todavía",
  conectadaAhora: false,
  accion: "Sin acciones en 30 días",
});

// Latido de hace 3 minutos: conectada ahora, con la hora de Colombia, pantalla y aparato.
const reciente = lineasDeLaPersona({
  latido: { cuando: "2026-11-24T20:39:00Z", donde: "Chats · Salón Rosa", aparato: "Android" },
  ultimaAccion: { texto: "Envió un mensaje", cliente: "Salón Rosa", cuando: new Date("2026-11-24T20:38:00Z") },
  ahora,
});
assert.equal(reciente.conexion, "Última conexión: 24 nov 2026, 3:39 p. m. · Chats · Salón Rosa · Android");
assert.equal(reciente.conectadaAhora, true);
assert.equal(reciente.accion, "Última acción: Envió un mensaje · Salón Rosa · 24 nov 2026, 3:38 p. m.");

// Justo en 6 minutos ya no cuenta como conectada; 5 sí.
const seis = lineasDeLaPersona({
  latido: { cuando: "2026-11-24T20:36:00Z", donde: "CRM", aparato: "Windows" },
  ultimaAccion: null,
  ahora,
});
assert.equal(seis.conectadaAhora, false);
assert.equal(
  lineasDeLaPersona({ latido: { cuando: "2026-11-24T20:37:00Z", donde: "CRM", aparato: "Windows" }, ultimaAccion: null, ahora })
    .conectadaAhora,
  true,
);

// Acción sin cliente: no deja un "·" de más. Fecha rota: como si no hubiera.
assert.equal(
  lineasDeLaPersona({ latido: null, ultimaAccion: { texto: "Asignó un chat", cliente: null, cuando: new Date("2026-11-20T15:00:00Z") }, ahora })
    .accion,
  "Última acción: Asignó un chat · 20 nov 2026, 10:00 a. m.",
);
const rota = lineasDeLaPersona({
  latido: { cuando: "no-es-fecha", donde: "CRM", aparato: "Mac" },
  ultimaAccion: { texto: "Llamó", cliente: "X", cuando: new Date("x") },
  ahora,
});
assert.equal(rota.conexion, "Sin registro todavía");
assert.equal(rota.conectadaAhora, false);
assert.equal(rota.accion, "Sin acciones en 30 días");

console.log("pruebas de las líneas de la persona en Equipo: OK");
