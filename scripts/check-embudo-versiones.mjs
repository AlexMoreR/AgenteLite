// Pruebas de las versiones del embudo (Embudo 3): la foto, la huella, la V1, el chat marcado con su
// versión, la clave del combo y que un fallo no impida guardar el embudo. Sin base ni red.
// Correr: npm run test:embudo-versiones
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { cargar } from "./supervisor-cargar.mjs";

const requerir = createRequire(import.meta.url);
const { Prisma } = requerir("@prisma/client");

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const dominio = cargar("src/features/embudo/dominio/versiones.ts");

/* ------------------------------------------------------------------ base falsa en memoria */

const opciones = { activo: true, comboIds: [] };
const db = {
    versiones: [],
    marcas: [],
    stages: [
      { stage: "CIERRE", goal: "Cerrar", script: "Pedí los datos", stuckAfterMessages: null, followUps: [] },
      {
        stage: "PRESENTACION",
        goal: "Saludar",
        script: "Hola, bienvenida",
        stuckAfterMessages: null,
        followUps: [{ sortOrder: 0, timeType: "MINUTES", timeValue: 5, content: "¿Seguís ahí?", flowId: null, cancelOnActivity: true, isActive: true }],
      },
    ],
    productos: [
      { id: "p-camilla", name: "Camilla fija" },
      { id: "p-combo", name: "Combo Camilla" },
    ],
    caido: false,
    contador: 0,
};
function estadoInicial() {
  return {
    versiones: [],
    marcas: [],
    stages: [
      { stage: "CIERRE", goal: "Cerrar", script: "Pedí los datos", stuckAfterMessages: null, followUps: [] },
      {
        stage: "PRESENTACION",
        goal: "Saludar",
        script: "Hola, bienvenida",
        stuckAfterMessages: null,
        followUps: [{ sortOrder: 0, timeType: "MINUTES", timeValue: 5, content: "¿Seguís ahí?", flowId: null, cancelOnActivity: true, isActive: true }],
      },
    ],
    caido: false,
    contador: 0,
  };
}
const crearPrisma = () => {
  const unico = () => new Prisma.PrismaClientKnownRequestError("unico", { code: "P2002", clientVersion: "test" });
  const verificar = () => {
    if (db.caido) throw new Error("base caída");
  };
  const prisma = {
    productPlaybook: {
      findFirst: async ({ where }) => {
        verificar();
        return where.productId === "p-sin-embudo" ? null : { stages: db.stages };
      },
    },
    appSetting: { findUnique: async () => null },
    user: { findUnique: async () => ({ name: "Alex", email: "a@x.co" }) },
    product: { findMany: async () => db.productos },
    embudoVersion: {
      findFirst: async ({ where }) => {
        verificar();
        const lista = db.versiones
          .filter((v) => v.productId === where.productId && (where.numero === undefined || v.numero === where.numero))
          .sort((a, b) => b.numero - a.numero);
        return lista[0] ?? null;
      },
      findMany: async ({ where }) => {
        verificar();
        return db.versiones.filter((v) => v.productId === where.productId).sort((a, b) => b.numero - a.numero);
      },
      create: async ({ data }) => {
        verificar();
        if (db.versiones.some((v) => v.productId === data.productId && v.numero === data.numero)) throw unico();
        const fila = { id: `v${(db.contador += 1)}`, creadoEn: new Date(), ...data };
        db.versiones.push(fila);
        return fila;
      },
    },
    embudoChatVersion: {
      findUnique: async ({ where }) => db.marcas.find((m) => m.conversationId === where.conversationId) ?? null,
      create: async ({ data }) => {
        if (db.marcas.some((m) => m.conversationId === data.conversationId)) throw unico();
        db.marcas.push({ ...data });
      },
      count: async ({ where }) => db.marcas.filter((m) => m.versionId === where.versionId).length,
      groupBy: async () => [],
    },
  };
  return prisma;
};
const prismaFalso = crearPrisma();

/** Deja la base falsa como nueva y el servicio listo (el módulo se carga una sola vez). */
function crearBase(nuevas = {}) {
  Object.assign(db, estadoInicial());
  Object.assign(opciones, { activo: true, comboIds: [] }, nuevas);
  return { db, prisma: prismaFalso };
}

function cargarServicio(prisma) {
  return cargar("src/features/embudo/servicios/versiones.ts", {
    "@/lib/prisma": { prisma },
    "@/lib/etapas-quitadas": { leerEtapasQuitadas: async () => [] },
    "./config": {
      embudoActivo: async () => opciones.activo,
      leerConfigEmbudo: async () => ({ comboProductoIds: opciones.comboIds, comboAnuncioIds: [], comboTituloPatrones: [] }),
    },
  });
}

/* ------------------------------------------------------------------ dominio */

const etapas = [
  { stage: "CIERRE", goal: "Cerrar", script: "Pedí los datos" },
  {
    stage: "PRESENTACION",
    goal: "Saludar",
    script: "Hola, bienvenida",
    followUps: [{ sortOrder: 0, timeType: "MINUTES", timeValue: 5, content: "¿Seguís ahí?", flowId: null, cancelOnActivity: true, isActive: true }],
  },
];

await prueba("la foto trae bienvenida, pasos en orden, pasos quitados y seguimientos", () => {
  const foto = dominio.armarFoto(etapas, ["IDENTIFICACION"]);
  assert.equal(foto.bienvenida, "Hola, bienvenida");
  assert.deepEqual(foto.pasos.map((p) => p.paso), ["PRESENTACION", "CIERRE"]);
  assert.equal(foto.pasos[0].seguimientos[0].texto, "¿Seguís ahí?");
  assert.deepEqual(foto.pasosQuitados, ["IDENTIFICACION"]);
});

await prueba("el mismo contenido no pide versión nueva; un guion o un seguimiento distinto sí", () => {
  const base = dominio.huellaDeFoto(dominio.armarFoto(etapas));
  assert.equal(dominio.haceFaltaVersionNueva(dominio.huellaDeFoto(dominio.armarFoto([...etapas].reverse())), base), false);
  const otroGuion = etapas.map((e) => (e.stage === "CIERRE" ? { ...e, script: "Otro guion" } : e));
  assert.equal(dominio.haceFaltaVersionNueva(dominio.huellaDeFoto(dominio.armarFoto(otroGuion)), base), true);
  const otroSeguimiento = etapas.map((e) =>
    e.stage === "PRESENTACION" ? { ...e, followUps: [{ ...e.followUps[0], timeValue: 15 }] } : e,
  );
  assert.equal(dominio.haceFaltaVersionNueva(dominio.huellaDeFoto(dominio.armarFoto(otroSeguimiento)), base), true);
  assert.equal(dominio.haceFaltaVersionNueva(base, null), true);
});

await prueba("la clave del combo se traduce al producto correcto", () => {
  const productos = [{ id: "p-camilla", nombre: "Camilla fija" }, { id: "p-combo", nombre: "Combo Camilla" }];
  const sin = { comboProductoIds: [], comboAnuncioIds: [], comboTituloPatrones: [] };
  assert.equal(dominio.productoIdDeClave("combo-camilla", productos, sin), "p-combo");
  assert.equal(dominio.productoIdDeClave("combo-camilla", productos, { ...sin, comboProductoIds: ["p-camilla"] }), "p-camilla");
  assert.equal(dominio.productoIdDeClave("p-camilla", productos, sin), "p-camilla");
  assert.equal(dominio.productoIdDeClave("p-desconocido", productos, sin), null);
  assert.equal(dominio.productoIdDeClave("combo-camilla", [{ id: "a", nombre: "Camilla" }], sin), null);
  assert.equal(
    dominio.productoIdDeClave("combo-camilla", [{ id: "a", nombre: "Combo camilla 1" }, { id: "b", nombre: "Combo camilla 2" }], sin),
    null,
  );
  assert.equal(dominio.productoIdDeClave(null, productos, sin), null);
});

await prueba("elegirVersion da la vigente, marcada 'vigente'", () => {
  assert.deepEqual(dominio.elegirVersion([{ id: "a", numero: 1 }, { id: "c", numero: 3 }, { id: "b", numero: 2 }]), {
    versionId: "c",
    numero: 3,
    asignadaPor: "vigente",
  });
  assert.equal(dominio.elegirVersion([]), null);
});

/* ------------------------------------------------------------------ servicio */

await prueba("la V1 guarda lo de antes del cambio; el mismo contenido no crea otra; un cambio crea la V2", async () => {
  const { db, prisma } = crearBase();
  const svc = cargarServicio(prisma);
  const v1 = await svc.asegurarVersionInicial("ws", "p-camilla");
  assert.equal(v1.numero, 1);
  assert.equal(db.versiones[0].origen, "inicial");
  assert.equal(db.versiones[0].contenido.bienvenida, "Hola, bienvenida");
  // Se cambia el guion DESPUÉS de la V1: la V1 conserva el texto viejo.
  db.stages.find((s) => s.stage === "PRESENTACION").script = "Hola, texto nuevo";
  assert.equal(await svc.asegurarVersionInicial("ws", "p-camilla"), null, "la V1 no se repite");
  assert.equal(await svc.registrarVersionDelEmbudo({ workspaceId: "ws", productId: "p-camilla", origen: "pantalla", nota: "bienvenida nueva", quien: { id: "u1", nombre: "Alex" } }).then((v) => v.numero), 2);
  assert.equal(await svc.registrarVersionDelEmbudo({ workspaceId: "ws", productId: "p-camilla", origen: "pantalla" }), null, "idéntico: sin versión nueva");
  const vieja = await svc.leerVersion("ws", "p-camilla", 1);
  assert.equal(vieja.foto.bienvenida, "Hola, bienvenida");
  assert.equal(db.versiones[1].nota, "bienvenida nueva");
  assert.equal(db.versiones[1].quienNombre, "Alex");
});

await prueba("un chat ya marcado no cambia de versión aunque salga una V3", async () => {
  const { db, prisma } = crearBase();
  const svc = cargarServicio(prisma);
  await svc.asegurarVersionInicial("ws", "p-camilla");
  assert.equal(await svc.marcarVersionDelChat({ workspaceId: "ws", conversationId: "c1", productoClave: "p-camilla" }), true);
  assert.equal(db.marcas[0].numero, 1);
  assert.equal(db.marcas[0].asignadaPor, "vigente");
  db.stages[0].script = "V2";
  await svc.registrarVersionDelEmbudo({ workspaceId: "ws", productId: "p-camilla", origen: "mcp" });
  db.stages[0].script = "V3";
  await svc.registrarVersionDelEmbudo({ workspaceId: "ws", productId: "p-camilla", origen: "mcp" });
  assert.equal(await svc.marcarVersionDelChat({ workspaceId: "ws", conversationId: "c1", productoClave: "p-camilla" }), false);
  assert.equal(db.marcas.find((m) => m.conversationId === "c1").numero, 1);
  await svc.marcarVersionDelChat({ workspaceId: "ws", conversationId: "c2", productoClave: "p-camilla" });
  assert.equal(db.marcas.find((m) => m.conversationId === "c2").numero, 3);
});

await prueba("un chat sin producto, con producto desconocido o con el interruptor apagado queda sin versión", async () => {
  const { db, prisma } = crearBase();
  const svc = cargarServicio(prisma);
  assert.equal(await svc.marcarVersionDelChat({ workspaceId: "ws", conversationId: "c1", productoClave: null }), false);
  assert.equal(await svc.marcarVersionDelChat({ workspaceId: "ws", conversationId: "c2", productoClave: "p-no-existe" }), false);
  opciones.activo = false;
  assert.equal(await svc.marcarVersionDelChat({ workspaceId: "ws", conversationId: "c3", productoClave: "p-camilla" }), false);
  assert.equal(db.marcas.length, 0);
});

await prueba("el chat del combo se marca con la versión del producto del combo", async () => {
  const { db, prisma } = crearBase();
  const svc = cargarServicio(prisma);
  assert.equal(await svc.marcarVersionDelChat({ workspaceId: "ws", conversationId: "cc", productoClave: "combo-camilla" }), true);
  assert.equal(db.marcas[0].productId, "p-combo");
});

await prueba("elegirVersionParaChat da la vigente, marcada 'vigente'", async () => {
  const { prisma } = crearBase();
  const svc = cargarServicio(prisma);
  const elegida = await svc.elegirVersionParaChat("ws", "p-camilla");
  assert.equal(elegida.asignadaPor, "vigente");
  assert.equal(elegida.numero, 1);
});

await prueba("si falla el registro de la versión, no lanza (el guardado del embudo sigue valiendo)", async () => {
  const { db, prisma } = crearBase();
  const svc = cargarServicio(prisma);
  db.caido = true;
  const aviso = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await svc.registrarVersionDelEmbudo({ workspaceId: "ws", productId: "p-camilla", origen: "pantalla" }), null);
    assert.equal(await svc.asegurarVersionInicial("ws", "p-camilla"), null);
    assert.equal(await svc.marcarVersionDelChat({ workspaceId: "ws", conversationId: "c9", productoClave: "p-camilla" }), false);
  } finally {
    console.warn = aviso;
  }
});

await prueba("el guardado del embudo crea la versión DESPUÉS de guardar y la V1 ANTES", () => {
  const fuente = fs.readFileSync("src/app/actions/product-playbook-actions.ts", "utf8");
  const inicio = fuente.indexOf("export async function saveProductFunnelAction");
  const cuerpo = fuente.slice(inicio, fuente.indexOf("export async function saveProductMatchAction"));
  const v1 = cuerpo.indexOf("asegurarVersionInicial(");
  const borrado = cuerpo.indexOf("productStageFollowUp.deleteMany");
  const nueva = cuerpo.indexOf("registrarVersionDelEmbudo(");
  const respuesta = cuerpo.indexOf("return { ok: true, guardadoEl");
  assert.ok(v1 > 0 && v1 < borrado, "la V1 va antes de cambiar nada");
  assert.ok(nueva > borrado && nueva < respuesta, "la versión nueva va después de guardar, antes de responder");
});

console.log(`\n${pruebas} pruebas ok`);
