// Pruebas del resumen diario del Tablero IA (resumen-diario.ts): el día y la hora de Bogotá, cuándo toca
// mandarlo (8:55 a 8:59 p. m., una vez por día), cómo se arma con el historial de HOY (no el de ayer), el texto
// y el envío con un prisma y un enrutador de avisos FALSOS. No necesita base ni red.
// Correr: npm run test:tablero-resumen-diario
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

/* ------------------------------------------------------------------ falsos */

const estado = { historial: [], ajustes: new Map(), negocios: ["ws1"], salidas: [], mensajes: [], whatsappSale: true, esperando: 0, activo: true, destino: "573001112233" };

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
      estado.ajustes.set(where.key, estado.ajustes.has(where.key) ? update.value : create.value);
    },
  },
  whatsAppChannel: { findMany: async () => [{ id: "l1", name: "Admin", status: "CONNECTED", evolutionInstanceName: "admin-inst" }] },
  tarjetaTablero: {
    count: async () => estado.esperando,
    findMany: async ({ where }) => (where.id ? [] : Array.from({ length: estado.esperando }, (_, i) => ({ id: `e${i}`, titulo: `Espera ${i}: algo largo`, detalle: "Detalle sencillo de la tarjeta", plan: null, resultado: null }))),
  },
  tableroInteligente: { findMany: async () => estado.negocios.map((workspaceId) => ({ workspaceId })) },
};

const enrutador = {
  leerConfigGravedad: async () => ({ whatsapp: { activo: estado.activo } }),
  destinoWhatsAppCritico: async () => estado.destino,
  whatsAppAAlexander: async ({ texto }) => {
    estado.mensajes.push(texto);
    return estado.whatsappSale;
  },
};

const mocks = {
  "@/lib/prisma": { prisma: falso },
  "@prisma/client": { Prisma: {} },
  "@/features/avisos-gravedad/servicios/enrutador": enrutador,
};

const salidasEvolution = [];
mocks["@/lib/evolution"] = { sendEvolutionTextMessageWithReconnect: async (datos) => void salidasEvolution.push(datos) };
const avisoTrabajador = cargar("src/features/tableros-inteligentes/services/aviso-del-trabajador.ts", mocks);
const resumen = cargar("src/features/tableros-inteligentes/services/resumen-diario.ts", mocks);
const { QUIEN_AUTOMATICO } = cargar("src/features/tableros-inteligentes/services/aprobacion-automatica.ts", mocks);

let pruebas = 0;
async function prueba(nombre, fn) {
  estado.historial.length = 0;
  estado.ajustes.clear();
  estado.mensajes.length = 0;
  estado.whatsappSale = true;
  estado.esperando = 0;
  estado.activo = true;
  estado.destino = "573001112233";
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

await prueba("tocaElResumen: 8:55 y 8:59 p. m. sí; 8:54 y 9:00 p. m. no; no si hoy ya salió", () => {
  assert.equal(resumen.tocaElResumen(new Date("2026-10-23T01:55:00Z"), null), true);
  assert.equal(resumen.tocaElResumen(new Date("2026-10-23T01:59:00Z"), undefined), true);
  assert.equal(resumen.tocaElResumen(new Date("2026-10-23T01:54:00Z"), null), false);
  assert.equal(resumen.tocaElResumen(new Date("2026-10-23T02:00:00Z"), null), false);
  assert.equal(resumen.tocaElResumen(new Date("2026-10-23T01:57:00Z"), "2026-10-22"), false);
  assert.equal(resumen.tocaElResumen(new Date("2026-10-23T01:57:00Z"), "2026-10-21"), true);
});

/* ------------------------------------------------------------------ armar y texto */

/* ------------------------------------------------------------------ aviso del Coordinador: 3 líneas y silencio */

await prueba("aviso del Coordinador: se recorta a 3 líneas", () => {
  assert.equal(avisoTrabajador.recortarALineas("a\nb\n\n c \nd\ne"), "a\nb\nc");
  assert.equal(avisoTrabajador.recortarALineas("uno\ndos"), "uno\ndos");
});

await prueba("silencio de 9 p. m. a 7 a. m.: 10 p. m. y 6:59 a. m. no salen; 7:00 a. m. y 8:55 p. m. sí", () => {
  const silencio = (iso) => avisoTrabajador.enSilencioDeAvisos(new Date(iso));
  assert.equal(silencio("2026-10-23T03:00:00Z"), true, "10 p. m.");
  assert.equal(silencio("2026-10-23T02:00:00Z"), true, "9:00 p. m.");
  assert.equal(silencio("2026-10-23T11:59:00Z"), true, "6:59 a. m.");
  assert.equal(silencio("2026-10-23T12:00:00Z"), false, "7:00 a. m.");
  assert.equal(silencio("2026-10-23T01:59:00Z"), false, "8:59 p. m.");
  assert.equal(silencio("2026-10-23T18:00:00Z"), false, "1 p. m.");
});

await prueba("enviarAvisoDelTrabajador: en silencio responde silenciado y no manda; fuera del silencio manda 3 líneas", async () => {
  const antes = salidasEvolution.length;
  const contexto = { workspaceId: "ws1" };
  const cuerpo = { texto: "⚠️ Claude va en 85 % de la semana.\nsegunda\ntercera\ncuarta" };
  const enLaNoche = await avisoTrabajador.enviarAvisoDelTrabajador(contexto, cuerpo, new Date("2026-10-23T03:00:00Z"));
  assert.equal(enLaNoche.silenciado, true);
  assert.equal(salidasEvolution.length, antes);

  estado.ajustes.set(avisoTrabajador.claveTelefonoDeAviso("ws1"), "573001234567");
  const aLas7 = await avisoTrabajador.enviarAvisoDelTrabajador(contexto, cuerpo, new Date("2026-10-23T12:00:00Z"));
  assert.equal(aLas7.silenciado, false);
  assert.equal(salidasEvolution.length, antes + 1);
  assert.equal(salidasEvolution.at(-1).text, "⚠️ Claude va en 85 % de la semana.\nsegunda\ntercera");
});

await prueba("armarResumen lista solo lo de hoy (no lo de ayer) y cuenta cada tarjeta una vez", () => {
  const r = resumen.armarResumen("2026-10-22", [
    aprobada({ creadoEn: AYER, tarjetaId: "vieja", titulo: "De ayer" }),
    subida({ creadoEn: AYER, tarjetaId: "vieja2" }),
    falla({ creadoEn: AYER, tarjetaId: "vieja3" }),
    aprobada({ tarjetaId: "a", titulo: "Reporte A" }),
    subida({ tarjetaId: "b", titulo: "Reporte B", creadoEn: HOY_TARDE }),
    falla({ tarjetaId: "c", titulo: "Reporte C" }),
    // Falló y después subió el mismo día: una sola vez, como lista.
    falla({ tarjetaId: "d", titulo: "Reporte D" }),
    subida({ tarjetaId: "d", titulo: "Reporte D", creadoEn: HOY_TARDE }),
    // Terminada sin subida (hecha a mano / sin cambios): también es lista.
    fila({ tarjetaId: "e", titulo: "Reporte E", despues: { estado: "HECHO" } }),
    fila({ despues: { estado: "EN_CURSO" } }),
    fila({ accion: "aprobar", quien: "user-1", despues: { momento: "tarea" } }),
  ]);
  assert.equal(r.aprobadas.length, 1);
  assert.equal(r.subidas.length, 2);
  assert.equal(r.subidas[0].commit, "abcdef1234567890");
  assert.deepEqual(r.listas.map((t) => t.tarjetaId).sort(), ["b", "d", "e"]);
  assert.deepEqual(r.conProblema.map((t) => t.tarjetaId), ["c"]);
  assert.equal(resumen.haySinMovimiento(r, 0), false);
  assert.equal(resumen.haySinMovimiento(resumen.armarResumen("2026-10-22", [aprobada({ creadoEn: AYER })]), 0), true);
  assert.equal(resumen.haySinMovimiento(resumen.armarResumen("2026-10-22", []), 1), false, "esperando solo ya es novedad");
});

await prueba("textoDelResumen: el resumen de AYER son 4 listas, 1 con problema y 2 esperando, en 2 líneas con un solo link", () => {
  const AYER_BOGOTA = new Date("2026-10-24T20:00:00Z"); // 24-oct 3 p. m. en Bogotá
  const historial = [
    ...["a", "b", "c", "d"].map((id) => subida({ tarjetaId: id, titulo: `Tarea larga ${id}: con detalle técnico del commit`, creadoEn: AYER_BOGOTA })),
    falla({ tarjetaId: "f", creadoEn: AYER_BOGOTA }),
    aprobada({ tarjetaId: "z", creadoEn: AYER_BOGOTA }),
  ];
  const texto = resumen.textoDelResumen(resumen.armarResumen("2026-10-24", historial), 2);
  const lineas = texto.split("\n");
  assert.ok(lineas.length <= 3, texto);
  assert.equal(lineas[0], "Hoy: 4 listas ✅, 1 con problema ⚠️, 2 esperando tu sí 👆");
  assert.equal(lineas[1], "Ver: https://app.aizenbot.com/cliente/tablero-ia?vista=hoy");
  assert.equal((texto.match(/https?:\/\//g) ?? []).length, 1, "un solo link");
  const sinLink = texto.replace(/https?:\/\/\S+/, "");
  for (const prohibido of [/commit/i, /rama/i, /http/i, /abcdef/, /plan/i, /tarea larga/i, /\bt\d+\b/]) assert.ok(!prohibido.test(sinLink), String(prohibido));
});

await prueba("textoDelResumen: la parte en 0 no sale; 1 sola dice 'lista'; sin nada no hay texto de envío", () => {
  const vacio = resumen.armarResumen("2026-10-22", []);
  assert.equal(resumen.textoDelResumen(vacio, 3).split("\n")[0], "Hoy: 3 esperando tu sí 👆");
  assert.equal(resumen.textoDelResumen(resumen.armarResumen("2026-10-22", [subida()]), 0).split("\n")[0], "Hoy: 1 lista ✅");
  assert.equal(resumen.textoDelResumen(vacio, 0), "Hoy no hubo movimiento.");
});

/* ------------------------------------------------------------------ envío */

await prueba("enviarResumenDiarioSiToca: a las 8:55 p. m. manda UNA vez, solo el texto corto, y anota el día", async () => {
  estado.historial.push(subida({ titulo: "Pantalla nueva" }), subida({ tarjetaId: "t2" }), falla({ tarjetaId: "t3" }));
  estado.esperando = 2;
  const primera = await resumen.enviarResumenDiarioSiToca(new Date("2026-10-23T01:55:00Z"));
  assert.deepEqual(primera, { enviados: 1 }, JSON.stringify([...estado.ajustes]));
  assert.equal(estado.mensajes.length, 1);
  assert.equal(estado.mensajes[0].split("\n")[0], "Hoy: 2 listas ✅, 1 con problema ⚠️, 2 esperando tu sí 👆");
  assert.ok(!estado.mensajes[0].includes("Pantalla nueva"));
  const anotado = await resumen.leerUltimoEnvio("ws1");
  assert.equal(anotado.dia, "2026-10-22");
  assert.equal(anotado.enviado, true);
  assert.equal(anotado.motivo, null);

  const segunda = await resumen.enviarResumenDiarioSiToca(new Date("2026-10-23T01:56:00Z"));
  assert.deepEqual(segunda, { enviados: 0 });
  assert.equal(estado.mensajes.length, 1);
});

await prueba("enviarResumenDiarioSiToca: a las 8:54 p. m. y a las 9:00 p. m. no manda", async () => {
  estado.esperando = 1;
  assert.deepEqual(await resumen.enviarResumenDiarioSiToca(new Date("2026-10-23T01:54:00Z")), { enviados: 0 });
  assert.deepEqual(await resumen.enviarResumenDiarioSiToca(new Date("2026-10-23T02:00:00Z")), { enviados: 0 });
  assert.equal(estado.mensajes.length, 0);
  assert.equal(await resumen.leerUltimoEnvio("ws1"), null);
});

await prueba("enviarResumenDiarioSiToca: si el día no tuvo nada, no manda nada (y lo anota para no reintentar)", async () => {
  estado.historial.push(aprobada({ titulo: "Solo aprobada" }));
  const r = await resumen.enviarResumenDiarioSiToca(new Date("2026-10-23T01:55:00Z"));
  assert.deepEqual(r, { enviados: 0 });
  assert.equal(estado.mensajes.length, 0);
  const anotado = await resumen.leerUltimoEnvio("ws1");
  assert.equal(anotado.enviado, false);
  assert.ok(anotado.motivo.includes("no hubo movimiento"));
});

await prueba("enviarResumenDiarioSiToca: si el WhatsApp no sale queda anotado enviado:false con un motivo", async () => {
  estado.esperando = 1;
  estado.whatsappSale = false;
  const r = await resumen.enviarResumenDiarioSiToca(new Date("2026-10-23T01:55:00Z"));
  assert.deepEqual(r, { enviados: 0 });
  const anotado = await resumen.leerUltimoEnvio("ws1");
  assert.equal(anotado.enviado, false);
  assert.equal(anotado.dia, "2026-10-22");
  assert.ok(anotado.motivo && anotado.motivo.includes("Admin"));
  // Anotado el día: no lo reintenta cada minuto.
  await resumen.enviarResumenDiarioSiToca(new Date("2026-10-23T01:56:00Z"));
  assert.equal(estado.mensajes.length, 1);

  estado.ajustes.clear();
  estado.activo = false;
  await resumen.enviarResumenDiarioSiToca(new Date("2026-10-23T01:57:00Z"));
  assert.ok((await resumen.leerUltimoEnvio("ws1")).motivo.includes("apagado"));
});

await prueba("enviarResumenDiarioSiToca: si el enrutador lanza un error, lo anota y no lanza", async () => {
  estado.esperando = 1;
  const original = enrutador.whatsAppAAlexander;
  enrutador.whatsAppAAlexander = async () => {
    throw new Error("sin red");
  };
  try {
    const r = await resumen.enviarResumenDiarioSiToca(new Date("2026-10-23T01:55:00Z"));
    assert.deepEqual(r, { enviados: 0 });
    const anotado = await resumen.leerUltimoEnvio("ws1");
    assert.equal(anotado.enviado, false);
    assert.ok(anotado.motivo.includes("sin red"));
  } finally {
    enrutador.whatsAppAAlexander = original;
  }
});

await prueba("resumenDeHoyParaLaPantalla devuelve el texto corto de hoy, el interruptor y el envío de hoy", async () => {
  estado.historial.push(subida({ titulo: "Hoy 1" }), subida({ titulo: "De ayer", tarjetaId: "x", creadoEn: AYER }));
  estado.esperando = 1;
  const ahora = new Date("2026-10-23T02:30:00Z");
  const antes = await resumen.resumenDeHoyParaLaPantalla("ws1", ahora);
  assert.equal(antes.dia, "2026-10-22");
  assert.equal(antes.resumen.listas.length, 1);
  assert.equal(antes.texto.split("\n")[0], "Hoy: 1 lista ✅, 1 esperando tu sí 👆");
  assert.equal(antes.envioDeHoy, null);
  assert.equal(antes.aprobacionAutomatica, true);

  await resumen.enviarResumenDiarioSiToca(new Date("2026-10-23T01:55:00Z"));
  const despues = await resumen.resumenDeHoyParaLaPantalla("ws1", ahora);
  assert.equal(despues.envioDeHoy.enviado, true);
  // Al día siguiente el envío de ayer ya no cuenta como el de hoy.
  const manana = await resumen.resumenDeHoyParaLaPantalla("ws1", new Date("2026-10-23T15:00:00Z"));
  assert.equal(manana.envioDeHoy, null);
  assert.equal(manana.ultimoEnvio.dia, "2026-10-22");
});

await prueba("vistaDeHoy: tres grupos con título corto y una línea por tarjeta", async () => {
  estado.historial.push(subida({ tarjetaId: "t1", titulo: "Autorreparación del Coordinador: que se arregle sola cuando falla" }));
  estado.esperando = 2;
  const vista = await resumen.vistaDeHoy("ws1", new Date("2026-10-23T02:30:00Z"));
  assert.equal(vista.dia, "2026-10-22");
  assert.equal(vista.listas.length, 1);
  assert.equal(vista.listas[0].titulo, "Autorreparación del Coordinador");
  assert.equal(vista.conProblema.length, 0);
  assert.equal(vista.teToca.length, 2);
  assert.equal(vista.teToca[0].titulo, "Espera 0");
  assert.equal(vista.teToca[0].resumen, "Detalle sencillo de la tarjeta");
});

console.log(`\n${pruebas} pruebas, todas bien`);
