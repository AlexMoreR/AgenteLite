// Pruebas de «Organizar áreas» del Tablero IA (24-nov-2026) con un prisma FALSO en memoria:
//  1. Qué tipo es el Área del tablero (el llamado «Área»; si no, el primero sin estados; si no, ninguno).
//  2. La lista de áreas con sus hijas vivas contadas (de cualquier tipo, sin las borradas).
//  3. No se borra un área con tarjetas adentro; una vacía sí (borrado suave, con historial).
//  4. Mover: se rechaza un ciclo (meter un área dentro de su propia hija); mover a otra área la deja de última.
//  5. Subir y bajar: el orden nuevo de las hermanas, escribiendo solo las que cambian.
// Carga el services/areas.ts REAL y el services/tableros.ts REAL (crearTarjeta, editarTarjeta, borrarTarjeta).
// No necesita base ni red. Correr: npm run test:tablero-organizar-areas
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

/* ------------------------------------------------------------------ prisma falso */

const DbNull = Symbol("DbNull");
const estado = {
  usuarios: new Map(),
  negocios: new Map(),
  miembros: [],
  tableros: new Map(),
  tipos: new Map(),
  tarjetas: new Map(),
  historial: [],
  contador: 0,
  reloj: Date.parse("2026-11-24T12:00:00Z"),
};

const ahora = () => new Date((estado.reloj += 1000));
const siguiente = (prefijo) => `${prefijo}${(estado.contador += 1)}`;

const OPERADORES = ["not", "in", "notIn", "isEmpty"];
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
      if (clave === "notIn") return !x.includes(valor);
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
const tipoVista = (t) => (t ? { ...t, padres: t.padres.map((tipoPadreId) => ({ tipoPadreId })) } : null);
const hidratarTarjeta = (t) =>
  t
    ? {
        ...t,
        tablero: hidratarTablero(estado.tableros.get(t.tableroId)),
        responsable: t.responsableId ? persona(t.responsableId) : null,
      }
    : null;

const ordenar = (filas, orderBy) => {
  const reglas = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []).map((regla) => Object.entries(regla)[0]);
  const valor = (x) => (x instanceof Date ? x.getTime() : x);
  return [...filas].sort((a, b) => {
    for (const [campo, sentido] of reglas) {
      const x = valor(a[campo]);
      const y = valor(b[campo]);
      if (x !== y) return (x < y ? -1 : 1) * (sentido === "desc" ? -1 : 1);
    }
    return 0;
  });
};

const tarjetasQue = (where) => [...estado.tarjetas.values()].filter((t) => coincide(hidratarTarjeta(t), where));
const tablerosQue = (where) => [...estado.tableros.values()].filter((t) => coincide(hidratarTablero(t), where));

/** Las escrituras de tarjetas (para ver que ordenar escribe solo las que cambian). */
const escrituras = [];

const falso = {
  tarjetaTablero: {
    findFirst: async ({ where }) => hidratarTarjeta(tarjetasQue(where)[0]),
    findUnique: async ({ where }) => hidratarTarjeta(estado.tarjetas.get(where.id)),
    findUniqueOrThrow: async ({ where }) => hidratarTarjeta(estado.tarjetas.get(where.id)),
    findMany: async ({ where, orderBy }) => ordenar(tarjetasQue(where).map(hidratarTarjeta), orderBy),
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
      const fila = tarjetaCruda(siguiente("nueva-"), {});
      Object.assign(fila, data);
      estado.tarjetas.set(fila.id, fila);
      return hidratarTarjeta(fila);
    },
    updateMany: async ({ where, data }) => {
      const dentro = tarjetasQue(where);
      for (const t of dentro) {
        escrituras.push({ id: t.id, data });
        for (const [campo, valor] of Object.entries(data)) t[campo] = valor === DbNull ? null : valor;
        t.actualizadoEn = ahora();
      }
      return { count: dentro.length };
    },
  },
  historialTarjeta: {
    create: async ({ data }) => {
      const fila = { id: siguiente("h"), creadoEn: ahora(), ...data };
      estado.historial.push(fila);
      return { id: fila.id };
    },
  },
  conexionTarjeta: {
    findMany: async () => [],
    deleteMany: async () => ({ count: 0 }),
  },
  alertaInterna: { findMany: async () => [], updateMany: async () => ({ count: 0 }) },
  tableroInteligente: {
    findFirst: async ({ where }) => hidratarTablero(tablerosQue(where)[0]),
    update: async ({ where, data = {} }) => hidratarTablero(Object.assign(estado.tableros.get(where.id), data)),
  },
  tipoTarjeta: {
    findMany: async ({ where }) =>
      [...estado.tipos.values()].filter((t) => coincide(t, where)).sort((a, b) => a.orden - b.orden).map(tipoVista),
  },
  workspaceMember: {
    findMany: async ({ where }) => estado.miembros.filter((m) => coincide(m, where)).map((m) => ({ ...m, user: persona(m.userId) })),
    findFirst: async ({ where }) => estado.miembros.find((m) => coincide(m, where)) ?? null,
  },
  user: { findUnique: async ({ where }) => persona(where.id) },
  workspace: {
    findUnique: async ({ where }) => {
      const negocio = estado.negocios.get(where.id);
      return negocio ? { ownerId: negocio.ownerId, owner: persona(negocio.ownerId) } : null;
    },
  },
  aprobadorTablero: { findUnique: async () => null },
  // Sin tableros archivados, y "Aprobar tareas solo" apagado (acá no hay tareas con repo).
  appSetting: {
    findUnique: async ({ where }) => (where.key.startsWith("tablero:tareas-solas:") ? { key: where.key, value: "false" } : null),
  },
  $queryRawUnsafe: async () => [],
  $transaction: async (fn) => fn(falso),
};

const mocks = {
  "@/lib/prisma": { prisma: falso },
  "@prisma/client": { Prisma: { DbNull } },
};

const areas = cargar("src/features/tableros-inteligentes/services/areas.ts", mocks);

/* ------------------------------------------------------------------ datos de partida */

function tarjetaCruda(id, extra) {
  const { tableroId = "tb1", tipo, ...resto } = extra;
  return {
    id,
    numero: null,
    tableroId,
    titulo: `Tarjeta ${id}`,
    detalle: "",
    area: null,
    estado: "IDEA",
    orden: 0,
    fecha: null,
    tipoId: tipo ? `${tableroId}-${tipo}` : null,
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
    prioridad: "MEDIA",
    borradoEn: null,
    archivadaEn: null,
    terminadaEn: null,
    creadoPor: "u-dueno",
    creadoEn: ahora(),
    actualizadoEn: ahora(),
    ...resto,
  };
}

/** Una tarjeta ya guardada. `tipo`: "area", "idea" o "tarea". */
function tarjeta(id, tipo, extra = {}) {
  const fila = tarjetaCruda(id, { tipo, ...extra });
  estado.tarjetas.set(id, fila);
  return fila;
}

function tipo(tableroId, clave, nombre, { usaEstados = true, requiereAprobacion = false, orden = 0, padres = [] } = {}) {
  estado.tipos.set(`${tableroId}-${clave}`, {
    id: `${tableroId}-${clave}`,
    tableroId,
    nombre,
    color: "#6366f1",
    icono: null,
    requiereAprobacion,
    usaEstados,
    orden,
    padres: padres.map((p) => `${tableroId}-${p}`),
    creadoEn: ahora(),
  });
}

function tablero(id, duenoUserId = "u-dueno") {
  estado.tableros.set(id, { id, workspaceId: "ws1", duenoUserId, nombre: `Tablero ${id}`, creadoEn: ahora(), actualizadoEn: ahora() });
}

function sembrar() {
  for (const mapa of [estado.usuarios, estado.negocios, estado.tableros, estado.tipos, estado.tarjetas]) mapa.clear();
  estado.miembros.length = 0;
  estado.historial.length = 0;
  escrituras.length = 0;
  estado.usuarios.set("u-dueno", { id: "u-dueno", name: "Alex Dueño", email: "dueno@x.co", role: "CLIENTE" });
  estado.usuarios.set("u-ana", { id: "u-ana", name: "Ana Pérez", email: "ana@x.co", role: "CLIENTE" });
  estado.negocios.set("ws1", { ownerId: "u-dueno" });
  estado.miembros.push({ workspaceId: "ws1", userId: "u-dueno", isActive: true, role: "OWNER" });
  estado.miembros.push({ workspaceId: "ws1", userId: "u-ana", isActive: true, role: "MEMBER" });
  // El tablero de siempre: Área (dentro de Área), Idea (dentro de Área) y Tarea (dentro de Idea o de Área).
  tablero("tb1");
  tipo("tb1", "area", "Área", { usaEstados: false, orden: 0, padres: ["area"] });
  tipo("tb1", "idea", "Idea", { orden: 1, padres: ["area"] });
  tipo("tb1", "tarea", "Tarea", { requiereAprobacion: true, orden: 2, padres: ["idea", "area"] });
}

const dueno = { workspaceId: "ws1", soloDe: null, userId: "u-dueno", origen: "PANTALLA" };
const ana = { workspaceId: "ws1", soloDe: "u-ana", userId: "u-ana", origen: "PANTALLA" };
const de = (id) => estado.tarjetas.get(id);

let pruebas = 0;
async function prueba(nombre, fn) {
  sembrar();
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}
const seccion = (titulo) => console.log(`\n# ${titulo}`);

/* ------------------------------------------------------------------ 1. el tipo Área */

seccion("el tipo Área del tablero");

await prueba("elige el tipo llamado «Área» aunque otro sin estados vaya antes por orden", async () => {
  const tipos = [
    { id: "carpeta", nombre: "Carpeta", usaEstados: false, orden: 0 },
    { id: "idea", nombre: "Idea", usaEstados: true, orden: 1 },
    { id: "area", nombre: "area", usaEstados: false, orden: 5 },
  ];
  assert.equal(areas.tipoAreaDelTablero(tipos)?.id, "area");
});

await prueba("sin «Área», el primer tipo sin estados por orden", async () => {
  const tipos = [
    { id: "idea", nombre: "Idea", usaEstados: true, orden: 0 },
    { id: "zona", nombre: "Zona", usaEstados: false, orden: 4 },
    { id: "carpeta", nombre: "Carpeta", usaEstados: false, orden: 2 },
  ];
  assert.equal(areas.tipoAreaDelTablero(tipos)?.id, "carpeta");
});

await prueba("sin ningún tipo sin estados: null, la lista sale vacía y crear da un error claro", async () => {
  const tipos = [
    { id: "idea", nombre: "Idea", usaEstados: true, orden: 0 },
    { id: "tarea", nombre: "Tarea", usaEstados: true, orden: 1 },
  ];
  assert.equal(areas.tipoAreaDelTablero(tipos), null);
  tablero("tb2");
  tipo("tb2", "idea", "Idea", { orden: 0 });
  tarjeta("i1", "idea", { tableroId: "tb2" });
  const lista = await areas.listarAreas(dueno, "tb2");
  assert.equal(lista.tipoArea, null);
  assert.deepEqual(lista.areas, []);
  await assert.rejects(areas.crearArea(dueno, "tb2", "Ventas", null), { message: areas.SIN_TIPO_AREA });
  assert.equal(estado.tarjetas.size, 1, "no se creó nada");
});

/* ------------------------------------------------------------------ 2. la lista */

seccion("la lista de áreas");

await prueba("cada área viva con su madre, su orden y sus hijas vivas de cualquier tipo", async () => {
  tarjeta("a", "area", { titulo: "Ventas", orden: 1 });
  tarjeta("b", "area", { titulo: "Pauta", padreId: "a" });
  tarjeta("c", "area", { titulo: "Bodega", orden: 0 });
  tarjeta("idea-a", "idea", { padreId: "a" });
  tarjeta("tarea-b", "tarea", { padreId: "b", estado: "POR_APROBAR" });
  tarjeta("borrada-a", "idea", { padreId: "a", borradoEn: new Date() });
  tarjeta("area-borrada", "area", { titulo: "Vieja", borradoEn: new Date() });
  const lista = await areas.listarAreas(dueno, "tb1");
  assert.deepEqual(lista.tipoArea, { id: "tb1-area", nombre: "Área" });
  assert.deepEqual(lista.areas, [
    { id: "b", titulo: "Pauta", padreId: "a", orden: 0, hijasVivas: 1 },
    { id: "c", titulo: "Bodega", padreId: null, orden: 0, hijasVivas: 0 },
    { id: "a", titulo: "Ventas", padreId: null, orden: 1, hijasVivas: 2 },
  ]);
});

await prueba("un tablero ajeno responde que no existe", async () => {
  tarjeta("a", "area");
  await assert.rejects(areas.listarAreas(ana, "tb1"), /No existe ese tablero/);
  await assert.rejects(areas.renombrarArea(ana, "a", "Otra"), /No existe esa área/);
});

/* ------------------------------------------------------------------ crear, renombrar */

seccion("crear y renombrar");

await prueba("crear un área la deja de última entre sus hermanas, con el tipo Área", async () => {
  tarjeta("a", "area", { orden: 3 });
  const { tarjeta: nueva } = await areas.crearArea(dueno, "tb1", "  Postventa ", null);
  assert.equal(nueva.titulo, "Postventa");
  assert.equal(nueva.tipoId, "tb1-area");
  assert.equal(nueva.orden, 4);
  const { tarjeta: hija } = await areas.crearArea(dueno, "tb1", "Garantías", nueva.id);
  assert.equal(hija.padreId, nueva.id);
  assert.equal(hija.orden, 0);
});

await prueba("no se crea un área dentro de algo que no es un área", async () => {
  tarjeta("idea", "idea");
  await assert.rejects(areas.crearArea(dueno, "tb1", "Nueva", "idea"), /no es un área/);
});

await prueba("renombrar cambia el título; una Idea no se renombra como área", async () => {
  tarjeta("a", "area", { titulo: "Ventas" });
  tarjeta("idea", "idea");
  await areas.renombrarArea(dueno, "a", "Ventas y pauta");
  assert.equal(de("a").titulo, "Ventas y pauta");
  await assert.rejects(areas.renombrarArea(dueno, "idea", "Otra"), /no es un área/);
});

/* ------------------------------------------------------------------ 3. borrar */

seccion("borrar");

await prueba("no se borra un área con tarjetas adentro", async () => {
  tarjeta("a", "area", { titulo: "Ventas" });
  tarjeta("b", "area", { padreId: "a" });
  tarjeta("idea", "idea", { padreId: "a" });
  tarjeta("vieja", "idea", { padreId: "a", borradoEn: new Date() });
  await assert.rejects(areas.borrarArea(dueno, "a"), /^Error: Tiene 2 tarjetas adentro/);
  assert.equal(de("a").borradoEn, null);
  await assert.rejects(areas.borrarArea(dueno, "b").then(() => areas.borrarArea(dueno, "a")), /^Error: Tiene 1 tarjeta adentro/);
});

await prueba("un área vacía se borra (suave, con su historial) y una Idea no se borra por acá", async () => {
  tarjeta("a", "area");
  tarjeta("idea", "idea");
  const borrada = await areas.borrarArea(dueno, "a");
  assert.ok(de("a").borradoEn instanceof Date);
  assert.ok(estado.historial.some((h) => h.id === borrada.cambioId && h.accion === "borrar" && h.tarjetaId === "a"));
  await assert.rejects(areas.borrarArea(dueno, "idea"), /no es un área/);
  assert.equal(de("idea").borradoEn, null);
});

/* ------------------------------------------------------------------ 4. mover */

seccion("mover");

await prueba("meter un área dentro de su propia hija se rechaza (ciclo)", async () => {
  tarjeta("a", "area");
  tarjeta("b", "area", { padreId: "a" });
  tarjeta("c", "area", { padreId: "b" });
  await assert.rejects(areas.moverArea(dueno, "a", "c"), /ciclo/);
  await assert.rejects(areas.moverArea(dueno, "a", "a"), /madre de sí misma/);
  assert.equal(de("a").padreId, null);
});

await prueba("mover a otra área la deja de última ahí; a la raíz con null", async () => {
  tarjeta("a", "area");
  tarjeta("a1", "area", { padreId: "a", orden: 7 });
  tarjeta("c", "area", { orden: 2 });
  await areas.moverArea(dueno, "c", "a");
  assert.equal(de("c").padreId, "a");
  assert.equal(de("c").orden, 8);
  await areas.moverArea(dueno, "c", null);
  assert.equal(de("c").padreId, null);
  assert.equal(de("c").orden, 1, "de última en la raíz, después de «a» (orden 0)");
  await assert.rejects(areas.moverArea(dueno, "c", null), /No hay nada distinto/);
});

await prueba("no se mueve un área dentro de una Idea", async () => {
  tarjeta("a", "area");
  tarjeta("idea", "idea");
  await assert.rejects(areas.moverArea(dueno, "a", "idea"), /no es un área/);
});

/* ------------------------------------------------------------------ 5. subir y bajar */

seccion("subir y bajar");

await prueba("ordenAlMover: cambia de lugar con la vecina y devuelve solo las que cambian", async () => {
  const hermanas = [
    { id: "x", orden: 0 },
    { id: "y", orden: 1 },
    { id: "z", orden: 2 },
  ];
  assert.deepEqual(areas.ordenAlMover(hermanas, "z", "subir"), [
    { id: "z", orden: 1 },
    { id: "y", orden: 2 },
  ]);
  assert.deepEqual(areas.ordenAlMover(hermanas, "x", "bajar"), [
    { id: "y", orden: 0 },
    { id: "x", orden: 1 },
  ]);
  assert.deepEqual(areas.ordenAlMover(hermanas, "x", "subir"), [], "ya está de primera");
  assert.deepEqual(areas.ordenAlMover(hermanas, "z", "bajar"), [], "ya está de última");
});

await prueba("bajar y subir con órdenes empatados: queda 0, 1, 2 y se escriben solo las que cambian", async () => {
  tarjeta("x", "area", { titulo: "X" });
  tarjeta("y", "area", { titulo: "Y" });
  tarjeta("z", "area", { titulo: "Z" });
  tarjeta("dentro", "area", { padreId: "x" });
  await areas.bajarArea(dueno, "x");
  assert.deepEqual(["x", "y", "z"].map((id) => de(id).orden), [1, 0, 2]);
  assert.deepEqual(escrituras.map((e) => e.id).sort(), ["x", "z"], "«y» ya tenía orden 0");
  assert.ok(escrituras.every((e) => Object.keys(e.data).join() === "orden"), "ordenar solo escribe el orden");
  const lista = await areas.listarAreas(dueno, "tb1");
  assert.deepEqual(lista.areas.filter((a) => a.padreId === null).map((a) => a.id), ["y", "x", "z"]);
  escrituras.length = 0;
  await areas.subirArea(dueno, "z");
  assert.deepEqual(["y", "z", "x"].map((id) => de(id).orden), [0, 1, 2]);
  assert.deepEqual(escrituras.map((e) => e.id).sort(), ["x", "z"]);
  assert.equal(de("dentro").orden, 0, "las de otra madre no se tocan");
  await assert.rejects(areas.subirArea(dueno, "y"), /ya está de primera/);
  await assert.rejects(areas.bajarArea(dueno, "x"), /ya está de última/);
  await assert.rejects(areas.ordenarArea(dueno, "x", "al fondo"), /subir.*bajar/);
});

console.log(`\n${pruebas} pruebas, todas bien`);
