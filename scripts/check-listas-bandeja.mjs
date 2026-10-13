// Pruebas de las listas guardadas de la bandeja (13-10-2026): una lista sin filtro ("Maria" con
// query vacia) se quedaba como abierta en "Todas" y tocar "Todas" no la soltaba.
// Correr: npm run test:listas-bandeja
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import ts from "typescript";

const archivo = path.resolve("src/features/chats/domain/filtros-de-bandeja.ts");
const js = ts.transpileModule(fs.readFileSync(archivo, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const m = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const mariaVacia = { id: "fmv6v67cr", nombre: "Maria", query: "" };
const mariaBien = { id: "a", nombre: "Maria", query: "assigned=user%3Acmtuns8l302782nlp3cvrgdgt" };
const calientes = { id: "b", nombre: "Calientes", query: "stage=PROPUESTA,NEGOCIACION" };

prueba("la firma ignora conexion, busqueda y chat abierto, y ordena", () => {
  assert.equal(m.firmaDeLaVista("connection=x&q=hola&chatKey=z"), "");
  assert.equal(m.firmaDeLaVista("stage=NEGOCIACION,PROPUESTA"), m.firmaDeLaVista("stage=PROPUESTA,NEGOCIACION"));
});

prueba("una lista sin filtro se reconoce", () => {
  assert.equal(m.esListaSinFiltro(""), true);
  assert.equal(m.esListaSinFiltro("connection=abc&q=x"), true);
  assert.equal(m.esListaSinFiltro(mariaBien.query), false);
  assert.equal(m.esListaSinFiltro("status=resolved"), false);
});

prueba("en Todas (firma vacia) una lista vacia NO queda abierta", () => {
  assert.equal(m.listaQueSeEstaMirando([mariaVacia, calientes], ""), null);
});

prueba("una lista con filtro sigue quedando abierta cuando coincide", () => {
  const firma = m.firmaDeLaVista("assigned=user:cmtuns8l302782nlp3cvrgdgt");
  assert.equal(m.listaQueSeEstaMirando([mariaVacia, mariaBien], firma)?.id, "a");
  assert.equal(m.listaQueSeEstaMirando([calientes], m.firmaDeLaVista("stage=NEGOCIACION,PROPUESTA"))?.id, "b");
});

/*
  El flujo de la barra tal cual lo arma AppSidebar: vistaPedida se pone al tocar una lista y se
  suelta al tocar Todas/Mias (aplicarFiltros). Antes del arreglo: no se soltaba y la lista vacia
  coincidia con Todas -> "Maria" pegada.
*/
function barra(listas) {
  let vistaActual = ""; // lo que dice el servidor: Todas
  let vistaPedida = null;
  const listaActiva = () => {
    const firmaMostrada = vistaPedida && vistaPedida.desde === vistaActual ? vistaPedida.firma : vistaActual;
    return m.listaQueSeEstaMirando(listas, firmaMostrada);
  };
  return {
    tocarLista(lista) {
      vistaPedida = { firma: m.firmaDeLaVista(lista.query), desde: vistaActual };
      vistaActual = m.firmaDeLaVista(lista.query); // el servidor responde con esa vista
    },
    tocarTodas() {
      vistaPedida = null;
      vistaActual = "";
    },
    listaActiva,
  };
}

prueba("con la Maria vacia guardada, Todas queda activa y se puede tocar", () => {
  const b = barra([mariaVacia]);
  assert.equal(b.listaActiva(), null);
  b.tocarLista(mariaVacia);
  assert.equal(b.listaActiva(), null);
  b.tocarTodas();
  assert.equal(b.listaActiva(), null);
});

prueba("con una lista de verdad: tocarla la abre y Todas la suelta", () => {
  const b = barra([mariaBien]);
  b.tocarLista(mariaBien);
  assert.equal(b.listaActiva()?.id, "a");
  b.tocarTodas();
  assert.equal(b.listaActiva(), null);
});

console.log(`\n${pruebas} pruebas ok`);
