// Pruebas de las versiones del embudo (Embudo 3): foto, huella, versión nueva solo si cambió, V1 con
// lo de antes del cambio, chat marcado una sola vez, combo traducido, guardado que no se rompe.
// No necesita base ni red: usa una base falsa en memoria.
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

function baseFalsa() {
  const estado = {
    settings: new Map(),
    etapas: new Map(), // productId -> etapas (formato de la base)
    productos: new Map(), // productId -> nombre
    versiones: [],
    chats: new Map(),
    fallar: false,
  };
  const revisar = () => {
    if (estado.fallar) throw new Error("base caída");
  };
  const prisma = {
    appSetting: {
      findUnique: async ({ where }) => (estado.settings.has(where.key) ? { key: where.key, value: estado.settings.get(where.key) } : null),
    },
    productPlaybook: {
      findUnique: async ({ where }) => {
        revisar();
        const id = where.workspaceId_productId.productId;
        return estado.etapas.has(id) ? { stages: estado.etapas.get(id) } : null;
      },
      findMany: async () => [...estado.etapas.keys()].map((productId) => ({ productId, product: { name: estado.productos.get(productId) ?? null } })),
    },
    embudoVersion: {
      findFirst: async ({ where }) => {
        revisar();
        const lista = estado.versiones.filter((v) => v.productId === where.productId).sort((a, b) => b.numero - a.numero);
        return lista[0] ?? null;
      },
      create: async ({ data }) => {
        revisar();
        const fila = { id: `v${estado.versiones.length + 1}`, creadoEn: new Date(), ...data };
        estado.versiones.push(fila);
        return fila;
      },
    },
    embudoChatVersion: {
      findUnique: async ({ where }) => estado.chats.get(where.conversationId) ?? null,
      createMany: async ({ data }) => {
        for (const fila of data) if (!estado.chats.has(fila.conversationId)) estado.chats.set(fila.conversationId, fila);
        return { count: data.length };
      },
    },
  };
  return { estado, prisma };
}

const etapa = (stage, script, followUps = [], extra = {}) => ({ stage, goal: null, script, stuckAfterMessages: null, sortOrder: 0, followUps, ...extra });
const seguimiento = (content, timeValue = 1) => ({ sortOrder: 0, timeType: "DAYS", timeValue, content, flowId: null, isActive: true, cancelOnActivity: true });

const { prisma, estado } = baseFalsa();
const dominio = cargar("src/features/embudo/dominio/versiones.ts");
const servicio = cargar("src/features/embudo/servicios/versiones.ts", { "@/lib/prisma": { prisma } });
const combo = cargar("src/features/embudo/dominio/combo.ts");

/* ---------------------------------------------------------------------------- dominio */

await prueba("la foto trae bienvenida, pasos, quitados y seguimientos, en orden estable", () => {
  const foto = dominio.armarFoto(
    [etapa("CIERRE", "cierre", [], { sortOrder: 4 }), etapa("PRESENTACION", "Hola, soy Magilus", [seguimiento("¿sigues ahí?")], { sortOrder: 0 })],
    ["IDENTIFICACION", "IDENTIFICACION"],
  );
  assert.equal(foto.bienvenida, "Hola, soy Magilus");
  assert.deepEqual(foto.pasos.map((p) => p.paso), ["PRESENTACION", "CIERRE"]);
  assert.equal(foto.pasos[0].seguimientos[0].texto, "¿sigues ahí?");
  assert.deepEqual(foto.quitadas, ["IDENTIFICACION"]);
});

await prueba("mismo contenido = misma huella = no hace falta versión; un cambio de guion o de seguimiento sí", () => {
  const a = dominio.armarFoto([etapa("PRESENTACION", "uno", [seguimiento("a")])], []);
  const igual = dominio.armarFoto([etapa("PRESENTACION", "uno", [seguimiento("a")])], []);
  const guion = dominio.armarFoto([etapa("PRESENTACION", "dos", [seguimiento("a")])], []);
  const seg = dominio.armarFoto([etapa("PRESENTACION", "uno", [seguimiento("a", 2)])], []);
  const h = dominio.huellaDeFoto(a);
  assert.equal(dominio.haceFaltaVersionNueva(h, dominio.huellaDeFoto(igual)), false);
  assert.equal(dominio.haceFaltaVersionNueva(h, dominio.huellaDeFoto(guion)), true);
  assert.equal(dominio.haceFaltaVersionNueva(h, dominio.huellaDeFoto(seg)), true);
  assert.equal(dominio.haceFaltaVersionNueva(null, h), true);
});

await prueba("la clave del combo se traduce al producto correcto; lo desconocido queda sin versión", () => {
  const productos = [{ id: "p-combo", nombre: "Combo Camilla Premium" }, { id: "p-otro", nombre: "Silla" }];
  assert.equal(dominio.productoIdDeClave(combo.CLAVE_COMBO, combo.CONFIG_EMBUDO_POR_DEFECTO, productos), "p-combo");
  assert.equal(dominio.productoIdDeClave("p-otro", combo.CONFIG_EMBUDO_POR_DEFECTO, productos), "p-otro");
  assert.equal(dominio.productoIdDeClave("no-existe", combo.CONFIG_EMBUDO_POR_DEFECTO, productos), null);
  assert.equal(dominio.productoIdDeClave(null, combo.CONFIG_EMBUDO_POR_DEFECTO, productos), null);
  assert.equal(dominio.productoIdDeClave(combo.CLAVE_COMBO, combo.CONFIG_EMBUDO_POR_DEFECTO, [{ id: "p-otro", nombre: "Silla" }]), null);
  // Dos combos posibles y ninguno marcado en la configuración: no se adivina.
  const dos = [...productos, { id: "p-combo2", nombre: "Combo camilla básico" }];
  assert.equal(dominio.productoIdDeClave(combo.CLAVE_COMBO, combo.CONFIG_EMBUDO_POR_DEFECTO, dos), null);
  assert.equal(dominio.productoIdDeClave(combo.CLAVE_COMBO, { ...combo.CONFIG_EMBUDO_POR_DEFECTO, comboProductoIds: ["p-combo2"] }, dos), "p-combo2");
});

/* ---------------------------------------------------------------------------- servicio */

estado.productos.set("p-combo", "Combo Camilla");
estado.etapas.set("p-combo", [etapa("PRESENTACION", "Bienvenida vieja", [seguimiento("recordatorio")])]);
estado.productos.set("p-otro", "Silla");
estado.etapas.set("p-otro", [etapa("PRESENTACION", "Hola silla")]);

await prueba("la V1 guarda lo de ANTES del cambio y no se repite", async () => {
  await servicio.asegurarVersionInicial("ws1", "p-combo", { nombre: "Ana" });
  estado.etapas.set("p-combo", [etapa("PRESENTACION", "Bienvenida nueva", [seguimiento("recordatorio")])]);
  await servicio.asegurarVersionInicial("ws1", "p-combo");
  assert.equal(estado.versiones.length, 1);
  assert.equal(estado.versiones[0].numero, 1);
  assert.equal(estado.versiones[0].nota, "V1 - embudo inicial");
  assert.equal(estado.versiones[0].contenido.bienvenida, "Bienvenida vieja");
});

await prueba("un cambio crea la V2 con nota y quién; el mismo contenido no crea otra", async () => {
  const v2 = await servicio.registrarVersionDelEmbudo({ workspaceId: "ws1", productId: "p-combo", nota: "nuevo saludo", quien: { id: "u1", nombre: "Ana" }, origen: "pantalla" });
  assert.equal(v2.numero, 2);
  assert.equal(estado.versiones[1].nota, "nuevo saludo");
  assert.equal(estado.versiones[1].quienNombre, "Ana");
  const repetida = await servicio.registrarVersionDelEmbudo({ workspaceId: "ws1", productId: "p-combo", origen: "pantalla" });
  assert.equal(repetida.creada, false);
  assert.equal(estado.versiones.length, 2);
  estado.etapas.set("p-combo", [etapa("PRESENTACION", "Bienvenida nueva", [seguimiento("recordatorio", 3)])]);
  const v3 = await servicio.registrarVersionDelEmbudo({ workspaceId: "ws1", productId: "p-combo", origen: "mcp" });
  assert.equal(v3.numero, 3);
  // Deshacer vuelve al contenido de la V1: es una versión nueva (V4), no se reutiliza la vieja.
  estado.etapas.set("p-combo", [etapa("PRESENTACION", "Bienvenida vieja", [seguimiento("recordatorio")])]);
  const v4 = await servicio.registrarVersionDelEmbudo({ workspaceId: "ws1", productId: "p-combo", origen: "deshacer" });
  assert.equal(v4.numero, 4);
  assert.equal(estado.versiones[3].huella, estado.versiones[0].huella);
});

await prueba("un chat se marca una sola vez y se queda con su versión aunque salga otra", async () => {
  // Hoy la vigente del combo es la V4.
  assert.equal(await servicio.marcarVersionDelChat({ workspaceId: "ws1", conversationId: "chat1", productoClave: combo.CLAVE_COMBO }), true);
  assert.equal(estado.chats.get("chat1").numero, 4);
  assert.equal(estado.chats.get("chat1").productId, "p-combo");
  assert.equal(estado.chats.get("chat1").asignadaPor, "vigente");
  estado.etapas.set("p-combo", [etapa("PRESENTACION", "Otra más")]);
  await servicio.registrarVersionDelEmbudo({ workspaceId: "ws1", productId: "p-combo", origen: "mcp" });
  assert.equal(await servicio.marcarVersionDelChat({ workspaceId: "ws1", conversationId: "chat1", productoClave: combo.CLAVE_COMBO }), false);
  assert.equal(estado.chats.get("chat1").numero, 4);
  await servicio.marcarVersionDelChat({ workspaceId: "ws1", conversationId: "chat2", productoClave: combo.CLAVE_COMBO });
  assert.equal(estado.chats.get("chat2").numero, 5);
});

await prueba("un chat sin producto o con uno que no se reconoce queda sin versión", async () => {
  assert.equal(await servicio.marcarVersionDelChat({ workspaceId: "ws1", conversationId: "chat3", productoClave: null }), false);
  assert.equal(await servicio.marcarVersionDelChat({ workspaceId: "ws1", conversationId: "chat4", productoClave: "fantasma" }), false);
  assert.equal(estado.chats.has("chat3") || estado.chats.has("chat4"), false);
});

await prueba("con el interruptor del embudo apagado no se marca nada", async () => {
  estado.settings.set("embudo:activo:ws9", "false");
  assert.equal(await servicio.marcarVersionDelChat({ workspaceId: "ws9", conversationId: "chat5", productoClave: "p-otro" }), false);
  assert.equal(estado.chats.has("chat5"), false);
});

await prueba("elegirVersionParaChat da la vigente, marcada 'vigente'", async () => {
  const elegida = await servicio.elegirVersionParaChat("ws1", "p-combo");
  assert.equal(elegida.numero, 5);
  assert.equal(elegida.asignadaPor, "vigente");
});

await prueba("si falla el registro de la versión, no lanza (el guardado del embudo queda ok)", async () => {
  estado.fallar = true;
  const avisos = [];
  const original = console.warn;
  console.warn = (...args) => avisos.push(args);
  try {
    await servicio.registrarVersionProtegido({ workspaceId: "ws1", productId: "p-combo", origen: "pantalla" });
    await servicio.asegurarVersionInicialProtegido("ws1", "p-combo");
    assert.equal(await servicio.marcarVersionDelChat({ workspaceId: "ws1", conversationId: "chat6", productoClave: "p-otro" }), false);
  } finally {
    console.warn = original;
    estado.fallar = false;
  }
  assert.ok(avisos.length >= 2, "se anotó el error en el log");
});

console.log(`\n${pruebas} pruebas pasaron`);
