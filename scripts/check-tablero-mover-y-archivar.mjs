// Pruebas del Tablero IA (10-nov-2026) con un prisma FALSO en memoria:
//  1. Una Tarea cuelga de una Idea o directamente de un Área (crear_tarjeta / editar_tarjeta por el MCP), y agregarle
//     una madre permitida a un tipo (editarTipo) no cambia el estado ni la aprobación de ninguna tarjeta.
//  2. Mover una tarjeta (de qué cuelga, área, orden, fecha, responsable) no le quita la aprobación ni el plan, se puede
//     aunque el Coordinador la tenga (sin escribir su estado) y queda marcado como movimiento en el historial.
// Carga el services/tableros.ts REAL y los manejadores MCP reales (src/lib/mcp/tableros-inteligentes.ts).
// No necesita base ni red.
// Correr: npm run test:tablero-mover-y-archivar
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

/* ------------------------------------------------------------------ prisma falso */

const DbNull = Symbol("DbNull");
const estado = {
  usuarios: new Map(),
  miembros: [],
  negocios: new Map(),
  tableros: new Map(),
  tipos: new Map(),
  tarjetas: new Map(),
  historial: [],
  conexiones: [],
  ajustes: new Map(),
  contador: 0,
  reloj: Date.parse("2026-11-10T12:00:00Z"),
};

const ahora = () => new Date((estado.reloj += 1000));
const siguiente = (prefijo) => `${prefijo}${(estado.contador += 1)}`;

const OPERADORES = ["not", "in", "notIn", "gte", "lte", "isEmpty", "startsWith"];
const igual = (a, b) =>
  a instanceof Date || b instanceof Date ? a instanceof Date && b instanceof Date && a.getTime() === b.getTime() : a === b;

function cumple(valor, esperado) {
  if (esperado instanceof Date || esperado === null || typeof esperado !== "object") return igual(valor, esperado);
  const claves = Object.keys(esperado);
  if (claves.length && claves.every((clave) => OPERADORES.includes(clave))) {
    return claves.every((clave) => {
      const x = esperado[clave];
      if (clave === "not") return x !== null && typeof x === "object" && !(x instanceof Date) ? !cumple(valor, x) : !igual(valor, x);
      if (clave === "in") return x.includes(valor);
      if (clave === "notIn") return !x.includes(valor);
      if (clave === "gte") return valor.getTime() >= x.getTime();
      if (clave === "lte") return valor.getTime() <= x.getTime();
      if (clave === "startsWith") return typeof valor === "string" && valor.startsWith(x);
      return ((valor ?? []).length === 0) === x;
    });
  }
  return Boolean(valor) && typeof valor === "object" && coincide(valor, esperado);
}

function coincide(fila, where = {}) {
  return Object.entries(where).every(([campo, esperado]) => {
    if (esperado === undefined) return true;
    if (campo === "OR") return esperado.some((otro) => coincide(fila, otro));
    if (campo === "AND") return esperado.every((otro) => coincide(fila, otro));
    if (campo === "NOT") return !coincide(fila, esperado);
    return cumple(fila[campo], esperado);
  });
}

const persona = (id) => {
  const u = estado.usuarios.get(id);
  return u ? { id: u.id, name: u.name, email: u.email, role: u.role } : null;
};
const hidratarTablero = (t) => (t ? { ...t, dueno: t.duenoUserId ? persona(t.duenoUserId) : null } : null);
const tipoVista = (t) => (t ? { ...t, padres: t.padres.map((tipoPadreId) => ({ tipoPadreId })), tablero: hidratarTablero(estado.tableros.get(t.tableroId)) } : null);
const hidratarTarjeta = (t) =>
  t
    ? {
        ...t,
        tablero: hidratarTablero(estado.tableros.get(t.tableroId)),
        tipo: tipoVista(estado.tipos.get(t.tipoId)),
        padre: t.padreId ? estado.tarjetas.get(t.padreId) ?? null : null,
        responsable: t.responsableId ? persona(t.responsableId) : null,
      }
    : null;
const hidratarHistorial = (h) => ({ ...h, tarjeta: hidratarTarjeta(estado.tarjetas.get(h.tarjetaId)) });
const hidratarMiembro = (m) => ({ ...m, user: persona(m.userId) });

const ordenar = (filas, orderBy) => {
  const regla = Array.isArray(orderBy) ? orderBy[0] : orderBy;
  if (!regla) return filas;
  const [campo, sentido] = Object.entries(regla)[0];
  return [...filas].sort((a, b) => {
    const x = a[campo] instanceof Date ? a[campo].getTime() : a[campo];
    const y = b[campo] instanceof Date ? b[campo].getTime() : b[campo];
    return (x < y ? -1 : x > y ? 1 : 0) * (sentido === "desc" ? -1 : 1);
  });
};

const tarjetasQue = (where) => [...estado.tarjetas.values()].filter((t) => coincide(hidratarTarjeta(t), where));
const tablerosQue = (where) => [...estado.tableros.values()].filter((t) => coincide(hidratarTablero(t), where));

/** Las escrituras de tarjetas que se hicieron (para ver que mover no escribe el estado). */
const escrituras = [];

const falso = {
  tarjetaTablero: {
    findFirst: async ({ where }) => hidratarTarjeta(tarjetasQue(where)[0]),
    findUnique: async ({ where }) => hidratarTarjeta(estado.tarjetas.get(where.id)),
    findUniqueOrThrow: async ({ where }) => hidratarTarjeta(estado.tarjetas.get(where.id)),
    findMany: async ({ where, orderBy, take }) => ordenar(tarjetasQue(where).map(hidratarTarjeta), orderBy).slice(0, take ?? 1000),
    count: async ({ where }) => tarjetasQue(where).length,
    groupBy: async ({ by, where }) => {
      const grupos = new Map();
      for (const t of tarjetasQue(where)) {
        const clave = by.map((campo) => t[campo]).join("|");
        const grupo = grupos.get(clave) ?? { ...Object.fromEntries(by.map((campo) => [campo, t[campo]])), _count: { _all: 0 } };
        grupo._count._all += 1;
        grupos.set(clave, grupo);
      }
      return [...grupos.values()];
    },
    create: async ({ data }) => {
      const fila = {
        id: siguiente("nueva-"),
        numero: null,
        detalle: "",
        area: null,
        orden: 0,
        fecha: null,
        padreId: null,
        link: null,
        linkTexto: null,
        repo: null,
        plan: null,
        resultado: null,
        zonaProtegida: [],
        riesgo: null,
        riesgoMotivo: null,
        riesgoPor: null,
        intentos: 0,
        reparaciones: 0,
        trabajoVenceEn: null,
        responsableId: null,
        urgente: false,
        borradoEn: null,
        archivadaEn: null,
        terminadaEn: null,
        creadoEn: ahora(),
        actualizadoEn: ahora(),
        ...data,
      };
      estado.tarjetas.set(fila.id, fila);
      return hidratarTarjeta(fila);
    },
    updateMany: async ({ where, data }) => {
      const dentro = tarjetasQue(where);
      for (const t of dentro) {
        escrituras.push({ id: t.id, where, data });
        for (const [campo, valor] of Object.entries(data)) t[campo] = valor === DbNull ? null : valor;
        t.actualizadoEn = ahora();
      }
      return { count: dentro.length };
    },
  },
  historialTarjeta: {
    create: async ({ data }) => {
      const fila = { id: siguiente("h"), deshechoEn: null, creadoEn: ahora(), ...data };
      estado.historial.push(fila);
      return { id: fila.id };
    },
    findFirst: async ({ where }) => estado.historial.map(hidratarHistorial).find((h) => coincide(h, where)) ?? null,
    findMany: async ({ where, orderBy, take }) => ordenar(estado.historial.filter((h) => coincide(h, where)), orderBy).slice(0, take ?? 1000),
    update: async ({ where, data }) => Object.assign(estado.historial.find((h) => h.id === where.id), data),
  },
  intentoTarjeta: { findMany: async () => [] },
  conexionTarjeta: {
    findMany: async ({ where }) => estado.conexiones.filter((c) => coincide(c, where)),
    count: async ({ where }) => estado.conexiones.filter((c) => coincide(c, where)).length,
  },
  alertaInterna: { findMany: async () => [], updateMany: async () => ({ count: 0 }) },
  tableroInteligente: {
    findFirst: async ({ where }) => hidratarTablero(tablerosQue(where)[0]),
    findMany: async ({ where, orderBy }) => ordenar(tablerosQue(where).map(hidratarTablero), orderBy),
    aggregate: async ({ where }) => {
      const filas = tablerosQue(where);
      const max = filas.reduce((m, t) => (!m || t.actualizadoEn > m ? t.actualizadoEn : m), null);
      return { _max: { actualizadoEn: max }, _count: { _all: filas.length } };
    },
    create: async ({ data }) => {
      const fila = { id: siguiente("tab-"), duenoUserId: null, creadoEn: ahora(), actualizadoEn: ahora(), ...data };
      estado.tableros.set(fila.id, fila);
      return hidratarTablero(fila);
    },
    update: async ({ where, data = {} }) => {
      const fila = estado.tableros.get(where.id);
      Object.assign(fila, data, { actualizadoEn: data.actualizadoEn ?? ahora() });
      return hidratarTablero(fila);
    },
    updateMany: async ({ where, data = {} }) => {
      const filas = tablerosQue(where);
      for (const fila of filas) Object.assign(fila, data, { actualizadoEn: data.actualizadoEn ?? ahora() });
      return { count: filas.length };
    },
  },
  tipoTarjeta: {
    findMany: async ({ where }) =>
      [...estado.tipos.values()].filter((t) => coincide(tipoVista(t), where)).sort((a, b) => a.orden - b.orden).map(tipoVista),
    findFirst: async ({ where }) => tipoVista([...estado.tipos.values()].find((t) => coincide(tipoVista(t), where))),
    findUnique: async ({ where }) => tipoVista(estado.tipos.get(where.id)),
    findUniqueOrThrow: async ({ where }) => tipoVista(estado.tipos.get(where.id)),
    create: async ({ data }) => {
      const fila = { id: siguiente("tipo-"), color: "#71717a", icono: null, padres: [], creadoEn: ahora(), ...data };
      estado.tipos.set(fila.id, fila);
      return tipoVista(fila);
    },
    update: async ({ where, data }) => Object.assign(estado.tipos.get(where.id), data),
  },
  tipoTarjetaPadre: {
    createMany: async ({ data }) => {
      for (const { tipoId, tipoPadreId } of data) {
        const tipo = estado.tipos.get(tipoId);
        if (!tipo.padres.includes(tipoPadreId)) tipo.padres.push(tipoPadreId);
      }
      return { count: data.length };
    },
    deleteMany: async ({ where }) => {
      const tipo = estado.tipos.get(where.tipoId);
      tipo.padres = tipo.padres.filter((id) => !where.tipoPadreId.in.includes(id));
      return { count: 1 };
    },
    findUnique: async ({ where }) => {
      const { tipoId, tipoPadreId } = where.tipoId_tipoPadreId;
      return estado.tipos.get(tipoId)?.padres.includes(tipoPadreId) ? { tipoId } : null;
    },
  },
  workspaceMember: {
    findMany: async ({ where }) => estado.miembros.filter((m) => coincide(m, where)).map(hidratarMiembro),
    findFirst: async ({ where }) => {
      const fila = estado.miembros.find((m) => coincide(m, where));
      return fila ? hidratarMiembro(fila) : null;
    },
    count: async ({ where }) => estado.miembros.filter((m) => coincide(m, where)).length,
  },
  user: {
    findUnique: async ({ where }) => persona(where.id),
    findMany: async ({ where }) => [...estado.usuarios.values()].filter((u) => coincide(u, where)).map((u) => persona(u.id)),
  },
  workspace: {
    findUnique: async ({ where }) => {
      const negocio = estado.negocios.get(where.id);
      return negocio ? { ownerId: negocio.ownerId, owner: persona(negocio.ownerId) } : null;
    },
  },
  aprobadorTablero: { findUnique: async () => null },
  claveTrabajador: { findMany: async () => [] },
  appSetting: {
    // "Aprobar tareas solo" apagado: estas pruebas miran el estado que deja cada cambio, sin aprobaciones solas.
    findUnique: async ({ where }) =>
      where.key.startsWith("tablero:tareas-solas:")
        ? { key: where.key, value: "false" }
        : estado.ajustes.has(where.key)
          ? { key: where.key, value: estado.ajustes.get(where.key) }
          : null,
    upsert: async ({ where, create, update }) => {
      estado.ajustes.set(where.key, estado.ajustes.has(where.key) ? update.value : create.value);
      return { key: where.key, value: estado.ajustes.get(where.key) };
    },
  },
  $queryRawUnsafe: async () => [],
  $transaction: async (fn) => fn(falso),
};

const mocks = {
  "@/lib/prisma": { prisma: falso },
  "@prisma/client": { Prisma: { DbNull } },
};

const tableros = cargar("src/features/tableros-inteligentes/services/tableros.ts", mocks);
const reglas = cargar("src/features/tableros-inteligentes/services/reglas.ts", mocks);
const mcp = cargar("src/lib/mcp/tableros-inteligentes.ts", mocks);

/* ------------------------------------------------------------------ datos de partida */

function usuario(id, name) {
  estado.usuarios.set(id, { id, name, email: `${id.replace("u-", "")}@x.co`, role: "CLIENTE" });
}

/** Un tablero como los de producción hoy: la Tarea cuelga solo de una Idea, salvo que se pida `tareaEnArea`. */
function tableroDePrueba(id, { tareaEnArea = false } = {}) {
  estado.tableros.set(id, { id, workspaceId: "ws1", duenoUserId: "u-dueno", nombre: `Tablero ${id}`, creadoEn: ahora(), actualizadoEn: ahora() });
  const tipo = (clave, nombre, requiereAprobacion, usaEstados, orden, padres) =>
    estado.tipos.set(`${id}-${clave}`, {
      id: `${id}-${clave}`,
      tableroId: id,
      nombre,
      color: "#6366f1",
      icono: null,
      requiereAprobacion,
      usaEstados,
      orden,
      padres: padres.map((p) => `${id}-${p}`),
      creadoEn: ahora(),
    });
  tipo("area", "Área", false, false, 0, ["area"]);
  tipo("idea", "Idea", false, true, 1, ["area"]);
  tipo("tarea", "Tarea", true, true, 2, tareaEnArea ? ["idea", "area"] : ["idea"]);
}

function sembrar() {
  for (const mapa of [estado.usuarios, estado.negocios, estado.tableros, estado.tipos, estado.tarjetas, estado.ajustes]) mapa.clear();
  estado.miembros.length = 0;
  estado.historial.length = 0;
  estado.conexiones.length = 0;
  escrituras.length = 0;
  usuario("u-dueno", "Alex Dueño");
  usuario("u-ana", "Ana Pérez");
  usuario("u-bruno", "Bruno Ruiz");
  estado.negocios.set("ws1", { ownerId: "u-dueno" });
  const miembro = (userId, role = "MEMBER") =>
    estado.miembros.push({ workspaceId: "ws1", userId, isActive: true, role, createdAt: new Date((estado.contador += 1)) });
  miembro("u-dueno", "OWNER");
  miembro("u-ana");
  miembro("u-bruno");
  tableroDePrueba("tb1");
}

/** Una tarjeta ya guardada (cruda). */
function tarjeta(id, extra = {}) {
  const { tableroId = "tb1", tipo = "tarea", ...resto } = extra;
  const fila = {
    id,
    numero: null,
    tableroId,
    titulo: `Tarjeta ${id}`,
    detalle: "",
    area: null,
    estado: "IDEA",
    orden: 0,
    fecha: null,
    tipoId: `${tableroId}-${tipo}`,
    padreId: null,
    link: null,
    linkTexto: null,
    repo: null,
    plan: null,
    resultado: null,
    zonaProtegida: [],
    riesgo: null,
    riesgoMotivo: null,
    riesgoPor: null,
    intentos: 0,
    reparaciones: 0,
    trabajoVenceEn: null,
    responsableId: null,
    urgente: false,
    borradoEn: null,
    archivadaEn: null,
    terminadaEn: null,
    creadoPor: "u-dueno",
    creadoEn: ahora(),
    actualizadoEn: ahora(),
    ...resto,
  };
  estado.tarjetas.set(id, fila);
  return fila;
}

const dueno = { workspaceId: "ws1", soloDe: null, userId: "u-dueno", origen: "MCP" };
const contextoMcp = { workspaceId: "ws1", userId: "u-dueno" };
const llamar = (nombre, args) => mcp.ejecutarHerramientaMcpTableros(nombre, args, contextoMcp);

let pruebas = 0;
async function prueba(nombre, fn) {
  sembrar();
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const rechaza = (promesa, patron) => assert.rejects(promesa, patron);
const de = (id) => estado.tarjetas.get(id);
const seccion = (titulo) => console.log(`\n# ${titulo}`);

/* ------------------------------------------------------------------ 1. Tarea en un Área */

seccion("una Tarea cuelga de una Idea o directamente de un Área");

await prueba("un tablero nuevo nace con la Tarea colgando de Idea y de Área", async () => {
  const nuevo = await tableros.crearTablero(dueno, "Producción");
  const tipos = [...estado.tipos.values()].filter((t) => t.tableroId === nuevo.id);
  const id = (nombre) => tipos.find((t) => t.nombre === nombre).id;
  const tarea = tipos.find((t) => t.nombre === "Tarea");
  assert.deepEqual([...tarea.padres].sort(), [id("Idea"), id("Área")].sort());
  assert.deepEqual(tipos.find((t) => t.nombre === "Idea").padres, [id("Área")]);
  assert.deepEqual(tipos.find((t) => t.nombre === "Área").padres, [id("Área")]);
});

await prueba("crear_tarjeta: una Tarea directo en un Área se acepta cuando el tablero lo permite", async () => {
  tableroDePrueba("tb2", { tareaEnArea: true });
  tarjeta("area1", { tableroId: "tb2", tipo: "area", titulo: "Ventas" });
  const r = await llamar("crear_tarjeta", { tablero_id: "tb2", titulo: "Cambiar el guion", tipo: "Tarea", padre_id: "area1" });
  assert.equal(r.ok, true);
  assert.equal(r.padre_id, "area1");
  assert.equal(de(r.tarjeta_id).padreId, "area1");
  assert.equal(de(r.tarjeta_id).estado, "IDEA");
});

await prueba("crear_tarjeta: si el tablero todavía no lo permite (dato viejo), lo dice con las madres válidas", async () => {
  tarjeta("area1", { tipo: "area" });
  await rechaza(
    llamar("crear_tarjeta", { tablero_id: "tb1", titulo: "Directo al área", tipo: "Tarea", padre_id: "area1" }),
    /no puede colgar de una de tipo Área\. Puede colgar de: Idea/,
  );
});

await prueba("editar_tarjeta: mover una Tarea de una Idea a un Área se acepta cuando el tablero lo permite", async () => {
  tableroDePrueba("tb2", { tareaEnArea: true });
  tarjeta("area1", { tableroId: "tb2", tipo: "area" });
  tarjeta("idea1", { tableroId: "tb2", tipo: "idea", padreId: "area1" });
  tarjeta("t1", { tableroId: "tb2", padreId: "idea1" });
  const r = await llamar("editar_tarjeta", { tarjeta_id: "t1", padre_id: "area1" });
  assert.equal(r.ok, true);
  assert.equal(r.padre_id, "area1");
  assert.equal(de("t1").padreId, "area1");
});

await prueba("editar_tarjeta: en un tablero que no lo permite, mover una Tarea a un Área se rechaza", async () => {
  tarjeta("area1", { tipo: "area" });
  tarjeta("idea1", { tipo: "idea", padreId: "area1" });
  tarjeta("t1", { padreId: "idea1" });
  await rechaza(llamar("editar_tarjeta", { tarjeta_id: "t1", padre_id: "area1" }), /Puede colgar de: Idea/);
  assert.equal(de("t1").padreId, "idea1");
});

await prueba("editarTipo: agregar Área como madre de Tarea no cambia el estado ni la aprobación de ninguna tarjeta", async () => {
  const estados = ["IDEA", "POR_APROBAR", "APROBADO", "PLAN_LISTO", "PLAN_APROBADO", "EN_CURSO", "POR_REVISAR", "SUBIENDO", "HECHO", "FALLIDO", "ERROR"];
  tarjeta("area1", { tipo: "area" });
  tarjeta("idea1", { tipo: "idea", padreId: "area1", estado: "EN_CURSO" });
  for (const [i, e] of estados.entries()) tarjeta(`t${i}`, { padreId: "idea1", estado: e, repo: e === "IDEA" ? null : "aizencrm", plan: "el plan" });
  const antes = new Map([...estado.tarjetas.values()].map((t) => [t.id, { estado: t.estado, plan: t.plan }]));
  const historialAntes = estado.historial.length;

  const r = await tableros.editarTipo(dueno, "tb1-tarea", { padres: ["Idea", "Área"] });
  assert.equal(r.volvieronAIdea, 0);
  assert.deepEqual([...estado.tipos.get("tb1-tarea").padres].sort(), ["tb1-area", "tb1-idea"]);
  for (const t of estado.tarjetas.values()) assert.deepEqual({ estado: t.estado, plan: t.plan }, antes.get(t.id), t.id);
  assert.equal(estado.historial.length, historialAntes, "no deja filas de estado en el historial");
  assert.equal(escrituras.length, 0, "no escribe ninguna tarjeta");

  // Y desde ahí la Tarea ya se puede colgar directo del Área.
  const creada = await tableros.crearTarjeta(dueno, { tableroId: "tb1", titulo: "Tarea suelta en el área", tipo: "Tarea", padreId: "area1" });
  assert.equal(creada.tarjeta.padreId, "area1");
});

await prueba("los textos del MCP ya no dicen que la Tarea cuelga solo de una Idea", async () => {
  const crear = mcp.HERRAMIENTAS_MCP_TABLEROS.find((h) => h.name === "crear_tablero");
  assert.match(crear.description, /Tarea \(cuelga de una Idea o directamente de un Área/);
  const tarjetaNueva = mcp.HERRAMIENTAS_MCP_TABLEROS.find((h) => h.name === "crear_tarjeta");
  assert.match(tarjetaNueva.description, /una Tarea directo en un Área/);
  const r = await llamar("crear_tablero", { nombre: "Marketing" });
  assert.match(r.aviso, /Tarea \(cuelga de una Idea o directamente de un Área/);
  assert.deepEqual(
    reglas.TIPOS_POR_DEFECTO.find((t) => t.nombre === "Tarea").padres,
    ["Idea", "Área"],
  );
});

/* ------------------------------------------------------------------ 2. mover no quita la aprobación */

seccion("mover una tarjeta no le quita la aprobación ni el plan");

const ultimo = () => estado.historial[estado.historial.length - 1];

/** Una Tarea con repo y plan en `estadoInicial`, colgando de una Idea, con un Área y otra Idea a mano para moverla. */
function tareaConPlan(estadoInicial, extra = {}) {
  tarjeta("area1", { tipo: "area", titulo: "Ventas" });
  tarjeta("idea1", { tipo: "idea", padreId: "area1", titulo: "Idea uno" });
  tarjeta("idea2", { tipo: "idea", padreId: "area1", titulo: "Idea dos" });
  return tarjeta("t1", {
    padreId: "idea1",
    estado: estadoInicial,
    repo: "aizencrm",
    plan: "1. Cambiar el guion.\n2. Probar.",
    riesgo: "ALTO",
    riesgoMotivo: "toca chats",
    riesgoPor: "CLAUDE",
    ...extra,
  });
}

const MOVIMIENTOS = [
  ["de qué cuelga", { padre_id: "idea2" }, (t) => t.padreId === "idea2"],
  ["el área", { area: "Postventa" }, (t) => t.area === "Postventa"],
  ["el orden", { orden: 7 }, (t) => t.orden === 7],
  ["la fecha", { fecha: "2026-11-20" }, (t) => Boolean(t.fecha?.toISOString().startsWith("2026-11-20"))],
  ["el responsable", { responsable: "Bruno" }, (t) => t.responsableId === "u-bruno"],
  ["varias cosas a la vez", { padre_id: "idea2", area: "Postventa", orden: 3, responsable: "Ana" }, (t) => t.padreId === "idea2" && t.area === "Postventa"],
];

for (const estadoInicial of ["APROBADO", "PLAN_LISTO", "PLAN_APROBADO", "POR_REVISAR", "ERROR", "POR_APROBAR", "HECHO"]) {
  await prueba(`MCP: mover una ${estadoInicial} (padre, área, orden, fecha, responsable) conserva el estado y el plan`, async () => {
    for (const [nombre, args, quedo] of MOVIMIENTOS) {
      sembrar();
      tareaConPlan(estadoInicial);
      const r = await llamar("editar_tarjeta", { tarjeta_id: "t1", ...args });
      assert.equal(r.ok, true, nombre);
      assert.equal(de("t1").estado, estadoInicial, `${nombre}: el estado no cambia`);
      assert.equal(de("t1").plan, "1. Cambiar el guion.\n2. Probar.", `${nombre}: el plan no cambia`);
      assert.equal(de("t1").riesgo, "ALTO", `${nombre}: el riesgo no cambia`);
      assert.ok(quedo(de("t1")), `${nombre}: se movió`);
      assert.equal(r.estado, estadoInicial);
      assert.match(r.aviso, /Se movió: conserva su estado/);
      assert.ok(!("estado" in ultimo().despues), `${nombre}: el historial no anota cambio de estado`);
    }
  });
}

await prueba("historial: un movimiento queda marcado (movimiento: true) con el antes y el después de lo que se movió", async () => {
  tareaConPlan("APROBADO");
  await llamar("editar_tarjeta", { tarjeta_id: "t1", padre_id: "idea2", area: "Postventa" });
  const fila = ultimo();
  assert.equal(fila.accion, "editar");
  assert.equal(fila.origen, "MCP");
  assert.deepEqual(fila.antes, { area: null, padreId: "idea1" });
  assert.deepEqual(fila.despues, { area: "Postventa", padreId: "idea2", movimiento: true });
  // ver_historial_tarjeta lo devuelve tal cual (antes y despues de siempre, con la marca).
  const historial = await llamar("ver_historial_tarjeta", { tarjeta_id: "t1" });
  assert.equal(historial.cambios[0].accion, "editar");
  assert.equal(historial.cambios[0].despues.movimiento, true);
  assert.equal(historial.estado, "APROBADO");
});

await prueba("historial: asignar solo al responsable queda como siempre (sin la marca: ya tiene su línea 'Asignó a')", async () => {
  tareaConPlan("APROBADO");
  await llamar("editar_tarjeta", { tarjeta_id: "t1", responsable: "Bruno" });
  assert.deepEqual(ultimo().despues, { responsableId: "u-bruno", responsableNombre: "Bruno Ruiz" });
  assert.equal(de("t1").estado, "APROBADO");
});

await prueba("lo que hay que hacer sí la devuelve a POR_APROBAR: título, detalle, repo, riesgo y zona protegida", async () => {
  const casos = [
    ["título", { titulo: "Otro guion" }],
    ["detalle", { detalle: "Ahora con más pasos" }],
    ["repo", { repo: "gestion" }],
    ["riesgo", { riesgo: "ALTO", motivo_riesgo: "otro motivo" }],
    ["zona protegida", { zona_protegida: ["CHATS"] }],
    ["mover y cambiar el título juntos", { area: "Postventa", titulo: "Otro guion" }],
  ];
  for (const [nombre, args] of casos) {
    sembrar();
    tareaConPlan("APROBADO");
    const r = await llamar("editar_tarjeta", { tarjeta_id: "t1", ...args });
    assert.equal(de("t1").estado, "POR_APROBAR", nombre);
    assert.match(r.aviso, /volvió a POR_APROBAR/, nombre);
    assert.ok(!("movimiento" in ultimo().despues), `${nombre}: no es un movimiento`);
  }
});

await prueba("cambiar el tipo sigue la regla de siempre (estadoTrasCambiarTipo); poner repo a una EN_CURSO, estadoAlPonerRepo", async () => {
  tarjeta("area1", { tipo: "area" });
  tarjeta("i1", { tipo: "idea", padreId: "area1", estado: "EN_CURSO" });
  await llamar("editar_tarjeta", { tarjeta_id: "i1", tipo: "Tarea", padre_id: "" });
  assert.equal(de("i1").estado, "POR_APROBAR", "de Idea a Tarea: tipo con aprobación");
  tarjeta("t2", { estado: "EN_CURSO" });
  await llamar("editar_tarjeta", { tarjeta_id: "t2", repo: "aizencrm" });
  assert.equal(de("t2").estado, "POR_APROBAR", "una EN_CURSO a mano que recibe repo");
  tarjeta("t3", { estado: "EN_CURSO" });
  await llamar("editar_tarjeta", { tarjeta_id: "t3", area: "Postventa" });
  assert.equal(de("t3").estado, "EN_CURSO", "moverla no la toca");
});

await prueba("mover no recalcula el riesgo: una BAJO con zona sigue BAJO; cambiarle el texto sí la pasa a ALTO", async () => {
  tareaConPlan("APROBADO", { riesgo: "BAJO", riesgoMotivo: null, riesgoPor: "DUENO", zonaProtegida: ["CHATS"] });
  const r = await llamar("editar_tarjeta", { tarjeta_id: "t1", padre_id: "idea2", orden: 2 });
  assert.equal(de("t1").riesgo, "BAJO");
  assert.equal(de("t1").riesgoPor, "DUENO");
  assert.equal(r.riesgo, "BAJO");
  assert.equal(de("t1").estado, "APROBADO");
  await llamar("editar_tarjeta", { tarjeta_id: "t1", detalle: "otro detalle" });
  assert.equal(de("t1").riesgo, "ALTO", "el recálculo de siempre, cuando cambia lo que hay que hacer");
});

for (const estadoInicial of ["PLANEANDO", "EN_CURSO", "SUBIENDO"]) {
  await prueba(`con el Coordinador trabajando (${estadoInicial}): se puede mover sin tocar su estado, plan ni candado`, async () => {
    const vence = new Date("2026-11-10T13:00:00Z");
    const inicio = new Date("2026-11-10T11:55:00Z");
    tareaConPlan(estadoInicial, { trabajoVenceEn: vence, trabajoIniciadoEn: inicio, intentos: 1 });
    for (const [nombre, args] of MOVIMIENTOS) {
      escrituras.length = 0;
      await llamar("editar_tarjeta", { tarjeta_id: "t1", ...args });
      assert.equal(escrituras.length, 1, nombre);
      const [escritura] = escrituras;
      assert.ok(!("estado" in escritura.where), `${nombre}: no pide que el estado siga igual (no choca con el Coordinador)`);
      for (const campo of ["estado", "plan", "resultado", "trabajoVenceEn", "trabajoIniciadoEn", "intentos", "archivadaEn", "terminadaEn"]) {
        assert.ok(!(campo in escritura.data), `${nombre}: no escribe ${campo}`);
      }
      assert.equal(de("t1").estado, estadoInicial);
      assert.equal(de("t1").trabajoVenceEn, vence);
      assert.equal(de("t1").intentos, 1);
      assert.equal(de("t1").plan, "1. Cambiar el guion.\n2. Probar.");
    }
  });

  await prueba(`con el Coordinador trabajando (${estadoInicial}): lo demás sigue bloqueado, también mezclado con mover`, async () => {
    tareaConPlan(estadoInicial, { trabajoVenceEn: new Date("2026-11-10T13:00:00Z") });
    const pedidos = [
      { titulo: "Otro" },
      { detalle: "x" },
      { tipo: "Idea" },
      { repo: "gestion" },
      { riesgo: "ALTO" },
      { zona_protegida: ["CHATS"] },
      { link: "https://x.co" },
      { area: "Postventa", titulo: "Otro" },
    ];
    for (const args of pedidos) {
      await rechaza(llamar("editar_tarjeta", { tarjeta_id: "t1", ...args }), /El Coordinador tiene esta tarjeta en este momento/);
    }
    assert.equal(de("t1").area, null, "lo mezclado no se aplicó a medias");
    assert.equal(escrituras.length, 0);
  });
}

await prueba("mover mientras el Coordinador la cambia de etapa: no choca (no pide el estado viejo) ni lo pisa", async () => {
  tareaConPlan("PLANEANDO", { trabajoVenceEn: new Date("2026-11-10T13:00:00Z") });
  // El Coordinador termina el plan justo después de que se leyó la tarjeta para moverla.
  const leerOriginal = falso.tarjetaTablero.findFirst;
  falso.tarjetaTablero.findFirst = async (args) => {
    const fila = await leerOriginal(args);
    if (fila?.id === "t1") Object.assign(de("t1"), { estado: "PLAN_LISTO", plan: "plan nuevo", trabajoVenceEn: null });
    return fila;
  };
  try {
    await llamar("editar_tarjeta", { tarjeta_id: "t1", area: "Postventa" });
  } finally {
    falso.tarjetaTablero.findFirst = leerOriginal;
  }
  assert.equal(de("t1").area, "Postventa");
  assert.equal(de("t1").estado, "PLAN_LISTO", "queda lo que escribió el Coordinador");
  assert.equal(de("t1").plan, "plan nuevo");
});

await prueba("la pantalla sigue igual: editar el título de una APROBADO no la devuelve a POR_APROBAR", async () => {
  tareaConPlan("APROBADO");
  await tableros.editarTarjeta({ ...dueno, origen: "PANTALLA" }, "t1", { titulo: "Título nuevo" });
  assert.equal(de("t1").estado, "APROBADO");
  await tableros.editarTarjeta({ ...dueno, origen: "PANTALLA" }, "t1", { area: "Postventa" });
  assert.equal(de("t1").estado, "APROBADO");
  assert.equal(ultimo().despues.movimiento, true);
});

await prueba("deshacer un movimiento la devuelve a donde estaba, con el mismo estado", async () => {
  tareaConPlan("APROBADO");
  const r = await llamar("editar_tarjeta", { tarjeta_id: "t1", padre_id: "idea2", area: "Postventa" });
  assert.equal(de("t1").padreId, "idea2");
  await llamar("deshacer_cambio_tarjeta", { cambio_id: r.cambio_id });
  assert.equal(de("t1").padreId, "idea1");
  assert.equal(de("t1").area, null);
  assert.equal(de("t1").estado, "APROBADO");
});

await prueba("una archivada (HECHO) que se mueve no se desarchiva", async () => {
  const archivada = new Date("2026-11-09T12:00:00Z");
  tareaConPlan("HECHO", { archivadaEn: archivada, terminadaEn: archivada });
  await llamar("editar_tarjeta", { tarjeta_id: "t1", area: "Postventa" });
  assert.equal(de("t1").archivadaEn, archivada);
  assert.equal(de("t1").estado, "HECHO");
});

await prueba("reglas: soloMueve y puedeEditarTarjeta con soloMovimiento", async () => {
  assert.deepEqual([...reglas.CAMPOS_DE_MOVIMIENTO], ["padreId", "area", "orden", "fecha", "responsableId"]);
  assert.equal(reglas.soloMueve(["padreId", "area", "orden", "fecha", "responsableId"]), true);
  assert.equal(reglas.soloMueve(["responsableId"]), true);
  for (const otro of ["titulo", "detalle", "tipoId", "repo", "riesgo", "riesgoMotivo", "zonaProtegida", "link", "linkTexto"]) {
    assert.equal(reglas.soloMueve(["area", otro]), false, otro);
  }
  assert.equal(reglas.soloMueve([]), false, "sin cambios no es mover");
  for (const enManos of ["PLANEANDO", "EN_CURSO", "SUBIENDO"]) {
    assert.ok(reglas.puedeEditarTarjeta(enManos, true), enManos);
    assert.equal(reglas.puedeEditarTarjeta(enManos, true, true), null, `${enManos}: mover sí`);
  }
  assert.match(reglas.puedeEditarTarjeta("PLANEANDO", true), /Solo se puede mover/);
});

await prueba("los textos del MCP explican la regla de mover en editar_tarjeta", async () => {
  const editar = mcp.HERRAMIENTAS_MCP_TABLEROS.find((h) => h.name === "editar_tarjeta");
  assert.match(editar.description, /MOVER/);
  assert.match(editar.description, /CONSERVA su estado/);
  assert.match(editar.description, /sin interrumpir su trabajo/);
});

console.log(`\n${pruebas} pruebas, todas bien`);
