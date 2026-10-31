// Pruebas del Agente V3: varias preguntas juntas en un mensaje (caso real del 26-10-2026, combo de
// camillas). Correr: npm run test:agente-v3-varias-preguntas
//
// Carga el motor REAL (decidir, foto-y-precio, reglas, ejecutar, redactor) transpilando el TypeScript,
// y reemplaza solo lo que toca la base o la IA (almacén, estado, catálogo, clasificador, OpenAI).
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const nodeRequire = createRequire(import.meta.url);
const SRC = path.resolve("src");

// --- Cargador mínimo de TypeScript con alias "@/" y reemplazos -------------------------------------
const cache = new Map();
function resolver(desde, especificador) {
  let base;
  if (especificador.startsWith("@/")) base = path.join(SRC, especificador.slice(2));
  else if (especificador.startsWith(".")) base = path.resolve(path.dirname(desde), especificador);
  else return null;
  for (const candidato of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (fs.existsSync(candidato) && fs.statSync(candidato).isFile()) return candidato;
  }
  throw new Error(`No encuentro ${especificador} desde ${desde}`);
}
function cargar(archivo, reemplazos) {
  if (reemplazos.has(archivo)) return reemplazos.get(archivo);
  if (cache.has(archivo)) return cache.get(archivo).exports;
  const salida = ts.transpileModule(fs.readFileSync(archivo, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: archivo,
  });
  const mod = { exports: {} };
  cache.set(archivo, mod);
  const req = (especificador) => {
    const resuelto = resolver(archivo, especificador);
    return resuelto ? cargar(resuelto, reemplazos) : nodeRequire(especificador);
  };
  new Function("exports", "require", "module", "__filename", "__dirname", salida.outputText)(
    mod.exports,
    req,
    mod,
    archivo,
    path.dirname(archivo),
  );
  return mod.exports;
}
const ruta = (relativa) => path.join(SRC, relativa);

// --- Reemplazos de lo que toca la base o la IA ----------------------------------------------------
const mundo = {
  libro: null,
  estado: null,
  intenciones: [],
  clasificarRecibio: null,
  sugerencia: null,
};
const reemplazos = new Map([
  [ruta("lib/agent-product-flow.ts"), { getFlowReply: async () => ({ steps: [{ kind: "image", url: "/combo.jpg" }] }) }],
  [ruta("features/agente-v3/servicios/almacen.ts"), { leerLibro: async () => mundo.libro }],
  [
    ruta("features/agente-v3/servicios/catalogo.ts"),
    {
      catalogoActivo: async () => [],
      nombreLegible: (n) => n,
      productosInactivos: async () => new Set(),
      reconocerEnElCatalogo: () => null,
      textoDeUnProducto: () => "",
      textoDeVariasOpciones: () => "",
    },
  ],
  [ruta("features/agente-v3/servicios/decisiones.ts"), { anotarDecision: async () => {} }],
  [
    ruta("features/agente-v3/motor/clasificar.ts"),
    {
      clasificarIntenciones: async (entrada) => {
        mundo.clasificarRecibio = entrada;
        return mundo.intenciones;
      },
    },
  ],
  [
    ruta("features/agente-v3/motor/estado.ts"),
    {
      leerEstado: async () => mundo.estado,
      guardarEstado: async (_id, estado) => {
        mundo.estado = estado;
      },
    },
  ],
  [ruta("lib/sugerencia-de-respuesta.ts"), { generarSugerenciaDeRespuesta: async () => mundo.sugerencia }],
]);
const { atenderConAgenteV3 } = cargar(ruta("features/agente-v3/motor/ejecutar.ts"), reemplazos);
const { decidir } = cargar(ruta("features/agente-v3/motor/decidir.ts"), reemplazos);
const { esReglaDeTema, esReglaDeAsesora, partesDelTexto, temaDeLaRegla } = cargar(
  ruta("features/agente-v3/motor/varias-preguntas.ts"),
  reemplazos,
);

// --- Un libro de ejemplo, con la forma del libro real ---------------------------------------------
const COMBO = "prod-combo-camillas";
const regla = (id, nombre, cuando, entonces, extra = {}) => ({ id, nombre, cuando, entonces, activa: true, ...extra });
const frase = (...frases) => ({ tipo: "frase", frases });

const saludo = regla("r-saludo", "Saludo del primer mensaje", { tipo: "siempre" }, [
  { tipo: "mensaje", texto: "¡Hola! 👋 Bienvenida a Magilus." },
], { soloSi: { esPrimerMensaje: true } });
const garantia = regla("r-garantia", "Pregunta por la garantía", frase("garantia"), [
  { tipo: "mensaje", texto: "La *garantía* es de 1 año por defectos de fábrica. ¿En qué *ciudad* estás?" },
]);
const envioGratis = regla("e55ea1de", "¿el envío es gratis?", frase("envio es gratis", "envio gratis", "es gratis"), [
  { tipo: "mensaje", texto: "¡Claro! 🚚 El envío es gratis a tu local o casa en ciudades principales. ¿En qué *ciudad* estás?" },
]);
const envio = regla("r-envio", "Pregunta por el envío", frase("envio", "envian", "domicilio"), [
  { tipo: "mensaje", texto: "Hacemos envíos a toda Colombia. ¿En qué *ciudad* estás?" },
]);
const materiales = regla("r-materiales", "Pregunta por los materiales", frase("materiales", "material"), [
  { tipo: "mensaje", texto: "Con gusto 😊\nEs en cuero tex con estructura metálica, muy resistente y fácil de limpiar. ¿Qué color te gusta?" },
]);
const precioCombo = regla("r-precio", "Precio del combo", frase("precio", "cuanto vale", "que valor tiene"), [
  { tipo: "mensaje", texto: "El *combo* completo tiene un valor de *$989.000*. ¿En qué *ciudad* estás?" },
], { soloSi: { productoActivo: COMBO } });
const otroProducto = regla("r-otro", "Pregunta el precio de otro producto: pasar a la asesora", frase("cuanto vale la silla", "precio de la silla"), [
  { tipo: "mensaje", texto: "Ya te confirmo el valor de esa silla con una asesora. ¿En qué *ciudad* estás?" },
  { tipo: "avisar_asesor", motivo: "Pregunta el precio de otro producto" },
  { tipo: "pausar_ia" },
]);
const catalogo = regla("r-catalogo", "Pide el catálogo", frase("catalogo"), [{ tipo: "flujo", flujoId: "f-cat" }]);
const quiereCombo = regla("r-combo", "Le interesa el combo de camillas", frase("combo de camillas"), [
  { tipo: "activar_producto", productoId: COMBO },
  { tipo: "ir_al_paso", paso: "PRODUCTO" },
]);
const pasoProducto = regla("r-paso", "Paso producto del combo", { tipo: "paso", producto: COMBO, paso: "PRODUCTO" }, [
  { tipo: "mensaje", texto: "Te cuento del combo: camilla, escalera y silla. ¿Para qué servicio lo necesitas?" },
]);
const fotoYPrecio = regla(
  "r-foto",
  "Manda foto o captura de un producto y pregunta el precio: no es el combo, pasar a la asesora",
  { tipo: "intencion", descripcion: "Manda foto o captura de un producto y pregunta el precio o cuánto vale" },
  [
    { tipo: "mensaje", texto: "Ya te confirmo el valor de esa referencia. ¿En qué *ciudad* estás?" },
    { tipo: "avisar_asesor", motivo: "Foto de un producto + precio (regla del libro)" },
    { tipo: "pausar_ia" },
  ],
);

const libroDeEjemplo = () => ({
  version: 1,
  actualizadoEl: "2026-10-26T00:00:00.000Z",
  comoHablamos: "",
  // La garantía va primero en el libro: por eso el 26-oct ganaba sola.
  reglas: [saludo, garantia, otroProducto, envioGratis, envio, materiales, catalogo, quiereCombo, pasoProducto, fotoYPrecio, precioCombo],
});
const estadoCombo = (extra = {}) => ({
  productoActivo: COMBO,
  pasoActual: "PRODUCTO",
  flujosEnviados: [],
  esPrimerMensaje: false,
  ...extra,
});
const textoDe = (decision) =>
  [...decision.saludo, ...decision.acciones].filter((a) => a.tipo === "mensaje").map((a) => a.texto);

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

// --- El caso del 26-oct -----------------------------------------------------------------------------
await prueba("'materiales garantía y envío es gratis?': UN solo mensaje con las tres cosas, una línea cada una", () => {
  const decision = decidir({ libro: libroDeEjemplo(), mensaje: "materiales garantía y envío es gratis?", estado: estadoCombo() });
  const mensajes = textoDe(decision);
  assert.equal(mensajes.length, 1, "tiene que salir un solo mensaje");
  const lineas = mensajes[0].split("\n");
  assert.deepEqual(lineas, [
    "✅ La *garantía* es de 1 año por defectos de fábrica.",
    "🚚 El envío es gratis a tu local o casa en ciudades principales.",
    "🪑 Es en cuero tex con estructura metálica, muy resistente y fácil de limpiar.",
    "¿En qué *ciudad* estás?",
  ]);
  // Una sola pregunta, al final.
  assert.equal(mensajes[0].split("?").length - 1, 1);
  assert.deepEqual(decision.juntas.map((r) => r.id), ["r-garantia", "e55ea1de", "r-materiales"]);
  assert.match(decision.porque, /varias preguntas juntas/);
  // La de envío general es del mismo tema que "¿el envío es gratis?": no se repite.
  assert.ok(decision.tambienEncajaban.some((r) => r.id === "r-envio"));
});

await prueba("el mensaje real del 26-oct ('Materiales garantía y envío los costos es gratis??') también contesta las tres", () => {
  const decision = decidir({
    libro: libroDeEjemplo(),
    mensaje: "Materiales garantía y envío los costos es gratis??",
    estado: estadoCombo(),
  });
  const [texto] = textoDe(decision);
  assert.match(texto, /garantía/);
  assert.match(texto, /envío es gratis/);
  assert.match(texto, /cuero tex/);
});

await prueba("una sola pregunta: la misma respuesta de antes, sin cambios", () => {
  const decision = decidir({ libro: libroDeEjemplo(), mensaje: "y la garantia?", estado: estadoCombo() });
  assert.equal(decision.regla.id, "r-garantia");
  assert.deepEqual(decision.acciones, garantia.entonces);
  assert.equal(decision.juntas, undefined);
  assert.equal(decision.porque, `Ganó "Pregunta por la garantía" porque el cliente dijo "garantia".`);
});

await prueba("dos reglas del MISMO tema (envío y envío gratis): sale una sola, como antes", () => {
  const decision = decidir({ libro: libroDeEjemplo(), mensaje: "el envio es gratis?", estado: estadoCombo() });
  assert.equal(decision.regla.id, "e55ea1de");
  assert.deepEqual(decision.acciones, envioGratis.entonces);
  assert.equal(decision.juntas, undefined);
});

await prueba("tema + '¿cuánto vale la silla X?': contesta el tema y solo el precio pasa a la asesora", () => {
  const decision = decidir({
    libro: libroDeEjemplo(),
    mensaje: "cuanto vale la silla rosada y tiene garantia?",
    estado: estadoCombo(),
  });
  const mensajes = textoDe(decision);
  assert.equal(mensajes.length, 1);
  assert.deepEqual(mensajes[0].split("\n"), [
    "✅ La *garantía* es de 1 año por defectos de fábrica.",
    "👩🏻‍💼 Ya te confirmo el valor de esa silla con una asesora.",
    "¿En qué *ciudad* estás?",
  ]);
  assert.ok(!/989\.000/.test(mensajes[0]), "no da el precio del combo por otra silla");
  assert.deepEqual(
    decision.acciones.filter((a) => a.tipo !== "mensaje"),
    [{ tipo: "avisar_asesor", motivo: "Pregunta el precio de otro producto" }, { tipo: "pausar_ia" }],
  );
  assert.match(decision.porque, /solo "Pregunta el precio de otro producto: pasar a la asesora" pasa a una asesora/);
});

await prueba("foto de la clienta + precio: sigue la regla de foto + precio (sin otras preguntas, igual que antes)", () => {
  const decision = decidir({
    libro: libroDeEjemplo(),
    mensaje: "qué valor tiene así?",
    estado: estadoCombo(),
    fotoDelCliente: { pie: null },
  });
  assert.equal(decision.regla.id, "r-foto");
  assert.deepEqual(decision.acciones, fotoYPrecio.entonces);
  assert.equal(decision.juntas, undefined);
});

await prueba("foto + precio + garantía y envío: contesta los temas y solo la foto pasa a la asesora", () => {
  const decision = decidir({
    libro: libroDeEjemplo(),
    mensaje: "qué valor tiene así? tiene garantia y el envio es gratis?",
    estado: estadoCombo(),
    fotoDelCliente: { pie: null },
  });
  const [texto] = textoDe(decision);
  assert.equal(decision.regla.id, "r-foto");
  assert.deepEqual(texto.split("\n"), [
    "✅ La *garantía* es de 1 año por defectos de fábrica.",
    "🚚 El envío es gratis a tu local o casa en ciudades principales.",
    "👩🏻‍💼 Ya te confirmo el valor de esa referencia.",
    "¿En qué *ciudad* estás?",
  ]);
  assert.ok(!/989\.000/.test(texto), "nunca el precio del combo por una foto");
  assert.ok(decision.acciones.some((a) => a.tipo === "avisar_asesor"));
  assert.ok(decision.acciones.some((a) => a.tipo === "pausar_ia"));
});

await prueba("primer mensaje: el saludo sale como siempre, antes del mensaje juntado", () => {
  const decision = decidir({
    libro: libroDeEjemplo(),
    mensaje: "materiales garantía y envío es gratis?",
    estado: estadoCombo({ esPrimerMensaje: true }),
  });
  const mensajes = textoDe(decision);
  assert.equal(mensajes.length, 2);
  assert.equal(mensajes[0], "¡Hola! 👋 Bienvenida a Magilus.");
  assert.match(mensajes[1], /garantía[\s\S]*envío es gratis[\s\S]*cuero tex/);
});

await prueba("si gana una regla que no es de tema (catálogo, elegir producto), todo sigue igual", () => {
  const libro = libroDeEjemplo();
  // El catálogo con frase exacta pesa menos que las frases sueltas: gana y no se junta nada.
  const catalogoExacto = { ...catalogo, cuando: { tipo: "frase", frases: ["catalogo garantia y envio"], exacta: true } };
  libro.reglas = libro.reglas.map((r) => (r.id === "r-catalogo" ? catalogoExacto : r));
  const decision = decidir({ libro, mensaje: "catalogo garantia y envio", estado: estadoCombo() });
  assert.equal(decision.regla.id, "r-catalogo");
  assert.deepEqual(decision.acciones, catalogo.entonces);
  assert.equal(decision.juntas, undefined);

  const decision2 = decidir({
    libro: libroDeEjemplo(),
    mensaje: "me interesa el combo de camillas",
    estado: estadoCombo({ productoActivo: null, pasoActual: null }),
  });
  assert.equal(decision2.regla.id, "r-combo");
  assert.deepEqual(decision2.acciones, [...quiereCombo.entonces, ...pasoProducto.entonces]);
});

await prueba("el precio del combo no se junta: es su propio camino", () => {
  assert.equal(esReglaDeTema(precioCombo), false);
  assert.equal(esReglaDeTema(fotoYPrecio), false);
  assert.equal(esReglaDeTema(catalogo), false);
  assert.equal(esReglaDeTema(quiereCombo), false);
  assert.equal(esReglaDeTema(garantia), true);
  assert.equal(esReglaDeAsesora(otroProducto), true);
  assert.equal(esReglaDeAsesora(garantia), false);
  // La de "dio los datos para comprar" mueve a otra etapa: no es una pregunta suelta para la asesora.
  const datos = regla("r-datos", "Dio los datos para comprar: cierra una persona", { tipo: "intencion", descripcion: "Da nombre, cédula y dirección para comprar" }, [
    { tipo: "avisar_asesor", motivo: "Va a comprar" },
    { tipo: "cambiar_etapa_crm", etapa: "Caliente" },
  ]);
  assert.equal(esReglaDeAsesora(datos), false);
});

await prueba("los temas se leen por palabra entera: 'contraentrega' no es 'tiempo de entrega'", () => {
  const contra = regla("r-contra", "Pregunta si hay contraentrega", frase("contraentrega"), [
    { tipo: "mensaje", texto: "Por ahora no manejamos contraentrega. ¿En qué *ciudad* estás?" },
  ]);
  assert.equal(temaDeLaRegla(contra), null);
  assert.equal(esReglaDeTema(contra), false);
  const entrega = regla("r-entrega", "Tiempo de entrega", frase("cuanto se demora"), [{ tipo: "mensaje", texto: "Llega en 3 a 5 días hábiles." }]);
  assert.equal(temaDeLaRegla(entrega).clave, "entrega");
});

await prueba("ningún mensaje juntado ofrece contraentrega", () => {
  assert.equal(partesDelTexto("Puedes pagar contraentrega. El envío es gratis.").linea, "El envío es gratis.");
  assert.equal(partesDelTexto("No manejamos contraentrega por ahora.").linea, "No manejamos contraentrega por ahora.");
  for (const mensaje of [
    "materiales garantía y envío es gratis?",
    "Materiales garantía y envío los costos es gratis??",
    "cuanto vale la silla rosada y tiene garantia?",
  ]) {
    const decision = decidir({ libro: libroDeEjemplo(), mensaje, estado: estadoCombo() });
    for (const texto of textoDe(decision)) {
      assert.ok(!/contra ?entrega/i.test(texto), `ofreció contraentrega en "${texto}"`);
    }
  }
  // Aunque una regla de tema la mencione, la frase que la ofrece no entra en la mezcla.
  const libro = libroDeEjemplo();
  libro.reglas = libro.reglas.map((r) =>
    r.id === "r-garantia"
      ? { ...r, entonces: [{ tipo: "mensaje", texto: "Puedes pagar contraentrega. La garantía es de 1 año. ¿En qué ciudad estás?" }] }
      : r,
  );
  const [texto] = textoDe(decidir({ libro, mensaje: "garantia y materiales?", estado: estadoCombo() }));
  assert.ok(!/contra ?entrega/i.test(texto));
  assert.match(texto, /✅ La garantía es de 1 año\./);
});

await prueba("de cada regla se toma su primera frase útil (sin relleno ni la pregunta)", () => {
  assert.deepEqual(partesDelTexto("¡Claro! 🚚 El envío es gratis. ¿En qué ciudad estás?"), {
    linea: "🚚 El envío es gratis.",
    pregunta: "¿En qué ciudad estás?",
  });
  assert.deepEqual(partesDelTexto("Con gusto 😊\nEs en cuero tex."), { linea: "Es en cuero tex.", pregunta: null });
  assert.equal(partesDelTexto("Claro, la garantía es de un año.").linea, "Claro, la garantía es de un año.");
});

await prueba("si una regla de tema contesta con IA, la IA recibe todo junto con la orden de líneas cortas", () => {
  const libro = libroDeEjemplo();
  libro.reglas = libro.reglas.map((r) =>
    r.id === "r-materiales"
      ? { ...r, entonces: [{ tipo: "responder_con_ia", guia: "Explica que es cuero tex con estructura metálica." }] }
      : r,
  );
  const decision = decidir({ libro, mensaje: "materiales garantía y envío es gratis?", estado: estadoCombo() });
  assert.equal(decision.acciones.length, 1);
  const [accion] = decision.acciones;
  assert.equal(accion.tipo, "responder_con_ia");
  assert.match(accion.guia, /varias preguntas/);
  assert.match(accion.guia, /una línea por tema/);
  assert.match(accion.guia, /cuero tex con estructura metálica/);
  assert.match(accion.guia, /1 año por defectos de fábrica/);
  assert.match(accion.guia, /envío es gratis/);
  assert.match(accion.guia, /Termina con esta única pregunta: ¿En qué \*ciudad\* estás\?/);
});

await prueba("con IA: la frase que ofrece contraentrega no le llega a la IA y la guía la prohíbe", () => {
  const libro = libroDeEjemplo();
  libro.reglas = libro.reglas.map((r) =>
    r.id === "r-materiales"
      ? { ...r, entonces: [{ tipo: "responder_con_ia", guia: "Puedes pagar contraentrega. Explica que es cuero tex." }] }
      : r.id === "r-garantia"
        ? { ...r, entonces: [{ tipo: "mensaje", texto: "Puedes pagar contra entrega. La garantía es de 1 año. ¿En qué ciudad estás?" }] }
        : r,
  );
  const [accion] = decidir({ libro, mensaje: "materiales garantía y envío es gratis?", estado: estadoCombo() }).acciones;
  assert.equal(accion.tipo, "responder_con_ia");
  assert.ok(!/pagar contra ?entrega/i.test(accion.guia), accion.guia);
  assert.match(accion.guia, /Explica que es cuero tex\./);
  assert.match(accion.guia, /La garantía es de 1 año\./);
  assert.match(accion.guia, /No ofrezcas pago contraentrega\./);
});

await prueba("de punta a punta (ejecutar): sale UN WhatsApp con las tres respuestas", async () => {
  mundo.libro = libroDeEjemplo();
  mundo.estado = estadoCombo();
  mundo.intenciones = [];
  const enviados = [];
  const avisos = [];
  const resultado = await atenderConAgenteV3({
    workspaceId: "ws",
    conversationId: "cv",
    mensaje: "materiales garantía y envío es gratis?",
    herramientas: {
      enviarPaso: async (paso) => {
        enviados.push(paso.kind === "text" ? paso.content : `[${paso.kind}]`);
        return true;
      },
      avisarAsesor: async (motivo) => {
        avisos.push(motivo);
      },
      cambiarEtapa: async () => {},
      pausarIa: async () => {},
      responderConIa: async () => {},
      yaLoDijimos: async () => false,
    },
  });
  assert.equal(resultado.atendido, true);
  assert.equal(enviados.length, 1);
  assert.match(enviados[0], /garantía[\s\S]*envío es gratis[\s\S]*cuero tex[\s\S]*¿En qué \*ciudad\* estás\?$/);
  assert.equal(avisos.length, 0);
  assert.equal(resultado.traza.reglaId, "r-garantia");
});

console.log(`\n${pruebas} pruebas ok`);
