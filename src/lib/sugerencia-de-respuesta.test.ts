// Pruebas del redactor (la IA del V3 y la estrella ✨) con el catálogo de productos activos.
// Sin base ni red: la llamada a OpenAI se reemplaza por una falsa. Correr: npm run test:sugerencia-catalogo
//
// Caso real (05-11-2026, chat 280225845891209): la clienta pidió el combo "sin la camilla" y el bot
// contestó "la camilla no se vende por separado en el combo, solo las piezas juntas". Era falso.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  problemasDeLaSugerencia,
  redactarSugerencia,
  textoDelCatalogo,
  type ProductoDelCatalogoParaSugerir,
} from "./sugerencia-de-respuesta";

const catalogo: ProductoDelCatalogoParaSugerir[] = [
  { nombre: "COMBO CAMILLAS", codigo: "CMB05", categoria: "Combos", precio: 1_890_000, precioMayorista: 1_610_000, descripcion: "Camilla, butaco, carrito auxiliar y escalera." },
  { nombre: "Camilla", codigo: "CAM01", categoria: "Camillas", precio: 450_000, precioMayorista: 382_000, descripcion: "Camilla en madera con espaldar graduable." },
  { nombre: "Butaco", codigo: "BUT01", categoria: "Sillas", precio: 180_000, precioMayorista: 151_000, descripcion: null },
  { nombre: "Carrito auxiliar", codigo: "CAR01", categoria: "Carritos", precio: 260_000, precioMayorista: 219_000, descripcion: "Tres bandejas." },
  { nombre: "Escalera", codigo: "ESC01", categoria: "Escaleras", precio: 140_000, precioMayorista: 117_000, descripcion: "x".repeat(900) },
];
const MAYORISTAS = ["1.610.000", "382.000", "151.000", "219.000", "117.000"];

const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

/** Reemplaza OpenAI: guarda lo que se le mandó y contesta con las respuestas dadas, en orden. */
function openAiFalso(respuestas: unknown[]) {
  const pedidos: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  let turno = 0;
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    pedidos.push(JSON.parse(init?.body ?? "{}"));
    const contenido = JSON.stringify(respuestas[Math.min(turno, respuestas.length - 1)]);
    turno += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content: contenido } }] }), { status: 200 });
  }) as typeof fetch;
  return pedidos;
}

const ahora = new Date("2026-11-05T17:41:00Z");
const lineas = [
  { de: "negocio" as const, texto: "¡Hola! El *Combo Camillas* trae camilla, butaco, carrito y escalera.", en: new Date("2026-11-05T17:30:00Z") },
  { de: "cliente" as const, texto: "quiero el combo sin la camilla", en: new Date("2026-11-05T17:40:00Z") },
];

function redactar(respuestas: unknown[]) {
  const pedidos = openAiFalso(respuestas);
  const resultado = redactarSugerencia({
    apiKey: "falsa",
    comoHablamos: "Forma de pago: anticipo del 50% y el resto antes del despacho.",
    producto: null,
    catalogo,
    lineas,
    enviado: { resumen: "", flujosEnviados: new Set() },
    flujos: [],
    ahora,
  });
  return { pedidos, resultado };
}

test("el mensaje a la IA trae el catálogo con precios de venta y sin ningún mayorista", async () => {
  const { pedidos, resultado } = redactar([{ texto: "Sí, la *Camilla* se vende suelta a $450.000, ¿te la separo?", falta_dato: false }]);
  const final = await resultado;
  const sistema = pedidos[0].messages[0].content;
  assert.match(sistema, /Camilla/);
  assert.ok(sistema.includes("$450.000"), "trae el precio de la camilla");
  for (const pieza of ["Butaco", "Carrito auxiliar", "Escalera"]) assert.ok(sistema.includes(pieza), pieza);
  for (const mayorista of MAYORISTAS) assert.ok(!sistema.includes(mayorista), `no trae el mayorista ${mayorista}`);
  assert.ok(!/mayorista\s*[:=]/i.test(sistema));
  assert.equal(pedidos.length, 1, "la respuesta buena no se corrige");
  assert.deepEqual(final?.problemas, []);
  assert.equal(final?.faltaDato, false);
});

test("el mensaje a la IA trae la regla dura y no habla de contraentrega", async () => {
  const { pedidos, resultado } = redactar([{ texto: "Sí, la *Camilla* se vende suelta a $450.000, ¿te la separo?", falta_dato: false }]);
  await resultado;
  const sistema = pedidos[0].messages[0].content;
  assert.match(sistema, /NUNCA afirmes una política/);
  assert.ok(sistema.includes("Déjame confirmarlo con una asesora"));
  assert.ok(!/contraentrega/i.test(sistema), "no ofrece contraentrega");
});

test("la descripción de cada producto se recorta a unas 300 letras", () => {
  const texto = textoDelCatalogo(catalogo);
  const escalera = texto.split("\n").find((linea) => linea.includes("Escalera"))!;
  assert.ok(escalera.length < 400, `línea de ${escalera.length} letras`);
  assert.equal(textoDelCatalogo([]), "");
});

const datosDeLaPrueba = () => {
  const delCatalogo = textoDelCatalogo(catalogo);
  return {
    precioMayorista: null,
    preciosMayoristas: catalogo.map((p) => p.precioMayorista),
    preciosDeVenta: catalogo.map((p) => p.precio),
    politicas: delCatalogo,
    contexto: delCatalogo,
    ultimoDeLaClienta: "quiero el combo sin la camilla",
    yaDijimos: "",
  };
};

test("marca 'no se vende por separado' cuando eso no está en los datos", () => {
  const problemas = problemasDeLaSugerencia("la camilla no se vende por separado, solo las piezas juntas, ¿te parece?", datosDeLaPrueba());
  assert.ok(problemas.some((p) => /no se vende por separado/.test(p)), problemas.join(" | "));
  // Con tildes y otras formas también.
  assert.ok(problemasDeLaSugerencia("Sólo se venden juntas, ¿te parece?", datosDeLaPrueba()).some((p) => /por separado/.test(p)));
});

test("si el libro sí dice que algo no se vende suelto, se puede decir", () => {
  const datos = { ...datosDeLaPrueba(), politicas: "El espaldar no se vende por separado." };
  const problemas = problemasDeLaSugerencia("El espaldar no se vende por separado, ¿te muestro la camilla?", datos);
  assert.ok(!problemas.some((p) => /por separado/.test(p)), problemas.join(" | "));
});

test("la camilla suelta con su precio del catálogo no tiene problemas", () => {
  assert.deepEqual(problemasDeLaSugerencia("Sí, la *Camilla* se vende suelta a $450.000, ¿te la separo?", datosDeLaPrueba()), []);
});

test("el precio mayorista de un producto que no es el activo queda marcado", () => {
  const problemas = problemasDeLaSugerencia("El *Butaco* te queda en $151.000, ¿te lo separo?", datosDeLaPrueba());
  assert.ok(problemas.some((p) => /mayorista/.test(p)), problemas.join(" | "));
  // Si un mayorista es igual al precio de venta de otro producto, esa cifra sí se puede decir.
  const datos = { ...datosDeLaPrueba(), preciosMayoristas: [180_000] };
  assert.ok(!problemasDeLaSugerencia("El *Butaco* vale $180.000, ¿te lo separo?", datos).some((p) => /mayorista/.test(p)));
});

test("'Déjame confirmarlo con una asesora' marca que falta un dato", async () => {
  const { resultado } = redactar([{ texto: "Déjame confirmarlo con una asesora, ¿me dices tu ciudad?", falta_dato: false }]);
  const final = await resultado;
  assert.equal(final?.faltaDato, true);
});

test("si la IA insiste en una política inventada, el texto final sale con problemas (el V3 no lo envía)", async () => {
  const mala = { texto: "La camilla no se vende por separado, solo las piezas juntas, ¿te parece?", falta_dato: false };
  const { pedidos, resultado } = redactar([mala, mala, mala]);
  const final = await resultado;
  assert.equal(pedidos.length, 3, "pide corregir dos veces");
  assert.match(pedidos[1].messages.at(-1)!.content, /no se vende por separado/);
  assert.ok(final && final.problemas.length > 0);
});
