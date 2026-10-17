// Pruebas de la linea de tiempo del Coach (Alex, 17-10-2026): src/features/coach/dominio/linea-de-tiempo.ts.
// Informes guardados -> filas por asesora y dia -> serie del grafico, tendencia, tarjetas y resumen
// del rango. Sin base ni red. Correr: npm run test:coach-linea
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const requireNativo = createRequire(import.meta.url);
const cache = new Map();
function cargar(archivo) {
  const absoluto = path.resolve(archivo);
  if (cache.has(absoluto)) return cache.get(absoluto).exports;
  const salida = ts.transpileModule(fs.readFileSync(absoluto, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: absoluto,
  });
  const mod = { exports: {} };
  cache.set(absoluto, mod);
  const requerir = (pedido) => {
    if (pedido.startsWith(".")) {
      const base = path.resolve(path.dirname(absoluto), pedido);
      for (const candidato of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
        if (fs.existsSync(candidato) && fs.statSync(candidato).isFile()) return cargar(candidato);
      }
    }
    return requireNativo(pedido);
  };
  new Function("exports", "require", "module", "__filename", "__dirname", salida.outputText)(mod.exports, requerir, mod, absoluto, path.dirname(absoluto));
  return mod.exports;
}

const l = cargar("src/features/coach/dominio/linea-de-tiempo.ts");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const habilidad = (clave, hoy, meta, sentido = "bajar") => ({
  version: "habilidad-v1",
  clave,
  nombre: clave === "no_dejar_sin_respuesta" ? "No dejar clientes sin respuesta" : "Responder a tiempo",
  impacto: 5,
  ranking: [],
  etapaCritica: null,
  incluyeErrorDelEquipo: false,
  evidencia: [],
  queHacerDiferente: "",
  ejemplo: "",
  metrica: {
    nombre: clave === "no_dejar_sin_respuesta" ? "clientes sin respuesta al cierre" : "demoras de más de 15 min",
    hoy,
    meta,
    sentido,
    texto: "",
  },
  redactadoPor: "plantilla",
});
const parte = (userId, nombre, { puntaje = null, sinRespuesta = 0, demoras = 0, h = null, errores = [] } = {}) => ({
  userId,
  nombre,
  chats: 5,
  puntaje,
  puntajes: null,
  aciertos: [],
  errores,
  pendientes: [],
  resumen: {
    loQueHizoBien: "",
    unaCosaAMejorar: "",
    ejemplo: "",
    habilidad: h,
    metricas: { chats: 5, chatsQuietos: 0, demoras, sinRespuesta, primeraRespuestaMedianaMin: null, cotizaciones: 0, ganados: 0, atribucionIncierta: 0 },
  },
});
const error = (tipo, detalle = "Se demoró") => ({ ref: "#1", numero: 1, ultimos4: "…0204", nombre: "", tipo, detalle });

const informes = [
  {
    dia: "2026-10-14",
    problemasDelEquipo: [],
    asesoras: [
      parte("u1", "Ingrid", {
        puntaje: 6,
        sinRespuesta: 3,
        demoras: 2,
        h: habilidad("no_dejar_sin_respuesta", 3, 0),
        errores: [error("demora"), error("sin_respuesta")],
      }),
      parte("u2", "María", { puntaje: 5, sinRespuesta: 1, demoras: 4, h: habilidad("responder_a_tiempo", 4, 2), errores: [error("demora"), error("demora")] }),
    ],
  },
  {
    dia: "2026-10-15",
    problemasDelEquipo: [],
    asesoras: [
      parte("u1", "Ingrid", {
        puntaje: 7.5,
        sinRespuesta: 0,
        demoras: 2,
        h: habilidad("responder_a_tiempo", 2, 1),
        errores: [error("demora"), error("demora", "El bot no respondió")],
      }),
      parte("u2", "María", { puntaje: 5, sinRespuesta: 2, demoras: 3, h: habilidad("responder_a_tiempo", 3, 1), errores: [error("demora")] }),
    ],
  },
  // 16-oct sin informe (hueco). 17-oct solo Ingrid.
  { dia: "2026-10-17", problemasDelEquipo: [], asesoras: [parte("u1", "Ingrid", { puntaje: 7, sinRespuesta: 1, demoras: 1 })] },
];
const dias = l.diasDeLosInformes(informes);
const de = (userId, dia) => dias.find((d) => d.userId === userId && d.dia === dia);

prueba("diasDeLosInformes: una fila por asesora y dia, con las metricas guardadas", () => {
  assert.equal(dias.length, 5);
  const d = de("u1", "2026-10-15");
  assert.equal(d.puntaje, 7.5);
  assert.equal(d.sinRespuesta, 0);
  assert.equal(d.demoras, 2);
  assert.equal(d.habilidad.nombre, "Responder a tiempo");
  assert.equal(d.habilidad.hoy, 2);
  assert.equal(d.habilidad.textoMeta, "máximo 1");
});

prueba("meta cumplida: la metrica de la habilidad medida en el informe del dia siguiente", () => {
  // Ingrid 14: sin respuesta 3 -> meta 0; el 15 quedo en 0 -> cumple.
  assert.deepEqual(de("u1", "2026-10-14").meta, { dia: "2026-10-15", valor: 0, cumple: true });
  // Maria 14: demoras 4 -> meta 2; el 15 quedo en 3 -> no cumple.
  assert.deepEqual(de("u2", "2026-10-14").meta, { dia: "2026-10-15", valor: 3, cumple: false });
  // 15: no hay informe del 16 -> no se sabe (null, no "no cumplio").
  assert.equal(de("u1", "2026-10-15").meta, null);
});

prueba("errores: lo del sistema (el bot) no cuenta como error de la asesora", () => {
  assert.deepEqual(de("u1", "2026-10-15").errores, ["demora"]);
});

prueba("armarSerie: un dia sin informe es hueco (null), nunca cero", () => {
  const asesoras = l.asesorasDe(dias);
  assert.deepEqual(
    asesoras.map((a) => [a.nombre, a.clave]),
    [
      ["Ingrid", "a0"],
      ["María", "a1"],
    ],
  );
  const filas = l.armarSerie(dias, { desde: "2026-10-14", hasta: "2026-10-17" }, "sinRespuesta", asesoras);
  assert.equal(filas.length, 4);
  assert.deepEqual(filas.map((f) => f.a0), [3, 0, null, 1]);
  assert.deepEqual(filas.map((f) => f.a1), [1, 2, null, null]);
  assert.equal(filas[0].etiqueta, "14-oct");
  // Puntaje 0 guardado SI es cero.
  const conCero = l.diasDeLosInformes([{ dia: "2026-10-01", problemasDelEquipo: [], asesoras: [parte("u1", "Ingrid", { puntaje: 0 })] }]);
  assert.equal(l.armarSerie(conCero, { desde: "2026-10-01", hasta: "2026-10-01" }, "puntaje")[0].a0, 0);
  // Sin resumen guardado: hueco en sin respuesta.
  const sinResumen = l.diasDeLosInformes([{ dia: "2026-10-01", problemasDelEquipo: [], asesoras: [{ ...parte("u1", "Ingrid"), resumen: null }] }]);
  assert.equal(sinResumen[0].sinRespuesta, null);
});

prueba("tendencia: menos es mejor en sin respuesta / demoras, mas es mejor en puntaje", () => {
  assert.equal(l.tendencia(1, 3, "bajar"), "mejoro");
  assert.equal(l.tendencia(4, 3, "bajar"), "empeoro");
  assert.equal(l.tendencia(7, 6, "subir"), "mejoro");
  assert.equal(l.tendencia(5, 6, "subir"), "empeoro");
  assert.equal(l.tendencia(2, 2, "bajar"), "igual");
  assert.equal(l.tendencia(null, 2, "bajar"), null);
  assert.equal(l.tendencia(2, null, "subir"), null);
});

prueba("resumenParaTarjetas: ultimo informe hasta ayer contra el anterior (aunque haya un hueco)", () => {
  const demoras = l.metricaDe("demoras");
  const [ingrid, maria] = l.resumenParaTarjetas(dias, "2026-10-17", demoras);
  assert.equal(ingrid.dia, "2026-10-17");
  assert.equal(ingrid.habilidad, null);
  assert.deepEqual(ingrid.tendencia, { valor: "mejoro", actual: 1, anterior: 2, diaAnterior: "2026-10-15" });
  assert.equal(maria.dia, "2026-10-15");
  assert.equal(maria.habilidad.nombre, "Responder a tiempo");
  assert.deepEqual(maria.tendencia, { valor: "mejoro", actual: 3, anterior: 4, diaAnterior: "2026-10-14" });
  // Con el puntaje (mas es mejor) Ingrid empeoro: 7 vs 7,5.
  assert.equal(l.resumenParaTarjetas(dias, "2026-10-17", l.metricaDe("puntaje"))[0].tendencia.valor, "empeoro");
  // Con otro corte no mira el futuro.
  assert.equal(l.resumenParaTarjetas(dias, "2026-10-14", demoras)[0].tendencia, null);
});

prueba("resumenDelRango: dias, metas cumplidas y errores que mas se repiten", () => {
  const r = l.resumenDelRango(dias, "u1", { desde: "2026-10-14", hasta: "2026-10-17" });
  assert.equal(r.diasConInforme, 3);
  assert.deepEqual(r.dias.map((d) => d.dia), ["2026-10-17", "2026-10-15", "2026-10-14"]);
  assert.equal(r.metasMedidas, 1);
  assert.equal(r.metasCumplidas, 1);
  assert.equal(r.erroresRepetidos[0].tipo, "demora");
  assert.equal(r.erroresRepetidos[0].dias, 2);
  assert.equal(r.erroresRepetidos[0].nombre, "Demoras");
  const m = l.resumenDelRango(dias, "u2", { desde: "2026-10-14", hasta: "2026-10-17" });
  assert.equal(m.erroresRepetidos[0].veces, 3);
  assert.equal(m.metasCumplidas, 0);
  assert.equal(m.metasMedidas, 1);
});

prueba("resolverRango: 7 dias, semana, mes, ayer y personalizado", () => {
  const hoy = "2026-10-17"; // sabado
  assert.deepEqual(l.resolverRango({}, hoy, "7d"), { tipo: "7d", desde: "2026-10-10", hasta: "2026-10-16" });
  assert.deepEqual(l.resolverRango({ rango: "ayer" }, hoy, "7d"), { tipo: "ayer", desde: "2026-10-16", hasta: "2026-10-16" });
  assert.deepEqual(l.resolverRango({ rango: "semana" }, hoy, "7d"), { tipo: "semana", desde: "2026-10-12", hasta: "2026-10-16" });
  assert.deepEqual(l.resolverRango({ rango: "mes" }, hoy, "7d"), { tipo: "mes", desde: "2026-10-01", hasta: "2026-10-16" });
  // Un lunes, "Semana" es la que acaba de terminar (los informes salen en la noche).
  assert.deepEqual(l.resolverRango({ rango: "semana" }, "2026-10-19", "7d"), { tipo: "semana", desde: "2026-10-12", hasta: "2026-10-18" });
  // El 1 del mes, "Mes" es el mes anterior.
  assert.deepEqual(l.resolverRango({ rango: "mes" }, "2026-11-01", "7d"), { tipo: "mes", desde: "2026-10-01", hasta: "2026-10-31" });
  assert.deepEqual(l.resolverRango({ rango: "custom", desde: "2026-10-09", hasta: "2026-10-02" }, hoy, "7d"), {
    tipo: "custom",
    desde: "2026-10-02",
    hasta: "2026-10-09",
  });
  // Sin futuro; un solo dia; fechas malas -> el de por defecto; maximo 92 dias.
  assert.equal(l.resolverRango({ rango: "custom", desde: "2026-10-10", hasta: "2026-12-01" }, hoy, "7d").hasta, hoy);
  assert.deepEqual(l.resolverRango({ rango: "custom", desde: "2026-10-05" }, hoy, "ayer"), {
    tipo: "custom",
    desde: "2026-10-05",
    hasta: "2026-10-05",
  });
  assert.equal(l.resolverRango({ rango: "custom", desde: "mal" }, hoy, "ayer").tipo, "ayer");
  assert.equal(l.resolverRango({ rango: "custom" }, hoy, "custom").tipo, "7d");
  assert.equal(l.resolverRango({ rango: "otra" }, hoy, "ayer").tipo, "ayer");
  const largo = l.resolverRango({ rango: "custom", desde: "2025-01-01", hasta: "2026-10-16" }, hoy, "7d");
  assert.equal(l.diasDelRango(largo.desde, largo.hasta).length, l.DIAS_MAXIMOS);
  assert.equal(largo.hasta, "2026-10-16");
});

prueba("metricaDe y textos: menos es mejor dicho en la ayuda", () => {
  assert.equal(l.metricaDe("nada").clave, "puntaje");
  assert.match(l.metricaDe("sinRespuesta").ayuda, /Menos es mejor/);
  assert.match(l.metricaDe("demoras").ayuda, /Menos es mejor/);
  assert.match(l.metricaDe("puntaje").ayuda, /Más es mejor/);
  assert.equal(l.textoDelRango({ desde: "2026-10-10", hasta: "2026-10-16" }), "10-oct – 16-oct");
  assert.equal(l.textoDelRango({ desde: "2026-10-16", hasta: "2026-10-16" }), "16-oct");
  assert.equal(l.lunesDe("2026-10-18"), "2026-10-12");
  assert.equal(l.lunesDe("2026-10-12"), "2026-10-12");
});

console.log(`\n${pruebas} pruebas ok`);
