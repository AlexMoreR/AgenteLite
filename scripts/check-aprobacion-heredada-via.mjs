// La aprobación heredada lleva la vía de la madre (partes y tarjetas que crea el Coordinador al partir o limpiar).
// Con zona protegida, /tomar exige la vía de la última aprobación (CONDICION_DE_LA_VIA / laAprobacionDejaArrancar):
// una parte con `heredadaDe` y sin `via` quedaba en PLAN_APROBADO para siempre (T-826 de T-818, T-773 de T-772).
// Prueba la regla en TypeScript, el SQL real contra PGlite (sin base ni red) y que trabajador.ts escribe la vía.
// Correr: npm run test:aprobacion-heredada-via
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { cargar } from "./supervisor-cargar.mjs";

const trabajo = cargar("src/features/tableros-inteligentes/services/reglas-trabajador.ts");
const sql = cargar("src/features/tableros-inteligentes/services/sql-trabajador.ts");

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

/* ── Escenario: id de tarjeta → sus aprobaciones ── */
const T = (n) => new Date(Date.UTC(2026, 10, 1, 0, n));
const historial = {
  madreVoz: [{ despues: { estado: "APROBADO", momento: "tarea", via: "voz" }, creadoEn: T(1) }],
  madreAuto: [{ despues: { estado: "APROBADO", momento: "tarea", via: "automatica" }, creadoEn: T(1) }],
  madreSinVia: [{ despues: { estado: "APROBADO", momento: "tarea" }, creadoEn: T(1) }],
  madreDeshecha: [{ despues: { via: "voz" }, creadoEn: T(1), deshechoEn: T(2) }],
  // T-826-like: heredada de una madre aprobada por voz, sin via.
  hijaDeVoz: [{ despues: { estado: "PLAN_APROBADO", momento: "plan", como: "heredada", heredadaDe: "madreVoz" }, creadoEn: T(3) }],
  hijaDeAuto: [{ despues: { estado: "APROBADO", momento: "tarea", como: "heredada", heredadaDe: "madreAuto" }, creadoEn: T(3) }],
  hijaDeSinVia: [{ despues: { como: "heredada", heredadaDe: "madreSinVia" }, creadoEn: T(3) }],
  hijaDeDeshecha: [{ despues: { como: "heredada", heredadaDe: "madreDeshecha" }, creadoEn: T(3) }],
  hijaDeHuerfana: [{ despues: { como: "heredada", heredadaDe: "noExiste" }, creadoEn: T(3) }],
  // La propia vía manda sobre la de la madre.
  hijaConVia: [{ despues: { como: "heredada", heredadaDe: "madreVoz", via: "pantalla" }, creadoEn: T(3) }],
  // Cadena: madreVoz -> hijaDeVoz -> nieta -> bisnieta -> tataranieta.
  nieta: [{ despues: { como: "heredada", heredadaDe: "hijaDeVoz" }, creadoEn: T(4) }],
  bisnieta: [{ despues: { como: "heredada", heredadaDe: "nieta" }, creadoEn: T(4) }],
  tataranieta: [{ despues: { como: "heredada", heredadaDe: "bisnieta" }, creadoEn: T(4) }],
  // Vale la última aprobación sin deshacer: una vieja con vía no cuenta si la nueva es heredada de una madre sin vía.
  rehecha: [
    { despues: { via: "pantalla" }, creadoEn: T(1) },
    { despues: { como: "heredada", heredadaDe: "madreSinVia" }, creadoEn: T(5) },
  ],
  ciclo: [{ despues: { como: "heredada", heredadaDe: "ciclo" }, creadoEn: T(1) }],
  sinAprobacion: [],
};
const ultimaVigente = (id) => {
  const filas = (historial[id] ?? []).filter((f) => !f.deshechoEn).sort((a, b) => b.creadoEn - a.creadoEn);
  return filas[0]?.despues ?? null;
};
const lector = async (id) => ultimaVigente(id);

await prueba("viaConHerencia (TS): usa la vía de la madre, y la propia manda", async () => {
  assert.equal(await trabajo.viaConHerencia("madreVoz", lector), "voz");
  assert.equal(await trabajo.viaConHerencia("hijaDeVoz", lector), "voz");
  assert.equal(await trabajo.viaConHerencia("hijaDeAuto", lector), "automatica");
  assert.equal(await trabajo.viaConHerencia("hijaConVia", lector), "pantalla");
  assert.equal(await trabajo.viaConHerencia("nieta", lector), "voz", "dos niveles");
  assert.equal(await trabajo.viaConHerencia("bisnieta", lector), "voz", "tres niveles");
});

await prueba("viaConHerencia (TS): sin vía válida en la cadena, no inventa ninguna", async () => {
  assert.equal(await trabajo.viaConHerencia("madreSinVia", lector), "");
  assert.equal(await trabajo.viaConHerencia("hijaDeSinVia", lector), "");
  assert.equal(await trabajo.viaConHerencia("hijaDeDeshecha", lector), "", "la aprobación de la madre se deshizo");
  assert.equal(await trabajo.viaConHerencia("hijaDeHuerfana", lector), "");
  assert.equal(await trabajo.viaConHerencia("tataranieta", lector), "", "más de 3 niveles ya no cuenta");
  assert.equal(await trabajo.viaConHerencia("rehecha", lector), "", "la última vigente es la heredada de una madre sin vía");
  assert.equal(await trabajo.viaConHerencia("ciclo", lector), "", "un ciclo no cuelga");
  assert.equal(await trabajo.viaConHerencia("sinAprobacion", lector), "");
});

await prueba("laAprobacionDejaArrancar con la vía heredada: CHATS arranca con voz/automática; META_ADS y LIBRO_V3 como siempre", async () => {
  const via = (id) => trabajo.viaConHerencia(id, lector);
  assert.equal(trabajo.laAprobacionDejaArrancar(["CHATS"], await via("hijaDeVoz")), true, "T-826-like con madre por voz");
  assert.equal(trabajo.laAprobacionDejaArrancar(["CHATS"], await via("hijaDeAuto")), true, "con madre automática");
  assert.equal(trabajo.laAprobacionDejaArrancar(["CHATS"], await via("hijaDeSinVia")), false, "madre sin vía");
  assert.equal(trabajo.laAprobacionDejaArrancar(["CHATS"], await via("hijaDeDeshecha")), false, "madre deshecha");
  assert.equal(trabajo.laAprobacionDejaArrancar(["META_ADS"], await via("hijaDeVoz")), false, "META_ADS sigue pidiendo pantalla");
  assert.equal(trabajo.laAprobacionDejaArrancar(["META_ADS"], await via("hijaDeAuto")), false);
  assert.equal(trabajo.laAprobacionDejaArrancar(["LIBRO_V3"], await via("hijaDeVoz")), true, "LIBRO_V3 sigue con voz");
  assert.equal(trabajo.laAprobacionDejaArrancar(["LIBRO_V3"], await via("hijaDeAuto")), false, "LIBRO_V3 sigue sin automática");
});

await prueba("SQL real (PGlite): VIA_DE_LA_ULTIMA_APROBACION y CONDICION_DE_LA_VIA coinciden con la versión TypeScript", async () => {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE "TarjetaTablero" ("id" text, "zonaProtegida" text[] NOT NULL);
    CREATE TABLE "HistorialTarjeta" ("id" serial PRIMARY KEY, "tarjetaId" text, "accion" text, "despues" jsonb, "creadoEn" timestamp, "deshechoEn" timestamp);
  `);
  const zonasDePrueba = [[], ["CHATS"], ["BOT_VENTAS"], ["LIBRO_V3"], ["META_ADS"], ["CHATS", "META_ADS"]];
  for (const [id, filas] of Object.entries(historial)) {
    for (const zonas of zonasDePrueba) await db.query(`INSERT INTO "TarjetaTablero" VALUES ($1, $2)`, [id, zonas]);
    for (const fila of filas) {
      await db.query(
        `INSERT INTO "HistorialTarjeta" ("tarjetaId","accion","despues","creadoEn","deshechoEn") VALUES ($1,'aprobar',$2,$3,$4)`,
        [id, JSON.stringify(fila.despues), fila.creadoEn, fila.deshechoEn ?? null],
      );
    }
  }
  const { rows } = await db.query(
    `SELECT c."id", c."zonaProtegida", ${sql.VIA_DE_LA_ULTIMA_APROBACION} AS "via", ${sql.CONDICION_DE_LA_VIA} AS "deja" FROM "TarjetaTablero" c`,
  );
  assert.equal(rows.length, Object.keys(historial).length * zonasDePrueba.length);
  for (const fila of rows) {
    const viaTs = await trabajo.viaConHerencia(fila.id, lector);
    assert.equal(fila.via, viaTs, `vía de ${fila.id}`);
    assert.equal(fila.deja, trabajo.laAprobacionDejaArrancar(fila.zonaProtegida, viaTs), `${fila.id} ${JSON.stringify(fila.zonaProtegida)} via=${viaTs}`);
  }
  const buscar = (id, zonas) => rows.find((f) => f.id === id && JSON.stringify(f.zonaProtegida) === JSON.stringify(zonas));
  assert.equal(buscar("hijaDeVoz", ["CHATS"]).deja, true, "T-826-like arranca");
  assert.equal(buscar("hijaDeAuto", ["CHATS"]).deja, true);
  assert.equal(buscar("hijaDeSinVia", ["CHATS"]).deja, false);
  assert.equal(buscar("hijaDeDeshecha", ["CHATS"]).deja, false);
  assert.equal(buscar("hijaDeVoz", ["META_ADS"]).deja, false);
  assert.equal(buscar("hijaDeVoz", []).deja, true, "sin zona siempre");
  await db.close();
});

await prueba("trabajador.ts: lo heredado (partes, limpieza, causa externa) copia la vía de la madre y ya no inventa 'pantalla'", () => {
  const codigo = readFileSync("src/features/tableros-inteligentes/services/trabajador.ts", "utf8");
  assert.equal((codigo.match(/como: "heredada", heredadaDe: actual\.id, \.\.\.\(await viaHeredadaDe\(tx, actual\.id\)\)/g) ?? []).length, 2);
  assert.match(codigo, /const viaDeLaMadre = await viaHeredadaDe\(tx, actual\.id\);/);
  assert.match(codigo, /\.\.\.viaDeLaMadre,/);
  assert.doesNotMatch(codigo, /via: "pantalla",\s*quienNombre: "el dueño \(en la tarjeta madre\)"/);
});

console.log(`\n${pruebas} pruebas, todas bien`);
