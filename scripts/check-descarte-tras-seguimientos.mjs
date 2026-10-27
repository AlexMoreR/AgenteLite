// Pruebas del DESCARTE TRAS LOS SEGUIMIENTOS (7 días con redes y descarte después). Sin base ni red.
// Correr: npm run test:descarte-tras-seguimientos
import assert from "node:assert/strict";
import fs from "node:fs";

import { RAIZ, cargar } from "./supervisor-cargar.mjs";

const reglas = cargar("src/features/crm/services/descarte-tras-seguimientos-reglas.ts");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const H = 3_600_000;
const DIA = 24 * H;
const T0 = new Date("2026-10-12T14:00:00Z");
const mas = (ms) => new Date(T0.getTime() + ms);

// Lead que entró al paso en T0: seguimientos a 15 min, 1 h, 1 día, 3 días y 7 días.
const SECUENCIA = [15 * 60_000, H, DIA, 3 * DIA, 7 * DIA];
const fila = (extra = {}) => ({
  etapa: "NUEVO",
  sieteEn: mas(7 * DIA),
  primeroEn: mas(15 * 60_000),
  ultimoClienteEn: null,
  senales: [],
  ...extra,
});

prueba("la secuencia final tiene 5 seguimientos y el descarte va después del de 7 días", () => {
  assert.equal(SECUENCIA.length, 5);
  assert.equal(reglas.DIAS_DEL_ULTIMO_SEGUIMIENTO, 7);
  // A los 3 días (el 4.º seguimiento) todavía no hay descarte: no existe el de 7 días.
  assert.deepEqual(reglas.decidirDescarte(fila({ sieteEn: null }), mas(3 * DIA + 30 * DIA)), { tipo: "no", motivo: "sin_siete_dias" });
});

prueba("un lead que nunca contesta queda Descartado solo al día 7 más el margen", () => {
  assert.equal(reglas.decidirDescarte(fila(), mas(7 * DIA)).motivo, "margen");
  assert.equal(reglas.decidirDescarte(fila(), mas(7 * DIA + 23 * H)).motivo, "margen");
  assert.deepEqual(reglas.decidirDescarte(fila(), mas(7 * DIA + 24 * H)), { tipo: "descartar" });
});

prueba("el margen se puede cambiar", () => {
  assert.deepEqual(reglas.decidirDescarte(fila(), mas(7 * DIA + 2 * H), 2), { tipo: "descartar" });
  assert.equal(reglas.decidirDescarte(fila(), mas(7 * DIA + 2 * H), 6).motivo, "margen");
});

prueba("si el cliente escribió después del primer seguimiento, no se descarta", () => {
  const tarde = mas(8 * DIA);
  assert.equal(reglas.decidirDescarte(fila({ ultimoClienteEn: mas(3 * DIA + H) }), tarde).motivo, "respondio");
  assert.equal(reglas.decidirDescarte(fila({ ultimoClienteEn: mas(7 * DIA + H) }), tarde).motivo, "respondio");
});

prueba("lo que el cliente escribió ANTES de los seguimientos no lo salva", () => {
  assert.deepEqual(reglas.decidirDescarte(fila({ ultimoClienteEn: mas(-H) }), mas(8 * DIA)), { tipo: "descartar" });
});

prueba("no descarta a Caliente, Ganado ni Perdido; sí a Nuevo, Frío y Tibio", () => {
  for (const etapa of ["NEGOCIACION", "GANADO", "PERDIDO"]) {
    assert.equal(reglas.decidirDescarte(fila({ etapa }), mas(9 * DIA)).motivo, "etapa", etapa);
  }
  for (const etapa of ["NUEVO", "CALIFICADO", "PROPUESTA"]) {
    assert.deepEqual(reglas.decidirDescarte(fila({ etapa }), mas(9 * DIA)), { tipo: "descartar" }, etapa);
  }
});

prueba("con señal de compra (precio, envío, ciudad) va a LLAMAR y no se descarta", () => {
  for (const tipo of ["precio", "envio_ciudad", "pide_cotizacion", "acepta_precio"]) {
    const d = reglas.decidirDescarte(fila({ senales: [tipo] }), mas(9 * DIA));
    assert.equal(d.tipo, "llamar", tipo);
  }
  assert.equal(reglas.tieneSenalDeCompra(["solo_mirando"]), false);
  assert.deepEqual(reglas.decidirDescarte(fila({ senales: ["solo_mirando"] }), mas(9 * DIA)), { tipo: "descartar" });
});

prueba("correrlo dos veces da el mismo resultado", () => {
  const ahora = mas(9 * DIA);
  assert.deepEqual(reglas.decidirDescarte(fila(), ahora), reglas.decidirDescarte(fila(), ahora));
  // Ya descartado (PERDIDO): la segunda corrida no lo toca.
  assert.equal(reglas.decidirDescarte(fila({ etapa: "PERDIDO" }), ahora).tipo, "no");
});

prueba("la respuesta a mitad de camino (entre el 3.º y el 4.º) evita el descarte", () => {
  const d = reglas.decidirDescarte(fila({ ultimoClienteEn: mas(2 * DIA) }), mas(9 * DIA));
  assert.equal(d.tipo, "no");
});

prueba("el servicio usa el candado de cotización, la bandera apagada y el tope por corrida", () => {
  const src = fs.readFileSync(`${RAIZ}/src/features/crm/services/descarte-tras-seguimientos.ts`, "utf8");
  assert.match(src, /avisoSiNoSePuedeDescartar/);
  assert.match(src, /return fila\?\.value === "on"/);
  assert.match(src, /TOPE_POR_CORRIDA = 50/);
  assert.match(src, /actorUserId: null/);
});

console.log(`\n${pruebas} pruebas ok`);
