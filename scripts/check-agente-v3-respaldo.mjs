// Pruebas del respaldo del Agente V3: cuando la IA no logra redactar, el motor manda la ficha o un
// texto corto a la clienta. Correr: npm run test:agente-v3-respaldo
//
// Carga el motor REAL (ejecutar, decidir, respaldo) y el redactor REAL (responderConElRedactor)
// transpilando el TypeScript, y reemplaza solo lo que toca la base o la IA (almacén, estado,
// catálogo, clasificador, flujos y la IA que redacta, que aquí falla a propósito).
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
const mundo = { libro: null, estado: null, guardados: [], sugerencia: null, flujo: { steps: [] } };
const reemplazos = new Map([
  [ruta("lib/agent-product-flow.ts"), { getFlowReply: async () => mundo.flujo() }],
  [ruta("features/agente-v3/servicios/almacen.ts"), { leerLibro: async () => mundo.libro }],
  [
    ruta("features/agente-v3/servicios/catalogo.ts"),
    {
      // El catálogo no responde: el motor sigue su camino hacia el redactor.
      catalogoActivo: async () => {
        throw new Error("catálogo sin respuesta");
      },
      nombreLegible: (n) => n,
      productosInactivos: async () => new Set(),
      reconocerEnElCatalogo: () => null,
      textoDeUnProducto: () => "",
      textoDeVariasOpciones: () => "",
    },
  ],
  [ruta("features/agente-v3/servicios/decisiones.ts"), { anotarDecision: async () => {} }],
  [ruta("features/agente-v3/motor/clasificar.ts"), { clasificarIntenciones: async () => [] }],
  [
    ruta("features/agente-v3/motor/estado.ts"),
    {
      leerEstado: async () => structuredClone(mundo.estado),
      guardarEstado: async (_id, estado) => {
        mundo.guardados.push(structuredClone(estado));
      },
    },
  ],
  [ruta("lib/sugerencia-de-respuesta.ts"), { generarSugerenciaDeRespuesta: async () => mundo.sugerencia() }],
]);

const { atenderConAgenteV3 } = cargar(ruta("features/agente-v3/motor/ejecutar.ts"), reemplazos);
const { responderConElRedactor } = cargar(ruta("features/agente-v3/servicios/redactor.ts"), reemplazos);
const { TEXTO_DE_RESPALDO } = cargar(ruta("features/agente-v3/motor/respaldo.ts"), reemplazos);

assert.equal(
  TEXTO_DE_RESPALDO,
  "Te leo 🙌 ¿Qué te gustaría saber del combo: *precio*, *materiales*, *garantía* o *envío*?",
);

// Fallas de la IA, como las devuelve generarSugerenciaDeRespuesta.
const fallaPorTiempo = () => ({ error: "No se pudo generar la sugerencia.", causa: "tiempo de espera" });
const fallaVacia = () => ({ error: "No se pudo generar la sugerencia.", causa: "respuesta vacía" });

const FICHA = "flujo-ficha-camilla";
const COMBO = "prod-combo-camillas";
// Una regla que nunca aplica: así el motor entra por "ninguna regla aplica".
const libro = (...reglas) => ({
  version: 1,
  actualizadoEl: "2026-11-27T00:00:00.000Z",
  comoHablamos: "",
  reglas: [
    { id: "r-nunca", nombre: "Nunca", cuando: { tipo: "frase", frases: ["zzzqqq"] }, entonces: [{ tipo: "mensaje", texto: "x" }], activa: true },
    ...reglas,
  ],
});
const estadoDe = (extra = {}) => ({
  productoActivo: COMBO,
  pasoActual: "PRODUCTO",
  flujosEnviados: [],
  esPrimerMensaje: false,
  ...extra,
});

/**
 * Una vuelta completa. `yaSalio` son los textos que ya se habían mandado; `buscarFlujo` devuelve el id
 * de la ficha. `responderSinRegla` es el real: el redactor, con la IA simulada.
 */
async function atender({
  mensaje,
  foto = null,
  estado,
  libroDe = libro(),
  sugerencia,
  yaSalio = [],
  buscarFlujo = async () => FICHA,
  pasos = [{ kind: "image", url: "/ficha-1.jpg" }, { kind: "text", content: "Ficha de la camilla" }],
  conRespondeString = null,
}) {
  mundo.libro = libroDe;
  mundo.estado = estado;
  mundo.guardados = [];
  mundo.sugerencia = sugerencia;
  mundo.flujo = async () => ({ steps: pasos });
  const registro = { enviados: [], avisos: [], pausas: 0, buscados: [] };
  const yaLoDijimos = async (texto) => yaSalio.includes(texto) || registro.enviados.includes(texto);
  const enviarTexto = async (texto) => {
    registro.enviados.push(texto);
    return true;
  };
  const herramientas = {
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
    responderConIa: async () => {},
    yaLoDijimos,
    buscarFlujo: async (titulo) => {
      registro.buscados.push(titulo);
      return buscarFlujo(titulo);
    },
    responderSinRegla: async ({ foto: f }) =>
      conRespondeString ??
      responderConElRedactor({
        workspaceId: "ws",
        conversationId: "cv",
        foto: f,
        enviarTexto,
        avisarAsesor: async (motivo) => {
          registro.avisos.push(motivo);
        },
        yaLoDijimos,
        pausarIa: async () => {
          registro.pausas += 1;
        },
      }),
  };
  const resultado = await atenderConAgenteV3({
    workspaceId: "ws",
    conversationId: "cv",
    mensaje,
    foto,
    incluirApiOficial: true,
    herramientas,
  });
  return { resultado, ...registro, guardados: mundo.guardados };
}

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

// --- (a) PRESENTACION + camillas + la IA se pasa del tiempo: sale la ficha --------------------------
await prueba("(a) PRESENTACION, la IA se pasa del tiempo: salen los pasos de la ficha, queda en PRODUCTO y se avisa", async () => {
  const r = await atender({
    mensaje: "Soy lashita camilla etc",
    estado: estadoDe({ productoActivo: null, pasoActual: "PRESENTACION" }),
    sugerencia: fallaPorTiempo,
  });
  assert.deepEqual(r.buscados, ["Ficha Camilla Divan"]);
  assert.deepEqual(r.enviados, ["[image]", "Ficha de la camilla"]);
  const ultimo = r.guardados.at(-1);
  assert.equal(ultimo.pasoActual, "PRODUCTO");
  assert.deepEqual(ultimo.flujosEnviados, [FICHA]);
  assert.equal(r.guardados.length, 2, "se guarda el estado de hoy y otra vez el del respaldo");
  assert.equal(r.avisos.length, 1);
  assert.match(r.avisos[0], /tiempo de espera/);
  assert.equal(r.resultado.atendido, true);
  assert.equal(r.resultado.regla, "Redactor");
  assert.match(r.resultado.porque, /Ficha Camilla Divan/);
  assert.deepEqual(r.resultado.traza.respaldo, { tipo: "ficha", causa: "tiempo de espera" });
  assert.equal(r.resultado.traza.despues.pasoActual, "PRODUCTO");
  assert.equal(r.resultado.traza.mensajesEnviados, 2);
});

// --- (b) respuesta vacía en PRODUCTO: sale el texto -------------------------------------------------
await prueba("(b) 'Las 3' en PRODUCTO con respuesta vacía: sale exactamente el texto de respaldo", async () => {
  const r = await atender({ mensaje: "Las 3", estado: estadoDe(), sugerencia: fallaVacia });
  assert.deepEqual(r.enviados, [TEXTO_DE_RESPALDO]);
  assert.deepEqual(r.buscados, [], "fuera de PRESENTACION no se busca la ficha");
  assert.equal(r.avisos.length, 1);
  assert.deepEqual(r.resultado.traza.respaldo, { tipo: "texto", causa: "respuesta vacía" });
  assert.equal(r.resultado.acciones, 1);
});

// --- (c) todo ya había salido: no se manda nada, solo el aviso --------------------------------------
await prueba("(c) el texto ya había salido: no se repite y solo queda el aviso", async () => {
  const r = await atender({ mensaje: "Las 3", estado: estadoDe(), sugerencia: fallaVacia, yaSalio: [TEXTO_DE_RESPALDO] });
  assert.deepEqual(r.enviados, []);
  assert.equal(r.avisos.length, 1);
  assert.equal(r.resultado.atendido, true);
  assert.equal(r.resultado.acciones, 0);
  assert.deepEqual(r.resultado.traza.respaldo, { tipo: "nada", causa: "respuesta vacía" });
});

await prueba("(c) la ficha ya había salido y el texto también: no sale nada", async () => {
  const r = await atender({
    mensaje: "hola",
    estado: estadoDe({ pasoActual: "PRESENTACION", flujosEnviados: [FICHA] }),
    sugerencia: fallaVacia,
    yaSalio: [TEXTO_DE_RESPALDO],
  });
  assert.deepEqual(r.enviados, []);
  assert.equal(r.avisos.length, 1);
});

// --- (d) PRESENTACION con la ficha ya enviada: texto, sin repetir la ficha --------------------------
await prueba("(d) PRESENTACION con la ficha ya enviada: sale el texto y la ficha no se repite", async () => {
  const r = await atender({
    mensaje: "hola",
    estado: estadoDe({ pasoActual: "PRESENTACION", flujosEnviados: [FICHA] }),
    sugerencia: fallaPorTiempo,
  });
  assert.deepEqual(r.enviados, [TEXTO_DE_RESPALDO]);
  assert.equal(r.guardados.length, 1, "el estado no cambió: no se guarda otra vez");
  assert.equal(r.guardados[0].pasoActual, "PRESENTACION");
});

// --- (e) con un texto (como hoy en producción) todo sigue igual -------------------------------------
await prueba("(e) responderSinRegla devuelve un texto: nada de respaldo, igual que hoy", async () => {
  const r = await atender({
    mensaje: "hola",
    estado: estadoDe({ pasoActual: "PRESENTACION" }),
    sugerencia: fallaPorTiempo,
    conRespondeString: "El redactor no pudo responder: se avisó a una asesora.",
  });
  assert.deepEqual(r.enviados, []);
  assert.deepEqual(r.buscados, []);
  assert.equal(r.guardados.length, 1);
  assert.equal(r.resultado.porque, "El redactor no pudo responder: se avisó a una asesora.");
  assert.equal(r.resultado.acciones, 1);
  assert.equal(r.resultado.traza.respaldo, undefined);
});

await prueba("(e) el redactor responde bien (respondio: true): no hay respaldo", async () => {
  const r = await atender({
    mensaje: "hola",
    estado: estadoDe({ pasoActual: "PRESENTACION" }),
    sugerencia: () => ({ texto: "Claro, ¿en qué ciudad estás?", productoId: null, flujo: null, faltaDato: false, problemas: [] }),
  });
  assert.deepEqual(r.enviados, ["Claro, ¿en qué ciudad estás?"]);
  assert.equal(r.avisos.length, 0);
  assert.equal(r.guardados.length, 1);
  assert.equal(r.resultado.traza.respaldo, undefined);
});

// --- extras: la ficha falla o no aplica -------------------------------------------------------------
await prueba("(f) si buscarFlujo lanza un error o no encuentra la ficha, sale el texto", async () => {
  for (const buscarFlujo of [async () => { throw new Error("base caída"); }, async () => null]) {
    const r = await atender({
      mensaje: "hola",
      estado: estadoDe({ pasoActual: "PRESENTACION", productoActivo: null }),
      sugerencia: fallaVacia,
      buscarFlujo,
    });
    assert.deepEqual(r.enviados, [TEXTO_DE_RESPALDO]);
    assert.equal(r.guardados.length, 1);
  }
});

await prueba("(f) si la ficha no tiene pasos, sale el texto y el estado no cambia", async () => {
  const r = await atender({
    mensaje: "hola",
    estado: estadoDe({ pasoActual: "PRESENTACION" }),
    sugerencia: fallaVacia,
    pasos: [],
  });
  assert.deepEqual(r.enviados, [TEXTO_DE_RESPALDO]);
  assert.equal(r.guardados.at(-1).pasoActual, "PRESENTACION");
});

await prueba("(f) producto que no es de camillas: en PRESENTACION sale el texto, no la ficha", async () => {
  const r = await atender({
    mensaje: "hola",
    estado: estadoDe({ productoActivo: "prod-sillas", pasoActual: "PRESENTACION" }),
    sugerencia: fallaVacia,
  });
  assert.deepEqual(r.enviados, [TEXTO_DE_RESPALDO]);
});

await prueba("(f) el producto se llama 'Camilla' en la acción activar_producto del libro: sale la ficha", async () => {
  const r = await atender({
    mensaje: "hola",
    estado: estadoDe({ productoActivo: "prod-123", pasoActual: "PRESENTACION" }),
    libroDe: libro({
      id: "r-activa",
      nombre: "Activa",
      cuando: { tipo: "frase", frases: ["zzzqqq2"] },
      entonces: [{ tipo: "activar_producto", productoId: "prod-123", nombre: "Camilla Divan Eléctrica" }],
      activa: true,
    }),
    sugerencia: fallaVacia,
  });
  assert.deepEqual(r.enviados, ["[image]", "Ficha de la camilla"]);
});

await prueba("(g) foto sin texto + falla de la IA: respaldo con el estado ya avanzado", async () => {
  const r = await atender({
    mensaje: "",
    foto: "una camilla rosada",
    estado: estadoDe({ productoActivo: null, pasoActual: "PRESENTACION" }),
    sugerencia: fallaPorTiempo,
  });
  assert.equal(r.resultado.regla, "Redactor (foto)");
  assert.deepEqual(r.enviados, ["[image]", "Ficha de la camilla"]);
  assert.equal(r.guardados.length, 2);
  assert.equal(r.guardados.at(-1).pasoActual, "PRODUCTO");
  assert.equal(r.avisos.length, 1);
});

console.log(`\n${pruebas} pruebas ok`);
