// Pruebas de SEGUIMIENTOS QUE ESCUCHAN AL CLIENTE: el revisor (parte 1) y el redactor con la IA y la base
// simuladas (parte 2), y el reloj de los seguimientos del V3 que pasa por el redactor (parte 3). Sin base ni red.
// Correr: npm run test:seguimiento-que-escucha
import assert from "node:assert/strict";

import { cargar } from "./supervisor-cargar.mjs";

const sq = cargar("src/features/seguimientos/dominio/seguimiento-que-escucha.ts");
const redaccion = cargar("src/lib/reglas-de-redaccion.ts");
const cf = cargar("src/features/seguimiento-inteligente/dominio/config.ts");
const ta = cargar("src/features/seguimiento-inteligente/dominio/tras-asesora.ts");

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
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

await prueba("acepta un texto que menciona la beige y termina en pregunta", () => {
  const texto = "Laura, la camilla beige para Pereira te llega en 2 a 4 días hábiles 🙌 ¿Te la separo?";
  assert.deepEqual(sq.revisarSeguimiento(texto, BASE), []);
});

await prueba("rechaza las frases prohibidas (con y sin tilde, y sus variantes)", () => {
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

await prueba("rechaza el texto que no termina en pregunta", () => {
  const problemas = sq.revisarSeguimiento("Laura, la camilla beige te llega a Pereira 🙌", BASE);
  assert.ok(problemas.some((p) => /pregunta/.test(p)), problemas.join(" | "));
});

await prueba("rechaza los textos de más de 2 líneas", () => {
  const texto = "Laura, la beige\nte llega a Pereira\n¿Te la separo?";
  const problemas = sq.revisarSeguimiento(texto, BASE);
  assert.ok(problemas.some((p) => /3 líneas/.test(p)), problemas.join(" | "));
  // Dos líneas sí se aceptan.
  assert.deepEqual(sq.revisarSeguimiento("Laura, la beige te llega a Pereira\n¿Te la separo?", BASE), []);
});

await prueba("rechaza un precio, cifra o fecha que no está ni en el libro ni en el chat", () => {
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

await prueba("rechaza la repetición de un seguimiento ya enviado (aunque cambie el saludo, tildes o emojis)", () => {
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

await prueba("el cliente que solo mandó el anuncio recibe la pregunta del producto", () => {
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

await prueba("el pedido para la IA lleva la conversación, lo ya enviado, el libro y las reglas", () => {
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

/* ----------------------------------------------------------------------------------------------
   Lo que el cliente ya dijo: la IA lo recibe para no volver a preguntarlo
---------------------------------------------------------------------------------------------- */

const pedidoCon = (lineas) =>
  sq.armarPedidoDeSeguimiento({ lineas, producto: "Camilla plegable", paso: 1, yaEnviados: [], datosDelLibro: LIBRO, soloMandoElAnuncio: false });
// Relleno de charla sin datos, para empujar un mensaje más allá de las últimas 30 líneas.
const relleno = (n, desde) =>
  Array.from({ length: n }, (_, i) => linea(i % 2 ? "negocio" : "cliente", i % 2 ? "Te cuento más detalles" : "ok", desde + i));

await prueba("el cliente dijo 'Bogotá': el pedido a la IA la trae como ciudad ya dicha, con las reglas nuevas", () => {
  const lineas = [
    linea("cliente", "Hola, vi el anuncio de la camilla", 0),
    linea("negocio", "¡Hola! ¿En qué ciudad estás?", 1),
    linea("cliente", "Bogotá", 2),
  ];
  assert.equal(sq.loQueDijoElCliente(lineas).ciudad, "Bogotá");
  const pedido = pedidoCon(lineas);
  assert.match(pedido.contexto, /LO QUE EL CLIENTE YA DIJO \(no lo vuelvas a preguntar\):\n- Ciudad: Bogotá/);
  assert.match(pedido.instrucciones, /Nunca preguntes lo que el cliente ya respondió/);
  assert.match(pedido.instrucciones, /A Bogotá te llega sin problema 🚚 ¿Te lo aparto con el 50 % para empezar a fabricarlo\?/);
  assert.match(pedido.instrucciones, /No des el valor del envío/);
  assert.match(pedido.instrucciones, /contraentrega solo aplica al Combo/);
  assert.match(pedido.instrucciones, /"envío gratis" junto con su condición: apartando con el 50 %/);
  assert.match(pedido.instrucciones, /San Andrés, Leticia, Inírida o Mitú no digas "te llega"/);
  assert.match(pedido.instrucciones, /ya separó, ya pagó o dijo que no le interesa, no le pidas apartar/);
  // Sin datos, el bloque lo dice.
  assert.match(pedidoCon([linea("cliente", "Hola", 0)]).contexto, /LO QUE EL CLIENTE YA DIJO \(no lo vuelvas a preguntar\):\n\(nada todavía\)/);
});

await prueba("la ciudad dicha a más de 30 líneas del final se encuentra, y también la de una nota de voz", () => {
  const lejos = [linea("cliente", "Soy de Medellín", 0), ...relleno(40, 1)];
  assert.equal(sq.loQueDijoElCliente(lejos).ciudad, "Medellín");
  const pedido = pedidoCon(lejos);
  // No está en la conversación recortada, pero sí en lo que ya dijo.
  assert.doesNotMatch(pedido.contexto, /Cliente: Soy de Medellín/);
  assert.match(pedido.contexto, /- Ciudad: Medellín/);

  const voz = [linea("cliente", "Hola", 0), linea("cliente", "[nota de voz] La quiero en palo rosa, es para Montería", 1), ...relleno(35, 2)];
  const dicho = sq.loQueDijoElCliente(voz);
  assert.equal(dicho.ciudad, "Montería");
  assert.equal(dicho.color, "palo rosa");
});

await prueba("'muy bello' no deja la ciudad Bello ni tapa un 'Bogotá' anterior; 'soy de Bello' sí cuenta", () => {
  assert.equal(sq.loQueDijoElCliente([linea("cliente", "Muy bello ese color 😍", 0)]).ciudad, null);
  const conBogota = [linea("cliente", "Es para Bogotá", 0), linea("negocio", "¡Listo! Mira la foto", 1), linea("cliente", "Muy bello", 2)];
  assert.equal(sq.loQueDijoElCliente(conBogota).ciudad, "Bogotá");
  // En el mismo mensaje también se sigue buscando.
  assert.equal(sq.loQueDijoElCliente([linea("cliente", "Muy bello, lo necesito en Pereira", 0)]).ciudad, "Pereira");
  assert.equal(sq.loQueDijoElCliente([linea("cliente", "Soy de Bello", 0)]).ciudad, "Bello");
  assert.equal(sq.loQueDijoElCliente([linea("cliente", "Me llamo Soledad", 0)]).ciudad, null);
  // "Cali" cuando pregunta dónde queda el negocio no es su ciudad.
  assert.equal(sq.loQueDijoElCliente([linea("cliente", "¿Ustedes están en Cali?", 0)]).ciudad, null);
  assert.equal(sq.loQueDijoElCliente([linea("cliente", "¿La tienda en Cali dónde queda?", 0)]).ciudad, null);
  assert.equal(sq.loQueDijoElCliente([linea("cliente", "Vivo en Cali", 0)]).ciudad, "Cali");
  // Lo que dijo el negocio no cuenta como ciudad del cliente.
  assert.equal(sq.loQueDijoElCliente([linea("negocio", "Enviamos a Bogotá", 0)]).ciudad, null);
});

await prueba("ciudad sin cobertura, color, fecha, servicio, contraentrega y 'no me interesa'", () => {
  const san = sq.loQueDijoElCliente([linea("cliente", "Soy de San Andrés", 0)]);
  assert.equal(san.ciudad, "San Andrés");
  assert.equal(san.ciudadSinCobertura, true);
  assert.match(pedidoCon([linea("cliente", "Soy de San Andrés", 0)]).contexto, /- Ciudad: San Andrés \(no hay envío asegurado/);
  assert.equal(sq.loQueDijoElCliente([linea("cliente", "Bogotá", 0)]).ciudadSinCobertura, false);

  const dicho = sq.loQueDijoElCliente([
    linea("cliente", "Tengo un salón de uñas, me gusta la beige", 0),
    linea("cliente", "La necesito para el viernes", 1),
    linea("cliente", "¿Manejan contraentrega?", 2),
  ]);
  assert.equal(dicho.color, "beige");
  assert.equal(dicho.fecha, "la necesito para el viernes");
  assert.equal(dicho.servicio, "uñas");
  assert.equal(dicho.pidioContraentrega, true);
  assert.equal(dicho.noLeInteresa, false);
  assert.equal(sq.loQueDijoElCliente([linea("cliente", "Es para diciembre", 0)]).fecha, "para diciembre");
  assert.equal(sq.loQueDijoElCliente([linea("cliente", "Tengo una barbería", 0)]).servicio, "barbería");
  // "unas sillas" no es un salón de uñas.
  assert.equal(sq.loQueDijoElCliente([linea("cliente", "Quiero unas sillas", 0)]).servicio, null);

  assert.equal(sq.loQueDijoElCliente([linea("cliente", "Gracias, ya no me interesa", 0)]).noLeInteresa, true);
  assert.equal(sq.loQueDijoElCliente([linea("cliente", "[nota de voz] No me interesa, gracias", 0)]).noLeInteresa, true);
  assert.equal(sq.loQueDijoElCliente([linea("cliente", "No me interesa el negro, sí la beige", 0)]).noLeInteresa, false);
});

await prueba("quien confirmó la compra queda con yaCompro (y el pedido lo dice)", () => {
  const lineas = [
    linea("cliente", "Me gusta la beige, soy de Cali", 0),
    linea("negocio", "¡Perfecta elección! ¿Te la separo?", 1),
    linea("cliente", "Sí", 2),
  ];
  assert.equal(sq.loQueDijoElCliente(lineas).yaCompro, true);
  assert.match(pedidoCon(lineas).contexto, /- Ya confirmó la compra o el pago: no le pidas apartar/);
  // El comprobante (una foto después de hablar del pago) también cuenta.
  const conFoto = [linea("negocio", "Te paso la cuenta Bancolombia para el pago", 0), linea("cliente", "[foto] ", 1)];
  assert.equal(sq.loQueDijoElCliente(conFoto).yaCompro, true);
  assert.equal(sq.loQueDijoElCliente(CHARLA).yaCompro, false);
  // El "ahora" es la hora de la última línea: una charla vieja da lo mismo hoy que mañana.
  const vieja = lineas.map((l) => ({ ...l, en: new Date(l.en.getTime() - 400 * 86_400_000) }));
  assert.equal(sq.loQueDijoElCliente(vieja).yaCompro, true);
});

await prueba("elegirTexto: la cadena de respaldo IA → texto fijo → pregunta del producto → no se manda", () => {
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

await prueba("los textos fijos de 'Tras asesora' ya no son robóticos y pasan la revisión", () => {
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
   Parte 2: el redactor, con la base y la IA simuladas
---------------------------------------------------------------------------------------------- */

const TF = new Date("2026-10-28T15:00:00Z");
const msg = (id, direction, type, content, min, extra = {}) => ({
  id,
  direction,
  type,
  content,
  mediaUrl: null,
  transcripcion: null,
  transcritoEn: null,
  createdAt: new Date(TF.getTime() + min * 60_000),
  ...extra,
});

// La base de mentira: lo que el redactor lee y lo que escribe.
const base = {
  apagado: null,
  mensajes: [],
  transcritos: [],
  enviados: [],
};
function reiniciarBase() {
  base.apagado = null;
  base.transcritos = [];
  base.enviados = [{ content: "¡Hola, Laura! ¿Te ayudo con el envío a tu ciudad o con la forma de pago? 😊", createdAt: new Date(TF.getTime() + 60 * 60_000) }];
  // De la más nueva a la más vieja, como los pide el redactor (orderBy createdAt desc).
  base.mensajes = [
    msg("m1", "INBOUND", "TEXT", "Hola, vi el anuncio de la silla", 0),
    msg("m2", "OUTBOUND", "IMAGE", "Silla Isabela", 1, { mediaUrl: "https://x/foto.jpg" }),
    msg("m3", "OUTBOUND", "DOCUMENT", "CATALOGO SILLAS.pdf", 2, { mediaUrl: "https://x/cat.pdf" }),
    msg("m4", "INBOUND", "AUDIO", null, 10, { mediaUrl: "https://x/audio-cliente.ogg" }),
    msg("m5", "OUTBOUND", "AUDIO", null, 12, { mediaUrl: "https://x/audio-asesora.ogg", transcripcion: "Claro, la silla Isabela vale 450.000 con envío", transcritoEn: new Date() }),
    msg("m6", "SYSTEM", "SYSTEM", "aviso del sistema", 13),
  ].reverse();
}

const prismaFalso = {
  appSetting: {
    findUnique: async ({ where }) => (where.key === "seguimientos-que-escuchan:apagado" && base.apagado ? { value: base.apagado } : null),
  },
  conversation: {
    findFirst: async ({ where }) =>
      where.id === "conv-1" && where.workspaceId === "ws-1"
        ? { activeProductContext: { productId: "prod-1" }, messages: base.mensajes.map((m) => ({ ...m })) }
        : null,
  },
  message: {
    updateMany: async ({ where, data }) => {
      base.transcritos.push({ id: where.id, ...data });
      return { count: 1 };
    },
    findMany: async () => base.enviados,
  },
  product: {
    findFirst: async () => ({ name: "Silla Isabela", price: 450000, description: "Silla tapizada en varios colores", activo: true }),
  },
};

const audiosFalsos = {
  transcribirAudioAhora: async (url) => (url.includes("audio-cliente") ? "La quiero en palo rosa para Montería" : null),
};
const libroFalso = {
  leerLibro: async () => ({ comoHablamos: "Envío gratis a ciudades principales con anticipo del 50%. Contraentrega pagando solo el envío." }),
};

const redactor = cargar("src/features/seguimientos/services/seguimiento-que-escucha.ts", {
  "@/lib/prisma": { prisma: prismaFalso },
  "@/lib/transcripcion-de-audios": audiosFalsos,
  "@/features/agente-v3/servicios/almacen": libroFalso,
});

// La IA de mentira: guarda lo que se le pidió y contesta lo que diga `ia.respuestas` (en orden).
const ia = { pedidos: [], respuestas: [], falla: false };
globalThis.fetch = async (url, opciones) => {
  assert.equal(url, "https://api.openai.com/v1/chat/completions");
  const cuerpo = JSON.parse(opciones.body);
  ia.pedidos.push(cuerpo);
  assert.equal(cuerpo.model, "gpt-4.1-mini");
  assert.ok(opciones.signal, "la llamada lleva tiempo límite");
  if (ia.falla) throw new Error("timeout");
  const texto = ia.respuestas.shift() ?? "";
  return { ok: true, json: async () => ({ choices: [{ message: { content: texto } }] }) };
};
function reiniciarIa(respuestas = []) {
  ia.pedidos = [];
  ia.respuestas = [...respuestas];
  ia.falla = false;
}

const FIJO = "¡Hola, Laura! ¿Pudiste ver lo que te envié? 😊";
const FIJO_BUENO = "¡Hola, Laura! ¿Te muestro otros colores de la silla? 😊";
const BUENA = "Laura, la silla Isabela en palo rosa te llega a Montería con envío gratis pagando el anticipo 🙌 ¿Te la separo?";
const ENTRADA = { conversationId: "conv-1", workspaceId: "ws-1", textoFijo: FIJO, paso: null, origen: "follow" };
const consolaOriginal = { info: console.info, warn: console.warn };
console.info = () => {};
console.warn = () => {};

async function redactar(entrada = ENTRADA) {
  redactor.reiniciarTopeDeLaVuelta();
  return redactor.redactarSeguimientoQueEscucha(entrada);
}

process.env.OPENAI_API_KEY = "clave-de-prueba";

await prueba("el audio transcrito del cliente ('palo rosa, Montería') llega a la IA y sale su texto, con la marca", async () => {
  reiniciarBase();
  reiniciarIa([BUENA]);
  const r = await redactar();
  assert.equal(r.enviar, true);
  assert.equal(r.deIA, true);
  assert.equal(r.texto, BUENA);
  assert.equal(r.textoReemplazado, FIJO);
  // El audio sin texto se transcribió en el momento y se guardó en el mensaje.
  assert.deepEqual(base.transcritos.map((t) => [t.id, t.transcripcion]), [["m4", "La quiero en palo rosa para Montería"]]);
  // Lo que vio la IA: el audio del cliente, el de la asesora, la foto, el catálogo, lo ya enviado y el libro.
  const contexto = ia.pedidos[0].messages.find((m) => m.role === "user").content;
  assert.match(contexto, /Cliente: \[nota de voz\] La quiero en palo rosa para Montería/);
  assert.match(contexto, /Nosotros: \[nota de voz\] Claro, la silla Isabela vale 450\.000/);
  assert.match(contexto, /Nosotros: \[foto\] Silla Isabela/);
  assert.match(contexto, /Nosotros: \[documento\] CATALOGO SILLAS\.pdf/);
  assert.match(contexto, /- ¡Hola, Laura! ¿Te ayudo con el envío/);
  assert.match(contexto, /PRODUCTO QUE LE INTERESA: Silla Isabela/);
  assert.match(contexto, /Envío gratis a ciudades principales/);
  assert.match(contexto, /SEGUIMIENTO NÚMERO: 2/);
  assert.doesNotMatch(contexto, /aviso del sistema/);
  // El cliente escribió después del anuncio: no se le pide la pregunta del anuncio.
  assert.doesNotMatch(ia.pedidos[0].messages[0].content, /solo mandó el texto del anuncio/);
  // La marca que va al rawPayload del mensaje enviado.
  assert.deepEqual(redactor.marcaDelSeguimiento(r), { seguimientoQueEscucha: { deIA: true, textoReemplazado: FIJO } });
});

await prueba("si la IA propone algo que no pasa la revisión, se le pide otra (hasta 3)", async () => {
  reiniciarBase();
  reiniciarIa(["¿Pudiste ver lo que te envié?", "Laura, hoy te queda en $199.000 ¿Te la separo?", BUENA]);
  const r = await redactar();
  assert.equal(ia.pedidos.length, 3);
  assert.equal(r.texto, BUENA);
  assert.match(ia.pedidos[1].messages.at(-1).content, /no cumple/);
});

await prueba("si la IA falla, sale el respaldo: el texto fijo si pasa la revisión, si no la pregunta del producto", async () => {
  reiniciarBase();
  reiniciarIa();
  ia.falla = true;
  let r = await redactar({ ...ENTRADA, textoFijo: FIJO_BUENO });
  assert.equal(r.enviar, true);
  assert.equal(r.deIA, false);
  assert.equal(r.texto, FIJO_BUENO);
  assert.equal(r.textoReemplazado, null);
  assert.equal(redactor.marcaDelSeguimiento(r), null);

  // El fijo trae una frase prohibida: sale la pregunta del producto (y se marca lo reemplazado).
  r = await redactar();
  assert.equal(r.texto, "¿Te comparto fotos y medidas de Silla Isabela?");
  assert.equal(r.deIA, false);
  assert.deepEqual(redactor.marcaDelSeguimiento(r), { seguimientoQueEscucha: { deIA: false, textoReemplazado: FIJO } });
});

await prueba("sin la clave de OpenAI sale el texto fijo tal cual, sin leer nada ni llamar a la IA", async () => {
  reiniciarBase();
  reiniciarIa([BUENA]);
  delete process.env.OPENAI_API_KEY;
  const r = await redactar();
  process.env.OPENAI_API_KEY = "clave-de-prueba";
  assert.deepEqual(
    { enviar: r.enviar, texto: r.texto, deIA: r.deIA, textoReemplazado: r.textoReemplazado },
    { enviar: true, texto: FIJO, deIA: false, textoReemplazado: null },
  );
  assert.equal(ia.pedidos.length, 0);
  assert.equal(base.transcritos.length, 0);
});

await prueba("con el interruptor apagado sale el texto de antes", async () => {
  reiniciarBase();
  reiniciarIa([BUENA]);
  base.apagado = "si";
  const r = await redactar();
  assert.equal(r.texto, FIJO);
  assert.equal(r.deIA, false);
  assert.equal(ia.pedidos.length, 0);
  assert.equal(redactor.marcaDelSeguimiento(r), null);
});

await prueba("cliente que solo mandó el anuncio: se le pide a la IA la pregunta del producto", async () => {
  reiniciarBase();
  base.mensajes = [msg("m1", "INBOUND", "TEXT", "Hola, vi el anuncio de la silla", 0)];
  reiniciarIa(["¿Te comparto los colores de la Silla Isabela?"]);
  const r = await redactar();
  assert.match(ia.pedidos[0].messages[0].content, /solo mandó el texto del anuncio/);
  assert.equal(r.deIA, true);
});

await prueba("ningún texto pasa y no se sabe el producto: no se manda (con el motivo)", async () => {
  reiniciarBase();
  reiniciarIa(["¿Pudiste ver lo que te envié?", "¿Pudiste ver lo que te envié?", "¿Pudiste ver lo que te envié?"]);
  const original = prismaFalso.product.findFirst;
  prismaFalso.product.findFirst = async () => null;
  const r = await redactar();
  prismaFalso.product.findFirst = original;
  assert.equal(r.enviar, false);
  assert.equal(r.reprogramar, false);
  assert.equal(r.motivo, redactor.MOTIVO_SIN_TEXTO);
});

await prueba("tope por vuelta del reloj: los que no alcanzan van a la vuelta siguiente", async () => {
  reiniciarBase();
  redactor.reiniciarTopeDeLaVuelta();
  const resultados = [];
  for (let i = 0; i < redactor.REDACCIONES_POR_VUELTA + 1; i += 1) {
    reiniciarIa([BUENA]);
    resultados.push(await redactor.redactarSeguimientoQueEscucha(ENTRADA));
  }
  assert.ok(resultados.slice(0, -1).every((r) => r.enviar && r.deIA));
  const ultimo = resultados.at(-1);
  assert.equal(ultimo.enviar, false);
  assert.equal(ultimo.reprogramar, true);
  assert.equal(ultimo.motivo, redactor.MOTIVO_TOPE_DE_LA_VUELTA);
});

await prueba("si la base falla, sale el texto fijo (el redactor nunca frena un envío por un error suyo)", async () => {
  reiniciarBase();
  reiniciarIa([BUENA]);
  const original = prismaFalso.conversation.findFirst;
  prismaFalso.conversation.findFirst = async () => {
    throw new Error("base caída");
  };
  const r = await redactar();
  prismaFalso.conversation.findFirst = original;
  assert.equal(r.enviar, true);
  assert.equal(r.texto, FIJO);
});

await prueba("follows.ts: pide el texto al redactor antes de los 2 envíos de texto y guarda la marca en el rawPayload", async () => {
  const fs = await import("node:fs");
  const codigo = fs.readFileSync(new URL("../src/features/seguimientos/services/follows.ts", import.meta.url), "utf8");
  // Solo los automáticos, y después de todos los frenos (el redactor se arma tras el freno de 3 seguidos).
  assert.match(codigo, /const redactar = clase === "automatico" \? redactorDelFollow\(follow\) : null;/);
  assert.ok(codigo.indexOf("const redactar = clase") > codigo.indexOf("revisarFrenoDeAutomatico({"));
  // Los dos envíos (el flujo y el texto) guardan la marca, y el rawPayload la lleva.
  assert.equal(codigo.match(/marca: marcaDelSeguimiento\(redactado\)/g)?.length, 2);
  assert.match(codigo, /source: "follow",\s*evolution: input\.result\.raw,\s*\.\.\.\(input\.marca \?\? \{\}\)/);
  // enviar:false no se manda: se cancela o se corre a la vuelta siguiente, y se anota.
  assert.match(codigo, /if \(redactado && !redactado\.enviar\) throw new FrenoDelRedactor\(redactado\);/);
  assert.match(codigo, /error instanceof FrenoDelRedactor/);
});

/* ----------------------------------------------------------------------------------------------
   Parte 3: los seguimientos de 15 min y 1 h del V3 pasan por el redactor (base, WhatsApp e IA simulados)
---------------------------------------------------------------------------------------------- */

const AHORA_V3 = new Date(TF.getTime() + 120 * 60_000);
const TEXTO_15 = "¡Hola, Laura! ¿Te ayudo con el envío o con la forma de pago? 😊";
const TEXTO_60 = "Laura, ¿te muestro otras fotos de la silla? 😊";
const v3 = { mandados: [], creados: [], estados: [], frenados: [], ultimoEn: null, estado: null };
function reiniciarV3() {
  v3.mandados = [];
  v3.creados = [];
  v3.estados = [];
  v3.frenados = [];
  v3.estado = { seguimientosEnviados: [], flujosEnviados: [], pasoActual: null, productoActivo: null };
}
// El último mensaje nuestro fue hace 20 minutos: vence el de 15, no el de 1 h.
v3.ultimoEn = new Date(AHORA_V3.getTime() - 20 * 60_000);

// Lo que el reloj del V3 lee y escribe, sobre la misma base de mentira del redactor.
prismaFalso.whatsAppChannel = {
  findMany: async () => [{ id: "canal-1", workspaceId: "ws-1", evolutionInstanceName: "ventas-1" }],
};
prismaFalso.conversation.findMany = async () => [
  { id: "conv-1", lastMessageAt: v3.ultimoEn, contactId: "contacto-1", contact: { phoneNumber: "573001112233" } },
];
prismaFalso.message.findFirst = async () => ({ direction: "OUTBOUND", createdAt: v3.ultimoEn });
prismaFalso.message.create = async ({ data }) => {
  v3.creados.push(data);
  return data;
};

const reglaV3 = (id, minutos, texto) => ({
  id,
  nombre: `Sin respuesta ${minutos} min`,
  activa: true,
  cuando: { tipo: "sin_respuesta", minutos },
  entonces: [{ tipo: "mensaje", texto }],
});

const relojV3 = cargar("src/features/agente-v3/servicios/seguimientos.ts", {
  "@/lib/prisma": { prisma: prismaFalso },
  "@/features/embudo/servicios/eventos": { registrarSeguimientoEnviado: () => {} },
  "@/lib/chat-resuelto-sql": { WHERE_CHAT_ABIERTO: {} },
  "@/lib/evolution": {
    sendEvolutionTextMessageWithReconnect: async (envio) => {
      v3.mandados.push(envio.text);
      return { ok: true };
    },
  },
  "@/lib/anti-bloqueo/servicio": {
    anotarFrenado: (fila) => v3.frenados.push(fila.motivo),
    leerConfigAntiBloqueo: async () => ({ horario: { activo: false } }),
    marcarEnvioAutomatico: async () => {},
    revisarAntiBloqueo: async () => ({ enviar: true }),
  },
  "@/lib/freno-de-automaticos": { revisarFrenoDeAutomatico: async () => ({ enviar: true }) },
  "@/features/seguimientos/services/follows": { apagarSiCorresponde: async () => null },
  "@/features/seguimiento-inteligente/servicios/convivencia": { revisarConvivencia: async () => null },
  "../motor/estado": {
    elV3AtendioLaCharla: async () => true,
    leerEstado: async () => ({ ...v3.estado }),
    guardarEstado: async (_id, estado) => v3.estados.push(estado),
  },
  "./almacen": { leerLibro: async () => ({ reglas: [reglaV3("r15", 15, TEXTO_15), reglaV3("r60", 60, TEXTO_60)] }) },
});

async function correrRelojV3() {
  redactor.reiniciarTopeDeLaVuelta();
  return relojV3.ejecutarSeguimientosV3(AHORA_V3);
}

await prueba("V3, 15 min: el cliente dijo 'color beige me interesa' y el seguimiento habla de la beige (origen -ia, con la marca)", async () => {
  reiniciarBase();
  reiniciarV3();
  base.enviados = [];
  base.mensajes = [
    msg("m1", "INBOUND", "TEXT", "Hola, vi el anuncio de la silla", 0),
    msg("m2", "OUTBOUND", "IMAGE", "Silla Isabela", 1, { mediaUrl: "https://x/foto.jpg" }),
    msg("m3", "INBOUND", "TEXT", "color beige me interesa", 10),
    msg("m4", "OUTBOUND", "TEXT", "¡Claro! La Silla Isabela vale 450.000", 11),
  ].reverse();
  const BEIGE = "Laura, la silla Isabela en beige queda divina 🙌 ¿Te la separo?";
  reiniciarIa([BEIGE]);
  const r = await correrRelojV3();
  assert.equal(r.enviados, 1);
  // La IA leyó lo que dijo el cliente y supo que es el seguimiento número 1 (el de 15 min).
  const contexto = ia.pedidos[0].messages.find((m) => m.role === "user").content;
  assert.match(contexto, /Cliente: color beige me interesa/);
  assert.match(contexto, /SEGUIMIENTO NÚMERO: 1/);
  // Salió UN mensaje, el de la IA, que menciona la beige.
  assert.deepEqual(v3.mandados, [BEIGE]);
  assert.match(v3.mandados[0], /beige/i);
  assert.equal(v3.creados.length, 1);
  assert.equal(v3.creados[0].rawPayload.source, "agente-v3-seguimiento-ia");
  assert.deepEqual(v3.creados[0].rawPayload.seguimientoQueEscucha, { deIA: true, textoReemplazado: TEXTO_15 });
  // Queda marcado el de 15 (no el de 1 h, que todavía no venció).
  assert.deepEqual(v3.estados.at(-1).seguimientosEnviados, [15]);
});

await prueba("V3: el cliente que solo mandó el anuncio recibe la pregunta del producto", async () => {
  reiniciarBase();
  reiniciarV3();
  base.mensajes = [msg("m1", "INBOUND", "TEXT", "Hola, vi el anuncio de la silla", 0)];
  // El texto del libro ya le llegó y la IA no responde: sale la pregunta del producto del anuncio.
  base.enviados = [{ content: TEXTO_15, createdAt: new Date(TF.getTime() + 5 * 60_000) }];
  reiniciarIa();
  ia.falla = true;
  const r = await correrRelojV3();
  assert.equal(r.enviados, 1);
  assert.match(ia.pedidos[0].messages[0].content, /solo mandó el texto del anuncio/);
  assert.deepEqual(v3.mandados, ["¿Te comparto fotos y medidas de Silla Isabela?"]);
  // No lo escribió la IA: queda el origen de siempre, con la marca de lo que se cambió.
  assert.equal(v3.creados[0].rawPayload.source, "agente-v3-seguimiento");
  assert.deepEqual(v3.creados[0].rawPayload.seguimientoQueEscucha, { deIA: false, textoReemplazado: TEXTO_15 });
});

await prueba("V3 con el interruptor apagado: sale el texto de la regla del libro sin cambios", async () => {
  reiniciarBase();
  reiniciarV3();
  base.apagado = "si";
  reiniciarIa(["Laura, la silla Isabela en beige queda divina 🙌 ¿Te la separo?"]);
  const r = await correrRelojV3();
  assert.equal(r.enviados, 1);
  assert.equal(ia.pedidos.length, 0);
  assert.deepEqual(v3.mandados, [TEXTO_15]);
  assert.equal(v3.creados[0].rawPayload.source, "agente-v3-seguimiento");
  assert.equal(v3.creados[0].rawPayload.seguimientoQueEscucha, undefined);
});

await prueba("V3: si ningún texto pasa, no se manda nada, se anota el motivo y no se vuelve a pedir cada minuto", async () => {
  reiniciarBase();
  reiniciarV3();
  base.enviados = [{ content: TEXTO_15, createdAt: new Date(TF.getTime() + 5 * 60_000) }];
  reiniciarIa();
  ia.falla = true;
  const original = prismaFalso.product.findFirst;
  prismaFalso.product.findFirst = async () => null;
  const r = await correrRelojV3();
  prismaFalso.product.findFirst = original;
  assert.equal(r.enviados, 0);
  assert.equal(r.frenados, 1);
  assert.deepEqual(v3.mandados, []);
  assert.deepEqual(v3.frenados, [redactor.MOTIVO_SIN_TEXTO]);
  assert.deepEqual(v3.estados.at(-1).seguimientosEnviados, [15]);
});

await prueba("V3: con el tope de la vuelta lleno no sale ni se marca: va en la vuelta siguiente", async () => {
  reiniciarBase();
  reiniciarV3();
  redactor.reiniciarTopeDeLaVuelta();
  for (let i = 0; i < redactor.REDACCIONES_POR_VUELTA; i += 1) {
    reiniciarIa([BUENA]);
    await redactor.redactarSeguimientoQueEscucha(ENTRADA);
  }
  reiniciarIa([BUENA]);
  const r = await relojV3.ejecutarSeguimientosV3(AHORA_V3);
  assert.equal(r.enviados, 0);
  assert.deepEqual(v3.mandados, []);
  assert.deepEqual(v3.frenados, [redactor.MOTIVO_TOPE_DE_LA_VUELTA]);
  assert.equal(v3.estados.length, 0);
});

await prueba("seguimientos.ts del V3: el redactor va después del anti-bloqueo y del freno, y antes del envío", async () => {
  const fs = await import("node:fs");
  const codigo = fs.readFileSync(new URL("../src/features/agente-v3/servicios/seguimientos.ts", import.meta.url), "utf8");
  const enRedactor = codigo.indexOf("await redactarSeguimientoQueEscucha({");
  assert.ok(enRedactor > codigo.indexOf("revisarFrenoDeAutomatico({"));
  assert.ok(enRedactor > codigo.indexOf("revisarAntiBloqueo({"));
  assert.ok(enRedactor < codigo.indexOf("sendEvolutionTextMessageWithReconnect({"));
  assert.match(codigo, /redactado\.deIA \? "agente-v3-seguimiento-ia" : "agente-v3-seguimiento"/);
});

console.info = consolaOriginal.info;
console.warn = consolaOriginal.warn;

console.log(`\n${pruebas} pruebas OK`);
