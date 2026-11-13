// Pruebas de las reglas del envío de un flujo desde el chat (src/lib/flujos/envio-de-flujo.ts).
// Correr: npm run test:envio-de-flujo
//
// Carga el módulo REAL transpilando el TypeScript (es puro: no toca la base ni los gateways) y revisa,
// leyendo el código, que la parte 1 solo agregue la medición al envío de hoy.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import ts from "typescript";

const ARCHIVO = path.resolve("src/lib/flujos/envio-de-flujo.ts");
const salida = ts.transpileModule(fs.readFileSync(ARCHIVO, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  fileName: ARCHIVO,
});
const mod = { exports: {} };
new Function("exports", "require", "module", salida.outputText)(
  mod.exports,
  (especificador) => {
    throw new Error(`envio-de-flujo.ts debe ser puro y no cargar nada en ejecución (pidió ${especificador})`);
  },
  mod,
);
const F = mod.exports;

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const seisPasos = [
  { kind: "text", content: "Hola, te comparto el catálogo" },
  { kind: "image", url: "https://x.test/a.jpg", caption: null },
  { kind: "text", content: "Estos son los colores" },
  { kind: "document", url: "https://x.test/catalogo.pdf", caption: null, fileName: "catalogo.pdf" },
  { kind: "video", url: "https://x.test/v.mp4", caption: "Así queda" },
  { kind: "text", content: "¿Cuál te gusta?" },
];

// Manda en orden hasta que no quede nada; devuelve los índices en el orden en que salieron.
function mandarTodo(pasos, { fallar = new Set(), cortarEn = Infinity } = {}) {
  const orden = [];
  let lista = pasos;
  for (let vuelta = 0; vuelta < 50; vuelta += 1) {
    const paso = F.siguientePaso(lista);
    if (!paso) break;
    lista = F.marcarEnviando(lista, paso.indice);
    if (orden.length === cortarEn) return { lista, orden }; // se cayó el servidor con el paso en "enviando"
    orden.push(paso.indice);
    lista = fallar.has(paso.indice)
      ? F.marcarFallido(lista, paso.indice, "WhatsApp no respondió")
      : F.marcarEnviado(lista, paso.indice, `msg-${paso.indice}`);
  }
  return { lista, orden };
}

prueba("los pasos salen en el orden del flujo", () => {
  const pasos = F.armarPasos(seisPasos);
  assert.deepEqual(
    pasos.map((p) => [p.indice, p.tipo, p.estado]),
    seisPasos.map((p, i) => [i, p.kind, "pendiente"]),
  );
  const { lista, orden } = mandarTodo(pasos);
  assert.deepEqual(orden, [0, 1, 2, 3, 4, 5]);
  assert.equal(F.estadoDelEnvio(lista), "TERMINADO");
  assert.equal(lista[3].mensajeId, "msg-3");
  // siguientePaso respeta el índice aunque la lista llegue desordenada (por ejemplo, desde el JSON).
  assert.equal(F.siguientePaso([...pasos].reverse()).indice, 0);
  // No cambia la lista que recibe.
  assert.ok(pasos.every((p) => p.estado === "pendiente"));
});

prueba("el avance dice «3 de 6» y el estado sigue EN_CURSO", () => {
  let lista = F.armarPasos(seisPasos);
  for (const i of [0, 1, 2]) lista = F.marcarEnviado(F.marcarEnviando(lista, i), i);
  const avance = F.calcularAvance(lista);
  assert.equal(avance.texto, "3 de 6");
  assert.equal(avance.enviados, 3);
  assert.equal(avance.total, 6);
  assert.equal(F.estadoDelEnvio(lista), "EN_CURSO");
});

prueba("un paso en «enviando» pasa a fallido al retomar y NO se reenvía", () => {
  const { lista: cortada, orden } = mandarTodo(F.armarPasos(seisPasos), { cortarEn: 2 });
  assert.deepEqual(orden, [0, 1]);
  assert.equal(cortada[2].estado, "enviando");
  assert.equal(F.estadoDelEnvio(cortada), "EN_CURSO");

  const retomada = F.retomar(cortada);
  assert.equal(retomada[2].estado, "fallido");
  assert.equal(retomada[2].error, "no se sabe si salió");
  assert.equal(F.puedeReintentar(retomada[2]), true);
  // Lo que ya salió sigue enviado; lo pendiente sigue pendiente.
  assert.deepEqual(
    retomada.map((p) => p.estado),
    ["enviado", "enviado", "fallido", "pendiente", "pendiente", "pendiente"],
  );

  // Al seguir mandando, el paso 2 no vuelve a salir solo.
  const { lista: final, orden: ordenFinal } = mandarTodo(retomada);
  assert.deepEqual(ordenFinal, [3, 4, 5]);
  assert.equal(final[2].estado, "fallido");
  assert.equal(F.estadoDelEnvio(final), "CON_FALLAS");
  assert.equal(F.calcularAvance(final).texto, "5 de 6");
});

prueba("las pausas no pasan de los máximos (400 ms tras texto, 800 ms tras archivo)", () => {
  assert.equal(F.PAUSAS_DEL_FLUJO.PAUSA_TRAS_TEXTO_MS, 400);
  assert.equal(F.PAUSAS_DEL_FLUJO.PAUSA_TRAS_ARCHIVO_MS, 800);
  assert.equal(F.pausaTras("text"), 400);
  for (const tipo of ["image", "video", "document", "audio"]) {
    assert.ok(F.pausaTras(tipo) <= 800, `pausa tras ${tipo}`);
  }
  const totalPausas = seisPasos.slice(0, -1).reduce((suma, p) => suma + F.pausaTras(p.kind), 0);
  assert.ok(totalPausas <= 800 * (seisPasos.length - 1));
});

prueba("el audio queda omitido y no se manda", () => {
  const conAudio = [...seisPasos.slice(0, 2), { kind: "audio", url: "https://x.test/a.ogg", caption: null }];
  const pasos = F.armarPasos(conAudio);
  assert.equal(pasos[2].estado, "omitido");
  assert.ok(pasos[2].error);
  assert.equal(F.puedeReintentar(pasos[2]), false);
  const { lista, orden } = mandarTodo(pasos);
  assert.deepEqual(orden, [0, 1]);
  assert.equal(lista[2].estado, "omitido");
  const avance = F.calcularAvance(lista);
  assert.equal(avance.texto, "2 de 2");
  assert.equal(avance.omitidos, 1);
  assert.equal(F.estadoDelEnvio(lista), "TERMINADO");
});

prueba("el reintento es de un solo paso", () => {
  const { lista } = mandarTodo(F.armarPasos(seisPasos), { fallar: new Set([1, 4]) });
  assert.equal(F.estadoDelEnvio(lista), "CON_FALLAS");
  assert.equal(F.puedeReintentar(lista[0]), false, "un paso enviado no se reintenta");

  const reintento = F.reintentarPaso(lista, 4);
  assert.deepEqual(
    reintento.map((p) => p.estado),
    ["enviado", "fallido", "enviado", "enviado", "pendiente", "enviado"],
  );
  const { lista: final, orden } = mandarTodo(reintento);
  assert.deepEqual(orden, [4], "solo sale el paso reintentado");
  assert.equal(final[1].estado, "fallido");
  assert.equal(F.calcularAvance(final).texto, "5 de 6");

  // Reintentar un paso que no está fallido no cambia nada.
  assert.deepEqual(F.reintentarPaso(lista, 0), lista);
});

prueba("la línea de medición lleva ms por paso y total, sin contenido", () => {
  const linea = F.lineaDeMedicion({
    flowId: "flujo-1",
    conversationId: "conv-1",
    pasos: [
      { tipo: "text", ms: 812.4, resultado: "enviado" },
      { tipo: "image", ms: 2310, resultado: "fallido" },
      { tipo: "audio", ms: 0, resultado: "omitido" },
    ],
    pausasMs: 3700,
    totalMs: 6822.6,
  });
  assert.deepEqual(linea, {
    flowId: "flujo-1",
    conversationId: "conv-1",
    pasos: 3,
    enviados: 1,
    fallidos: 1,
    omitidos: 1,
    msPorPaso: "text:812 image:2310 audio:0",
    pausasMs: 3700,
    totalMs: 6823,
  });
});

prueba("parte 1: el envío de hoy solo gana la medición (mismas pausas y misma respuesta)", () => {
  const accion = fs.readFileSync(path.resolve("src/app/actions/flow-send-actions.ts"), "utf8");
  assert.match(accion, /const PAUSA_ARCHIVO_MS = 3000;/);
  assert.match(accion, /const PAUSA_TEXTO_MS = 700;/);
  assert.match(accion, /console\.info\(\s*"\[flujo\] medicion",\s*lineaDeMedicion\(/);
  assert.match(accion, /return \{ ok: true, enviados, fallidos, omitidos \};/);
});

console.log(`\n${pruebas} pruebas OK`);
