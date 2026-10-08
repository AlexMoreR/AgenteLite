// Pruebas de src/lib/en-linea-reglas.ts ("Recibiendo clientes", Alex 08-10-2026): reparto solo a
// quien esta en linea, respaldo cuando nadie lo esta, en linea hasta pausar (o 2 h sin abrir), pausa a mano.
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
  PAUSA_SOLA_SIN_ABRIR_MS,
  MARGEN_DE_MEDICION_MS,
  finMedido,
  alLatir,
  alPausarAMano,
  alActivarAMano,
  estaRecibiendo,
  pausaManualVigente,
  elegirAsesora,
  minutosEnRango,
  formatoDeHoras,
  decidirReparto,
  respaldoAtiende,
  ventanaDeMadrugada,
  TOPE_DE_MADRUGADA_POR_ASESORA,
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

prueba("salir de la app: a los 10 min sigue recibiendo (antes se pausaba a los 7)", () => {
  // Al esconder la app ya no se manda nada.
  const p = alLatir(null, t0).presencia;
  assert.equal(estaRecibiendo(p, mas(5)), true);
  assert.equal(estaRecibiendo(p, mas(10)), true);
  assert.equal(PAUSA_SOLA_SIN_ABRIR_MS, 120 * MIN);
  assert.equal(MARGEN_DE_MEDICION_MS, 6 * MIN);
});

prueba("celular bloqueado 1 h: sigue en linea y le sigue llegando el reparto", () => {
  const p = alLatir(null, t0).presencia;
  assert.equal(estaRecibiendo(p, mas(60)), true);
  const disponibles = new Set([INGRID].filter(() => estaRecibiendo(p, mas(60))));
  assert.deepEqual(elegirAsesora({ rueda, disponibles, ultimaAsignada: INGRID, respaldo: MARIA }), {
    userId: INGRID,
    porRespaldo: false,
  });
});

prueba("celular bloqueado 1 h: las horas medidas paran en ultimo latido + 6 min, no cuentan la hora", () => {
  const p = alLatir(null, t0).presencia;
  // Mientras sigue bloqueado (lo que ve Actividad): tramo abierto hasta las 10:06.
  assert.equal(finMedido(p, mas(60)).getTime(), mas(6).getTime());
  // Al desbloquear y abrir el CRM: nunca dejo de estar en linea, pero el tramo se corta.
  const { presencia, cerrar } = alLatir(p, mas(60));
  assert.equal(estaRecibiendo(presencia, mas(60)), true);
  assert.equal(cerrar.inicio.getTime(), t0.getTime());
  assert.equal(cerrar.fin.getTime(), mas(6).getTime());
  assert.equal(presencia.enLineaDesde.getTime(), mas(60).getTime());
});

prueba("2 h sin abrir sigue en linea; 2 h 1 min sin abrir: pausada sola (y va al respaldo)", () => {
  const p = alLatir(null, t0).presencia;
  assert.equal(estaRecibiendo(p, mas(120)), true);
  assert.equal(estaRecibiendo(p, mas(121)), false);
  assert.equal(pausaManualVigente(p, mas(121)), false);
  const disponibles = new Set([INGRID].filter(() => estaRecibiendo(p, mas(121))));
  assert.deepEqual(elegirAsesora({ rueda, disponibles, ultimaAsignada: null, respaldo: MARIA }), {
    userId: MARIA,
    porRespaldo: true,
  });
});

prueba("volver despues de pausarse sola: recibe de nuevo y el periodo anterior se cerro en latido + margen", () => {
  const p = alLatir(null, t0).presencia;
  const vuelta = mas(180);
  const { presencia, cerrar } = alLatir(p, vuelta);
  assert.equal(estaRecibiendo(presencia, vuelta), true);
  assert.equal(presencia.enLineaDesde.getTime(), vuelta.getTime());
  assert.equal(cerrar.inicio.getTime(), t0.getTime());
  assert.equal(cerrar.fin.getTime(), mas(6).getTime());
});

prueba("pausa a mano: no recibe aunque la app siga abierta, y cierra el periodo en ese instante", () => {
  const p = alLatir(alLatir(null, t0).presencia, mas(28)).presencia;
  const { presencia, cerrar } = alPausarAMano(p, mas(30));
  assert.equal(estaRecibiendo(presencia, mas(30)), false);
  // El latido de las 10:28 llego despues de 28 min sin latir (mas que el margen): abrio un tramo nuevo.
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

/* La madrugada: respaldo de 7 a. m. a 11 p. m.; de noche sin nadie, sin duena hasta la manana. */

// Hora de Bogota del 9 de octubre (UTC-5).
const bog = (hhmm) => new Date(`2026-10-09T${hhmm}:00.000-05:00`);
const base = { rueda, ultimaAsignada: null, respaldo: INGRID };

prueba("franja del respaldo: 7:00 a 22:59 si, 23:00 a 6:59 no; la noche va de 23:00 a 7:00", () => {
  assert.equal(respaldoAtiende(bog("06:59")), false);
  assert.equal(respaldoAtiende(bog("07:00")), true);
  assert.equal(respaldoAtiende(bog("22:59")), true);
  assert.equal(respaldoAtiende(bog("23:00")), false);
  const deDia = ventanaDeMadrugada(bog("07:30"));
  assert.equal(deDia.desde.toISOString(), new Date("2026-10-08T23:00:00.000-05:00").toISOString());
  assert.equal(deDia.hasta.toISOString(), bog("07:00").toISOString());
  assert.deepEqual(ventanaDeMadrugada(bog("03:00")), deDia);
  const estaNoche = ventanaDeMadrugada(bog("23:30"));
  assert.equal(estaNoche.desde.toISOString(), bog("23:00").toISOString());
});

prueba("lead a las 3:00 sin nadie en linea: queda sin duena (ni al respaldo, ni aviso)", () => {
  const d = decidirReparto({ ...base, disponibles: new Set(), ahora: bog("03:00"), deMadrugada: false });
  assert.deepEqual(d, { tipo: "esperar" });
});

prueba("lead a las 3:00 con alguien en linea: se le asigna normal", () => {
  const d = decidirReparto({ ...base, disponibles: new Set([MARIA]), ahora: bog("03:00"), deMadrugada: false });
  assert.equal(d.tipo, "asignar");
  assert.equal(d.userId, MARIA);
  assert.equal(d.porRespaldo, false);
});

prueba("a las 7:05 una asesora abre el CRM: se le asigna el chat de la madrugada (sin mover la rueda)", () => {
  const d = decidirReparto({ ...base, disponibles: new Set([MARIA]), ahora: bog("07:05"), deMadrugada: true });
  assert.deepEqual(d, { tipo: "asignar", userId: MARIA, porRespaldo: false, deMadrugada: true, mueveLaRueda: false });
});

prueba("chat de madrugada a las 7:30 sin nadie en linea: espera (no va al respaldo antes de las 8)", () => {
  const d = decidirReparto({ ...base, disponibles: new Set(), ahora: bog("07:30"), deMadrugada: true });
  assert.deepEqual(d, { tipo: "esperar" });
});

prueba("lead nuevo a las 7:00 sin nadie en linea: va a Ingrid (respaldo)", () => {
  const d = decidirReparto({ ...base, disponibles: new Set(), ahora: bog("07:00"), deMadrugada: false });
  assert.deepEqual(d, { tipo: "asignar", userId: INGRID, porRespaldo: true, deMadrugada: false, mueveLaRueda: false });
});

/** Reparte una lista de chats de madrugada (mas antiguos primero) como lo hace el reloj. */
function repartirMadrugada(pendientes, disponibles, ahora, recibidas, ultima = null) {
  const quedan = [];
  let ultimaAsignada = ultima;
  for (const chat of pendientes) {
    const d = decidirReparto({ rueda, ultimaAsignada, respaldo: INGRID, disponibles, ahora, deMadrugada: true, recibidasDeMadrugada: recibidas });
    if (d.tipo !== "asignar") {
      quedan.push(chat);
      continue;
    }
    recibidas.set(d.userId, (recibidas.get(d.userId) ?? 0) + 1);
    if (d.mueveLaRueda) ultimaAsignada = d.userId;
    chat.duena = d.userId;
  }
  return quedan;
}

prueba("6 leads de madrugada: A abre 7:05 y recibe 3 (los mas antiguos); B abre 7:20 y recibe 3", () => {
  assert.equal(TOPE_DE_MADRUGADA_POR_ASESORA, 3);
  const chats = [1, 2, 3, 4, 5, 6].map((n) => ({ n, duena: null }));
  const recibidas = new Map();
  const quedan = repartirMadrugada(chats, new Set([MARIA]), bog("07:05"), recibidas);
  assert.deepEqual(chats.filter((c) => c.duena === MARIA).map((c) => c.n), [1, 2, 3]);
  assert.equal(quedan.length, 3);
  const quedan2 = repartirMadrugada(quedan, new Set([MARIA, STHEFF]), bog("07:20"), recibidas);
  assert.deepEqual(chats.filter((c) => c.duena === STHEFF).map((c) => c.n), [4, 5, 6]);
  assert.equal(quedan2.length, 0);
});

prueba("en rueda: si A y B ya estan en linea a las 7:05, se alternan (nadie se lleva todo)", () => {
  const chats = [1, 2, 3, 4].map((n) => ({ n, duena: null }));
  repartirMadrugada(chats, new Set([MARIA, STHEFF]), bog("07:05"), new Map());
  assert.deepEqual(chats.map((c) => c.duena), [MARIA, STHEFF, MARIA, STHEFF]);
});

prueba("solo A en linea: 3 a las 7:05, y a las 8:00 recibe el resto", () => {
  const chats = [1, 2, 3, 4, 5, 6].map((n) => ({ n, duena: null }));
  const recibidas = new Map();
  const quedan = repartirMadrugada(chats, new Set([MARIA]), bog("07:05"), recibidas);
  assert.equal(quedan.length, 3);
  const quedan2 = repartirMadrugada(quedan, new Set([MARIA]), bog("08:00"), recibidas, INGRID);
  assert.equal(quedan2.length, 0);
  assert.ok(chats.every((c) => c.duena === MARIA));
});

prueba("a las 8:00 sin nadie en linea: lo que queda de la madrugada va a Ingrid (respaldo)", () => {
  const d = decidirReparto({ ...base, disponibles: new Set(), ahora: bog("08:00"), deMadrugada: true });
  assert.equal(d.tipo, "asignar");
  assert.equal(d.userId, INGRID);
  assert.equal(d.porRespaldo, true);
});

/* El reparto de DÍA ya no exige "en línea" (Alex, 08-10-2026): la rueda del día usa
   `disponiblesParaTurno` (todas menos pausa a mano), aunque nadie tenga la app abierta. La
   madrugada (noche + tope de 7 a 8) sigue mirando `disponibles` (en línea). */

prueba("día, nadie en línea: igual se reparte por la rueda a todas (no cae todo en el respaldo)", () => {
  const d = decidirReparto({
    ...base,
    disponibles: new Set(),
    disponiblesParaTurno: new Set(rueda),
    ahora: bog("10:00"),
    deMadrugada: false,
  });
  assert.deepEqual(d, { tipo: "asignar", userId: INGRID, porRespaldo: false, deMadrugada: false, mueveLaRueda: true });
});

prueba("día: la rueda avanza entre todas aunque ninguna esté en línea", () => {
  let ultima = null;
  const salidas = [];
  for (let i = 0; i < 4; i += 1) {
    const d = decidirReparto({
      ...base,
      ultimaAsignada: ultima,
      disponibles: new Set(),
      disponiblesParaTurno: new Set(rueda),
      ahora: bog("10:00"),
      deMadrugada: false,
    });
    assert.equal(d.tipo, "asignar");
    assert.equal(d.porRespaldo, false);
    salidas.push(d.userId);
    ultima = d.userId;
  }
  assert.deepEqual(salidas, [INGRID, MARIA, STHEFF, INGRID]);
});

prueba("día: la pausada a mano SÍ se salta (no está en disponiblesParaTurno)", () => {
  const d = decidirReparto({
    ...base,
    ultimaAsignada: INGRID,
    disponibles: new Set(),
    disponiblesParaTurno: new Set([INGRID, STHEFF]), // MARIA pausada a mano
    ahora: bog("10:00"),
    deMadrugada: false,
  });
  assert.equal(d.userId, STHEFF);
});

prueba("día, todas pausadas a mano: va al respaldo (Ingrid)", () => {
  const d = decidirReparto({
    ...base,
    disponibles: new Set(),
    disponiblesParaTurno: new Set(),
    ahora: bog("10:00"),
    deMadrugada: false,
  });
  assert.deepEqual(d, { tipo: "asignar", userId: INGRID, porRespaldo: true, deMadrugada: false, mueveLaRueda: false });
});

prueba("madrugada intacta: de noche se espera aunque haya elegibles para el turno (nadie dormida)", () => {
  const d = decidirReparto({
    ...base,
    disponibles: new Set(), // nadie en línea de noche
    disponiblesParaTurno: new Set(rueda),
    ahora: bog("03:00"),
    deMadrugada: false,
  });
  assert.deepEqual(d, { tipo: "esperar" });
});

prueba("tope 7 a 8 intacto: usa en línea, no disponiblesParaTurno (espera si nadie abrió aún)", () => {
  const d = decidirReparto({
    ...base,
    disponibles: new Set(), // nadie abrió el CRM todavía
    disponiblesParaTurno: new Set(rueda),
    ahora: bog("07:30"),
    deMadrugada: true,
  });
  assert.deepEqual(d, { tipo: "esperar" });
});

console.log(`\n${pruebas} pruebas ok`);
