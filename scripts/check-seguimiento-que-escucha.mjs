// Pruebas de los SEGUIMIENTOS QUE ESCUCHAN AL CLIENTE (features/seguimientos/*/seguimiento-que-escucha.ts).
// La IA va simulada y no hay base ni red. Correr: npm run test:seguimiento-que-escucha
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

const d = cargar("src/features/seguimientos/dominio/seguimiento-que-escucha.ts");

const estado = { clave: null };
const prisma = {
  appSetting: { findUnique: async () => (estado.clave ? { value: estado.clave } : null) },
  conversation: { findFirst: async () => null },
  message: {},
  product: {},
};
const s = cargar("src/features/seguimientos/services/seguimiento-que-escucha.ts", {
  "@/lib/prisma": { prisma },
  "@/features/agente-v3/servicios/almacen": { leerLibro: async () => ({ comoHablamos: "Anticipo 50%. Camilla $989.000." }) },
  "@/lib/transcripcion-de-audios": { transcribirAudioAhora: async () => null },
});

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const linea = (de, texto, hace = "hace 1 h") => ({ de, texto, hace });
const BASE = {
  yaEnviados: [],
  enviado: "3 fotos",
  nombre: "Ana",
  producto: { nombre: "Silla de peluquería", codigo: "SP1", precio: "$450.000", descripcion: "Silla hidráulica", precioMayorista: 380000 },
  comoHablamos: "Anticipo 50%. Camilla $989.000.",
  soloAnuncio: false,
};
const CHARLA_BEIGE = [linea("cliente", "Hola, color beige me interesa"), linea("negocio", "Claro, te envío las fotos")];
const SIEMPRE = "Ana ¿Pudiste ver lo que te envié? 😊 Si te queda alguna duda, aquí estoy para ayudarte.";
const modelo = (...textos) => {
  const cola = [...textos];
  const llamadas = [];
  const pedir = async (sistema, mensajes) => {
    llamadas.push({ sistema, mensajes });
    const t = cola.shift();
    return t === undefined || t === null ? null : JSON.stringify({ texto: t });
  };
  return { pedir, llamadas };
};

await prueba("el texto con beige lo menciona y termina en pregunta", async () => {
  const m = modelo("Te dejo el beige apartado en la lista de esta semana 🙌 ¿A qué ciudad te lo enviamos?");
  const r = await s.decidirTextoDelSeguimiento({ datos: { ...BASE, lineas: CHARLA_BEIGE }, textoDeSiempre: SIEMPRE, pedir: m.pedir });
  assert.equal(r.origen, "ia");
  assert.match(r.texto, /beige/);
  assert.match(r.texto, /\?\s*$/);
  assert.equal(r.reemplaza, SIEMPRE);
  assert.match(m.llamadas[0].mensajes[0].content, /color beige me interesa/);
});

await prueba("un audio transcrito llega a la IA", async () => {
  const lineas = [linea("cliente", "[nota de voz] quiero una silla palo rosa, estoy en Montería")];
  const m = modelo("Te cuento cómo te llega la silla palo rosa a Montería 🙌 ¿La quieres con anticipo o contraentrega?");
  const r = await s.decidirTextoDelSeguimiento({ datos: { ...BASE, lineas }, textoDeSiempre: SIEMPRE, pedir: m.pedir });
  assert.equal(r.origen, "ia");
  assert.match(m.llamadas[0].mensajes[0].content, /palo rosa, estoy en Montería/);
  assert.match(r.texto, /Montería/);
});

await prueba("se rechazan frases prohibidas, más de 2 líneas, precio inventado y repetición", async () => {
  const ctx = { contexto: "Camilla $989.000 beige", yaEnviados: ["Te dejo el beige apartado ¿A qué ciudad te lo enviamos?"] };
  assert.ok(d.revisarSeguimiento("¿Pudiste ver lo que te envié?", ctx).length > 0);
  assert.ok(d.revisarSeguimiento("Hola, aquí estoy para ayudarte ¿Algo más?", ctx).length > 0);
  assert.ok(d.revisarSeguimiento("Si te queda alguna duda me dices ¿vale?", ctx).length > 0);
  assert.ok(d.revisarSeguimiento("Uno\nDos\nTres ¿listo?", ctx).some((p) => /líneas/.test(p)));
  assert.ok(d.revisarSeguimiento("Te queda en $750.000 ¿lo apartamos?", ctx).some((p) => /cifras/.test(p)));
  assert.ok(d.revisarSeguimiento("Te lo entregamos el lunes ¿te sirve?", ctx).some((p) => /fecha/.test(p)));
  assert.ok(d.revisarSeguimiento("Llega en 5 días ¿te sirve?", ctx).length > 0);
  assert.ok(d.revisarSeguimiento("Te dejo el beige apartado, ¿a qué ciudad te lo enviamos?", ctx).some((p) => /ya se le envi/.test(p)));
  assert.deepEqual(d.revisarSeguimiento("Te dejo el beige a $989.000 ¿para qué ciudad?", ctx), []);
  assert.deepEqual(d.revisarSeguimiento("El anticipo es de $494.500 ¿lo apartamos?", ctx), []);
});

await prueba("si el primer texto falla se pide de nuevo con el detalle (hasta 2 veces)", async () => {
  const m = modelo("¿Pudiste ver lo que te envié?", "Te dejo el beige apartado en la lista ¿A qué ciudad lo enviamos?");
  const r = await s.decidirTextoDelSeguimiento({ datos: { ...BASE, lineas: CHARLA_BEIGE }, textoDeSiempre: SIEMPRE, pedir: m.pedir });
  assert.equal(r.origen, "ia");
  assert.equal(m.llamadas.length, 2);
  assert.match(m.llamadas[1].mensajes[2].content, /no cumple/);
  const tres = modelo("a ¿b?\nc\nd", "aqui estoy para ayudarte ¿si?", "Te sirve el beige en $777.000 ¿ya?");
  const r3 = await s.decidirTextoDelSeguimiento({ datos: { ...BASE, lineas: CHARLA_BEIGE }, textoDeSiempre: SIEMPRE, pedir: tres.pedir });
  assert.equal(tres.llamadas.length, 3);
  assert.notEqual(r3.origen, "ia");
});

await prueba("el cliente que solo mandó el anuncio recibe la pregunta del producto cuando la IA no sirve", async () => {
  const datos = { ...BASE, soloAnuncio: true, lineas: [linea("cliente", "Hola, quiero más información de este producto")] };
  const m = modelo(null);
  const r = await s.decidirTextoDelSeguimiento({ datos, textoDeSiempre: SIEMPRE, pedir: m.pedir });
  assert.equal(r.origen, "pregunta_del_producto");
  assert.match(r.texto, /Silla de peluquería/);
  assert.match(r.texto, /\?/);
  assert.match(m.llamadas[0].sistema, /solo mandó el texto del anuncio/);
});

await prueba("si la IA falla sale el de siempre solo si pasa la revisión; si no, la pregunta; sin producto, se omite", async () => {
  const bueno = "Ana te cuento cómo te lo enviamos 😊 ¿Para qué ciudad sería?";
  const r1 = await s.decidirTextoDelSeguimiento({ datos: { ...BASE, lineas: CHARLA_BEIGE }, textoDeSiempre: bueno, pedir: modelo(null).pedir });
  assert.deepEqual({ o: r1.origen, t: r1.texto }, { o: "respaldo", t: bueno });
  const r2 = await s.decidirTextoDelSeguimiento({ datos: { ...BASE, lineas: CHARLA_BEIGE }, textoDeSiempre: SIEMPRE, pedir: modelo(null).pedir });
  assert.equal(r2.origen, "pregunta_del_producto");
  const r3 = await s.decidirTextoDelSeguimiento({ datos: { ...BASE, producto: null, lineas: CHARLA_BEIGE }, textoDeSiempre: SIEMPRE, pedir: modelo(null).pedir });
  assert.equal(r3.origen, "omitir");
  assert.equal(r3.motivo, "sin_texto_ni_producto");
});

await prueba("la pregunta del producto no repite una ya enviada", async () => {
  const p = BASE.producto;
  const primera = d.preguntaDelProducto(p, [], null);
  const segunda = d.preguntaDelProducto(p, [primera], null);
  assert.notEqual(primera, segunda);
  assert.equal(d.preguntaDelProducto(null, [], null), null);
});

await prueba("sin clave de OpenAI o con el interruptor apagado sale el texto de antes", async () => {
  const antes = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const entrada = { workspaceId: "w", contactId: "c", channelId: "ch", textoDeSiempre: SIEMPRE };
  assert.deepEqual(await s.redactarSeguimiento(entrada), { origen: "apagado" });
  process.env.OPENAI_API_KEY = "x";
  estado.clave = "si";
  assert.deepEqual(await s.redactarSeguimiento(entrada), { origen: "apagado" });
  // Prendido pero sin conversación: tampoco rompe, sale el de antes.
  estado.clave = null;
  assert.deepEqual(await s.redactarSeguimiento(entrada), { origen: "apagado" });
  if (antes === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = antes;
});

await prueba("tope por vuelta: pasado el máximo se difiere", async () => {
  process.env.OPENAI_API_KEY = "x";
  s.reiniciarTopeDeLaVuelta();
  const ahora = new Date("2026-10-27T15:00:10Z");
  const entrada = { workspaceId: "w", contactId: "c", channelId: "ch", textoDeSiempre: SIEMPRE, ahora };
  for (let i = 0; i < s.MAXIMO_POR_VUELTA; i += 1) assert.equal((await s.redactarSeguimiento(entrada)).origen, "apagado");
  assert.deepEqual(await s.redactarSeguimiento(entrada), { origen: "diferir" });
  const otroMinuto = { ...entrada, ahora: new Date(ahora.getTime() + 60_000) };
  assert.equal((await s.redactarSeguimiento(otroMinuto)).origen, "apagado");
  delete process.env.OPENAI_API_KEY;
});

await prueba("la marca guarda el texto que reemplazó", async () => {
  assert.deepEqual(s.marcaDelResultado({ origen: "ia", texto: "x", reemplaza: "y" }), { origen: "ia", reemplaza: "y" });
  assert.equal(s.marcaDelResultado({ origen: "respaldo", texto: "x" }), null);
});

await prueba("los textos fijos de Tras asesora ya no tienen frases de robot", async () => {
  const cf = cargar("src/features/seguimiento-inteligente/dominio/config.ts");
  const { frasesRoboticas } = cargar("src/lib/reglas-de-redaccion.ts");
  for (const texto of cf.CONFIG_POR_DEFECTO.trasAsesora.textos) assert.deepEqual(frasesRoboticas(texto), [], texto);
});

console.log(`\n${pruebas} pruebas ok`);
