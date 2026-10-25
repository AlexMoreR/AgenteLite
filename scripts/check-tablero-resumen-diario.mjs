// Pruebas del resumen diario del Tablero IA (resumen-diario.ts): el día y la hora de Bogotá, cuándo toca
// mandarlo (9:00 a 9:59 p. m., una vez por día), cómo se arma con el historial de HOY (no el de ayer), el texto
// y que el reloj solo anota el día (ya NO manda WhatsApp), con un prisma falso. No necesita base ni red.
// Correr: npm run test:tablero-resumen-diario
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

/* ------------------------------------------------------------------ falsos */

const estado = { historial: [], ajustes: new Map(), negocios: ["ws1"], mensajes: [], escrituras: 0 };

const falso = {
  historialTarjeta: {
    findMany: async ({ where }) =>
      estado.historial
        .filter((f) => f.workspaceId === where.tarjeta.tablero.workspaceId)
        .filter((f) => f.creadoEn >= where.creadoEn.gte && f.creadoEn < where.creadoEn.lt)
        .filter((f) => where.OR.some((o) => Object.entries(o).every(([k, v]) => f[k] === v)))
        .sort((a, b) => a.creadoEn - b.creadoEn)
        .map((f) => ({ ...f, tarjeta: { titulo: f.titulo } })),
  },
  appSetting: {
    findUnique: async ({ where }) => (estado.ajustes.has(where.key) ? { value: estado.ajustes.get(where.key) } : null),
    upsert: async ({ where, create, update }) => {
      estado.escrituras += 1;
      estado.ajustes.set(where.key, estado.ajustes.has(where.key) ? update.value : create.value);
    },
  },
  tableroInteligente: { findMany: async () => estado.negocios.map((workspaceId) => ({ workspaceId })) },
};

const mocks = {
  "@/lib/prisma": { prisma: falso },
  "@prisma/client": { Prisma: {} },
  // El resumen ya no manda WhatsApp: si algo intentara usar Evolution, la prueba lo detecta.
  "@/lib/evolution": new Proxy({}, { get: () => () => { estado.mensajes.push("evolution"); } }),
};

const resumen = cargar("src/features/tableros-inteligentes/services/resumen-diario.ts", mocks);
const { QUIEN_AUTOMATICO } = cargar("src/features/tableros-inteligentes/services/aprobacion-automatica.ts", mocks);

let pruebas = 0;
async function prueba(nombre, fn) {
  estado.historial.length = 0;
  estado.ajustes.clear();
  estado.mensajes.length = 0;
  estado.escrituras = 0;
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

// Fechas: Bogotá es UTC-5. El 22 de octubre de Bogotá va de 2026-10-22T05:00Z a 2026-10-23T05:00Z.
const AYER = new Date("2026-10-21T20:00:00Z");
const HOY_TARDE = new Date("2026-10-22T20:00:00Z");
const HOY_MANANA = new Date("2026-10-22T13:00:00Z");

const fila = (extra) => ({ workspaceId: "ws1", tarjetaId: "t1", titulo: "Reporte de ventas", accion: "estado", origen: "TRABAJADOR", quien: "trabajador:k1", despues: {}, creadoEn: HOY_MANANA, ...extra });
const aprobada = (extra = {}) =>
  fila({ accion: "aprobar", quien: QUIEN_AUTOMATICO, despues: { automatica: true, momento: "tarea", motivo: "solo agrega una pantalla" }, ...extra });
const subida = (extra = {}) =>
  fila({ despues: { estado: "HECHO", subida: { commit: "abcdef1234567890", linkCommit: "https://github.com/x/y/commit/abcdef1234567890" } }, ...extra });
const falla = (extra = {}) => fila({ despues: { estado: "ERROR", motivo: "las pruebas fallaron" }, ...extra });

/* ------------------------------------------------------------------ el día de Bogotá */

await prueba("día, hora y rango de Bogotá (UTC-5)", () => {
  const ahora = new Date("2026-10-23T02:30:00Z");
  assert.equal(resumen.diaDeBogota(ahora), "2026-10-22");
  assert.equal(resumen.horaDeBogota(ahora), 21);
  assert.equal(resumen.diaDeBogota(new Date("2026-10-22T04:59:00Z")), "2026-10-21");
  assert.equal(resumen.diaDeBogota(new Date("2026-10-22T05:00:00Z")), "2026-10-22");
  const { desde, hasta } = resumen.rangoDelDia("2026-10-22");
  assert.equal(desde.toISOString(), "2026-10-22T05:00:00.000Z");
  assert.equal(hasta.toISOString(), "2026-10-23T05:00:00.000Z");
});

await prueba("tocaElResumen: 9:00 y 9:59 p. m. sí; 8:59 y 10:00 p. m. no; no si hoy ya salió", () => {
  assert.equal(resumen.tocaElResumen(new Date("2026-10-23T02:00:00Z"), null), true);
  assert.equal(resumen.tocaElResumen(new Date("2026-10-23T02:59:00Z"), undefined), true);
  assert.equal(resumen.tocaElResumen(new Date("2026-10-23T01:59:00Z"), null), false);
  assert.equal(resumen.tocaElResumen(new Date("2026-10-23T03:00:00Z"), null), false);
  assert.equal(resumen.tocaElResumen(new Date("2026-10-23T02:30:00Z"), "2026-10-22"), false);
  assert.equal(resumen.tocaElResumen(new Date("2026-10-23T02:30:00Z"), "2026-10-21"), true);
});

/* ------------------------------------------------------------------ armar y texto */

await prueba("armarResumen lista solo lo de hoy (no lo de ayer)", () => {
  const r = resumen.armarResumen("2026-10-22", [
    aprobada({ creadoEn: AYER, tarjetaId: "vieja", titulo: "De ayer" }),
    subida({ creadoEn: AYER, tarjetaId: "vieja2" }),
    falla({ creadoEn: AYER, tarjetaId: "vieja3" }),
    aprobada({ tarjetaId: "a", titulo: "Reporte A" }),
    subida({ tarjetaId: "b", titulo: "Reporte B", creadoEn: HOY_TARDE }),
    falla({ tarjetaId: "c", titulo: "Reporte C" }),
    fila({ despues: { estado: "EN_CURSO" } }),
    fila({ accion: "aprobar", quien: "user-1", despues: { momento: "tarea" } }),
  ]);
  assert.equal(r.aprobadas.length, 1);
  assert.equal(r.aprobadas[0].titulo, "Reporte A");
  assert.equal(r.aprobadas[0].momento, "tarea");
  assert.equal(r.aprobadas[0].motivo, "solo agrega una pantalla");
  assert.equal(r.subidas.length, 1);
  assert.equal(r.subidas[0].commit, "abcdef1234567890");
  assert.equal(r.subidas[0].linkCommit, "https://github.com/x/y/commit/abcdef1234567890");
  assert.equal(r.fallas.length, 1);
  assert.equal(r.fallas[0].motivo, "las pruebas fallaron");
  assert.equal(resumen.haySinMovimiento(r), false);
  assert.equal(resumen.haySinMovimiento(resumen.armarResumen("2026-10-22", [aprobada({ creadoEn: AYER })])), true);
});

await prueba("textoDelResumen: link del commit, sin movimiento y listas largas recortadas", () => {
  const completo = resumen.textoDelResumen(
    resumen.armarResumen("2026-10-22", [aprobada({ titulo: "Pantalla nueva" }), subida({ titulo: "Reporte B" }), falla({ titulo: "Reporte C" })]),
  );
  assert.ok(completo.includes("22/10/2026"));
  assert.ok(completo.includes("Pantalla nueva"));
  assert.ok(completo.includes("solo agrega una pantalla"));
  assert.ok(completo.includes("https://github.com/x/y/commit/abcdef1234567890"));
  assert.ok(completo.includes("commit abcdef1234"));
  assert.ok(completo.includes("las pruebas fallaron"));

  assert.ok(resumen.textoDelResumen(resumen.armarResumen("2026-10-22", [])).includes("Hoy no hubo movimiento"));

  const muchas = Array.from({ length: 15 }, (_, i) => aprobada({ tarjetaId: `m${i}`, titulo: `Tarea ${i}` }));
  const largo = resumen.textoDelResumen(resumen.armarResumen("2026-10-22", muchas));
  assert.ok(largo.includes("Aprobé solas 15"));
  assert.ok(largo.includes("y 5 más"));
  assert.equal(largo.includes("Tarea 14"), false);
  const enorme = resumen.textoDelResumen(
    resumen.armarResumen("2026-10-22", Array.from({ length: 40 }, (_, i) => falla({ tarjetaId: `f${i}`, titulo: "x".repeat(200), motivo: "y".repeat(500), despues: { estado: "ERROR", motivo: "y".repeat(500) } }))),
  );
  assert.ok(enorme.length <= 3500);
});

/* ------------------------------------------------------------------ envío */

await prueba("enviarResumenDiarioSiToca: a las 9:05 p. m. anota el día UNA vez y no manda ningún mensaje", async () => {
  estado.historial.push(aprobada({ titulo: "Pantalla nueva" }));
  const primera = await resumen.enviarResumenDiarioSiToca(new Date("2026-10-23T02:05:00Z"));
  assert.deepEqual(primera, { enviados: 0 });
  const anotado = await resumen.leerUltimoEnvio("ws1");
  assert.equal(anotado.dia, "2026-10-22");
  assert.equal(anotado.enviado, false);
  assert.equal(anotado.motivo, resumen.MOTIVO_SIN_WHATSAPP);
  assert.equal(estado.escrituras, 1);

  // Un minuto después no vuelve a anotar (una vez por día).
  const segunda = await resumen.enviarResumenDiarioSiToca(new Date("2026-10-23T02:06:00Z"));
  assert.deepEqual(segunda, { enviados: 0 });
  assert.equal(estado.escrituras, 1);
  assert.equal(estado.mensajes.length, 0);
});

await prueba("enviarResumenDiarioSiToca: a las 8:59 p. m. y a las 10:00 p. m. no anota nada", async () => {
  assert.deepEqual(await resumen.enviarResumenDiarioSiToca(new Date("2026-10-23T01:59:00Z")), { enviados: 0 });
  assert.deepEqual(await resumen.enviarResumenDiarioSiToca(new Date("2026-10-23T03:00:00Z")), { enviados: 0 });
  assert.equal(estado.mensajes.length, 0);
  assert.equal(estado.escrituras, 0);
  assert.equal(await resumen.leerUltimoEnvio("ws1"), null);
});

await prueba("resumenDeHoyParaLaPantalla devuelve lo de hoy, el interruptor y el envío de hoy", async () => {
  estado.historial.push(aprobada({ titulo: "Hoy 1" }), aprobada({ titulo: "De ayer", creadoEn: AYER }));
  const ahora = new Date("2026-10-23T02:30:00Z");
  const antes = await resumen.resumenDeHoyParaLaPantalla("ws1", ahora);
  assert.equal(antes.dia, "2026-10-22");
  assert.equal(antes.resumen.aprobadas.length, 1);
  assert.ok(antes.texto.includes("Hoy 1"));
  assert.equal(antes.texto.includes("De ayer"), false);
  assert.equal(antes.envioDeHoy, null);
  assert.equal(antes.aprobacionAutomatica, true);

  await resumen.enviarResumenDiarioSiToca(new Date("2026-10-23T02:05:00Z"));
  const despues = await resumen.resumenDeHoyParaLaPantalla("ws1", ahora);
  assert.equal(despues.envioDeHoy.enviado, false);
  assert.equal(despues.envioDeHoy.motivo, resumen.MOTIVO_SIN_WHATSAPP);
  // Al día siguiente el envío de ayer ya no cuenta como el de hoy.
  const manana = await resumen.resumenDeHoyParaLaPantalla("ws1", new Date("2026-10-23T15:00:00Z"));
  assert.equal(manana.envioDeHoy, null);
  assert.equal(manana.ultimoEnvio.dia, "2026-10-22");
});

console.log(`\n${pruebas} pruebas, todas bien`);
