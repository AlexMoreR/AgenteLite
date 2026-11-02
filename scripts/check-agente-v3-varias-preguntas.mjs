// Pruebas del Agente V3: varias preguntas en un mensaje se contestan TODAS en un solo mensaje corto
// (caso real del 26-10-2026, combo de camillas). Correr: node scripts/check-agente-v3-varias-preguntas.mjs
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

const reglasDominio = cargar(ruta("features/agente-v3/domain/reglas.ts"), reemplazos);
const { MOTIVO_PRECIO_DE_OTRO_PRODUCTO, preguntaPrecioDeOtroProducto } = cargar(
  ruta("features/agente-v3/motor/decidir.ts"),
  reemplazos,
);

// --- Un libro parecido al real, reducido -----------------------------------------------------------
const COMBO = "prod-combo-camillas";
const mensaje = (texto) => ({ tipo: "mensaje", texto });
const regla = (id, nombre, frases, entonces, extra = {}) => ({
  id,
  nombre,
  cuando: { tipo: "frase", frases },
  entonces,
  activa: true,
  ...extra,
});

const GARANTIA = "¡Claro! Todos nuestros productos tienen *garantía de 1 año* por defectos de fábrica. ¿En qué *ciudad* estás?";
const ENVIO_GRATIS =
  "🚚 Sí, el *envío es gratis* a tu local o casa en ciudades principales. ¿Me confirmas en qué ciudad estás?";
const ENVIO = "Hacemos envíos a todo el país con transportadora. ¿A qué ciudad sería?";
const MATERIALES = "Te cuento:\nEstán hechas en *cuero tex* con estructura metálica reforzada. ¿Qué color te gusta más?";
const PRECIO_COMBO = "El *combo* completo tiene un valor de *$989.000*. ¿En qué *ciudad* estás?";

const reglaGarantia = regla("r-garantia", "Pregunta por la garantía", ["garantia"], [mensaje(GARANTIA)]);
const reglaEnvioGratis = regla("e55ea1de-prueba", "¿el envío es gratis?", ["envio es gratis", "envio gratis", "es gratis"], [mensaje(ENVIO_GRATIS)]);
const reglaEnvio = regla("r-envio", "Pregunta por el envío", ["envio", "envios"], [mensaje(ENVIO)]);
const reglaMateriales = regla("r-materiales", "Pregunta de qué material son", ["material", "materiales"], [mensaje(MATERIALES)]);
const reglaPrecio = regla("r-precio", "Precio del combo", ["precio", "cuanto vale", "valor"], [mensaje(PRECIO_COMBO)], {
  soloSi: { productoActivo: COMBO },
});
const reglaCatalogo = regla(
  "r-catalogo",
  "Pide el catálogo: mandar el catálogo",
  ["catalogo"],
  [{ tipo: "flujo", flujoId: "flujo-catalogo", titulo: "Catálogo" }],
);
const reglaTomaCombo = regla(
  "r-toma-combo",
  "Le interesa el combo de camillas",
  ["combo de camillas", "combo"],
  [{ tipo: "activar_producto", productoId: COMBO }, { tipo: "ir_al_paso", paso: "IDENTIFICACION" }],
);
const reglaPasoIdentificacion = {
  id: "r-paso-identificacion",
  nombre: "Paso identificación del combo",
  cuando: { tipo: "paso", producto: COMBO, paso: "IDENTIFICACION" },
  entonces: [mensaje("¿Qué servicios vas a ofrecer en tu local?")],
  activa: true,
};
const SALUDO = "¡Hola! 👋 Bienvenida a Magilus.";
const reglaSaludo = {
  id: "r-saludo",
  nombre: "Saludo del primer mensaje",
  cuando: { tipo: "siempre" },
  soloSi: { esPrimerMensaje: true },
  entonces: [mensaje(SALUDO)],
  activa: true,
};
const reglaFotoYPrecio = {
  id: "r-foto-precio",
  nombre: "Manda foto o captura de un producto y pregunta el precio: no es el combo, pasar a la asesora",
  cuando: { tipo: "intencion", descripcion: "Manda foto o captura de un producto y pregunta el precio o cuánto vale" },
  entonces: [
    mensaje("Ya te confirmo el valor de esa referencia. ¿En qué *ciudad* estás?"),
    { tipo: "avisar_asesor", motivo: "Foto de un producto + precio (regla del libro)" },
    { tipo: "pausar_ia" },
  ],
  activa: true,
};

const libroCon = (...reglas) => ({ version: 7, actualizadoEl: "2026-10-26T00:00:00.000Z", comoHablamos: "", reglas });
const LIBRO = libroCon(
  reglaSaludo,
  reglaGarantia,
  reglaEnvio,
  reglaEnvioGratis,
  reglaMateriales,
  reglaTomaCombo,
  reglaPasoIdentificacion,
  reglaCatalogo,
  reglaFotoYPrecio,
  reglaPrecio,
);
const estadoCombo = (extra = {}) => ({
  productoActivo: COMBO,
  pasoActual: "PRODUCTO",
  flujosEnviados: [],
  esPrimerMensaje: false,
  ...extra,
});
const hace = (min) => new Date(Date.now() - min * 60_000);

function herramientasDePrueba() {
  const registro = { enviados: [], avisos: [], pausas: 0, ia: [] };
  return {
    registro,
    herramientas: {
      enviarPaso: async (paso) => {
        registro.enviados.push(paso.kind === "text" ? paso.content : `[${paso.kind}]`);
        return true;
      },
      avisarAsesor: async (motivo) => {
        registro.avisos.push(motivo);
      },
      cambiarEtapa: async () => {},
      pausarIa: async () => {
        registro.pausas += 1;
      },
      responderConIa: async (guia) => {
        registro.ia.push(guia);
      },
      yaLoDijimos: async () => false,
      responderSinRegla: async () => "Respondió el redactor",
    },
  };
}

async function atender({ libro = LIBRO, mensaje: texto, estado = estadoCombo(), recientes, foto = null }) {
  mundo.libro = libro;
  mundo.estado = estado;
  mundo.intenciones = [];
  const { registro, herramientas } = herramientasDePrueba();
  const resultado = await atenderConAgenteV3({ workspaceId: "ws", conversationId: "cv", mensaje: texto, recientes, foto, herramientas });
  return { resultado, ...registro };
}

const sinContraentrega = (textos) => {
  for (const texto of textos) assert.doesNotMatch(reglasDominio.normalizar(texto), /contra ?entrega/, `ofrece contraentrega: ${texto}`);
};

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

// --- La medida de la tarjeta ----------------------------------------------------------------------
const ESPERADO_TRES = [
  "🪑 Están hechas en *cuero tex* con estructura metálica reforzada.",
  "✅ Todos nuestros productos tienen *garantía de 1 año* por defectos de fábrica.",
  "🚚 Sí, el *envío es gratis* a tu local o casa en ciudades principales.",
  "¿En qué *ciudad* estás?",
].join("\n");

await prueba("'materiales garantía y envío es gratis?' → UN mensaje con las tres cosas, una línea cada una", async () => {
  const r = await atender({ mensaje: "materiales garantía y envío es gratis?" });
  assert.equal(r.enviados.length, 1, "un solo mensaje");
  assert.equal(r.enviados[0], ESPERADO_TRES);
  assert.deepEqual(r.avisos, []);
  assert.equal(r.pausas, 0);
  assert.match(r.resultado.porque, /varias cosas a la vez/);
  sinContraentrega(r.enviados);
});

await prueba("caso real del 26-oct: 'Materiales garantía y envío los costos es gratis??'", async () => {
  const r = await atender({ mensaje: "Materiales garantía y envío los costos es gratis??" });
  assert.equal(r.enviados.length, 1);
  assert.equal(r.enviados[0], ESPERADO_TRES);
});

await prueba("decidir (lo que usan el simulador y v3_probar_mensaje) da lo mismo y dice cuáles se juntaron", () => {
  const d = decidir({ libro: LIBRO, mensaje: "materiales garantía y envío es gratis?", estado: estadoCombo() });
  assert.deepEqual(d.acciones, [{ tipo: "mensaje", texto: ESPERADO_TRES }]);
  assert.deepEqual(
    d.juntas.map((j) => j.id),
    ["r-materiales", "r-garantia", "e55ea1de-prueba"],
  );
  // "Pregunta por el envío" también encajaba, pero va la más específica del mismo tema.
  assert.ok(d.tambienEncajaban.some((r) => r.id === "r-envio"));
  // Cada línea es corta: nada de párrafos.
  for (const linea of d.acciones[0].texto.split("\n")) assert.ok(linea.length <= 120, `línea larga: ${linea}`);
});

await prueba("la regla '¿el envío es gratis?' sale con su texto, sin cambiarle nada", () => {
  const d = decidir({ libro: LIBRO, mensaje: "garantia y el envio es gratis?", estado: estadoCombo() });
  assert.ok(d.acciones[0].texto.includes("Sí, el *envío es gratis* a tu local o casa en ciudades principales."));
});

// --- Una sola pregunta: igual que antes ----------------------------------------------------------
await prueba("una sola pregunta ('tiene garantía?') → la misma respuesta de antes, sin cambios", async () => {
  const r = await atender({ mensaje: "tiene garantía?" });
  assert.deepEqual(r.enviados, [GARANTIA]);
  assert.equal(r.resultado.regla, "Pregunta por la garantía");
  const d = decidir({ libro: LIBRO, mensaje: "tiene garantía?", estado: estadoCombo() });
  assert.equal(d.juntas, undefined);
});

await prueba("dos reglas del MISMO tema ('envío' y '¿es gratis?') no se juntan: gana una, como antes", async () => {
  const r = await atender({ mensaje: "el envio es gratis?" });
  assert.equal(r.enviados.length, 1);
  assert.ok(r.enviados[0] === ENVIO || r.enviados[0] === ENVIO_GRATIS);
  assert.equal(decidir({ libro: LIBRO, mensaje: "el envio es gratis?", estado: estadoCombo() }).juntas, undefined);
});

// --- Tema + precio de otro producto ----------------------------------------------------------------
await prueba("tema + '¿cuánto vale la silla X?' → contesta el tema y pasa SOLO el precio a la asesora", async () => {
  const r = await atender({ mensaje: "Tiene garantía? y cuánto vale la silla barbera?" });
  assert.equal(r.enviados.length, 1);
  const texto = r.enviados[0];
  assert.ok(texto.startsWith("✅ Todos nuestros productos tienen *garantía de 1 año*"), texto);
  assert.ok(texto.includes("👨🏻‍💻 Ya te confirmo el valor de esa referencia."), texto);
  assert.ok(!texto.includes("$989.000"), "nunca el precio del combo por otro producto");
  assert.ok(texto.endsWith("¿En qué *ciudad* estás?"));
  assert.deepEqual(r.avisos, [MOTIVO_PRECIO_DE_OTRO_PRODUCTO]);
  assert.equal(r.pausas, 1);
});

await prueba("sin regla de foto + precio en el libro, usa el texto del motor para pasar el precio", async () => {
  const libro = libroCon(reglaGarantia, reglaPrecio);
  const r = await atender({ libro, mensaje: "garantia? y cuanto vale el sofa?" });
  assert.equal(r.enviados.length, 1);
  assert.ok(r.enviados[0].includes("👨🏻‍💻 Déjame confirmarte el *valor de esa referencia* con exactitud."), r.enviados[0]);
  assert.ok(!r.enviados[0].includes("$989.000"));
  assert.deepEqual(r.avisos, [MOTIVO_PRECIO_DE_OTRO_PRODUCTO]);
});

await prueba("precio del COMBO + garantía: se contestan juntos, sin pasar a la asesora", async () => {
  const r = await atender({ mensaje: "cuanto vale el combo y que garantia tiene" });
  assert.equal(r.enviados.length, 1);
  assert.ok(r.enviados[0].includes("💰 El *combo* completo tiene un valor de *$989.000*."), r.enviados[0]);
  assert.ok(r.enviados[0].includes("✅ Todos nuestros productos"));
  assert.deepEqual(r.avisos, []);
});

await prueba("solo '¿cuánto vale la silla?' sin otro tema: sigue como antes (no se junta nada)", () => {
  const d = decidir({ libro: LIBRO, mensaje: "cuanto vale la silla?", estado: estadoCombo() });
  assert.equal(d.juntas, undefined);
  assert.equal(d.regla.id, "r-precio");
});

await prueba("preguntaPrecioDeOtroProducto: palabras enteras y nunca con el combo", () => {
  assert.equal(preguntaPrecioDeOtroProducto("cuánto vale la silla?"), true);
  assert.equal(preguntaPrecioDeOtroProducto("cuánto vale el combo con la silla?"), false);
  assert.equal(preguntaPrecioDeOtroProducto("equivale a una silla"), false);
  assert.equal(preguntaPrecioDeOtroProducto("garantía y envío"), false);
});

// --- Lo que NO cambia ---------------------------------------------------------------------------
await prueba("mensaje con foto de la clienta → sigue la regla de foto + precio, sin juntar", async () => {
  const r = await atender({
    mensaje: "Qué valor tiene así y tiene garantía?",
    recientes: [{ de: "cliente", tipo: "IMAGE", texto: "", cuando: hace(1) }, { de: "cliente", tipo: "TEXT", texto: "x", cuando: hace(0) }],
  });
  assert.equal(r.resultado.regla, reglaFotoYPrecio.nombre);
  assert.deepEqual(r.enviados, ["Ya te confirmo el valor de esa referencia. ¿En qué *ciudad* estás?"]);
  assert.equal(r.pausas, 1);
});

await prueba("primer mensaje con varias preguntas → el saludo sale como siempre, y después el mensaje junto", async () => {
  const r = await atender({
    mensaje: "materiales garantía y envío es gratis?",
    estado: estadoCombo({ esPrimerMensaje: true }),
  });
  assert.deepEqual(r.enviados, [SALUDO, ESPERADO_TRES]);
});

await prueba("primer mensaje de una sola pregunta → saludo + la regla, igual que antes", async () => {
  const r = await atender({ mensaje: "tiene garantia?", estado: estadoCombo({ esPrimerMensaje: true }) });
  assert.deepEqual(r.enviados, [SALUDO, GARANTIA]);
});

await prueba("si gana una regla que no es de tema (catálogo), todo sigue igual aunque haya temas", () => {
  const libro = libroCon(reglaCatalogo, reglaGarantia, reglaEnvio);
  const d = decidir({ libro, mensaje: "mandame el catalogo, garantia y envio", estado: estadoCombo() });
  assert.equal(d.regla.id, "r-catalogo");
  assert.equal(d.juntas, undefined);
  assert.deepEqual(d.acciones, reglaCatalogo.entonces);
});

await prueba("si gana la que toma el producto y mueve de paso, sigue el encadenado de UN paso como antes", () => {
  const libro = libroCon(reglaTomaCombo, reglaPasoIdentificacion, reglaGarantia, reglaEnvio);
  const d = decidir({ libro, mensaje: "me interesa el combo, garantia y envio?", estado: estadoCombo({ productoActivo: null, pasoActual: null }) });
  assert.equal(d.regla.id, "r-toma-combo");
  assert.equal(d.juntas, undefined);
  assert.deepEqual(d.acciones, [...reglaTomaCombo.entonces, ...reglaPasoIdentificacion.entonces]);
});

// --- Contraentrega y reglas que no son de tema ------------------------------------------------------
await prueba("ningún mensaje junto ofrece contraentrega, aunque una regla de tema la nombre", () => {
  const envioConContra = regla(
    "r-envio-contra",
    "Pregunta por el envío",
    ["envio"],
    [mensaje("Pagas contraentrega al recibir. El envío es gratis en ciudades principales. ¿En qué ciudad estás?")],
  );
  const d = decidir({ libro: libroCon(reglaGarantia, envioConContra), mensaje: "garantia y envio?", estado: estadoCombo() });
  assert.ok(d.juntas);
  sinContraentrega([d.acciones[0].texto]);
  assert.ok(d.acciones[0].texto.includes("🚚 El envío es gratis en ciudades principales."));
});

await prueba("una regla de pago/contraentrega nunca es de tema", () => {
  const pago = regla("r-pago", "Pregunta si hay contraentrega", ["contraentrega"], [mensaje("No manejamos pago contraentrega por ahora. ¿Te sirve transferencia?")]);
  assert.equal(reglasDominio.temaDeLaRegla(pago), null);
  assert.equal(reglasDominio.temaDeLaRegla(reglaCatalogo), null);
  assert.equal(reglasDominio.temaDeLaRegla(reglaFotoYPrecio), null);
  assert.equal(reglasDominio.temaDeLaRegla(reglaSaludo), null);
  assert.equal(reglasDominio.temaDeLaRegla(reglaGarantia).tema, "garantia");
  assert.equal(reglasDominio.temaDeLaRegla(reglaEnvioGratis).tema, "envio");
});

// --- Reglas que contestan con IA --------------------------------------------------------------------
await prueba("si una regla de tema contesta con IA, se le pasa a la IA UNA guía con los datos de todas", async () => {
  const pesoIa = {
    id: "r-peso",
    nombre: "Pregunta cuánto pesa",
    cuando: { tipo: "frase", frases: ["cuanto pesa", "peso"] },
    entonces: [{ tipo: "responder_con_ia", guia: "La camilla pesa 18 kilos." }],
    activa: true,
  };
  const r = await atender({ libro: libroCon(reglaGarantia, pesoIa), mensaje: "garantia y cuanto pesa?" });
  assert.deepEqual(r.enviados, [], "no se pega un texto fijo con uno de IA");
  assert.equal(r.ia.length, 1);
  assert.match(r.ia[0], /una línea por tema/);
  assert.match(r.ia[0], /garantía de 1 año/);
  assert.match(r.ia[0], /18 kilos/);
  assert.match(r.ia[0], /sin ofrecer contraentrega/);
  assert.match(r.ia[0], /¿En qué \*ciudad\* estás\?/);
});

console.log(`\n${pruebas} pruebas OK`);
