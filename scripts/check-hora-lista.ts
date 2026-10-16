import assert from "node:assert/strict";

import { horaDeLista } from "../src/lib/hora-de-lista";

// "Ahora" = jueves 15-oct-2026, 7:40 p. m. en Bogotá (00:40 UTC del 16).
const ahora = new Date("2026-10-16T00:40:00Z");
const bog = (iso: string) => new Date(iso + "-05:00");

const casos: Array<[string, Date, (r: string) => boolean]> = [
  ["hoy muestra la hora", bog("2026-10-15T19:35:00"), r => /07:35/.test(r) && /p/.test(r)],
  ["hoy a las 00:10 sigue siendo hoy", bog("2026-10-15T00:10:00"), r => /12:10|00:10/.test(r)],
  ["ayer", bog("2026-10-14T23:59:00"), r => r === "Ayer"],
  ["hace 2 días: martes", bog("2026-10-13T10:00:00"), r => r === "Martes"],
  ["hace 6 días: viernes", bog("2026-10-09T10:00:00"), r => r === "Viernes"],
  ["hace 7 días: fecha", bog("2026-10-08T10:00:00"), r => r === "08/10/2026"],
  ["año anterior: fecha", bog("2025-12-31T22:00:00"), r => r === "31/12/2025"],
  ["fecha inválida", new Date("x"), r => r === ""],
];

let ok = 0;
for (const [nombre, fecha, prueba] of casos) {
  const r = horaDeLista(fecha, ahora);
  assert.ok(prueba(r), `${nombre}: salió "${r}"`);
  ok++;
}
console.log(`${ok} pruebas de la hora en la lista de chats: OK`);
