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


/* ---------- Condiciones (como Automatizaciones, 16-10-2026) ---------- */

const leer = (query) => {
  const p = new URLSearchParams(query);
  return m.leerFiltrosDeBandeja((clave) => p.get(clave));
};
const ida = (condiciones) => new URLSearchParams(m.paramsDeFiltros({ condiciones })).toString();
const AHORA = new Date("2026-10-16T15:00:00.000Z"); // 10:00 de Bogota

prueba("compat: las listas viejas (stage, tag, pending) se leen como condiciones", () => {
  assert.deepEqual(leer("stage=PROPUESTA,NEGOCIACION&tag=combo&pending=1").condiciones, [
    { campo: "etapa", operador: "es", valores: ["PROPUESTA", "NEGOCIACION"] },
    { campo: "etiquetas", operador: "tiene", valores: ["combo"] },
    { campo: "sin_responder", operador: "si" },
  ]);
  // Lo de siempre que no filtra sigue sin filtrar.
  assert.deepEqual(leer("assigned=mine&status=resolved").condiciones, []);
  // Y al volver a guardarse sale en el formato nuevo.
  assert.equal(ida(leer(calientes.query).condiciones), "c=" + encodeURIComponent("etapa:es:NEGOCIACION,PROPUESTA"));
});

prueba("ida y vuelta de cada campo", () => {
  const todas = [
    { campo: "etapa", operador: "no_es", valores: ["GANADO", "PERDIDO"] },
    { campo: "etiquetas", operador: "no_tiene", valores: ["equipo", "prov"] },
    { campo: "asesora", operador: "es", valores: ["sin_asignar", "u1"] },
    { campo: "canal", operador: "no_es", valores: ["ch2"] },
    { campo: "fecha", operador: "entre", sobre: "llego", desde: "2026-10-01", hasta: "2026-10-15" },
    { campo: "fecha", operador: "ultimos", sobre: "ultimo", dias: 7 },
    { campo: "fecha", operador: "mes", sobre: "ultimo" },
    { campo: "sin_responder", operador: "no" },
    { campo: "dias_sin_responder", operador: "al_menos", dias: 3 },
  ];
  assert.deepEqual(leer(ida(todas)).condiciones, todas);
});

prueba("lo invalido no entra: ids raros, etapas que no existen, fechas imposibles, operadores", () => {
  const c = (texto) => leer(`c=${encodeURIComponent(texto)}`).condiciones;
  assert.deepEqual(c("etiquetas:tiene:x'or,ok"), [{ campo: "etiquetas", operador: "tiene", valores: ["ok"] }]);
  assert.deepEqual(c("etapa:es:FALSA"), []);
  assert.deepEqual(c("etapa:igual:NUEVO"), []);
  assert.deepEqual(c("fecha:entre:ultimo,2026-02-30,"), []);
  assert.deepEqual(c("fecha:ultimos:ultimo,0"), []);
  assert.deepEqual(c("dias_sin_responder:al_menos:-2"), []);
  assert.deepEqual(c("nada:es:x"), []);
  // Al reves se da vuelta.
  assert.deepEqual(c("fecha:entre:ultimo,2026-10-15,2026-10-01"), [
    { campo: "fecha", operador: "entre", sobre: "ultimo", desde: "2026-10-01", hasta: "2026-10-15" },
  ]);
  // Repetidas: una sola. Tope de 20 valores.
  assert.equal(c("sin_responder:si;sin_responder:si").length, 1);
  const muchas = Array.from({ length: 30 }, (_, i) => `t${i}`).join(",");
  assert.equal(c(`etiquetas:tiene:${muchas}`)[0].valores.length, 20);
});

prueba("los relativos se guardan relativos (no se congelan)", () => {
  const lista = ida([{ campo: "fecha", operador: "ultimos", sobre: "ultimo", dias: 7 }]);
  assert.equal(decodeURIComponent(lista), "c=fecha:ultimos:ultimo,7");
  assert.equal(decodeURIComponent(ida([{ campo: "fecha", operador: "hoy", sobre: "llego" }])), "c=fecha:hoy:llego");
});

prueba("una fila a medio llenar no viaja; una lista solo con condiciones no es 'sin filtro'", () => {
  assert.equal(ida([{ campo: "etiquetas", operador: "tiene", valores: [] }]), "");
  assert.equal(ida([{ campo: "fecha", operador: "entre", sobre: "ultimo", desde: null, hasta: null }]), "");
  assert.equal(m.esListaSinFiltro(ida([{ campo: "etiquetas", operador: "no_tiene", valores: ["prov"] }])), false);
  assert.equal(m.hayFiltrosPuestos(leer("c=sin_responder%3Asi")), true);
  assert.equal(m.hayFiltrosPuestos(m.SIN_FILTROS), false);
});

prueba("fechas: dias de Bogota, hasta incluido", () => {
  const f = (c) => m.diasDeLaFecha({ campo: "fecha", sobre: "ultimo", ...c }, AHORA);
  assert.deepEqual(f({ operador: "hoy" }), { desde: "2026-10-16", hasta: "2026-10-16" });
  assert.deepEqual(f({ operador: "ayer" }), { desde: "2026-10-15", hasta: "2026-10-15" });
  assert.deepEqual(f({ operador: "ultimos", dias: 7 }), { desde: "2026-10-10", hasta: "2026-10-16" });
  assert.deepEqual(f({ operador: "mes" }), { desde: "2026-10-01", hasta: "2026-10-16" });
  // 23:30 del 16 en Bogota (04:30 UTC del 17) sigue siendo el 16.
  assert.deepEqual(m.diasDeLaFecha({ campo: "fecha", sobre: "ultimo", operador: "hoy" }, new Date("2026-10-17T04:30:00.000Z")), {
    desde: "2026-10-16",
    hasta: "2026-10-16",
  });
  const l = m.limitesDeLaFecha({ campo: "fecha", sobre: "ultimo", operador: "entre", desde: "2026-10-01", hasta: "2026-10-31" }, AHORA);
  assert.equal(l.desde.toISOString(), "2026-10-01T05:00:00.000Z");
  assert.equal(l.antesDe.toISOString(), "2026-11-01T05:00:00.000Z");
});

prueba("el resumen en corto", () => {
  const nombres = {
    etapa: (e) => ({ PROPUESTA: "Propuesta", NEGOCIACION: "Negociación" })[e] ?? e,
    etiqueta: (id) => ({ prov: "PROVEEDOR", equipo: "EQUIPO" })[id] ?? null,
    asesora: (id) => ({ u1: "María" })[id] ?? null,
    canal: (id) => ({ ch2: "Ventas 2" })[id] ?? null,
  };
  const t = (c) => m.textoDeCondicion(c, nombres, AHORA);
  assert.equal(t({ campo: "etiquetas", operador: "no_tiene", valores: ["prov"] }), "sin PROVEEDOR");
  assert.equal(t({ campo: "etiquetas", operador: "no_tiene", valores: ["prov", "equipo"] }), "sin PROVEEDOR ni EQUIPO");
  assert.equal(t({ campo: "etiquetas", operador: "tiene", valores: ["prov"] }), "con PROVEEDOR");
  assert.equal(t({ campo: "etapa", operador: "es", valores: ["PROPUESTA", "NEGOCIACION"] }), "Propuesta o Negociación");
  assert.equal(t({ campo: "asesora", operador: "no_es", valores: ["u1"] }), "no María");
  assert.equal(t({ campo: "asesora", operador: "es", valores: ["sin_asignar"] }), "Sin asignar");
  assert.equal(t({ campo: "canal", operador: "no_es", valores: ["ch2"] }), "no Ventas 2");
  assert.equal(t({ campo: "canal", operador: "es", valores: ["x", "y", "z"] }), "3 líneas");
  assert.equal(t({ campo: "fecha", operador: "entre", sobre: "ultimo", desde: "2026-10-01", hasta: "2026-10-15" }), "1–15 oct");
  assert.equal(t({ campo: "fecha", operador: "entre", sobre: "ultimo", desde: "2026-09-28", hasta: "2026-10-03" }), "28 sep – 3 oct");
  assert.equal(t({ campo: "fecha", operador: "entre", sobre: "llego", desde: "2025-12-01", hasta: null }), "llegó desde 1 dic 2025");
  assert.equal(t({ campo: "fecha", operador: "ultimos", sobre: "ultimo", dias: 7 }), "últimos 7 días");
  assert.equal(t({ campo: "fecha", operador: "hoy", sobre: "llego" }), "llegó hoy");
  assert.equal(t({ campo: "sin_responder", operador: "si" }), "sin responder");
  assert.equal(t({ campo: "dias_sin_responder", operador: "al_menos", dias: 3 }), "callado 3+ días");
});

console.log(`\n${pruebas} pruebas ok`);
