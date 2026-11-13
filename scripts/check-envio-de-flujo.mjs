// Pruebas de src/lib/flujos/envio-de-flujo.ts (parte 1 de «Flujos: que se envíen completos aunque la
// asesora cambie de chat»): el orden de los pasos, el avance «N de M», que un paso que quedó «enviando»
// no se reenvíe al retomar, las pausas, el audio omitido y que el reintento sea de un solo paso.
// Funciones puras: no hay red, ni base, ni sale ningún mensaje.
// Correr: node scripts/check-envio-de-flujo.mjs
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);

function cargar(relativo) {
  const sourcePath = path.resolve(relativo);
  const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  });
  const mod = { exports: {} };
  new Function("exports", "require", "module", "__filename", "__dirname", transpiled.outputText)(
    mod.exports,
    require,
    mod,
    sourcePath,
    path.dirname(sourcePath),
  );
  return mod.exports;
}

const F = cargar("src/lib/flujos/envio-de-flujo.ts");
const leer = (relativo) => fs.readFileSync(path.resolve(relativo), "utf8").replace(/\r\n/g, "\n");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const SEIS_PASOS = [
  { kind: "text", content: "Hola, te comparto el catálogo" },
  { kind: "document", url: "https://x/catalogo.pdf", caption: null, fileName: "catalogo.pdf" },
  { kind: "image", url: "https://x/foto1.jpg", caption: "Sala" },
  { kind: "image", url: "https://x/foto2.jpg", caption: null },
  { kind: "video", url: "https://x/video.mp4", caption: null },
  { kind: "text", content: "¿Cuál te gustó?" },
];

/** Manda (de mentira) los pasos pendientes en orden hasta `cuantos`, y devuelve los pasos y el orden. */
function mandar(pasos, cuantos = Infinity) {
  const orden = [];
  let actuales = pasos;
  for (let i = 0; i < cuantos; i += 1) {
    const paso = F.siguientePaso(actuales);
    if (!paso) break;
    orden.push(paso.indice);
    actuales = F.marcarEnviando(actuales, paso.indice);
    actuales = F.marcarEnviado(actuales, paso.indice, `msg-${paso.indice}`);
  }
  return { pasos: actuales, orden };
}

prueba("los pasos salen en el mismo orden del flujo, todos pendientes", () => {
  const pasos = F.armarPasos(SEIS_PASOS);
  assert.equal(pasos.length, 6);
  assert.deepStrictEqual(pasos.map((p) => p.indice), [0, 1, 2, 3, 4, 5]);
  assert.deepStrictEqual(pasos.map((p) => p.tipo), ["text", "document", "image", "image", "video", "text"]);
  assert.ok(pasos.every((p) => p.estado === "pendiente" && p.error === null && p.mensajeId === null));
  assert.deepStrictEqual(pasos[1].contenido, SEIS_PASOS[1]);
  const { orden, pasos: finales } = mandar(pasos);
  assert.deepStrictEqual(orden, [0, 1, 2, 3, 4, 5]);
  assert.equal(F.siguientePaso(finales), null);
  assert.equal(finales[2].mensajeId, "msg-2");
});

prueba("el avance dice «3 de 6» tras mandar 3, y el estado va de EN_CURSO a TERMINADO", () => {
  const pasos = F.armarPasos(SEIS_PASOS);
  assert.deepStrictEqual(F.calcularAvance(pasos), { enviados: 0, total: 6, texto: "0 de 6" });
  const { pasos: aMedias } = mandar(pasos, 3);
  assert.deepStrictEqual(F.calcularAvance(aMedias), { enviados: 3, total: 6, texto: "3 de 6" });
  assert.equal(F.estadoFinal(aMedias), "EN_CURSO");
  assert.equal(F.siguientePaso(aMedias).indice, 3);
  const { pasos: todos } = mandar(aMedias);
  assert.equal(F.calcularAvance(todos).texto, "6 de 6");
  assert.equal(F.estadoFinal(todos), "TERMINADO");
});

prueba("no se cambia la lista que se recibe (cada función devuelve una nueva)", () => {
  const pasos = F.armarPasos(SEIS_PASOS);
  const copia = JSON.parse(JSON.stringify(pasos));
  F.marcarEnviando(pasos, 0);
  F.marcarFallido(pasos, 1, "x");
  F.retomar(F.marcarEnviando(pasos, 2));
  assert.deepStrictEqual(pasos, copia);
});

prueba("un paso que quedó «enviando» pasa a fallido con «no se sabe si salió» y NO se reenvía al retomar", () => {
  let pasos = F.armarPasos(SEIS_PASOS);
  pasos = mandar(pasos, 2).pasos;
  // Se cae el servidor mandando el paso 2.
  pasos = F.marcarEnviando(pasos, 2);
  assert.equal(F.estadoFinal(pasos), "EN_CURSO");
  const retomados = F.retomar(pasos);
  assert.equal(retomados[2].estado, "fallido");
  assert.equal(retomados[2].error, "no se sabe si salió");
  assert.equal(F.ERROR_NO_SE_SABE_SI_SALIO, "no se sabe si salió");
  // Los demás quedan como estaban.
  assert.deepStrictEqual(retomados.filter((p) => p.indice !== 2), pasos.filter((p) => p.indice !== 2));
  // Al seguir, se salta el 2: sigue el 3 y el 2 nunca vuelve a salir solo.
  const { orden, pasos: finales } = mandar(retomados);
  assert.deepStrictEqual(orden, [3, 4, 5]);
  assert.equal(finales[2].estado, "fallido");
  assert.equal(F.siguientePaso(finales), null);
  assert.equal(F.estadoFinal(finales), "CON_FALLAS");
  assert.equal(F.calcularAvance(finales).texto, "5 de 6");
  // Retomar dos veces da lo mismo.
  assert.deepStrictEqual(F.retomar(retomados), retomados);
});

prueba("las pausas están en una sola constante y no pasan de los máximos (400 ms texto, 800 ms archivo)", () => {
  assert.deepStrictEqual({ ...F.PAUSAS }, { PAUSA_TRAS_TEXTO_MS: 400, PAUSA_TRAS_ARCHIVO_MS: 800 });
  assert.equal(F.pausaTras("text"), 400);
  for (const tipo of ["image", "video", "document", "audio"]) {
    assert.ok(F.pausaTras(tipo) <= 800, tipo);
  }
  for (const paso of SEIS_PASOS) {
    assert.ok(F.pausaTras(paso.kind) <= (paso.kind === "text" ? 400 : 800), paso.kind);
  }
  // Un flujo de 6 pasos espera como mucho 5 pausas de archivo.
  const espera = SEIS_PASOS.slice(0, -1).reduce((suma, paso) => suma + F.pausaTras(paso.kind), 0);
  assert.ok(espera <= 5 * 800, `espera ${espera}`);
});

prueba("el audio queda omitido, no se manda y no cuenta en el total", () => {
  const pasos = F.armarPasos([
    { kind: "text", content: "Hola" },
    { kind: "audio", url: "https://x/nota.ogg", caption: null },
    { kind: "text", content: "Chao" },
  ]);
  assert.equal(pasos[1].estado, "omitido");
  assert.equal(pasos[1].error, F.ERROR_AUDIO_OMITIDO);
  const { orden, pasos: finales } = mandar(pasos);
  assert.deepStrictEqual(orden, [0, 2]);
  assert.deepStrictEqual(F.calcularAvance(finales), { enviados: 2, total: 2, texto: "2 de 2" });
  assert.equal(F.estadoFinal(finales), "TERMINADO");
  assert.equal(F.puedeReintentar(finales[1]), false);
  assert.throws(() => F.marcarEnviando(finales, 1));
});

prueba("el reintento es de UN solo paso, y solo de un paso fallido", () => {
  let pasos = F.armarPasos(SEIS_PASOS);
  pasos = mandar(pasos, 1).pasos;
  pasos = F.marcarFallido(F.marcarEnviando(pasos, 1), 1, "WhatsApp no respondió");
  pasos = mandar(pasos, 1).pasos;
  pasos = F.marcarFallido(F.marcarEnviando(pasos, 3), 3, "");
  assert.equal(pasos[3].error, "No se pudo enviar");
  pasos = mandar(pasos).pasos;
  assert.equal(F.estadoFinal(pasos), "CON_FALLAS");

  assert.equal(F.puedeReintentar(pasos[1]), true);
  assert.equal(F.puedeReintentar(pasos[0]), false, "enviado");
  assert.equal(F.puedeReintentar(F.marcarEnviando(F.armarPasos(SEIS_PASOS), 0)[0]), false, "enviando");
  assert.equal(F.puedeReintentar(F.armarPasos(SEIS_PASOS)[0]), false, "pendiente");
  assert.throws(() => F.reintentarPaso(pasos, 0), /no se puede reintentar/);

  const reintento = F.reintentarPaso(pasos, 1);
  // Solo cambió el paso 1; el 3 sigue fallido.
  assert.deepStrictEqual(reintento.filter((p) => p.indice !== 1), pasos.filter((p) => p.indice !== 1));
  assert.equal(reintento[1].estado, "pendiente");
  assert.equal(reintento[1].error, null);
  const { orden, pasos: finales } = mandar(reintento);
  assert.deepStrictEqual(orden, [1], "sale solo el paso reintentado");
  assert.equal(finales[3].estado, "fallido");
  assert.equal(F.calcularAvance(finales).texto, "5 de 6");
  assert.throws(() => F.marcarEnviado(pasos, 99), /No existe el paso 99/);
});

prueba("la línea [flujo] medicion trae los ms de cada paso y el total, sin contenido de los mensajes", () => {
  const linea = F.lineaDeMedicion({
    conversationId: "c1",
    flowId: "f1",
    pasos: [
      { tipo: "text", resultado: "enviado", ms: 120.4 },
      { tipo: "document", resultado: "fallido", ms: 2300 },
      { tipo: "audio", resultado: "omitido", ms: 0 },
    ],
    msTotal: 6020.7,
  });
  assert.deepStrictEqual(linea, {
    conversationId: "c1",
    flowId: "f1",
    pasos: 3,
    enviados: 1,
    fallidos: 1,
    omitidos: 1,
    porPaso: ["1:text=120ms", "2:document=2300ms (fallido)", "3:audio=0ms (omitido)"],
    msEnPasos: 2420,
    msTotal: 6021,
  });
});

prueba("el envío de hoy solo agrega la medición: mismas pausas, mismo orden y misma respuesta", () => {
  const accion = leer("src/app/actions/flow-send-actions.ts");
  assert.match(accion, /const PAUSA_ARCHIVO_MS = 3000;/);
  assert.match(accion, /const PAUSA_TEXTO_MS = 700;/);
  assert.match(accion, /for \(const \[indice, paso\] of flujo\.steps\.entries\(\)\)/);
  assert.match(accion, /return \{ ok: true, enviados, fallidos, omitidos \};/);
  assert.match(accion, /console\.info\(\s*"\[flujo\] medicion",\s*lineaDeMedicion\(/);
  // El módulo de reglas es puro: no importa Prisma, gateways ni acciones.
  const reglas = leer("src/lib/flujos/envio-de-flujo.ts");
  const importaciones = reglas.match(/^import .*$/gm) ?? [];
  assert.deepStrictEqual(importaciones, ['import type { FlowStep } from "@/lib/agent-product-flow";']);
});

prueba("la migración solo crea la tabla EnvioDeFlujo, sus índices y su llave a Workspace", () => {
  const carpeta = fs.readdirSync(path.resolve("prisma/migrations")).find((n) => n.endsWith("_envio_de_flujo"));
  assert.ok(carpeta, "falta la carpeta de la migración");
  const sql = leer(`prisma/migrations/${carpeta}/migration.sql`).replace(/--.*$/gm, "");
  assert.match(sql, /BEGIN;/);
  assert.match(sql, /COMMIT;/);
  const sentencias = sql.split(";").map((s) => s.trim()).filter(Boolean);
  for (const sentencia of sentencias) {
    assert.ok(
      /^(BEGIN|COMMIT|CREATE TABLE IF NOT EXISTS "EnvioDeFlujo"|CREATE INDEX IF NOT EXISTS "EnvioDeFlujo_\w+" ON "EnvioDeFlujo")/.test(sentencia),
      `sentencia fuera de lo permitido: ${sentencia.slice(0, 80)}`,
    );
  }
  assert.doesNotMatch(sql, /ALTER TABLE|DROP |^\s*UPDATE |^\s*DELETE |INSERT /im);
  assert.match(sql, /FOREIGN KEY \("workspaceId"\)\s+REFERENCES "Workspace"\("id"\)/);
  const esquema = leer("prisma/schema.prisma");
  assert.match(esquema, /^model EnvioDeFlujo \{/m);
  assert.match(esquema, /enviosDeFlujo\s+EnvioDeFlujo\[\]/);
});

console.log(`\n${pruebas} pruebas ok`);
