// Pruebas de los avisos de WhatsApp al EQUIPO del Tablero IA (avisos-al-equipo.ts) con un prisma y una línea de
// WhatsApp FALSOS, igual que la prueba de los avisos al dueño. Comprueba: tarea asignada (nombre, título y link), que
// la segunda pasada no repite, el cambio de responsable, urgente (marca y título; también de noche), el silencio de
// 9 p. m. a 7 a. m., ERROR al responsable o al dueño, el recordatorio de 24 horas, que no avisa a quien está inactivo,
// sin número o con los avisos apagados, que al prender el interruptor no sale una ola, y que nunca sale por una línea
// de ventas. No necesita base ni red.
// Correr: npm run test:tablero-avisos-al-equipo
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

/* ------------------------------------------------------------------ falsos */

const LINEA_ADMIN = "cmt06kiob00lw2hk2mgllstsb";
const estado = {};
const reiniciar = () => {
  Object.assign(estado, {
    ajustes: new Map(),
    lineas: [
      { id: LINEA_ADMIN, workspaceId: "ws1", name: "Admin", phoneNumber: "573009990000", isActive: true, evolutionInstanceName: "admin-inst" },
      { id: "ventas1", workspaceId: "ws1", name: "Ventas", phoneNumber: "573008880000", isActive: true, evolutionInstanceName: "ventas-inst" },
    ],
    miembros: [
      { userId: "u_em", user: { name: "Emanuel Pérez" } },
      { userId: "u_ana", user: { name: "Ana Gómez" } },
      { userId: "u_sin", user: { name: "Sin Número" } },
      { userId: "u_off", user: { name: "Apagado Avisos" } },
      { userId: "u_alex", user: { name: "Alexander Mora" } },
    ],
    destinos: [
      { numero: "573001110001", userId: "u_em", soloDe: "u_em" },
      { numero: "573001110002", userId: "u_ana", soloDe: "u_ana" },
      { numero: "573001110004", userId: "u_off", soloDe: "u_off" },
      { numero: "573001110005", userId: "u_inactivo", soloDe: "u_inactivo" },
    ],
    tarjetas: [],
    historial: new Map(),
    avisos: [],
    enviados: [],
    updates: [],
    historiales: [],
    fallaElEnvio: false,
    alertas: [],
  });
  estado.ajustes.set("tablero:avisos-dueno:telefono:ws1", "573196892277");
};
reiniciar();

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
    findFirst: async ({ where }) =>
      estado.lineas.find(
        (l) =>
          l.workspaceId === where.workspaceId &&
          (where.id === undefined || l.id === where.id) &&
          (where.isActive === undefined || l.isActive === where.isActive) &&
          (!where.name || l.name.toLowerCase() === where.name.equals.toLowerCase()),
      ) ?? null,
  },
  workspaceMember: { findMany: async () => estado.miembros },
  workspace: { findUnique: async () => ({ ownerId: "u_alex" }) },
  user: { findUnique: async ({ where }) => ({ name: estado.miembros.find((m) => m.userId === where.id)?.user.name ?? null }) },
  tarjetaTablero: {
    findMany: async () => estado.tarjetas,
    updateMany: async ({ where, data }) => {
      const t = estado.tarjetas.find((x) => x.id === where.id);
      if (t && (where.urgente === undefined || t.urgente === where.urgente)) Object.assign(t, data);
    },
    findFirst: async ({ where }) => estado.tarjetas.find((x) => x.id === where.id) ?? null,
    update: async ({ where, data }) => Object.assign(estado.tarjetas.find((x) => x.id === where.id), data),
  },
  historialTarjeta: {
    groupBy: async () => [...estado.historial].map(([tarjetaId, creadoEn]) => ({ tarjetaId, _max: { creadoEn } })),
    create: async ({ data }) => estado.historiales.push(data),
  },
  $transaction: async (operaciones) => Promise.all(operaciones),
  avisoTarjetaEquipo: {
    findMany: async ({ where }) => estado.avisos.filter((a) => a.workspaceId === where.workspaceId && where.tarjetaId.in.includes(a.tarjetaId)).map((a) => ({ ...a })),
    findFirst: async () => null,
    create: async ({ data }) => {
      if (estado.avisos.some((a) => a.tarjetaId === data.tarjetaId && a.motivo === data.motivo)) throw Object.assign(new Error("único"), { code: "P2002" });
      const fila = { id: `av${estado.avisos.length + 1}`, intentos: 0, ...data };
      estado.avisos.push(fila);
      return { id: fila.id };
    },
    updateMany: async ({ where, data }) => {
      if (where.id === undefined) {
        const filas = estado.avisos.filter((a) => a.workspaceId === where.workspaceId && (where.estado === undefined || a.estado === where.estado));
        for (const f of filas) Object.assign(f, data);
        return { count: filas.length };
      }
      const fila = estado.avisos.find((a) => a.id === where.id && (where.estado === undefined || a.estado === where.estado) && (where.intentos === undefined || a.intentos === where.intentos));
      if (fila) Object.assign(fila, data);
      return { count: fila ? 1 : 0 };
    },
  },
  alertaInterna: {
    findFirst: async ({ where }) =>
      [...estado.alertas].reverse().find((a) => a.workspaceId === where.workspaceId && a.clave === where.clave && a.destinatarioId === where.destinatarioId && where.estado.in.includes(a.estado)) ?? null,
    create: async ({ data }) => {
      const fila = { id: `al${estado.alertas.length + 1}`, estado: "NUEVA", veces: 1, ...data };
      estado.alertas.push(fila);
      return { id: fila.id };
    },
    update: async ({ where, data }) => Object.assign(estado.alertas.find((a) => a.id === where.id), data),
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
  "@/features/agente-v3/servicios/avisos": {
    leerConfigDeAvisos: async () => ({ canalId: "x", activo: true, destinos: estado.destinos }),
    numeroDeAvisosDe: (config, userId) => config?.destinos.find((d) => d.userId === userId || d.soloDe === userId)?.numero ?? "",
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

const equipo = cargar("src/features/tableros-inteligentes/services/avisos-al-equipo.ts", mocks);

let pruebas = 0;
async function prueba(nombre, fn) {
  reiniciar();
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

// 10:00 a. m. de Bogotá (15:00Z), 11:00 p. m. (04:00Z del día siguiente) y 7:00 a. m. (12:00Z).
const DIA = new Date("2026-10-27T15:00:00Z");
const NOCHE = new Date("2026-10-28T04:00:00Z");
const SIETE = new Date("2026-10-28T12:00:00Z");
const HORA = 3_600_000;
const mas = (horas, desde = DIA) => new Date(desde.getTime() + horas * HORA);
const link = (id) => `https://app.aizenbot.com/cliente/tablero-ia?tarjeta=${id}`;
const linkAlerta = (id) => `https://app.aizenbot.com/cliente/alertas?alerta=${id}`;

const tarjeta = (extra = {}) => ({
  id: "t1",
  titulo: "Revisar mejoras del Agente SEO",
  detalle: "",
  estado: "IDEA",
  urgente: false,
  responsableId: null,
  creadoPor: null,
  repo: null,
  plan: null,
  zonaProtegida: [],
  resultado: null,
  creadoEn: DIA,
  ...extra,
});
const prender = () => estado.ajustes.set("tablero:avisos-equipo:ws1", JSON.stringify({ activo: true }));
/** Prende el interruptor y da la primera vuelta (la que anota lo de antes como "ya visto"). */
const prenderYBase = async (ahora = DIA) => {
  prender();
  await equipo.revisarAvisosDelEquipoDelNegocio("ws1", ahora);
};
const vuelta = (ahora = DIA) => equipo.revisarAvisosDelEquipoDelNegocio("ws1", ahora);
const textos = () => estado.enviados.map((e) => e.text);

/* ------------------------------------------------------------------ las pruebas */

await prueba("el interruptor general empieza apagado: nada sale aunque haya una tarjeta asignada", async () => {
  estado.tarjetas = [tarjeta({ responsableId: "u_em" })];
  await vuelta();
  await vuelta(mas(1));
  assert.deepEqual(estado.enviados, []);
  assert.equal(estado.avisos.length, 0);
});

await prueba("al prender el interruptor no se le avisa a lo que ya estaba asignado (se anota como ya visto)", async () => {
  estado.tarjetas = [tarjeta({ responsableId: "u_em" }), tarjeta({ id: "t2", estado: "ERROR", resultado: { error: "falló la prueba" } })];
  await prenderYBase();
  await vuelta(mas(1));
  assert.deepEqual(estado.enviados, [], "ninguna ola de mensajes");
  assert.ok(estado.avisos.length > 0 && estado.avisos.every((a) => a.estado === "YA_VISTO"));
  // Apagarlo y volver a prenderlo vuelve a anotar lo que haya, sin avisar.
  estado.ajustes.set("tablero:avisos-equipo:ws1", JSON.stringify({ activo: false }));
  await vuelta(mas(2));
  estado.tarjetas.push(tarjeta({ id: "t3", responsableId: "u_ana" }));
  await prenderYBase(mas(3));
  assert.deepEqual(estado.enviados, []);
});

await prueba("1. asignar una tarjeta manda UN aviso con nombre, título y link; la segunda pasada no lo repite", async () => {
  await prenderYBase();
  estado.tarjetas = [tarjeta({ responsableId: "u_em" })];
  await vuelta(mas(0.1));
  assert.equal(estado.enviados.length, 1);
  assert.deepEqual(estado.enviados[0], {
    instanceName: "admin-inst",
    phoneNumber: "573001110001",
    text: `Emanuel, tienes una tarea nueva: Revisar mejoras del Agente SEO. ${linkAlerta("al1")}`,
  });
  await vuelta(mas(0.2));
  await vuelta(mas(0.3));
  assert.equal(estado.enviados.length, 1, "no se repite");
  assert.equal(estado.avisos.find((a) => a.motivo === "asignada:u_em").estado, "ENVIADO");
});

await prueba("cada aviso queda TAMBIÉN como alerta de la persona, con el link directo a esa alerta en el WhatsApp", async () => {
  await prenderYBase();
  estado.tarjetas = [tarjeta({ responsableId: "u_em" })];
  await vuelta(mas(0.1));
  assert.equal(estado.alertas.length, 1);
  const alerta = estado.alertas[0];
  assert.equal(alerta.destinatarioId, "u_em", "es de Emanuel");
  assert.equal(alerta.workspaceId, "ws1");
  assert.equal(alerta.clave, "auto:equipo:t1:asignada:u_em");
  assert.equal(alerta.prioridad, "MEDIA");
  assert.equal(alerta.titulo, "Emanuel, tienes una tarea nueva: Revisar mejoras del Agente SEO.", "sin el link en el título");
  assert.ok(alerta.detalle.includes(link("t1")), "la alerta guarda el link de la tarjeta");
  assert.ok(estado.enviados[0].text.endsWith(`https://app.aizenbot.com/cliente/alertas?alerta=${alerta.id}`));
  await vuelta(mas(0.2));
  assert.equal(estado.alertas.length, 1, "la segunda pasada no duplica la alerta");
});

await prueba("el aviso del Coordinador sin responsable queda como alerta ALTA del dueño; ERROR de otra persona no se mezcla", async () => {
  await prenderYBase();
  estado.tarjetas = [tarjeta({ estado: "ERROR", resultado: { error: "falta una clave de API" } }), tarjeta({ id: "t2", responsableId: "u_ana" })];
  await vuelta(mas(0.1));
  const delDueno = estado.alertas.find((a) => a.destinatarioId === "u_alex");
  assert.ok(delDueno && delDueno.prioridad === "ALTA" && /^auto:equipo:t1:necesita:ERROR/.test(delDueno.clave));
  assert.equal(estado.alertas.find((a) => a.destinatarioId === "u_ana").clave, "auto:equipo:t2:asignada:u_ana");
  assert.equal(estado.alertas.filter((a) => a.destinatarioId === "u_em").length, 0);
});

await prueba("si el WhatsApp falla la alerta igual queda guardada; sin número o con avisos apagados no hay alerta", async () => {
  await prenderYBase();
  estado.fallaElEnvio = true;
  estado.tarjetas = [tarjeta({ responsableId: "u_em" }), tarjeta({ id: "t3", responsableId: "u_sin" }), tarjeta({ id: "t4", responsableId: "u_off" })];
  estado.ajustes.set("tablero:avisos-equipo:persona:u_off", "false");
  await vuelta(mas(0.1));
  assert.deepEqual(estado.alertas.map((a) => a.destinatarioId), ["u_em"]);
  await vuelta(mas(0.2));
  assert.equal(estado.alertas.length, 1, "el reintento no duplica la alerta");
});

await prueba("cambiar de responsable le avisa a la persona nueva, y la primera no recibe otro", async () => {
  await prenderYBase();
  estado.tarjetas = [tarjeta({ responsableId: "u_em" })];
  await vuelta(mas(0.1));
  estado.tarjetas[0].responsableId = "u_ana";
  await vuelta(mas(0.2));
  assert.equal(estado.enviados.length, 2);
  assert.equal(estado.enviados[1].phoneNumber, "573001110002");
  assert.match(estado.enviados[1].text, /^Ana, tienes una tarea nueva/);
  await vuelta(mas(0.3));
  assert.equal(estado.enviados.length, 2);
});

await prueba("2. marcar urgente manda un segundo aviso que empieza por URGENTE, también de noche, y una sola vez", async () => {
  await prenderYBase();
  estado.tarjetas = [tarjeta({ responsableId: "u_em" })];
  await vuelta(mas(0.1));
  estado.tarjetas[0].urgente = true;
  await vuelta(NOCHE);
  assert.equal(estado.enviados.length, 2);
  assert.match(estado.enviados[1].text, /^URGENTE: Emanuel, /);
  assert.ok(estado.enviados[1].text.endsWith(linkAlerta("al2")), "el link del WhatsApp es el de la alerta urgente");
  await vuelta(mas(1, NOCHE));
  assert.equal(estado.enviados.length, 2);
});

await prueba("2. un título que empieza por URGENTE también avisa (un solo mensaje URGENTE) y deja la marca en la tarjeta", async () => {
  await prenderYBase();
  estado.tarjetas = [tarjeta({ titulo: "URGENTE: arreglar el cobro", responsableId: "u_em" })];
  await vuelta(mas(0.1));
  assert.equal(estado.enviados.length, 1, "el 'tarea nueva' lo cubre el aviso urgente");
  assert.match(estado.enviados[0].text, /^URGENTE: Emanuel, esta tarea es urgente: arreglar el cobro\. /);
  assert.equal(estado.tarjetas[0].urgente, true, "la marca queda puesta");
  await vuelta(mas(0.2));
  assert.equal(estado.enviados.length, 1);
});

await prueba("la tarjeta que el responsable creó y se asignó a sí mismo no manda 'tarea nueva' ni recordatorio de 24 horas", async () => {
  estado.destinos.push({ numero: "573001110006", userId: "u_alex", soloDe: "u_alex" });
  await prenderYBase();
  estado.tarjetas = [tarjeta({ responsableId: "u_alex", creadoPor: "u_alex" })];
  await vuelta(mas(0.1));
  await vuelta(mas(30));
  assert.deepEqual(estado.enviados, []);
  assert.equal(estado.alertas.length, 0);
});

await prueba("esa misma tarjeta en ERROR o marcada URGENTE sí le avisa", async () => {
  estado.destinos.push({ numero: "573001110006", userId: "u_alex", soloDe: "u_alex" });
  await prenderYBase();
  estado.tarjetas = [
    tarjeta({ id: "e1", estado: "ERROR", responsableId: "u_alex", creadoPor: "u_alex", resultado: { error: "falló la prueba" } }),
    tarjeta({ id: "u1", urgente: true, responsableId: "u_alex", creadoPor: "u_alex" }),
  ];
  await vuelta(mas(0.1));
  assert.equal(estado.enviados.length, 2);
  assert.ok(estado.enviados.some((e) => /error/i.test(e.text)));
  assert.ok(estado.enviados.some((e) => e.text.startsWith("URGENTE:")));
  assert.ok(!estado.enviados.some((e) => /tarea nueva/.test(e.text)));
});

await prueba("una tarjeta creada por Alexander y asignada a Emanuel sí le avisa a Emanuel", async () => {
  await prenderYBase();
  estado.tarjetas = [tarjeta({ responsableId: "u_em", creadoPor: "u_alex" })];
  await vuelta(mas(0.1));
  assert.equal(estado.enviados.length, 1);
  assert.match(estado.enviados[0].text, /^Emanuel, tienes una tarea nueva/);
});

await prueba("una tarjeta urgente SIN responsable no avisa a nadie", async () => {
  await prenderYBase();
  estado.tarjetas = [tarjeta({ urgente: true })];
  await vuelta(mas(0.1));
  assert.deepEqual(estado.enviados, []);
});

await prueba("silencio: de noche no sale lo que no es urgente y sale a las 7 a. m. (una vez)", async () => {
  await prenderYBase(mas(-20, NOCHE));
  estado.tarjetas = [tarjeta({ responsableId: "u_em" })];
  await vuelta(NOCHE);
  await vuelta(mas(2, NOCHE));
  assert.deepEqual(estado.enviados, []);
  assert.equal(estado.avisos.filter((a) => a.motivo === "asignada:u_em").length, 0, "nada anotado: sigue pendiente");
  await vuelta(SIETE);
  assert.equal(estado.enviados.length, 1);
  await vuelta(mas(0.1, SIETE));
  assert.equal(estado.enviados.length, 1);
});

await prueba("3. una tarjeta en ERROR le avisa al responsable, con la causa, una sola vez", async () => {
  await prenderYBase();
  estado.tarjetas = [tarjeta({ id: "t9", titulo: "Subir el catálogo", estado: "ERROR", responsableId: "u_em", resultado: { error: "falló la prueba del build" } })];
  await vuelta(mas(0.1));
  const ERROR = estado.enviados.filter((e) => e.text.includes("Coordinador necesita"));
  assert.equal(ERROR.length, 1);
  assert.equal(ERROR[0].phoneNumber, "573001110001");
  assert.match(ERROR[0].text, /^Emanuel, el Coordinador necesita algo para seguir con "Subir el catálogo": quedó en error \(falló la prueba del build\)\. /);
  await vuelta(mas(0.2));
  assert.equal(estado.enviados.filter((e) => e.text.includes("Coordinador necesita")).length, 1);
});

await prueba("3. una tarjeta en ERROR sin responsable le avisa al dueño (su número de Mi empresa → Claude); si pide una clave, lo dice", async () => {
  await prenderYBase();
  estado.tarjetas = [tarjeta({ id: "t9", estado: "ERROR", resultado: { error: "401 invalid token en el servidor" } })];
  await vuelta(mas(0.1));
  assert.equal(estado.enviados.length, 1);
  assert.equal(estado.enviados[0].phoneNumber, "573196892277");
  assert.match(estado.enviados[0].text, /^Alexander, el Coordinador necesita algo para seguir con .*: falta una clave, un acceso o un permiso\. /);
  await vuelta(mas(0.2));
  assert.equal(estado.enviados.length, 1, "un solo mensaje por tarjeta");
});

await prueba("3. si pide configurar el VPS o Portainer lo dice en una frase", async () => {
  await prenderYBase();
  estado.tarjetas = [tarjeta({ id: "t9", estado: "ERROR", responsableId: "u_ana", resultado: { error: "hay que reiniciar el contenedor en Portainer" } })];
  await vuelta(mas(0.1));
  assert.ok(textos().some((t) => /hay que configurar algo en el VPS o en Portainer/.test(t)));
});

await prueba("3. una tarjeta POR_APROBAR que toca Meta Ads le avisa a su responsable; una común no avisa", async () => {
  await prenderYBase();
  estado.tarjetas = [
    tarjeta({ id: "m1", titulo: "Ajustar anuncios", estado: "POR_APROBAR", responsableId: "u_em", zonaProtegida: ["META_ADS"] }),
    tarjeta({ id: "c1", titulo: "Cambiar un texto", estado: "POR_APROBAR" }),
  ];
  await vuelta(mas(0.1));
  const necesita = estado.enviados.filter((e) => e.text.includes("Coordinador necesita"));
  assert.equal(necesita.length, 1);
  assert.match(necesita[0].text, /toca Meta Ads/);
});

await prueba("3. si el aviso de siempre al dueño ya mandó esa tarjeta, este no la duplica", async () => {
  await prenderYBase();
  estado.ajustes.set("tablero:avisos-dueno:estado:ws1", JSON.stringify({ avisados: { "auto:trabado:t9:ERROR": DIA.toISOString() }, historial: [] }));
  estado.tarjetas = [tarjeta({ id: "t9", estado: "ERROR", resultado: { error: "falló" } })];
  await vuelta(mas(0.1));
  assert.deepEqual(estado.enviados, []);
  assert.equal(estado.avisos.find((a) => a.motivo === "necesita:ERROR").estado, "YA_VISTO");
});

await prueba("4. el recordatorio sale UNA sola vez a las 24 horas sin movimiento", async () => {
  estado.tarjetas = [tarjeta({ responsableId: "u_em" })];
  estado.historial.set("t1", DIA);
  await prenderYBase();
  await vuelta(mas(23));
  assert.deepEqual(estado.enviados, [], "antes de las 24 horas nada");
  await vuelta(mas(25));
  assert.equal(estado.enviados.length, 1);
  assert.match(estado.enviados[0].text, /^Emanuel, recordatorio: "Revisar mejoras del Agente SEO" lleva más de 24 horas sin moverse\. /);
  await vuelta(mas(26));
  await vuelta(mas(50));
  assert.equal(estado.enviados.length, 1);
});

await prueba("4. si la tarjeta se movió, no hay recordatorio; si la tiene el Coordinador, tampoco", async () => {
  estado.tarjetas = [tarjeta({ responsableId: "u_em" }), tarjeta({ id: "t2", responsableId: "u_ana", repo: "aizencrm", estado: "EN_CURSO" })];
  estado.historial.set("t1", DIA);
  estado.historial.set("t2", DIA);
  await prenderYBase();
  estado.historial.set("t1", mas(20));
  await vuelta(mas(30));
  assert.deepEqual(estado.enviados, []);
});

await prueba("no avisa si la persona está inactiva, no tiene número o apagó sus avisos en el perfil (y queda anotado el motivo)", async () => {
  await prenderYBase();
  estado.ajustes.set("tablero:avisos-equipo:persona:u_off", "false");
  estado.tarjetas = [
    tarjeta({ id: "a", responsableId: "u_inactivo" }),
    tarjeta({ id: "b", responsableId: "u_sin" }),
    tarjeta({ id: "c", responsableId: "u_off" }),
  ];
  await vuelta(mas(0.1));
  assert.deepEqual(estado.enviados, []);
  const detalle = (id) => estado.avisos.find((x) => x.tarjetaId === id)?.detalle ?? "";
  assert.match(detalle("a"), /ya no está activa/);
  assert.match(detalle("b"), /no tiene número de avisos/);
  assert.match(detalle("c"), /apagó los avisos/);
  assert.ok(estado.avisos.every((x) => x.estado === "FALLIDO"));
});

await prueba("la casilla del perfil: prendida por defecto y se apaga/prende por persona", async () => {
  assert.equal(await equipo.personaRecibeAvisos("u_em"), true);
  await equipo.guardarAvisosDeLaPersona("u_em", false);
  assert.equal(await equipo.personaRecibeAvisos("u_em"), false);
  await equipo.guardarAvisosDeLaPersona("u_em", true);
  assert.equal(await equipo.personaRecibeAvisos("u_em"), true);
});

await prueba("nunca sale por una línea de ventas: sin línea Admin no sale nada", async () => {
  estado.lineas = estado.lineas.filter((l) => l.id !== LINEA_ADMIN);
  await prenderYBase();
  estado.tarjetas = [tarjeta({ responsableId: "u_em" })];
  await vuelta(mas(0.1));
  await vuelta(mas(0.2));
  assert.deepEqual(estado.enviados, []);
});

await prueba("si la línea Admin falla se reintenta 3 veces y después queda como fallido", async () => {
  await prenderYBase();
  estado.fallaElEnvio = true;
  estado.tarjetas = [tarjeta({ responsableId: "u_em" })];
  for (let i = 1; i <= 6; i += 1) await vuelta(mas(i / 10));
  const fila = estado.avisos.find((a) => a.motivo === "asignada:u_em");
  assert.equal(fila.estado, "FALLIDO");
  assert.equal(fila.intentos, 3);
  estado.fallaElEnvio = false;
  await vuelta(mas(2));
  assert.deepEqual(estado.enviados, [], "ya no se intenta más");
});

await prueba("si la línea falla una vez y vuelve, el aviso sale en la vuelta siguiente (una sola vez)", async () => {
  await prenderYBase();
  estado.fallaElEnvio = true;
  estado.tarjetas = [tarjeta({ responsableId: "u_em" })];
  await vuelta(mas(0.1));
  estado.fallaElEnvio = false;
  await vuelta(mas(0.2));
  await vuelta(mas(0.3));
  assert.equal(estado.enviados.length, 1);
});

await prueba("interruptor de la pantalla: prender no manda una ola, apagar no manda nada", async () => {
  estado.tarjetas = [tarjeta({ responsableId: "u_em" }), tarjeta({ id: "t2", responsableId: "u_ana", urgente: true })];
  await equipo.ponerAvisosAlEquipo("ws1", true);
  assert.equal(await equipo.avisosAlEquipoPrendidos("ws1"), true);
  assert.equal(estado.ajustes.get("tablero:avisos-equipo:ws1"), JSON.stringify({ activo: true }));
  await vuelta();
  await vuelta(mas(0.1));
  assert.deepEqual(estado.enviados, [], "lo ya asignado no se avisa");
  assert.ok(estado.avisos.length > 0 && estado.avisos.every((a) => a.estado === "YA_VISTO"));
  // Una tarea nueva con el interruptor prendido sí avisa.
  estado.tarjetas.push(tarjeta({ id: "t3", responsableId: "u_em" }));
  await vuelta(mas(0.2));
  assert.equal(estado.enviados.length, 1);
  // Apagado: nada sale aunque lleguen tareas nuevas.
  await equipo.ponerAvisosAlEquipo("ws1", false);
  assert.equal(await equipo.avisosAlEquipoPrendidos("ws1"), false);
  estado.tarjetas.push(tarjeta({ id: "t4", responsableId: "u_ana" }));
  await vuelta(mas(0.3));
  await vuelta(mas(0.4));
  assert.equal(estado.enviados.length, 1);
  // Un aviso que quedó PENDIENTE (línea caída) antes de apagar no sale al volver a prender, ni lo de mientras tanto.
  estado.avisos.push({ id: "viejo", workspaceId: "ws1", tarjetaId: "t9", motivo: "asignada:u_em", estado: "PENDIENTE", intentos: 1 });
  await equipo.ponerAvisosAlEquipo("ws1", true);
  await vuelta(mas(0.5));
  await vuelta(mas(0.6));
  assert.equal(estado.enviados.length, 1, "lo que llegó con los avisos apagados no sale al prenderlos");
  assert.equal(estado.avisos.find((a) => a.id === "viejo").estado, "YA_VISTO");
});

await prueba("interruptor rápido: prendido, apagado y prendido sin vuelta en medio no avisa lo de mientras tanto", async () => {
  await equipo.ponerAvisosAlEquipo("ws1", true);
  await vuelta();
  await equipo.ponerAvisosAlEquipo("ws1", false);
  estado.tarjetas = [tarjeta({ responsableId: "u_em" })];
  await equipo.ponerAvisosAlEquipo("ws1", true);
  await vuelta(mas(0.1));
  await vuelta(mas(0.2));
  assert.deepEqual(estado.enviados, []);
});

await prueba("equipoSinNumeroDeAvisos: solo los nombres de quien no tiene número (el dueño no, si tiene el suyo)", async () => {
  assert.deepEqual(await equipo.equipoSinNumeroDeAvisos("ws1"), ["Sin Número"]);
  estado.ajustes.delete("tablero:avisos-dueno:telefono:ws1");
  assert.deepEqual(await equipo.equipoSinNumeroDeAvisos("ws1"), ["Alexander Mora", "Sin Número"]);
});

await prueba("dos vueltas del reloj a la vez mandan UN solo mensaje", async () => {
  await prenderYBase();
  estado.tarjetas = [tarjeta({ responsableId: "u_em" })];
  await Promise.all([vuelta(mas(0.1)), vuelta(mas(0.1))]);
  assert.equal(estado.enviados.length, 1);
});

await prueba("marcarUrgente: la deja marcada, anota el historial y la segunda vez dice que ya estaba", async () => {
  estado.tarjetas = [tarjeta()];
  const contexto = { workspaceId: "ws1", userId: "u_alex", origen: "PANTALLA" };
  assert.deepEqual(await equipo.marcarUrgente(contexto, "t1"), { yaEstaba: false });
  assert.equal(estado.tarjetas[0].urgente, true);
  assert.equal(estado.historiales.length, 1);
  assert.deepEqual(estado.historiales[0].despues, { urgente: true });
  assert.deepEqual(await equipo.marcarUrgente(contexto, "t1"), { yaEstaba: true });
  assert.equal(estado.historiales.length, 1);
  await assert.rejects(() => equipo.marcarUrgente(contexto, "no-existe"), /no existe/);
});

await prueba("queNecesitaLaTarjeta: ERROR siempre dice algo; una tarjeta común que espera no pide nada", async () => {
  const base = { id: "x", titulo: "T", detalle: "", estado: "ERROR", urgente: false, responsableId: null, repo: null, plan: null, zonaProtegida: [], error: null, esperaPor: null, ultimoMovimiento: DIA };
  assert.match(equipo.queNecesitaLaTarjeta(base), /quedó en error/);
  assert.equal(equipo.queNecesitaLaTarjeta({ ...base, estado: "POR_REVISAR", esperaPor: "falta la prueba de que no se manda nada" }), null);
  assert.match(equipo.queNecesitaLaTarjeta({ ...base, estado: "POR_REVISAR", esperaPor: "configurar el VPS" }), /VPS/);
});

console.log(`\n${pruebas} pruebas de los avisos al equipo: todas pasaron.`);
