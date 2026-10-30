// Pruebas del Agente V3: varias bienvenidas y que al cliente nuevo le salga UNA sola (caso del combo,
// 30-10-2026). Correr: npm run test:agente-v3-bienvenida
//
// Carga el motor REAL (decidir, reglas) y las herramientas del MCP transpilando el TypeScript, y
// reemplaza solo lo que toca la base (almacén, simulador). Sin base y sin IA.
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

// --- Reemplazos de lo que toca la base ------------------------------------------------------------
const mundo = { libro: null, guardado: null };
const reemplazos = new Map([
  [
    ruta("features/agente-v3/servicios/almacen.ts"),
    {
      leerLibro: async () => mundo.libro,
      guardarLibro: async ({ libro }) => {
        mundo.guardado = libro;
        return { version: libro.version + 1, problemas: [] };
      },
      leerHistorialDelLibro: async () => [],
      cambiosDelHistorial: () => [],
      volverAVersion: async () => ({ ok: false, error: "no en la prueba" }),
    },
  ],
  [ruta("features/agente-v3/servicios/simulador.ts"), { simularConversacion: async () => ({ turnos: [] }) }],
]);

const { decidir, siguienteEstado } = cargar(ruta("features/agente-v3/motor/decidir.ts"), reemplazos);
const { ejecutarHerramientaMcpV3 } = cargar(ruta("lib/mcp/agente-v3.ts"), reemplazos);

// --- El libro real, reducido (versión 295) --------------------------------------------------------
const GENERAL = { tipo: "flujo", flujoId: "workflow-1793036895217-jbjl7", titulo: "Bienvenida General" };
const DEL_COMBO = { tipo: "flujo", flujoId: "workflow-1788390191659-idc4r", titulo: "Bienvenida Combo Camillas" };
const LAVACABEZAS = { tipo: "flujo", flujoId: "workflow-lavacabezas", titulo: "Catálogo de lavacabezas" };

const reglaBienvenida = {
  id: "regla-ccc597f3-0a81-43fc-853c-1648bdb5a696",
  nombre: "Bienvenida General",
  cuando: { tipo: "siempre" },
  soloSi: { esPrimerMensaje: true },
  entonces: [GENERAL],
  activa: true,
};
const reglaCombo = {
  id: "regla-d1f2cf99",
  nombre: "Llega del anuncio del combo",
  cuando: { tipo: "frase", frases: ["combo de estetica"] },
  soloSi: { esPrimerMensaje: true },
  entonces: [DEL_COMBO, { tipo: "activar_producto", productoId: "combo" }],
  activa: true,
  reemplazaLaBienvenida: true,
};
const reglaLavacabezas = {
  id: "regla-lavacabezas",
  nombre: "Pide lavacabezas",
  cuando: { tipo: "frase", frases: ["lavacabezas"] },
  entonces: [LAVACABEZAS],
  activa: true,
};
const reglaLavacabezasConGeneral = {
  id: "regla-lavacabezas-primer-mensaje",
  nombre: "Primer mensaje pide lavacabezas",
  cuando: { tipo: "frase", frases: ["lavacabezas"] },
  soloSi: { esPrimerMensaje: true },
  entonces: [GENERAL, LAVACABEZAS],
  activa: true,
};
const libroCon = (...reglas) => ({ version: 295, actualizadoEl: "2026-10-30T00:00:00.000Z", comoHablamos: "", reglas });
const LIBRO = libroCon(reglaBienvenida, reglaCombo, reglaLavacabezas);

const primerMensaje = () => ({ productoActivo: null, pasoActual: null, flujosEnviados: [], esPrimerMensaje: true });
const loQueSale = (decision) => [...decision.saludo, ...decision.acciones];
const flujos = (decision) => loQueSale(decision).filter((a) => a.tipo === "flujo").map((a) => a.titulo);

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

// --- Los dos mensajes de la tarjeta ---------------------------------------------------------------
await prueba("anuncio del combo: sale SOLO la Bienvenida Combo, y el porqué lo dice", async () => {
  const d = decidir({
    libro: LIBRO,
    mensaje: "Hola, me interesa el *COMBO* de estética (camilla, escalera, silla y auxiliar)",
    estado: primerMensaje(),
  });
  assert.equal(d.regla?.id, reglaCombo.id);
  assert.deepEqual(flujos(d), ["Bienvenida Combo Camillas"]);
  assert.deepEqual(d.saludo, []);
  assert.equal(d.bienvenida.sale, false);
  assert.deepEqual(d.bienvenida.reemplazadaPor, { id: reglaCombo.id, nombre: reglaCombo.nombre });
  assert.match(d.porque, /No sale la bienvenida "Bienvenida General" porque "Llega del anuncio del combo" ya manda su propia bienvenida/);
});

await prueba("cotizar un lavacabezas: sale la General y después el catálogo de lavacabezas", async () => {
  const d = decidir({ libro: LIBRO, mensaje: "quería cotizar un lavacabezas", estado: primerMensaje() });
  assert.equal(d.regla?.id, reglaLavacabezas.id);
  assert.deepEqual(flujos(d), ["Bienvenida General", "Catálogo de lavacabezas"]);
  assert.equal(d.bienvenida.sale, true);
  assert.equal(d.bienvenida.reemplazadaPor, null);
  assert.equal(d.porque, `Ganó "Pide lavacabezas" porque el cliente dijo "lavacabezas".`);
});

// --- Casos de borde -------------------------------------------------------------------------------
await prueba("una regla que ya trae la General adentro: la General sale una sola vez, sin marcarla", async () => {
  const d = decidir({
    libro: libroCon(reglaBienvenida, reglaLavacabezasConGeneral),
    mensaje: "quería cotizar un lavacabezas",
    estado: primerMensaje(),
  });
  assert.equal(d.regla?.id, reglaLavacabezasConGeneral.id);
  assert.deepEqual(flujos(d), ["Bienvenida General", "Catálogo de lavacabezas"]);
  assert.equal(d.bienvenida.sale, false);
  assert.equal(d.bienvenida.reemplazadaPor?.id, reglaLavacabezasConGeneral.id);
  assert.match(d.porque, /ya la manda: sale una sola vez/);
});

await prueba("'Hola': sale la General sola, con el mismo texto de hoy (check-turno lo lee)", async () => {
  const d = decidir({ libro: LIBRO, mensaje: "Hola", estado: primerMensaje() });
  assert.equal(d.regla, null);
  assert.deepEqual(flujos(d), ["Bienvenida General"]);
  assert.equal(d.bienvenida.sale, true);
  assert.equal(d.porque, "Sale el saludo del primer mensaje; ninguna otra regla encajó.");
});

await prueba("segundo mensaje: no sale ninguna bienvenida", async () => {
  const despues = siguienteEstado(primerMensaje(), [GENERAL]);
  const d = decidir({ libro: LIBRO, mensaje: "quería cotizar un lavacabezas", estado: despues });
  assert.deepEqual(flujos(d), ["Catálogo de lavacabezas"]);
  assert.equal(d.bienvenida.sale, false);
  assert.equal(d.bienvenida.motivo, "No es el primer mensaje del cliente.");
  assert.equal(d.porque, `Ganó "Pide lavacabezas" porque el cliente dijo "lavacabezas".`);
});

await prueba("sin la marca, la regla del combo se comporta como hoy: General y después la del combo", async () => {
  const sinMarca = { ...reglaCombo, reemplazaLaBienvenida: undefined };
  const d = decidir({
    libro: libroCon(reglaBienvenida, sinMarca),
    mensaje: "me interesa el combo de estetica",
    estado: primerMensaje(),
  });
  assert.deepEqual(flujos(d), ["Bienvenida General", "Bienvenida Combo Camillas"]);
  assert.equal(d.bienvenida.sale, true);
});

await prueba("la marca en la regla del paso que se encadena también reemplaza la bienvenida", async () => {
  const activa = {
    id: "regla-activa",
    nombre: "Quiere camillas",
    cuando: { tipo: "frase", frases: ["camilla"] },
    entonces: [{ tipo: "activar_producto", productoId: "camillas" }],
    activa: true,
  };
  const delPaso = {
    id: "regla-paso",
    nombre: "Presentación de camillas",
    cuando: { tipo: "paso", producto: "camillas", paso: "PRESENTACION" },
    entonces: [{ tipo: "mensaje", texto: "¡Hola! Te cuento de las camillas. ¿Para qué servicio la buscas?" }],
    activa: true,
    reemplazaLaBienvenida: true,
  };
  const d = decidir({ libro: libroCon(reglaBienvenida, activa, delPaso), mensaje: "una camilla", estado: primerMensaje() });
  assert.deepEqual(d.saludo, []);
  assert.equal(d.bienvenida.reemplazadaPor?.id, delPaso.id);
});

await prueba("sin bienvenida en el libro: nada cambia y el motivo lo dice", async () => {
  const d = decidir({ libro: libroCon(reglaCombo, reglaLavacabezas), mensaje: "quería cotizar un lavacabezas", estado: primerMensaje() });
  assert.deepEqual(flujos(d), ["Catálogo de lavacabezas"]);
  assert.equal(d.bienvenida.sale, false);
  assert.equal(d.porque, `Ganó "Pide lavacabezas" porque el cliente dijo "lavacabezas".`);
});

await prueba("foto + precio no cambia: la bienvenida sale como antes", async () => {
  const d = decidir({
    libro: LIBRO,
    mensaje: "que valor tiene asi",
    estado: primerMensaje(),
    fotoDelCliente: { pie: null, descripcion: null },
  });
  assert.deepEqual(flujos(d), ["Bienvenida General"]);
  assert.equal(d.bienvenida.sale, true);
});

// --- El MCP ---------------------------------------------------------------------------------------
const contexto = { workspaceId: "ws", userId: "u" };

await prueba("v3_probar_mensaje devuelve la bienvenida (sale, motivo, reemplazada_por)", async () => {
  mundo.libro = LIBRO;
  const combo = await ejecutarHerramientaMcpV3(
    "v3_probar_mensaje",
    { mensaje: "Hola, me interesa el COMBO de estética (camilla, escalera, silla y auxiliar)" },
    contexto,
  );
  assert.equal(combo.gana.regla_id, reglaCombo.id);
  assert.deepEqual(combo.haria.filter((a) => a.tipo === "flujo").map((a) => a.titulo), ["Bienvenida Combo Camillas"]);
  assert.equal(combo.bienvenida.sale, false);
  assert.equal(combo.bienvenida.reemplazada_por.id, reglaCombo.id);

  const lavacabezas = await ejecutarHerramientaMcpV3("v3_probar_mensaje", { mensaje: "quería cotizar un lavacabezas" }, contexto);
  assert.deepEqual(
    lavacabezas.haria.filter((a) => a.tipo === "flujo").map((a) => a.titulo),
    ["Bienvenida General", "Catálogo de lavacabezas"],
  );
  assert.equal(lavacabezas.bienvenida.sale, true);
  assert.equal(lavacabezas.bienvenida.reemplazada_por, null);
});

await prueba("v3_ver_reglas muestra la marca de cada regla", async () => {
  mundo.libro = LIBRO;
  const r = await ejecutarHerramientaMcpV3("v3_ver_reglas", {}, contexto);
  const marca = Object.fromEntries(r.reglas.map((regla) => [regla.regla_id, regla.reemplaza_bienvenida]));
  assert.equal(marca[reglaCombo.id], true);
  assert.equal(marca[reglaLavacabezas.id], false);
});

await prueba("v3_crear_regla y v3_editar_regla guardan reemplaza_bienvenida (y quitarla la borra)", async () => {
  mundo.libro = LIBRO;
  await ejecutarHerramientaMcpV3(
    "v3_crear_regla",
    { nombre: "Llega por Marketplace", cuando: { tipo: "frase", frases: ["marketplace"] }, entonces: [DEL_COMBO], reemplaza_bienvenida: true },
    contexto,
  );
  assert.equal(mundo.guardado.reglas.at(-1).reemplazaLaBienvenida, true);

  await ejecutarHerramientaMcpV3("v3_editar_regla", { regla_id: reglaLavacabezas.id, reemplaza_bienvenida: true }, contexto);
  assert.equal(mundo.guardado.reglas.find((r) => r.id === reglaLavacabezas.id).reemplazaLaBienvenida, true);

  // Editar otra cosa no le quita la marca.
  await ejecutarHerramientaMcpV3("v3_editar_regla", { regla_id: reglaCombo.id, nombre: "Anuncio del combo" }, contexto);
  assert.equal(mundo.guardado.reglas.find((r) => r.id === reglaCombo.id).reemplazaLaBienvenida, true);

  await ejecutarHerramientaMcpV3("v3_editar_regla", { regla_id: reglaCombo.id, reemplaza_bienvenida: false }, contexto);
  assert.equal(mundo.guardado.reglas.find((r) => r.id === reglaCombo.id).reemplazaLaBienvenida, undefined);
});

await prueba("v3_que_falta avisa: dos bienvenidas generales, o una regla marcada que no le dice nada", async () => {
  mundo.libro = LIBRO;
  const bien = await ejecutarHerramientaMcpV3("v3_que_falta", {}, contexto);
  assert.ok(!bien.huecos.some((h) => /bienvenida/i.test(h.falta)), JSON.stringify(bien.huecos));

  const otraGeneral = { ...reglaBienvenida, id: "regla-otra-general", nombre: "Bienvenida vieja" };
  const muda = { ...reglaLavacabezas, id: "regla-muda", nombre: "Solo cambia la etapa", entonces: [{ tipo: "cambiar_etapa_crm", etapa: "NUEVO" }], reemplazaLaBienvenida: true };
  mundo.libro = libroCon(reglaBienvenida, otraGeneral, muda);
  const mal = await ejecutarHerramientaMcpV3("v3_que_falta", {}, contexto);
  assert.ok(mal.huecos.some((h) => /Hay 2 bienvenidas generales activas/.test(h.falta)), JSON.stringify(mal.huecos));
  assert.ok(mal.huecos.some((h) => /"Solo cambia la etapa" reemplaza la bienvenida pero no le dice nada/.test(h.falta)));
});

console.log(`\n${pruebas} pruebas OK`);
