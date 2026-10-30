// Pruebas del aviso "terminó la tarea" al dueño (avisos-de-terminadas.ts) con un prisma y una línea de WhatsApp FALSOS.
// Comprueba el texto de una y de varias tarjetas, que solo cuenta el HECHO del Coordinador (no a mano, no sin repo, no de
// más de 24 horas), un solo aviso por tarjeta, que de noche no sale, los dos interruptores, que la primera vuelta anota
// YA_VISTO sin mandar y que 3 fallos dejan el aviso FALLIDO. No necesita base ni red.
// Correr: npm run test:tablero-avisos-de-terminadas
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

/* ------------------------------------------------------------------ falsos */

const LINEA_ADMIN = "cmt06kiob00lw2hk2mgllstsb";
const estado = {};
const reiniciar = () => {
  Object.assign(estado, {
    ajustes: new Map(),
    lineas: [{ id: LINEA_ADMIN, workspaceId: "ws1", name: "Admin", purpose: "ADMIN", phoneNumber: "573009990000", isActive: true, evolutionInstanceName: "admin-inst" }],
    // Tarjetas: { id, numero, titulo, repo, estado }
    tarjetas: [],
    // Historial: { tarjetaId, origen, accion, antes, despues, creadoEn }
    historial: [],
    avisos: [],
    alertas: [],
    enviados: [],
    fallaElEnvio: false,
  });
};
reiniciar();

const coincideLinea = (l, where) =>
  l.workspaceId === where.workspaceId && (where.id === undefined || l.id === where.id) && (where.isActive === undefined || l.isActive === where.isActive);

const choque = () => Object.assign(new Error("único"), { code: "P2002" });
const enMotivo = (fila, motivo) => !motivo || (typeof motivo === "string" ? fila.motivo === motivo : fila.motivo !== motivo.not);

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
  workspaceMember: { findMany: async () => [] },
  tarjetaTablero: {
    // Las HECHO con repo del negocio.
    findMany: async () => estado.tarjetas.filter((t) => t.repo && t.estado === "HECHO").map((t) => ({ id: t.id })),
  },
  historialTarjeta: {
    findMany: async ({ where }) =>
      estado.historial
        .filter((h) => h.accion === where.accion && h.creadoEn >= where.creadoEn.gte)
        .filter((h) => {
          const t = estado.tarjetas.find((x) => x.id === h.tarjetaId);
          return t && t.repo && t.estado === "HECHO";
        })
        .sort((a, b) => a.creadoEn - b.creadoEn)
        .map((h) => ({ ...h, deshechoEn: null, tarjeta: estado.tarjetas.find((x) => x.id === h.tarjetaId) })),
  },
  avisoTarjetaEquipo: {
    findMany: async ({ where }) => estado.avisos.filter((a) => enMotivo(a, where.motivo) && (!where.tarjetaId || where.tarjetaId.in.includes(a.tarjetaId))).map((a) => ({ ...a })),
    create: async ({ data }) => {
      if (estado.avisos.some((a) => a.tarjetaId === data.tarjetaId && a.motivo === data.motivo)) throw choque();
      const fila = { id: `av${estado.avisos.length + 1}`, intentos: 0, detalle: null, ...data };
      estado.avisos.push(fila);
      return { id: fila.id };
    },
    createMany: async ({ data }) => {
      for (const d of data) if (!estado.avisos.some((a) => a.tarjetaId === d.tarjetaId && a.motivo === d.motivo)) estado.avisos.push({ id: `av${estado.avisos.length + 1}`, intentos: 0, ...d });
    },
    updateMany: async ({ where, data }) => {
      const filas = estado.avisos.filter((a) => a.id === where.id && (!where.estado || a.estado === where.estado) && (where.intentos === undefined || a.intentos === where.intentos));
      for (const f of filas) Object.assign(f, data);
      return { count: filas.length };
    },
  },
  alertaInterna: {
    findFirst: async ({ where }) => estado.alertas.find((a) => a.clave === where.clave && ["NUEVA", "VISTA"].includes(a.estado)) ?? null,
    create: async ({ data }) => {
      const fila = { id: `al${estado.alertas.length + 1}`, estado: "NUEVA", salioPorWhatsApp: false, ...data };
      estado.alertas.push(fila);
      return { id: fila.id };
    },
    update: async () => ({}),
    updateMany: async ({ where, data }) => {
      for (const a of estado.alertas.filter((x) => x.clave === where.clave)) Object.assign(a, data);
    },
  },
  tableroInteligente: { findMany: async () => [{ workspaceId: "ws1" }] },
  $queryRawUnsafe: async () => [],
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
const prender = () => estado.ajustes.set("tablero:avisos-dueno:telefono:ws1", "573001112233");
const base = () => estado.ajustes.set("tablero:avisos-dueno:terminadas-base:ws1", "2026-10-29T00:00:00Z");

let contador = 0;
/** Una tarjeta HECHO; `como` = quién la dejó en HECHO. */
function hecha({ id = `t${++contador}`, numero = 100 + contador, titulo = "Mejorar la pantalla de chats", repo = "aizencrm", como = "subida", cuando = hace(HORA) } = {}) {
  estado.tarjetas.push({ id, numero, titulo, repo, estado: "HECHO" });
  const cambio = {
    subida: { origen: "TRABAJADOR", antes: { estado: "SUBIENDO" } },
    "ya-hecha": { origen: "TRABAJADOR", antes: { estado: "EN_CURSO" } },
    madre: { origen: "TRABAJADOR", antes: { estado: "PLANEANDO" } },
    mano: { origen: "PANTALLA", antes: { estado: "POR_REVISAR" } },
    mcp: { origen: "MCP", antes: { estado: "EN_CURSO" } },
  }[como];
  estado.historial.push({ tarjetaId: id, accion: "estado", despues: { estado: "HECHO" }, creadoEn: cuando, ...cambio });
  return id;
}

/* ------------------------------------------------------------------ el texto */

await prueba("el texto de una tarjeta: emoji, T-código, título recortado y el link de la tarjeta", async () => {
  const texto = terminadas.textoDeTerminadas([{ id: "t1", numero: 123, titulo: "Mejorar la pantalla de chats para que se vea mucho mejor en el celular" }], "https://x/tarjeta");
  assert.equal(texto, "✅ ¡Listo! Terminó la tarea T-123: Mejorar la pantalla de chats para… 🚀\nhttps://x/tarjeta");
});

await prueba("el texto de varias: cuántas, las dos primeras con su código, 'y N más' y el link de hoy", async () => {
  const tarjetas = [
    { id: "a", numero: 12, titulo: "Primera tarea" },
    { id: "b", numero: 13, titulo: "Segunda tarea" },
    { id: "c", numero: 14, titulo: "Tercera tarea" },
  ];
  assert.equal(terminadas.textoDeTerminadas(tarjetas, "https://x/hoy"), "✅ ¡Listo! Terminaron 3 tareas: T-12 Primera tarea, T-13 Segunda tarea y 1 más 🚀\nhttps://x/hoy");
  assert.equal(terminadas.textoDeTerminadas(tarjetas.slice(0, 2), "https://x/hoy"), "✅ ¡Listo! Terminaron 2 tareas: T-12 Primera tarea y T-13 Segunda tarea 🚀\nhttps://x/hoy");
});

/* ------------------------------------------------------------------ cuáles cuentan */

await prueba("solo cuenta el HECHO del Coordinador: subida, ya-hecha y madre sí; a mano, MCP, sin repo y viejo no", async () => {
  const tarjeta = { repo: "aizencrm", estado: "HECHO" };
  const cambio = (origen, antes, edad = HORA) => [{ origen, accion: "estado", antes: { estado: antes }, despues: { estado: "HECHO" }, creadoEn: hace(edad) }];
  assert.equal(terminadas.esTerminadaDelCoordinador(tarjeta, cambio("TRABAJADOR", "SUBIENDO"), DIA), true, "subida");
  assert.equal(terminadas.esTerminadaDelCoordinador(tarjeta, cambio("TRABAJADOR", "EN_CURSO"), DIA), true, "ya hecha / madre");
  assert.equal(terminadas.esTerminadaDelCoordinador(tarjeta, cambio("PANTALLA", "POR_REVISAR"), DIA), false, "a mano en pantalla");
  assert.equal(terminadas.esTerminadaDelCoordinador(tarjeta, cambio("MCP", "SUBIENDO"), DIA), false, "a mano por el MCP");
  assert.equal(terminadas.esTerminadaDelCoordinador({ repo: null, estado: "HECHO" }, cambio("TRABAJADOR", "SUBIENDO"), DIA), false, "sin repositorio");
  assert.equal(terminadas.esTerminadaDelCoordinador({ repo: "aizencrm", estado: "ERROR" }, cambio("TRABAJADOR", "SUBIENDO"), DIA), false, "ya no está en HECHO");
  assert.equal(terminadas.esTerminadaDelCoordinador(tarjeta, cambio("TRABAJADOR", "SUBIENDO", 25 * HORA), DIA), false, "más de 24 horas");
  assert.equal(terminadas.esTerminadaDelCoordinador(tarjeta, cambio("TRABAJADOR", "SUBIENDO", 23 * HORA), DIA), true, "casi 24 horas");
  assert.equal(terminadas.esTerminadaDelCoordinador(tarjeta, [], DIA), false, "sin historial");
  // Si después la volvieron a dejar en HECHO a mano, manda el último.
  const luego = [...cambio("TRABAJADOR", "SUBIENDO", 3 * HORA), ...cambio("PANTALLA", "ERROR", HORA)];
  assert.equal(terminadas.esTerminadaDelCoordinador(tarjeta, luego, DIA), false, "el último HECHO fue a mano");
});

/* ------------------------------------------------------------------ la vuelta */

await prueba("manda UN mensaje con las pendientes, solo por la línea Admin, y anota ENVIADO", async () => {
  prender();
  base();
  hecha({ numero: 12, titulo: "Primera" });
  hecha({ numero: 13, titulo: "Segunda" });
  hecha({ numero: 14, titulo: "Tercera" });
  hecha({ como: "mano", numero: 15, titulo: "A mano" });
  hecha({ repo: null, numero: 16, titulo: "Sin repo" });
  hecha({ cuando: hace(30 * HORA), numero: 17, titulo: "Vieja" });
  const { enviados } = await terminadas.revisarAvisosDeTerminadas(DIA);
  assert.equal(enviados, 1);
  assert.equal(estado.enviados.length, 1);
  assert.equal(estado.enviados[0].instanceName, "admin-inst");
  assert.equal(estado.enviados[0].phoneNumber, "573001112233");
  assert.match(estado.enviados[0].text, /Terminaron 3 tareas: T-12 Primera, T-13 Segunda y 1 más 🚀/);
  assert.equal(estado.avisos.length, 3);
  assert.ok(estado.avisos.every((a) => a.motivo === "terminada" && a.estado === "ENVIADO"));
  assert.equal(estado.alertas.length, 3);
  assert.ok(estado.alertas.every((a) => a.prioridad === "BAJA" && a.salioPorWhatsApp === true));
});

await prueba("una sola tarjeta: texto con su código y el link de la tarjeta", async () => {
  prender();
  base();
  hecha({ id: "tz", numero: 123, titulo: "Avisar al dueño" });
  await terminadas.revisarAvisosDeTerminadas(DIA);
  assert.equal(estado.enviados[0].text, "✅ ¡Listo! Terminó la tarea T-123: Avisar al dueño 🚀\nhttps://app.aizenbot.com/cliente/tablero-ia?tarjeta=tz");
});

await prueba("un solo aviso por tarjeta: la siguiente vuelta no repite", async () => {
  prender();
  base();
  hecha();
  await terminadas.revisarAvisosDeTerminadas(DIA);
  await terminadas.revisarAvisosDeTerminadas(new Date(DIA.getTime() + 60_000));
  assert.equal(estado.enviados.length, 1);
  assert.equal(estado.avisos.length, 1);
  // Una nueva sí sale, sola.
  hecha();
  await terminadas.revisarAvisosDeTerminadas(new Date(DIA.getTime() + 120_000));
  assert.equal(estado.enviados.length, 2);
  assert.equal(estado.avisos.length, 2);
});

await prueba("de noche no sale ni anota; a las 7 a. m. sale lo que terminó de noche", async () => {
  prender();
  base();
  hecha({ cuando: hace(HORA, NOCHE) });
  assert.deepEqual(await terminadas.revisarAvisosDeTerminadas(NOCHE), { enviados: 0 });
  assert.equal(estado.enviados.length, 0);
  assert.equal(estado.avisos.length, 0);
  const SIETE = new Date("2026-10-31T12:00:00Z");
  hecha({ cuando: hace(HORA, SIETE) });
  assert.deepEqual(await terminadas.revisarAvisosDeTerminadas(SIETE), { enviados: 1 });
  assert.match(estado.enviados[0].text, /Terminaron 2 tareas/);
});

await prueba("con el interruptor general apagado no sale", async () => {
  prender();
  base();
  hecha();
  estado.ajustes.set("tablero:avisos-dueno:activo:ws1", "false");
  await terminadas.revisarAvisosDeTerminadas(DIA);
  assert.equal(estado.enviados.length, 0);
  assert.equal(estado.avisos.length, 0);
});

await prueba("con el interruptor propio apagado no sale; sin tocarlo, empieza prendido", async () => {
  prender();
  base();
  hecha();
  estado.ajustes.set("tablero:avisos-dueno:terminadas:ws1", "false");
  await terminadas.revisarAvisosDeTerminadas(DIA);
  assert.equal(estado.enviados.length, 0);
  assert.equal(estado.avisos.length, 0);
  estado.ajustes.delete("tablero:avisos-dueno:terminadas:ws1");
  await terminadas.revisarAvisosDeTerminadas(DIA);
  assert.equal(estado.enviados.length, 1);
});

await prueba("la primera vuelta marca YA_VISTO todo lo que ya estaba HECHO, sin mandar; lo nuevo sí sale", async () => {
  prender();
  hecha({ id: "vieja1" });
  hecha({ id: "vieja2", como: "mano" });
  assert.deepEqual(await terminadas.revisarAvisosDeTerminadas(DIA), { enviados: 0 });
  assert.equal(estado.enviados.length, 0);
  assert.equal(estado.avisos.length, 2);
  assert.ok(estado.avisos.every((a) => a.estado === "YA_VISTO" && a.motivo === "terminada"));
  assert.ok(estado.ajustes.has("tablero:avisos-dueno:terminadas-base:ws1"));
  // La segunda vuelta no repite lo viejo; una nueva sí sale.
  await terminadas.revisarAvisosDeTerminadas(DIA);
  assert.equal(estado.enviados.length, 0);
  hecha({ id: "nueva" });
  await terminadas.revisarAvisosDeTerminadas(DIA);
  assert.equal(estado.enviados.length, 1);
  assert.equal(estado.avisos.length, 3);
});

await prueba("sin el número del dueño no sale y queda anotado el motivo", async () => {
  base();
  hecha();
  await terminadas.revisarAvisosDeTerminadas(DIA);
  assert.equal(estado.enviados.length, 0);
  assert.equal(estado.avisos[0].estado, "PENDIENTE");
  assert.match(estado.avisos[0].detalle, /falta su número/);
});

await prueba("3 fallos dejan el aviso FALLIDO y ya no se intenta más", async () => {
  prender();
  base();
  hecha();
  estado.fallaElEnvio = true;
  for (let i = 1; i <= 3; i += 1) {
    await terminadas.revisarAvisosDeTerminadas(new Date(DIA.getTime() + i * 60_000));
    assert.equal(estado.avisos[0].intentos, i);
    assert.equal(estado.avisos[0].estado, i < 3 ? "PENDIENTE" : "FALLIDO", `intento ${i}`);
  }
  estado.fallaElEnvio = false;
  await terminadas.revisarAvisosDeTerminadas(new Date(DIA.getTime() + 4 * 60_000));
  assert.equal(estado.enviados.length, 0);
  assert.equal(estado.avisos[0].estado, "FALLIDO");
  assert.equal(estado.avisos[0].intentos, 3);
});

await prueba("un fallo y luego un éxito: queda ENVIADO", async () => {
  prender();
  base();
  hecha();
  estado.fallaElEnvio = true;
  await terminadas.revisarAvisosDeTerminadas(DIA);
  estado.fallaElEnvio = false;
  await terminadas.revisarAvisosDeTerminadas(new Date(DIA.getTime() + 60_000));
  assert.equal(estado.enviados.length, 1);
  assert.equal(estado.avisos[0].estado, "ENVIADO");
  assert.equal(estado.avisos[0].intentos, 2);
});

console.log(`\n${pruebas} pruebas de avisos de terminadas: todas bien.`);
