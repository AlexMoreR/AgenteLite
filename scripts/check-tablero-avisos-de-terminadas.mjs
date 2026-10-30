// Pruebas del aviso "terminada" al dueño (avisos-de-terminadas.ts) con un prisma, una línea de WhatsApp y unos links
// FALSOS. Comprueba el texto de una y de varias tarjetas (emoji, T-código, título recortado), que solo cuenta el
// HECHO del Coordinador (no el hecho a mano, ni sin repo, ni de más de 24 horas), un solo aviso por tarjeta, que de
// noche no sale, los dos interruptores, que la primera vuelta marca YA_VISTO sin mandar y que 3 fallos dejan el aviso
// FALLIDO. No necesita base ni red.
// Correr: npm run test:tablero-avisos-de-terminadas
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

/* ------------------------------------------------------------------ falsos */

const LINEA_ADMIN = "cmt06kiob00lw2hk2mgllstsb";
const estado = {};
const reiniciar = () => {
  Object.assign(estado, {
    ajustes: new Map(),
    lineas: [
      { id: LINEA_ADMIN, workspaceId: "ws1", name: "Admin", purpose: "ADMIN", phoneNumber: "573009990000", isActive: true, evolutionInstanceName: "admin-inst" },
      { id: "ventas1", workspaceId: "ws1", name: "Ventas", purpose: "SALES", phoneNumber: "573008880000", isActive: true, evolutionInstanceName: "ventas-inst" },
    ],
    miembros: [{ role: "AGENT", user: { name: "Marcela", phone: "3017776666" } }],
    tarjetas: [],
    filas: [],
    enviados: [],
    alertas: [],
    fallaElEnvio: false,
  });
};
reiniciar();

const coincideLinea = (l, where) =>
  l.workspaceId === where.workspaceId &&
  (where.id === undefined || l.id === where.id) &&
  (where.isActive === undefined || l.isActive === where.isActive) &&
  (!where.evolutionInstanceName || l.evolutionInstanceName) &&
  (!where.name || l.name.toLowerCase() === where.name.equals.toLowerCase());

const coincideFila = (f, where) => {
  if (where.id !== undefined) {
    if (typeof where.id === "object" ? !where.id.in.includes(f.id) : f.id !== where.id) return false;
  }
  if (where.workspaceId !== undefined && f.workspaceId !== where.workspaceId) return false;
  if (where.motivo !== undefined && f.motivo !== where.motivo) return false;
  if (where.estado !== undefined && f.estado !== where.estado) return false;
  if (where.tarjetaId?.in && !where.tarjetaId.in.includes(f.tarjetaId)) return false;
  if (where.OR && !where.OR.some((o) => coincideFila(f, o))) return false;
  return true;
};

const falso = {
  appSetting: {
    findUnique: async ({ where }) => (estado.ajustes.has(where.key) ? { value: estado.ajustes.get(where.key) } : null),
    upsert: async ({ where, create, update }) => {
      estado.ajustes.set(where.key, estado.ajustes.has(where.key) ? update.value : create.value);
    },
  },
  whatsAppChannel: {
    findMany: async ({ where }) => estado.lineas.filter((l) => l.workspaceId === where.workspaceId),
    findFirst: async ({ where }) => estado.lineas.find((l) => coincideLinea(l, where)) ?? null,
  },
  workspaceMember: { findMany: async () => estado.miembros },
  tableroInteligente: { findMany: async () => [{ workspaceId: "ws1" }] },
  tarjetaTablero: {
    findMany: async ({ where }) =>
      estado.tarjetas
        .filter((t) => t.estado === where.estado && t.borradoEn === where.borradoEn && t.repo !== null)
        .filter((t) => !where.historial?.some || t.historial.some((h) => h.accion === where.historial.some.accion && h.creadoEn >= where.historial.some.creadoEn.gte))
        .map((t) => ({ ...t, historial: [...t.historial].sort((a, b) => b.creadoEn - a.creadoEn) })),
  },
  avisoTarjetaEquipo: {
    findMany: async ({ where }) => estado.filas.filter((f) => coincideFila(f, where)),
    create: async ({ data }) => {
      if (estado.filas.some((f) => f.tarjetaId === data.tarjetaId && f.motivo === data.motivo)) throw Object.assign(new Error("único"), { code: "P2002" });
      const fila = { id: `f${estado.filas.length + 1}`, intentos: 0, enviadoEn: null, detalle: null, ...data };
      estado.filas.push(fila);
      return fila;
    },
    createMany: async ({ data }) => {
      for (const d of data) {
        if (!estado.filas.some((f) => f.tarjetaId === d.tarjetaId && f.motivo === d.motivo)) estado.filas.push({ id: `f${estado.filas.length + 1}`, intentos: 0, enviadoEn: null, detalle: null, ...d });
      }
    },
    updateMany: async ({ where, data }) => {
      for (const f of estado.filas.filter((x) => coincideFila(x, where))) Object.assign(f, data);
    },
  },
  alertaInterna: {
    findFirst: async ({ where }) => estado.alertas.find((a) => a.workspaceId === where.workspaceId && a.clave === where.clave && ["NUEVA", "VISTA"].includes(a.estado)) ?? null,
    create: async ({ data }) => {
      const fila = { id: `al${estado.alertas.length + 1}`, estado: "NUEVA", salioPorWhatsApp: false, veces: 1, ...data };
      estado.alertas.push(fila);
      return { id: fila.id };
    },
    update: async () => ({}),
    updateMany: async () => {},
  },
};

const mocks = {
  "@/lib/prisma": { prisma: falso },
  "@prisma/client": { Prisma: {} },
  "@/lib/evolution": {
    sendEvolutionTextMessageWithReconnect: async (datos) => {
      if (estado.fallaElEnvio) throw new Error("línea caída");
      estado.enviados.push(datos);
    },
  },
  "./coordinador-en-vivo": { ultimoLatido: async () => null },
  "./tableros": {
    pendientesDelDueno: async () => [],
    todoElNegocio: (workspaceId) => ({ workspaceId, soloDe: null }),
    linkDeHoy: () => "https://app.aizenbot.com/cliente/tablero-ia?vista=hoy",
    linkDelCoordinador: () => "https://app.aizenbot.com/cliente/tablero-ia?vista=coordinador",
    linkDeLaTarjeta: (id) => `https://app.aizenbot.com/cliente/tablero-ia?tarjeta=${id}`,
  },
};

const terminadas = cargar("src/features/tableros-inteligentes/services/avisos-de-terminadas.ts", mocks);

let pruebas = 0;
async function prueba(nombre, fn) {
  reiniciar();
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

// 10:00 a. m. de Bogotá (15:00Z) y 11:00 p. m. (04:00Z del día siguiente).
const DIA = new Date("2026-10-26T15:00:00Z");
const NOCHE = new Date("2026-10-27T04:00:00Z");
const HORA = 3_600_000;
const hace = (ms, desde = DIA) => new Date(desde.getTime() - ms);
const guardarNumero = () => estado.ajustes.set("tablero:avisos-dueno:telefono:ws1", "573001112233");
const BASE = "tablero:avisos-dueno:terminadas:base:ws1";
const lineas = (texto) => texto.split("\n");

const delCoordinador = (creadoEn, extra = {}) => ({ accion: "estado", origen: "TRABAJADOR", quien: "trabajador:clave1", despues: { estado: "HECHO" }, deshechoEn: null, creadoEn, ...extra });
const aMano = (creadoEn) => ({ accion: "estado", origen: "PANTALLA", quien: "user1", despues: { estado: "HECHO", hechoAMano: true }, deshechoEn: null, creadoEn });
const tarjeta = (numero, titulo, historial, extra = {}) => ({ id: `t${numero}`, numero, titulo, repo: "aizencrm", estado: "HECHO", borradoEn: null, resultado: null, historial, ...extra });
const hechaPorElCoordinador = (numero, titulo = `Tarea ${numero}`) => tarjeta(numero, titulo, [delCoordinador(hace(HORA))]);
/** Deja la negocio lista: número del dueño guardado y la primera vuelta ya hecha. */
const listo = () => {
  guardarNumero();
  estado.ajustes.set(BASE, "2026-10-25T00:00:00Z");
};

/* ------------------------------------------------------------------ el texto */

await prueba("texto de una tarjeta: emoji, T-código, título recortado y link a la tarjeta", () => {
  const texto = terminadas.textoDeTerminadas([{ id: "t123", numero: 123, titulo: "Avisarle al dueño cuando una tarea quedó terminada parte tres" }]);
  assert.equal(lineas(texto)[0], "✅ ¡Listo! Terminó la tarea T-123: Avisarle al dueño cuando una tarea… 🚀");
  assert.equal(lineas(texto)[1], "https://app.aizenbot.com/cliente/tablero-ia?tarjeta=t123");
});

await prueba("texto de varias tarjetas: cuenta, dos con código, 'y N más' y el link de hoy", () => {
  const tres = terminadas.textoDeTerminadas([
    { id: "t12", numero: 12, titulo: "Arreglar el menú" },
    { id: "t13", numero: 13, titulo: "Pantalla de alertas" },
    { id: "t14", numero: 14, titulo: "Otra" },
  ]);
  assert.equal(lineas(tres)[0], "✅ ¡Listo! Terminaron 3 tareas: T-12 Arreglar el menú, T-13 Pantalla de alertas y 1 más 🚀");
  assert.equal(lineas(tres)[1], "https://app.aizenbot.com/cliente/tablero-ia?vista=hoy");
  const dos = terminadas.textoDeTerminadas([
    { id: "t12", numero: 12, titulo: "Arreglar el menú" },
    { id: "t13", numero: 13, titulo: "Pantalla de alertas" },
  ]);
  assert.equal(lineas(dos)[0], "✅ ¡Listo! Terminaron 2 tareas: T-12 Arreglar el menú y T-13 Pantalla de alertas 🚀");
});

/* ------------------------------------------------------------------ quién la puso en HECHO */

await prueba("solo cuenta el HECHO del Coordinador: subida, ya-hecha y cierre de madre", () => {
  const es = (t, c) => terminadas.esTerminadaDelCoordinador(t, c, DIA);
  assert.equal(es(hechaPorElCoordinador(1), hechaPorElCoordinador(1).historial), true, "subida del trabajador");
  const madre = tarjeta(2, "Madre", [], { resultado: { partida: { hijas: ["a", "b"], causa: "grande", cuando: "x" } } });
  const cierre = { accion: "estado", origen: "PANTALLA", quien: "user1", despues: { estado: "HECHO", nota: "terminada: sus 2 partes están hechas" }, deshechoEn: null, creadoEn: hace(HORA) };
  assert.equal(es(madre, [cierre]), true, "cierre automático de una madre partida");
  assert.equal(es(tarjeta(3, "A mano", []), [aMano(hace(HORA))]), false, "hecho a mano");
  assert.equal(es(tarjeta(4, "Sin repo", [], { repo: null }), [delCoordinador(hace(HORA))]), false, "sin repo");
  assert.equal(es(tarjeta(5, "Vieja", []), [delCoordinador(hace(25 * HORA))]), false, "de más de 24 horas");
  assert.equal(es(tarjeta(6, "Borrada", [], { borradoEn: hace(HORA) }), [delCoordinador(hace(HORA))]), false, "borrada");
  assert.equal(es(tarjeta(7, "En curso", [], { estado: "EN_CURSO" }), [delCoordinador(hace(HORA))]), false, "no está en HECHO");
  assert.equal(es(tarjeta(8, "Deshecha", []), [delCoordinador(hace(HORA), { deshechoEn: hace(HORA / 2) })]), false, "deshecha");
  assert.equal(es(tarjeta(9, "Sin partida", []), [{ ...cierre }]), false, "la nota de madre sin partida no vale");
  assert.equal(es(tarjeta(10, "Primero coordinador, luego a mano", []), [delCoordinador(hace(3 * HORA)), aMano(hace(HORA))]), false, "manda el último paso a HECHO");
});

/* ------------------------------------------------------------------ la revisión */

await prueba("manda un solo mensaje por la línea Admin al número del dueño, deja la fila ENVIADO y la alerta BAJA", async () => {
  listo();
  estado.tarjetas = [hechaPorElCoordinador(12, "Arreglar el menú")];
  const r = await terminadas.revisarAvisosDeTerminadas(DIA);
  assert.equal(r.enviados, 1);
  assert.equal(estado.enviados.length, 1);
  assert.equal(estado.enviados[0].instanceName, "admin-inst");
  assert.equal(estado.enviados[0].phoneNumber, "573001112233");
  assert.match(estado.enviados[0].text, /^✅ ¡Listo! Terminó la tarea T-12: Arreglar el menú 🚀/);
  assert.equal(estado.filas.length, 1);
  assert.equal(estado.filas[0].motivo, "terminada");
  assert.equal(estado.filas[0].estado, "ENVIADO");
  assert.ok(estado.filas[0].enviadoEn);
  assert.equal(estado.alertas.length, 1);
  assert.equal(estado.alertas[0].prioridad, "BAJA");
  assert.equal(estado.alertas[0].clave, "terminada:t12");
});

await prueba("varias a la vez salen juntas en UN mensaje", async () => {
  listo();
  estado.tarjetas = [hechaPorElCoordinador(12, "Arreglar el menú"), hechaPorElCoordinador(13, "Pantalla de alertas"), hechaPorElCoordinador(14, "Otra")];
  await terminadas.revisarAvisosDeTerminadas(DIA);
  assert.equal(estado.enviados.length, 1);
  assert.match(estado.enviados[0].text, /Terminaron 3 tareas/);
  assert.deepEqual(estado.filas.map((f) => f.estado), ["ENVIADO", "ENVIADO", "ENVIADO"]);
  assert.equal(estado.alertas.length, 3);
});

await prueba("no cuenta el hecho a mano, ni sin repo, ni de más de 24 horas (no manda nada)", async () => {
  listo();
  estado.tarjetas = [
    tarjeta(3, "A mano", [aMano(hace(HORA))]),
    tarjeta(4, "Sin repo", [delCoordinador(hace(HORA))], { repo: null }),
    tarjeta(5, "Vieja", [delCoordinador(hace(25 * HORA))]),
  ];
  const r = await terminadas.revisarAvisosDeTerminadas(DIA);
  assert.equal(r.enviados, 0);
  assert.equal(estado.enviados.length, 0);
  assert.equal(estado.filas.length, 0);
});

await prueba("un solo aviso por tarjeta: la segunda vuelta no repite y una nueva sale sola", async () => {
  listo();
  estado.tarjetas = [hechaPorElCoordinador(12)];
  await terminadas.revisarAvisosDeTerminadas(DIA);
  await terminadas.revisarAvisosDeTerminadas(new Date(DIA.getTime() + 60_000));
  assert.equal(estado.enviados.length, 1, "no se repite");
  estado.tarjetas.push(hechaPorElCoordinador(13));
  await terminadas.revisarAvisosDeTerminadas(new Date(DIA.getTime() + 120_000));
  assert.equal(estado.enviados.length, 2);
  assert.match(estado.enviados[1].text, /Terminó la tarea T-13/);
  assert.equal(estado.filas.length, 2);
});

await prueba("de noche no sale nada; a las 7 a. m. sale lo que quedó pendiente", async () => {
  listo();
  estado.tarjetas = [tarjeta(12, "Hecha de noche", [delCoordinador(hace(HORA, NOCHE))])];
  assert.equal((await terminadas.revisarAvisosDeTerminadas(NOCHE)).enviados, 0);
  assert.equal(estado.enviados.length, 0);
  assert.equal(estado.filas.length, 0);
  const SIETE = new Date("2026-10-27T12:00:00Z");
  assert.equal((await terminadas.revisarAvisosDeTerminadas(SIETE)).enviados, 1);
  assert.match(estado.enviados[0].text, /T-12/);
});

await prueba("con el interruptor general apagado no sale", async () => {
  listo();
  estado.ajustes.set("tablero:avisos-dueno:activo:ws1", "false");
  estado.tarjetas = [hechaPorElCoordinador(12)];
  assert.equal((await terminadas.revisarAvisosDeTerminadas(DIA)).enviados, 0);
  assert.equal(estado.enviados.length, 0);
  assert.equal(estado.filas.length, 0);
});

await prueba("con el interruptor propio apagado no sale; sin ajuste empieza prendido", async () => {
  listo();
  assert.equal(await terminadas.terminadasPrendidas("ws1"), true);
  estado.ajustes.set("tablero:avisos-dueno:terminadas:ws1", "false");
  assert.equal(await terminadas.terminadasPrendidas("ws1"), false);
  estado.tarjetas = [hechaPorElCoordinador(12)];
  assert.equal((await terminadas.revisarAvisosDeTerminadas(DIA)).enviados, 0);
  assert.equal(estado.enviados.length, 0);
  assert.equal(estado.filas.length, 0);
});

await prueba("la primera vuelta marca YA_VISTO lo que ya estaba HECHO, sin mandar, y deja la bandera", async () => {
  guardarNumero();
  estado.tarjetas = [hechaPorElCoordinador(1), hechaPorElCoordinador(2), tarjeta(3, "Sin repo", [], { repo: null })];
  const r = await terminadas.revisarAvisosDeTerminadas(DIA);
  assert.equal(r.enviados, 0);
  assert.equal(estado.enviados.length, 0);
  assert.deepEqual(estado.filas.map((f) => [f.tarjetaId, f.motivo, f.estado]), [["t1", "terminada", "YA_VISTO"], ["t2", "terminada", "YA_VISTO"]]);
  assert.ok(estado.ajustes.has(BASE));
  // Lo viejo no sale después, y lo nuevo sí.
  estado.tarjetas.push(hechaPorElCoordinador(4));
  await terminadas.revisarAvisosDeTerminadas(new Date(DIA.getTime() + 60_000));
  assert.equal(estado.enviados.length, 1);
  assert.match(estado.enviados[0].text, /T-4/);
});

await prueba("3 fallos dejan el aviso FALLIDO y no vuelve a intentar", async () => {
  listo();
  estado.fallaElEnvio = true;
  estado.tarjetas = [hechaPorElCoordinador(12)];
  for (let i = 1; i <= 3; i += 1) {
    assert.equal((await terminadas.revisarAvisosDeTerminadas(new Date(DIA.getTime() + i * 60_000))).enviados, 0);
    assert.equal(estado.filas[0].intentos, i);
    assert.equal(estado.filas[0].estado, i < 3 ? "PENDIENTE" : "FALLIDO");
  }
  assert.match(estado.filas[0].detalle, /no salió/);
  estado.fallaElEnvio = false;
  await terminadas.revisarAvisosDeTerminadas(new Date(DIA.getTime() + 5 * 60_000));
  assert.equal(estado.enviados.length, 0, "FALLIDO no vuelve a salir");
  assert.equal(estado.alertas.length, 1, "reintentar no duplica la alerta");
});

await prueba("sin número del dueño no sale y suma un intento", async () => {
  estado.ajustes.set(BASE, "2026-10-25T00:00:00Z");
  estado.tarjetas = [hechaPorElCoordinador(12)];
  assert.equal((await terminadas.revisarAvisosDeTerminadas(DIA)).enviados, 0);
  assert.equal(estado.filas[0].estado, "PENDIENTE");
  assert.equal(estado.filas[0].intentos, 1);
});

console.log(`\n${pruebas} pruebas de avisos de terminadas: todo bien`);
