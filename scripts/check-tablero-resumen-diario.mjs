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
  },
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

await prueba("el resumen de ayer: 4 listas, 1 con problema y 2 esperando -> 2 líneas y un solo link", () => {
  const filas = [
    ...["l1", "l2", "l3", "l4"].map((id) => subida({ tarjetaId: id, titulo: `Tarjeta larguísima con detalles técnicos número ${id}: rama tablero/abc commit abcdef1234` })),
    falla({ tarjetaId: "p1", despues: { estado: "ERROR", motivo: "las pruebas fallaron en la rama tablero/xyz" } }),
  ];
  const r = resumen.armarResumen("2026-10-22", filas);
  const cifras = resumen.cifrasDelDia(r, 2);
  assert.deepEqual(cifras, { listas: 4, conProblema: 1, esperando: 2 });
  const texto = resumen.textoDelResumen(cifras);
  assert.equal(texto, "Hoy: 4 listas ✅, 1 con problema ⚠️, 2 esperando tu sí 👆\nVer: https://app.aizenbot.com/cliente/tablero-ia?vista=hoy");
  const lineas = texto.split("\n");
  assert.ok(lineas.length <= 3, "3 líneas o menos");
  assert.equal(lineas[0], "Hoy: 4 listas ✅, 1 con problema ⚠️, 2 esperando tu sí 👆");
  assert.equal(texto.match(/https?:\/\//g).length, 1, "un solo link");
  assert.ok(lineas[1].endsWith("/cliente/tablero-ia?vista=hoy"), "abre el tablero filtrado en hoy");
  const sinLink = texto.replace(/https?:\/\/\S+/g, "");
  assert.doesNotMatch(sinLink, /commit|rama|http|tablero\/|abcdef|Tarjeta larguísima/i);
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

await prueba("textoDelResumen: la cifra en 0 no sale; con las tres en 0 no hay texto", () => {
  assert.equal(
    resumen.textoDelResumen({ listas: 1, conProblema: 0, esperando: 0 }),
    "Hoy: 1 lista ✅\nVer: https://app.aizenbot.com/cliente/tablero-ia?vista=hoy",
  );
  assert.equal(
    resumen.textoDelResumen({ listas: 0, conProblema: 0, esperando: 3 }),
    "Hoy: 3 esperando tu sí 👆\nVer: https://app.aizenbot.com/cliente/tablero-ia?vista=hoy",
  );
  assert.equal(resumen.textoDelResumen({ listas: 0, conProblema: 0, esperando: 0 }), "");
  assert.equal(resumen.haySinMovimiento({ listas: 0, conProblema: 0, esperando: 0 }), true);
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

/* ------------------------------------------------------------------ envío */

await prueba("resumenDeHoyParaLaPantalla devuelve las cifras, el texto corto y el interruptor (sin envío por WhatsApp)", async () => {
  estado.historial.push(subida({ tarjetaId: "h1", titulo: "Hoy 1" }), subida({ tarjetaId: "v1", titulo: "De ayer", creadoEn: AYER }));
  const ahora = new Date("2026-10-23T02:30:00Z");
  const antes = await resumen.resumenDeHoyParaLaPantalla("ws1", ahora);
  assert.equal(antes.dia, "2026-10-22");
  assert.deepEqual(antes.cifras, { listas: 1, conProblema: 0, esperando: 0 });
  assert.equal(antes.texto, "Hoy: 1 lista ✅\nVer: https://app.aizenbot.com/cliente/tablero-ia?vista=hoy");
  assert.equal(antes.aprobacionAutomatica, true);
  assert.ok(!("envioDeHoy" in antes) && !("ultimoEnvio" in antes), "ya no hay envío por WhatsApp");
  // Al día siguiente, sin movimiento, el texto queda vacío.
  const manana = await resumen.resumenDeHoyParaLaPantalla("ws1", new Date("2026-10-23T15:00:00Z"));
  assert.equal(manana.texto, "");
});

assert.equal(resumen.enviarResumenDiarioSiToca, undefined, "el resumen ya no se manda por WhatsApp");
assert.equal(estado.mensajes.length, 0);

console.log(`\n${pruebas} pruebas, todas bien`);
