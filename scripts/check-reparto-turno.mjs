// Pruebas del REPARTO POR TURNO con la regla "solo tras precio o fotos" (Alex, 12-10-2026):
// src/lib/turno-con-contenido.ts. Sin base ni red. Correr: npm run test:reparto-turno
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

const t = cargar("src/lib/turno-con-contenido.ts");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

// Se escriben del más VIEJO al más nuevo y se invierten: la función recibe del más nuevo al más viejo.
const chat = (...mensajes) => [...mensajes].reverse();
const IN = (content, type = "TEXT") => ({ direction: "INBOUND", type, content, origen: "webhook" });
const BOT = (content, type = "TEXT") => ({ direction: "OUTBOUND", type, content, origen: null });
const ECO = (content, type = "TEXT") => ({ direction: "OUTBOUND", type, content, origen: "api" });
const SEGUIMIENTO = (content, type = "TEXT") => ({ direction: "OUTBOUND", type, content, origen: "agente-v3-seguimiento" });
const ASESORA = (content, type = "TEXT") => ({ direction: "OUTBOUND", type, content, origen: "manual" });
const CELULAR = (content, type = "TEXT") => ({ direction: "OUTBOUND", type, content, origen: "instance" });

const ANUNCIO = "Hola, me interesa el *COMBO* de estética (camilla, escalera, silla y auxiliar)";
const BIENVENIDA =
  "Bienvenid@ a *Magilus* 👑\nFabricantes de mobiliario para *peluquerías, barbería, spa y salones de belleza.*\n\n📲 Síguenos:\nInstagram.com/magilus.co";
const SERVICIOS = "¿Qué servicios vas a ofrecer en tu espacio - *masajes, estética facial, tratamientos corporales*?";
const PASO_2 =
  "¡Perfecto! Nuestra *camilla* 💆 soporta hasta *200 kg* y el respaldo es ajustable, *cómoda* para trabajar en cualquier posición.\n\n¿Te comparto *fotos* o tienes alguna *pregunta en particular?*";
const PRECIO =
  "El *Combo Camillas* está en *$989.000* 💆 (camilla, escalera, silla y auxiliar), con *garantía de 1 año*.  ¿En qué *ciudad* estás?";
const PRECIO_SIN_SIGNO = "Ya te comparto las *fotos*, el precio el *989.000* envio gratis a ciudades principales";
const SI = { exigirPrecioOFotos: true };

/* 1. Precio en texto */
prueba("textoConPrecio: $989.000, 'el precio el 989.000', '$ 450.000', '450 mil pesos', '$494.500'", () => {
  assert.equal(t.textoConPrecio(PRECIO), true);
  assert.equal(t.textoConPrecio(PRECIO_SIN_SIGNO), true);
  assert.equal(t.textoConPrecio("La camilla sola: $ 450.000"), true);
  assert.equal(t.textoConPrecio("la camilla vale 450 mil pesos"), true);
  assert.equal(t.textoConPrecio("Lo separas con el *50%* (*$494.500*)"), true);
});
prueba("textoConPrecio: bienvenida, '200 kg', '50 %', '1 año', teléfonos, medidas y 'precio' sin cifra NO", () => {
  assert.equal(t.textoConPrecio(BIENVENIDA), false);
  assert.equal(t.textoConPrecio(SERVICIOS), false);
  assert.equal(t.textoConPrecio(PASO_2), false);
  assert.equal(t.textoConPrecio("Lo separas con el *50 %* y el otro *50 %* al terminar, garantía de *1 año*"), false);
  assert.equal(t.textoConPrecio("Escríbenos al 3001234567 o al 300 123 4567"), false);
  assert.equal(t.textoConPrecio("¿Quieres que te dé el precio?"), false);
  assert.equal(t.textoConPrecio("Mide 1.850 de largo"), false);
});

/* 2. El caso real: "Masajes" tras la bienvenida */
const CASO_MASAJES = chat(IN(ANUNCIO), BOT(BIENVENIDA), BOT(SERVICIOS), IN("Masajes"));
prueba("'Masajes' tras bienvenida + '¿qué servicios?': con la regla NO asigna", () => {
  assert.equal(t.turnoMereceAsesora(CASO_MASAJES, undefined, SI), false);
  assert.equal(t.botYaMandoPrecioOFotos(CASO_MASAJES), false);
});
prueba("'Masajes' tras bienvenida: interruptor apagado = como hoy (asigna)", () => {
  assert.equal(t.turnoMereceAsesora(CASO_MASAJES), true);
  assert.equal(t.turnoMereceAsesora(CASO_MASAJES, undefined, {}), true);
  assert.equal(t.turnoMereceAsesora(CASO_MASAJES, undefined, { exigirPrecioOFotos: false }), true);
});
prueba("'Pestañas' tras el paso 2 (camilla 200 kg, '¿te comparto fotos?'): sigue con el bot", () => {
  const c = chat(IN(ANUNCIO), BOT(BIENVENIDA), BOT(SERVICIOS), IN("Masajes"), BOT(PASO_2), IN("Para cejas y pestañas"));
  assert.equal(t.turnoMereceAsesora(c, undefined, SI), false);
});

/* 3. Tras precio o fotos */
prueba("cliente responde 'Cali' tras el precio del bot: asigna", () => {
  const c = chat(IN(ANUNCIO), BOT(BIENVENIDA), BOT(SERVICIOS), BOT(PRECIO), IN("Cali"));
  assert.equal(t.turnoMereceAsesora(c, undefined, SI), true);
});
prueba("cliente responde tras las fotos del flujo (IMAGE/VIDEO sin texto de precio): asigna", () => {
  const c = chat(
    IN(ANUNCIO),
    BOT(BIENVENIDA),
    BOT("", "IMAGE"),
    BOT("", "IMAGE"),
    BOT("", "VIDEO"),
    BOT("¿En qué color lo quieres?😊"),
    IN("negra"),
  );
  assert.equal(t.turnoMereceAsesora(c, undefined, SI), true);
});
prueba("catálogo en PDF (DOCUMENT) del bot cuenta como fotos", () => {
  const c = chat(IN("hola info del tocador"), BOT("Te comparto el catálogo"), BOT("catalogo.pdf", "DOCUMENT"), IN("el de 3 puestos"));
  assert.equal(t.turnoMereceAsesora(c, undefined, SI), true);
});
prueba("precio en un seguimiento automático o fotos en el eco 'api' también cuentan", () => {
  const c1 = chat(
    IN(ANUNCIO),
    BOT(SERVICIOS),
    SEGUIMIENTO("El *Combo Camillas* está en *$989.000*, ¿te lo dejo listo?"),
    IN("en Pasto se puede?"),
  );
  assert.equal(t.turnoMereceAsesora(c1, undefined, SI), true);
  const c2 = chat(IN(ANUNCIO), ECO("", "VIDEO"), IN("me interesa, como pago"));
  assert.equal(t.turnoMereceAsesora(c2, undefined, SI), true);
});
prueba("el precio sigue contando aunque el bot haya escrito otras cosas después", () => {
  const c = chat(IN(ANUNCIO), BOT(PRECIO), IN("ok"), BOT("¡Perfecto! ¿de qué *color* lo quieres?"), IN("blanca"));
  assert.equal(t.turnoMereceAsesora(c, undefined, SI), true);
});
prueba("'ok' / 'gracias' / emoji tras el precio: NO asigna (turno sin contenido)", () => {
  for (const texto of ["ok", "Ok muchas gracias", "gracias", "👍"]) {
    const c = chat(IN(ANUNCIO), BOT(BIENVENIDA), BOT(PRECIO), IN(texto));
    assert.equal(t.turnoMereceAsesora(c, undefined, SI), false, texto);
  }
});
prueba("nota de voz de la clienta tras el precio: asigna", () => {
  const c = chat(IN(ANUNCIO), BOT(PRECIO), IN("", "AUDIO"));
  assert.equal(t.turnoMereceAsesora(c, undefined, SI), true);
});

/* 4. Lo que no cuenta como "el bot mandó" */
prueba("precio o fotos mandados por la asesora (manual) o el celular (instance) NO cuentan", () => {
  const c1 = chat(IN(ANUNCIO), BOT(SERVICIOS), ASESORA(PRECIO_SIN_SIGNO), ASESORA("", "IMAGE"), IN("Masajes"));
  assert.equal(t.turnoMereceAsesora(c1, undefined, SI), false);
  const c2 = chat(IN(ANUNCIO), BOT(SERVICIOS), CELULAR("", "VIDEO"), IN("Masajes"));
  assert.equal(t.turnoMereceAsesora(c2, undefined, SI), false);
});
prueba("lo que manda la clienta (su foto, su cifra) no cuenta como precio del bot", () => {
  const c = chat(IN(ANUNCIO), BOT(SERVICIOS), IN("tengo $500.000"), IN("", "IMAGE"));
  assert.equal(t.botYaMandoPrecioOFotos(c), false);
  assert.equal(t.turnoMereceAsesora(c, undefined, SI), false);
});
prueba("primer mensaje del lead (nadie le contestó) no asigna, con o sin regla", () => {
  const c = chat(IN(ANUNCIO));
  assert.equal(t.turnoMereceAsesora(c), false);
  assert.equal(t.turnoMereceAsesora(c, undefined, SI), false);
});

/* 5. El interruptor */
prueba("leerConfigRepartoDeTexto: sin fila / roto / false = como hoy; true = exige", () => {
  assert.deepEqual(t.leerConfigRepartoDeTexto(null), { exigirPrecioOFotos: false });
  assert.deepEqual(t.leerConfigRepartoDeTexto(""), { exigirPrecioOFotos: false });
  assert.deepEqual(t.leerConfigRepartoDeTexto("{roto"), { exigirPrecioOFotos: false });
  assert.deepEqual(t.leerConfigRepartoDeTexto('{"exigirPrecioOFotos": false}'), { exigirPrecioOFotos: false });
  assert.deepEqual(t.leerConfigRepartoDeTexto('{"exigirPrecioOFotos": true}'), { exigirPrecioOFotos: true });
  assert.deepEqual(t.leerConfigRepartoDeTexto('{"exigirPrecioOFotos": "true"}'), { exigirPrecioOFotos: true });
  assert.equal(t.claveConfigReparto("ws1"), "reparto:config:ws1");
});

/* 6. Responder la bienvenida (Alex, 30-10-2026) */
let minuto = 0;
const con = (m, extra = {}) => ({ ...m, createdAt: new Date(Date.UTC(2026, 9, 29, 12, minuto++)), ...extra });
const viejoAlNuevo = (...ms) => ms.map((m) => con(m));
const SYS = () => ({ direction: "OUTBOUND", type: "SYSTEM", content: "Chat asignado" });
prueba("respondioLaBienvenida: caso real (cliente, bienvenida, cliente, bot) = true", () => {
  assert.equal(t.respondioLaBienvenida(viejoAlNuevo(IN(ANUNCIO), BOT(BIENVENIDA), IN("Masajes"), BOT(PASO_2))), true);
});
prueba("respondioLaBienvenida: solo el primer mensaje = false", () => {
  assert.equal(t.respondioLaBienvenida(viejoAlNuevo(IN(ANUNCIO))), false);
});
prueba("respondioLaBienvenida: cliente y bienvenida sin respuesta = false", () => {
  assert.equal(t.respondioLaBienvenida(viejoAlNuevo(IN(ANUNCIO), BOT(BIENVENIDA))), false);
});
prueba("respondioLaBienvenida: un 'ok' después de la bienvenida = true", () => {
  assert.equal(t.respondioLaBienvenida(viejoAlNuevo(IN(ANUNCIO), BOT(BIENVENIDA), IN("ok"))), true);
});
prueba("respondioLaBienvenida: una nota SYSTEM no cuenta como mensaje nuestro = false", () => {
  assert.equal(t.respondioLaBienvenida(viejoAlNuevo(IN(ANUNCIO), SYS(), IN("Masajes"))), false);
});
prueba("respondioLaBienvenida: un mensaje borrado de la clienta no cuenta = false", () => {
  assert.equal(t.respondioLaBienvenida(viejoAlNuevo(IN(ANUNCIO), BOT(BIENVENIDA), { ...IN("hola"), borrado: true })), false);
});
prueba("respondioLaBienvenida: ordena por fecha aunque lleguen al revés", () => {
  assert.equal(t.respondioLaBienvenida([...viejoAlNuevo(IN(ANUNCIO), BOT(BIENVENIDA), IN("Masajes"))].reverse()), true);
  assert.equal(t.respondioLaBienvenida([...viejoAlNuevo(IN(ANUNCIO), BOT(BIENVENIDA))].reverse()), false);
});

console.log(`\n${pruebas} pruebas ok`);
