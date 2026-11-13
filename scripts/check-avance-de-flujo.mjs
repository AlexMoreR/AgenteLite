// Pruebas de la parte 3 de «Flujos: que se envíen completos aunque la asesora cambie de chat»: el avance que
// lee la franja (src/lib/flujos/avance-de-flujo.ts), que la ruta avance-de-flujo sea de solo lectura y no
// devuelva el contenido de los pasos, y que la franja y el diálogo estén conectados.
// Funciones puras y lectura de archivos: no hay red, ni base, ni sale ningún mensaje.
// Correr: node scripts/check-avance-de-flujo.mjs
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const cargados = new Map();

function cargar(relativo) {
  const sourcePath = path.resolve(relativo);
  const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  });
  const mod = { exports: {} };
  const requerir = (nombre) => (cargados.has(nombre) ? cargados.get(nombre) : require(nombre));
  new Function("exports", "require", "module", "__filename", "__dirname", transpiled.outputText)(
    mod.exports,
    requerir,
    mod,
    sourcePath,
    path.dirname(sourcePath),
  );
  return mod.exports;
}

const F = cargar("src/lib/flujos/envio-de-flujo.ts");
cargados.set("@/lib/flujos/envio-de-flujo", F);
const A = cargar("src/lib/flujos/avance-de-flujo.ts");
const leer = (relativo) => fs.readFileSync(path.resolve(relativo), "utf8").replace(/\r\n/g, "\n");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const PASOS_DEL_FLUJO = [
  { kind: "text", text: "Hola, este es el catálogo" },
  { kind: "file", url: "/uploads/catalogo.pdf", fileName: "catalogo.pdf" },
  { kind: "audio", url: "/uploads/nota.ogg" },
  { kind: "image", url: "/uploads/foto.jpg" },
];
const AHORA = Date.parse("2026-11-13T15:00:00Z");
const hace = (ms) => new Date(AHORA - ms);

prueba("el avance sale de los pasos: N de M sin contar el audio, y los fallidos aparte", () => {
  let pasos = F.armarPasos(PASOS_DEL_FLUJO);
  pasos = F.marcarEnviado(pasos, 0, "m1");
  const fila = { id: "env1", estado: "EN_CURSO", startedAt: hace(1000), finishedAt: null };
  const avance = A.armarAvance(fila, pasos, "Catálogo");
  assert.equal(avance.envioId, "env1");
  assert.equal(avance.titulo, "Catálogo");
  assert.equal(avance.enviados, 1);
  assert.equal(avance.total, 3);
  assert.equal(avance.fallidos, 0);
  assert.equal(avance.estado, "EN_CURSO");
  assert.equal(A.textoDeLaFranja(avance), "Enviando «Catálogo»: 1 de 3");

  pasos = F.marcarFallido(F.marcarEnviado(pasos, 1), 3, "Sin señal");
  const final = A.armarAvance({ ...fila, estado: F.estadoFinal(pasos) }, pasos, "Catálogo");
  assert.equal(final.estado, "CON_FALLAS");
  assert.equal(final.fallidos, 1);
  assert.equal(A.textoDeLaFranja(final), "«Catálogo»: salieron 2 de 3, 1 no salió");
  assert.equal(A.textoDeLaFranja({ ...final, fallidos: 2 }), "«Catálogo»: salieron 2 de 3, 2 no salieron");
});

prueba("de cada paso sale estado, tipo y error: NUNCA el contenido", () => {
  const pasos = F.marcarFallido(F.armarPasos(PASOS_DEL_FLUJO), 1, "No se pudo enviar");
  const avance = A.armarAvance({ id: "e", estado: "EN_CURSO", startedAt: hace(0), finishedAt: null }, pasos, "X");
  assert.deepStrictEqual(avance.pasos[1], { indice: 1, tipo: "file", estado: "fallido", error: "No se pudo enviar" });
  for (const paso of avance.pasos) {
    assert.deepStrictEqual(Object.keys(paso).sort(), ["error", "estado", "indice", "tipo"]);
  }
  const json = JSON.stringify(avance);
  assert.doesNotMatch(json, /catalogo\.pdf|Hola, este es|uploads|mensajeId|contenido/);
});

prueba("título vacío y estado desconocido no rompen la franja", () => {
  const avance = A.armarAvance({ id: "e", estado: "RARO", startedAt: hace(0), finishedAt: null }, F.armarPasos(PASOS_DEL_FLUJO), "  ");
  assert.equal(avance.titulo, "Flujo sin nombre");
  assert.equal(avance.estado, "EN_CURSO");
});

prueba("qué se muestra: EN_CURSO de la última hora y CON_FALLAS de hace poco; TERMINADO nunca", () => {
  const fila = (estado, inicio, fin = null) => ({ id: "e", estado, startedAt: hace(inicio), finishedAt: fin === null ? null : hace(fin) });
  assert.equal(A.debeMostrarse(fila("EN_CURSO", 5_000), AHORA), true);
  assert.equal(A.debeMostrarse(fila("EN_CURSO", A.MOSTRAR_EN_CURSO_POR_MS + 1), AHORA), false);
  assert.equal(A.debeMostrarse(fila("CON_FALLAS", 60_000, 30_000), AHORA), true);
  assert.equal(A.debeMostrarse(fila("CON_FALLAS", A.MOSTRAR_FALLAS_POR_MS + 60_000, A.MOSTRAR_FALLAS_POR_MS + 1), AHORA), false);
  assert.equal(A.debeMostrarse(fila("TERMINADO", 5_000, 1_000), AHORA), false);
});

prueba("la ruta avance-de-flujo es GET de solo lectura, revisa sesión, Chats y el chat, y no es de envío", () => {
  const ruta = leer("src/app/api/cliente/chats/avance-de-flujo/route.ts");
  assert.match(ruta, /export async function GET\(/);
  assert.doesNotMatch(ruta, /export (async )?function (POST|PUT|PATCH|DELETE)\b/);
  assert.doesNotMatch(ruta, /\.(create|update|updateMany|upsert|delete|deleteMany)\(/);
  assert.doesNotMatch(ruta, /enviarTextoAlChat|enviarArchivoAlChat|procesarEnvioDeFlujo|gateway|evolution|waha/i);
  assert.match(ruta, /session\?\.user\?\.id/);
  assert.match(ruta, /canAccessClientModule\(access, "chats"\)/);
  assert.match(ruta, /workspaceId,\s*\n\s*conversationId,/);
  assert.match(ruta, /puedeAbrirChatPorClave\(/);
  assert.match(ruta, /armarAvance\(/);
  // No trae el contenido de otra forma: la franja recibe lo que arma armarAvance.
  assert.doesNotMatch(ruta, /\.contenido\b/);
  const rutasDeEnvio = leer("src/lib/chats/ruta-de-envio.ts");
  assert.doesNotMatch(rutasDeEnvio, /avance-de-flujo/);
});

prueba("la franja solo lee, pregunta mientras haya uno en curso y está arriba de la caja de escribir", () => {
  const franja = leer("src/components/chats/franja-envio-de-flujo.tsx");
  assert.match(franja, /\/api\/cliente\/chats\/avance-de-flujo\?conversationId=/);
  assert.doesNotMatch(franja, /method:\s*"(POST|PUT|PATCH|DELETE)"/);
  assert.match(franja, /envio\.estado === "EN_CURSO"/);
  assert.match(franja, /CADA_MS = 1500/);
  assert.match(franja, /textoDeLaFranja\(envio\)/);
  const panel = leer("src/components/chats/chat-conversation-panel.tsx");
  assert.match(panel, /<FranjaEnvioDeFlujo\s/);
  assert.ok(
    panel.indexOf("<FranjaEnvioDeFlujo") < panel.indexOf('<div className="flex w-full min-w-0 items-end gap-2 md:gap-3">'),
    "la franja va arriba de la caja de escribir",
  );
});

prueba("el diálogo: con envioId avisa a la franja y no dice «enviado»; sin envioId sigue como antes", () => {
  const dialogo = leer("src/components/chats/send-flow-dialog.tsx");
  const conEnvio = dialogo.slice(dialogo.indexOf("if (resultado.envioId) {"));
  assert.ok(conEnvio.length > 0, "falta la rama con envioId");
  const rama = conEnvio.slice(0, conEnvio.indexOf("return;\n      }\n"));
  assert.match(rama, /avisarEnvioDeFlujoEnCurso\(/);
  assert.doesNotMatch(rama, /enviado`|toast\.success/);
  // Lo de antes queda para la respuesta sin envioId.
  assert.match(dialogo, /toast\.success\(`"\$\{input\.titulo\}" enviado`/);
});

console.log(`\n${pruebas} pruebas ok`);
