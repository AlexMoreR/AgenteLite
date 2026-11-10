// Pruebas del resumen diario del Tablero IA (resumen-diario.ts): el día de Bogotá, cómo se arma con el historial
// de HOY (no el de ayer), el texto corto de 4 líneas (6 con los cupos, 31-oct-2026) (la línea Falló con los choques con main, 31-oct-2026), el link del día al final del WhatsApp (6-nov-2026), la vista "Hoy" y la caja "Resumen de hoy" con un prisma
// FALSO. Desde el 10-nov-2026 también el bloque de despliegues (subidas, horario de ventas, devueltas, a mano) y la
// versión que anota el reloj. Desde el 26-oct-2026 el resumen YA NO se manda por WhatsApp (el silencio, las 3 líneas y los avisos al
// dueño se prueban en check-tablero-avisos-al-dueno.mjs). No necesita base ni red.
// Correr: npm run test:tablero-resumen-diario
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

/* ------------------------------------------------------------------ falsos */

const estado = { esperando: [], tarjetas: [], historial: [], intentos: [], ajustes: new Map(), ajustesQueFallan: new Set(), negocios: ["ws1"], salidas: [], mensajes: [], whatsappSale: true, activo: true, destino: "573001112233" };

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
  // Los intentos de las tarjetas (31-oct-2026): para contar las que chocaron con main ese día.
  intentoTarjeta: {
    findMany: async ({ where, distinct }) => {
      const filas = estado.intentos
        .filter((i) => i.workspaceId === where.tarjeta.tablero.workspaceId)
        .filter((i) => i.creadoEn >= where.creadoEn.gte && i.creadoEn < where.creadoEn.lt)
        .filter((i) => where.categoria.in.includes(i.categoria));
      const unicas = distinct?.includes("tarjetaId") ? filas.filter((i, n) => filas.findIndex((o) => o.tarjetaId === i.tarjetaId) === n) : filas;
      return unicas.map((i) => ({ tarjetaId: i.tarjetaId }));
    },
  },
  // `estado.ajustesQueFallan` (10-nov-2026): las claves cuya lectura o escritura falla, para probar que el resumen no se cae.
  appSetting: {
    findUnique: async ({ where }) => {
      if (estado.ajustesQueFallan.has(where.key)) throw new Error("la base no responde");
      return estado.ajustes.has(where.key) ? { value: estado.ajustes.get(where.key) } : null;
    },
    upsert: async ({ where, create, update }) => {
      if (estado.ajustesQueFallan.has(where.key)) throw new Error("la base no responde");
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
    linkDeTerminadosDelDia: (dia) => `https://app.aizenbot.com/cliente/tablero-ia?vista=terminados&dia=${encodeURIComponent(dia)}`,
  },
  // El resumen sale por la línea Admin con avisos-al-dueno.ts (30-oct-2026): envío y latido falsos.
  "@/lib/evolution": {
    sendEvolutionTextMessageWithReconnect: async (datos) => {
      if (!estado.whatsappSale) throw new Error("línea caída");
      estado.mensajes.push(datos);
    },
  },
  // Los máximos del día (31-oct-2026): los guarda el latido; acá, a mano en estado.cuposDelDia.
  "./coordinador-en-vivo": { ultimoLatido: async () => null, leerCuposDelDia: async (_ws, dia) => (estado.cuposDelDia?.dia === dia ? estado.cuposDelDia : null) },
};

const resumen = cargar("src/features/tableros-inteligentes/services/resumen-diario.ts", mocks);
const { QUIEN_AUTOMATICO } = cargar("src/features/tableros-inteligentes/services/aprobacion-automatica.ts", mocks);

let pruebas = 0;
async function prueba(nombre, fn) {
  estado.historial.length = 0;
  estado.intentos.length = 0;
  estado.ajustes.clear();
  estado.ajustesQueFallan.clear();
  estado.cuposDelDia = null;
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
  assert.deepEqual(resumen.cifrasDelDia(resumen.armarResumen("2026-10-22", [aprobada({ creadoEn: AYER })]), 0), { listas: 0, conProblema: 0, esperando: 0, chocaronConMain: 0 });
});

await prueba("una falla sin motivo en la fila (30-oct-2026) lee la nota, el error de la tarjeta y la última causa antes de decir 'sin motivo'", () => {
  const motivoDe = (extra) => resumen.armarResumen("2026-10-22", [fila({ tarjetaId: "f", despues: { estado: "ERROR" }, ...extra })]).fallas[0].motivo;
  assert.equal(motivoDe({ despues: { estado: "ERROR", nota: "soltada y vencida" } }), "soltada y vencida");
  assert.equal(motivoDe({ resultado: { error: { motivo: "venció el candado en EN_CURSO sin respuesta del Coordinador", en: "EN_CURSO" } } }), "venció el candado en EN_CURSO sin respuesta del Coordinador");
  assert.equal(motivoDe({ resultado: { error: { motivo: " " } }, ultimaCausa: "Quedó huérfana: PLANEANDO sin candado." }), "Quedó huérfana: PLANEANDO sin candado.");
  assert.equal(motivoDe({}), "sin motivo");
});

await prueba("las que ya estaban hechas (27-oct-2026) salen aparte, con su commit, y no cuentan como construidas ese día", () => {
  const r = resumen.armarResumen("2026-10-22", [
    subida({ tarjetaId: "b", titulo: "Reporte B" }),
    fila({ tarjetaId: "ya", titulo: "Registro de retroactivos", despues: { estado: "HECHO", nota: "ya estaba hecho (commit f4759b0)", yaEstabaHecho: { commit: "f4759b0", motivo: "construida el 20-oct", nota: "ya estaba hecho (commit f4759b0)" } } }),
  ]);
  assert.equal(r.subidas.length, 1, "solo la construida");
  assert.deepEqual(r.yaHechas.map((x) => [x.tarjetaId, x.titulo, x.commit]), [["ya", "Registro de retroactivos", "f4759b0"]]);
  assert.deepEqual(resumen.cifrasDelDia(r, 0), { listas: 1, conProblema: 0, esperando: 0, chocaronConMain: 0 });
});

await prueba("el resumen de ayer: 4 listas, 1 con problema y 2 esperando -> 2 líneas y un solo link", () => {
  const filas = [
    ...["l1", "l2", "l3", "l4"].map((id) => subida({ tarjetaId: id, titulo: `Tarjeta larguísima con detalles técnicos número ${id}: rama tablero/abc commit abcdef1234` })),
    falla({ tarjetaId: "p1", despues: { estado: "ERROR", motivo: "las pruebas fallaron en la rama tablero/xyz" } }),
  ];
  const r = resumen.armarResumen("2026-10-22", filas);
  const cifras = resumen.cifrasDelDia(r, 2);
  assert.deepEqual(cifras, { listas: 4, conProblema: 1, esperando: 2, chocaronConMain: 0 });
  const texto = resumen.textoDelResumen(cifras);
  assert.equal(texto, "Resumen de Sistemas de hoy:\n✅ Se arregló: 4 tareas\n⚠️ Falló: 1 tarea (0 por choque con main)\n👆 Pendiente: 2 tareas");
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
  assert.deepEqual(resumen.cifrasDelDia(r, 0), { listas: 1, conProblema: 1, esperando: 0, chocaronConMain: 0 });
});

await prueba("textoDelResumen: máximo 4 líneas, sin links, y con todas en 0 no hay texto", () => {
  assert.equal(
    resumen.textoDelResumen({ listas: 1, conProblema: 0, esperando: 0, chocaronConMain: 0 }),
    "Resumen de Sistemas de hoy:\n✅ Se arregló: 1 tarea\n⚠️ Falló: nada (0 por choque con main)\n👆 Pendiente: nada",
  );
  assert.equal(
    resumen.textoDelResumen({ listas: 0, conProblema: 0, esperando: 3, chocaronConMain: 0 }),
    "Resumen de Sistemas de hoy:\n✅ Se arregló: nada\n⚠️ Falló: nada (0 por choque con main)\n👆 Pendiente: 3 tareas",
  );
  assert.equal(resumen.textoDelResumen({ listas: 0, conProblema: 0, esperando: 0, chocaronConMain: 0 }), "");
  assert.equal(resumen.haySinMovimiento({ listas: 0, conProblema: 0, esperando: 0, chocaronConMain: 0 }), true);
  for (const cifras of [{ listas: 9, conProblema: 9, esperando: 9, chocaronConMain: 9 }, { listas: 0, conProblema: 2, esperando: 0, chocaronConMain: 0 }]) {
    const texto = resumen.textoDelResumen(cifras);
    assert.ok(texto.split("\n").length <= 4);
    assert.doesNotMatch(texto, /https?:\/\//);
  }
});

await prueba("textoDelResumen: la línea Falló dice cuántas chocaron con main (1 y 0) y siguen siendo 4 líneas", () => {
  const con = resumen.textoDelResumen({ listas: 2, conProblema: 2, esperando: 0, chocaronConMain: 1 });
  assert.equal(con, "Resumen de Sistemas de hoy:\n✅ Se arregló: 2 tareas\n⚠️ Falló: 2 tareas (1 por choque con main)\n👆 Pendiente: nada");
  assert.equal(con.split("\n").length, 4);
  const sin = resumen.textoDelResumen({ listas: 0, conProblema: 1, esperando: 1, chocaronConMain: 0 });
  assert.equal(sin, "Resumen de Sistemas de hoy:\n✅ Se arregló: nada\n⚠️ Falló: 1 tarea (0 por choque con main)\n👆 Pendiente: 1 tarea");
  assert.equal(sin.split("\n").length, 4);
  // Un día con solo un choque (que se resolvió solo y la tarea sigue en curso) también se cuenta.
  const soloChoque = resumen.textoDelResumen({ listas: 0, conProblema: 0, esperando: 0, chocaronConMain: 1 });
  assert.equal(soloChoque, "Resumen de Sistemas de hoy:\n✅ Se arregló: nada\n⚠️ Falló: nada (1 por choque con main)\n👆 Pendiente: nada");
  assert.equal(soloChoque.split("\n").length, 4);
});

await prueba("cuantasChocaronConMain: tarjetas distintas con choca_con_main o choque_de_logica de ese día, solo del negocio", async () => {
  const intento = (extra) => ({ workspaceId: "ws1", tarjetaId: "k1", categoria: "choca_con_main", creadoEn: HOY_MANANA, ...extra });
  estado.intentos.push(
    intento({}),
    intento({ creadoEn: HOY_TARDE }), // la misma tarjeta dos veces: cuenta una
    intento({ tarjetaId: "k2", categoria: "choque_de_logica" }),
    intento({ tarjetaId: "k3", categoria: "no_compila" }), // otra categoría: no cuenta
    intento({ tarjetaId: "k4", creadoEn: AYER }), // de ayer: no cuenta
    intento({ tarjetaId: "k5", workspaceId: "otro" }), // de otro negocio: no cuenta
  );
  assert.equal(await resumen.cuantasChocaronConMain("ws1", "2026-10-22"), 2);
  assert.equal(await resumen.cuantasChocaronConMain("ws1", "2026-10-21"), 1);
  assert.deepEqual([...resumen.CATEGORIAS_DE_CHOQUE_CON_MAIN], ["choca_con_main", "choque_de_logica"]);
});

await prueba("enviarResumenDiarioAlDueno: una vez al día, a la hora, sin silencio, con el link del día al final", async () => {
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
  // 6-nov-2026: las 4 líneas de siempre y, al final, UNA línea con el link a lo trabajado ese día de Bogotá.
  const lineas = estado.mensajes[0].text.split("\n");
  assert.equal(lineas.length, 5);
  assert.match(estado.mensajes[0].text, /⚠️ Falló: nada \(0 por choque con main\)/);
  assert.equal(lineas[4], "📋 Ver lo trabajado hoy: https://app.aizenbot.com/cliente/tablero-ia?vista=terminados&dia=2026-10-30");
  assert.equal(estado.mensajes[0].text.match(/https?:\/\//g).length, 1, "un solo link");
  // La caja "Resumen de hoy" de la pantalla queda sin link: el WhatsApp es ese texto más la línea del link.
  const pantalla = await resumen.resumenDeHoyParaLaPantalla("ws1", TARDE);
  assert.doesNotMatch(pantalla.texto, /https?:\/\//);
  assert.equal(estado.mensajes[0].text, `${pantalla.texto}\n${lineas[4]}`);
  assert.deepEqual(await resumen.enviarResumenDiarioAlDueno(new Date(TARDE.getTime() + 60_000)), { enviados: 0 }, "no se repite el mismo día");
  assert.equal(estado.mensajes.length, 1);
});

await prueba("enviarResumenDiarioAlDueno: sin movimiento no manda nada; si no salió, reintenta; apagado no sale", async () => {
  const TARDE = new Date("2026-10-30T23:30:00Z");
  estado.ajustes.set("tablero:avisos-dueno:telefono:ws1", "573001112233");
  assert.deepEqual(await resumen.enviarResumenDiarioAlDueno(TARDE), { enviados: 0 });
  assert.equal(estado.mensajes.length, 0, "día vacío: nada, ni el link");
  assert.equal(estado.ajustes.get("tablero:resumen-diario:ultimo:ws1"), "2026-10-30", "queda anotado el día sin movimiento");
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
  // La tarjeta chocó con main por la mañana (se resolvió solo) y subió por la tarde: cuenta en las dos cifras.
  estado.intentos.push({ workspaceId: "ws1", tarjetaId: "h1", categoria: "choca_con_main", creadoEn: HOY_MANANA });
  const ahora = new Date("2026-10-23T02:30:00Z");
  const antes = await resumen.resumenDeHoyParaLaPantalla("ws1", ahora);
  assert.equal(antes.dia, "2026-10-22");
  // 10-nov-2026: la subida (8:00 a. m. de Bogotá) también sale como despliegue del Coordinador en horario de ventas.
  assert.deepEqual(antes.cifras, {
    listas: 1, conProblema: 0, esperando: 0, chocaronConMain: 1,
    despliegues: { delCoordinador: 1, enHorarioDeVentas: 1, deOtros: 0, devueltas: [], noSePudieronDevolver: 0 },
  });
  assert.equal(
    antes.texto,
    "Resumen de Sistemas de hoy:\n✅ Se arregló: 1 tarea\n⚠️ Falló: nada (1 por choque con main)\n👆 Pendiente: nada\n🚀 Despliegues: 1 del Coordinador (1 en horario de ventas)",
  );
  assert.equal(antes.texto.split("\n").length, 5);
  assert.equal(antes.aprobacionAutomatica, true);
  assert.ok(!("envioDeHoy" in antes) && !("ultimoEnvio" in antes), "ya no hay envío por WhatsApp");
  // Al día siguiente, sin movimiento, el texto queda vacío.
  const manana = await resumen.resumenDeHoyParaLaPantalla("ws1", new Date("2026-10-23T15:00:00Z"));
  assert.equal(manana.texto, "");
});

/* ------------------------------------------------------------------ cupos (31-oct-2026) */

await prueba("textoDelResumen con los cupos: «Corriendo a la vez» y la línea para el dueño; sin datos, las 4 de siempre", () => {
  const base = { listas: 12, conProblema: 1, esperando: 2, chocaronConMain: 0 };
  const completo = resumen.textoDelResumen({ ...base, corriendoMax: 5, enFilaMax: 3, cupos: 6, basePorDia: 7, hoy: 12 });
  const lineas = completo.split("\n");
  assert.equal(lineas.length, 6, "6 líneas como mucho");
  assert.equal(lineas[4], "🔁 Corriendo a la vez: 5 (máx.) / en fila: 3");
  assert.equal(lineas[5], "📈 Ahora corren hasta 6 tareas a la vez; antes se terminaban 7 por día (promedio de los 7 días antes del 31-oct) y hoy 12");
  assert.doesNotMatch(completo, /https?:\/\//);
  // Sin los cupos guardados, la línea para el dueño usa el máximo corriendo; sin la base, no sale.
  assert.match(resumen.textoDelResumen({ ...base, corriendoMax: 4, enFilaMax: 0, basePorDia: 7, hoy: 12 }), /Ahora corren hasta 4 tareas a la vez/);
  assert.equal(resumen.textoDelResumen({ ...base, corriendoMax: 4, enFilaMax: 0 }).split("\n").length, 5);
  assert.equal(resumen.textoDelResumen(base).split("\n").length, 4, "sin datos de cupos, como antes");
  // Un día sin movimiento sigue sin texto, aunque haya datos de cupos.
  assert.equal(resumen.textoDelResumen({ listas: 0, conProblema: 0, esperando: 0, chocaronConMain: 0, corriendoMax: 2, enFilaMax: 1, cupos: 6, basePorDia: 7, hoy: 0 }), "");
});

await prueba("cifrasDelDia con los extras: máximos del día, base y hoy (= listas); sin extras queda igual", () => {
  const delDia = resumen.armarResumen("2026-10-22", [subida({ tarjetaId: "a" }), subida({ tarjetaId: "b" })]);
  assert.deepEqual(resumen.cifrasDelDia(delDia, 1, 0), { listas: 2, conProblema: 0, esperando: 1, chocaronConMain: 0 });
  assert.deepEqual(resumen.cifrasDelDia(delDia, 1, 0, { cuposDelDia: { dia: "2026-10-22", corriendoMax: 4, enFilaMax: 2, cupos: 6 }, basePorDia: 7 }), {
    listas: 2, conProblema: 0, esperando: 1, chocaronConMain: 0, corriendoMax: 4, enFilaMax: 2, cupos: 6, basePorDia: 7, hoy: 2,
  });
  assert.equal(resumen.promedioPorDia([3, 4, 4, 5, 6, 8, 9]), 6);
  assert.equal(resumen.promedioPorDia([]), null);
});

await prueba("la base de antes del 31-oct: promedio de las listas del 24 al 30, se guarda una vez; antes del 31 no hay", async () => {
  // 14 listas en los 7 días (2 por día) y una del 31 que no cuenta.
  for (const dia of resumen.DIAS_DE_LA_BASE) {
    estado.historial.push(subida({ tarjetaId: `${dia}-a`, creadoEn: new Date(`${dia}T20:00:00Z`) }), subida({ tarjetaId: `${dia}-b`, creadoEn: new Date(`${dia}T21:00:00Z`) }));
  }
  estado.historial.push(subida({ tarjetaId: "hoy-1", creadoEn: new Date("2026-10-31T20:00:00Z") }));
  assert.equal(await resumen.basePorDiaAntesDel31Oct("ws1", "2026-10-30"), null, "antes del 31-oct no hay base");
  assert.equal(await resumen.basePorDiaAntesDel31Oct("ws1", "2026-10-31"), 2);
  assert.equal(estado.ajustes.get("tablero:resumen-diario:base-antes-31oct:ws1"), "2");
  estado.historial.length = 0;
  assert.equal(await resumen.basePorDiaAntesDel31Oct("ws1", "2026-11-01"), 2, "queda guardada: no se vuelve a calcular");
});

await prueba("enviarResumenDiarioAlDueno el 31-oct: sale con las 6 líneas, la del despliegue y la del link (8), en un solo WhatsApp", async () => {
  const TARDE = new Date("2026-10-31T23:30:00Z"); // 6:30 p. m. de Bogotá
  estado.ajustes.set("tablero:avisos-dueno:telefono:ws1", "573001112233");
  estado.ajustes.set("tablero:resumen-diario:base-antes-31oct:ws1", "7");
  estado.cuposDelDia = { dia: "2026-10-31", corriendoMax: 5, enFilaMax: 3, cupos: 6 };
  estado.historial.push(subida({ tarjetaId: "h1", creadoEn: new Date("2026-10-31T20:00:00Z") }));
  assert.deepEqual(await resumen.enviarResumenDiarioAlDueno(TARDE), { enviados: 1 });
  assert.equal(estado.mensajes.length, 1, "un solo WhatsApp");
  const lineas = estado.mensajes[0].text.split("\n");
  // Con las 6 líneas llenas y la del despliegue (10-nov-2026), la del link es la 8.ª y el recorte del envío no la borra.
  assert.equal(lineas.length, 8);
  assert.equal(lineas[4], "🔁 Corriendo a la vez: 5 (máx.) / en fila: 3");
  assert.match(lineas[5], /antes se terminaban 7 por día .* y hoy 1$/);
  assert.equal(lineas[6], "🚀 Despliegues: 1 del Coordinador (1 en horario de ventas)");
  assert.equal(lineas[7], "📋 Ver lo trabajado hoy: https://app.aizenbot.com/cliente/tablero-ia?vista=terminados&dia=2026-10-31");
  const pantalla = await resumen.resumenDeHoyParaLaPantalla("ws1", TARDE);
  assert.equal(pantalla.texto.split("\n").length, 7, "la caja «Resumen de hoy» con sus 6 líneas y la del despliegue");
  assert.equal(`${pantalla.texto}\n${lineas[7]}`, estado.mensajes[0].text, "la caja dice lo mismo, sin el link");
  estado.mensajes.length = 0;
  estado.esperando.length = 0;
});

await prueba("textoDelWhatsAppDelResumen: el texto más UNA línea con el link del día; vacío si no hay texto", () => {
  assert.equal(resumen.MAXIMO_LINEAS_DEL_RESUMEN, 10);
  assert.equal(resumen.textoDelWhatsAppDelResumen("", "2026-11-06"), "", "sin movimiento: ni el link");
  const texto = resumen.textoDelResumen({ listas: 2, conProblema: 0, esperando: 0, chocaronConMain: 0 });
  const whatsapp = resumen.textoDelWhatsAppDelResumen(texto, "2026-11-06");
  assert.equal(whatsapp, `${texto}\n📋 Ver lo trabajado hoy: https://app.aizenbot.com/cliente/tablero-ia?vista=terminados&dia=2026-11-06`);
  assert.match(whatsapp.split("\n").at(-1), /\?vista=terminados&dia=2026-11-06$/);
});

/* ------------------------------------------------------------------ despliegues (10-nov-2026) */

const CLAVE_VERSIONES = "sistemas:versiones-que-corrieron";
// El 10-nov de Bogotá va de 2026-11-10T05:00Z a 2026-11-11T05:00Z. Las horas de abajo son de Bogotá.
const aLas = (hora, minuto = 0) => new Date(Date.UTC(2026, 10, 10, hora + 5, minuto));
const DIA = "2026-11-10";
const commit = (letra) => letra.repeat(40);
const subidaDe = (tarjetaId, c, cuando, version) =>
  fila({ tarjetaId, creadoEn: cuando, despues: { estado: "HECHO", subida: { commit: c, linkCommit: null, ...(version ? { version } : {}) } } });
const devuelta = (tarjetaId, motivo, reversion, cuando = aLas(11)) => fila({ tarjetaId, creadoEn: cuando, despues: { estado: "ERROR", motivo, reversion } });

await prueba("HORARIO_DE_VENTAS: el supuesto es de 8 a. m. a 6 p. m. de Bogotá (6 p. m. ya no cuenta)", () => {
  assert.deepEqual({ ...resumen.HORARIO_DE_VENTAS }, { desde: 8, hasta: 18 });
  assert.equal(resumen.enHorarioDeVentas(aLas(7, 59)), false);
  assert.equal(resumen.enHorarioDeVentas(aLas(8)), true);
  assert.equal(resumen.enHorarioDeVentas(aLas(17, 59)), true);
  assert.equal(resumen.enHorarioDeVentas(aLas(18)), false);
});

await prueba("desplieguesDelDia: subidas del Coordinador (una por commit) y cuántas en horario de ventas", () => {
  const r = resumen.armarResumen(DIA, [
    subidaDe("a", commit("a"), aLas(7, 30)),
    subidaDe("b", commit("b"), aLas(8)),
    subidaDe("b", commit("b").slice(0, 10), aLas(8, 5)), // el mismo commit dos veces (uno corto): cuenta una
    subidaDe("c", commit("c"), aLas(17, 59)),
    subidaDe("d", commit("d"), aLas(18)),
    fila({ tarjetaId: "e", creadoEn: aLas(12), despues: { estado: "HECHO" } }), // terminada sin subir: no es despliegue
    subidaDe("f", commit("f"), new Date("2026-11-09T20:00:00Z")), // de ayer
  ]);
  assert.deepEqual(resumen.desplieguesDelDia(r, []), { delCoordinador: 4, enHorarioDeVentas: 2, deOtros: 0, devueltas: [], noSePudieronDevolver: 0 });
  assert.equal(resumen.desplieguesDelDia(resumen.armarResumen(DIA, []), []), null, "sin nada, no sale el bloque");
  assert.equal(resumen.desplieguesDelDia(resumen.armarResumen(DIA, [fila({ creadoEn: aLas(12), despues: { estado: "HECHO" } })]), null), null);
});

await prueba("desplieguesDelDia: devueltas con su causa y las que no se pudieron devolver", () => {
  const r = resumen.armarResumen(DIA, [
    devuelta("a", `Se subió, no arrancó y se deshizo; producción vuelve a la versión anterior.\nCommit deshecho: aaaaaaaaaa (revert 1111111111).\nDetalle técnico: el contenedor no respondió /api/health`, { commit: commit("a"), revert: commit("1"), ok: true }),
    devuelta("a", "Revertida: otra vez", { commit: commit("a"), revert: commit("1"), ok: true }), // la misma reversión dos veces: una
    devuelta("b", "Revertida: [minuto 2] el bot dejó de contestar\nSubió sola, la vigilancia de 30 min vio la falla y se deshizo.", { commit: commit("b"), revert: commit("2"), ok: true }),
    devuelta("c", "URGENTE: no se pudo deshacer, revisar a mano. El commit quedó en main.\nPor qué falló el despliegue: no arrancó\nPor qué no se pudo deshacer: conflicto", { commit: commit("c"), revert: null, ok: false }),
    falla({ tarjetaId: "d", creadoEn: aLas(12) }), // una falla sin reversión: no es despliegue
  ]);
  const d = resumen.desplieguesDelDia(r, []);
  assert.deepEqual(d, {
    delCoordinador: 0,
    enHorarioDeVentas: 0,
    deOtros: 0,
    devueltas: ["el contenedor no respondió /api/health", "[minuto 2] el bot dejó de contestar"],
    noSePudieronDevolver: 1,
  });
  assert.equal(resumen.causaDeLaDevuelta(""), "sin motivo");
  assert.equal(resumen.causaDeLaDevuelta("x".repeat(200)).length, 80, "la causa va corta");
});

await prueba("desplieguesDelDia: las versiones de hoy que no son del Coordinador cuentan como a mano o de otros", () => {
  const r = resumen.armarResumen(DIA, [
    subidaDe("a", commit("a"), aLas(10), commit("9")), // el Coordinador mandó la versión que vio (otro sha: un merge)
    subidaDe("b", commit("b"), aLas(11)),
    devuelta("c", "Revertida: x", { commit: commit("c"), revert: commit("2"), ok: true }),
  ]);
  const versiones = [
    { version: commit("0"), desde: "2026-11-09T22:00:00Z" }, // de ayer: no es de hoy
    { version: commit("9"), desde: aLas(10, 5).toISOString() }, // la versión de la subida a
    { version: commit("b"), desde: aLas(11, 5).toISOString() }, // el commit de la subida b
    { version: commit("2"), desde: aLas(11, 30).toISOString() }, // el revert del Coordinador
    { version: commit("e"), desde: aLas(9).toISOString() }, // a mano
    { version: commit("e"), desde: aLas(9, 1).toISOString() }, // la misma otra vez: una
    { version: commit("f"), desde: aLas(20).toISOString() }, // otra a mano, de noche
  ];
  assert.equal(resumen.desplieguesDelDia(r, versiones).deOtros, 2);
  assert.equal(resumen.desplieguesDelDia(r, null).deOtros, null, "si no se pudieron leer, no se sabe");
  // Un día con solo una subida a mano también trae el bloque.
  assert.deepEqual(resumen.desplieguesDelDia(resumen.armarResumen(DIA, []), [{ version: commit("e"), desde: aLas(9).toISOString() }]), {
    delCoordinador: 0, enHorarioDeVentas: 0, deOtros: 1, devueltas: [], noSePudieronDevolver: 0,
  });
});

await prueba("textoDelResumen con los despliegues: hasta 3 líneas más, cada una solo con datos; con todo son 9 y 10 con el link", () => {
  const base = { listas: 3, conProblema: 2, esperando: 1, chocaronConMain: 0, corriendoMax: 5, enFilaMax: 3, cupos: 6, basePorDia: 7, hoy: 3 };
  const despliegues = { delCoordinador: 5, enHorarioDeVentas: 3, deOtros: 1, devueltas: ["no arrancó", "el bot dejó de contestar", "otra"], noSePudieronDevolver: 1 };
  const texto = resumen.textoDelResumen({ ...base, despliegues });
  const lineas = texto.split("\n");
  assert.equal(lineas.length, 9);
  assert.equal(lineas[6], "🚀 Despliegues: 5 del Coordinador (3 en horario de ventas), 1 a mano o de otros");
  assert.equal(lineas[7], "↩️ Devueltas: 3 (no arrancó; el bot dejó de contestar; …)");
  assert.equal(lineas[8], "🆘 No se pudieron devolver: 1, revisar a mano");
  const whatsapp = resumen.textoDelWhatsAppDelResumen(texto, DIA);
  assert.equal(whatsapp.split("\n").length, resumen.MAXIMO_LINEAS_DEL_RESUMEN, "el máximo alcanza para todo, con el link al final");
  // Cada línea sale solo con datos.
  const solo = (d) => resumen.textoDelResumen({ listas: 1, conProblema: 0, esperando: 0, chocaronConMain: 0, despliegues: { delCoordinador: 0, enHorarioDeVentas: 0, deOtros: 0, devueltas: [], noSePudieronDevolver: 0, ...d } }).split("\n").slice(4);
  assert.deepEqual(solo({ delCoordinador: 2, enHorarioDeVentas: 0 }), ["🚀 Despliegues: 2 del Coordinador (0 en horario de ventas)"]);
  assert.deepEqual(solo({ deOtros: 2 }), ["🚀 Despliegues: 2 a mano o de otros"]);
  assert.deepEqual(solo({ deOtros: null, devueltas: ["no arrancó"] }), ["↩️ Devueltas: 1 (no arrancó)"]);
  assert.deepEqual(solo({ noSePudieronDevolver: 2 }), ["🆘 No se pudieron devolver: 2, revisar a mano"]);
  assert.deepEqual(solo({}), []);
  // Un día sin movimiento sigue sin texto (los despliegues solos no mandan el resumen).
  assert.equal(resumen.textoDelResumen({ listas: 0, conProblema: 0, esperando: 0, chocaronConMain: 0, despliegues }), "");
});

await prueba("anotarVersionQueCorre: anota cada versión nueva una vez; sin versión no hace nada; si la base falla, no lanza y reintenta", async () => {
  assert.equal(await resumen.anotarVersionQueCorre(aLas(9), ""), false, "sin versión (desarrollo) no anota");
  assert.equal(estado.ajustes.has(CLAVE_VERSIONES), false);
  estado.ajustesQueFallan.add(CLAVE_VERSIONES);
  assert.equal(await resumen.anotarVersionQueCorre(aLas(9), commit("1")), false, "la base falla: no lanza");
  estado.ajustesQueFallan.clear();
  assert.equal(await resumen.anotarVersionQueCorre(aLas(9, 1), commit("1")), true, "el minuto siguiente la anota");
  assert.equal(await resumen.anotarVersionQueCorre(aLas(9, 2), commit("1")), false, "la misma versión no se vuelve a anotar");
  assert.equal(await resumen.anotarVersionQueCorre(aLas(14), commit("2")), true);
  assert.deepEqual(JSON.parse(estado.ajustes.get(CLAVE_VERSIONES)), [
    { version: commit("1"), desde: aLas(9, 1).toISOString() },
    { version: commit("2"), desde: aLas(14).toISOString() },
  ]);
  // Las de hace más de 3 días se limpian al anotar una nueva; lo que no se entiende se descarta.
  estado.ajustes.set(CLAVE_VERSIONES, JSON.stringify([{ version: commit("0"), desde: "2026-11-01T10:00:00Z" }, { nada: 1 }, { version: commit("2"), desde: aLas(14).toISOString() }]));
  assert.equal(await resumen.anotarVersionQueCorre(aLas(15), commit("3")), true);
  assert.deepEqual(JSON.parse(estado.ajustes.get(CLAVE_VERSIONES)).map((v) => v.version), [commit("2"), commit("3")]);
  assert.deepEqual(resumen.versionesGuardadas("no es json"), []);
  assert.deepEqual(await resumen.leerVersionesQueCorrieron(), JSON.parse(estado.ajustes.get(CLAVE_VERSIONES)));
});

await prueba("enviarResumenDiarioAlDueno con despliegues: el bloque va antes del link; si no se leen las versiones, sale igual sin «a mano»", async () => {
  const TARDE = aLas(18, 30);
  estado.ajustes.set("tablero:avisos-dueno:telefono:ws1", "573001112233");
  estado.historial.push(
    subidaDe("a", commit("a"), aLas(10)),
    subidaDe("b", commit("b"), aLas(19)),
    devuelta("c", "Revertida: el bot dejó de contestar", { commit: commit("c"), revert: commit("2"), ok: true }),
  );
  estado.ajustes.set(CLAVE_VERSIONES, JSON.stringify([{ version: commit("e"), desde: aLas(9).toISOString() }]));
  assert.deepEqual(await resumen.enviarResumenDiarioAlDueno(TARDE), { enviados: 1 });
  const lineas = estado.mensajes[0].text.split("\n");
  assert.deepEqual(lineas.slice(4), [
    "🚀 Despliegues: 2 del Coordinador (1 en horario de ventas), 1 a mano o de otros",
    "↩️ Devueltas: 1 (el bot dejó de contestar)",
    `📋 Ver lo trabajado hoy: https://app.aizenbot.com/cliente/tablero-ia?vista=terminados&dia=${DIA}`,
  ]);
  // La base no deja leer las versiones: el resumen sale igual, sin la parte de "a mano o de otros".
  estado.mensajes.length = 0;
  estado.ajustes.delete("tablero:resumen-diario:ultimo:ws1");
  estado.ajustesQueFallan.add(CLAVE_VERSIONES);
  assert.deepEqual(await resumen.enviarResumenDiarioAlDueno(TARDE), { enviados: 1 });
  assert.equal(estado.mensajes[0].text.split("\n")[4], "🚀 Despliegues: 2 del Coordinador (1 en horario de ventas)");
  const pantalla = await resumen.resumenDeHoyParaLaPantalla("ws1", TARDE);
  assert.equal(pantalla.cifras.despliegues.deOtros, null);
  estado.mensajes.length = 0;
});

assert.equal(resumen.enviarResumenDiarioSiToca, undefined, "el resumen ya no se manda por WhatsApp");
assert.equal(estado.mensajes.length, 0);

console.log(`\n${pruebas} pruebas, todas bien`);
