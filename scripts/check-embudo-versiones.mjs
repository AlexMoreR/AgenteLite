// Pruebas de las VERSIONES DEL EMBUDO (Embudo 3): src/features/embudo/dominio/versiones.ts (lo puro)
// y src/features/embudo/servicios/versiones.ts (con una base falsa en memoria), más el guardado del
// embudo de la pantalla y el deshacer del MCP. No necesita base ni red.
// Correr: npm run test:embudo-versiones
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

/* ------------------------------------------------------------------ base falsa en memoria */

const WS = "ws1";
const almacen = {
  productos: [
    { id: "p1", workspaceId: WS, name: "Combo Camilla" },
    { id: "p2", workspaceId: WS, name: "Silla" },
  ],
  playbooks: [
    { id: "pb1", workspaceId: WS, productId: "p1" },
    { id: "pb2", workspaceId: WS, productId: "p2" },
  ],
  etapas: [
    { id: "s1", playbookId: "pb1", stage: "PRESENTACION", goal: "Saludar", script: "Hola A", stuckAfterMessages: null, sortOrder: 0 },
    { id: "s2", playbookId: "pb1", stage: "CIERRE", goal: null, script: "Cerramos", stuckAfterMessages: null, sortOrder: 4 },
  ],
  seguimientos: [{ id: "f1", stageId: "s1", sortOrder: 0, timeType: "HOURS", timeValue: 2, content: "¿Sigues ahí?", flowId: null, cancelOnActivity: true, isActive: true }],
  versiones: [],
  chats: [],
  leads: {},
  ajustes: {},
  usuarios: { u1: { name: "Alex", email: "alex@x.co" } },
  falla: { crearVersion: false },
};
let contador = 0;

const ordenar = (lista, orden) => {
  if (!orden) return [...lista];
  const [[campo, sentido]] = Object.entries(orden);
  return [...lista].sort((a, b) => (sentido === "desc" ? b[campo] - a[campo] : a[campo] - b[campo]));
};

const prisma = {
  productPlaybook: {
    findFirst: async ({ where }) => {
      const playbook = almacen.playbooks.find((p) => p.workspaceId === where.workspaceId && p.productId === where.productId);
      if (!playbook) return null;
      const etapas = almacen.etapas.filter((e) => e.playbookId === playbook.id).sort((a, b) => a.sortOrder - b.sortOrder);
      return { stages: etapas.map((e) => ({ ...e, followUps: almacen.seguimientos.filter((f) => f.stageId === e.id).sort((a, b) => a.sortOrder - b.sortOrder) })) };
    },
    findUnique: async ({ where }) => {
      const { workspaceId, productId } = where.workspaceId_productId;
      return almacen.playbooks.find((p) => p.workspaceId === workspaceId && p.productId === productId) ?? null;
    },
    create: async () => {
      throw new Error("no se espera crear playbooks");
    },
  },
  productFunnelStage: {
    findUnique: async ({ where }) => {
      const etapa = almacen.etapas.find((e) => e.id === where.id);
      if (!etapa) return null;
      return { ...etapa, playbook: { productId: almacen.playbooks.find((p) => p.id === etapa.playbookId).productId } };
    },
    update: async ({ where, data }) => Object.assign(almacen.etapas.find((e) => e.id === where.id), data),
    upsert: async ({ where, create, update }) => {
      const { playbookId, stage } = where.playbookId_stage;
      const existente = almacen.etapas.find((e) => e.playbookId === playbookId && e.stage === stage);
      if (existente) return Object.assign(existente, update);
      const nueva = { id: `s${++contador + 100}`, ...create };
      almacen.etapas.push(nueva);
      return nueva;
    },
    deleteMany: async () => ({ count: 0 }),
  },
  productStageFollowUp: {
    deleteMany: async ({ where }) => {
      almacen.seguimientos = almacen.seguimientos.filter((f) => f.stageId !== where.stageId);
    },
    createMany: async ({ data }) => {
      for (const fila of data) almacen.seguimientos.push({ id: `f${++contador + 100}`, isActive: true, ...fila });
    },
    findUnique: async ({ where }) => almacen.seguimientos.find((f) => f.id === where.id) ?? null,
    update: async ({ where, data }) => Object.assign(almacen.seguimientos.find((f) => f.id === where.id), data),
  },
  product: {
    findFirst: async ({ where }) => almacen.productos.find((p) => p.id === where.id && p.workspaceId === where.workspaceId) ?? null,
    findMany: async ({ where }) =>
      almacen.productos.filter(
        (p) => p.workspaceId === where.workspaceId && (!where.id || p.id === where.id) && almacen.playbooks.some((pb) => pb.productId === p.id),
      ),
  },
  appSetting: {
    findUnique: async ({ where }) => (almacen.ajustes[where.key] === undefined ? null : { key: where.key, value: almacen.ajustes[where.key] }),
    upsert: async ({ where, update, create }) => {
      almacen.ajustes[where.key] = (almacen.ajustes[where.key] === undefined ? create : update).value;
    },
  },
  user: { findUnique: async ({ where }) => almacen.usuarios[where.id] ?? null },
  embudoLead: { findUnique: async ({ where }) => almacen.leads[where.conversationId] ?? null },
  embudoVersion: {
    findFirst: async ({ where, orderBy }) => {
      const filas = almacen.versiones.filter(
        (v) => v.productId === where.productId && (where.workspaceId === undefined || v.workspaceId === where.workspaceId) && (where.numero === undefined || v.numero === where.numero),
      );
      return ordenar(filas, orderBy)[0] ?? null;
    },
    findMany: async ({ where, orderBy }) => ordenar(almacen.versiones.filter((v) => v.workspaceId === where.workspaceId && v.productId === where.productId), orderBy),
    create: async ({ data }) => {
      if (almacen.falla.crearVersion) throw new Error("la base se cayó");
      if (almacen.versiones.some((v) => v.productId === data.productId && v.numero === data.numero)) {
        throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
      }
      const fila = { id: `v${++contador}`, creadoEn: new Date(), ...data };
      almacen.versiones.push(fila);
      return { id: fila.id, numero: fila.numero };
    },
  },
  embudoChatVersion: {
    findUnique: async ({ where }) => almacen.chats.find((c) => c.conversationId === where.conversationId) ?? null,
    createMany: async ({ data, skipDuplicates }) => {
      let count = 0;
      for (const fila of data) {
        if (almacen.chats.some((c) => c.conversationId === fila.conversationId)) {
          if (!skipDuplicates) throw new Error("duplicado");
          continue;
        }
        almacen.chats.push({ creadoEn: new Date(), ...fila });
        count += 1;
      }
      return { count };
    },
    groupBy: async ({ where }) => {
      const conteo = new Map();
      for (const c of almacen.chats.filter((x) => x.workspaceId === where.workspaceId && x.productId === where.productId)) {
        conteo.set(c.numero, (conteo.get(c.numero) ?? 0) + 1);
      }
      return [...conteo].map(([numero, n]) => ({ numero, _count: { _all: n } }));
    },
  },
};

let sesion = { user: { id: "u1", name: "Alex" } };
const registroDeLlamadas = [];
const mocks = {
  "@/lib/prisma": { prisma },
  "@/auth": { auth: async () => sesion },
  "next/cache": { revalidatePath: () => {} },
  "@/lib/client-workspace-access": { requireClientWorkspaceAccess: async () => ({}) },
  "@/lib/workspace": { getPrimaryWorkspaceForUser: async () => ({ workspace: { id: WS } }) },
  "next/server": { after: (tarea) => { throw new Error("fuera de un pedido"); void tarea; } },
};

const dominio = cargar("src/features/embudo/dominio/versiones.ts", mocks);
const servicio = cargar("src/features/embudo/servicios/versiones.ts", mocks);

/* ------------------------------------------------------------------ lo puro */

await prueba("la foto sale ordenada por paso, con textos limpios y los pasos quitados", () => {
  const foto = dominio.armarFoto({
    pasos: [
      { stage: "CIERRE", script: "  Cerramos  ", followUps: [] },
      { stage: "PRESENTACION", goal: "", script: "Hola", followUps: [
        { sortOrder: 1, timeType: "DAYS", timeValue: 1, content: "segundo" },
        { sortOrder: 0, timeType: "HOURS", timeValue: 2, content: "primero", flowId: "" },
      ] },
    ],
    quitadas: ["OBJECIONES", "IDENTIFICACION", "OBJECIONES"],
  });
  assert.deepEqual(foto.pasos.map((p) => p.stage), ["PRESENTACION", "CIERRE"]);
  assert.equal(foto.pasos[0].goal, null);
  assert.equal(foto.pasos[1].script, "Cerramos");
  assert.deepEqual(foto.pasos[0].seguimientos.map((s) => s.content), ["primero", "segundo"]);
  assert.equal(foto.pasos[0].seguimientos[0].flowId, null);
  assert.equal(foto.pasos[0].seguimientos[0].cancelOnActivity, true);
  assert.deepEqual(foto.quitadas, ["IDENTIFICACION", "OBJECIONES"]);
});

await prueba("el mismo contenido da la misma huella y un cambio de guion o de seguimiento la cambia", () => {
  const base = { pasos: [{ stage: "PRESENTACION", script: "Hola", followUps: [{ timeType: "HOURS", timeValue: 2, content: "x" }] }], quitadas: [] };
  const huella = (entrada) => dominio.huellaDeFoto(dominio.armarFoto(entrada));
  assert.equal(huella(base), huella(JSON.parse(JSON.stringify(base))));
  assert.equal(dominio.hayVersionNueva(huella(base), huella(base)), false);
  assert.equal(dominio.hayVersionNueva(null, huella(base)), true);
  const otroGuion = { ...base, pasos: [{ ...base.pasos[0], script: "Hola!" }] };
  assert.notEqual(huella(base), huella(otroGuion));
  const otroSeguimiento = { ...base, pasos: [{ ...base.pasos[0], followUps: [{ timeType: "HOURS", timeValue: 3, content: "x" }] }] };
  assert.notEqual(huella(base), huella(otroSeguimiento));
  assert.notEqual(huella(base), huella({ ...base, quitadas: ["CIERRE"] }));
});

await prueba("la clave del combo se traduce al producto correcto; lo dudoso queda sin producto", () => {
  const config = { comboProductoIds: [], comboAnuncioIds: [], comboTituloPatrones: [] };
  const candidatos = [{ id: "p1", nombre: "Combo Camilla" }, { id: "p2", nombre: "Silla" }];
  assert.equal(dominio.productoIdDeClave("combo-camilla", candidatos, config), "p1");
  assert.equal(dominio.productoIdDeClave("p2", candidatos, config), "p2");
  assert.equal(dominio.productoIdDeClave("zzz", candidatos, config), null);
  assert.equal(dominio.productoIdDeClave(null, candidatos, config), null);
  const dos = [...candidatos, { id: "p3", nombre: "Combo de camilla plus" }];
  assert.equal(dominio.productoIdDeClave("combo-camilla", dos, config), null, "dos combos y sin config: no se inventa");
  assert.equal(dominio.productoIdDeClave("combo-camilla", dos, { ...config, comboProductoIds: ["p3"] }), "p3");
  assert.equal(dominio.productoIdDeClave("combo-camilla", [{ id: "p2", nombre: "Silla" }], config), null);
});

/* ------------------------------------------------------------------ el servicio */

await prueba("la V1 guarda lo de ANTES del cambio y es 'V1 - embudo inicial'", async () => {
  const v1 = await servicio.asegurarVersionInicial(WS, "p1");
  assert.equal(v1.numero, 1);
  // Aplicar el cambio (lo que hace la pantalla después de la V1) y otra llamada no crea otra V1.
  almacen.etapas.find((e) => e.id === "s1").script = "Hola B";
  await servicio.asegurarVersionInicial(WS, "p1");
  assert.equal(almacen.versiones.length, 1);
  const [v] = almacen.versiones;
  assert.equal(v.nota, "V1 - embudo inicial");
  assert.equal(v.origen, "inicial");
  assert.equal(v.contenido.pasos[0].script, "Hola A", "la V1 quedó con el texto viejo");
});

await prueba("un producto sin embudo no tiene versión", async () => {
  assert.equal(await servicio.asegurarVersionInicial(WS, "p-sin-embudo"), null);
  assert.equal(almacen.versiones.length, 1);
});

await prueba("un cambio crea la versión siguiente con quién, desde dónde y la nota; lo idéntico no crea otra", async () => {
  const r = await servicio.registrarVersionDelEmbudo({ workspaceId: WS, productId: "p1", origen: "pantalla", nota: "  bienvenida más corta  ", quienId: "u1" });
  assert.deepEqual(r, { ok: true, creada: true, numero: 2 });
  const v2 = almacen.versiones[1];
  assert.equal(v2.nota, "bienvenida más corta");
  assert.equal(v2.quienNombre, "Alex");
  assert.equal(v2.origen, "pantalla");
  assert.equal(v2.contenido.pasos[0].script, "Hola B");

  const igual = await servicio.registrarVersionDelEmbudo({ workspaceId: WS, productId: "p1", origen: "mcp" });
  assert.deepEqual(igual, { ok: true, creada: false, numero: 2 });
  assert.equal(almacen.versiones.length, 2);

  almacen.seguimientos[0].timeValue = 5;
  const r3 = await servicio.registrarVersionDelEmbudo({ workspaceId: WS, productId: "p1", origen: "mcp", nota: "a ".repeat(400) });
  assert.equal(r3.numero, 3);
  assert.ok(almacen.versiones[2].nota.length <= 300);
});

await prueba("dos guardados a la vez no repiten número", async () => {
  almacen.etapas.find((e) => e.id === "s2").script = "Cerramos ya";
  const [a, b] = await Promise.all([
    servicio.registrarVersionDelEmbudo({ workspaceId: WS, productId: "p1", origen: "mcp" }),
    servicio.registrarVersionDelEmbudo({ workspaceId: WS, productId: "p1", origen: "pantalla" }),
  ]);
  assert.ok(a.ok && b.ok);
  const numeros = almacen.versiones.filter((v) => v.productId === "p1").map((v) => v.numero);
  assert.equal(new Set(numeros).size, numeros.length);
});

await prueba("si falla el registro de la versión no lanza y devuelve ok:false", async () => {
  almacen.falla.crearVersion = true;
  almacen.etapas.find((e) => e.id === "s2").script = "Otro cierre";
  const r = await servicio.registrarVersionDelEmbudo({ workspaceId: WS, productId: "p1", origen: "mcp" });
  assert.equal(r.ok, false);
  almacen.falla.crearVersion = false;
});

await prueba("elegirVersionParaChat da la vigente, marcada 'vigente'", async () => {
  const vigente = almacen.versiones.filter((v) => v.productId === "p1").sort((a, b) => b.numero - a.numero)[0];
  const elegida = await servicio.elegirVersionParaChat({ workspaceId: WS, productId: "p1", conversationId: "cX" });
  assert.deepEqual(elegida, { versionId: vigente.id, numero: vigente.numero, asignadaPor: "vigente" });
});

await prueba("un chat con el combo queda marcado con la versión vigente y se queda con ella aunque salgan otras", async () => {
  almacen.leads.c1 = { workspaceId: WS, productoActual: "combo-camilla", productoEntrada: "combo-camilla" };
  const antes = almacen.versiones.filter((v) => v.productId === "p1").sort((a, b) => b.numero - a.numero)[0];
  assert.equal(await servicio.marcarVersionDelChat({ workspaceId: WS, conversationId: "c1" }), true);
  const fila = almacen.chats.find((c) => c.conversationId === "c1");
  assert.equal(fila.productId, "p1");
  assert.equal(fila.numero, antes.numero);
  assert.equal(fila.asignadaPor, "vigente");

  // El embudo cambia: sale una versión más. El chat no cambia, ni con la memoria vacía.
  almacen.etapas.find((e) => e.id === "s1").script = "Hola C";
  const nueva = await servicio.registrarVersionDelEmbudo({ workspaceId: WS, productId: "p1", origen: "pantalla" });
  assert.ok(nueva.numero > antes.numero);
  servicio.olvidarChatsMarcados();
  assert.equal(await servicio.marcarVersionDelChat({ workspaceId: WS, conversationId: "c1" }), false);
  assert.equal(almacen.chats.find((c) => c.conversationId === "c1").numero, antes.numero);
  assert.equal(almacen.chats.filter((c) => c.conversationId === "c1").length, 1);
});

await prueba("un chat nuevo después de ese cambio entra con la versión nueva", async () => {
  almacen.leads.c2 = { workspaceId: WS, productoActual: "p1", productoEntrada: null };
  servicio.olvidarChatsMarcados();
  await servicio.marcarVersionDelChat({ workspaceId: WS, conversationId: "c2" });
  const maxima = Math.max(...almacen.versiones.filter((v) => v.productId === "p1").map((v) => v.numero));
  assert.equal(almacen.chats.find((c) => c.conversationId === "c2").numero, maxima);
});

await prueba("un chat sin producto, sin lead, de otro negocio o con producto desconocido queda sin versión", async () => {
  almacen.leads.c3 = { workspaceId: WS, productoActual: null, productoEntrada: null };
  almacen.leads.c4 = { workspaceId: WS, productoActual: "producto-que-no-existe", productoEntrada: null };
  almacen.leads.c5 = { workspaceId: "otro", productoActual: "p1", productoEntrada: null };
  for (const id of ["c3", "c4", "c5", "c-sin-lead"]) {
    assert.equal(await servicio.marcarVersionDelChat({ workspaceId: WS, conversationId: id }), false, id);
    assert.equal(almacen.chats.some((c) => c.conversationId === id), false, id);
  }
});

await prueba("con el interruptor del embudo apagado no se marca nada", async () => {
  almacen.ajustes["embudo:activo:ws-apagado"] = "false";
  almacen.leads.c6 = { workspaceId: "ws-apagado", productoActual: "p1", productoEntrada: null };
  assert.equal(await servicio.marcarVersionDelChat({ workspaceId: "ws-apagado", conversationId: "c6" }), false);
  assert.equal(almacen.chats.some((c) => c.conversationId === "c6"), false);
});

await prueba("la lista de versiones cuenta los chats de cada una y una versión vieja se puede leer completa", async () => {
  const lista = await servicio.listarVersiones(WS, "p1");
  assert.equal(lista[0].numero, Math.max(...lista.map((v) => v.numero)), "la más nueva primero");
  const v1 = lista.find((v) => v.numero === 1);
  assert.equal(v1.chats, 0);
  assert.ok(lista.find((v) => v.chats === 1));
  const completa = await servicio.leerVersion(WS, "p1", 1);
  assert.equal(completa.foto.pasos[0].script, "Hola A");
  assert.equal(completa.foto.pasos[0].seguimientos[0].content, "¿Sigues ahí?");
  assert.equal(await servicio.leerVersion(WS, "p1", 999), null);
  assert.equal(await servicio.leerVersion("otro", "p1", 1), null);
});

/* ------------------------------------------------------------------ el guardado de la pantalla */

await prueba("guardar el embudo desde la pantalla crea su versión con la nota, y la V1 de un producto nuevo guarda lo de antes", async () => {
  const acciones = cargar("src/app/actions/product-playbook-actions.ts", mocks);
  const stages = [{ stage: "PRESENTACION", goal: "Saludar", script: "Hola de pantalla", followUps: [] }];
  const r = await acciones.saveProductFunnelAction({ productId: "p2", stages, nota: "primer cambio de la silla" });
  assert.equal(r.ok, true);
  const dePantalla = almacen.versiones.filter((v) => v.productId === "p2").sort((a, b) => a.numero - b.numero);
  assert.equal(dePantalla.length, 2);
  assert.equal(dePantalla[0].nota, "V1 - embudo inicial");
  assert.equal(dePantalla[0].contenido.pasos.length, 0, "la V1 es el embudo vacío de antes del cambio");
  assert.equal(dePantalla[1].nota, "primer cambio de la silla");
  assert.equal(dePantalla[1].origen, "pantalla");
  assert.equal(dePantalla[1].quienNombre, "Alex");
  assert.equal(dePantalla[1].contenido.pasos[0].script, "Hola de pantalla");
});

await prueba("si falla el registro de la versión, el guardado del embudo responde ok igual", async () => {
  almacen.falla.crearVersion = true;
  const acciones = cargar("src/app/actions/product-playbook-actions.ts", mocks);
  const stages = [{ stage: "PRESENTACION", goal: "Saludar", script: "Hola con la base rota", followUps: [] }];
  const r = await acciones.saveProductFunnelAction({ productId: "p1", stages });
  almacen.falla.crearVersion = false;
  assert.equal(r.ok, true);
  assert.equal(almacen.etapas.find((e) => e.id === "s1").script, "Hola con la base rota", "el embudo quedó guardado");
});

/* ------------------------------------------------------------------ deshacer en el MCP */

await prueba("deshacer un cambio del embudo crea una versión igual a la anterior", async () => {
  const cambios = cargar("src/lib/mcp/cambios.ts", mocks);
  const huella = () => servicio.versionVigente("p1").then(async (v) => almacen.versiones.find((x) => x.id === v.id));
  await servicio.registrarVersionDelEmbudo({ workspaceId: WS, productId: "p1", origen: "mcp" });
  const antes = await huella();
  const etapa = almacen.etapas.find((e) => e.id === "s2");
  const anotado = await cambios.anotarCambioMcp(WS, {
    titulo: "Paso CIERRE",
    tabla: "ProductFunnelStage",
    filaId: "s2",
    accion: "editar",
    antes: { script: etapa.script, goal: etapa.goal, stuckAfterMessages: null },
    despues: { script: "Cierre nuevo" },
  });
  etapa.script = "Cierre nuevo";
  await servicio.registrarVersionDelEmbudo({ workspaceId: WS, productId: "p1", origen: "mcp" });
  const resultado = await cambios.deshacerCambioMcp(WS, anotado.id);
  assert.equal(resultado.ok, true);
  const despues = await huella();
  assert.equal(despues.origen, "deshacer");
  assert.equal(despues.numero, antes.numero + 2);
  assert.equal(despues.huella, antes.huella, "queda igual a la de antes del cambio");
  assert.match(despues.nota, /Se deshizo/);
});

/* ------------------------------------------------------------------ el cableado */

await prueba("el cableado: el registro del embudo marca el chat, el MCP trae las herramientas y la migración existe", async () => {
  const fs = await import("node:fs");
  const leer = (ruta) => fs.readFileSync(ruta, "utf8");
  assert.match(leer("src/features/embudo/servicios/eventos.ts"), /marcarVersionDelChat/);
  const escritura = leer("src/lib/mcp/escritura.ts");
  for (const nombre of ["ver_versiones_del_embudo", "ver_version_del_embudo"]) {
    assert.match(escritura, new RegExp(`name: "${nombre}"`));
    assert.match(escritura, new RegExp(`case "${nombre}"`));
  }
  assert.ok((escritura.match(/versionarCambio\(/g) ?? []).length >= 4, "los cuatro cambios del embudo crean versión");
  const accion = leer("src/app/actions/product-playbook-actions.ts");
  assert.ok(accion.indexOf("registrarVersionDelEmbudo({") > accion.indexOf("productStageFollowUp.createMany"), "la versión nueva va DESPUÉS de guardar");
  assert.ok(accion.indexOf("asegurarVersionInicial(workspaceId") < accion.indexOf("await guardarEtapasQuitadas(productId"), "la V1 va ANTES del cambio");
  assert.ok(fs.existsSync("prisma/migrations/20261026120000_embudo_versiones/migration.sql"));
});

console.log(`\n${pruebas} pruebas pasaron`);
