import assert from "node:assert/strict";
import test from "node:test";

import {
  borrarRespuestaRapida,
  crearRespuestasRapidas,
  editarRespuestaRapida,
  FILTRO_SIN_REPARTIR,
  listarRespuestasRapidas,
  type DbRespuestasRapidas,
  type QuienPide,
} from "./respuestas-rapidas";

// ---- Base falsa en memoria: solo lo que usa src/lib/respuestas-rapidas.ts ----

type Fila = { id: string; workspaceId: string; duenaId: string | null; title: string; content: string; createdAt: number };
type Miembro = { workspaceId: string; userId: string; isActive: boolean };
type Usuario = { id: string; name: string | null; email: string };

type Where = Record<string, unknown>;

function coincide(valor: unknown, condicion: unknown): boolean {
  if (condicion && typeof condicion === "object") {
    const c = condicion as { in?: unknown[]; not?: unknown };
    if ("in" in c) return (c.in ?? []).includes(valor);
    if ("not" in c) return valor !== c.not;
  }
  return valor === condicion;
}
const cumple = (fila: Record<string, unknown>, where: Where = {}) =>
  Object.entries(where).every(([clave, condicion]) => coincide(fila[clave], condicion));

function baseFalsa() {
  const usuarios: Usuario[] = [
    { id: "dueno", name: "Alexander", email: "dueno@x.co" },
    { id: "yair", name: "Yair", email: "yair@x.co" },
    { id: "maria", name: "María Camila", email: "maria@x.co" },
    { id: "retirada", name: "Laura", email: "laura@x.co" },
    { id: "otra-ws", name: "De otro negocio", email: "otro@x.co" },
    { id: "ex", name: null, email: "ex@x.co" },
  ];
  const miembros: Miembro[] = [
    { workspaceId: "ws1", userId: "dueno", isActive: true },
    { workspaceId: "ws1", userId: "yair", isActive: true },
    { workspaceId: "ws1", userId: "maria", isActive: true },
    { workspaceId: "ws1", userId: "retirada", isActive: false },
    { workspaceId: "ws2", userId: "otra-ws", isActive: true },
  ];
  let reloj = 0;
  const filas: Fila[] = [
    { id: "r-yair", workspaceId: "ws1", duenaId: "yair", title: "Saludo Yair", content: "Hola, soy Yair", createdAt: reloj++ },
    { id: "r-maria", workspaceId: "ws1", duenaId: "maria", title: "Saludo María", content: "Hola, soy María", createdAt: reloj++ },
    { id: "r-vieja", workspaceId: "ws1", duenaId: null, title: "Precios", content: "Lista de precios", createdAt: reloj++ },
    { id: "r-retirada", workspaceId: "ws1", duenaId: "retirada", title: "Envío", content: "Envío gratis", createdAt: reloj++ },
    { id: "r-ex", workspaceId: "ws1", duenaId: "ex", title: "Garantía", content: "Garantía de un año", createdAt: reloj++ },
    { id: "r-ws2", workspaceId: "ws2", duenaId: "otra-ws", title: "Ajena", content: "De otro negocio", createdAt: reloj++ },
  ];
  let siguiente = 1;
  let fallarCreateMany = false;

  const pick = <T extends Record<string, unknown>>(fila: T, select?: Record<string, unknown>) =>
    select ? Object.fromEntries(Object.keys(select).map((clave) => [clave, fila[clave]])) : { ...fila };

  const db = {
    quickReply: {
      findMany: async ({ where, select, distinct }: { where?: Where; select?: Record<string, unknown>; distinct?: string[] }) => {
        let salida = filas.filter((fila) => cumple(fila, where)).sort((a, b) => a.createdAt - b.createdAt);
        if (distinct?.length) {
          const vistos = new Set<string>();
          salida = salida.filter((fila) => {
            const llave = distinct.map((campo) => String((fila as Record<string, unknown>)[campo])).join("|");
            if (vistos.has(llave)) return false;
            vistos.add(llave);
            return true;
          });
        }
        return salida.map((fila) => pick(fila, select));
      },
      findFirst: async ({ where, select }: { where?: Where; select?: Record<string, unknown> }) => {
        const fila = filas.find((f) => cumple(f, where));
        return fila ? pick(fila, select) : null;
      },
      createMany: async ({ data }: { data: Omit<Fila, "id" | "createdAt">[] }) => {
        if (fallarCreateMany) throw new Error("la base no responde");
        for (const d of data) filas.push({ ...d, id: `nueva-${siguiente++}`, createdAt: reloj++ });
        return { count: data.length };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Fila> }) => {
        const fila = filas.find((f) => f.id === where.id);
        if (!fila) throw new Error("no existe");
        Object.assign(fila, data);
        return fila;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const i = filas.findIndex((f) => f.id === where.id);
        if (i < 0) throw new Error("no existe");
        return filas.splice(i, 1)[0];
      },
    },
    workspaceMember: {
      findMany: async ({ where, select }: { where?: Where; select?: Record<string, unknown> }) =>
        miembros
          .filter((m) => cumple(m, where))
          .map((m) => {
            const user = usuarios.find((u) => u.id === m.userId)!;
            const base = pick(m, select);
            return select && "user" in select ? { ...base, user: { name: user.name, email: user.email } } : base;
          }),
    },
    user: {
      findMany: async ({ where }: { where?: Where }) => usuarios.filter((u) => cumple(u, where)),
    },
  };
  return {
    db: db as unknown as DbRespuestasRapidas,
    filas,
    fallarAlCrear: () => {
      fallarCreateMany = true;
    },
  };
}

const asesora = (userId: string, membershipRole = "AGENT"): QuienPide => ({
  userId,
  workspaceId: "ws1",
  isOwner: false,
  role: "EMPLEADO",
  membershipRole,
});
const dueno: QuienPide = { userId: "dueno", workspaceId: "ws1", isOwner: true, role: "CLIENTE", membershipRole: "OWNER" };
const administrador: QuienPide = { userId: "admin", workspaceId: "ws1", isOwner: false, role: "CLIENTE", membershipRole: "ADMIN" };
const datos = { title: "Nueva", content: "Texto nuevo" };
const ids = (lista: { id: string }[]) => lista.map((x) => x.id);

// ---- Asesora ----

test("la asesora lista solo las suyas, aunque pida otro filtro", async () => {
  const { db } = baseFalsa();
  for (const filtro of [undefined, "todas", "maria", FILTRO_SIN_REPARTIR]) {
    const lista = await listarRespuestasRapidas(db, asesora("yair"), filtro);
    assert.deepEqual(ids(lista.items), ["r-yair"], `filtro ${filtro}`);
    assert.equal(lista.esJefe, false);
    assert.deepEqual(lista.asesoras, [], "a la asesora no le llega la lista de asesoras");
  }
  assert.deepEqual(ids((await listarRespuestasRapidas(db, asesora("maria"))).items), ["r-maria"]);
});

test("la asesora no ve las «Sin repartir»", async () => {
  const { db } = baseFalsa();
  const lista = await listarRespuestasRapidas(db, asesora("yair"), FILTRO_SIN_REPARTIR);
  assert.ok(!ids(lista.items).includes("r-vieja"));
});

test("la asesora no puede editar ni borrar las de otra ni las «Sin repartir»", async () => {
  const { db, filas } = baseFalsa();
  for (const id of ["r-maria", "r-vieja", "r-ws2"]) {
    assert.equal((await editarRespuestaRapida(db, asesora("yair"), id, datos)).error, "Respuesta rápida no encontrada");
    assert.equal((await borrarRespuestaRapida(db, asesora("yair"), id)).error, "Respuesta rápida no encontrada");
  }
  assert.equal(filas.find((f) => f.id === "r-maria")?.title, "Saludo María");
  assert.ok(filas.some((f) => f.id === "r-vieja"));
  // Las suyas sí.
  assert.deepEqual(await editarRespuestaRapida(db, asesora("yair"), "r-yair", datos), { success: true });
  assert.equal(filas.find((f) => f.id === "r-yair")?.title, "Nueva");
  assert.deepEqual(await borrarRespuestaRapida(db, asesora("yair"), "r-yair"), { success: true });
  assert.ok(!filas.some((f) => f.id === "r-yair"));
});

test("lo que la asesora mande como dueña se ignora al crear y al editar", async () => {
  const { db, filas } = baseFalsa();
  const creada = await crearRespuestasRapidas(db, asesora("yair"), datos, ["maria", "dueno"]);
  assert.deepEqual(creada, { creadas: 1 });
  const nuevas = filas.filter((f) => f.title === "Nueva");
  assert.equal(nuevas.length, 1);
  assert.equal(nuevas[0].duenaId, "yair");

  assert.deepEqual(await editarRespuestaRapida(db, asesora("yair"), "r-yair", datos, "maria"), { success: true });
  assert.equal(filas.find((f) => f.id === "r-yair")?.duenaId, "yair");
});

test("una supervisora que no es administradora se trata como asesora", async () => {
  const { db } = baseFalsa();
  const supervisora = asesora("maria", "SUPERVISORA");
  const lista = await listarRespuestasRapidas(db, supervisora, "todas");
  assert.equal(lista.esJefe, false);
  assert.deepEqual(ids(lista.items), ["r-maria"]);
  assert.equal((await borrarRespuestaRapida(db, supervisora, "r-yair")).error, "Respuesta rápida no encontrada");
});

// ---- Jefe (dueño y administradores) ----

test("el jefe lista todas con el nombre de la dueña y filtra por asesora y por «Sin repartir»", async () => {
  const { db } = baseFalsa();
  const todas = await listarRespuestasRapidas(db, dueno);
  assert.equal(todas.esJefe, true);
  assert.deepEqual(ids(todas.items), ["r-yair", "r-maria", "r-vieja", "r-retirada", "r-ex"], "nunca las de otro negocio");
  assert.equal(todas.items.find((i) => i.id === "r-yair")?.duenaNombre, "Yair");
  assert.equal(todas.items.find((i) => i.id === "r-vieja")?.duenaNombre, null);
  assert.equal(todas.items.find((i) => i.id === "r-ex")?.duenaNombre, "ex@x.co");

  assert.deepEqual(ids((await listarRespuestasRapidas(db, dueno, "yair")).items), ["r-yair"]);
  assert.deepEqual(ids((await listarRespuestasRapidas(db, administrador, FILTRO_SIN_REPARTIR)).items), ["r-vieja"]);
  assert.deepEqual(ids((await listarRespuestasRapidas(db, administrador, "otra-ws")).items), [], "filtro de otro negocio: nada");
});

test("el filtro del jefe incluye a las retiradas que aún tienen respuestas", async () => {
  const { db, filas } = baseFalsa();
  const lista = await listarRespuestasRapidas(db, dueno);
  assert.deepEqual(
    lista.asesoras.map((a) => [a.id, a.activa]),
    [
      ["dueno", true],
      ["maria", true],
      ["yair", true],
      ["ex", false],
      ["retirada", false],
    ],
  );
  // Si la retirada ya no tiene respuestas, sale del filtro.
  filas.splice(filas.findIndex((f) => f.id === "r-retirada"), 1);
  const sinRetirada = await listarRespuestasRapidas(db, dueno);
  assert.ok(!sinRetirada.asesoras.some((a) => a.id === "retirada"));
});

test("el jefe crea una copia por asesora marcada, sin repetidas", async () => {
  const { db, filas } = baseFalsa();
  const creada = await crearRespuestasRapidas(db, dueno, datos, ["yair", "maria", "yair", " ", ""]);
  assert.deepEqual(creada, { creadas: 2 });
  const nuevas = filas.filter((f) => f.title === "Nueva");
  assert.deepEqual(nuevas.map((f) => f.duenaId).sort(), ["maria", "yair"]);
  assert.ok(nuevas.every((f) => f.workspaceId === "ws1" && f.content === "Texto nuevo"));
  // Y le aparece a Yair y no a María Camila... cada una ve solo su copia.
  const deYair = await listarRespuestasRapidas(db, asesora("yair"));
  assert.equal(deYair.items.filter((i) => i.title === "Nueva").length, 1);
});

test("con cero asesoras marcadas devuelve error y no guarda", async () => {
  const { db, filas } = baseFalsa();
  const antes = filas.length;
  for (const marcadas of [undefined, [], ["", "  "]]) {
    assert.equal((await crearRespuestasRapidas(db, dueno, datos, marcadas)).error, "Marca al menos una asesora.");
  }
  assert.equal(filas.length, antes);
});

test("todas o ninguna: una asesora no válida entre las marcadas no guarda ninguna", async () => {
  const { db, filas } = baseFalsa();
  const antes = filas.length;
  for (const mala of ["otra-ws", "retirada", "no-existe"]) {
    const resultado = await crearRespuestasRapidas(db, dueno, datos, ["yair", mala]);
    assert.ok(resultado.error, `debería rechazar ${mala}`);
  }
  assert.equal(filas.length, antes);
});

test("una dueña de otro negocio o inactiva se rechaza cuando la dueña cambia", async () => {
  const { db, filas } = baseFalsa();
  for (const mala of ["otra-ws", "retirada", "no-existe"]) {
    const resultado = await editarRespuestaRapida(db, dueno, "r-yair", datos, mala);
    assert.ok(resultado.error, `debería rechazar ${mala}`);
  }
  assert.deepEqual(filas.find((f) => f.id === "r-yair")?.title, "Saludo Yair", "no guarda nada si la dueña no es válida");
  // A una activa sí.
  assert.deepEqual(await editarRespuestaRapida(db, dueno, "r-vieja", datos, "maria"), { success: true });
  assert.equal(filas.find((f) => f.id === "r-vieja")?.duenaId, "maria");
});

test("editar solo el título conserva la dueña, aunque esté retirada o vacía", async () => {
  const { db, filas } = baseFalsa();
  assert.deepEqual(await editarRespuestaRapida(db, dueno, "r-retirada", { title: "Envío 2", content: "Envío gratis" }, "retirada"), {
    success: true,
  });
  assert.equal(filas.find((f) => f.id === "r-retirada")?.duenaId, "retirada");
  assert.deepEqual(await editarRespuestaRapida(db, dueno, "r-vieja", { title: "Precios 2", content: "Lista" }, ""), { success: true });
  assert.equal(filas.find((f) => f.id === "r-vieja")?.duenaId, null);
  assert.deepEqual(await editarRespuestaRapida(db, dueno, "r-yair", { title: "Hola", content: "Hola" }, null), { success: true });
  assert.equal(filas.find((f) => f.id === "r-yair")?.duenaId, "yair");
  // Pasar una que ya tiene dueña a "Sin repartir" no se permite.
  assert.ok((await editarRespuestaRapida(db, dueno, "r-yair", datos, "")).error);
  assert.equal(filas.find((f) => f.id === "r-yair")?.duenaId, "yair");
});

test("el jefe no toca respuestas de otro negocio", async () => {
  const { db, filas } = baseFalsa();
  assert.equal((await editarRespuestaRapida(db, dueno, "r-ws2", datos, "yair")).error, "Respuesta rápida no encontrada");
  assert.equal((await borrarRespuestaRapida(db, dueno, "r-ws2")).error, "Respuesta rápida no encontrada");
  assert.ok(filas.some((f) => f.id === "r-ws2" && f.duenaId === "otra-ws"));
});

test("si la base falla al crear, el error sube para que la acción devuelva un aviso", async () => {
  const { db, fallarAlCrear } = baseFalsa();
  fallarAlCrear();
  await assert.rejects(() => crearRespuestasRapidas(db, dueno, datos, ["yair"]), /la base no responde/);
});
