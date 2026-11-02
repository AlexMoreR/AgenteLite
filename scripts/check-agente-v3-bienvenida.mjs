// Pruebas del Agente V3: varias bienvenidas y que en el primer mensaje salga UNA sola (02-11-2026).
// Correr: npm run test:agente-v3-bienvenida
//
// Carga el motor REAL (decidir, reglas) y las herramientas del MCP del V3 transpilando el TypeScript,
// y reemplaza solo lo que toca la base (almacén del libro, simulador). Sin base y sin IA.
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

// --- Reemplazos de lo que toca la base -------------------------------------------------------------
const mundo = { libro: null, guardado: null };
const reemplazos = new Map([
  [
    ruta("features/agente-v3/servicios/almacen.ts"),
    {
      leerLibro: async () => mundo.libro,
      guardarLibro: async ({ libro }) => {
        mundo.guardado = libro;
        return { version: mundo.libro.version + 1, problemas: [] };
      },
      leerHistorialDelLibro: async () => [],
      cambiosDelHistorial: () => [],
      volverAVersion: async () => ({ ok: false, error: "no se usa" }),
    },
  ],
  [ruta("features/agente-v3/servicios/simulador.ts"), { simularConversacion: async () => ({ turnos: [] }) }],
]);

const { decidir } = cargar(ruta("features/agente-v3/motor/decidir.ts"), reemplazos);
const { ejecutarHerramientaMcpV3 } = cargar(ruta("lib/mcp/agente-v3.ts"), reemplazos);

// --- Un libro chico que imita el real (versión 295) ------------------------------------------------
const GENERAL = "workflow-1793036895217-jbjl7";
const COMBO = "workflow-1788390191659-idc4r";
const LAVACABEZAS = "workflow-lavacabezas";

const bienvenidaGeneral = {
  id: "regla-ccc597f3-0a81-43fc-853c-1648bdb5a696",
  nombre: "Bienvenida General",
  cuando: { tipo: "siempre" },
  soloSi: { esPrimerMensaje: true },
  entonces: [{ tipo: "flujo", flujoId: GENERAL, titulo: "Bienvenida General" }],
  activa: true,
};
const anuncioDelCombo = {
  id: "regla-d1f2cf99",
  nombre: "Llega del anuncio del combo",
  cuando: { tipo: "frase", frases: ["combo de estetica"] },
  soloSi: { esPrimerMensaje: true },
  entonces: [
    { tipo: "flujo", flujoId: COMBO, titulo: "Bienvenida Combo Camillas" },
    { tipo: "activar_producto", productoId: "combo" },
  ],
  activa: true,
  reemplazaLaBienvenida: true,
};
const lavacabezas = {
  id: "regla-lavacabezas",
  nombre: "Primer mensaje pide lavacabezas",
  cuando: { tipo: "frase", frases: ["lavacabezas"] },
  entonces: [{ tipo: "flujo", flujoId: LAVACABEZAS, titulo: "Catálogo de lavacabezas" }],
  activa: true,
};
// Una regla vieja que ya trae la General adentro, sin la marca.
const traeLaGeneral = {
  id: "regla-silla",
  nombre: "Primer mensaje pide sillas",
  cuando: { tipo: "frase", frases: ["silla de barberia"] },
  soloSi: { esPrimerMensaje: true },
  entonces: [
    { tipo: "flujo", flujoId: GENERAL, titulo: "Bienvenida General" },
    { tipo: "flujo", flujoId: "workflow-sillas", titulo: "Catálogo de sillas" },
  ],
  activa: true,
};

const libro = {
  version: 295,
  actualizadoEl: new Date(0).toISOString(),
  comoHablamos: "Hablamos de tú.",
  reglas: [bienvenidaGeneral, anuncioDelCombo, lavacabezas, traeLaGeneral],
};
const PRIMERO = { productoActivo: null, pasoActual: null, flujosEnviados: [], esPrimerMensaje: true };
const SEGUNDO = { ...PRIMERO, esPrimerMensaje: false };
const flujos = (decision) =>
  [...decision.saludo, ...decision.acciones].filter((accion) => accion.tipo === "flujo").map((accion) => accion.flujoId);

let pasaron = 0;
async function prueba(nombre, fn) {
  try {
    await fn();
    pasaron += 1;
    console.log(`ok - ${nombre}`);
  } catch (error) {
    console.error(`FALLA - ${nombre}`);
    throw error;
  }
}

await prueba("anuncio del combo: sale solo la Bienvenida Combo y el porqué lo dice", () => {
  const decision = decidir({
    libro,
    mensaje: "Hola, me interesa el *COMBO* de estética (camilla, escalera, silla y auxiliar)",
    estado: PRIMERO,
  });
  assert.equal(decision.regla?.id, anuncioDelCombo.id);
  assert.deepEqual(decision.saludo, []);
  assert.deepEqual(flujos(decision), [COMBO]);
  assert.equal(decision.bienvenida.sale, false);
  assert.deepEqual(decision.bienvenida.reemplazadaPor, { id: anuncioDelCombo.id, nombre: anuncioDelCombo.nombre });
  assert.match(decision.porque, /No sale "Bienvenida General" porque "Llega del anuncio del combo" ya manda su propia bienvenida\./);
});

await prueba("lavacabezas: sale la General y después el catálogo", () => {
  const decision = decidir({ libro, mensaje: "quería cotizar un lavacabezas", estado: PRIMERO });
  assert.equal(decision.regla?.id, lavacabezas.id);
  assert.deepEqual(flujos(decision), [GENERAL, LAVACABEZAS]);
  assert.equal(decision.bienvenida.sale, true);
  assert.equal(decision.bienvenida.reemplazadaPor, null);
  assert.equal(decision.porque, `Ganó "Primer mensaje pide lavacabezas" porque el cliente dijo "lavacabezas".`);
});

await prueba("una regla que ya trae la General adentro: la General sale una sola vez", () => {
  const decision = decidir({ libro, mensaje: "busco una silla de barberia", estado: PRIMERO });
  assert.equal(decision.regla?.id, traeLaGeneral.id);
  assert.deepEqual(flujos(decision), [GENERAL, "workflow-sillas"]);
  assert.equal(decision.bienvenida.reemplazadaPor?.id, traeLaGeneral.id);
  assert.match(decision.porque, /No se antepone "Bienvenida General" porque "Primer mensaje pide sillas" ya la manda\./);
});

await prueba("'Hola': sale la General sola, con el mismo texto de siempre", () => {
  const decision = decidir({ libro, mensaje: "Hola", estado: PRIMERO });
  assert.equal(decision.regla, null);
  assert.deepEqual(flujos(decision), [GENERAL]);
  assert.equal(decision.porque, "Sale el saludo del primer mensaje; ninguna otra regla encajó.");
  assert.equal(decision.bienvenida.sale, true);
});

await prueba("segundo mensaje: no sale ninguna bienvenida", () => {
  const decision = decidir({ libro, mensaje: "y el lavacabezas cuánto vale", estado: SEGUNDO });
  assert.deepEqual(decision.saludo, []);
  assert.deepEqual(flujos(decision), [LAVACABEZAS]);
  assert.equal(decision.bienvenida.sale, false);
  assert.equal(decision.bienvenida.motivo, "No es el primer mensaje del cliente.");
});

await prueba("una regla sin la marca se comporta igual que antes", () => {
  const sinMarca = { ...anuncioDelCombo, reemplazaLaBienvenida: undefined };
  const decision = decidir({
    libro: { ...libro, reglas: [bienvenidaGeneral, sinMarca] },
    mensaje: "me interesa el combo de estetica",
    estado: PRIMERO,
  });
  assert.deepEqual(flujos(decision), [GENERAL, COMBO]);
  assert.equal(decision.porque, `Ganó "Llega del anuncio del combo" porque el cliente dijo "combo de estetica".`);
});

await prueba("la marca en la regla del paso que se encadena también frena la General", () => {
  const activa = {
    id: "regla-activa",
    nombre: "Pide el combo",
    cuando: { tipo: "frase", frases: ["quiero el combo"] },
    entonces: [{ tipo: "activar_producto", productoId: "combo" }],
    activa: true,
  };
  const paso = {
    id: "regla-paso",
    nombre: "Presentación del combo",
    cuando: { tipo: "paso", producto: "combo", paso: "PRESENTACION" },
    entonces: [{ tipo: "flujo", flujoId: COMBO }],
    activa: true,
    reemplazaLaBienvenida: true,
  };
  const decision = decidir({
    libro: { ...libro, reglas: [bienvenidaGeneral, activa, paso] },
    mensaje: "quiero el combo",
    estado: PRIMERO,
  });
  assert.deepEqual(flujos(decision), [COMBO]);
  assert.equal(decision.bienvenida.reemplazadaPor?.id, paso.id);
});

await prueba("sin bienvenida en el libro no cambia nada (libro de hoy, General como intención)", () => {
  const general = { ...bienvenidaGeneral, cuando: { tipo: "intencion", descripcion: "es el primer mensaje del cliente" } };
  const decision = decidir({
    libro: { ...libro, reglas: [general, anuncioDelCombo, lavacabezas] },
    mensaje: "quería cotizar un lavacabezas",
    estado: PRIMERO,
  });
  assert.deepEqual(flujos(decision), [LAVACABEZAS]);
  assert.equal(decision.bienvenida.sale, false);
  assert.equal(decision.porque, `Ganó "Primer mensaje pide lavacabezas" porque el cliente dijo "lavacabezas".`);
});

await prueba("MCP v3_probar_mensaje devuelve la bienvenida", async () => {
  mundo.libro = libro;
  const combo = await ejecutarHerramientaMcpV3(
    "v3_probar_mensaje",
    { mensaje: "Hola, me interesa el COMBO de estética (camilla, escalera, silla y auxiliar)" },
    { workspaceId: "w", userId: "u" },
  );
  assert.equal(combo.bienvenida.sale, false);
  assert.deepEqual(combo.bienvenida.reemplazada_por, { id: anuncioDelCombo.id, nombre: anuncioDelCombo.nombre });
  assert.deepEqual(combo.haria.map((accion) => accion.flujoId).filter(Boolean), [COMBO]);

  const lava = await ejecutarHerramientaMcpV3("v3_probar_mensaje", { mensaje: "quería cotizar un lavacabezas" }, { workspaceId: "w", userId: "u" });
  assert.equal(lava.bienvenida.sale, true);
  assert.deepEqual(lava.haria.map((accion) => accion.flujoId), [GENERAL, LAVACABEZAS]);
});

await prueba("MCP crear/editar/ver guardan y muestran reemplaza_bienvenida", async () => {
  mundo.libro = libro;
  const contexto = { workspaceId: "w", userId: "u" };
  await ejecutarHerramientaMcpV3(
    "v3_crear_regla",
    { nombre: "Llega de Marketplace", cuando: { tipo: "frase", frases: ["marketplace"] }, entonces: [{ tipo: "mensaje", texto: "Hola" }], reemplaza_bienvenida: true },
    contexto,
  );
  assert.equal(mundo.guardado.reglas.at(-1).reemplazaLaBienvenida, true);

  await ejecutarHerramientaMcpV3("v3_editar_regla", { regla_id: lavacabezas.id, nombre: "Lavacabezas" }, contexto);
  assert.equal("reemplazaLaBienvenida" in mundo.guardado.reglas.find((regla) => regla.id === lavacabezas.id), false);

  await ejecutarHerramientaMcpV3("v3_editar_regla", { regla_id: anuncioDelCombo.id, nombre: "Anuncio" }, contexto);
  assert.equal(mundo.guardado.reglas.find((regla) => regla.id === anuncioDelCombo.id).reemplazaLaBienvenida, true);

  await ejecutarHerramientaMcpV3("v3_editar_regla", { regla_id: anuncioDelCombo.id, reemplaza_bienvenida: false }, contexto);
  assert.equal("reemplazaLaBienvenida" in mundo.guardado.reglas.find((regla) => regla.id === anuncioDelCombo.id), false);

  const vistas = await ejecutarHerramientaMcpV3("v3_ver_reglas", {}, contexto);
  assert.equal(vistas.reglas.find((regla) => regla.regla_id === anuncioDelCombo.id).reemplaza_bienvenida, true);
  assert.equal(vistas.reglas.find((regla) => regla.regla_id === lavacabezas.id).reemplaza_bienvenida, false);
});

await prueba("MCP v3_que_falta avisa: dos bienvenidas generales y una marca que no saluda", async () => {
  const contexto = { workspaceId: "w", userId: "u" };
  mundo.libro = libro;
  const bien = await ejecutarHerramientaMcpV3("v3_que_falta", {}, contexto);
  assert.equal(bien.huecos.some((hueco) => /bienvenida/i.test(hueco.falta)), false);

  const muda = { ...lavacabezas, id: "regla-muda", nombre: "Llega por la línea 2", entonces: [{ tipo: "activar_producto", productoId: "x" }], reemplazaLaBienvenida: true };
  mundo.libro = { ...libro, reglas: [...libro.reglas, { ...bienvenidaGeneral, id: "otra", nombre: "Otra bienvenida" }, muda] };
  const mal = await ejecutarHerramientaMcpV3("v3_que_falta", {}, contexto);
  assert.ok(mal.huecos.some((hueco) => /Hay 2 bienvenidas generales prendidas/.test(hueco.falta)));
  assert.ok(mal.huecos.some((hueco) => /"Llega por la línea 2" reemplaza la bienvenida pero no le dice nada al cliente/.test(hueco.falta)));
});

console.log(`\n${pasaron} pruebas de la bienvenida del V3 pasaron.`);
