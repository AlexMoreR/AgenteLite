// Pruebas de la herramienta MCP `ver_supervisor` (src/lib/mcp/supervisor.ts): lo que tiene abierto
// el Supervisor, agrupado por asesora, con el teléfono completo y lo que intentó el accionable.
// Partes puras + el camino completo con una base de mentira (sin red ni base real).
// Correr: npm run test:mcp-supervisor
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

/* ------------------------------------------------------------------ base de mentira */

const WS = "ws1";
const HORA = 3_600_000;
/** Fechas relativas al reloj real: la herramienta usa `new Date()` como "ahora". */
const hace = (horas) => new Date(Date.now() - horas * HORA);

const db = {
  settings: new Map(),
  alertas: [],
  alertasLanza: false,
  datosDeChats: [],
  candidatos: [],
  escrituras: [],
};

// Miembros por negocio: "<ws>:<userId>".
const MEMBRESIAS = new Map([
  [`${WS}:alex`, { role: "OWNER", user: { role: "CLIENTE" }, workspace: { ownerId: "alex" } }],
  [`${WS}:admin1`, { role: "ADMIN", user: { role: "EMPLEADO" }, workspace: { ownerId: "alex" } }],
  [`${WS}:plataforma`, { role: "AGENT", user: { role: "ADMIN" }, workspace: { ownerId: "alex" } }],
  [`${WS}:sthef`, { role: "AGENT", user: { role: "EMPLEADO" }, workspace: { ownerId: "alex" } }],
  [`${WS}:maria`, { role: "AGENT", user: { role: "EMPLEADO" }, workspace: { ownerId: "alex" } }],
  [`${WS}:genesis`, { role: "AGENT", user: { role: "EMPLEADO" }, workspace: { ownerId: "alex" } }],
  ["ws2:intruso", { role: "OWNER", user: { role: "CLIENTE" }, workspace: { ownerId: "intruso" } }],
]);
const MIEMBROS_WS1 = [
  { userId: "alex", user: { name: "Magilus", email: "alex@x.com" } },
  { userId: "sthef", user: { name: "Stheffani Supervisora", email: null } },
  { userId: "maria", user: { name: "María Camila Ruiz", email: null } },
  { userId: "genesis", user: { name: "Genesis Moreno", email: null } },
];

function anotarEscritura(modelo, metodo) {
  return async (...args) => {
    db.escrituras.push({ modelo, metodo, args });
    return {};
  };
}
const METODOS_DE_ESCRITURA = ["create", "createMany", "createManyAndReturn", "update", "updateMany", "upsert", "delete", "deleteMany"];
function modelo(nombre, lecturas) {
  const obj = { ...lecturas };
  for (const m of METODOS_DE_ESCRITURA) obj[m] = anotarEscritura(nombre, m);
  return obj;
}

const prismaBase = {
  supervisorAlerta: modelo("supervisorAlerta", {
    findMany: async () => {
      if (db.alertasLanza) throw new Error("la base no responde");
      return db.alertas;
    },
    findUnique: async () => null,
  }),
  appSetting: modelo("appSetting", {
    findUnique: async ({ where }) => (db.settings.has(where.key) ? { key: where.key, value: db.settings.get(where.key) } : null),
    findMany: async () => [...db.settings.entries()].map(([key, value]) => ({ key, value })),
  }),
  workspaceMember: modelo("workspaceMember", {
    findFirst: async ({ where }) => {
      if (where.isActive !== true) throw new Error("se esperaba filtrar por isActive");
      return MEMBRESIAS.get(`${where.workspaceId}:${where.userId}`) ?? null;
    },
    findMany: async ({ where }) => (where.workspaceId === WS ? MIEMBROS_WS1 : []),
  }),
  // Dos consultas crudas: la de los chats candidatos (lleva EmbudoLead) y la de los datos de los chats de los avisos.
  $queryRaw: async (sql) => {
    const [partes, ...valores] = sql;
    const texto = partes.join("?");
    assert.ok(valores.includes(WS), "toda consulta cruda filtra por el negocio de la clave");
    if (texto.includes("EmbudoLead")) return db.candidatos;
    const ids = valores.find((v) => Array.isArray(v)) ?? [];
    return db.datosDeChats.filter((d) => ids.includes(d.conversationId));
  },
  $executeRaw: anotarEscritura("$", "executeRaw"),
  $executeRawUnsafe: anotarEscritura("$", "executeRawUnsafe"),
  $transaction: anotarEscritura("$", "transaction"),
};
// Cualquier modelo que no esté arriba: sus lecturas devuelven vacío y sus escrituras quedan anotadas.
const prisma = new Proxy(prismaBase, {
  get(objetivo, prop) {
    if (prop in objetivo) return objetivo[prop];
    if (typeof prop !== "string") return undefined;
    return new Proxy(
      {},
      {
        get: (_, metodo) =>
          METODOS_DE_ESCRITURA.includes(metodo) ? anotarEscritura(prop, metodo) : async () => (metodo === "findMany" ? [] : null),
      },
    );
  },
});

const mocks = {
  "@/lib/prisma": { prisma },
  "@prisma/client": { Prisma: { sql: (...a) => a, join: (x) => x } },
  react: { cache: (f) => f },
  "@/lib/cache-de-permisos": {
    cacheDeSupervisoras: { obtener: (_clave, fn) => fn(), invalidar: () => {}, vaciar: () => {} },
    cacheDeAcceso: { obtener: (_clave, fn) => fn(), invalidar: () => {}, vaciar: () => {} },
    cacheDeCanales: { obtener: (_clave, fn) => fn(), invalidar: () => {}, vaciar: () => {} },
    invalidarTrasEscritura: () => {},
  },
  "@/lib/web-push": { sendPushToUser: anotarEscritura("push", "send") },
  "@/lib/evolution": { sendEvolutionTextMessageWithReconnect: anotarEscritura("whatsapp", "send") },
  "@/lib/anti-bloqueo/servicio": { leerConfigAntiBloqueo: async () => ({ avisos: { canalInternoId: null } }) },
};

const mcp = cargar("src/lib/mcp/supervisor.ts", mocks);
const servicio = cargar("src/features/supervisor-accionable/servicios/accionable.ts", mocks);
const reglas = cargar("src/features/supervisor-accionable/dominio/reglas.ts", mocks);

let pruebas = 0;
const fallas = [];
async function prueba(nombre, fn) {
  try {
    await fn();
    pruebas += 1;
    console.log(`ok - ${nombre}`);
  } catch (error) {
    fallas.push(nombre);
    console.log(`FALLA - ${nombre}\n  ${String(error?.stack ?? error).split("\n").slice(0, 6).join("\n  ")}`);
  }
}

/* ------------------------------------------------------------------ datos realistas */

function hallazgo(clave, chats, extra = {}) {
  const familia = clave.startsWith("ATENCION") ? "ATENCION" : clave.startsWith("EMBUDO") ? "EMBUDO" : clave.startsWith("CAMBIO") ? "CAMBIO" : "BOT";
  return {
    clave,
    familia,
    severidad: "IMPORTANTE",
    titulo: `Hallazgo ${clave}`,
    que: "La asesora no ha respondido.",
    desde: hace(3).toISOString(), // en JSON las fechas van como texto
    producto: null,
    asesoraId: null,
    leadsAfectados: chats.length,
    evidencia: { chats, reglas: [], versiones: [] },
    metrica: "",
    esperado: "",
    observado: "",
    hechos: [],
    hipotesis: [],
    causaPosible: "",
    impacto: "Se pierden ventas.",
    recomendacion: "Responder ya al cliente.",
    queCambiar: "Escribirle hoy con el precio.",
    riesgo: "",
    comoMedir: "",
    tocaProduccion: false,
    ...extra,
  };
}

/** Una fila de SupervisorAlerta tal como la devuelve Prisma (hallazgos en JSON). */
function fila(id, clave, { familia, severidad = "IMPORTANTE", estado = "ABIERTA", titulo, producto = null, primeraVezEn = hace(2), hallazgos }) {
  return {
    id,
    workspaceId: WS,
    clave,
    claveAbierta: estado === "ABIERTA" ? `${WS}:${clave}` : null,
    familia: familia ?? (clave.startsWith("ATENCION") ? "ATENCION" : "BOT"),
    severidad,
    estado,
    titulo: titulo ?? `Alerta ${clave}`,
    producto,
    desde: hace(3),
    primeraVezEn,
    ultimaVezEn: hace(0.1),
    vecesVista: 3,
    hallazgos: JSON.parse(JSON.stringify(hallazgos)),
    texto: "texto largo",
    notificadaEn: null,
    severidadNotificada: null,
    resueltaEn: null,
    createdAt: hace(2),
    updatedAt: hace(0.1),
  };
}

const TELEFONO = "573001234567";
const MARIA = "María Camila Ruiz";
const GENESIS = "Genesis Moreno";

function datos(conversationId, asesoraNombre, extra = {}) {
  return {
    conversationId,
    nombre: `Cliente ${conversationId}`,
    telefono: TELEFONO,
    asesoraNombre,
    ultimoClienteEn: hace(1),
    ultimaRespuestaHumanaEn: hace(5),
    ultimoTextoCliente: `último texto de ${conversationId}`,
    ...extra,
  };
}

function candidato(conversationId, extra = {}) {
  return {
    conversationId,
    numero: 1000,
    status: "OPEN",
    lastMessageAt: hace(1),
    startedAt: hace(24 * 5),
    asesoraId: "maria",
    asesoraNombre: MARIA,
    nombre: `Lead ${conversationId}`,
    telefono: "573009998877",
    crmStage: "NUEVO",
    temperatura: "CALIENTE",
    ultimoClienteEn: hace(2),
    ultimoTextoCliente: "¿todavía tienen el combo?",
    ultimaRespuestaHumanaEn: hace(25),
    ...extra,
  };
}

const PRIMERA_A10 = hace(4);
const ACCION_C1 = {
  id: "c1",
  tipo: "caliente",
  conversationId: "c1",
  claveAlerta: "ATENCION:caliente-esperando:maria",
  responsableId: "maria",
  responsableNombre: MARIA,
  responsableEsSupervisora: false,
  cliente: "Cliente c1",
  telefono: "•••• 4567",
  numero: 1001,
  frase: "quiero el combo",
  motivo: "Caliente esperando",
  mensajeSugerido: "Hola, claro que sí: te paso el precio del combo.",
  riesgo: "VENTA",
  esperandoDesde: hace(1.5).toISOString(),
  plazoMin: 15,
  estado: "ESCALADA",
  detectadaEn: hace(1.5).toISOString(),
  avisadaEn: hace(1.5).toISOString(),
  venceEn: hace(1.25).toISOString(),
  segundoAvisoEn: hace(1.25).toISOString(),
  segundoAvisoA: "Stheffani Supervisora",
  escaladaEn: hace(1).toISOString(),
  gravedadEscalada: "IMPORTANTE",
  motivoEscalada: "No respondió ni con el segundo aviso.",
  resueltaEn: null,
  resueltaPor: null,
  resueltaPorNombre: null,
  minutosHastaResolver: null,
  atendidaEn: null,
  atendidaPor: null,
  incumplida: true,
  vistoEn: hace(0.1).toISOString(),
};

/** Deja la base en el escenario completo. `accionable`: prendido o apagado. */
function escenario({ accionable = true } = {}) {
  db.settings.clear();
  db.alertasLanza = false;
  servicio.olvidarConfigAccionable();
  db.settings.set(`equipo:supervisoras:${WS}`, JSON.stringify(["sthef"]));
  if (accionable) {
    db.settings.set(`supervisor:accionable:${WS}`, JSON.stringify({ activo: true }));
    db.settings.set(`supervisor:accionable:estado:${WS}`, JSON.stringify({ acciones: { c1: ACCION_C1 }, historial: [] }));
  }
  const incA10 = { clave: "INC:libro-v190:rafaga", primeraVezEn: PRIMERA_A10 };
  db.settings.set(
    `supervisor:accionable:atendidas:${WS}`,
    JSON.stringify({
      c5: { en: hace(1).toISOString(), por: "alex" }, // después de que empezó la alerta: no sale
      c6: { en: hace(5).toISOString(), por: "alex" }, // antes de que empezó la alerta: sí sale
      [reglas.idDeIncidente(incA10)]: { en: hace(1).toISOString(), por: "alex" },
    }),
  );

  db.alertas = [
    fila("a1", "ATENCION:caliente-esperando:maria", {
      titulo: "Calientes esperando a María Camila",
      hallazgos: [
        hallazgo("ATENCION:caliente-esperando:maria", ["c1", "c2"], {
          titulo: "Caliente esperando respuesta",
          asesoraId: "maria",
          hechos: ['Chat c1: 45 min laborales, dijo "quiero el combo".'],
        }),
      ],
    }),
    fila("a2", "ATENCION:asignado-sin-respuesta:genesis", {
      hallazgos: [hallazgo("ATENCION:asignado-sin-respuesta:genesis", ["c3"], { asesoraId: "genesis", titulo: "Asignado sin respuesta" })],
    }),
    fila("a3", "INC:libro-v187:combo-camilla", {
      familia: "BOT",
      severidad: "CRITICO",
      titulo: "Libro V3 v187: ráfaga inicial",
      producto: "combo-camilla",
      hallazgos: [hallazgo("BOT:rafaga:combo", ["c9"], { severidad: "CRITICO", recomendacion: "Volver la regla a la v186." })],
    }),
    fila("a4", "EMBUDO:caida:butacos", {
      familia: "EMBUDO",
      titulo: "El embudo de butacos se cayó",
      hallazgos: [hallazgo("EMBUDO:caida:butacos", [], { recomendacion: "Revisar el paso 2." })],
    }),
    fila("a5", "CAMBIO:libro-v188", {
      familia: "CAMBIO",
      severidad: "OBSERVACION",
      titulo: "Cambio del libro v188",
      hallazgos: [hallazgo("CAMBIO:libro-v188", [], { recomendacion: "" })],
    }),
    fila("a6", "ATENCION:caliente-esperando:viejo", { estado: "RESUELTA", hallazgos: [hallazgo("ATENCION:caliente-esperando:viejo", ["c7"])] }),
    fila("a7", "ATENCION:caliente-esperando:sin-duena", { hallazgos: [hallazgo("ATENCION:caliente-esperando:sin-duena", ["c4"])] }),
    fila("a8", "ATENCION:pago-sin-respuesta:maria", { hallazgos: [hallazgo("ATENCION:pago-sin-respuesta:maria", ["c5"], { asesoraId: "maria" })] }),
    fila("a9", "ATENCION:otra:maria", { hallazgos: [hallazgo("ATENCION:otra:maria", ["c6"], { asesoraId: "maria" })] }),
    fila("a10", "INC:libro-v190:rafaga", {
      familia: "BOT",
      severidad: "CRITICO",
      primeraVezEn: PRIMERA_A10,
      hallazgos: [hallazgo("BOT:rafaga:v190", [], { severidad: "CRITICO" })],
    }),
    fila("a11", "ATENCION:patron-lento:genesis", {
      titulo: "Genesis responde lento",
      hallazgos: [hallazgo("ATENCION:patron-lento:genesis", [], { asesoraId: "genesis", titulo: "Patrón: responde lento" })],
    }),
  ];
  db.datosDeChats = [
    datos("c1", MARIA),
    datos("c2", MARIA),
    datos("c3", GENESIS),
    datos("c4", null),
    datos("c5", MARIA),
    datos("c6", MARIA),
    datos("c9", MARIA),
  ];
  db.candidatos = [
    candidato("k1"), // 25 h sin mensaje de la asesora: entra
    candidato("k2", { ultimaRespuestaHumanaEn: hace(23) }), // 23 h: no
    candidato("k3", { temperatura: "FRIO", crmStage: "NUEVO" }), // frío: no
    candidato("k4", { crmStage: "GANADO" }),
    candidato("k5", { crmStage: "PERDIDO" }),
    candidato("k6", { status: "CLOSED" }),
    candidato("k7", { lastMessageAt: hace(15 * 24) }), // sin movimiento en 15 días
    candidato("k8", { temperatura: null, crmStage: "NEGOCIACION", ultimaRespuestaHumanaEn: hace(30) }), // = Caliente
    candidato("k9", { temperatura: "TIBIO", asesoraId: "genesis", asesoraNombre: GENESIS, ultimaRespuestaHumanaEn: hace(26) }),
    candidato("k10", { ultimaRespuestaHumanaEn: null, startedAt: hace(72) }), // nadie le escribió: cuenta desde que empezó
    candidato("k11", { asesoraId: null, asesoraNombre: null, ultimaRespuestaHumanaEn: hace(40) }),
  ];
}

const ver = (args = {}, userId = "alex") => mcp.ejecutarHerramientaMcpSupervisor("ver_supervisor", args, { workspaceId: WS, userId });
const grupo = (r, nombre) => r.por_asesora.find((g) => g.asesora === nombre);

/* ------------------------------------------------------------------ partes puras */

await prueba("la herramienta está registrada como solo lectura", () => {
  assert.equal(mcp.esHerramientaDelSupervisor("ver_supervisor"), true);
  assert.equal(mcp.esHerramientaDelSupervisor("otra"), false);
  const h = mcp.HERRAMIENTAS_MCP_SUPERVISOR[0];
  assert.equal(h.annotations.readOnlyHint, true);
  assert.equal(h.annotations.destructiveHint, false);
});

await prueba("diaBogota: el día AAAA-MM-DD empieza a las 00:00 de Colombia (05:00 UTC); fin = día siguiente", () => {
  assert.equal(mcp.diaBogota("2026-10-23", false).toISOString(), "2026-10-23T05:00:00.000Z");
  assert.equal(mcp.diaBogota("2026-10-23", true).toISOString(), "2026-10-24T05:00:00.000Z");
  assert.equal(mcp.diaBogota(" 2026-12-31 ", true).toISOString(), "2027-01-01T05:00:00.000Z");
  assert.equal(mcp.diaBogota("23/10/2026", false), null);
  assert.equal(mcp.diaBogota("2026-10-23T10:00", false), null);
  assert.equal(mcp.diaBogota("ayer", false), null);
});

await prueba("diaBogota: una fecha que no existe (mes 13, 31 de febrero) es mal escrita", () => {
  assert.equal(mcp.diaBogota("2026-13-01", false), null, "mes 13 no debería volverse enero de 2027");
  assert.equal(mcp.diaBogota("2026-02-31", false), null, "31 de febrero no debería volverse 3 de marzo");
});

await prueba("coincideAsesora: pedazo del nombre sin tildes ni mayúsculas, o id exacto", () => {
  const g = { nombre: MARIA, id: "maria" };
  assert.equal(mcp.coincideAsesora(null, g), true);
  assert.equal(mcp.coincideAsesora("maria camila", g), true);
  assert.equal(mcp.coincideAsesora("MARÍA   camila", g), true);
  assert.equal(mcp.coincideAsesora("ruiz", g), true);
  assert.equal(mcp.coincideAsesora("maria", g), true, "por id");
  assert.equal(mcp.coincideAsesora("genesis", g), false);
  assert.equal(mcp.coincideAsesora("sin asesora", { nombre: mcp.SIN_ASESORA, id: null }), true);
  assert.equal(mcp.coincideAsesora("maria", { nombre: GENESIS, id: "genesis" }), false);
});

const AHORA = new Date("2026-10-23T20:00:00Z"); // viernes 15:00 Bogotá
const horasAntes = (h) => new Date(AHORA.getTime() - h * HORA);
const candidatoFijo = (extra = {}) =>
  candidato("x", { lastMessageAt: horasAntes(1), startedAt: horasAntes(24 * 5), ultimoClienteEn: horasAntes(2), ultimaRespuestaHumanaEn: horasAntes(25), ...extra });

await prueba("chatOlvidado: Caliente/Tibio con más de 24 h sin mensaje de una persona y movimiento en 14 días", () => {
  assert.deepEqual(mcp.chatOlvidado(candidatoFijo(), AHORA), { temperatura: "CALIENTE", horas: 25 });
  assert.equal(mcp.chatOlvidado(candidatoFijo({ ultimaRespuestaHumanaEn: horasAntes(23) }), AHORA), null, "23 h");
  assert.equal(mcp.chatOlvidado(candidatoFijo({ ultimaRespuestaHumanaEn: horasAntes(24) }), AHORA), null, "24 h justas: no es 'más de'");
  assert.equal(mcp.chatOlvidado(candidatoFijo({ temperatura: "FRIO", crmStage: "NUEVO" }), AHORA), null, "frío");
  assert.equal(mcp.chatOlvidado(candidatoFijo({ crmStage: "GANADO" }), AHORA), null);
  assert.equal(mcp.chatOlvidado(candidatoFijo({ crmStage: "PERDIDO" }), AHORA), null);
  assert.equal(mcp.chatOlvidado(candidatoFijo({ status: "CLOSED" }), AHORA), null);
  assert.equal(mcp.chatOlvidado(candidatoFijo({ status: "ARCHIVED" }), AHORA), null);
  assert.equal(mcp.chatOlvidado(candidatoFijo({ lastMessageAt: horasAntes(15 * 24) }), AHORA), null, "15 días sin movimiento");
  assert.equal(mcp.chatOlvidado(candidatoFijo({ lastMessageAt: null }), AHORA), null);
  assert.equal(mcp.chatOlvidado(candidatoFijo({ temperatura: null, crmStage: "NEGOCIACION" }), AHORA).temperatura, "CALIENTE");
  assert.equal(mcp.chatOlvidado(candidatoFijo({ temperatura: null, crmStage: "PROPUESTA" }), AHORA).temperatura, "TIBIO");
  assert.equal(mcp.chatOlvidado(candidatoFijo({ temperatura: "tibio" }), AHORA).temperatura, "TIBIO", "sin importar mayúsculas");
  assert.deepEqual(mcp.chatOlvidado(candidatoFijo({ ultimaRespuestaHumanaEn: null, startedAt: horasAntes(30) }), AHORA), { temperatura: "CALIENTE", horas: 30 });
  assert.equal(mcp.chatOlvidado(candidatoFijo({ ultimaRespuestaHumanaEn: null, startedAt: horasAntes(3) }), AHORA), null, "chat nuevo");
  // Las exclusiones del Supervisor: no se le manda a la asesora a escribirle a estos.
  assert.equal(mcp.chatOlvidado(candidatoFijo({ dormidoHasta: horasAntes(-5) }), AHORA), null, "dormido");
  assert.notEqual(mcp.chatOlvidado(candidatoFijo({ dormidoHasta: horasAntes(5) }), AHORA), null, "ya despertó");
  assert.equal(mcp.chatOlvidado(candidatoFijo({ exterior: true }), AHORA), null, "exterior");
  assert.equal(mcp.chatOlvidado(candidatoFijo({ bloqueadoEn: horasAntes(48) }), AHORA), null, "bloqueado");
  assert.equal(mcp.chatOlvidado(candidatoFijo({ lineaProposito: "ADMIN" }), AHORA), null, "línea administrativa");
  assert.notEqual(mcp.chatOlvidado(candidatoFijo({ lineaProposito: "SALES" }), AHORA), null, "línea de ventas");
});

await prueba("queHizoElSupervisor: plazo_vencido solo mientras la acción sigue abierta", () => {
  const cerrada = { ...ACCION_C1, estado: "RESUELTA_ABAJO", venceEn: "2026-10-23T19:15:00.000Z" };
  assert.equal(mcp.queHizoElSupervisor(cerrada, AHORA).plazo_vencido, null);
});

await prueba("yaAtendido: la marca de Alexander cuenta solo si es igual o posterior a la primeraVezEn de la alerta", () => {
  const inc = { primeraVezEn: horasAntes(2) };
  assert.equal(mcp.yaAtendido("c1", inc, { c1: { en: horasAntes(1).toISOString(), por: "alex" } }, undefined), true);
  assert.equal(mcp.yaAtendido("c1", inc, { c1: { en: horasAntes(2).toISOString(), por: "alex" } }, undefined), true);
  assert.equal(mcp.yaAtendido("c1", inc, { c1: { en: horasAntes(3).toISOString(), por: "alex" } }, undefined), false);
  assert.equal(mcp.yaAtendido("c1", inc, {}, undefined), false);
  assert.equal(mcp.yaAtendido("c1", inc, { c2: { en: horasAntes(1).toISOString(), por: "alex" } }, undefined), false, "otro chat");
  const atendida = { ...ACCION_C1, estado: "ATENDIDA_POR_ALEXANDER", atendidaEn: horasAntes(1).toISOString() };
  assert.equal(mcp.yaAtendido("c1", inc, {}, atendida), true, "también por el estado del accionable");
  assert.equal(mcp.yaAtendido("c1", inc, {}, { ...atendida, atendidaEn: horasAntes(5).toISOString() }), false);
  assert.equal(mcp.yaAtendido("c1", inc, {}, { ...ACCION_C1, atendidaEn: horasAntes(1).toISOString() }), false, "solo si el estado es ATENDIDA_POR_ALEXANDER");
});

await prueba("queHizoElSupervisor: aviso, plazo, segundo aviso y escalada en hora de Colombia; sin acción = null", () => {
  assert.equal(mcp.queHizoElSupervisor(undefined, AHORA), null);
  const accion = {
    ...ACCION_C1,
    avisadaEn: "2026-10-23T19:00:00.000Z",
    venceEn: "2026-10-23T19:15:00.000Z",
    segundoAvisoEn: "2026-10-23T19:15:00.000Z",
    escaladaEn: "2026-10-23T19:25:00.000Z",
  };
  const q = mcp.queHizoElSupervisor(accion, AHORA);
  assert.equal(q.estado, "Escalada a Alexander");
  assert.equal(q.avisada, MARIA);
  assert.equal(q.avisada_es_la_supervisora, false);
  assert.equal(q.avisada_en, "2026-10-23 14:00");
  assert.equal(q.plazo_minutos, 15);
  assert.equal(q.vence_en, "2026-10-23 14:15");
  assert.equal(q.plazo_vencido, true);
  assert.equal(q.segundo_aviso_en, "2026-10-23 14:15");
  assert.equal(q.segundo_aviso_a, "Stheffani Supervisora");
  assert.equal(q.escalada_a_alexander_en, "2026-10-23 14:25");
  assert.equal(q.gravedad_de_la_escalada, "IMPORTANTE");
  assert.equal(q.motivo_de_la_escalada, "No respondió ni con el segundo aviso.");
  const enPlazo = mcp.queHizoElSupervisor({ ...accion, estado: "AVISADA", venceEn: "2026-10-23T20:10:00.000Z", segundoAvisoEn: null, escaladaEn: null, gravedadEscalada: null, motivoEscalada: null }, AHORA);
  assert.equal(enPlazo.estado, "Avisada · en plazo");
  assert.equal(enPlazo.plazo_vencido, false);
  assert.equal(enPlazo.segundo_aviso_en, null);
  assert.equal(enPlazo.escalada_a_alexander_en, null);
  assert.equal(enPlazo.gravedad_de_la_escalada, null);
});

/** Un incidente ya revivido (como lo devuelve filaAIncidente) para armarRespuesta. */
function incidente(id, clave, chats, extra = {}) {
  const { hallazgo: extraH = {}, ...resto } = extra;
  return {
    id,
    clave,
    familia: clave.startsWith("ATENCION") ? "ATENCION" : "BOT",
    severidad: "IMPORTANTE",
    titulo: `Alerta ${clave}`,
    producto: null,
    primeraVezEn: horasAntes(2),
    ultimaVezEn: horasAntes(0.1),
    desde: horasAntes(3),
    vecesVista: 1,
    estado: "ABIERTA",
    resueltaEn: null,
    notificadaEn: null,
    severidadNotificada: null,
    hallazgos: [{ ...hallazgo(clave, chats), desde: horasAntes(3), ...extraH }],
    ...resto,
  };
}
const entrada = (extra = {}) => ({
  ahora: AHORA,
  filtros: { asesora: null, desde: null, hasta: null },
  alertas: [],
  datosPorChat: new Map(),
  estado: null,
  atendidas: {},
  candidatos: [],
  miembros: [
    { id: "maria", nombre: MARIA },
    { id: "genesis", nombre: GENESIS },
  ],
  ...extra,
});

await prueba("armarRespuesta: filtro de fecha desde/hasta en hora de Bogotá (hasta incluido)", () => {
  // AHORA = 23-oct 15:00 Bogotá. Una alerta de ayer a las 23:30 y otra de hoy a las 00:30 (hora de Bogotá).
  const ayerTarde = incidente("i1", "ATENCION:x:maria", [], { primeraVezEn: new Date("2026-10-23T04:30:00Z"), hallazgo: { asesoraId: "maria" } }); // 22-oct 23:30 Bogotá
  const hoyTemprano = incidente("i2", "ATENCION:y:maria", [], { primeraVezEn: new Date("2026-10-23T05:30:00Z"), hallazgo: { asesoraId: "maria" } }); // 23-oct 00:30 Bogotá
  const base = entrada({ alertas: [ayerTarde, hoyTemprano] });
  const contar = (filtros) => {
    const r = mcp.armarRespuesta({ ...base, filtros: { asesora: null, desde: null, hasta: null, ...filtros } });
    return r.por_asesora.flatMap((g) => g.avisos.map((a) => a.alerta_id));
  };
  assert.deepEqual(contar({}), ["i1", "i2"]);
  assert.deepEqual(contar({ desde: mcp.diaBogota("2026-10-23", false) }), ["i2"]);
  assert.deepEqual(contar({ hasta: mcp.diaBogota("2026-10-22", true) }), ["i1"], "hasta incluye el día entero de Bogotá");
  assert.deepEqual(contar({ desde: mcp.diaBogota("2026-10-22", false), hasta: mcp.diaBogota("2026-10-22", true) }), ["i1"]);
  assert.deepEqual(contar({ desde: mcp.diaBogota("2026-10-24", false) }), []);
  // Los chats olvidados se filtran por el último mensaje del cliente.
  const r = mcp.armarRespuesta({
    ...entrada({ candidatos: [candidatoFijo({ ultimoClienteEn: new Date("2026-10-23T04:30:00Z") }), candidatoFijo({ conversationId: "y", ultimoClienteEn: null })] }),
    filtros: { asesora: null, desde: mcp.diaBogota("2026-10-23", false), hasta: null },
  });
  assert.equal(r.por_asesora.length, 0, "chat de ayer y chat sin mensaje del cliente quedan fuera con filtro de fecha");
});

await prueba("armarRespuesta: tope de 30 por asesora con avisos_por_fuera y chats_por_fuera", () => {
  const alertas = Array.from({ length: 32 }, (_, i) => incidente(`i${i}`, `ATENCION:p${i}:maria`, [`c${i}`]));
  const datosPorChat = new Map(alertas.map((_, i) => [`c${i}`, datos(`c${i}`, MARIA)]));
  const candidatos = Array.from({ length: 35 }, (_, i) => candidatoFijo({ conversationId: `k${i}`, ultimaRespuestaHumanaEn: horasAntes(25 + i) }));
  const r = mcp.armarRespuesta(entrada({ alertas, datosPorChat, candidatos }));
  const g = r.por_asesora[0];
  assert.equal(r.por_asesora.length, 1);
  assert.equal(g.avisos.length, 30);
  assert.equal(g.avisos_por_fuera, 2);
  assert.equal(g.chats_sin_mensaje_de_la_asesora_24h.length, 30);
  assert.equal(g.chats_por_fuera, 5);
  assert.equal(g.chats_sin_mensaje_de_la_asesora_24h[0].horas_sin_mensaje_de_la_asesora, 59, "los más olvidados primero");
  assert.deepEqual(r.resumen, [{ asesora: MARIA, avisos: 32, chats_sin_mensaje_de_la_asesora_24h: 35 }], "el resumen cuenta todo");
  const pocos = mcp.armarRespuesta(entrada({ alertas: alertas.slice(0, 3), datosPorChat, candidatos: candidatos.slice(0, 2) })).por_asesora[0];
  assert.equal("avisos_por_fuera" in pocos, false);
  assert.equal("chats_por_fuera" in pocos, false);
});

await prueba("armarRespuesta: sin datos del chat, el aviso va a la asesora del hallazgo o de la acción", () => {
  const sinDatos = incidente("i1", "ATENCION:z:genesis", ["cx"], { hallazgo: { asesoraId: "genesis" } });
  const r = mcp.armarRespuesta(entrada({ alertas: [sinDatos] }));
  assert.equal(r.por_asesora[0].asesora, GENESIS);
  assert.equal(r.por_asesora[0].asesora_id, "genesis");
  assert.equal(r.por_asesora[0].avisos[0].cliente, "Chat no encontrado");
  assert.equal(r.por_asesora[0].avisos[0].telefono, null);
});

await prueba("armarRespuesta: un chat sin dueña sin datos no cae en el grupo de la supervisora", () => {
  const inc = incidente("i1", "ATENCION:sin-duena:cy", ["cy"], { hallazgo: { asesoraId: null } });
  const accion = { ...ACCION_C1, id: "cy", conversationId: "cy", claveAlerta: "ATENCION:sin-duena:cy", tipo: "sin_duena", estado: "AVISADA", responsableId: "sthef", responsableNombre: "Stheffani Supervisora", responsableEsSupervisora: true };
  const r = mcp.armarRespuesta(entrada({ alertas: [inc], estado: { acciones: { cy: accion }, historial: [] }, miembros: [{ id: "sthef", nombre: "Stheffani Supervisora" }] }));
  assert.equal(r.por_asesora.length, 0);
  assert.equal(r.sin_asesora.avisos.length, 1);
});

await prueba("armarRespuesta: una acción cerrada de otra alerta no se muestra como lo que intentó el Supervisor", () => {
  const inc = incidente("i1", "ATENCION:nueva:c1", ["c1"]);
  const vieja = { ...ACCION_C1, claveAlerta: "ATENCION:vieja:c1", estado: "RESUELTA_ABAJO" };
  const r = mcp.armarRespuesta(entrada({ alertas: [inc], datosPorChat: new Map([["c1", datos("c1", MARIA)]]), estado: { acciones: { c1: vieja }, historial: [] } }));
  assert.equal(r.por_asesora[0].avisos[0].que_hizo_el_supervisor, null);
});

await prueba("armarRespuesta: el tope deja primero los avisos más graves", () => {
  const alertas = Array.from({ length: 31 }, (_, i) =>
    incidente(`i${i}`, `ATENCION:p${i}:maria`, [`c${i}`], { hallazgo: { severidad: i === 30 ? "CRITICO" : "OBSERVACION" } }),
  );
  const datosPorChat = new Map(alertas.map((_, i) => [`c${i}`, datos(`c${i}`, MARIA)]));
  const g = mcp.armarRespuesta(entrada({ alertas, datosPorChat })).por_asesora[0];
  assert.equal(g.avisos[0].gravedad, "CRÍTICO");
  assert.equal(g.avisos[0].alerta_id, "i30");
});

/* ------------------------------------------------------------------ camino completo */

await prueba("camino completo: agrupa por asesora, aparte sin_asesora y para_alexander, con resumen", async () => {
  escenario();
  const r = await ver();
  assert.equal(r.accionable_activo, true);
  assert.deepEqual(r.por_asesora.map((g) => g.asesora), [GENESIS, MARIA], "ordenadas por nombre");
  assert.deepEqual(r.resumen, [
    { asesora: GENESIS, avisos: 2, chats_sin_mensaje_de_la_asesora_24h: 1 },
    { asesora: MARIA, avisos: 3, chats_sin_mensaje_de_la_asesora_24h: 3 },
    { asesora: "sin asesora", avisos: 1, chats_sin_mensaje_de_la_asesora_24h: 1 },
  ]);
  const maria = grupo(r, MARIA);
  assert.equal(maria.asesora_id, "maria");
  assert.deepEqual(maria.avisos.map((a) => a.conversacion_id), ["c1", "c2", "c6"]);
  const genesis = grupo(r, GENESIS);
  assert.equal(genesis.asesora_id, "genesis");
  assert.deepEqual(genesis.avisos.map((a) => a.conversacion_id), ["c3", null], "el patrón sin chats también va a su grupo");
  assert.equal(genesis.avisos[1].motivo, "Patrón: responde lento");
  assert.equal(r.sin_asesora.asesora, "sin asesora");
  assert.equal(r.sin_asesora.asesora_id, null);
  assert.deepEqual(r.sin_asesora.avisos.map((a) => a.conversacion_id), ["c4"]);
  assert.deepEqual(r.sin_asesora.chats_sin_mensaje_de_la_asesora_24h.map((c) => c.conversacion_id), ["k11"]);
  // Bot, embudo y cambio del libro: para Alexander, nunca en el grupo de una asesora.
  assert.deepEqual(r.para_alexander.map((a) => a.alerta_id), ["a3", "a4", "a5"]);
  const bot = r.para_alexander[0];
  assert.equal(bot.titulo, "Libro V3 v187: ráfaga inicial");
  assert.equal(bot.gravedad, "CRÍTICO");
  assert.equal(bot.familia, "BOT");
  assert.equal(bot.producto, "combo-camilla");
  assert.equal(bot.recomendacion, "Volver la regla a la v186.");
  assert.equal(r.para_alexander[1].familia, "EMBUDO");
  assert.equal(r.para_alexander[1].recomendacion, "Revisar el paso 2.");
  assert.equal(r.para_alexander[2].gravedad, "OBSERVACIÓN");
  assert.equal(r.para_alexander[2].recomendacion, null);
  const todosLosAvisos = [...r.por_asesora, r.sin_asesora].flatMap((g) => g.avisos.map((a) => a.alerta_id));
  for (const id of ["a3", "a4", "a5", "a10"]) assert.ok(!todosLosAvisos.includes(id), `${id} no va en el grupo de una asesora`);
  assert.ok(!todosLosAvisos.includes("a6"), "una alerta RESUELTA no sale");
  assert.equal(r.filtros.asesora, null);
  assert.ok(typeof r.generado_en === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(r.generado_en));
  assert.equal("no_se_pudo_leer" in r, false);
});

await prueba("camino completo: el teléfono sale completo, nunca tapado", async () => {
  escenario();
  const r = await ver();
  const c1 = grupo(r, MARIA).avisos.find((a) => a.conversacion_id === "c1");
  assert.equal(c1.telefono, TELEFONO);
  assert.equal(c1.cliente, "Cliente c1");
  assert.equal(c1.lo_ultimo_que_dijo_el_cliente, "quiero el combo", "la frase sale de los hechos de la alerta");
  assert.equal(c1.esperando, "45 min laborales");
  assert.equal(c1.gravedad, "IMPORTANTE");
  assert.equal(c1.motivo, "Caliente esperando respuesta");
  assert.equal(c1.solucion_recomendada.recomendacion, "Responder ya al cliente.");
  assert.equal(c1.solucion_recomendada.que_hacer, "Escribirle hoy con el precio.");
  assert.equal(c1.solucion_recomendada.mensaje_sugerido_para_el_cliente, ACCION_C1.mensajeSugerido);
  const chat = grupo(r, MARIA).chats_sin_mensaje_de_la_asesora_24h[0];
  assert.equal(chat.telefono, "573009998877");
  assert.ok(!JSON.stringify(r).includes("••••"), "nada tapado en toda la respuesta");
});

await prueba("camino completo: que_hizo_el_supervisor con aviso, segundo aviso a la supervisora y escalada", async () => {
  escenario();
  const r = await ver();
  const q = grupo(r, MARIA).avisos.find((a) => a.conversacion_id === "c1").que_hizo_el_supervisor;
  assert.ok(q, "con el accionable prendido trae lo que hizo");
  assert.equal(q.estado, "Escalada a Alexander");
  assert.equal(q.avisada, MARIA);
  assert.match(q.avisada_en, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.equal(q.plazo_minutos, 15);
  assert.match(q.vence_en, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.equal(q.plazo_vencido, true);
  assert.match(q.segundo_aviso_en, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.equal(q.segundo_aviso_a, "Stheffani Supervisora");
  assert.match(q.escalada_a_alexander_en, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.equal(q.motivo_de_la_escalada, "No respondió ni con el segundo aviso.");
  assert.equal(grupo(r, MARIA).avisos.find((a) => a.conversacion_id === "c2").que_hizo_el_supervisor, null, "c2 sin acción");
  assert.ok(!r.advertencias.some((a) => a.includes("apagado")));
});

await prueba("camino completo: con el accionable apagado, que_hizo_el_supervisor es null y hay advertencia", async () => {
  escenario({ accionable: false });
  // Aunque quede un estado viejo guardado, con el accionable apagado no se lee.
  db.settings.set(`supervisor:accionable:estado:${WS}`, JSON.stringify({ acciones: { c1: ACCION_C1 }, historial: [] }));
  const r = await ver();
  assert.equal(r.accionable_activo, false);
  for (const a of grupo(r, MARIA).avisos) assert.equal(a.que_hizo_el_supervisor, null);
  assert.equal(grupo(r, MARIA).avisos[0].solucion_recomendada.mensaje_sugerido_para_el_cliente, null);
  assert.ok(r.advertencias.some((a) => /accionable está apagado/.test(a)));
});

await prueba("camino completo: lo atendido por Alexander no sale (chat e incidente crítico); una marca anterior a la alerta sí", async () => {
  escenario();
  const r = await ver();
  const ids = [...r.por_asesora, r.sin_asesora].flatMap((g) => g.avisos.map((a) => a.conversacion_id));
  assert.ok(!ids.includes("c5"), "c5 marcado después de que empezó la alerta");
  assert.ok(ids.includes("c6"), "c6 marcado ANTES de que empezó la alerta: sigue saliendo");
  assert.ok(!r.para_alexander.some((a) => a.alerta_id === "a10"), "incidente crítico atendido (idDeIncidente)");
  // Sin la marca, a10 sí sale.
  db.settings.set(`supervisor:accionable:atendidas:${WS}`, "{}");
  const sin = await ver();
  assert.ok(sin.para_alexander.some((a) => a.alerta_id === "a10"));
  assert.ok(grupo(sin, MARIA).avisos.some((a) => a.conversacion_id === "c5"));
});

await prueba("camino completo: filtro por asesora (pedazo del nombre sin tildes, o id); para_alexander va vacío", async () => {
  escenario();
  for (const filtro of ["maria camila", "MARIA", "ruiz", "maria"]) {
    const r = await ver({ asesora: filtro });
    assert.deepEqual(r.por_asesora.map((g) => g.asesora), [MARIA], `filtro "${filtro}"`);
    assert.equal(r.sin_asesora, null);
    assert.deepEqual(r.para_alexander, []);
    assert.deepEqual(r.resumen.map((g) => g.asesora), [MARIA]);
    assert.equal(r.filtros.asesora, filtro);
  }
  const g = await ver({ asesora: "genesis" });
  assert.deepEqual(g.por_asesora.map((x) => x.asesora), [GENESIS]);
  const sin = await ver({ asesora: "sin asesora" });
  assert.deepEqual(sin.por_asesora, []);
  assert.deepEqual(sin.sin_asesora.avisos.map((a) => a.conversacion_id), ["c4"]);
  const nadie = await ver({ asesora: "pepita" });
  assert.deepEqual(nadie.por_asesora, []);
  assert.equal(nadie.sin_asesora, null);
  const vacio = await ver({ asesora: "   " });
  assert.equal(vacio.filtros.asesora, null, "un filtro en blanco es sin filtro");
  assert.equal(vacio.para_alexander.length, 3);
});

await prueba("camino completo: filtro por fecha desde/hasta; fecha mal escrita = error", async () => {
  escenario();
  const futuro = await ver({ desde: "2099-01-01" });
  assert.deepEqual(futuro.por_asesora, []);
  assert.equal(futuro.sin_asesora, null);
  assert.deepEqual(futuro.para_alexander, []);
  assert.equal(futuro.filtros.desde, "2099-01-01");
  const pasado = await ver({ hasta: "2000-01-01" });
  assert.deepEqual(pasado.por_asesora, []);
  const todo = await ver({ desde: "2000-01-01", hasta: "2099-12-31" });
  assert.equal(todo.resumen.length, 3);
  assert.equal(todo.para_alexander.length, 3);
  await assert.rejects(() => ver({ desde: "23-10-2026" }), /"desde" tiene que ir como AAAA-MM-DD/);
  await assert.rejects(() => ver({ hasta: "ayer" }), /"hasta" tiene que ir como AAAA-MM-DD/);
});

await prueba("camino completo: chats Caliente/Tibio sin mensaje de la asesora (entran k1, k8, k10; no los demás)", async () => {
  escenario();
  const r = await ver();
  const maria = grupo(r, MARIA).chats_sin_mensaje_de_la_asesora_24h;
  assert.deepEqual(maria.map((c) => c.conversacion_id), ["k10", "k8", "k1"], "ordenados del más olvidado al menos");
  const k1 = maria.find((c) => c.conversacion_id === "k1");
  assert.equal(k1.temperatura, "Caliente");
  assert.equal(k1.horas_sin_mensaje_de_la_asesora, 25);
  assert.equal(k1.cliente, "Lead k1");
  assert.equal(k1.ultimo_mensaje_del_cliente, "¿todavía tienen el combo?");
  assert.equal(k1.cliente_esperando, true);
  assert.equal(maria.find((c) => c.conversacion_id === "k8").temperatura, "Caliente", "NEGOCIACION sin temperatura = Caliente");
  const k10 = maria.find((c) => c.conversacion_id === "k10");
  assert.equal(k10.ultimo_mensaje_de_la_asesora_en, null);
  assert.equal(k10.horas_sin_mensaje_de_la_asesora, 72);
  const genesis = grupo(r, GENESIS).chats_sin_mensaje_de_la_asesora_24h;
  assert.deepEqual(genesis.map((c) => [c.conversacion_id, c.temperatura]), [["k9", "Tibio"]]);
  const todos = JSON.stringify(r);
  for (const id of ["k2", "k3", "k4", "k5", "k6", "k7"]) assert.ok(!todos.includes(`"${id}"`), `${id} no entra`);
});

await prueba("permisos: dueño, ADMIN y supervisora sí; asesora, otro negocio y desconocido no", async () => {
  escenario();
  for (const userId of ["alex", "admin1", "plataforma", "sthef"]) {
    const r = await ver({}, userId);
    assert.ok(Array.isArray(r.por_asesora), `${userId} puede ver el Supervisor`);
  }
  for (const userId of ["maria", "genesis", "intruso", "nadie"]) {
    await assert.rejects(() => ver({}, userId), /no tiene permiso/, `${userId} no puede`);
  }
  // Si a Stheffani le quitan el rol de supervisora, ya no puede.
  db.settings.set(`equipo:supervisoras:${WS}`, "[]");
  await assert.rejects(() => ver({}, "sthef"), /no tiene permiso/);
  // El permiso se revisa antes de validar la fecha: una clave sin permiso no aprende nada.
  await assert.rejects(() => ver({ desde: "malo" }, "maria"), /no tiene permiso/);
});

await prueba("si los avisos no se pueden leer, la respuesta sale igual con no_se_pudo_leer", async () => {
  escenario();
  db.alertasLanza = true;
  const r = await ver();
  assert.ok(Array.isArray(r.no_se_pudo_leer));
  assert.ok(r.no_se_pudo_leer.some((x) => x.startsWith("avisos del Supervisor") && x.includes("la base no responde")));
  assert.deepEqual(r.para_alexander, []);
  assert.deepEqual(grupo(r, MARIA).avisos, []);
  assert.equal(grupo(r, MARIA).chats_sin_mensaje_de_la_asesora_24h.length, 3, "los chats olvidados salen igual");
});

await prueba("herramienta desconocida = error", async () => {
  await assert.rejects(() => mcp.ejecutarHerramientaMcpSupervisor("borrar_todo", {}, { workspaceId: WS, userId: "alex" }), /No existe la herramienta/);
});

await prueba("la herramienta no escribe nada en la base ni manda nada", async () => {
  // Las pruebas anteriores también pasaron por la herramienta: no debería haber nada anotado.
  assert.deepEqual(db.escrituras.map((e) => `${e.modelo}.${e.metodo}`), [], "nada escrito en las pruebas anteriores");
  escenario();
  await ver();
  await ver({ asesora: "maria camila", desde: "2000-01-01", hasta: "2099-12-31" });
  await ver({}, "sthef");
  escenario({ accionable: false });
  await ver();
  await assert.rejects(() => ver({}, "maria"));
  db.alertasLanza = true;
  await ver();
  assert.deepEqual(
    db.escrituras.map((e) => `${e.modelo}.${e.metodo}`),
    [],
    "ninguna escritura, push ni WhatsApp",
  );
});

console.log(`\n${pruebas} pruebas ok${fallas.length ? `, ${fallas.length} fallaron: ${fallas.join(" | ")}` : ""}`);
if (fallas.length) process.exit(1);
