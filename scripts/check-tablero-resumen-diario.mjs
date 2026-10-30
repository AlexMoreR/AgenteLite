// Pruebas del resumen diario del Tablero IA (resumen-diario.ts): el día de Bogotá, cómo se arma con el historial
// de HOY (no el de ayer), el texto corto de 2 líneas, la vista "Hoy" y la caja "Resumen de hoy" con un prisma
// FALSO. Desde el 26-oct-2026 el resumen YA NO se manda por WhatsApp (el silencio, las 3 líneas y los avisos al
// dueño se prueban en check-tablero-avisos-al-dueno.mjs). No necesita base ni red.
// Correr: npm run test:tablero-resumen-diario
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

/* ------------------------------------------------------------------ falsos */

const estado = { esperando: [], tarjetas: [], historial: [], ajustes: new Map(), negocios: ["ws1"], salidas: [], mensajes: [], whatsappSale: true, activo: true, destino: "573001112233" };

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
  tarjetaTablero: {
    findMany: async ({ where }) => estado.tarjetas.filter((t) => where.id.in.includes(t.id)),
  },
  tableroInteligente: { findMany: async () => estado.negocios.map((workspaceId) => ({ workspaceId })) },
  // La línea Admin conectada (el resumen sale por ahí) y nadie más en la lista de números prohibidos.
  whatsAppChannel: {
    findMany: async () => [{ name: "Admin", phoneNumber: "573009990000" }],
    findFirst: async () => ({ name: "Admin", evolutionInstanceName: "admin-inst" }),
  },
  workspaceMember: { findMany: async () => [] },
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
  // "Te toca a ti" falso: lo que hoy espera al dueño. El link es el de verdad (misma forma que tableros.ts).
  "./tableros": {
    pendientesDelDueno: async () => estado.esperando,
    todoElNegocio: (workspaceId) => ({ workspaceId, soloDe: null }),
    linkDeHoy: () => "https://app.aizenbot.com/cliente/tablero-ia?vista=hoy",
    linkDelCoordinador: () => "https://app.aizenbot.com/cliente/tablero-ia?vista=coordinador",
    linkDeLaTarjeta: (id) => `https://app.aizenbot.com/cliente/tablero-ia?tarjeta=${id}`,
  },
  // El resumen sale por la línea Admin con avisos-al-dueno.ts (30-oct-2026): envío y latido falsos.
  "@/lib/evolution": {
    sendEvolutionTextMessageWithReconnect: async (datos) => {
      if (!estado.whatsappSale) throw new Error("línea caída");
      estado.mensajes.push(datos);
    },
  },
  "./coordinador-en-vivo": { ultimoLatido: async () => null },
};

const resumen = cargar("src/features/tableros-inteligentes/services/resumen-diario.ts", mocks);
const { QUIEN_AUTOMATICO } = cargar("src/features/tableros-inteligentes/services/aprobacion-automatica.ts", mocks);

let pruebas = 0;
async function prueba(nombre, fn) {
  estado.historial.length = 0;
  estado.ajustes.clear();
  estado.mensajes.length = 0;
  estado.esperando = [];
  estado.tarjetas = [];
  estado.whatsappSale = true;
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

/* ------------------------------------------------------------------ armar y texto */

await prueba("armarResumen lista solo lo de hoy (no lo de ayer)", () => {
  const r = resumen.armarResumen("2026-10-22", [
    aprobada({ creadoEn: AYER, tarjetaId: "vieja", titulo: "De ayer" }),
    subida({ creadoEn: AYER, tarjetaId: "vieja2" }),
    falla({ creadoEn: AYER, tarjetaId: "vieja3" }),
    aprobada({ tarjetaId: "a", titulo: "Reporte A" }),
    subida({ tarjetaId: "b", titulo: "Reporte B", creadoEn: HOY_TARDE }),
    falla({ tarjetaId: "c", titulo: "Reporte C" }),
    fila({ tarjetaId: "d", despues: { estado: "HECHO" } }),
    fila({ despues: { estado: "EN_CURSO" } }),
    fila({ accion: "aprobar", quien: "user-1", despues: { momento: "tarea" } }),
  ]);
  assert.equal(r.aprobadas.length, 1);
  assert.equal(r.aprobadas[0].titulo, "Reporte A");
  assert.equal(r.subidas.length, 2, "una subida y una terminada sin subir");
  assert.equal(r.subidas.find((x) => x.tarjetaId === "b").commit, "abcdef1234567890");
  assert.equal(r.fallas.length, 1);
  assert.equal(r.fallas[0].motivo, "las pruebas fallaron");
  assert.deepEqual(resumen.cifrasDelDia(resumen.armarResumen("2026-10-22", [aprobada({ creadoEn: AYER })]), 0), { listas: 0, conProblema: 0, esperando: 0 });
});

await prueba("las que ya estaban hechas (27-oct-2026) salen aparte, con su commit, y no cuentan como construidas ese día", () => {
  const r = resumen.armarResumen("2026-10-22", [
    subida({ tarjetaId: "b", titulo: "Reporte B" }),
    fila({ tarjetaId: "ya", titulo: "Registro de retroactivos", despues: { estado: "HECHO", nota: "ya estaba hecho (commit f4759b0)", yaEstabaHecho: { commit: "f4759b0", motivo: "construida el 20-oct", nota: "ya estaba hecho (commit f4759b0)" } } }),
  ]);
  assert.equal(r.subidas.length, 1, "solo la construida");
  assert.deepEqual(r.yaHechas.map((x) => [x.tarjetaId, x.titulo, x.commit]), [["ya", "Registro de retroactivos", "f4759b0"]]);
  assert.deepEqual(resumen.cifrasDelDia(r, 0), { listas: 1, conProblema: 0, esperando: 0 });
});

await prueba("el resumen de ayer: 4 listas, 1 con problema y 2 esperando -> 2 líneas y un solo link", () => {
  const filas = [
    ...["l1", "l2", "l3", "l4"].map((id) => subida({ tarjetaId: id, titulo: `Tarjeta larguísima con detalles técnicos número ${id}: rama tablero/abc commit abcdef1234` })),
    falla({ tarjetaId: "p1", despues: { estado: "ERROR", motivo: "las pruebas fallaron en la rama tablero/xyz" } }),
  ];
  const r = resumen.armarResumen("2026-10-22", filas);
  const cifras = resumen.cifrasDelDia(r, 2);
  assert.deepEqual(cifras, { listas: 4, conProblema: 1, esperando: 2 });
  const texto = resumen.textoDelResumen(cifras);
  assert.equal(texto, "Resumen de Sistemas de hoy:\n✅ Se arregló: 4 tareas\n⚠️ Falló: 1 tarea\n👆 Pendiente: 2 tareas");
  const lineas = texto.split("\n");
  assert.ok(lineas.length <= 4, "4 líneas o menos");
  assert.doesNotMatch(texto, /commit|rama|http|tablero\/|abcdef|Tarjeta larguísima/i, "sin links ni detalles para revisar");
});

await prueba("cifras: una tarjeta que falló y luego subió cuenta una sola vez, como lista", () => {
  const r = resumen.armarResumen("2026-10-22", [
    falla({ tarjetaId: "x", creadoEn: new Date("2026-10-22T13:00:00Z") }),
    subida({ tarjetaId: "x", creadoEn: new Date("2026-10-22T15:00:00Z") }),
    subida({ tarjetaId: "x", creadoEn: new Date("2026-10-22T16:00:00Z") }),
    falla({ tarjetaId: "y" }),
    falla({ tarjetaId: "y", creadoEn: HOY_TARDE }),
  ]);
  assert.deepEqual(resumen.cifrasDelDia(r, 0), { listas: 1, conProblema: 1, esperando: 0 });
});

await prueba("textoDelResumen: máximo 4 líneas, sin links, y con las tres en 0 no hay texto", () => {
  assert.equal(
    resumen.textoDelResumen({ listas: 1, conProblema: 0, esperando: 0 }),
    "Resumen de Sistemas de hoy:\n✅ Se arregló: 1 tarea\n⚠️ Falló: nada\n👆 Pendiente: nada",
  );
  assert.equal(
    resumen.textoDelResumen({ listas: 0, conProblema: 0, esperando: 3 }),
    "Resumen de Sistemas de hoy:\n✅ Se arregló: nada\n⚠️ Falló: nada\n👆 Pendiente: 3 tareas",
  );
  assert.equal(resumen.textoDelResumen({ listas: 0, conProblema: 0, esperando: 0 }), "");
  assert.equal(resumen.haySinMovimiento({ listas: 0, conProblema: 0, esperando: 0 }), true);
  for (const cifras of [{ listas: 9, conProblema: 9, esperando: 9 }, { listas: 0, conProblema: 2, esperando: 0 }]) {
    const texto = resumen.textoDelResumen(cifras);
    assert.ok(texto.split("\n").length <= 4);
    assert.doesNotMatch(texto, /https?:\/\//);
  }
});

await prueba("enviarResumenDiarioAlDueno: una vez al día, a la hora, sin silencio ni movimiento vacío", async () => {
  const TARDE = new Date("2026-10-30T23:30:00Z"); // 6:30 p. m. de Bogotá
  const MANANA = new Date("2026-10-30T15:00:00Z"); // 10:00 a. m.
  const NOCHE = new Date("2026-10-31T03:00:00Z"); // 10:00 p. m.
  estado.ajustes.set("tablero:avisos-dueno:telefono:ws1", "573001112233");
  estado.esperando.push({ id: "t3", titulo: "Reuniones", detalle: "x", plan: null, resultado: null });
  assert.deepEqual(await resumen.enviarResumenDiarioAlDueno(MANANA), { enviados: 0 }, "antes de las 6 p. m. no sale");
  assert.deepEqual(await resumen.enviarResumenDiarioAlDueno(NOCHE), { enviados: 0 }, "en el silencio no sale");
  assert.equal(estado.mensajes.length, 0);
  assert.deepEqual(await resumen.enviarResumenDiarioAlDueno(TARDE), { enviados: 1 });
  assert.equal(estado.mensajes.length, 1);
  assert.equal(estado.mensajes[0].text.split("\n").length, 4);
  assert.doesNotMatch(estado.mensajes[0].text, /https?:\/\//);
  assert.deepEqual(await resumen.enviarResumenDiarioAlDueno(new Date(TARDE.getTime() + 60_000)), { enviados: 0 }, "no se repite el mismo día");
  assert.equal(estado.mensajes.length, 1);
});

await prueba("enviarResumenDiarioAlDueno: sin movimiento no manda nada; si no salió, reintenta; apagado no sale", async () => {
  const TARDE = new Date("2026-10-30T23:30:00Z");
  estado.ajustes.set("tablero:avisos-dueno:telefono:ws1", "573001112233");
  assert.deepEqual(await resumen.enviarResumenDiarioAlDueno(TARDE), { enviados: 0 });
  assert.equal(estado.mensajes.length, 0, "día vacío: nada");
  estado.esperando.push({ id: "t3", titulo: "Reuniones", detalle: "x", plan: null, resultado: null });
  estado.ajustes.set("tablero:resumen-diario:ultimo:ws1", "2026-10-29");
  estado.ajustes.set("tablero:resumen-diario:activo:ws1", "false");
  assert.deepEqual(await resumen.enviarResumenDiarioAlDueno(TARDE), { enviados: 0 }, "interruptor del resumen apagado");
  estado.ajustes.delete("tablero:resumen-diario:activo:ws1");
  estado.whatsappSale = false;
  assert.deepEqual(await resumen.enviarResumenDiarioAlDueno(TARDE), { enviados: 0 });
  estado.whatsappSale = true;
  assert.deepEqual(await resumen.enviarResumenDiarioAlDueno(TARDE), { enviados: 1 }, "reintenta el siguiente minuto");
});

await prueba("vistaDeHoy: títulos cortos, una línea de resumen y los tres grupos", async () => {
  estado.historial.push(subida({ tarjetaId: "t1" }), falla({ tarjetaId: "t2" }));
  estado.tarjetas.push(
    { id: "t1", titulo: "Autorreparación del Coordinador: que se repare solo cuando falle", detalle: "x", plan: null, resultado: { resumen: "Ahora el Coordinador se repara solo si falla una tarea." } },
    { id: "t2", titulo: "Reporte de ventas — arreglar el total", detalle: "El total no suma bien las ventas de hoy.", plan: null, resultado: null },
  );
  estado.esperando.push({ id: "t3", titulo: "Reuniones (parte 2)", detalle: "Agregar el botón de compartir pantalla a la sala.", plan: null, resultado: null });
  const vista = await resumen.vistaDeHoy("ws1", new Date("2026-10-23T01:55:00Z"));
  assert.equal(vista.dia, "2026-10-22");
  assert.equal(vista.listas[0].titulo, "Autorreparación del Coordinador");
  assert.match(vista.listas[0].resumen, /se repara solo/);
  assert.equal(vista.conProblema[0].titulo, "Reporte de ventas");
  assert.equal(vista.teToca[0].titulo, "Reuniones");
  assert.ok(vista.teToca[0].resumen.length <= 140);
});

await prueba("vistaDeHoy muestra las 3 líneas de la subida y, sin ellas, se ve como antes", async () => {
  estado.historial.length = 0;
  estado.tarjetas.length = 0;
  estado.esperando.length = 0;
  estado.historial.push(
    fila({
      tarjetaId: "c1",
      despues: { estado: "HECHO", subida: { commit: "abc1234567", resumenTres: { hizo: "Se agregó el botón", ahora: "El botón sale en la sala", revisar: "Probarlo con una asesora" } } },
    }),
    subida({ tarjetaId: "c2" }),
  );
  estado.tarjetas.push(
    { id: "c1", titulo: "Botón de la sala", detalle: "x", plan: null, resultado: { resumen: "Listo." } },
    { id: "c2", titulo: "Otra tarea", detalle: "x", plan: null, resultado: { resumen: "Listo también." } },
  );
  const vista = await resumen.vistaDeHoy("ws1", new Date("2026-10-23T01:55:00Z"));
  const con = vista.listas.find((l) => l.tarjetaId === "c1");
  const sin = vista.listas.find((l) => l.tarjetaId === "c2");
  assert.deepEqual(con.tresLineas, { hizo: "Se agregó el botón", ahora: "El botón sale en la sala", revisar: "Probarlo con una asesora" });
  assert.equal("tresLineas" in sin, false, "sin las 3 líneas la línea queda como antes");
  assert.equal(resumen.armarResumen("2026-10-22", [subida({ tarjetaId: "z" })]).subidas[0].tresLineas, undefined);
});

/* ------------------------------------------------------------------ envío */

await prueba("resumenDeHoyParaLaPantalla devuelve las cifras, el texto corto y el interruptor (sin envío por WhatsApp)", async () => {
  estado.historial.push(subida({ tarjetaId: "h1", titulo: "Hoy 1" }), subida({ tarjetaId: "v1", titulo: "De ayer", creadoEn: AYER }));
  const ahora = new Date("2026-10-23T02:30:00Z");
  const antes = await resumen.resumenDeHoyParaLaPantalla("ws1", ahora);
  assert.equal(antes.dia, "2026-10-22");
  assert.deepEqual(antes.cifras, { listas: 1, conProblema: 0, esperando: 0 });
  assert.equal(antes.texto, "Resumen de Sistemas de hoy:\n✅ Se arregló: 1 tarea\n⚠️ Falló: nada\n👆 Pendiente: nada");
  assert.equal(antes.aprobacionAutomatica, true);
  assert.ok(!("envioDeHoy" in antes) && !("ultimoEnvio" in antes), "ya no hay envío por WhatsApp");
  // Al día siguiente, sin movimiento, el texto queda vacío.
  const manana = await resumen.resumenDeHoyParaLaPantalla("ws1", new Date("2026-10-23T15:00:00Z"));
  assert.equal(manana.texto, "");
});

assert.equal(resumen.enviarResumenDiarioSiToca, undefined, "el resumen ya no se manda por WhatsApp");
assert.equal(estado.mensajes.length, 0);

console.log(`\n${pruebas} pruebas, todas bien`);
