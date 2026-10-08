// Pruebas de src/lib/en-linea-reglas.ts ("Recibiendo clientes", Alex 08-10-2026): reparto solo a
// quien esta en linea, respaldo cuando nadie lo esta, pausa sola al salir de la app, pausa a mano.
// Correr: npm run test:recibiendo-clientes
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const sourcePath = path.resolve("src/lib/en-linea-reglas.ts");
const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
});
const mod = { exports: {} };
new Function("exports", "require", "module", "__filename", "__dirname", transpiled.outputText)(
  mod.exports,
  require,
  mod,
  sourcePath,
  path.dirname(sourcePath),
);
const {
  VENCE_EL_LATIDO_MS,
  alLatir,
  alPausarAMano,
  alActivarAMano,
  estaRecibiendo,
  pausaManualVigente,
  elegirAsesora,
  minutosEnRango,
  formatoDeHoras,
} = mod.exports;

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const MIN = 60_000;
// 08-10-2026 10:00 a. m. en Bogota (15:00 UTC).
const t0 = new Date("2026-10-08T15:00:00.000Z");
const mas = (minutos, desde = t0) => new Date(desde.getTime() + minutos * MIN);

const INGRID = "ingrid";
const MARIA = "maria";
const STHEFF = "stheffani";
const rueda = [INGRID, MARIA, STHEFF];

prueba("reparto con 0 en linea y sin respaldo: nadie (queda sin duena, como antes)", () => {
  assert.equal(elegirAsesora({ rueda, disponibles: new Set(), ultimaAsignada: null, respaldo: null }), null);
});

prueba("reparto con 0 en linea: va a la de respaldo (Ingrid) marcado como respaldo", () => {
  assert.deepEqual(elegirAsesora({ rueda, disponibles: new Set(), ultimaAsignada: MARIA, respaldo: INGRID }), {
    userId: INGRID,
    porRespaldo: true,
  });
});

prueba("respaldo que un jefe saco de la rueda (pausa de Equipo o fuera de la linea): no se le fuerza", () => {
  assert.equal(
    elegirAsesora({ rueda: [MARIA, STHEFF], disponibles: new Set(), ultimaAsignada: null, respaldo: INGRID }),
    null,
  );
});

prueba("reparto con 1 en linea: siempre a ella, aunque no le toque en la rueda", () => {
  const disponibles = new Set([STHEFF]);
  assert.deepEqual(elegirAsesora({ rueda, disponibles, ultimaAsignada: STHEFF, respaldo: INGRID }), {
    userId: STHEFF,
    porRespaldo: false,
  });
  assert.deepEqual(elegirAsesora({ rueda, disponibles, ultimaAsignada: INGRID, respaldo: INGRID }), {
    userId: STHEFF,
    porRespaldo: false,
  });
});

prueba("reparto con 2 en linea: se turnan y la desconectada se salta", () => {
  const disponibles = new Set([INGRID, STHEFF]);
  let ultima = null;
  const salidas = [];
  for (let i = 0; i < 4; i += 1) {
    const elegida = elegirAsesora({ rueda, disponibles, ultimaAsignada: ultima, respaldo: INGRID });
    assert.equal(elegida.porRespaldo, false);
    salidas.push(elegida.userId);
    ultima = elegida.userId;
  }
  assert.deepEqual(salidas, [INGRID, STHEFF, INGRID, STHEFF]);
});

prueba("abrir el CRM la pone Recibiendo sola (sin fila previa)", () => {
  const { presencia, cerrar } = alLatir(null, t0);
  assert.equal(estaRecibiendo(presencia, t0), true);
  assert.equal(cerrar, null);
});

prueba("con la app visible (latido cada 4 min) sigue recibiendo y no corta el periodo", () => {
  let p = alLatir(null, t0).presencia;
  for (let m = 4; m <= 60; m += 4) {
    const r = alLatir(p, mas(m));
    assert.equal(r.cerrar, null);
    p = r.presencia;
  }
  assert.equal(p.enLineaDesde.getTime(), t0.getTime());
});

prueba("salir de la app: a los 5 min sigue recibiendo (foto, llamada); a los 7 min sin latido, pausada sola", () => {
  // Al esconder la app sale un ultimo latido.
  const p = alLatir(null, t0).presencia;
  assert.equal(estaRecibiendo(p, mas(5)), true);
  assert.equal(estaRecibiendo(p, mas(7)), true);
  assert.equal(estaRecibiendo(p, mas(7.1)), false);
  assert.equal(VENCE_EL_LATIDO_MS, 7 * MIN);
});

prueba("volver despues de vencido: recibe de nuevo y el periodo anterior se cierra al vencer", () => {
  const p = alLatir(null, t0).presencia;
  const vuelta = mas(40);
  const { presencia, cerrar } = alLatir(p, vuelta);
  assert.equal(estaRecibiendo(presencia, vuelta), true);
  assert.equal(presencia.enLineaDesde.getTime(), vuelta.getTime());
  assert.equal(cerrar.inicio.getTime(), t0.getTime());
  assert.equal(cerrar.fin.getTime(), mas(7).getTime());
});

prueba("pausa a mano: no recibe aunque la app siga abierta, y cierra el periodo en ese instante", () => {
  const p = alLatir(alLatir(null, t0).presencia, mas(28)).presencia;
  const { presencia, cerrar } = alPausarAMano(p, mas(30));
  assert.equal(estaRecibiendo(presencia, mas(30)), false);
  // El latido de las 10:28 llego despues de 28 min sin latir: abrio un periodo nuevo.
  assert.equal(cerrar.inicio.getTime(), mas(28).getTime());
  assert.equal(cerrar.fin.getTime(), mas(30).getTime());
  // Sigue latiendo con la app abierta (almuerzo con la app abierta): sigue pausada.
  const despues = alLatir(presencia, mas(34));
  assert.equal(estaRecibiendo(despues.presencia, mas(34)), false);
  assert.equal(pausaManualVigente(despues.presencia, mas(34)), true);
  assert.equal(despues.cerrar, null);
  // Cerrar y volver a abrir el mismo dia: la pausa a mano se respeta.
  const reabre = alLatir(despues.presencia, mas(120));
  assert.equal(estaRecibiendo(reabre.presencia, mas(120)), false);
});

prueba("pausa a mano: ella la quita y vuelve a recibir", () => {
  const pausada = alPausarAMano(alLatir(null, t0).presencia, mas(10)).presencia;
  const { presencia } = alActivarAMano(pausada, mas(50));
  assert.equal(estaRecibiendo(presencia, mas(50)), true);
  assert.equal(presencia.pausaManualEn, null);
});

prueba("pausa a mano de ayer: al abrir la app al dia siguiente recibe sola", () => {
  const pausada = alPausarAMano(alLatir(null, t0).presencia, mas(8 * 60)).presencia; // 6 p. m.
  const manana = new Date("2026-10-09T13:00:00.000Z"); // 8 a. m. del 9
  assert.equal(pausaManualVigente(pausada, manana), false);
  const { presencia } = alLatir(pausada, manana);
  assert.equal(estaRecibiendo(presencia, manana), true);
});

prueba("el dia de la pausa es el de Bogota, no el UTC (11 p. m. aca ya es otro dia en UTC)", () => {
  const nocheBogota = new Date("2026-10-09T04:00:00.000Z"); // 11 p. m. del 8 en Bogota
  const pausada = alPausarAMano(alLatir(null, nocheBogota).presencia, nocheBogota).presencia;
  assert.equal(pausaManualVigente(pausada, new Date("2026-10-09T04:50:00.000Z")), true); // 11:50 p. m.
  assert.equal(pausaManualVigente(pausada, new Date("2026-10-09T05:10:00.000Z")), false); // 12:10 a. m.
});

prueba("horas recibiendo: se recortan al dia y se suman", () => {
  const dia = { desde: new Date("2026-10-08T05:00:00.000Z"), hasta: new Date("2026-10-09T05:00:00.000Z") };
  const periodos = [
    { inicio: new Date("2026-10-08T03:00:00.000Z"), fin: new Date("2026-10-08T06:00:00.000Z") }, // 1 h dentro
    { inicio: t0, fin: mas(150) }, // 2 h 30 min
  ];
  assert.equal(minutosEnRango(periodos, dia.desde, dia.hasta), 210);
  assert.equal(formatoDeHoras(210), "3 h 30 min");
  assert.equal(formatoDeHoras(45), "45 min");
  assert.equal(formatoDeHoras(120), "2 h");
  assert.equal(formatoDeHoras(0), "—");
});

console.log(`\n${pruebas} pruebas ok`);
