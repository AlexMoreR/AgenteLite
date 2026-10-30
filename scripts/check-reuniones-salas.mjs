// Revisa las salas fijas de Reuniones (src/features/reuniones/servicios/salas.ts) con una base falsa:
// el link fijo sale del nombre (con -2 si se repite) y no cambia al renombrar, el líder termina las
// reuniones de su sala y no las de otra, solo el dueño o un admin administran salas, y al entrar se usa
// la reunión abierta de la sala o se crea una nueva con salaFijaId y el "Sin grabar" de la sala.
// Correr: node scripts/check-reuniones-salas.mjs
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

let casos = 0;
async function prueba(nombre, fn) {
  await fn();
  casos += 1;
  console.log(`ok - ${nombre}`);
}

// ── Base falsa en memoria ─────────────────────────────────────────────────────────────────────────
const base = { salas: [], reuniones: [], miembros: [], negocios: [{ id: "ws1", ownerId: "alex" }, { id: "ws2", ownerId: "otro" }], bloqueos: [] };
let siguiente = 0;
const nuevoId = (prefijo) => `${prefijo}${(siguiente += 1)}`;
const cumple = (fila, where = {}) =>
  Object.entries(where).every(([clave, valor]) => {
    if (valor && typeof valor === "object" && Array.isArray(valor.in)) return valor.in.includes(fila[clave]);
    return fila[clave] === valor;
  });
const elegir = (fila, select) => (select ? Object.fromEntries(Object.keys(select).map((clave) => [clave, fila[clave]])) : fila);

const prisma = {
  $transaction: async (fn) => fn(prisma),
  $executeRaw: async (partes, ...valores) => {
    base.bloqueos.push({ sql: partes.join("?"), valores });
    return 1;
  },
  workspace: { count: async ({ where }) => base.negocios.filter((fila) => cumple(fila, where)).length },
  workspaceMember: { count: async ({ where }) => base.miembros.filter((fila) => cumple(fila, where)).length },
  salaDeReuniones: {
    count: async ({ where }) => base.salas.filter((fila) => cumple(fila, where)).length,
    findUnique: async ({ where, select }) => {
      const sala = base.salas.find((fila) => cumple(fila, where));
      return sala ? elegir(sala, select) : null;
    },
    create: async ({ data, select }) => {
      const sala = { id: nuevoId("sala"), sinGrabar: false, liderId: null, ...data };
      base.salas.push(sala);
      return elegir(sala, select);
    },
    update: async ({ where, data }) => {
      const sala = base.salas.find((fila) => cumple(fila, where));
      Object.assign(sala, data);
      return sala;
    },
  },
  reunion: {
    count: async ({ where }) => base.reuniones.filter((fila) => cumple(fila, where)).length,
    findFirst: async ({ where, select }) => {
      const reunion = [...base.reuniones].reverse().find((fila) => cumple(fila, where));
      return reunion ? elegir(reunion, select) : null;
    },
    create: async ({ data, select }) => {
      const reunion = { id: nuevoId("r"), estado: "ESPERANDO", ...data };
      base.reuniones.push(reunion);
      return elegir(reunion, select);
    },
  },
};

// El acceso de cada usuario (lo que devuelve getClientWorkspaceAccessForUser).
const accesos = {
  alex: { userId: "alex", workspaceId: "ws1", isOwner: true, role: "ADMIN" },
  admin: { userId: "admin", workspaceId: "ws1", isOwner: false, role: "ADMIN" },
  emanuel: { userId: "emanuel", workspaceId: "ws1", isOwner: false, role: "ASESOR" },
  karen: { userId: "karen", workspaceId: "ws1", isOwner: false, role: "ASESOR" },
  ajeno: { userId: "ajeno", workspaceId: "ws2", isOwner: true, role: "ADMIN" },
};
base.miembros.push(
  { workspaceId: "ws1", userId: "admin", isActive: true },
  { workspaceId: "ws1", userId: "emanuel", isActive: true },
  { workspaceId: "ws1", userId: "karen", isActive: true },
);

const mocks = {
  "@/lib/prisma": { prisma },
  "@/lib/client-workspace-access": {
    getClientWorkspaceAccessForUser: async (userId) => accesos[userId] ?? null,
    canAccessClientModule: () => true,
  },
};
const { crearSala, editarSala, abrirOCrearReunionDeSala } = cargar("src/features/reuniones/servicios/salas.ts", mocks);
const { puedeTerminarLaReunion, puedeAdministrarSalas } = cargar("src/features/reuniones/servicios/permisos.ts", mocks);

// ── Pruebas ───────────────────────────────────────────────────────────────────────────────────────
let sistemas;
let ventas;

await prueba("el link fijo sale del nombre: «Sistemas - Emanuel» -> sistemas-emanuel", async () => {
  sistemas = await crearSala({ userId: "alex", workspaceId: "ws1", nombre: "  Sistemas -  Emanuel ", liderId: "emanuel" });
  assert.equal(sistemas.codigo, "sistemas-emanuel");
  const guardada = base.salas.find((sala) => sala.id === sistemas.id);
  assert.equal(guardada.nombre, "Sistemas - Emanuel");
  assert.equal(guardada.liderId, "emanuel");
  assert.equal(guardada.creadaPorId, "alex");
  assert.equal(guardada.sinGrabar, false);
});

await prueba("si el link ya existe sale con -2 (también si lo tiene una reunión suelta)", async () => {
  const otra = await crearSala({ userId: "admin", workspaceId: "ws1", nombre: "Sistemas - Emanuel" });
  assert.equal(otra.codigo, "sistemas-emanuel-2");
  base.reuniones.push({ id: "suelta", codigo: "ventas", estado: "LISTA", salaFijaId: null });
  ventas = await crearSala({ userId: "alex", workspaceId: "ws1", nombre: "Ventas", liderId: "karen", sinGrabar: true });
  assert.equal(ventas.codigo, "ventas-2");
});

await prueba("al renombrar la sala el link no cambia", async () => {
  const resultado = await editarSala({ userId: "alex", salaId: sistemas.id, nombre: "Sistemas" });
  assert.deepEqual(resultado, { ok: true });
  const guardada = base.salas.find((sala) => sala.id === sistemas.id);
  assert.equal(guardada.nombre, "Sistemas");
  assert.equal(guardada.codigo, "sistemas-emanuel");
});

await prueba("el nombre vacío y un líder de otro negocio se rechazan", async () => {
  assert.ok((await crearSala({ userId: "alex", workspaceId: "ws1", nombre: "   " })).error);
  assert.ok((await crearSala({ userId: "alex", workspaceId: "ws1", nombre: "X", liderId: "ajeno" })).error);
  assert.ok((await editarSala({ userId: "alex", salaId: sistemas.id, liderId: "ajeno" })).error);
});

await prueba("un usuario que no es dueño ni admin no pasa puedeAdministrarSalas (ni crea ni edita)", async () => {
  assert.equal(await puedeAdministrarSalas("karen", "ws1"), false);
  assert.equal(await puedeAdministrarSalas("emanuel", "ws1"), false);
  assert.equal(await puedeAdministrarSalas("nadie", "ws1"), false);
  assert.equal(await puedeAdministrarSalas("ajeno", "ws1"), false, "el dueño de otro negocio");
  assert.equal(await puedeAdministrarSalas("alex", "ws1"), true);
  assert.equal(await puedeAdministrarSalas("admin", "ws1"), true);
  const antes = base.salas.length;
  assert.deepEqual(await crearSala({ userId: "karen", workspaceId: "ws1", nombre: "Mía" }), { error: "No autorizado" });
  assert.equal(base.salas.length, antes);
  assert.deepEqual(await editarSala({ userId: "karen", salaId: sistemas.id, nombre: "Otra" }), { error: "No autorizado" });
});

await prueba("el líder puede terminar las reuniones de su sala y no las de otra sala", async () => {
  const deSistemas = { workspaceId: "ws1", creadaPorId: "alex", salaFija: { liderId: "emanuel" } };
  const deVentas = { workspaceId: "ws1", creadaPorId: "alex", salaFija: { liderId: "karen" } };
  assert.equal(await puedeTerminarLaReunion("emanuel", deSistemas), true);
  assert.equal(await puedeTerminarLaReunion("emanuel", deVentas), false);
  assert.equal(await puedeTerminarLaReunion("emanuel", { workspaceId: "ws1", creadaPorId: "alex", salaFija: null }), false);
  assert.equal(await puedeTerminarLaReunion("emanuel", { workspaceId: "ws1", creadaPorId: "alex" }), false);
  // Un líder de otro negocio nunca, aunque la sala lo diga.
  assert.equal(await puedeTerminarLaReunion("ajeno", { workspaceId: "ws1", creadaPorId: null, salaFija: { liderId: "ajeno" } }), false);
});

await prueba("nadie pierde lo que hoy puede: quien la creó, el dueño y el admin siguen terminándola", async () => {
  const deVentas = { workspaceId: "ws1", creadaPorId: "emanuel", salaFija: { liderId: "karen" } };
  assert.equal(await puedeTerminarLaReunion("emanuel", deVentas), true);
  assert.equal(await puedeTerminarLaReunion("alex", deVentas), true);
  assert.equal(await puedeTerminarLaReunion("admin", deVentas), true);
});

await prueba("sin reunión abierta se crea una nueva con salaFijaId y el «Sin grabar» de la sala", async () => {
  const nueva = await abrirOCrearReunionDeSala(ventas.id, "karen");
  assert.equal(nueva.creada, true);
  const guardada = base.reuniones.find((reunion) => reunion.id === nueva.id);
  assert.equal(guardada.salaFijaId, ventas.id);
  assert.equal(guardada.sinGrabar, true);
  assert.equal(guardada.workspaceId, "ws1");
  assert.equal(guardada.creadaPorId, "karen");
  assert.match(guardada.sala, /^reunion_[0-9a-f]{18}$/);
  assert.ok(guardada.titulo.startsWith("Ventas "), guardada.titulo);
  assert.ok(guardada.codigo.startsWith("ventas-"), guardada.codigo);
  // Toma el bloqueo por el id de la sala antes de buscar.
  const bloqueo = base.bloqueos.at(-1);
  assert.match(bloqueo.sql, /pg_advisory_xact_lock/);
  assert.deepEqual(bloqueo.valores, [ventas.id]);
});

await prueba("si la sala tiene una reunión Esperando o En vivo se devuelve esa", async () => {
  const total = base.reuniones.length;
  const primera = await abrirOCrearReunionDeSala(ventas.id, "alex");
  assert.equal(primera.creada, false);
  const abierta = base.reuniones.find((reunion) => reunion.id === primera.id);
  abierta.estado = "EN_VIVO";
  const segunda = await abrirOCrearReunionDeSala(ventas.id, "emanuel");
  assert.equal(segunda.id, primera.id);
  assert.equal(base.reuniones.length, total);
});

await prueba("cuando la reunión ya terminó se crea otra; la de otra sala no cuenta", async () => {
  base.reuniones.filter((reunion) => reunion.salaFijaId === ventas.id).forEach((reunion) => (reunion.estado = "LISTA"));
  const otra = await abrirOCrearReunionDeSala(ventas.id, "karen");
  assert.equal(otra.creada, true);
  const deSistemas = await abrirOCrearReunionDeSala(sistemas.id, "emanuel");
  assert.equal(deSistemas.creada, true);
  assert.notEqual(deSistemas.id, otra.id);
  const guardada = base.reuniones.find((reunion) => reunion.id === deSistemas.id);
  assert.equal(guardada.sinGrabar, false);
  assert.equal(guardada.salaFijaId, sistemas.id);
});

await prueba("una sala que no existe devuelve null", async () => {
  assert.equal(await abrirOCrearReunionDeSala("no-existe", "alex"), null);
});

console.log(`\n${casos} pruebas de las salas fijas OK`);
