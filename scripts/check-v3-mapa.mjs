// Pruebas del Mapa del libro de reglas del Agente V3 (solo lectura).
// Correr: npm run test:v3-mapa
//
// Carga el dominio REAL (domain/mapa.ts y domain/reglas.ts) transpilando el TypeScript.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const nodeRequire = createRequire(import.meta.url);
const SRC = path.resolve("src");

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
function cargar(archivo) {
  if (cache.has(archivo)) return cache.get(archivo).exports;
  const salida = ts.transpileModule(fs.readFileSync(archivo, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: archivo,
  });
  const mod = { exports: {} };
  cache.set(archivo, mod);
  const req = (especificador) => {
    const resuelto = resolver(archivo, especificador);
    return resuelto ? cargar(resuelto) : nodeRequire(especificador);
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

const mapa = cargar(path.join(SRC, "features/agente-v3/domain/mapa.ts"));
const { construirMapa, conectadosA, resaltarBusqueda, resumenDelDisparador, columnasDelCarril, MEDIDAS } = mapa;

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

// --- Fixture: una regla de cada tipo de disparador ------------------------------------------------
const COMBO = "prod-combo";
const SILLA = "prod-silla";
const regla = (id, cuando, entonces, extra = {}) => ({ id, nombre: `Regla ${id}`, cuando, entonces, activa: true, ...extra });

const LIBRO = {
  version: 7,
  actualizadoEl: "2026-10-13T00:00:00.000Z",
  comoHablamos: "",
  reglas: [
    regla(
      "bienvenida",
      { tipo: "siempre" },
      [{ tipo: "flujo", flujoId: "f-bienvenida", titulo: "Bienvenida (viejo)" }, { tipo: "ir_al_paso", paso: "IDENTIFICACION" }],
      { soloSi: { esPrimerMensaje: true } },
    ),
    regla(
      "precio",
      { tipo: "frase", frases: ["precio", "cuánto vale", "valor", "cuesta"] },
      [
        { tipo: "activar_producto", productoId: COMBO, nombre: "Combo (acción)" },
        { tipo: "mensaje", texto: "El combo vale 2.990.000. ¿En qué ciudad estás?" },
        { tipo: "ir_al_paso", paso: "CIERRE" },
      ],
    ),
    regla(
      "dudas",
      { tipo: "intencion", descripcion: "La clienta duda de la calidad o pide garantía del producto" },
      [{ tipo: "responder_con_ia", guia: "Contar la garantía" }, { tipo: "avisar_asesor", motivo: "duda de calidad" }],
      { soloSi: { productoActivo: COMBO, pasoActual: "OBJECIONES" } },
    ),
    regla("paso1", { tipo: "paso", producto: COMBO, paso: "PRESENTACION" }, [{ tipo: "mensaje", texto: "¿Qué servicios vas a ofrecer?" }]),
    regla(
      "callada",
      { tipo: "sin_respuesta", minutos: 60 },
      [{ tipo: "mensaje", texto: "¿Te ayudo con algo más?" }, { tipo: "pausar_ia" }, { tipo: "avisar_asesor", motivo: "no contesta" }],
    ),
    regla(
      "silla-apagada",
      { tipo: "frase", frases: ["silla barbera"] },
      [{ tipo: "activar_producto", productoId: SILLA }, { tipo: "flujo", flujoId: "f-sillas" }],
      { activa: false },
    ),
  ],
};
const OPCIONES = {
  nombresDeProductos: { [COMBO]: "Combo Camillas", [SILLA]: "Silla barbera" },
  titulosDeFlujos: { "f-bienvenida": "Bienvenida" },
};

const porId = (m, id) => m.nodos.find((n) => n.id === id);
const tieneArista = (m, desde, hasta) => m.aristas.some((a) => a.desde === desde && a.hasta === hasta);

prueba("resumen de cada tipo de disparador", () => {
  const [bienvenida, precio, dudas, paso1, callada] = LIBRO.reglas;
  assert.equal(resumenDelDisparador(precio), "frase: precio, cuánto vale +2");
  assert.match(resumenDelDisparador(dudas), /^intención: La clienta duda/);
  assert.equal(resumenDelDisparador(paso1, OPCIONES.nombresDeProductos), "paso: Presentación · Combo Camillas");
  assert.equal(resumenDelDisparador(callada), "sin respuesta: 60 min");
  assert.equal(resumenDelDisparador(bienvenida), "siempre");
});

prueba("cada regla cae en el carril de su paso, o en 'cualquier momento'", () => {
  const m = construirMapa(LIBRO, OPCIONES);
  assert.equal(porId(m, "regla:dudas").datos.carril, "OBJECIONES");
  assert.equal(porId(m, "regla:paso1").datos.carril, "PRESENTACION");
  assert.equal(porId(m, "regla:precio").datos.carril, "CUALQUIERA");
  assert.equal(porId(m, "regla:callada").datos.carril, "CUALQUIERA");
  // Los cinco pasos existen siempre como nodos, aunque estén vacíos.
  for (const paso of ["PRESENTACION", "IDENTIFICACION", "PRODUCTO", "OBJECIONES", "CIERRE"]) {
    assert.ok(porId(m, `paso:${paso}`), `falta el paso ${paso}`);
  }
});

prueba("inactivas ocultas por defecto y visibles con el interruptor", () => {
  const m = construirMapa(LIBRO, OPCIONES);
  assert.equal(porId(m, "regla:silla-apagada"), undefined);
  assert.equal(porId(m, "flujo:f-sillas"), undefined, "un flujo que solo usa una regla apagada no se dibuja");
  assert.deepEqual(m.totales, { reglas: 6, visibles: 5, inactivas: 1 });
  const todas = construirMapa(LIBRO, { ...OPCIONES, verInactivas: true });
  assert.equal(porId(todas, "regla:silla-apagada").datos.activa, false);
  assert.equal(porId(todas, "flujo:f-sillas").datos.nombre, "Flujo sin nombre");
});

prueba("flechas a paso, producto, flujo, asesora, pausa y desde el primer mensaje", () => {
  const m = construirMapa(LIBRO, OPCIONES);
  assert.ok(tieneArista(m, "regla:bienvenida", "paso:IDENTIFICACION"));
  assert.ok(tieneArista(m, "regla:precio", "paso:CIERRE"));
  assert.ok(tieneArista(m, "regla:precio", `producto:${COMBO}`));
  assert.ok(tieneArista(m, "regla:bienvenida", "flujo:f-bienvenida"));
  assert.ok(tieneArista(m, "regla:dudas", "fin:asesora"));
  assert.ok(tieneArista(m, "regla:callada", "fin:asesora"));
  assert.ok(tieneArista(m, "regla:callada", "fin:pausa"));
  assert.ok(tieneArista(m, "entrada", "regla:bienvenida"));
  // Nombre de la base gana al de la acción; título del flujo de la base gana al guardado.
  assert.equal(porId(m, `producto:${COMBO}`).datos.nombre, "Combo Camillas");
  assert.equal(porId(m, "flujo:f-bienvenida").datos.nombre, "Bienvenida");
  assert.equal(porId(m, "fin:asesora").datos.reglas, 2);
  // Todas las flechas apuntan a nodos que existen.
  const ids = new Set(m.nodos.map((n) => n.id));
  for (const a of m.aristas) assert.ok(ids.has(a.desde) && ids.has(a.hasta), `flecha suelta ${a.id}`);
});

prueba("chips de producto exigido y prioridad igual a la de la lista", () => {
  const m = construirMapa(LIBRO, OPCIONES);
  assert.deepEqual(porId(m, "regla:dudas").datos.chips.map((c) => c.texto), ["Combo Camillas"]);
  assert.ok(porId(m, "regla:bienvenida").datos.chips.some((c) => c.texto === "1er mensaje"));
  // frase(20) < paso(30) < sin_respuesta(40) < intención con producto(50) < siempre(90); la apagada
  // también cuenta (frase, puesto 2), igual que en la lista.
  assert.equal(porId(m, "regla:precio").datos.prioridad, 1);
  assert.equal(porId(m, "regla:bienvenida").datos.prioridad, 6);
});

prueba("filtro por producto deja solo las reglas que lo tocan", () => {
  const m = construirMapa(LIBRO, { ...OPCIONES, producto: COMBO });
  const reglas = m.nodos.filter((n) => n.datos.tipo === "regla").map((n) => n.id).sort();
  assert.deepEqual(reglas, ["regla:dudas", "regla:paso1", "regla:precio"]);
  assert.deepEqual(m.productos.map((p) => p.texto), ["Combo Camillas"]);
});

prueba("tocar un nodo ilumina lo conectado; la búsqueda ilumina coincidencias y sus flechas", () => {
  const m = construirMapa(LIBRO, OPCIONES);
  const asesora = conectadosA(m, "fin:asesora");
  assert.ok(asesora.nodos.has("regla:dudas") && asesora.nodos.has("regla:callada"));
  assert.ok(!asesora.nodos.has("regla:precio"));
  const busqueda = resaltarBusqueda(LIBRO, m, "cuanto VALE");
  assert.ok(busqueda.nodos.has("regla:precio") && busqueda.nodos.has(`producto:${COMBO}`));
  assert.ok(!busqueda.nodos.has("regla:callada"));
  assert.equal(resaltarBusqueda(LIBRO, m, "   "), null);
});

prueba("110 reglas: sin cajas encimadas y el mapa es determinista", () => {
  const muchas = {
    ...LIBRO,
    reglas: Array.from({ length: 110 }, (_, i) =>
      regla(
        `r${i}`,
        i % 5 === 0 ? { tipo: "paso", producto: COMBO, paso: "PRODUCTO" } : { tipo: "frase", frases: [`frase numero ${i}`] },
        [{ tipo: "mensaje", texto: "hola ¿en qué ciudad estás?" }, { tipo: "flujo", flujoId: `f${i % 7}` }],
        i % 3 === 0 ? { soloSi: { pasoActual: ["PRESENTACION", "IDENTIFICACION", "CIERRE"][i % 3 === 0 ? (i / 3) % 3 : 0] } } : {},
      ),
    ),
  };
  const m = construirMapa(muchas, OPCIONES);
  const cajas = m.nodos.filter((n) => n.datos.tipo !== "carril");
  assert.equal(cajas.filter((n) => n.datos.tipo === "regla").length, 110);
  for (let i = 0; i < cajas.length; i++) {
    for (let j = i + 1; j < cajas.length; j++) {
      const a = cajas[i];
      const b = cajas[j];
      const encimadas = a.x < b.x + b.ancho && b.x < a.x + a.ancho && a.y < b.y + b.alto && b.y < a.y + a.alto;
      assert.ok(!encimadas, `${a.id} se encima con ${b.id}`);
    }
  }
  assert.deepEqual(construirMapa(muchas, OPCIONES), m);
  assert.equal(columnasDelCarril(4), 1);
  assert.ok(columnasDelCarril(60) >= 3);
  assert.ok(MEDIDAS.reglaAncho > 0);
});

console.log(`\n${pruebas} pruebas ok`);
