// Pruebas del aviso "terminada" al dueño (avisos-de-terminadas.ts) con un prisma, una línea de WhatsApp y un tablero
// FALSOS. Comprueba el texto de una y de varias tarjetas, que solo cuenta el HECHO del Coordinador (no a mano, no sin
// repo, no de más de 24 horas), un solo aviso por tarjeta, el silencio de la noche, los dos interruptores, que la
// primera vuelta marca YA_VISTO sin mandar, la campanita con prioridad BAJA y que 3 fallos dejan el aviso FALLIDO.
// No necesita base ni red.
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
    historial: [],
    avisos: [],
    alertas: [],
    enviados: [],
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

const falso = {
  appSetting: {
    findUnique: async ({ where }) => (estado.ajustes.has(where.key) ? { value: estado.ajustes.get(where.key) } : null),
    upsert: async ({ where, create, update }) => {
      estado.ajustes.set(where.key, estado.ajustes.has(where.key) ? update.value : create.value);
    },
    deleteMany: async ({ where }) => {
      estado.ajustes.delete(where.key);
    },
  },
  whatsAppChannel: {
    findMany: async ({ where }) => estado.lineas.filter((l) => l.workspaceId === where.workspaceId),
    findFirst: async ({ where }) => estado.lineas.find((l) => coincideLinea(l, where)) ?? null,
  },
  workspaceMember: { findMany: async () => estado.miembros },
  tarjetaTablero: {
    findMany: async ({ where }) =>
      estado.tarjetas
        .filter(
          (t) =>
            t.estado === where.estado &&
            t.borradoEn === null &&
            (!where.repo || t.repo !== null) &&
            (!where.actualizadoEn || t.actualizadoEn.getTime() >= where.actualizadoEn.gte.getTime()),
        )
        .map((t) => ({ id: t.id, numero: t.numero, titulo: t.titulo, repo: t.repo, estado: t.estado })),
  },
  historialTarjeta: {
    findMany: async ({ where }) => estado.historial.filter((h) => where.tarjetaId.in.includes(h.tarjetaId) && h.accion === where.accion),
  },
  avisoTarjetaEquipo: {
    findMany: async ({ where }) => estado.avisos.filter((a) => a.workspaceId === where.workspaceId && a.motivo === where.motivo && where.tarjetaId.in.includes(a.tarjetaId)).map((a) => ({ ...a })),
    create: async ({ data }) => {
      if (estado.avisos.some((a) => a.tarjetaId === data.tarjetaId && a.motivo === data.motivo)) throw Object.assign(new Error("único"), { code: "P2002" });
      const fila = { id: `av${estado.avisos.length + 1}`, intentos: 0, ...data };
      estado.avisos.push(fila);
      return { id: fila.id };
    },
    createMany: async ({ data }) => {
      for (const d of data) {
        if (!estado.avisos.some((a) => a.tarjetaId === d.tarjetaId && a.motivo === d.motivo)) estado.avisos.push({ id: `av${estado.avisos.length + 1}`, intentos: 0, ...d });
      }
    },
    updateMany: async ({ where, data }) => {
      const fila = estado.avisos.find((a) => a.id === where.id && (where.estado === undefined || a.estado === where.estado) && (where.intentos === undefined || a.intentos === where.intentos));
      if (fila) Object.assign(fila, data);
      return { count: fila ? 1 : 0 };
    },
  },
  alertaInterna: {
    findFirst: async ({ where }) => estado.alertas.find((a) => a.workspaceId === where.workspaceId && a.clave === where.clave && ["NUEVA", "VISTA"].includes(a.estado)) ?? null,
    create: async ({ data }) => {
      const fila = { id: `al${estado.alertas.length + 1}`, estado: "NUEVA", veces: 1, ...data };
      estado.alertas.push(fila);
      return { id: fila.id };
    },
    update: async () => ({}),
    updateMany: async () => ({ count: 0 }),
  },
  tableroInteligente: { findMany: async () => [{ workspaceId: "ws1" }] },
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
const DIA = new Date("2026-10-30T15:00:00Z");
const NOCHE = new Date("2026-10-31T04:00:00Z");
const HORA = 3_600_000;
const hace = (ms, desde = DIA) => new Date(desde.getTime() - ms);
const guardarNumero = () => estado.ajustes.set("tablero:avisos-dueno:telefono:ws1", "573001112233");
const BASE = "tablero:avisos-dueno:terminadas-base:ws1";
const YA_HAY_BASE = () => estado.ajustes.set(BASE, "2026-10-29T00:00:00Z");

/** Una tarjeta HECHO con su fila de historial. `origen` TRABAJADOR = la puso el Coordinador. */
let siguiente = 0;
function hecha({ numero, titulo = "Mejorar la pantalla de chats", repo = "aizencrm", origen = "TRABAJADOR", antes = HORA, borradoEn = null } = {}) {
  siguiente += 1;
  const id = `t${siguiente}`;
  estado.tarjetas.push({ id, numero: numero ?? 100 + siguiente, titulo, repo, estado: "HECHO", borradoEn, actualizadoEn: hace(antes) });
  estado.historial.push({ tarjetaId: id, origen, accion: "estado", despues: { estado: "HECHO" }, creadoEn: hace(antes), deshechoEn: null });
  return id;
}
const cambio = (origen, despues, antes = HORA) => ({ origen, accion: "estado", despues, creadoEn: hace(antes), deshechoEn: null });

/* ------------------------------------------------------------------ el texto */

await prueba("texto de una tarjeta: emoji, T-código, título recortado y el link a la tarjeta", async () => {
  const texto = terminadas.textoDeTerminadas([{ numero: 123, titulo: "Avisarle al dueño cuando una tarea quedó terminada: parte 3 de 4" }], "https://x/tarjeta");
  assert.equal(texto, "✅ ¡Listo! Terminó la tarea T-123: Avisarle al dueño cuando una tarea… 🚀\nhttps://x/tarjeta");
});

await prueba("texto de varias tarjetas: cuántas, dos nombradas, 'y N más' y el link de hoy", async () => {
  const lista = [
    { numero: 12, titulo: "Arreglar el botón" },
    { numero: 13, titulo: "Pantalla de alertas" },
    { numero: 14, titulo: "Reporte semanal" },
  ];
  assert.equal(terminadas.textoDeTerminadas(lista, "https://x/hoy"), "✅ ¡Listo! Terminaron 3 tareas: T-12 Arreglar el botón, T-13 Pantalla de alertas y 1 más 🚀\nhttps://x/hoy");
  assert.equal(terminadas.textoDeTerminadas(lista.slice(0, 2), "https://x/hoy"), "✅ ¡Listo! Terminaron 2 tareas: T-12 Arreglar el botón y T-13 Pantalla de alertas 🚀\nhttps://x/hoy");
});

/* ------------------------------------------------------------------ cuál cuenta */

await prueba("solo cuenta el HECHO del Coordinador: no a mano, no sin repo, no de más de 24 horas", async () => {
  const ok = { repo: "aizencrm", estado: "HECHO" };
  assert.equal(terminadas.esTerminadaDelCoordinador(ok, [cambio("TRABAJADOR", { estado: "HECHO" })], DIA), true, "el Coordinador");
  assert.equal(terminadas.esTerminadaDelCoordinador(ok, [cambio("PANTALLA", { estado: "HECHO" })], DIA), false, "a mano en la pantalla");
  assert.equal(terminadas.esTerminadaDelCoordinador(ok, [cambio("MCP", { estado: "HECHO" })], DIA), false, "a mano por el MCP");
  assert.equal(terminadas.esTerminadaDelCoordinador({ repo: null, estado: "HECHO" }, [cambio("TRABAJADOR", { estado: "HECHO" })], DIA), false, "sin repo");
  assert.equal(terminadas.esTerminadaDelCoordinador(ok, [cambio("TRABAJADOR", { estado: "HECHO" }, 25 * HORA)], DIA), false, "de más de 24 horas");
  assert.equal(terminadas.esTerminadaDelCoordinador({ repo: "aizencrm", estado: "POR_REVISAR" }, [cambio("TRABAJADOR", { estado: "HECHO" })], DIA), false, "ya no está en HECHO");
  assert.equal(terminadas.esTerminadaDelCoordinador(ok, [cambio("TRABAJADOR", { estado: "SUBIENDO" })], DIA), false, "nunca llegó a HECHO por el historial");
  // La última vez que quedó en HECHO fue a mano (el Coordinador la había puesto antes): no cuenta.
  assert.equal(terminadas.esTerminadaDelCoordinador(ok, [cambio("TRABAJADOR", { estado: "HECHO" }, 3 * HORA), cambio("PANTALLA", { estado: "HECHO" }, HORA)], DIA), false, "último HECHO a mano");
});

await prueba("al revisar, solo se avisa la del Coordinador (las demás quedan sin aviso)", async () => {
  guardarNumero();
  YA_HAY_BASE();
  hecha({ numero: 1, origen: "PANTALLA" });
  hecha({ numero: 2, repo: null });
  hecha({ numero: 3, antes: 30 * HORA });
  hecha({ numero: 4, borradoEn: new Date() });
  const buena = hecha({ numero: 5, titulo: "Avisos de terminadas" });
  const r = await terminadas.revisarAvisosDeTerminadas(DIA);
  assert.equal(r.enviados, 1);
  assert.equal(estado.enviados.length, 1);
  assert.match(estado.enviados[0].text, /Terminó la tarea T-5: Avisos de terminadas/);
  assert.match(estado.enviados[0].text, new RegExp(`tarjeta=${buena}$`));
  assert.equal(estado.avisos.length, 1);
});

/* ------------------------------------------------------------------ el envío */

await prueba("sale solo por la línea Admin y solo al número del dueño; queda en la campanita con prioridad BAJA", async () => {
  guardarNumero();
  YA_HAY_BASE();
  hecha({ numero: 7 });
  await terminadas.revisarAvisosDeTerminadas(DIA);
  assert.equal(estado.enviados.length, 1);
  assert.equal(estado.enviados[0].instanceName, "admin-inst");
  assert.equal(estado.enviados[0].phoneNumber, "573001112233");
  assert.equal(estado.alertas.length, 1);
  assert.equal(estado.alertas[0].prioridad, "BAJA");
  assert.equal(estado.alertas[0].origen, "Coordinador");
  assert.equal(estado.avisos[0].estado, "ENVIADO");
  assert.equal(estado.avisos[0].motivo, "terminada");
});

await prueba("varias pendientes de la vuelta salen juntas en UN mensaje con el link de hoy", async () => {
  guardarNumero();
  YA_HAY_BASE();
  hecha({ numero: 12, titulo: "Arreglar el botón" });
  hecha({ numero: 13, titulo: "Pantalla de alertas" });
  hecha({ numero: 14, titulo: "Reporte semanal" });
  await terminadas.revisarAvisosDeTerminadas(DIA);
  assert.equal(estado.enviados.length, 1);
  assert.match(estado.enviados[0].text, /Terminaron 3 tareas: T-12 Arreglar el botón, T-13 Pantalla de alertas y 1 más/);
  assert.match(estado.enviados[0].text, /vista=hoy$/);
  assert.equal(estado.alertas.length, 1);
});

await prueba("un solo aviso por tarjeta: la segunda vuelta no repite", async () => {
  guardarNumero();
  YA_HAY_BASE();
  hecha({ numero: 9 });
  await terminadas.revisarAvisosDeTerminadas(DIA);
  await terminadas.revisarAvisosDeTerminadas(new Date(DIA.getTime() + 60_000));
  assert.equal(estado.enviados.length, 1);
  assert.equal(estado.avisos.length, 1);
  assert.equal(estado.alertas.length, 1);
});

/* ------------------------------------------------------------------ silencio e interruptores */

await prueba("de noche (9 p. m. a 7 a. m.) no sale ni se anota; a las 7 a. m. sale", async () => {
  guardarNumero();
  YA_HAY_BASE();
  hecha({ numero: 10, antes: HORA });
  // Misma tarjeta vista de noche: ahora = 11 p. m., el HECHO fue una hora antes de las 10 a. m. del día anterior (dentro de 24 h).
  await terminadas.revisarAvisosDeTerminadas(NOCHE);
  assert.equal(estado.enviados.length, 0);
  assert.equal(estado.avisos.length, 0, "no anota nada: queda para la vuelta de las 7 a. m.");
  const lasSiete = new Date("2026-10-30T12:00:00Z");
  await terminadas.revisarAvisosDeTerminadas(lasSiete);
  assert.equal(estado.enviados.length, 1);
});

await prueba("con el interruptor general de los avisos al dueño apagado no sale", async () => {
  guardarNumero();
  YA_HAY_BASE();
  estado.ajustes.set("tablero:avisos-dueno:activo:ws1", "false");
  hecha({ numero: 11 });
  await terminadas.revisarAvisosDeTerminadas(DIA);
  assert.equal(estado.enviados.length, 0);
  assert.equal(estado.avisos.length, 0);
});

await prueba("con el interruptor propio apagado no sale; empieza prendido", async () => {
  guardarNumero();
  YA_HAY_BASE();
  assert.equal(await terminadas.terminadasPrendido("ws1"), true, "empieza prendido");
  estado.ajustes.set("tablero:avisos-dueno:terminadas:ws1", "false");
  hecha({ numero: 11 });
  await terminadas.revisarAvisosDeTerminadas(DIA);
  assert.equal(estado.enviados.length, 0);
  assert.equal(estado.avisos.length, 0);
  assert.equal(estado.ajustes.has(BASE), false, "al apagar se borra la bandera: al prender de nuevo no sale una ola");
});

/* ------------------------------------------------------------------ primera vez y fallos */

await prueba("la primera vuelta anota YA_VISTO lo que ya estaba HECHO y no manda nada", async () => {
  guardarNumero();
  const a = hecha({ numero: 20 });
  const b = hecha({ numero: 21, origen: "PANTALLA" });
  await terminadas.revisarAvisosDeTerminadas(DIA);
  assert.equal(estado.enviados.length, 0);
  assert.deepEqual(estado.avisos.map((x) => [x.tarjetaId, x.estado, x.motivo]).sort(), [[a, "YA_VISTO", "terminada"], [b, "YA_VISTO", "terminada"]].sort());
  assert.ok(estado.ajustes.has(BASE), "deja la bandera");
  // La vuelta siguiente no manda lo viejo, pero sí lo que termine después.
  hecha({ numero: 22 });
  await terminadas.revisarAvisosDeTerminadas(new Date(DIA.getTime() + 60_000));
  assert.equal(estado.enviados.length, 1);
  assert.match(estado.enviados[0].text, /T-22/);
});

await prueba("sin número del dueño no sale: suma intentos y después del 3.º queda FALLIDO", async () => {
  YA_HAY_BASE();
  hecha({ numero: 30 });
  for (let i = 0; i < 3; i += 1) await terminadas.revisarAvisosDeTerminadas(new Date(DIA.getTime() + i * 60_000));
  assert.equal(estado.enviados.length, 0);
  assert.equal(estado.avisos[0].estado, "FALLIDO");
  assert.equal(estado.avisos[0].intentos, 3);
  await terminadas.revisarAvisosDeTerminadas(new Date(DIA.getTime() + 5 * 60_000));
  assert.equal(estado.avisos[0].estado, "FALLIDO", "no se reintenta más");
  assert.equal(estado.enviados.length, 0);
});

await prueba("si la línea Admin falla: PENDIENTE hasta el 3.º intento y luego FALLIDO", async () => {
  guardarNumero();
  YA_HAY_BASE();
  estado.fallaElEnvio = true;
  hecha({ numero: 31 });
  await terminadas.revisarAvisosDeTerminadas(DIA);
  assert.equal(estado.avisos[0].estado, "PENDIENTE");
  assert.equal(estado.avisos[0].intentos, 1);
  await terminadas.revisarAvisosDeTerminadas(new Date(DIA.getTime() + 60_000));
  assert.equal(estado.avisos[0].estado, "PENDIENTE");
  await terminadas.revisarAvisosDeTerminadas(new Date(DIA.getTime() + 120_000));
  assert.equal(estado.avisos[0].estado, "FALLIDO");
  assert.equal(estado.avisos[0].intentos, 3);
  assert.equal(estado.alertas.length, 1, "al quedar FALLIDO igual queda en la campanita");
  // Y si la línea vuelve, ya no se reenvía.
  estado.fallaElEnvio = false;
  await terminadas.revisarAvisosDeTerminadas(new Date(DIA.getTime() + 180_000));
  assert.equal(estado.enviados.length, 0);
});

console.log(`\n${pruebas} pruebas OK`);
