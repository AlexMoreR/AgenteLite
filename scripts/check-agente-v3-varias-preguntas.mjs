// Pruebas del Agente V3: varias preguntas en un mensaje se contestan todas, cortas y juntas
// (caso real del 26-oct-2026). Correr: npm run test:agente-v3-varias-preguntas
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

const { decidir } = cargar(ruta("features/agente-v3/motor/decidir.ts"), reemplazos);
const { atenderConAgenteV3 } = cargar(ruta("features/agente-v3/motor/ejecutar.ts"), reemplazos);

// --- Libro de ejemplo del combo de camillas ------------------------------------------------------
const COMBO = "prod-combo-camillas";
const regla = (id, nombre, frases, texto, extra = {}) => ({
  id,
  nombre,
  cuando: { tipo: "frase", frases },
  soloSi: { productoActivo: COMBO },
  entonces: [{ tipo: "mensaje", texto }],
  activa: true,
  ...extra,
});
const garantia = regla(
  "garantia",
  "Pregunta por la garantía",
  ["garantia"],
  "Tiene *garantía de 1 año* en estructura y espuma. ¿En qué *ciudad* estás?",
);
const envio = regla(
  "envio",
  "¿El envío es gratis?",
  ["envio", "domicilio"],
  "🚚 Envío gratis a tu local o casa en ciudades principales. Si pagas contraentrega, cuesta más. ¿Para qué *ciudad* lo necesitas?",
);
const materiales = regla(
  "materiales",
  "Pregunta por materiales",
  ["material"],
  "Es en cuero tex con estructura metálica.\nSe limpia fácil con paño húmedo.",
);
const precioOtro = {
  id: "precio-otro",
  nombre: "Pregunta el precio de otro producto: pasar a la asesora",
  cuando: { tipo: "frase", frases: ["cuanto vale la silla"] },
  entonces: [
    { tipo: "mensaje", texto: "Ya te confirmo el valor de esa referencia. ¿En qué *ciudad* estás?" },
    { tipo: "avisar_asesor", motivo: "Precio de otro producto" },
    { tipo: "pausar_ia" },
  ],
  activa: true,
};
const saludo = {
  id: "saludo",
  nombre: "Saludo del primer mensaje",
  cuando: { tipo: "siempre" },
  soloSi: { esPrimerMensaje: true },
  entonces: [{ tipo: "mensaje", texto: "¡Hola! Bienvenida a Magilus." }],
  activa: true,
};
const interes = {
  id: "interes",
  nombre: "Le interesa el combo",
  cuando: { tipo: "frase", frases: ["combo"] },
  entonces: [{ tipo: "activar_producto", productoId: COMBO }, { tipo: "mensaje", texto: "Te cuento del combo." }],
  activa: true,
};
const libro = (...reglas) => ({ version: 1, actualizadoEl: "2026-10-26T00:00:00.000Z", comoHablamos: "", reglas });
const estado = () => ({ productoActivo: COMBO, pasoActual: "PRODUCTO", flujosEnviados: [], esPrimerMensaje: false });
const LIBRO = libro(saludo, garantia, envio, materiales, precioOtro, interes);

const textoDe = (acciones) => acciones.filter((a) => a.tipo === "mensaje").map((a) => a.texto).join("\n");
let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

await prueba("materiales + garantía + envío: un solo mensaje con las tres cosas, una línea cada una", () => {
  const d = decidir({ libro: LIBRO, mensaje: "materiales garantía y envío es gratis?", estado: estado() });
  const mensajes = d.acciones.filter((a) => a.tipo === "mensaje");
  assert.equal(mensajes.length, 1, "un solo mensaje");
  const lineas = mensajes[0].texto.split("\n");
  assert.equal(lineas.length, 4, `tres temas y un cierre, salió: ${mensajes[0].texto}`);
  assert.match(lineas[0], /garantía de 1 año/i);
  assert.ok(lineas.some((l) => /^🚚 Envío gratis/.test(l)));
  assert.ok(lineas.some((l) => /cuero tex/.test(l)));
  assert.match(lineas[3], /^¿.*\?$/);
  assert.ok(!/contraentrega/i.test(mensajes[0].texto), "no ofrece contraentrega");
  assert.match(d.porque, /Varias preguntas/);
});

await prueba("una sola pregunta: la misma respuesta de antes", () => {
  const d = decidir({ libro: LIBRO, mensaje: "tiene garantía?", estado: estado() });
  assert.deepEqual(d.acciones, garantia.entonces);
  assert.doesNotMatch(d.porque, /Varias preguntas/);
});

await prueba("tema + precio de otro producto: responde el tema y pasa solo el precio a la asesora", () => {
  const d = decidir({ libro: LIBRO, mensaje: "garantía y cuanto vale la silla", estado: estado() });
  assert.equal(d.acciones.filter((a) => a.tipo === "mensaje").length, 1);
  assert.match(textoDe(d.acciones), /garantía de 1 año/i);
  assert.deepEqual(d.acciones.filter((a) => a.tipo === "avisar_asesor").length, 1);
  assert.equal(d.acciones.filter((a) => a.tipo === "pausar_ia").length, 1);
});

await prueba("regla que no es de tema (mover de paso): todo sigue igual", () => {
  const d = decidir({ libro: LIBRO, mensaje: "quiero el combo y la garantía", estado: { ...estado(), productoActivo: null, pasoActual: null } });
  assert.doesNotMatch(d.porque, /Varias preguntas/);
});

await prueba("primer mensaje: el saludo sale como siempre, y se suma la mezcla", () => {
  const d = decidir({ libro: LIBRO, mensaje: "garantía y envío", estado: { ...estado(), esPrimerMensaje: true } });
  assert.deepEqual(d.saludo, saludo.entonces);
  assert.match(textoDe(d.acciones), /garantía/i);
});

await prueba("foto de la clienta + precio: sigue la regla de foto + precio", () => {
  const reglaFoto = {
    id: "foto",
    nombre: "Manda foto de un producto y pregunta el precio: pasar a la asesora",
    cuando: { tipo: "intencion", descripcion: "Manda foto o captura de un producto y pregunta el precio" },
    entonces: [{ tipo: "mensaje", texto: "Ya te confirmo. ¿En qué *ciudad* estás?" }, { tipo: "avisar_asesor", motivo: "foto" }],
    activa: true,
  };
  const d = decidir({
    libro: libro(garantia, envio, reglaFoto),
    mensaje: "garantía y qué valor tiene así",
    estado: estado(),
    fotoDelCliente: { pie: null },
  });
  assert.equal(d.regla.id, "foto");
  assert.doesNotMatch(d.porque, /Varias preguntas/);
});

await prueba("ejecutar: sale un solo envío al cliente con las tres cosas", async () => {
  mundo.libro = LIBRO;
  mundo.estado = estado();
  mundo.intenciones = [];
  const enviados = [];
  const r = await atenderConAgenteV3({
    workspaceId: "ws",
    conversationId: "cv",
    mensaje: "Materiales garantía y envío los costos es gratis??",
    herramientas: {
      enviarPaso: async (paso) => (enviados.push(paso.content), true),
      avisarAsesor: async () => {},
      cambiarEtapa: async () => {},
      pausarIa: async () => {},
      responderConIa: async () => {},
      yaLoDijimos: async () => false,
    },
  });
  assert.equal(r.atendido, true);
  assert.equal(enviados.length, 1);
  assert.match(enviados[0], /garantía/i);
  assert.match(enviados[0], /Envío gratis/);
  assert.match(enviados[0], /cuero tex/);
});

console.log(`\n${pruebas} pruebas ok`);
