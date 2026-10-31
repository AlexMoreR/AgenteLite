// Pruebas del Agente V3: varias preguntas en un mensaje se contestan todas en un mensaje corto
// (caso real del 26-10-2026, "Materiales garantía y envío los costos es gratis??"). Correr: npm run test:agente-v3-varias-preguntas
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
const varias = cargar(ruta("features/agente-v3/motor/varias-preguntas.ts"), reemplazos);

// --- El libro de ejemplo: el del combo de camillas, reducido -------------------------------------
const COMBO = "prod-combo-camillas";
const GARANTIA = "✅ Tiene *garantía de 1 año* por defectos de fábrica. ¿En qué *ciudad* estás?";
const ENVIO =
  "¡Claro que sí! El *envío es gratis* a tu local o casa en ciudades principales. Si prefieres, también hay pago contraentrega. ¿En qué *ciudad* estás?";
const MATERIALES = "Es en *cuero tex* con estructura metálica, muy resistente.\n¿Qué color te gusta más?";
const PRECIO_DEL_COMBO = "El *combo* completo tiene un valor de *$989.000*. ¿En qué *ciudad* estás?";
const SALUDO = "¡Hola! 👋 Bienvenida a Magilus. ¿Qué te gustaría ver hoy?";

const reglaSaludo = {
  id: "saludo",
  nombre: "Saludo del primer mensaje",
  cuando: { tipo: "siempre" },
  soloSi: { esPrimerMensaje: true },
  entonces: [{ tipo: "mensaje", texto: SALUDO }],
  activa: true,
};
const reglaGarantia = {
  id: "garantia",
  nombre: "Pregunta por la garantía",
  cuando: { tipo: "frase", frases: ["garantia"] },
  entonces: [{ tipo: "mensaje", texto: GARANTIA }],
  activa: true,
};
const reglaEnvio = {
  id: "e55ea1de",
  nombre: "¿el envío es gratis?",
  cuando: { tipo: "frase", frases: ["es gratis", "envio gratis", "cuanto vale el envio"] },
  entonces: [{ tipo: "mensaje", texto: ENVIO }],
  activa: true,
};
const reglaMateriales = {
  id: "materiales",
  nombre: "Pregunta de qué material es",
  cuando: { tipo: "intencion", descripcion: "Pregunta de qué material está hecho el producto" },
  soloSi: { productoActivo: "cualquiera" },
  entonces: [{ tipo: "mensaje", texto: MATERIALES }],
  activa: true,
};
const reglaPrecioGenerica = {
  id: "regla-precio-combo",
  nombre: "Precio del combo",
  cuando: { tipo: "frase", frases: ["precio", "cuanto vale", "cuanto cuesta"] },
  soloSi: { productoActivo: COMBO },
  entonces: [{ tipo: "mensaje", texto: PRECIO_DEL_COMBO }],
  activa: true,
};
const reglaPrecioOtro = {
  id: "precio-otro",
  nombre: "Pregunta el precio de otro producto que no es el combo: pasar a la asesora",
  cuando: { tipo: "intencion", descripcion: "Pregunta el precio de un producto distinto al combo de camillas" },
  entonces: [
    { tipo: "mensaje", texto: "Ya te confirmo el valor de esa referencia con una asesora. ¿En qué *ciudad* estás?" },
    { tipo: "avisar_asesor", motivo: "Pregunta el precio de otro producto" },
  ],
  activa: true,
};
const reglaFotoYPrecio = {
  id: "foto-precio",
  nombre: "Manda foto o captura de un producto y pregunta el precio: pasar a la asesora",
  cuando: { tipo: "intencion", descripcion: "Manda foto o captura de un producto y pregunta el precio" },
  entonces: [
    { tipo: "mensaje", texto: "Ya te confirmo el valor de esa referencia. ¿En qué *ciudad* estás?" },
    { tipo: "avisar_asesor", motivo: "Foto + precio" },
    { tipo: "pausar_ia" },
  ],
  activa: true,
};
const reglaQuieroElCombo = {
  id: "quiero-combo",
  nombre: "Le interesa el combo de camillas",
  cuando: { tipo: "frase", frases: ["combo de camillas"] },
  entonces: [{ tipo: "activar_producto", productoId: COMBO }, { tipo: "ir_al_paso", paso: "PRODUCTO" }],
  activa: true,
};
const reglaPasoProducto = {
  id: "paso-producto",
  nombre: "Paso producto del combo",
  cuando: { tipo: "paso", producto: COMBO, paso: "PRODUCTO" },
  entonces: [{ tipo: "mensaje", texto: "Te cuento del combo. ¿Para qué servicio lo necesitas?" }],
  activa: true,
};

const libro = (...reglas) => ({ version: 7, actualizadoEl: "2026-10-26T00:00:00.000Z", comoHablamos: "", reglas });
const LIBRO = libro(
  reglaSaludo,
  reglaQuieroElCombo,
  reglaPasoProducto,
  reglaGarantia,
  reglaEnvio,
  reglaMateriales,
  reglaPrecioOtro,
  reglaFotoYPrecio,
  reglaPrecioGenerica,
);
const estadoCombo = (extra = {}) => ({
  productoActivo: COMBO,
  pasoActual: "PRODUCTO",
  flujosEnviados: [],
  esPrimerMensaje: false,
  ...extra,
});
const hace = (min) => new Date(Date.now() - min * 60_000);
const textos = (acciones) => acciones.filter((a) => a.tipo === "mensaje").map((a) => a.texto);
const sinContraentrega = (texto) => assert.ok(!/contra ?entrega/i.test(texto), `ofrece contraentrega: ${texto}`);

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

async function atender({ mensaje, estado = estadoCombo(), intenciones = [], recientes, foto = null, conLibro = LIBRO }) {
  mundo.libro = conLibro;
  mundo.estado = estado;
  mundo.intenciones = intenciones;
  const { registro, herramientas } = herramientasDePrueba();
  const resultado = await atenderConAgenteV3({ workspaceId: "ws", conversationId: "cv", mensaje, recientes, foto, herramientas });
  return { resultado, ...registro };
}

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

// --- La medida de la tarjeta ---------------------------------------------------------------------
await prueba("'materiales garantía y envío es gratis?': un solo mensaje corto con las tres cosas", async () => {
  const r = await atender({ mensaje: "materiales garantía y envío es gratis?" });
  assert.equal(r.enviados.length, 1, `un solo mensaje, salieron: ${JSON.stringify(r.enviados)}`);
  const lineas = r.enviados[0].split("\n");
  assert.deepEqual(lineas, [
    "🪑 Es en *cuero tex* con estructura metálica, muy resistente.",
    "✅ Tiene *garantía de 1 año* por defectos de fábrica.",
    "🚚 El *envío es gratis* a tu local o casa en ciudades principales.",
    "¿En qué *ciudad* estás?",
  ]);
  sinContraentrega(r.enviados[0]);
  assert.deepEqual(r.avisos, []);
  assert.equal(r.pausas, 0);
  assert.match(r.resultado.porque, /varias preguntas/);
});

await prueba("el caso real del 26-oct ('Materiales garantía y envío los costos es gratis??') contesta las tres", async () => {
  const r = await atender({ mensaje: "Materiales garantía y envío los costos es gratis??" });
  assert.equal(r.enviados.length, 1);
  assert.match(r.enviados[0], /cuero tex/);
  assert.match(r.enviados[0], /garantía de 1 año/);
  assert.match(r.enviados[0], /envío es gratis/);
  // Una sola pregunta, al final.
  assert.equal((r.enviados[0].match(/\?/g) ?? []).length, 1);
  assert.ok(r.enviados[0].trim().endsWith("?"));
});

await prueba("con la IA reconociendo la intención de materiales da lo mismo", async () => {
  const d = decidir({ libro: LIBRO, mensaje: "garantía y envío es gratis? y el material", estado: estadoCombo(), intencionesReconocidas: ["materiales"] });
  assert.equal(d.acciones.length, 1);
  assert.equal(textos(d.acciones)[0].split("\n").length, 4);
});

// --- Lo que no cambia ----------------------------------------------------------------------------
await prueba("una sola pregunta: la misma respuesta de antes, entera", async () => {
  const r = await atender({ mensaje: "Que garantía tiene?" });
  assert.deepEqual(r.enviados, [GARANTIA]);
  assert.equal(r.resultado.regla, reglaGarantia.nombre);
});

await prueba("una sola pregunta sin regla que la cubra (envío solo por palabra): igual que antes", async () => {
  const d = decidir({ libro: LIBRO, mensaje: "hacen envíos?", estado: estadoCombo() });
  assert.equal(d.regla, null);
});

await prueba("mensaje con foto + precio: sigue la regla de foto + precio", async () => {
  const r = await atender({
    mensaje: "y esta cuanto vale? tiene garantía?",
    foto: "una silla rosada",
    recientes: [{ de: "cliente", tipo: "IMAGE", texto: "y esta cuanto vale? tiene garantía?", cuando: hace(0) }],
  });
  assert.equal(r.resultado.regla, reglaFotoYPrecio.nombre);
  assert.equal(r.pausas, 1);
  assert.ok(!r.enviados.includes(PRECIO_DEL_COMBO));
});

await prueba("primer mensaje: el saludo sale como siempre, antes de la respuesta juntada", async () => {
  const r = await atender({
    mensaje: "hola, materiales garantía y envío es gratis?",
    estado: { productoActivo: null, pasoActual: null, flujosEnviados: [], esPrimerMensaje: true },
  });
  assert.equal(r.enviados[0], SALUDO);
  assert.equal(r.enviados.length, 2);
  // Sin producto activo, la de materiales (que pide producto) no entra: garantía y envío sí.
  assert.match(r.enviados[1], /garantía de 1 año/);
  assert.match(r.enviados[1], /envío es gratis/);
});

await prueba("gana una regla que mueve la charla (elige el combo): sigue ganando sola, con su paso", async () => {
  const d = decidir({
    libro: LIBRO,
    mensaje: "me interesa el combo de camillas, tiene garantía? el envío es gratis?",
    estado: { productoActivo: null, pasoActual: null, flujosEnviados: [], esPrimerMensaje: false },
  });
  assert.equal(d.regla.id, "quiero-combo");
  assert.deepEqual(textos(d.acciones), ["Te cuento del combo. ¿Para qué servicio lo necesitas?"]);
});

// --- La parte que necesita asesora ---------------------------------------------------------------
await prueba("tema + '¿cuánto vale la silla X?': contesta el tema y pasa solo el precio a la asesora", async () => {
  const r = await atender({ mensaje: "tiene garantía? y cuánto vale la silla barbera X?", intenciones: ["precio-otro"] });
  assert.equal(r.enviados.length, 1);
  assert.ok(!r.enviados.includes(PRECIO_DEL_COMBO), "no da el precio del combo por otra silla");
  assert.ok(!r.enviados[0].includes("$989.000"));
  assert.match(r.enviados[0], /garantía de 1 año/);
  assert.match(r.enviados[0], /asesora/);
  assert.deepEqual(r.avisos, ["Pregunta el precio de otro producto"]);
  assert.equal(r.pausas, 0);
});

// --- Contraentrega y responder con IA ------------------------------------------------------------
await prueba("ningún mensaje juntado ofrece contraentrega, aunque la regla lo traiga más adelante", async () => {
  for (const mensaje of ["garantía y envío es gratis?", "envío gratis? garantía? materiales?", "colores, garantía y es gratis el envío?"]) {
    const d = decidir({ libro: LIBRO, mensaje, estado: estadoCombo() });
    for (const texto of textos(d.acciones)) sinContraentrega(texto);
  }
  const soloContraentrega = {
    ...reglaEnvio,
    entonces: [{ tipo: "mensaje", texto: "Tenemos pago contraentrega en todo el país. ¿Pagas contraentrega?" }],
  };
  const d = decidir({ libro: libro(reglaGarantia, soloContraentrega), mensaje: "garantía? envío es gratis?", estado: estadoCombo() });
  // Sin frase útil del envío no hay qué juntar: gana la garantía sola, como antes.
  assert.deepEqual(textos(d.acciones), [GARANTIA]);
});

await prueba("si una regla de tema usa 'responder con IA', la IA recibe una sola guía juntada", async () => {
  const garantiaConIa = { ...reglaGarantia, entonces: [{ tipo: "responder_con_ia", guia: "Explica la garantía de 1 año." }] };
  const r = await atender({ mensaje: "garantía y envío es gratis?", conLibro: libro(garantiaConIa, reglaEnvio) });
  assert.equal(r.enviados.length, 0);
  assert.equal(r.ia.length, 1);
  assert.match(r.ia[0], /UN solo mensaje corto/);
  assert.match(r.ia[0], /garantía de 1 año/);
  assert.match(r.ia[0], /envío es gratis/);
  assert.match(r.ia[0], /Nunca ofrezcas pago contraentrega/);
  // El dato de la regla de envío llega sin la frase de contraentrega.
  assert.ok(!/también hay pago contraentrega/.test(r.ia[0]));
});

// --- Los ayudantes -------------------------------------------------------------------------------
await prueba("temas: reconoce los seis y respeta el orden en que se preguntaron", async () => {
  assert.deepEqual(varias.temasQueNombra("Materiales garantía y envío los costos es gratis??"), ["materiales", "garantia", "envio"]);
  assert.deepEqual(varias.temasQueNombra("cuánto pesa, qué colores hay y cuánto se demora?"), ["peso", "colores", "tiempo_de_entrega"]);
  assert.deepEqual(varias.temasQueNombra("cual es el tiempo de envío"), ["tiempo_de_entrega"]);
  assert.equal(varias.temaDeLaRegla(reglaEnvio), "envio");
  assert.equal(varias.temaDeLaRegla(reglaQuieroElCombo), null);
  assert.equal(varias.temaDeLaRegla(reglaFotoYPrecio), null);
  assert.equal(varias.temaDeLaRegla(reglaPrecioGenerica), null);
  assert.equal(varias.esReglaQuePasaAAsesora(reglaPrecioOtro), true);
  assert.equal(varias.esReglaQuePasaAAsesora(reglaFotoYPrecio), false);
});

console.log(`\n${pruebas} pruebas ok`);
