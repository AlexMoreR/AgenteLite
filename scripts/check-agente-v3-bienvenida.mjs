// Pruebas del Agente V3: varias bienvenidas en el libro y que en el primer mensaje salga UNA sola
// (tarjeta del 02-11-2026). Correr: npm run test:agente-v3-bienvenida
//
// Carga el motor REAL (decidir) y las herramientas REALES del MCP transpilando el TypeScript, con un
// libro chico que imita el real. Reemplaza solo lo que toca la base (almacén y simulador).
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

// --- Reemplazos: el libro vive en memoria en vez de la base ---------------------------------------
const mundo = { libro: null };
const reemplazos = new Map([
  [
    ruta("features/agente-v3/servicios/almacen.ts"),
    {
      leerLibro: async () => mundo.libro,
      guardarLibro: async ({ libro }) => {
        mundo.libro = { ...libro, version: libro.version + 1 };
        return { version: mundo.libro.version, problemas: [] };
      },
      leerHistorialDelLibro: async () => [],
      cambiosDelHistorial: () => [],
      volverAVersion: async () => ({ ok: false, error: "no en la prueba" }),
    },
  ],
  [ruta("features/agente-v3/servicios/simulador.ts"), { simularConversacion: async () => ({ turnos: [] }) }],
]);

const { decidir } = cargar(ruta("features/agente-v3/motor/decidir.ts"), reemplazos);
const { ejecutarHerramientaMcpV3 } = cargar(ruta("lib/mcp/agente-v3.ts"), reemplazos);

// --- Un libro chico que imita el real (versión 295) ------------------------------------------------
const GENERAL = "workflow-1793036895217-jbjl7";
const COMBO = "workflow-1788390191659-idc4r";
const LAVACABEZAS = "flujo-catalogo-lavacabezas";

const BIENVENIDA_GENERAL = {
  id: "regla-ccc597f3-0a81-43fc-853c-1648bdb5a696",
  nombre: "Bienvenida General",
  cuando: { tipo: "siempre" },
  soloSi: { esPrimerMensaje: true },
  entonces: [{ tipo: "flujo", flujoId: GENERAL, titulo: "Bienvenida General" }],
  activa: true,
};
const ANUNCIO_COMBO = {
  id: "regla-d1f2cf99",
  nombre: "Llega del anuncio del combo",
  cuando: { tipo: "frase", frases: ["me interesa el combo de estetica"] },
  soloSi: { esPrimerMensaje: true },
  entonces: [
    { tipo: "flujo", flujoId: COMBO, titulo: "Bienvenida Combo Camillas" },
    { tipo: "activar_producto", productoId: "combo-camillas" },
  ],
  activa: true,
  reemplazaLaBienvenida: true,
};
const LAVACABEZAS_PRIMERO = {
  id: "regla-lavacabezas",
  nombre: "Pide lavacabezas",
  cuando: { tipo: "frase", frases: ["lavacabezas"] },
  entonces: [{ tipo: "flujo", flujoId: LAVACABEZAS, titulo: "Catálogo de lavacabezas" }],
  activa: true,
};
const TRAE_LA_GENERAL = {
  id: "regla-silla",
  nombre: "Primer mensaje pide silla",
  cuando: { tipo: "frase", frases: ["silla de barberia"] },
  soloSi: { esPrimerMensaje: true },
  entonces: [
    { tipo: "flujo", flujoId: GENERAL, titulo: "Bienvenida General" },
    { tipo: "flujo", flujoId: "flujo-sillas", titulo: "Catálogo de sillas" },
  ],
  activa: true,
};
const libroReal = () => ({
  version: 295,
  actualizadoEl: new Date(0).toISOString(),
  comoHablamos: "Vendemos mobiliario para estética y barbería.",
  reglas: [BIENVENIDA_GENERAL, ANUNCIO_COMBO, LAVACABEZAS_PRIMERO, TRAE_LA_GENERAL],
});
const primerMensaje = { productoActivo: null, pasoActual: null, flujosEnviados: [], esPrimerMensaje: true };
const flujosQueSalen = (decision) =>
  [...decision.saludo, ...decision.acciones].filter((accion) => accion.tipo === "flujo").map((accion) => accion.flujoId);

let fallas = 0;
async function prueba(nombre, fn) {
  try {
    await fn();
    console.log(`✔ ${nombre}`);
  } catch (error) {
    fallas += 1;
    console.error(`✘ ${nombre}\n  ${error instanceof Error ? error.message : error}`);
  }
}

// --- Motor ----------------------------------------------------------------------------------------
await prueba("anuncio del combo → solo la Bienvenida Combo, y el porqué lo dice", () => {
  const decision = decidir({
    libro: libroReal(),
    mensaje: "Hola, me interesa el *COMBO* de estética (camilla, escalera, silla y auxiliar)",
    estado: primerMensaje,
  });
  assert.equal(decision.regla?.id, ANUNCIO_COMBO.id);
  assert.deepEqual(decision.saludo, []);
  assert.deepEqual(flujosQueSalen(decision), [COMBO]);
  assert.equal(decision.bienvenida.sale, false);
  assert.deepEqual(decision.bienvenida.reemplazadaPor, { id: ANUNCIO_COMBO.id, nombre: ANUNCIO_COMBO.nombre });
  assert.match(decision.porque, /No sale "Bienvenida General" porque "Llega del anuncio del combo" ya manda su propia bienvenida/);
});

await prueba("lavacabezas → Bienvenida General primero y después el catálogo", () => {
  const decision = decidir({ libro: libroReal(), mensaje: "quería cotizar un lavacabezas", estado: primerMensaje });
  assert.equal(decision.regla?.id, LAVACABEZAS_PRIMERO.id);
  assert.deepEqual(flujosQueSalen(decision), [GENERAL, LAVACABEZAS]);
  assert.equal(decision.bienvenida.sale, true);
  assert.equal(decision.bienvenida.reemplazadaPor, null);
  assert.match(decision.porque, /^Ganó "Pide lavacabezas" porque .*Sale primero "Bienvenida General"\.$/);
});

await prueba("una regla que ya trae la General adentro → la General sale una sola vez", () => {
  const decision = decidir({ libro: libroReal(), mensaje: "busco una silla de barberia", estado: primerMensaje });
  assert.equal(decision.regla?.id, TRAE_LA_GENERAL.id);
  assert.deepEqual(flujosQueSalen(decision), [GENERAL, "flujo-sillas"]);
  assert.equal(decision.bienvenida.sale, false);
  assert.match(decision.bienvenida.motivo, /ya la manda/);
});

await prueba('"Hola" → la General sola, con el mismo texto de hoy', () => {
  const decision = decidir({ libro: libroReal(), mensaje: "Hola", estado: primerMensaje });
  assert.equal(decision.regla, null);
  assert.deepEqual(flujosQueSalen(decision), [GENERAL]);
  assert.equal(decision.bienvenida.sale, true);
  assert.equal(decision.porque, "Sale el saludo del primer mensaje; ninguna otra regla encajó.");
});

await prueba("segundo mensaje → ninguna bienvenida", () => {
  const decision = decidir({
    libro: libroReal(),
    mensaje: "quería cotizar un lavacabezas",
    estado: { ...primerMensaje, esPrimerMensaje: false },
  });
  assert.deepEqual(decision.saludo, []);
  assert.deepEqual(flujosQueSalen(decision), [LAVACABEZAS]);
  assert.equal(decision.bienvenida.sale, false);
  assert.equal(decision.porque, 'Ganó "Pide lavacabezas" porque el cliente dijo "lavacabezas".');
});

await prueba("regla sin la marca y otra bienvenida distinta → salen las dos, como hoy", () => {
  const libro = libroReal();
  libro.reglas = libro.reglas.map((regla) => (regla.id === ANUNCIO_COMBO.id ? { ...regla, reemplazaLaBienvenida: undefined } : regla));
  const decision = decidir({ libro, mensaje: "me interesa el combo de estetica", estado: primerMensaje });
  assert.deepEqual(flujosQueSalen(decision), [GENERAL, COMBO]);
  assert.equal(decision.bienvenida.sale, true);
});

await prueba("libro sin bienvenida 'siempre' → el porqué no cambia", () => {
  const libro = libroReal();
  libro.reglas = libro.reglas.filter((regla) => regla.id !== BIENVENIDA_GENERAL.id);
  const decision = decidir({ libro, mensaje: "quería cotizar un lavacabezas", estado: primerMensaje });
  assert.deepEqual(flujosQueSalen(decision), [LAVACABEZAS]);
  assert.equal(decision.porque, 'Ganó "Pide lavacabezas" porque el cliente dijo "lavacabezas".');
  assert.equal(decision.bienvenida.sale, false);
});

await prueba("foto + precio no cambia: la bienvenida sale como antes", () => {
  const decision = decidir({
    libro: libroReal(),
    mensaje: "que valor tiene asi?",
    estado: primerMensaje,
    fotoDelCliente: { pie: null, descripcion: null },
  });
  assert.deepEqual(decision.saludo.map((accion) => accion.flujoId), [GENERAL]);
  assert.equal(decision.bienvenida.sale, true);
});

// --- MCP ------------------------------------------------------------------------------------------
const contexto = { workspaceId: "ws-prueba", userId: "u-prueba" };

await prueba("v3_probar_mensaje devuelve la bienvenida (sale, motivo, reemplazada_por)", async () => {
  mundo.libro = libroReal();
  const combo = await ejecutarHerramientaMcpV3(
    "v3_probar_mensaje",
    { mensaje: "Hola, me interesa el COMBO de estética (camilla, escalera, silla y auxiliar)" },
    contexto,
  );
  assert.equal(combo.bienvenida.sale, false);
  assert.deepEqual(combo.bienvenida.reemplazada_por, { id: ANUNCIO_COMBO.id, nombre: ANUNCIO_COMBO.nombre });
  assert.deepEqual(combo.haria.filter((a) => a.tipo === "flujo").map((a) => a.flujoId), [COMBO]);

  const lava = await ejecutarHerramientaMcpV3("v3_probar_mensaje", { mensaje: "quería cotizar un lavacabezas" }, contexto);
  assert.equal(lava.bienvenida.sale, true);
  assert.equal(lava.bienvenida.reemplazada_por, null);
  assert.deepEqual(lava.haria.filter((a) => a.tipo === "flujo").map((a) => a.flujoId), [GENERAL, LAVACABEZAS]);
});

await prueba("v3_editar_regla prende y apaga reemplaza_bienvenida; v3_ver_reglas la muestra", async () => {
  mundo.libro = libroReal();
  await ejecutarHerramientaMcpV3("v3_editar_regla", { regla_id: LAVACABEZAS_PRIMERO.id, reemplaza_bienvenida: true }, contexto);
  let regla = mundo.libro.reglas.find((r) => r.id === LAVACABEZAS_PRIMERO.id);
  assert.equal(regla.reemplazaLaBienvenida, true);

  // Editar otra cosa no la borra.
  await ejecutarHerramientaMcpV3("v3_editar_regla", { regla_id: LAVACABEZAS_PRIMERO.id, nombre: "Pide lavacabezas (2)" }, contexto);
  regla = mundo.libro.reglas.find((r) => r.id === LAVACABEZAS_PRIMERO.id);
  assert.equal(regla.reemplazaLaBienvenida, true);

  const vistas = await ejecutarHerramientaMcpV3("v3_ver_reglas", {}, contexto);
  assert.equal(vistas.reglas.find((r) => r.regla_id === LAVACABEZAS_PRIMERO.id).reemplaza_bienvenida, true);
  assert.equal(vistas.reglas.find((r) => r.regla_id === BIENVENIDA_GENERAL.id).reemplaza_bienvenida, false);

  await ejecutarHerramientaMcpV3("v3_editar_regla", { regla_id: LAVACABEZAS_PRIMERO.id, reemplaza_bienvenida: false }, contexto);
  regla = mundo.libro.reglas.find((r) => r.id === LAVACABEZAS_PRIMERO.id);
  assert.equal("reemplazaLaBienvenida" in regla, false);
});

await prueba("v3_crear_regla acepta reemplaza_bienvenida", async () => {
  mundo.libro = libroReal();
  const creada = await ejecutarHerramientaMcpV3(
    "v3_crear_regla",
    {
      nombre: "Llega de Marketplace",
      cuando: { tipo: "frase", frases: ["lo vi en marketplace"] },
      entonces: [{ tipo: "mensaje", texto: "¡Hola! Gracias por escribirnos desde Marketplace. ¿Qué producto viste?" }],
      reemplaza_bienvenida: true,
    },
    contexto,
  );
  const regla = mundo.libro.reglas.find((r) => r.id === creada.regla_id);
  assert.equal(regla.reemplazaLaBienvenida, true);
});

await prueba("v3_que_falta avisa: dos bienvenidas 'siempre' y una marcada que no saluda", async () => {
  mundo.libro = libroReal();
  let resultado = await ejecutarHerramientaMcpV3("v3_que_falta", {}, contexto);
  assert.equal(resultado.huecos.some((h) => /bienvenida/i.test(h.falta)), false);

  mundo.libro.reglas.push(
    { ...BIENVENIDA_GENERAL, id: "regla-otra-bienvenida", nombre: "Otra bienvenida" },
    {
      id: "regla-muda",
      nombre: "Regla muda",
      cuando: { tipo: "frase", frases: ["quiero hablar con alguien"] },
      entonces: [{ tipo: "avisar_asesor", motivo: "pide asesora" }],
      activa: true,
      reemplazaLaBienvenida: true,
    },
  );
  resultado = await ejecutarHerramientaMcpV3("v3_que_falta", {}, contexto);
  assert.ok(resultado.huecos.some((h) => /Hay 2 bienvenidas que salen siempre/.test(h.falta)));
  assert.ok(resultado.huecos.some((h) => /"Regla muda" reemplaza la bienvenida pero no le dice nada/.test(h.falta)));
});

if (fallas > 0) {
  console.error(`\n${fallas} prueba(s) fallaron.`);
  process.exit(1);
}
console.log("\nTodas las pruebas de bienvenidas del V3 pasaron.");
