// Pruebas del RESPONSABLE de la tarjeta del Tablero IA con un prisma FALSO en memoria.
// Carga el services/tableros.ts REAL (crearTarjeta, editarTarjeta, deshacerCambioTarjeta, aprobarTarjeta,
// historialDeTarjeta, intentosDeLaTarjeta, asignadasA, tarjetaAsignada) y los manejadores MCP reales
// (src/lib/mcp/tableros-inteligentes.ts). No necesita base ni red.
// Correr: npm run test:tablero-responsable
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
  intentos: [],
  conexiones: [],
  contador: 0,
  reloj: Date.parse("2026-10-24T12:00:00Z"),
};

const ahora = () => new Date((estado.reloj += 1000));
const siguiente = (prefijo) => `${prefijo}${(estado.contador += 1)}`;

const OPERADORES = ["not", "in", "gte", "lte", "isEmpty"];
const igual = (a, b) =>
  a instanceof Date || b instanceof Date ? a instanceof Date && b instanceof Date && a.getTime() === b.getTime() : a === b;

function cumple(valor, esperado) {
  if (esperado instanceof Date || esperado === null || typeof esperado !== "object") return igual(valor, esperado);
  const claves = Object.keys(esperado);
  if (claves.length && claves.every((clave) => OPERADORES.includes(clave))) {
    return claves.every((clave) => {
      const x = esperado[clave];
      if (clave === "not") return !igual(valor, x);
      if (clave === "in") return x.includes(valor);
      if (clave === "gte") return valor.getTime() >= x.getTime();
      if (clave === "lte") return valor.getTime() <= x.getTime();
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
const hidratarTarjeta = (t) =>
  t
    ? {
        ...t,
        tablero: hidratarTablero(estado.tableros.get(t.tableroId)),
        tipo: tipoVista(estado.tipos.get(t.tipoId)),
        responsable: t.responsableId ? persona(t.responsableId) : null,
      }
    : null;
const tipoVista = (t) => (t ? { ...t, padres: t.padres.map((tipoPadreId) => ({ tipoPadreId })) } : null);
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

const falso = {
  tarjetaTablero: {
    findFirst: async ({ where }) => hidratarTarjeta([...estado.tarjetas.values()].find((t) => coincide(hidratarTarjeta(t), where))),
    findUnique: async ({ where }) => hidratarTarjeta(estado.tarjetas.get(where.id)),
    findUniqueOrThrow: async ({ where }) => hidratarTarjeta(estado.tarjetas.get(where.id)),
    findMany: async ({ where, orderBy, take }) =>
      ordenar(
        [...estado.tarjetas.values()].map(hidratarTarjeta).filter((t) => coincide(t, where)),
        orderBy,
      ).slice(0, take ?? 1000),
    count: async ({ where }) => [...estado.tarjetas.values()].map(hidratarTarjeta).filter((t) => coincide(t, where)).length,
    create: async ({ data }) => {
      const fila = {
        id: siguiente("nueva-"),
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
        borradoEn: null,
        creadoEn: ahora(),
        actualizadoEn: ahora(),
        ...data,
      };
      estado.tarjetas.set(fila.id, fila);
      return hidratarTarjeta(fila);
    },
    deleteMany: async ({ where }) => {
      const dentro = [...estado.tarjetas.values()].filter((t) => coincide(hidratarTarjeta(t), where));
      for (const t of dentro) {
        estado.tarjetas.delete(t.id);
        // El historial se va con la tarjeta (ON DELETE CASCADE).
        estado.historial = estado.historial.filter((h) => h.tarjetaId !== t.id);
      }
      return { count: dentro.length };
    },
    updateMany: async ({ where, data }) => {
      const dentro = [...estado.tarjetas.values()].filter((t) => coincide(hidratarTarjeta(t), where));
      for (const t of dentro) {
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
    findFirst: async ({ where }) => {
      const fila = estado.historial.map(hidratarHistorial).find((h) => coincide(h, where));
      return fila ?? null;
    },
    findMany: async ({ where, orderBy, take }) =>
      ordenar(estado.historial.filter((h) => coincide(h, where)), orderBy).slice(0, take ?? 1000),
    update: async ({ where, data }) => {
      const fila = estado.historial.find((h) => h.id === where.id);
      Object.assign(fila, data);
      return fila;
    },
  },
  intentoTarjeta: {
    findMany: async ({ where, orderBy, take }) =>
      ordenar(estado.intentos.filter((i) => coincide(i, where)), orderBy).slice(0, take ?? 1000),
  },
  conexionTarjeta: {
    findMany: async ({ where }) => estado.conexiones.filter((c) => coincide(c, where)),
    count: async ({ where }) => estado.conexiones.filter((c) => coincide(c, where)).length,
  },
  tableroInteligente: {
    findFirst: async ({ where }) => hidratarTablero([...estado.tableros.values()].find((t) => coincide(hidratarTablero(t), where))),
    update: async ({ where }) => {
      estado.tableros.get(where.id).actualizadoEn = ahora();
    },
  },
  tipoTarjeta: {
    findMany: async ({ where }) => [...estado.tipos.values()].filter((t) => coincide(t, where)).sort((a, b) => a.orden - b.orden).map(tipoVista),
    findUnique: async ({ where }) => tipoVista(estado.tipos.get(where.id)),
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
  // "Aprobar tareas solo" (regla del 25-oct) apagado: estas pruebas miran que asignar no aprueba y que editar quita la aprobación.
  appSetting: { findUnique: async ({ where }) => (where.key.startsWith("tablero:tareas-solas:") ? { value: "false" } : null) },
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

function usuario(id, name, role = "CLIENTE") {
  estado.usuarios.set(id, { id, name, email: `${id.replace("u-", "")}@x.co`, role });
}

function sembrar() {
  for (const mapa of [estado.usuarios, estado.negocios, estado.tableros, estado.tipos, estado.tarjetas]) mapa.clear();
  estado.miembros.length = 0;
  estado.historial.length = 0;
  estado.intentos.length = 0;
  estado.conexiones.length = 0;

  usuario("u-dueno", "Alex Dueño");
  usuario("u-ana", "Ana Pérez");
  usuario("u-ana2", "Ana Gómez");
  usuario("u-bruno", "Bruno Ruiz");
  usuario("u-inactivo", "Inés Inactiva");
  usuario("u-otro", "Olga Otra");
  estado.negocios.set("ws1", { ownerId: "u-dueno" });
  estado.negocios.set("ws2", { ownerId: "u-otro" });
  const miembro = (workspaceId, userId, isActive = true, role = "MEMBER") =>
    estado.miembros.push({ workspaceId, userId, isActive, role, createdAt: new Date(estado.contador += 1) });
  miembro("ws1", "u-dueno", true, "OWNER");
  miembro("ws1", "u-ana");
  miembro("ws1", "u-ana2");
  miembro("ws1", "u-bruno");
  miembro("ws1", "u-inactivo", false);
  miembro("ws2", "u-otro", true, "OWNER");

  const tablero = (id, workspaceId, duenoUserId, nombre) =>
    estado.tableros.set(id, { id, workspaceId, duenoUserId, nombre, actualizadoEn: ahora() });
  tablero("tb1", "ws1", "u-dueno", "Ventas");
  tablero("tb2", "ws1", "u-ana", "Tablero de Ana");
  tablero("tb3", "ws2", "u-otro", "Otro negocio");
  for (const id of ["tb1", "tb2", "tb3"]) {
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
    tipo("tarea", "Tarea", true, true, 2, ["idea"]);
  }
}

/** Una tarjeta ya guardada (cruda). */
function tarjeta(id, extra = {}) {
  const { tableroId = "tb1", tipo = "tarea", ...resto } = extra;
  const fila = {
    id,
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
    borradoEn: null,
    creadoEn: ahora(),
    actualizadoEn: ahora(),
    ...resto,
  };
  estado.tarjetas.set(id, fila);
  return fila;
}

const dueno = { workspaceId: "ws1", soloDe: null, userId: "u-dueno", origen: "MCP" };
const duenoPantalla = { ...dueno, origen: "PANTALLA" };
// Ana ve solo sus tableros (tb2): del tb1 solo puede leer lo que le asignen.
const ana = { workspaceId: "ws1", soloDe: "u-ana", userId: "u-ana", origen: "PANTALLA" };

let pruebas = 0;
async function prueba(nombre, fn) {
  sembrar();
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const rechaza = (promesa, patron) => assert.rejects(promesa, patron);
const de = (id) => estado.tarjetas.get(id);
const ultimo = () => estado.historial[estado.historial.length - 1];
const seccion = (titulo) => console.log(`\n# ${titulo}`);

/* ------------------------------------------------------------------ asignar y quitar */

seccion("asignar y quitar");

await prueba("crear con responsable por nombre: queda en la tarjeta y en el historial (id y nombre)", async () => {
  const r = await tableros.crearTarjeta(dueno, { tableroId: "tb1", titulo: "Revisar precios", tipo: "Idea", responsable: "Bruno" });
  assert.equal(r.tarjeta.responsableId, "u-bruno");
  assert.equal(r.tarjeta.responsableNombre, "Bruno Ruiz");
  assert.equal(de(r.tarjeta.id).responsableId, "u-bruno");
  const fila = ultimo();
  assert.equal(fila.accion, "crear");
  assert.equal(fila.despues.responsableId, "u-bruno");
  assert.equal(fila.despues.responsableNombre, "Bruno Ruiz");
});

await prueba("crear por email y por id; sin responsable no escribe nada en el historial", async () => {
  const porEmail = await tableros.crearTarjeta(dueno, { tableroId: "tb1", titulo: "Uno", tipo: "Idea", responsable: "ANA@x.co" });
  assert.equal(porEmail.tarjeta.responsableId, "u-ana");
  const porId = await tableros.crearTarjeta(dueno, { tableroId: "tb1", titulo: "Dos", tipo: "Idea", responsable: "u-bruno" });
  assert.equal(porId.tarjeta.responsableId, "u-bruno");
  for (const vacio of [undefined, "", null, "   "]) {
    const sin = await tableros.crearTarjeta(dueno, { tableroId: "tb1", titulo: "Tres", tipo: "Idea", responsable: vacio });
    assert.equal(sin.tarjeta.responsableId, null);
    assert.equal(sin.tarjeta.responsableNombre, null);
    assert.ok(!("responsableId" in ultimo().despues), "el historial de siempre queda igual");
    assert.ok(!("responsableNombre" in ultimo().despues));
  }
});

await prueba("editar: asignar y quitar dejan la línea en el historial con antes y despues (id y nombre)", async () => {
  tarjeta("c1");
  const a = await tableros.editarTarjeta(dueno, "c1", { responsable: "Bruno" });
  assert.equal(a.tarjeta.responsableId, "u-bruno");
  assert.equal(a.tarjeta.responsableNombre, "Bruno Ruiz");
  assert.equal(de("c1").responsableId, "u-bruno");
  assert.deepEqual(ultimo().antes, { responsableId: null, responsableNombre: null });
  assert.deepEqual(ultimo().despues, { responsableId: "u-bruno", responsableNombre: "Bruno Ruiz" });
  assert.equal(ultimo().accion, "editar");

  const cambia = await tableros.editarTarjeta(dueno, "c1", { responsable: "ana@x.co" });
  assert.equal(cambia.tarjeta.responsableNombre, "Ana Pérez");
  assert.deepEqual(ultimo().antes, { responsableId: "u-bruno", responsableNombre: "Bruno Ruiz" });
  assert.deepEqual(ultimo().despues, { responsableId: "u-ana", responsableNombre: "Ana Pérez" });

  const quita = await tableros.editarTarjeta(dueno, "c1", { responsable: "" });
  assert.equal(quita.tarjeta.responsableId, null);
  assert.equal(quita.tarjeta.responsableNombre, null);
  assert.equal(de("c1").responsableId, null);
  assert.deepEqual(ultimo().antes, { responsableId: "u-ana", responsableNombre: "Ana Pérez" });
  assert.deepEqual(ultimo().despues, { responsableId: null, responsableNombre: null });
});

await prueba("editar: quitar con null también funciona; repetir lo mismo da 'No hay nada distinto'", async () => {
  tarjeta("c1", { responsableId: "u-bruno" });
  await tableros.editarTarjeta(dueno, "c1", { responsable: null });
  assert.equal(de("c1").responsableId, null);
  await rechaza(tableros.editarTarjeta(dueno, "c1", { responsable: null }), /No hay nada distinto/);
  await tableros.editarTarjeta(dueno, "c1", { responsable: "Bruno" });
  await rechaza(tableros.editarTarjeta(dueno, "c1", { responsable: "Bruno" }), /No hay nada distinto/);
});

await prueba("asignar mezclado con otros cambios: todos quedan en UNA fila del historial", async () => {
  tarjeta("c1");
  await tableros.editarTarjeta(dueno, "c1", { titulo: "Nuevo título", responsable: "Bruno" });
  assert.equal(de("c1").titulo, "Nuevo título");
  assert.equal(de("c1").responsableId, "u-bruno");
  assert.equal(estado.historial.length, 1);
  assert.equal(ultimo().despues.titulo, "Nuevo título");
  assert.equal(ultimo().despues.responsableId, "u-bruno");
});

/* ------------------------------------------------------------------ asignar no toca la aprobación */

seccion("asignar no cambia el estado ni aprueba");

await prueba("MCP: asignar NO cambia una tarjeta APROBADA; editar otro campo SÍ la devuelve a POR_APROBAR", async () => {
  tarjeta("c1", { estado: "APROBADO", repo: "aizencrm", riesgo: "ALTO", riesgoPor: "CLAUDE" });
  const a = await tableros.editarTarjeta(dueno, "c1", { responsable: "Bruno" });
  assert.equal(a.tarjeta.estado, "APROBADO");
  assert.equal(de("c1").estado, "APROBADO");
  assert.equal(a.volvioAPorAprobar, false);
  assert.equal(a.perdioAprobacion, false);
  assert.ok(!("estado" in ultimo().antes) && !("estado" in ultimo().despues), "el historial no anota un cambio de estado");

  // Quitarlo tampoco la mueve.
  await tableros.editarTarjeta(dueno, "c1", { responsable: "" });
  assert.equal(de("c1").estado, "APROBADO");

  // Editar el título sí le quita la aprobación (regla de siempre).
  const b = await tableros.editarTarjeta(dueno, "c1", { titulo: "Otro título" });
  assert.equal(b.tarjeta.estado, "POR_APROBAR");
  assert.equal(b.volvioAPorAprobar, true);
  assert.equal(de("c1").estado, "POR_APROBAR");
  assert.deepEqual(ultimo().antes.estado, "APROBADO");
});

await prueba("MCP: asignar y editar otro campo a la vez sí reinicia la aprobación", async () => {
  tarjeta("c1", { estado: "APROBADO", repo: "aizencrm", riesgo: "ALTO", riesgoPor: "CLAUDE" });
  const r = await tableros.editarTarjeta(dueno, "c1", { responsable: "Bruno", detalle: "Más detalle" });
  assert.equal(r.tarjeta.estado, "POR_APROBAR");
  assert.equal(de("c1").responsableId, "u-bruno");
});

await prueba("asignar no aprueba solo una tarjeta POR_APROBAR (ni crea fila de aprobación)", async () => {
  tarjeta("c1", { estado: "POR_APROBAR", repo: "aizencrm", riesgo: "ALTO", riesgoPor: "CLAUDE" });
  const r = await tableros.editarTarjeta(dueno, "c1", { responsable: "Bruno" });
  assert.equal(r.tarjeta.estado, "POR_APROBAR");
  assert.equal(de("c1").estado, "POR_APROBAR");
  assert.equal(estado.historial.filter((h) => h.accion === "aprobar").length, 0);
  // Una tarjeta nueva POR_APROBAR con responsable tampoco se aprueba sola.
  const nueva = await tableros.crearTarjeta(dueno, { tableroId: "tb1", titulo: "Algo", tipo: "Tarea", estado: "POR_APROBAR", responsable: "Bruno" });
  assert.equal(nueva.tarjeta.estado, "POR_APROBAR");
});

await prueba("asignar no aprueba sola una tarjeta POR_APROBAR de riesgo BAJO, ni toca su riesgo aunque el texto parezca de riesgo alto", async () => {
  tarjeta("c1", { estado: "POR_APROBAR", repo: "aizencrm", riesgo: "BAJO", riesgoPor: "CLAUDE", detalle: "Cambiar el envío de mensajes a clientes" });
  const r = await tableros.editarTarjeta(dueno, "c1", { responsable: "Bruno" });
  assert.equal(r.aprobacionAutomatica, null);
  assert.equal(de("c1").estado, "POR_APROBAR");
  assert.equal(de("c1").riesgo, "BAJO", "asignar no recalcula el riesgo");
  assert.equal(estado.historial.filter((h) => h.accion === "aprobar").length, 0);
});

await prueba("el Coordinador tiene la tarjeta (PLANEANDO / EN_CURSO con repo): asignar se permite, editar otro campo no", async () => {
  for (const [id, enCurso] of [["c1", "EN_CURSO"], ["c2", "PLANEANDO"], ["c3", "SUBIENDO"]]) {
    tarjeta(id, { estado: enCurso, repo: "aizencrm", riesgo: "ALTO", riesgoPor: "CLAUDE" });
    await rechaza(tableros.editarTarjeta(dueno, id, { titulo: "Cambio" }), /Coordinador tiene esta tarjeta/);
    await rechaza(tableros.editarTarjeta(dueno, id, { responsable: "Bruno", titulo: "Cambio" }), /Coordinador tiene esta tarjeta/);
    const r = await tableros.editarTarjeta(dueno, id, { responsable: "Bruno" });
    assert.equal(r.tarjeta.estado, enCurso, `${enCurso} no cambia`);
    assert.equal(de(id).responsableId, "u-bruno");
    assert.equal(de(id).titulo, `Tarjeta ${id}`, "el título quedó como estaba");
  }
});

/* ------------------------------------------------------------------ a quién se puede asignar */

seccion("a quién se puede asignar");

await prueba("no se asigna a alguien inactivo, de otro negocio o que no existe; la tarjeta no cambia", async () => {
  tarjeta("c1");
  await rechaza(tableros.editarTarjeta(dueno, "c1", { responsable: "Inés" }), /no es una persona activa de este negocio/);
  await rechaza(tableros.editarTarjeta(dueno, "c1", { responsable: "inactivo@x.co" }), /no es una persona activa/);
  await rechaza(tableros.editarTarjeta(dueno, "c1", { responsable: "u-inactivo" }), /no es una persona activa/);
  await rechaza(tableros.editarTarjeta(dueno, "c1", { responsable: "Olga" }), /no es una persona activa/);
  await rechaza(tableros.editarTarjeta(dueno, "c1", { responsable: "otro@x.co" }), /no es una persona activa/);
  await rechaza(tableros.editarTarjeta(dueno, "c1", { responsable: "u-otro" }), /no es una persona activa/);
  await rechaza(tableros.editarTarjeta(dueno, "c1", { responsable: "Nadie Existe" }), /no es una persona activa/);
  assert.equal(de("c1").responsableId, null);
  assert.equal(estado.historial.length, 0);
  // Los mensajes dicen "responsables", no "dueños".
  await rechaza(tableros.editarTarjeta(dueno, "c1", { responsable: "Olga" }), /Pueden ser responsables: .*Bruno Ruiz/);
  // Al crear pasa lo mismo y no deja tarjeta a medias.
  const antes = estado.tarjetas.size;
  await rechaza(tableros.crearTarjeta(dueno, { tableroId: "tb1", titulo: "X", tipo: "Idea", responsable: "Olga" }), /no es una persona activa/);
  assert.equal(estado.tarjetas.size, antes);
});

await prueba("un nombre ambiguo da error y pide el email", async () => {
  tarjeta("c1");
  await rechaza(tableros.editarTarjeta(dueno, "c1", { responsable: "Ana" }), /Hay más de una persona así: .*Ana Pérez \(ana@x\.co\).*Ana Gómez \(ana2@x\.co\).*Usa el email/);
  assert.equal(de("c1").responsableId, null);
  await rechaza(tableros.crearTarjeta(dueno, { tableroId: "tb1", titulo: "X", tipo: "Idea", responsable: "Ana" }), /Usa el email/);
  // Con el nombre completo o el email sí.
  await tableros.editarTarjeta(dueno, "c1", { responsable: "Ana Gómez" });
  assert.equal(de("c1").responsableId, "u-ana2");
  await tableros.editarTarjeta(dueno, "c1", { responsable: "ana@x.co" });
  assert.equal(de("c1").responsableId, "u-ana");
});

/* ------------------------------------------------------------------ deshacer */

seccion("deshacer");

await prueba("deshacer devuelve el responsable anterior (y queda la fila 'deshacer')", async () => {
  tarjeta("c1");
  await tableros.editarTarjeta(dueno, "c1", { responsable: "ana@x.co" });
  const cambioAna = ultimo().id;
  await tableros.editarTarjeta(dueno, "c1", { responsable: "Bruno" });
  const cambioBruno = ultimo().id;
  assert.equal(de("c1").responsableId, "u-bruno");

  // El primero no se puede deshacer mientras haya otro más nuevo sobre lo mismo.
  await rechaza(tableros.deshacerCambioTarjeta(dueno, cambioAna), /otro cambio sobre lo mismo/);

  await tableros.deshacerCambioTarjeta(dueno, cambioBruno);
  assert.equal(de("c1").responsableId, "u-ana");
  assert.equal(ultimo().accion, "deshacer");
  assert.equal(ultimo().antes.responsableId, "u-bruno");
  assert.equal(ultimo().antes.responsableNombre, "Bruno Ruiz");
  assert.equal(ultimo().despues.responsableId, "u-ana");
  assert.equal(estado.historial.find((h) => h.id === cambioBruno).deshechoEn instanceof Date, true);

  await tableros.deshacerCambioTarjeta(dueno, cambioAna);
  assert.equal(de("c1").responsableId, null, "el primer deshacer devuelve a 'sin responsable'");
});

await prueba("deshacer no cambia el estado de una tarjeta APROBADA", async () => {
  tarjeta("c1", { estado: "APROBADO", repo: "aizencrm", riesgo: "ALTO", riesgoPor: "CLAUDE" });
  await tableros.editarTarjeta(dueno, "c1", { responsable: "Bruno" });
  await tableros.deshacerCambioTarjeta(dueno, ultimo().id);
  assert.equal(de("c1").responsableId, null);
  assert.equal(de("c1").estado, "APROBADO");
});

await prueba("deshacer falla claro si quien era responsable ya no es una persona activa", async () => {
  tarjeta("c1");
  await tableros.editarTarjeta(dueno, "c1", { responsable: "ana@x.co" });
  await tableros.editarTarjeta(dueno, "c1", { responsable: "Bruno" });
  const cambioBruno = ultimo().id;
  estado.miembros.find((m) => m.userId === "u-ana" && m.workspaceId === "ws1").isActive = false;
  await rechaza(
    tableros.deshacerCambioTarjeta(dueno, cambioBruno),
    /Quien era responsable antes ya no es una persona activa del negocio: no se puede deshacer\. Asigna a alguien con editar_tarjeta/,
  );
  assert.equal(de("c1").responsableId, "u-bruno", "la tarjeta quedó como estaba");
  assert.equal(estado.historial.find((h) => h.id === cambioBruno).deshechoEn, null, "el cambio no se marcó como deshecho");
  // Y para quitar a Bruno siempre se puede con editar.
  await tableros.editarTarjeta(dueno, "c1", { responsable: "" });
  assert.equal(de("c1").responsableId, null);
});

await prueba("deshacer el 'crear' con responsable sigue quitando la tarjeta", async () => {
  const r = await tableros.crearTarjeta(dueno, { tableroId: "tb1", titulo: "Pasajera", tipo: "Idea", responsable: "Bruno" });
  await tableros.deshacerCambioTarjeta(dueno, r.cambioId);
  assert.equal(estado.tarjetas.has(r.tarjeta.id), false);
});

/* ------------------------------------------------------------------ asignadas a mí */

seccion("asignadas a mí");

await prueba("asignadasA trae tarjetas de varios tableros, excluye HECHO y borradas, y no las de otras personas ni negocios", async () => {
  tarjeta("a1", { tableroId: "tb1", responsableId: "u-ana", estado: "IDEA", titulo: "En ventas" });
  tarjeta("a2", { tableroId: "tb2", responsableId: "u-ana", estado: "APROBADO", titulo: "En el de Ana" });
  tarjeta("a3", { tableroId: "tb1", responsableId: "u-ana", estado: "HECHO", titulo: "Ya hecha" });
  tarjeta("a4", { tableroId: "tb1", responsableId: "u-ana", estado: "IDEA", borradoEn: new Date(), titulo: "Borrada" });
  tarjeta("a5", { tableroId: "tb1", responsableId: "u-bruno", estado: "IDEA", titulo: "De Bruno" });
  tarjeta("a6", { tableroId: "tb1", responsableId: null, estado: "IDEA", titulo: "De nadie" });
  tarjeta("a7", { tableroId: "tb3", responsableId: "u-ana", estado: "IDEA", titulo: "Otro negocio" });
  tarjeta("a8", { tableroId: "tb1", tipo: "area", responsableId: "u-ana", titulo: "Carpeta mía" });

  const mias = await tableros.asignadasA(ana, "u-ana");
  assert.deepEqual(mias.map((t) => t.id).sort(), ["a1", "a2", "a8"]);
  const a1 = mias.find((t) => t.id === "a1");
  assert.deepEqual(
    { tableroId: a1.tableroId, tableroNombre: a1.tableroNombre, tipoNombre: a1.tipoNombre, usaEstados: a1.usaEstados, estado: a1.estado },
    { tableroId: "tb1", tableroNombre: "Ventas", tipoNombre: "Tarea", usaEstados: true, estado: "IDEA" },
  );
  assert.equal(mias.find((t) => t.id === "a8").usaEstados, false, "una carpeta no tiene estado");

  // Ana ve solo sus tableros: el link "ir al tablero" solo en el suyo (tb2).
  assert.equal(mias.find((t) => t.id === "a1").puedeVerElTablero, false);
  assert.equal(mias.find((t) => t.id === "a2").puedeVerElTablero, true);
  // El dueño del negocio (soloDe null) ve todos los tableros de su negocio.
  const delDueno = await tableros.asignadasA(dueno, "u-ana");
  assert.deepEqual(delDueno.map((t) => t.id).sort(), ["a1", "a2", "a8"]);
  assert.ok(delDueno.every((t) => t.puedeVerElTablero));
  // Lo mismo, para otra persona.
  assert.deepEqual((await tableros.asignadasA(ana, "u-bruno")).map((t) => t.id), ["a5"]);
  assert.deepEqual(await tableros.asignadasA(ana, "u-nadie"), []);
});

await prueba("asignadasA: las más recientes primero", async () => {
  tarjeta("v1", { responsableId: "u-ana", actualizadoEn: new Date("2026-10-01T00:00:00Z") });
  tarjeta("v2", { responsableId: "u-ana", actualizadoEn: new Date("2026-10-20T00:00:00Z") });
  tarjeta("v3", { responsableId: "u-ana", actualizadoEn: new Date("2026-10-10T00:00:00Z") });
  assert.deepEqual((await tableros.asignadasA(ana, "u-ana")).map((t) => t.id), ["v2", "v3", "v1"]);
});

/* ------------------------------------------------------------------ la persona asignada, sin acceso al tablero */

seccion("la persona asignada, en un tablero ajeno");

await prueba("historialDeTarjeta e intentosDeLaTarjeta: lee SOLO la tarjeta que tiene asignada", async () => {
  tarjeta("mia", { tableroId: "tb1", responsableId: "u-ana", titulo: "La mía" });
  tarjeta("otra", { tableroId: "tb1", responsableId: "u-bruno", titulo: "De Bruno" });
  tarjeta("sinDueno", { tableroId: "tb1", titulo: "Sin responsable" });
  tarjeta("deOtroNegocio", { tableroId: "tb3", responsableId: "u-ana", titulo: "Ajena" });
  estado.historial.push({ id: "hx", tarjetaId: "mia", quien: "u-dueno", origen: "MCP", accion: "crear", antes: null, despues: { titulo: "La mía" }, deshechoEn: null, creadoEn: ahora() });
  estado.intentos.push({ id: "i1", tarjetaId: "mia", numero: 1, creadoEn: ahora(), resumen: "Primer intento" });
  estado.intentos.push({ id: "i2", tarjetaId: "otra", numero: 1, creadoEn: ahora(), resumen: "Intento ajeno" });

  const h = await tableros.historialDeTarjeta(ana, "mia");
  assert.equal(h.tarjeta.id, "mia");
  assert.equal(h.tarjeta.responsableNombre, "Ana Pérez");
  assert.equal(h.cambios.length, 1);
  assert.equal(h.cambios[0].quienNombre, "Alex Dueño");
  const intentos = await tableros.intentosDeLaTarjeta(ana, "mia");
  assert.equal(intentos.length, 1);
  assert.equal(intentos[0].resumen, "Primer intento");

  for (const id of ["otra", "sinDueno", "deOtroNegocio"]) {
    await rechaza(tableros.historialDeTarjeta(ana, id), /No existe esa tarjeta/);
    await rechaza(tableros.intentosDeLaTarjeta(ana, id), /No existe esa tarjeta/);
  }
  // Una tarjeta suya pero de otro negocio nunca se lee.
  await rechaza(tableros.historialDeTarjeta({ ...ana, workspaceId: "ws2" }, "mia"), /No existe esa tarjeta/);
  // Y sin sesión de esa persona (otra Ana), tampoco.
  await rechaza(tableros.historialDeTarjeta({ ...ana, soloDe: "u-ana2", userId: "u-ana2" }, "mia"), /No existe esa tarjeta/);
});

await prueba("la persona asignada lee también la tarjeta borrada que tenía asignada (historial con borradas)", async () => {
  tarjeta("mia", { tableroId: "tb1", responsableId: "u-ana", borradoEn: new Date() });
  const h = await tableros.historialDeTarjeta(ana, "mia");
  assert.equal(h.borrada, true);
});

await prueba("la persona asignada NO puede editarla, ni asignar, ni crear, ni deshacer en el tablero ajeno", async () => {
  tarjeta("mia", { tableroId: "tb1", responsableId: "u-ana" });
  await tableros.editarTarjeta(dueno, "mia", { titulo: "Título del dueño" });
  const cambioDelDueno = ultimo().id;

  await rechaza(tableros.editarTarjeta(ana, "mia", { titulo: "Lo cambio yo" }), /No existe esa tarjeta/);
  await rechaza(tableros.editarTarjeta(ana, "mia", { responsable: "" }), /No existe esa tarjeta/);
  await rechaza(tableros.editarTarjeta(ana, "mia", { responsable: "Bruno" }), /No existe esa tarjeta/);
  await rechaza(tableros.crearTarjeta(ana, { tableroId: "tb1", titulo: "Intruso", tipo: "Idea", responsable: "Ana Pérez" }), /No existe ese tablero/);
  await rechaza(tableros.deshacerCambioTarjeta(ana, cambioDelDueno), /No existe ese cambio/);
  await rechaza(tableros.borrarTarjeta(ana, "mia"), /No existe esa tarjeta/);
  assert.equal(de("mia").titulo, "Título del dueño");
  assert.equal(de("mia").responsableId, "u-ana");
});

await prueba("en SU propio tablero la persona sí asigna (puede editar el tablero)", async () => {
  tarjeta("propia", { tableroId: "tb2" });
  await tableros.editarTarjeta(ana, "propia", { responsable: "Bruno" });
  assert.equal(de("propia").responsableId, "u-bruno");
  assert.equal(reglas.puedeAsignarResponsable(ana.soloDe, estado.tableros.get("tb2").duenoUserId), true);
  assert.equal(reglas.puedeAsignarResponsable(ana.soloDe, estado.tableros.get("tb1").duenoUserId), false);
});

await prueba("tarjetaAsignada: devuelve la ficha solo si la tarjeta es de esa persona y de ese negocio", async () => {
  tarjeta("mia", { tableroId: "tb1", responsableId: "u-ana", titulo: "La mía" });
  tarjeta("otra", { tableroId: "tb1", responsableId: "u-bruno" });
  tarjeta("sinDueno", { tableroId: "tb1" });
  tarjeta("deOtroNegocio", { tableroId: "tb3", responsableId: "u-ana" });
  tarjeta("borrada", { tableroId: "tb1", responsableId: "u-ana", borradoEn: new Date() });

  const ficha = await tableros.tarjetaAsignada("ws1", "u-ana", "mia");
  assert.equal(ficha.tarjeta.id, "mia");
  assert.equal(ficha.tarjeta.responsableNombre, "Ana Pérez");
  // (El prisma falso no aplica `select`: en la base real solo salen id y nombre del tablero.)
  assert.equal(ficha.tablero.id, "tb1");
  assert.equal(ficha.tablero.nombre, "Ventas");
  assert.deepEqual(ficha.tipos.map((t) => t.nombre), ["Área", "Idea", "Tarea"], "solo los tipos del tablero, para dibujarla");
  assert.ok(!("tarjetas" in ficha), "nunca el resto del tablero");

  assert.equal(await tableros.tarjetaAsignada("ws1", "u-ana", "otra"), null);
  assert.equal(await tableros.tarjetaAsignada("ws1", "u-ana", "sinDueno"), null);
  assert.equal(await tableros.tarjetaAsignada("ws1", "u-ana", "deOtroNegocio"), null);
  assert.equal(await tableros.tarjetaAsignada("ws2", "u-ana", "mia"), null);
  assert.equal(await tableros.tarjetaAsignada("ws1", "u-ana", "borrada"), null);
  assert.equal(await tableros.tarjetaAsignada("ws1", "u-ana", "no-existe"), null);
  assert.equal(await tableros.tarjetaAsignada("ws1", "u-bruno", "mia"), null);
});

await prueba("la persona asignada no puede aprobar si no es aprobadora", async () => {
  tarjeta("mia", { tableroId: "tb1", responsableId: "u-ana", estado: "POR_APROBAR", repo: "aizencrm", riesgo: "ALTO", riesgoPor: "CLAUDE" });
  tarjeta("propia", { tableroId: "tb2", responsableId: "u-ana", estado: "POR_APROBAR", repo: "aizencrm", riesgo: "ALTO", riesgoPor: "CLAUDE" });
  const pedido = { momento: "tarea", via: "pantalla" };
  // En un tablero ajeno ni siquiera la alcanza para escribir.
  await rechaza(tableros.aprobarTarjeta(ana, "mia", pedido), /No existe esa tarjeta/);
  // Aun en su propio tablero, aprobar es de quien aprueba (no basta ser la responsable).
  await rechaza(tableros.aprobarTarjeta(ana, "propia", pedido), (fallo) => {
    assert.ok(fallo instanceof Error);
    assert.doesNotMatch(fallo.message, /No existe/);
    return true;
  });
  assert.equal(de("mia").estado, "POR_APROBAR");
  assert.equal(de("propia").estado, "POR_APROBAR");
  assert.equal(estado.historial.filter((h) => h.accion === "aprobar").length, 0);
  // El dueño del negocio sí (control: la regla no se rompió para quien debe poder).
  const ok = await tableros.aprobarTarjeta(duenoPantalla, "mia", pedido);
  assert.equal(ok.ahora, "APROBADO");
  assert.equal(de("mia").responsableId, "u-ana", "aprobar no toca al responsable");
});

/* ------------------------------------------------------------------ el MCP */

seccion("MCP");

const contextoMcp = { workspaceId: "ws1", userId: "u-dueno" };
const llamar = (nombre, args) => mcp.ejecutarHerramientaMcpTableros(nombre, args, contextoMcp);

await prueba("esquema: crear_tarjeta, editar_tarjeta y ver_tablero tienen la propiedad responsable (texto) y no abren el esquema", async () => {
  for (const nombre of ["crear_tarjeta", "editar_tarjeta", "ver_tablero"]) {
    const herramienta = mcp.HERRAMIENTAS_MCP_TABLEROS.find((h) => h.name === nombre);
    assert.ok(herramienta, nombre);
    assert.equal(herramienta.inputSchema.properties.responsable.type, "string", nombre);
    assert.ok(herramienta.inputSchema.properties.responsable.description.length > 20, nombre);
    assert.equal(herramienta.inputSchema.additionalProperties, false, nombre);
    assert.ok(!herramienta.inputSchema.required.includes("responsable"), `${nombre}: es opcional`);
  }
  const editar = mcp.HERRAMIENTAS_MCP_TABLEROS.find((h) => h.name === "editar_tarjeta");
  assert.match(editar.inputSchema.properties.responsable.description, /Vacío para quitar/);
  assert.match(editar.description, /responsable/);
});

await prueba("MCP: crear_tarjeta con responsable lo devuelve y lo guarda; sin responsable devuelve null", async () => {
  const r = await llamar("crear_tarjeta", { tablero_id: "tb1", titulo: "Llamar al proveedor", tipo: "Idea", responsable: "Bruno" });
  assert.equal(r.ok, true);
  assert.equal(r.responsable, "Bruno Ruiz");
  assert.equal(de(r.tarjeta_id).responsableId, "u-bruno");
  assert.equal(ultimo().origen, "MCP");
  const sin = await llamar("crear_tarjeta", { tablero_id: "tb1", titulo: "Sin nadie", tipo: "Idea" });
  assert.equal(sin.responsable, null);
  await rechaza(llamar("crear_tarjeta", { tablero_id: "tb1", titulo: "Mal", tipo: "Idea", responsable: "Olga" }), /no es una persona activa/);
});

await prueba("MCP: editar_tarjeta asigna, cambia y quita con \"\"; un nombre ambiguo da error", async () => {
  tarjeta("c1", { estado: "APROBADO", repo: "aizencrm", riesgo: "ALTO", riesgoPor: "CLAUDE" });
  const a = await llamar("editar_tarjeta", { tarjeta_id: "c1", responsable: "ana@x.co" });
  assert.equal(a.ok, true);
  assert.equal(a.responsable, "Ana Pérez");
  assert.equal(a.estado, "APROBADO", "asignar no la devuelve a POR_APROBAR");
  assert.equal(de("c1").responsableId, "u-ana");

  const b = await llamar("editar_tarjeta", { tarjeta_id: "c1", responsable: "Bruno" });
  assert.equal(b.responsable, "Bruno Ruiz");

  await rechaza(llamar("editar_tarjeta", { tarjeta_id: "c1", responsable: "Ana" }), /Hay más de una persona así.*Usa el email/);
  assert.equal(de("c1").responsableId, "u-bruno");

  const c = await llamar("editar_tarjeta", { tarjeta_id: "c1", responsable: "" });
  assert.equal(c.responsable, null);
  assert.equal(de("c1").responsableId, null);
  assert.equal(de("c1").estado, "APROBADO");
});

await prueba("MCP: ver_tablero devuelve responsable en cada tarjeta y filtra por responsable", async () => {
  tarjeta("t1", { responsableId: "u-bruno", titulo: "De Bruno", estado: "IDEA", tipo: "idea" });
  tarjeta("t2", { responsableId: "u-ana", titulo: "De Ana", estado: "POR_APROBAR", tipo: "tarea" });
  tarjeta("t3", { titulo: "De nadie", estado: "IDEA", tipo: "idea" });
  tarjeta("t4", { responsableId: "u-bruno", titulo: "Otra de Bruno", estado: "POR_APROBAR", tipo: "tarea" });
  tarjeta("t5", { titulo: "Borrada de Bruno", responsableId: "u-bruno", borradoEn: new Date() });

  const todo = await llamar("ver_tablero", { tablero_id: "tb1" });
  assert.equal(todo.total_tarjetas, 4);
  const porId = (r, id) => r.tarjetas.find((t) => t.tarjeta_id === id);
  assert.equal(porId(todo, "t1").responsable, "Bruno Ruiz");
  assert.equal(porId(todo, "t2").responsable, "Ana Pérez");
  assert.equal(porId(todo, "t3").responsable, null);

  const deBruno = await llamar("ver_tablero", { tablero_id: "tb1", responsable: "Bruno" });
  assert.deepEqual(deBruno.tarjetas.map((t) => t.tarjeta_id).sort(), ["t1", "t4"]);
  assert.equal(deBruno.total_tarjetas, 4, "el total sigue siendo el del tablero");
  const porEmail = await llamar("ver_tablero", { tablero_id: "tb1", responsable: "ana@x.co" });
  assert.deepEqual(porEmail.tarjetas.map((t) => t.tarjeta_id), ["t2"]);

  const combinado = await llamar("ver_tablero", { tablero_id: "tb1", responsable: "Bruno", estado: "POR_APROBAR" });
  assert.deepEqual(combinado.tarjetas.map((t) => t.tarjeta_id), ["t4"]);

  const deNadie = await llamar("ver_tablero", { tablero_id: "tb1", responsable: "Bruno", estado: "HECHO" });
  assert.deepEqual(deNadie.tarjetas, []);

  await rechaza(llamar("ver_tablero", { tablero_id: "tb1", responsable: "Ana" }), /Hay más de una persona así/);
  await rechaza(llamar("ver_tablero", { tablero_id: "tb1", responsable: "Olga" }), /no es una persona activa/);
  // Filtro vacío = sin filtro.
  const vacio = await llamar("ver_tablero", { tablero_id: "tb1", responsable: "" });
  assert.equal(vacio.tarjetas.length, 4);
});

await prueba("MCP: ver_tablero con filtro por responsable solo trae las flechas que tocan sus tarjetas", async () => {
  tarjeta("t1", { responsableId: "u-bruno", tipo: "idea" });
  tarjeta("t2", { tipo: "idea" });
  tarjeta("t3", { tipo: "idea" });
  estado.conexiones.push(
    { id: "f1", tableroId: "tb1", origenId: "t1", destinoId: "t2", esDependencia: false },
    { id: "f2", tableroId: "tb1", origenId: "t2", destinoId: "t3", esDependencia: false },
  );
  const sinFiltro = await llamar("ver_tablero", { tablero_id: "tb1" });
  assert.equal(sinFiltro.conexiones.length, 2);
  const r = await llamar("ver_tablero", { tablero_id: "tb1", responsable: "Bruno" });
  assert.deepEqual(r.tarjetas.map((t) => t.tarjeta_id), ["t1"]);
  assert.deepEqual(r.conexiones.map((c) => [c.de, c.a]), [["t1", "t2"]]);
});

console.log(`\n${pruebas} pruebas pasaron`);
