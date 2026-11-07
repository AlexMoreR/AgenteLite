// Pruebas de las INSTRUCCIONES DE LOS SEGUIMIENTOS CON IA editables por el MCP (pedido del dueño, 6-nov-2026):
// ver, cambiar (vista previa y confirmado), historial y volver, y que el redactor use lo guardado. Sin base ni IA real.
// Correr: npm run test:instrucciones-de-seguimiento
import assert from "node:assert/strict";
import fs from "node:fs";

import { cargar } from "./supervisor-cargar.mjs";

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

/*
  COPIA FIJA del pedido a la IA de antes de este cambio (7-nov-2026), sacada del código de entonces. Con
  nada guardado, el pedido tiene que ser idéntico carácter por carácter. No se actualiza a mano: si esta
  prueba falla, el cambio movió lo que la IA recibe hoy.
*/
const PEDIDO_DE_HOY = "Escribes UN mensaje de seguimiento por WhatsApp para un cliente que dejó de contestar. Tuteas, en español de Colombia.\nMenciona algo que ESTE cliente dijo en la conversación: el color, el producto, la ciudad, para cuándo lo necesita o la duda que tuvo. Si no dijo nada de eso, habla del producto que le interesa.\nTrae algo nuevo o útil para él (un dato del producto que esté en los DATOS DEL NEGOCIO); no repitas lo que ya le dijimos.\nCierra con UNA sola pregunta fácil de contestar (de sí o no, o de elegir entre dos), al final del mensaje.\nMáximo 2 líneas y unas 35 palabras.\nNo inventes precios, cifras ni fechas: solo puedes usar los que estén en la conversación o en los DATOS DEL NEGOCIO.\nNunca escribas \"pero\" (usa \"sin embargo\"), \"¿sigues interesada?\", \"cuando puedas me avisas\", \"¿pudiste ver lo que te envié?\", \"aquí estoy para ayudarte\" ni \"si te queda alguna duda\". No trates de usted.\nNo repitas ni parafrasees los SEGUIMIENTOS YA ENVIADOS.\nNunca preguntes lo que el cliente ya respondió (mira LO QUE EL CLIENTE YA DIJO): ni la ciudad, ni para cuándo lo necesita, ni el color, ni su servicio o negocio.\nSi ya dio la ciudad, nómbrala y termina pidiendo apartar. Por ejemplo, si dijo Bogotá: \"Anotado para Bogotá 🙌 ¿Te lo aparto para empezar a fabricarlo?\"\nMenciona algo concreto que dijo el cliente, no un mensaje genérico.\nNo hables del envío ni de su valor, ni digas \"gratis\" o \"sin costo\", ni a qué ciudades llega ni \"te llega\", ni de contraentrega, ni de formas de pago, anticipo o el 50 %.\nNo inventes nada: ni productos, ni colores, ni condiciones que no estén en la conversación o en los DATOS DEL NEGOCIO.\nSi el cliente ya separó, ya pagó o dijo que no le interesa, no le pidas apartar.\nResponde solo con el texto del mensaje, sin comillas ni explicaciones.";
const REGLA_DEL_ANUNCIO_DE_HOY = "Este cliente solo mandó el texto del anuncio y no escribió nada más: haz una pregunta corta y concreta sobre el producto del anuncio.";

/* ---------------------------------------------------------------------------------------------- */
// La base de mentira (AppSetting, miembros, productos y lo que lee el redactor) y la IA de mentira.

const base = { ajustes: new Map(), escrituras: 0, fallaLectura: false };
const MIEMBROS = {
  "ws-1:dueno": { role: "OWNER", user: { role: "CLIENTE", name: "Alexander" }, workspace: { ownerId: "dueno" } },
  "ws-1:admin": { role: "ADMIN", user: { role: "CLIENTE", name: "Admin Uno" }, workspace: { ownerId: "dueno" } },
  "ws-1:asesora": { role: "AGENT", user: { role: "EMPLEADO", name: "Asesora" }, workspace: { ownerId: "dueno" } },
  "ws-2:dueno2": { role: "OWNER", user: { role: "CLIENTE", name: "Otro dueño" }, workspace: { ownerId: "dueno2" } },
};
const PRODUCTOS = [
  { id: "prod-1", workspaceId: "ws-1", name: "Combo Camilla", price: 350000, description: "Camilla plegable con bolso", activo: true },
  { id: "prod-otro", workspaceId: "ws-1", name: "Silla Isabela", price: 450000, description: "Silla tapizada", activo: true },
  { id: "prod-2", workspaceId: "ws-2", name: "Producto del otro negocio", price: 100000, description: "", activo: true },
];
const CHATS = {
  "ws-1:conv-1": "prod-1",
  "ws-1:conv-3": "prod-otro",
  "ws-2:conv-2": "prod-2",
};

const prismaFalso = {
  appSetting: {
    findUnique: async ({ where }) => {
      if (base.fallaLectura && where.key.includes(":instrucciones:")) throw new Error("la base no responde");
      return base.ajustes.has(where.key) ? { key: where.key, value: base.ajustes.get(where.key) } : null;
    },
    upsert: async ({ where, create, update }) => {
      base.escrituras += 1;
      base.ajustes.set(where.key, base.ajustes.has(where.key) ? update.value : create.value);
      return { key: where.key };
    },
  },
  workspaceMember: {
    findFirst: async ({ where }) => (where.isActive ? (MIEMBROS[`${where.workspaceId}:${where.userId}`] ?? null) : null),
  },
  product: {
    findFirst: async ({ where }) => {
      const p = PRODUCTOS.find((x) => x.id === where.id && x.workspaceId === where.workspaceId);
      return p ? { ...p } : null;
    },
    findMany: async ({ where }) =>
      PRODUCTOS.filter((x) => x.workspaceId === where.workspaceId && x.name.toLowerCase() === where.name.equals.toLowerCase()).map(
        (x) => ({ id: x.id, name: x.name }),
      ),
  },
  conversation: {
    findFirst: async ({ where }) => {
      const productId = CHATS[`${where.workspaceId}:${where.id}`];
      if (!productId) return null;
      return {
        activeProductContext: { productId },
        messages: [
          { id: "m2", direction: "INBOUND", type: "TEXT", content: "Me gusta, ¿qué medidas tiene?", mediaUrl: null, transcripcion: null, transcritoEn: null, createdAt: new Date("2026-11-06T15:10:00Z") },
          { id: "m1", direction: "INBOUND", type: "TEXT", content: "Hola, vi el anuncio", mediaUrl: null, transcripcion: null, transcritoEn: null, createdAt: new Date("2026-11-06T15:00:00Z") },
        ],
      };
    },
  },
  message: {
    findMany: async () => [],
    updateMany: async () => ({ count: 0 }),
  },
};

const MOCKS = {
  "@/lib/prisma": { prisma: prismaFalso },
  "@/lib/transcripcion-de-audios": { transcribirAudioAhora: async () => null },
  "@/features/agente-v3/servicios/almacen": { leerLibro: async () => ({ comoHablamos: "Tuteamos y somos cercanos." }) },
};

const sq = cargar("src/features/seguimientos/dominio/seguimiento-que-escucha.ts", MOCKS);
const dom = cargar("src/features/seguimientos/dominio/instrucciones-de-seguimiento.ts", MOCKS);
const mcp = cargar("src/lib/mcp/instrucciones-de-seguimiento.ts", MOCKS);
const redactor = cargar("src/features/seguimientos/services/seguimiento-que-escucha.ts", MOCKS);

const ia = { sistemas: [] };
globalThis.fetch = async (url, opciones) => {
  assert.equal(url, "https://api.openai.com/v1/chat/completions");
  const cuerpo = JSON.parse(opciones.body);
  ia.sistemas.push(cuerpo.messages[0].content);
  return { ok: true, json: async () => ({ choices: [{ message: { content: "¿Te comparto las medidas de la camilla plegable?" } }] }) };
};
process.env.OPENAI_API_KEY = "clave-de-prueba";
const consola = { info: console.info, warn: console.warn };
const avisos = [];
console.info = () => {};
console.warn = (...args) => avisos.push(args.map(String).join(" "));

/** Lo que recibió la IA como instrucciones en una redacción. */
async function instruccionesEnviadas({ workspaceId = "ws-1", conversationId = "conv-1", paso = 1 } = {}) {
  ia.sistemas = [];
  redactor.reiniciarTopeDeLaVuelta();
  const r = await redactor.redactarSeguimientoQueEscucha({ conversationId, workspaceId, textoFijo: "¿Te comparto las medidas?", paso, origen: "follow" });
  assert.equal(r.enviar, true);
  assert.ok(ia.sistemas.length >= 1, "la IA recibió el pedido");
  return ia.sistemas[0];
}

const DUENO = { workspaceId: "ws-1", userId: "dueno" };
const llamar = (nombre, args = {}, contexto = DUENO) => mcp.ejecutarHerramientaMcpInstruccionesDeSeguimiento(nombre, args, contexto);
async function falla(promesa, patron) {
  await assert.rejects(promesa, (e) => {
    assert.match(e.message, patron);
    return true;
  });
}
function reiniciar() {
  base.ajustes = new Map();
  base.escrituras = 0;
  base.fallaLectura = false;
}

/* ---------------------------------------------------------------------------------------------- */

await prueba("criterio 1: las 4 herramientas quedan registradas en el MCP", () => {
  const nombres = mcp.HERRAMIENTAS_MCP_INSTRUCCIONES_DE_SEGUIMIENTO.map((h) => h.name);
  assert.deepEqual(nombres, [
    "ver_instrucciones_de_seguimientos",
    "cambiar_instrucciones_de_seguimientos",
    "historial_de_instrucciones_de_seguimientos",
    "volver_instrucciones_de_seguimientos",
  ]);
  for (const n of nombres) assert.ok(mcp.esHerramientaDeInstruccionesDeSeguimiento(n), n);
  assert.equal(mcp.esHerramientaDeInstruccionesDeSeguimiento("v3_ver_reglas"), false);
  const codigo = fs.readFileSync(new URL("../src/lib/mcp/herramientas.ts", import.meta.url), "utf8");
  assert.ok(codigo.includes("...HERRAMIENTAS_MCP_INSTRUCCIONES_DE_SEGUIMIENTO"));
  assert.match(codigo, /esHerramientaDeInstruccionesDeSeguimiento\(nombre\)\) \{\s*return ejecutarHerramientaMcpInstruccionesDeSeguimiento\(nombre, args, contexto\);/);
  // Solo lectura las que leen; las que escriben, no.
  const porNombre = Object.fromEntries(mcp.HERRAMIENTAS_MCP_INSTRUCCIONES_DE_SEGUIMIENTO.map((h) => [h.name, h]));
  assert.equal(porNombre.ver_instrucciones_de_seguimientos.annotations.readOnlyHint, true);
  assert.equal(porNombre.cambiar_instrucciones_de_seguimientos.annotations.readOnlyHint, false);
});

await prueba("criterio 2: sin nada guardado, el pedido a la IA es idéntico carácter por carácter al de hoy", async () => {
  reiniciar();
  const entrada = { lineas: [], producto: null, paso: 1, yaEnviados: [], datosDelLibro: null };
  assert.equal(sq.armarPedidoDeSeguimiento({ ...entrada, soloMandoElAnuncio: false }).instrucciones, PEDIDO_DE_HOY);
  assert.equal(sq.armarPedidoDeSeguimiento({ ...entrada, soloMandoElAnuncio: true }).instrucciones, `${PEDIDO_DE_HOY}\n${REGLA_DEL_ANUNCIO_DE_HOY}`);
  assert.equal(sq.armarPedidoDeSeguimiento({ ...entrada, soloMandoElAnuncio: false, personalizadas: null }).instrucciones, PEDIDO_DE_HOY);
  // La versión 0 no arma nada personalizado.
  assert.equal(dom.instruccionesParaElPedido(dom.INSTRUCCIONES_ORIGINALES, "prod-1", 1), null);
  // Y por el redactor real (base e IA de mentira): lo mismo.
  assert.equal(await instruccionesEnviadas(), PEDIDO_DE_HOY);
  assert.equal(base.escrituras, 0);
});

await prueba("criterio 3: ver muestra versión, texto global, añadidos, candados y lo que rechaza el revisor", async () => {
  reiniciar();
  const v = await llamar("ver_instrucciones_de_seguimientos");
  assert.equal(v.version, 0);
  assert.equal(v.texto_global.es_el_de_siempre, true);
  assert.equal(v.texto_global.texto, sq.REGLAS_EDITABLES_ORIGINALES.join("\n"));
  assert.deepEqual(v.por_producto, []);
  assert.deepEqual(v.por_numero_de_seguimiento, []);
  assert.equal(v.candados.length, 6);
  assert.ok(v.candados.some((c) => /No hables del envío/.test(c)));
  assert.ok(v.candados.some((c) => /Máximo 2 líneas/.test(c)));
  assert.ok(v.lo_que_rechaza_el_revisor.length >= 5);
  assert.ok(v.lo_que_rechaza_el_revisor.some((r) => /gratis/.test(r)));
  assert.ok(v.ojo.some((o) => /reloj del V3/.test(o)));
  // Editables + candados = las 15 de siempre.
  assert.equal(sq.REGLAS_EDITABLES_ORIGINALES.length + sq.CANDADOS.length, 15);
});

await prueba("criterio 4: cambiar sin confirmado=true devuelve el actual y el nuevo, y no guarda nada", async () => {
  reiniciar();
  const r = await llamar("cambiar_instrucciones_de_seguimientos", { nivel: "global", texto: "Tono alegre y cercano.\nCierra con una pregunta de sí o no.", version_leida: 0 });
  assert.equal(r.guardado, false);
  assert.equal(r.version_actual, 0);
  assert.equal(r.texto_actual, sq.REGLAS_EDITABLES_ORIGINALES.join("\n"));
  assert.equal(r.texto_nuevo, "Tono alegre y cercano.\nCierra con una pregunta de sí o no.");
  assert.match(r.para_guardar, /confirmado=true y version_leida=0/);
  assert.equal(base.escrituras, 0, "no hubo escrituras en la base");
  assert.equal(base.ajustes.size, 0);
  // Tampoco con confirmado distinto de true.
  await llamar("cambiar_instrucciones_de_seguimientos", { nivel: "global", texto: "Otro texto.", confirmado: "si", version_leida: 0 });
  assert.equal(base.escrituras, 0);
});

await prueba("criterio 5: con confirmado=true, sin versión o con versión vieja no guarda; con la correcta sube la versión y guarda la foto", async () => {
  reiniciar();
  const nuevo = { nivel: "global", texto: "Tono alegre y cercano.", confirmado: true };
  await falla(llamar("cambiar_instrucciones_de_seguimientos", nuevo), /falta version_leida/);
  assert.equal(base.escrituras, 0);
  await falla(llamar("cambiar_instrucciones_de_seguimientos", { ...nuevo, version_leida: 3 }), /leíste la versión 3 y ahora es la 0/);
  assert.equal(base.escrituras, 0);

  const r = await llamar("cambiar_instrucciones_de_seguimientos", { ...nuevo, version_leida: 0, resumen: "Tono alegre" });
  assert.equal(r.guardado, true);
  assert.equal(r.version, 1);
  const guardadas = JSON.parse(base.ajustes.get("seguimientos-que-escuchan:instrucciones:ws-1"));
  assert.equal(guardadas.version, 1);
  assert.equal(guardadas.global, "Tono alegre y cercano.");
  assert.equal(guardadas.actualizadoPor, "Alexander");
  const historial = JSON.parse(base.ajustes.get("seguimientos-que-escuchan:instrucciones-historial:ws-1"));
  assert.equal(historial.length, 1);
  assert.equal(historial[0].version, 1);
  assert.equal(historial[0].anterior, 0);
  assert.equal(historial[0].fotoAnterior.version, 0);
  assert.equal(historial[0].fotoAnterior.global, null);
  // La versión 0 ya no vale para guardar otra vez.
  await falla(
    llamar("cambiar_instrucciones_de_seguimientos", { nivel: "global", texto: "Otro.", confirmado: true, version_leida: 0 }),
    /ahora es la 1/,
  );
  // El historial lo lista con quién y resumen.
  const h = await llamar("historial_de_instrucciones_de_seguimientos");
  assert.equal(h.version_actual, 1);
  assert.deepEqual(
    h.cambios.map((c) => [c.version, c.anterior, c.quien, c.resumen]),
    [[1, 0, "Alexander", "Tono alegre"]],
  );
  assert.ok(h.cambios[0].fecha);
});

await prueba("criterio 6: después de guardar, la siguiente redacción lleva lo nuevo (global, del producto y del número) sin reiniciar nada", async () => {
  reiniciar();
  await llamar("cambiar_instrucciones_de_seguimientos", { nivel: "global", texto: "Tono alegre y cercano, con un emoji.", confirmado: true, version_leida: 0 });
  await llamar("cambiar_instrucciones_de_seguimientos", {
    nivel: "producto",
    producto: "Combo Camilla",
    texto: "Recuerda que la camilla es plegable y trae bolso.",
    confirmado: true,
    version_leida: 1,
  });
  await llamar("cambiar_instrucciones_de_seguimientos", { nivel: "numero", numero: 2, texto: "En el segundo, ofrece mandar un video corto.", confirmado: true, version_leida: 2 });

  const segundo = await instruccionesEnviadas({ paso: 2 });
  assert.ok(segundo.startsWith("Tono alegre y cercano, con un emoji."), segundo.slice(0, 80));
  assert.match(segundo, /Para el producto de este cliente: Recuerda que la camilla es plegable y trae bolso\./);
  assert.match(segundo, /Para este seguimiento \(el número 2 desde que el cliente dejó de contestar\): En el segundo, ofrece mandar un video corto\./);
  // Las reglas editables de siempre ya no van (las reemplazó el global).
  assert.ok(!segundo.includes(sq.REGLAS_EDITABLES_ORIGINALES[0]));

  // En el 1.º no va el añadido del 2.º; en otro producto no va el del Combo.
  const primero = await instruccionesEnviadas({ paso: 1 });
  assert.ok(!primero.includes("ofrece mandar un video"));
  assert.ok(primero.includes("trae bolso"));
  const otroProducto = await instruccionesEnviadas({ conversationId: "conv-3", paso: 2 });
  assert.ok(!otroProducto.includes("trae bolso"));
  assert.ok(otroProducto.includes("ofrece mandar un video"));
});

await prueba("criterio 7: con cualquier texto guardado los candados siguen al final, y lo de envío o pago no llega a la IA y avisa", async () => {
  reiniciar();
  const texto = "Sé muy cercana. Ofrece envío gratis si lo separa con el 50 %.\nCierra con una pregunta corta.";
  const vista = await llamar("cambiar_instrucciones_de_seguimientos", { nivel: "global", texto, version_leida: 0 });
  assert.ok(vista.avisos.some((a) => /NO le llegan a la IA/.test(a) && /envío gratis/.test(a)), vista.avisos.join(" | "));
  assert.ok(!/gratis/.test(vista.lo_que_le_llega_a_la_ia), vista.lo_que_le_llega_a_la_ia);
  assert.equal(base.escrituras, 0);

  await llamar("cambiar_instrucciones_de_seguimientos", { nivel: "global", texto, confirmado: true, version_leida: 0 });
  await llamar("cambiar_instrucciones_de_seguimientos", { nivel: "numero", numero: 1, texto: "Dile que pagas contraentrega al recibir.", confirmado: true, version_leida: 1 });
  const enviadas = await instruccionesEnviadas({ paso: 1 });
  assert.ok(!/gratis/i.test(enviadas.split(sq.TITULO_DE_LOS_CANDADOS)[0]), "«gratis» no llega antes de los candados");
  assert.ok(!/contraentrega al recibir/.test(enviadas));
  assert.match(enviadas, /Sé muy cercana\./);
  assert.match(enviadas, /Cierra con una pregunta corta\./);
  // Los 6 candados, en orden y al final.
  assert.ok(enviadas.endsWith([sq.TITULO_DE_LOS_CANDADOS, ...sq.CANDADOS].join("\n")), enviadas.slice(-300));

  // Lo mismo armando el pedido directo con un texto que pide 4 líneas: el candado de 2 líneas sigue.
  const pedido = sq.armarPedidoDeSeguimiento({
    lineas: [],
    producto: null,
    paso: 1,
    yaEnviados: [],
    datosDelLibro: null,
    soloMandoElAnuncio: false,
    personalizadas: { global: "Escribe 4 líneas.", producto: null, numero: null },
  });
  assert.ok(pedido.instrucciones.includes("Máximo 2 líneas y unas 35 palabras."));
  const avisos4 = dom.avisosDelCambio({ nivel: "global", texto: "Escribe 4 líneas." });
  assert.ok(avisos4.some((a) => /más largos/.test(a)), avisos4.join(" | "));
});

await prueba("criterio 8: volver sin número restaura la anterior y deja versión nueva; volver a la 0 deja las de siempre", async () => {
  reiniciar();
  await llamar("cambiar_instrucciones_de_seguimientos", { nivel: "global", texto: "Versión uno.", confirmado: true, version_leida: 0 });
  await llamar("cambiar_instrucciones_de_seguimientos", { nivel: "global", texto: "Versión dos.", confirmado: true, version_leida: 1 });
  assert.ok((await instruccionesEnviadas()).startsWith("Versión dos."));

  const v = await llamar("volver_instrucciones_de_seguimientos", {});
  assert.equal(v.volvio_a, 1);
  assert.equal(v.version_nueva, 3);
  assert.equal(v.texto_global.texto, "Versión uno.");
  assert.ok((await instruccionesEnviadas()).startsWith("Versión uno."));
  const h = await llamar("historial_de_instrucciones_de_seguimientos");
  assert.deepEqual(h.cambios.map((c) => c.version), [3, 2, 1]);
  assert.equal(h.cambios[0].resumen, "Volver a la versión 1");

  // A una versión con número: la 2.
  const a2 = await llamar("volver_instrucciones_de_seguimientos", { version: 2 });
  assert.equal(a2.texto_global.texto, "Versión dos.");
  assert.equal(a2.version_nueva, 4);

  const cero = await llamar("volver_instrucciones_de_seguimientos", { version: 0 });
  assert.equal(cero.version_nueva, 5);
  assert.equal(cero.texto_global.es_el_de_siempre, true);
  assert.equal(await instruccionesEnviadas(), PEDIDO_DE_HOY);
  // Desde la 0 recién creada, sin número vuelve a la 4.
  const deshacer = await llamar("volver_instrucciones_de_seguimientos", {});
  assert.equal(deshacer.volvio_a, 4);
  await falla(llamar("volver_instrucciones_de_seguimientos", { version: 99 }), /No existe la versión 99/);
});

await prueba("criterio 9: si lo guardado está roto o falla su lectura, la redacción sigue con las reglas de siempre", async () => {
  reiniciar();
  base.ajustes.set("seguimientos-que-escuchan:instrucciones:ws-1", "{esto no es json");
  avisos.length = 0;
  assert.equal(await instruccionesEnviadas(), PEDIDO_DE_HOY);
  assert.ok(avisos.some((a) => /ilegibles/.test(a)), "queda en el registro");
  base.ajustes.set("seguimientos-que-escuchan:instrucciones:ws-1", JSON.stringify({ version: "x", global: 5 }));
  assert.equal(await instruccionesEnviadas(), PEDIDO_DE_HOY);
  // Ver lo dice, y no se guarda encima de lo roto.
  await falla(llamar("ver_instrucciones_de_seguimientos"), /ilegibles/);
  await falla(llamar("cambiar_instrucciones_de_seguimientos", { nivel: "global", texto: "x", confirmado: true, version_leida: 0 }), /ilegibles/);
  assert.equal(base.escrituras, 0);
  // Se arregla volviendo a la 0.
  const cero = await llamar("volver_instrucciones_de_seguimientos", { version: 0 });
  assert.equal(cero.texto_global.es_el_de_siempre, true);

  reiniciar();
  base.fallaLectura = true;
  avisos.length = 0;
  assert.equal(await instruccionesEnviadas(), PEDIDO_DE_HOY);
  assert.ok(avisos.some((a) => /no se pudieron leer las instrucciones/.test(a)));
});

await prueba("criterio 10: una clave que no es de dueño o administrador no cambia ni vuelve; un producto de otro negocio da error", async () => {
  reiniciar();
  const asesora = { workspaceId: "ws-1", userId: "asesora" };
  await falla(llamar("cambiar_instrucciones_de_seguimientos", { nivel: "global", texto: "x" }, asesora), /Solo el dueño o un administrador/);
  await falla(
    llamar("cambiar_instrucciones_de_seguimientos", { nivel: "global", texto: "x", confirmado: true, version_leida: 0 }, asesora),
    /Solo el dueño o un administrador/,
  );
  await falla(llamar("volver_instrucciones_de_seguimientos", { version: 0 }, asesora), /Solo el dueño o un administrador/);
  // Una clave de alguien que no es miembro activo de ese negocio, tampoco.
  await falla(llamar("volver_instrucciones_de_seguimientos", {}, { workspaceId: "ws-1", userId: "dueno2" }), /Solo el dueño/);
  assert.equal(base.escrituras, 0);
  // La asesora sí puede leer.
  assert.equal((await llamar("ver_instrucciones_de_seguimientos", {}, asesora)).version, 0);

  // El administrador sí puede.
  const admin = await llamar("cambiar_instrucciones_de_seguimientos", { nivel: "global", texto: "Del admin.", confirmado: true, version_leida: 0 }, { workspaceId: "ws-1", userId: "admin" });
  assert.equal(admin.version, 1);

  // Un producto de otro negocio (por id o por nombre) no existe aquí.
  const antes = base.escrituras;
  await falla(llamar("cambiar_instrucciones_de_seguimientos", { nivel: "producto", producto: "prod-2", texto: "x", confirmado: true, version_leida: 1 }), /No existe el producto/);
  await falla(
    llamar("cambiar_instrucciones_de_seguimientos", { nivel: "producto", producto: "Producto del otro negocio", texto: "x" }),
    /No existe el producto/,
  );
  // Número fuera de rango.
  await falla(llamar("cambiar_instrucciones_de_seguimientos", { nivel: "numero", numero: 0, texto: "x" }), /de 1 a 10/);
  assert.equal(base.escrituras, antes);
});

await prueba("criterio 11: lo de un negocio no aparece en otro", async () => {
  reiniciar();
  await llamar("cambiar_instrucciones_de_seguimientos", { nivel: "global", texto: "Solo del negocio uno.", confirmado: true, version_leida: 0 });
  await llamar("cambiar_instrucciones_de_seguimientos", { nivel: "producto", producto: "prod-1", texto: "Añadido del uno.", confirmado: true, version_leida: 1 });
  const otro = { workspaceId: "ws-2", userId: "dueno2" };
  const v2 = await llamar("ver_instrucciones_de_seguimientos", {}, otro);
  assert.equal(v2.version, 0);
  assert.equal(v2.texto_global.es_el_de_siempre, true);
  assert.deepEqual(v2.por_producto, []);
  assert.deepEqual((await llamar("historial_de_instrucciones_de_seguimientos", {}, otro)).cambios, []);
  assert.equal(await instruccionesEnviadas({ workspaceId: "ws-2", conversationId: "conv-2" }), PEDIDO_DE_HOY);
  // Y el negocio uno sigue con lo suyo.
  assert.ok((await instruccionesEnviadas()).startsWith("Solo del negocio uno."));
  // Cambiar en el dos no toca el uno.
  await llamar("cambiar_instrucciones_de_seguimientos", { nivel: "global", texto: "Del dos.", confirmado: true, version_leida: 0 }, otro);
  assert.equal((await llamar("ver_instrucciones_de_seguimientos")).version, 2);
  assert.equal((await llamar("ver_instrucciones_de_seguimientos", {}, otro)).version, 1);
});

await prueba("quitar un añadido con texto vacío, y global vacío vuelve a las de siempre", async () => {
  reiniciar();
  await llamar("cambiar_instrucciones_de_seguimientos", { nivel: "numero", numero: 3, texto: "Algo para el tercero.", confirmado: true, version_leida: 0 });
  const quitar = await llamar("cambiar_instrucciones_de_seguimientos", { nivel: "numero", numero: 3, texto: "", version_leida: 1 });
  assert.ok(quitar.avisos.some((a) => /Se quita/.test(a)));
  await llamar("cambiar_instrucciones_de_seguimientos", { nivel: "numero", numero: 3, texto: "", confirmado: true, version_leida: 1 });
  assert.deepEqual((await llamar("ver_instrucciones_de_seguimientos")).por_numero_de_seguimiento, []);
  assert.equal(await instruccionesEnviadas({ paso: 3 }), PEDIDO_DE_HOY);
  // Mismo texto que el que hay: no hay cambio.
  await falla(llamar("cambiar_instrucciones_de_seguimientos", { nivel: "global", texto: "" }), /igual al que ya está/);
  // Un texto demasiado largo no se guarda.
  await falla(llamar("cambiar_instrucciones_de_seguimientos", { nivel: "global", texto: "a".repeat(4_001) }), /muy largo/);
});

await prueba("el historial guarda como mucho 30 versiones", async () => {
  reiniciar();
  for (let i = 0; i < 32; i += 1) {
    await llamar("cambiar_instrucciones_de_seguimientos", { nivel: "global", texto: `Versión ${i + 1}.`, confirmado: true, version_leida: i });
  }
  const h = await llamar("historial_de_instrucciones_de_seguimientos");
  assert.equal(h.version_actual, 32);
  assert.equal(h.cambios.length, 30);
  await falla(llamar("volver_instrucciones_de_seguimientos", { version: 1 }), /ya no está en el historial/);
  // La 0 siempre se puede.
  assert.equal((await llamar("volver_instrucciones_de_seguimientos", { version: 0 })).texto_global.es_el_de_siempre, true);
});

console.info = consola.info;
console.warn = consola.warn;
console.log(`\n${pruebas} pruebas OK`);
