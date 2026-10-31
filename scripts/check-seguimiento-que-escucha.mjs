// Pruebas del REVISOR DE SEGUIMIENTOS (seguimientos que escuchan al cliente, parte 1). Sin base ni red.
// Correr: npm run test:seguimiento-que-escucha
import assert from "node:assert/strict";

import { cargar } from "./supervisor-cargar.mjs";

const sq = cargar("src/features/seguimientos/dominio/seguimiento-que-escucha.ts");
const redaccion = cargar("src/lib/reglas-de-redaccion.ts");
const cf = cargar("src/features/seguimiento-inteligente/dominio/config.ts");
const ta = cargar("src/features/seguimiento-inteligente/dominio/tras-asesora.ts");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const T0 = new Date("2026-10-30T14:00:00Z");
const linea = (de, texto, min = 0) => ({ de, texto, en: new Date(T0.getTime() + min * 60_000) });

const CHARLA = [
  linea("cliente", "Hola, vi el anuncio de la camilla plegable", 0),
  linea("negocio", "¡Hola! Claro, te comparto fotos y el precio: $350.000 con envío incluido", 1),
  linea("cliente", "Me gusta la beige. Es para Pereira", 5),
];
const LIBRO = "Camilla plegable: $350.000. Envío a toda Colombia en 2 a 4 días hábiles. Pago contraentrega o transferencia.";
const BASE = { conversacion: CHARLA, yaEnviados: [], textoDelLibro: LIBRO };

/* ---------------------------------------------------------------------------------------------- */

prueba("acepta un texto que menciona la beige y termina en pregunta", () => {
  const texto = "Laura, la camilla beige para Pereira te llega en 2 a 4 días hábiles 🙌 ¿Te la separo?";
  assert.deepEqual(sq.revisarSeguimiento(texto, BASE), []);
});

prueba("rechaza las frases prohibidas (con y sin tilde, y sus variantes)", () => {
  const malas = [
    "¿Pudiste ver lo que te envié?",
    "¿Pudiste ver lo que te envie?",
    "Te escribo para saber si pudiste revisar la información ¿te ayudo?",
    "Te escribo para saber si pudiste revisar la informacion ¿te ayudo?",
    "Cualquier cosa, aquí estoy para ayudarte ¿te la separo?",
    "Cualquier cosa, aqui estoy para ayudarte ¿te la separo?",
    "Si te queda alguna duda me dices ¿te la separo?",
    "Si te quedan algunas dudas me dices ¿te la separo?",
    "¿Sigues interesada en la beige?",
    "La beige es linda, pero ¿te la separo?",
  ];
  for (const texto of malas) {
    assert.notDeepEqual(redaccion.frasesProhibidas(texto), [], texto);
    assert.notDeepEqual(sq.revisarSeguimiento(texto, BASE), [], texto);
  }
  // Lo que no es frase prohibida no se marca.
  assert.deepEqual(redaccion.frasesProhibidas("¿Pudiste medir el espacio para la camilla?"), []);
});

prueba("rechaza el texto que no termina en pregunta", () => {
  const problemas = sq.revisarSeguimiento("Laura, la camilla beige te llega a Pereira 🙌", BASE);
  assert.ok(problemas.some((p) => /pregunta/.test(p)), problemas.join(" | "));
});

prueba("rechaza los textos de más de 2 líneas", () => {
  const texto = "Laura, la beige\nte llega a Pereira\n¿Te la separo?";
  const problemas = sq.revisarSeguimiento(texto, BASE);
  assert.ok(problemas.some((p) => /3 líneas/.test(p)), problemas.join(" | "));
  // Dos líneas sí se aceptan.
  assert.deepEqual(sq.revisarSeguimiento("Laura, la beige te llega a Pereira\n¿Te la separo?", BASE), []);
});

prueba("rechaza un precio, cifra o fecha que no está ni en el libro ni en el chat", () => {
  const inventado = sq.revisarSeguimiento("Laura, hoy la beige te queda en $299.000 ¿Te la separo?", BASE);
  assert.ok(inventado.some((p) => /299\.000/.test(p)), inventado.join(" | "));
  const enMiles = sq.revisarSeguimiento("Laura, hoy la beige te queda en 280 mil ¿Te la separo?", BASE);
  assert.ok(enMiles.some((p) => /280 mil/.test(p)), enMiles.join(" | "));
  const fecha = sq.revisarSeguimiento("Laura, la beige te llega el viernes ¿Te la separo?", BASE);
  assert.ok(fecha.some((p) => /viernes/.test(p)), fecha.join(" | "));
  // El precio del libro (escrito distinto) sí vale, y uno que solo está en el chat también.
  assert.deepEqual(sq.revisarSeguimiento("Laura, la beige sigue en 350 mil ¿Te la separo?", BASE), []);
  const soloEnElChat = { ...BASE, textoDelLibro: null };
  assert.deepEqual(sq.revisarSeguimiento("Laura, la beige sigue en $350.000 ¿Te la separo?", soloEnElChat), []);
});

prueba("rechaza la repetición de un seguimiento ya enviado (aunque cambie el saludo, tildes o emojis)", () => {
  const ya = ["¡Hola, Laura! ¿Te ayudo con el envío a tu ciudad o con la forma de pago? 😊"];
  const problemas = sq.revisarSeguimiento("¡Hola! Te ayudo con el envio a tu ciudad o con la forma de pago?", {
    ...BASE,
    yaEnviados: ya,
  });
  assert.ok(problemas.some((p) => /ya enviado/.test(p)), problemas.join(" | "));
  // Uno distinto sí pasa.
  assert.deepEqual(
    sq.revisarSeguimiento("Laura, la beige para Pereira te llega en 2 a 4 días hábiles 🙌 ¿Te la separo?", { ...BASE, yaEnviados: ya }),
    [],
  );
  assert.ok(sq.parecido("a b c", "a b c") === 1 && sq.parecido("a b c", "x y z") === 0);
});

prueba("el cliente que solo mandó el anuncio recibe la pregunta del producto", () => {
  const texto = sq.seguimientoDelAnuncio("Camilla plegable");
  assert.equal(texto, "¿Te comparto fotos y medidas de Camilla plegable?");
  assert.deepEqual(sq.revisarSeguimiento(texto, { conversacion: [linea("cliente", "Hola, vi el anuncio")], yaEnviados: [], textoDelLibro: null }), []);
  assert.equal(sq.seguimientoDelAnuncio(null), null);
  assert.equal(sq.seguimientoDelAnuncio("   "), null);

  const pedido = sq.armarPedidoDeSeguimiento({
    lineas: [linea("cliente", "Hola, vi el anuncio de la camilla plegable")],
    producto: "Camilla plegable",
    paso: 1,
    yaEnviados: [],
    datosDelLibro: LIBRO,
    soloMandoElAnuncio: true,
  });
  assert.match(pedido.instrucciones, /solo mandó el texto del anuncio/);
  assert.match(pedido.contexto, /PRODUCTO QUE LE INTERESA: Camilla plegable/);
});

prueba("el pedido para la IA lleva la conversación, lo ya enviado, el libro y las reglas", () => {
  const pedido = sq.armarPedidoDeSeguimiento({
    lineas: CHARLA,
    producto: "Camilla plegable",
    paso: 2,
    yaEnviados: ["¿Te ayudo con el envío?"],
    datosDelLibro: LIBRO,
    soloMandoElAnuncio: false,
  });
  assert.match(pedido.instrucciones, /ESTE cliente dijo/);
  assert.match(pedido.instrucciones, /color, el producto, la ciudad, para cuándo/);
  assert.match(pedido.instrucciones, /algo nuevo o útil/);
  assert.match(pedido.instrucciones, /UNA sola pregunta fácil/);
  assert.match(pedido.instrucciones, /Máximo 2 líneas/);
  assert.doesNotMatch(pedido.instrucciones, /solo mandó el texto del anuncio/);
  assert.match(pedido.contexto, /Cliente: Me gusta la beige\. Es para Pereira/);
  assert.match(pedido.contexto, /Nosotros: ¡Hola! Claro/);
  assert.match(pedido.contexto, /- ¿Te ayudo con el envío\?/);
  assert.match(pedido.contexto, /SEGUIMIENTO NÚMERO: 2/);
  assert.match(pedido.contexto, /\$350\.000\. Envío a toda Colombia/);
});

prueba("elegirTexto: la cadena de respaldo IA → texto fijo → pregunta del producto → no se manda", () => {
  const buena = "Laura, la beige para Pereira te llega en 2 a 4 días hábiles 🙌 ¿Te la separo?";
  const mala1 = "¿Pudiste ver lo que te envié?";
  const mala2 = "Laura, hoy te queda en $199.000 ¿Te la separo?";
  const fijoBueno = "¡Hola, Laura! ¿Te ayudo con el envío a tu ciudad o con la forma de pago? 😊";
  const fijoMalo = "¡Hola, Laura! ¿Pudiste ver lo que te envié? 😊 Si te queda alguna duda, aquí estoy para ayudarte.";
  const base = { ...BASE, producto: "Camilla plegable" };

  // 1) La primera propuesta que pasa (aquí el 2º reintento).
  let r = sq.elegirTexto({ ...base, propuestas: [mala1, mala2, buena], textoFijo: fijoBueno });
  assert.equal(r.enviar, true);
  assert.equal(r.origen, "ia");
  assert.equal(r.texto, buena);
  assert.equal(r.descartados.length, 2);

  // Solo 3 intentos: una 4ª propuesta buena no se mira.
  r = sq.elegirTexto({ ...base, propuestas: [mala1, mala2, mala1, buena], textoFijo: fijoBueno });
  assert.equal(r.origen, "fijo");
  assert.equal(r.texto, fijoBueno);

  // 2) Sin propuestas que pasen: el texto fijo, solo si pasa la revisión.
  r = sq.elegirTexto({ ...base, propuestas: [], textoFijo: fijoBueno });
  assert.equal(r.origen, "fijo");

  // 3) El fijo no pasa (frases prohibidas, o ya se le mandó): la pregunta del producto.
  r = sq.elegirTexto({ ...base, propuestas: [mala1], textoFijo: fijoMalo });
  assert.equal(r.origen, "producto");
  assert.equal(r.texto, "¿Te comparto fotos y medidas de Camilla plegable?");
  r = sq.elegirTexto({ ...base, yaEnviados: [fijoBueno], propuestas: [], textoFijo: fijoBueno });
  assert.equal(r.origen, "producto");

  // 4) Sin producto: no se manda nada, con el motivo.
  r = sq.elegirTexto({ ...base, producto: null, propuestas: [mala1], textoFijo: fijoMalo });
  assert.equal(r.enviar, false);
  assert.match(r.motivo, /no se sabe el producto/);
  assert.equal(r.descartados.length, 2);
});

prueba("los textos fijos de 'Tras asesora' ya no son robóticos y pasan la revisión", () => {
  const textos = cf.CONFIG_POR_DEFECTO.trasAsesora.textos;
  assert.equal(textos.length, 2);
  for (const plantilla of textos) {
    for (const nombre of ["laura", null]) {
      const texto = ta.textoDelToque(plantilla, nombre);
      assert.deepEqual(redaccion.frasesProhibidas(texto), [], texto);
      assert.ok(redaccion.terminaEnPregunta(texto), texto);
      assert.deepEqual(sq.revisarSeguimiento(texto, { conversacion: [], yaEnviados: [], textoDelLibro: null }), [], texto);
    }
  }
  // Los dos toques no se parecen entre sí (el 2º no repite el 1º).
  const [uno, dos] = textos.map((t) => ta.textoDelToque(t, "laura"));
  assert.deepEqual(sq.revisarSeguimiento(dos, { conversacion: [], yaEnviados: [uno], textoDelLibro: null }), []);
});

/* ----------------------------------------------------------------------------------------------
   Parte 2: el redactor, con la base, el libro, la transcripción y OpenAI SIMULADOS.
---------------------------------------------------------------------------------------------- */

const fs = await import("node:fs");
const { RAIZ } = await import("./supervisor-cargar.mjs");
const path = await import("node:path");

const estado = {
  apagado: null,
  conversacion: true,
  activeProductContext: { productId: "prod-1" },
  producto: { name: "Silla Eames", price: 189000, description: "Silla de comedor en polipropileno.", activo: true },
  mensajes: [],
  transcripciones: {},
  actualizados: [],
  pedidos: [],
  respuestas: [],
};

const prismaSimulado = {
  appSetting: {
    findUnique: async ({ where }) => (where.key === "seguimientos-que-escuchan:apagado" && estado.apagado ? { value: estado.apagado } : null),
  },
  conversation: {
    findFirst: async () =>
      estado.conversacion
        ? { activeProductContext: estado.activeProductContext, messages: [...estado.mensajes].reverse().map((m) => ({ ...m })) }
        : null,
  },
  message: {
    update: async ({ where, data }) => {
      estado.actualizados.push({ id: where.id, ...data });
      return {};
    },
  },
  product: { findFirst: async () => estado.producto },
};

const LIBRO_V3 = "Pagas contraentrega o con anticipo del 50% y el envío es gratis a ciudades principales.";
const red = cargar("src/features/seguimientos/services/seguimiento-que-escucha.ts", {
  "@/lib/prisma": { prisma: prismaSimulado },
  "@/lib/transcripcion-de-audios": { transcribirAudioAhora: async (url) => estado.transcripciones[url] ?? null },
  "@/features/agente-v3/servicios/almacen": { leerLibro: async () => ({ comoHablamos: LIBRO_V3 }) },
});

// OpenAI simulado: guarda lo que se le pide y contesta lo que haya en la fila (null = falla).
globalThis.fetch = async (url, opciones) => {
  assert.equal(url, "https://api.openai.com/v1/chat/completions");
  const cuerpo = JSON.parse(opciones.body);
  assert.equal(cuerpo.model, "gpt-4.1-mini");
  assert.ok(opciones.signal, "la llamada lleva tiempo límite");
  estado.pedidos.push(cuerpo);
  const respuesta = estado.respuestas.shift();
  if (respuesta === undefined || respuesta === null) return { ok: false, status: 500, json: async () => ({}) };
  if (respuesta instanceof Error) throw respuesta;
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: respuesta } }] }) };
};

const M = (id, direction, type, content, min, extra = {}) => ({
  id,
  direction,
  type,
  content,
  mediaUrl: null,
  transcripcion: null,
  transcritoEn: null,
  rawPayload: null,
  createdAt: new Date(T0.getTime() + min * 60_000),
  ...extra,
});
const CHAT_CON_AUDIO = [
  M("m1", "INBOUND", "TEXT", "Hola, vi el anuncio de la silla", 0),
  M("m2", "OUTBOUND", "IMAGE", "Catálogo de sillas", 1, { mediaUrl: "/uploads/catalogo.jpg", rawPayload: { source: "manual" } }),
  M("m3", "OUTBOUND", "AUDIO", null, 2, { mediaUrl: "/uploads/asesora.ogg", transcripcion: "Te cuento que la tenemos en varios colores", transcritoEn: T0, rawPayload: { source: "manual" } }),
  M("m4", "INBOUND", "AUDIO", null, 10, { mediaUrl: "/uploads/cliente.ogg" }),
  M("m5", "OUTBOUND", "TEXT", "¡Hola, Laura! ¿Te ayudo con el envío a tu ciudad o con la forma de pago? 😊", 1500, { rawPayload: { source: "follow" } }),
];
const FIJO_BUENO = "Laura, ¿quieres que te muestre cómo queda en tu comedor?";
const FIJO_MALO = "¡Hola, Laura! ¿Pudiste ver lo que te envié? 😊 Si te queda alguna duda, aquí estoy para ayudarte.";
const ENTRADA = { conversationId: "c1", workspaceId: "w1", paso: 2, origen: "Sin responder 2" };

function reiniciar(cambios = {}) {
  Object.assign(estado, {
    apagado: null,
    conversacion: true,
    activeProductContext: { productId: "prod-1" },
    producto: { name: "Silla Eames", price: 189000, description: "Silla de comedor en polipropileno.", activo: true },
    mensajes: CHAT_CON_AUDIO.map((m) => ({ ...m })),
    transcripciones: { "/uploads/cliente.ogg": "Me gusta la silla palo rosa, es para Montería" },
    actualizados: [],
    pedidos: [],
    respuestas: [],
    ...cambios,
  });
  process.env.OPENAI_API_KEY = "clave-de-prueba";
  red.empezarVueltaDelRedactor();
}

async function pruebaAsync(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const BUENA_IA = "Laura, la silla palo rosa para Montería te la mandamos con pago contraentrega 🙌 ¿Te la separo?";

await pruebaAsync("redactor: el audio transcrito al momento ('silla palo rosa, Montería') llega a la IA y al mensaje", async () => {
  reiniciar({ respuestas: [BUENA_IA] });
  const r = await red.redactarSeguimientoQueEscucha({ ...ENTRADA, textoFijo: FIJO_BUENO });
  assert.equal(r.enviar, true);
  assert.equal(r.deIA, true);
  assert.equal(r.texto, BUENA_IA);
  assert.match(r.texto, /palo rosa/);
  assert.match(r.texto, /Montería/);
  assert.equal(r.textoReemplazado, FIJO_BUENO);
  // Se transcribió en el momento y se guardó (no se vuelve a pagar en el reloj).
  assert.equal(estado.actualizados.length, 1);
  assert.equal(estado.actualizados[0].id, "m4");
  assert.equal(estado.actualizados[0].transcripcion, "Me gusta la silla palo rosa, es para Montería");
  // Lo que vio la IA: el audio del cliente, el de la asesora, el catálogo, lo ya enviado, el libro y el producto.
  const pedido = estado.pedidos[0].messages.map((m) => m.content).join("\n");
  assert.match(pedido, /Cliente: \[nota de voz\] Me gusta la silla palo rosa, es para Montería/);
  assert.match(pedido, /Nosotros: \[nota de voz\] Te cuento que la tenemos en varios colores/);
  assert.match(pedido, /\[foto\] Catálogo de sillas/);
  assert.match(pedido, /YA SE LE ENVIÓ APARTE DEL TEXTO: 1 fotos; 1 notas de voz/);
  assert.match(pedido, /SEGUIMIENTOS YA ENVIADOS:\n- ¡Hola, Laura! ¿Te ayudo con el envío/);
  assert.match(pedido, /contraentrega o con anticipo del 50%/);
  assert.match(pedido, /PRODUCTO QUE LE INTERESA: Silla Eames/);
  assert.match(pedido, /SEGUIMIENTO NÚMERO: 2/);
  assert.doesNotMatch(pedido, /solo mandó el texto del anuncio/);
});

await pruebaAsync("redactor: lee la conversación completa, no solo las últimas líneas", async () => {
  const largo = [M("v0", "INBOUND", "TEXT", "Necesito 6 sillas para el 15 de diciembre", 0)];
  for (let i = 1; i <= 60; i += 1) largo.push(M(`v${i}`, i % 2 ? "OUTBOUND" : "INBOUND", "TEXT", `mensaje ${i}`, i));
  reiniciar({ mensajes: largo, respuestas: [BUENA_IA] });
  await red.redactarSeguimientoQueEscucha({ ...ENTRADA, textoFijo: FIJO_BUENO });
  const pedido = estado.pedidos[0].messages.map((m) => m.content).join("\n");
  assert.match(pedido, /LO QUE EL CLIENTE DIJO ANTES EN ESTA CONVERSACIÓN:\n- Necesito 6 sillas para el 15 de diciembre/);
});

await pruebaAsync("redactor: si la IA falla, sale el respaldo (texto fijo; si no pasa, la pregunta del producto)", async () => {
  reiniciar({ respuestas: [null] });
  let r = await red.redactarSeguimientoQueEscucha({ ...ENTRADA, textoFijo: FIJO_BUENO });
  assert.deepEqual([r.enviar, r.deIA, r.texto, r.textoReemplazado], [true, false, FIJO_BUENO, null]);
  assert.match(r.motivo, /no respondió/);

  reiniciar({ respuestas: [new Error("timeout")] });
  r = await red.redactarSeguimientoQueEscucha({ ...ENTRADA, textoFijo: FIJO_MALO });
  assert.deepEqual([r.enviar, r.deIA, r.texto], [true, false, "¿Te comparto fotos y medidas de Silla Eames?"]);
  assert.equal(r.textoReemplazado, FIJO_MALO);

  // Las 3 propuestas no pasan la revisión: se le devuelve a la IA con los problemas y sale el fijo.
  reiniciar({ respuestas: ["¿Pudiste ver lo que te envié?", "Laura, hoy te queda en $99.000 ¿Te la separo?", "Laura, la palo rosa es linda"] });
  r = await red.redactarSeguimientoQueEscucha({ ...ENTRADA, textoFijo: FIJO_BUENO });
  assert.equal(estado.pedidos.length, 3);
  assert.match(estado.pedidos[1].messages.at(-1).content, /no sirve/);
  assert.deepEqual([r.deIA, r.texto], [false, FIJO_BUENO]);

  // Sin producto y con un fijo que no pasa: no se manda (follows.ts lo anota como freno).
  reiniciar({ respuestas: [null], producto: null });
  r = await red.redactarSeguimientoQueEscucha({ ...ENTRADA, textoFijo: FIJO_MALO });
  assert.equal(r.enviar, false);
  assert.equal(r.esperarVuelta, false);
  assert.match(r.motivo, /no se sabe el producto/);
});

await pruebaAsync("redactor: sin clave de OpenAI o con el interruptor apagado sale el texto de antes, tal cual", async () => {
  reiniciar({ respuestas: [BUENA_IA] });
  delete process.env.OPENAI_API_KEY;
  let r = await red.redactarSeguimientoQueEscucha({ ...ENTRADA, textoFijo: FIJO_MALO });
  assert.deepEqual([r.enviar, r.deIA, r.texto, r.textoReemplazado], [true, false, FIJO_MALO, null]);
  assert.equal(estado.pedidos.length, 0);

  for (const valor of ["si", "Sí", "on"]) {
    reiniciar({ respuestas: [BUENA_IA], apagado: valor });
    r = await red.redactarSeguimientoQueEscucha({ ...ENTRADA, textoFijo: FIJO_MALO });
    assert.deepEqual([r.enviar, r.deIA, r.texto, r.textoReemplazado], [true, false, FIJO_MALO, null]);
    assert.equal(estado.pedidos.length, 0);
    assert.equal(estado.actualizados.length, 0, "apagado no transcribe nada");
  }
  // "no" no apaga.
  reiniciar({ respuestas: [BUENA_IA], apagado: "no" });
  r = await red.redactarSeguimientoQueEscucha({ ...ENTRADA, textoFijo: FIJO_BUENO });
  assert.equal(r.deIA, true);
});

await pruebaAsync("redactor: el cliente que solo mandó el anuncio recibe el pedido de la pregunta del producto", async () => {
  reiniciar({ mensajes: [M("a1", "INBOUND", "TEXT", "Hola, vi el anuncio de la silla", 0)], respuestas: ["Laura, ¿te comparto la silla en palo rosa o en blanco?"] });
  const r = await red.redactarSeguimientoQueEscucha({ ...ENTRADA, paso: 1, textoFijo: FIJO_BUENO });
  assert.equal(r.deIA, true);
  assert.match(estado.pedidos[0].messages[0].role === "system" ? estado.pedidos[0].messages[0].content : "", /solo mandó el texto del anuncio/);
});

await pruebaAsync("redactor: tope de redacciones por vuelta del reloj; los que no alcanzan esperan la siguiente", async () => {
  reiniciar();
  for (let i = 0; i < red.TOPE_POR_VUELTA; i += 1) {
    estado.respuestas.push(BUENA_IA);
    const r = await red.redactarSeguimientoQueEscucha({ ...ENTRADA, textoFijo: FIJO_BUENO });
    assert.equal(r.enviar, true);
  }
  const pedidosAntes = estado.pedidos.length;
  const r = await red.redactarSeguimientoQueEscucha({ ...ENTRADA, textoFijo: FIJO_BUENO });
  assert.equal(r.enviar, false);
  assert.equal(r.esperarVuelta, true);
  assert.equal(estado.pedidos.length, pedidosAntes, "pasado el tope no se llama a la IA");
  red.empezarVueltaDelRedactor();
  estado.respuestas.push(BUENA_IA);
  assert.equal((await red.redactarSeguimientoQueEscucha({ ...ENTRADA, textoFijo: FIJO_BUENO })).enviar, true);
});

await pruebaAsync("follows.ts: pide el texto después de todos los frenos, guarda la marca y no toca medios ni flujos", async () => {
  const src = fs.readFileSync(path.join(RAIZ, "src/features/seguimientos/services/follows.ts"), "utf8");
  const cuerpo = src.slice(src.indexOf("async function executeFollowRecord"), src.indexOf("export async function executePendingFollows"));
  const pos = (texto) => {
    const i = cuerpo.indexOf(texto);
    assert.ok(i >= 0, `falta «${texto}» en executeFollowRecord`);
    return i;
  };
  const redactor = pos("await redactarSiCorresponde(");
  for (const freno of ["revisarDiaSiguienteAlEnviar(", "revisarConvivencia(", "apagarSiCorresponde(", "revisarAntiBloqueoDelFollow(", "revisarFrenoDeAutomatico("]) {
    assert.ok(pos(freno) < redactor, `${freno} va antes del redactor`);
  }
  assert.ok(redactor < pos("sendFollowMessage({"), "el redactor va antes del envío");
  assert.match(cuerpo, /content: contenido,[\s\S]*?seguimientoQueEscucha: marcaDelSeguimiento/);
  assert.match(cuerpo, /redaccion\.deIA \? \{ deIA: true, textoReemplazado: redaccion\.textoReemplazado \}/);
  assert.match(cuerpo, /cancelarFollowFrenado\(follow, MOTIVO_SIN_TEXTO_QUE_PASE\)[\s\S]*?anotarFrenado\(/);
  assert.match(cuerpo, /reprogramarFollow\(follow, new Date\(Date\.now\(\) \+ 60_000\)\)/);
  // La marca llega al rawPayload del mensaje guardado.
  assert.match(src, /source: "follow",\s*evolution: input\.result\.raw,\s*\.\.\.\(input\.seguimientoQueEscucha \? \{ seguimientoQueEscucha: input\.seguimientoQueEscucha \} : \{\}\)/);
  // Solo automáticos de la escalera, de una sola acción de texto (sin medios ni flujo).
  const elegir = src.slice(src.indexOf("async function redactarSiCorresponde"), src.indexOf("async function executeFollowRecord"));
  assert.match(elegir, /clase !== "automatico" \|\| tipoDeSeguimiento\(follow\) !== "embudo"/);
  assert.match(elegir, /accion\.messageType !== "TEXT"/);
  assert.match(elegir, /accion\.mediaUrl\?\.trim\(\)/);
  assert.match(elegir, /accion\.flowId/);
  // El flujo de un seguimiento sale igual que antes.
  const flujo = src.slice(src.indexOf("async function enviarFlujoDelSeguimiento"), src.indexOf("async function reprogramarFollow"));
  assert.doesNotMatch(flujo, /redactar/);
  // El tope se reinicia en cada vuelta del reloj.
  assert.match(src, /export async function executePendingFollows[\s\S]*?empezarVueltaDelRedactor\(\);/);
});

console.log(`\n${pruebas} pruebas OK`);
