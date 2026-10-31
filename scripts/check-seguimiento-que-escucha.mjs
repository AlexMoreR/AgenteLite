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

console.log(`\n${pruebas} pruebas OK`);
