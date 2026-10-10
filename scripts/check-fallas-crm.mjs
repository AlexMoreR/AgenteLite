// Pruebas de src/lib/chat-envio-seguro.ts (fallas del CRM que afectan a las asesoras, 10-10-2026).
// Correr: npm run test:fallas-crm
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

const {
  idPeladoDelChat,
  resolverDestinoDelEnvio,
  verificarDestinoDelEnvio,
  MENSAJE_ESPERA_CARGA,
  MENSAJE_CHAT_CAMBIADO,
  agregarFallido,
  quitarFallido,
  fallidosDelChat,
  textoCoincideConGuardado,
  MAX_FALLIDOS_GUARDADOS,
  estadoCargaDelChat,
  LIMITE_CARGA_CHAT_MS,
  leerPausaPedida,
  decidirCambioDePausa,
  estadoTrasRespuestaIA,
  revisarArchivoAntesDeSubir,
  TIPOS_PERMITIDOS_CHAT,
  ACCEPT_DOCUMENTOS_CHAT,
} = cargar("src/lib/chat-envio-seguro.ts");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

/* ---------------- 1. Mensaje al chat equivocado ---------------- */

prueba("id pelado: agent:/official:/sin prefijo/vacio", () => {
  assert.equal(idPeladoDelChat("agent:cm1"), "cm1");
  assert.equal(idPeladoDelChat("official:of9"), "of9");
  assert.equal(idPeladoDelChat("cm1"), "cm1");
  assert.equal(idPeladoDelChat(""), "");
  assert.equal(idPeladoDelChat(null), "");
});

prueba("chat cargado y abierto coinciden = destino ese chat", () => {
  const r = resolverDestinoDelEnvio({ chatAbiertoKey: "agent:B", chatCargado: { id: "B", isPreview: false } });
  assert.deepEqual(r, { ok: true, conversationId: "B", chatEsperado: "B" });
});

prueba("chat todavia en vista previa = NO se envia (escenario: abre Y y escribe rapido)", () => {
  const r = resolverDestinoDelEnvio({ chatAbiertoKey: "agent:Y", chatCargado: { id: "agent:Y", isPreview: true } });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "cargando");
  assert.equal(r.mensaje, MENSAJE_ESPERA_CARGA);
});

prueba("en pantalla sigue el chat ANTERIOR = NO se envia", () => {
  const r = resolverDestinoDelEnvio({ chatAbiertoKey: "agent:Y", chatCargado: { id: "X", isPreview: false } });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "otro-chat");
});

prueba("sin chat abierto o sin chat cargado = NO se envia", () => {
  assert.equal(resolverDestinoDelEnvio({ chatAbiertoKey: "", chatCargado: { id: "X" } }).ok, false);
  assert.equal(resolverDestinoDelEnvio({ chatAbiertoKey: "agent:X", chatCargado: null }).ok, false);
});

prueba("chat de la API oficial cargado = destino con el id pelado", () => {
  const r = resolverDestinoDelEnvio({ chatAbiertoKey: "official:of1", chatCargado: { id: "of1" } });
  assert.deepEqual(r, { ok: true, conversationId: "of1", chatEsperado: "of1" });
});

prueba("servidor: chatEsperado distinto del conversationId = rechazado", () => {
  const r = verificarDestinoDelEnvio({ conversationId: "X", chatEsperado: "Y" });
  assert.equal(r.ok, false);
  assert.equal(r.error, MENSAJE_CHAT_CAMBIADO);
});

prueba("servidor: chatEsperado igual (con o sin prefijo) = aceptado", () => {
  assert.equal(verificarDestinoDelEnvio({ conversationId: "X", chatEsperado: "X" }).ok, true);
  assert.equal(verificarDestinoDelEnvio({ conversationId: "X", chatEsperado: "agent:X" }).ok, true);
});

prueba("servidor: sin chatEsperado (pantalla vieja en cache) = se acepta como antes", () => {
  assert.equal(verificarDestinoDelEnvio({ conversationId: "X", chatEsperado: null }).ok, true);
  assert.equal(verificarDestinoDelEnvio({ conversationId: "X", chatEsperado: "  " }).ok, true);
});

/* ---------------- 2. Mensajes fallidos que se pierden ---------------- */

const fallido = (id, conversationId, segundos, texto = "hola") => ({
  id,
  conversationId,
  createdAt: new Date(Date.UTC(2026, 9, 10, 10, 0, segundos)),
  content: texto,
  outboundStatusLabel: "error",
});

prueba("el siguiente fallido NO borra al anterior (antes habia un solo espacio)", () => {
  let lista = [];
  lista = agregarFallido(lista, fallido("a", "X", 1, "precio 1"));
  lista = agregarFallido(lista, fallido("b", "X", 2, "precio 2"));
  assert.deepEqual(lista.map((m) => m.id), ["a", "b"]);
  assert.equal(lista[0].content, "precio 1");
});

prueba("fallidos de otro chat no se tocan y se filtran por chat (con o sin prefijo)", () => {
  let lista = [];
  lista = agregarFallido(lista, fallido("a", "X", 3));
  lista = agregarFallido(lista, fallido("b", "Y", 1));
  lista = agregarFallido(lista, fallido("c", "X", 1));
  assert.deepEqual(fallidosDelChat(lista, "X").map((m) => m.id), ["c", "a"]);
  assert.deepEqual(fallidosDelChat(lista, "agent:Y").map((m) => m.id), ["b"]);
});

prueba("mismo id = se reemplaza (no se duplica)", () => {
  let lista = agregarFallido([], fallido("a", "X", 1, "v1"));
  lista = agregarFallido(lista, fallido("a", "X", 1, "v2"));
  assert.equal(lista.length, 1);
  assert.equal(lista[0].content, "v2");
});

prueba("Reintentar saca solo ese fallido", () => {
  const lista = [fallido("a", "X", 1), fallido("b", "X", 2)];
  assert.deepEqual(quitarFallido(lista, "a").map((m) => m.id), ["b"]);
  assert.equal(quitarFallido(lista, "zzz"), lista);
});

prueba("tope de fallidos guardados: se conservan los mas nuevos", () => {
  let lista = [];
  for (let i = 0; i < MAX_FALLIDOS_GUARDADOS + 5; i += 1) {
    lista = agregarFallido(lista, fallido(`m${i}`, "X", i));
  }
  assert.equal(lista.length, MAX_FALLIDOS_GUARDADOS);
  assert.equal(lista.at(-1).id, `m${MAX_FALLIDOS_GUARDADOS + 4}`);
});

prueba("si el texto ya aparece guardado (con firma arriba) se reconoce", () => {
  assert.equal(textoCoincideConGuardado("👩‍💻 Ingrid\nVale  $1.200.000", "Vale $1.200.000"), true);
  assert.equal(textoCoincideConGuardado("otra cosa", "Vale $1.200.000"), false);
  assert.equal(textoCoincideConGuardado("algo", ""), false);
});

prueba("carga del chat: listo / cargando / error por fallo / error por limite", () => {
  assert.equal(estadoCargaDelChat({ esVistaPrevia: false, fallo: true, msDesdeQueAbrio: 99_999 }), "listo");
  assert.equal(estadoCargaDelChat({ esVistaPrevia: true, fallo: false, msDesdeQueAbrio: 1000 }), "cargando");
  assert.equal(estadoCargaDelChat({ esVistaPrevia: true, fallo: true, msDesdeQueAbrio: 0 }), "error");
  assert.equal(
    estadoCargaDelChat({ esVistaPrevia: true, fallo: false, msDesdeQueAbrio: LIMITE_CARGA_CHAT_MS }),
    "error",
  );
});

/* ---------------- 3. Interruptor de IA confiable ---------------- */

prueba("leerPausaPedida: 1/0/true/false y basura = null", () => {
  assert.equal(leerPausaPedida("1"), true);
  assert.equal(leerPausaPedida("true"), true);
  assert.equal(leerPausaPedida("0"), false);
  assert.equal(leerPausaPedida("false"), false);
  assert.equal(leerPausaPedida(""), null);
  assert.equal(leerPausaPedida(null), null);
  assert.equal(leerPausaPedida("x"), null);
});

prueba("pausar con la IA activa = cambia, sin reactivar", () => {
  assert.deepEqual(decidirCambioDePausa(false, true), { pausada: true, cambio: true, reactivar: false });
});

prueba("pausar con la IA YA pausada (doble toque / pantalla vieja) = no cambia (antes la PRENDIA)", () => {
  assert.deepEqual(decidirCambioDePausa(true, true), { pausada: true, cambio: false, reactivar: false });
});

prueba("reanudar con la IA pausada = cambia y reactiva (mensaje de reactivacion como antes)", () => {
  assert.deepEqual(decidirCambioDePausa(true, false), { pausada: false, cambio: true, reactivar: true });
});

prueba("reanudar con la IA YA activa = no cambia ni manda reactivacion", () => {
  assert.deepEqual(decidirCambioDePausa(false, false), { pausada: false, cambio: false, reactivar: false });
});

prueba("interruptor: ok del servidor = muestra el estado REAL, sin aviso", () => {
  assert.deepEqual(estadoTrasRespuestaIA(false, true, { ok: true, pausada: true }), { pausada: true, aviso: null });
});

prueba("interruptor: el servidor dice otro estado = se muestra ese y se avisa", () => {
  const r = estadoTrasRespuestaIA(false, true, { ok: true, pausada: false });
  assert.equal(r.pausada, false);
  assert.match(r.aviso, /ACTIVA/);
});

prueba("interruptor: error = vuelve a como estaba y avisa con el estado real", () => {
  const r = estadoTrasRespuestaIA(false, true, { ok: false, error: "Chat no encontrado" });
  assert.equal(r.pausada, false);
  assert.match(r.aviso, /No se pudo cambiar la IA \(Chat no encontrado\)\. Sigue ACTIVA/);
});

prueba("interruptor: sin respuesta (red caida) = vuelve a como estaba y avisa", () => {
  const r = estadoTrasRespuestaIA(true, false, null);
  assert.equal(r.pausada, true);
  assert.match(r.aviso, /Sigue PAUSADA/);
});

/* ---------------- 4. Archivos: Excel/Word/HEIC y peso ---------------- */

const MB = 1024 * 1024;

prueba("Excel y Word ahora se aceptan", () => {
  const xlsx = revisarArchivoAntesDeSubir({
    name: "cotizacion.xlsx",
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size: 50_000,
  });
  assert.equal(xlsx.ok, true);
  assert.equal(revisarArchivoAntesDeSubir({ name: "a.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 1 }).ok, true);
  assert.ok(TIPOS_PERMITIDOS_CHAT.includes("application/vnd.ms-excel"));
});

prueba("Android sin tipo (.xlsx / .csv): se deduce de la extension", () => {
  const r = revisarArchivoAntesDeSubir({ name: "lista.CSV", type: "", size: 100 });
  assert.deepEqual(r, { ok: true, mime: "text/csv", aviso: null });
  const o = revisarArchivoAntesDeSubir({ name: "x.xlsx", type: "application/octet-stream", size: 100 });
  assert.equal(o.mime, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
});

prueba("foto HEIC del iPhone: aviso claro, no sube", () => {
  const r = revisarArchivoAntesDeSubir({ name: "IMG_0001.HEIC", type: "image/heic", size: 2 * MB });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /HEIC/);
  assert.equal(revisarArchivoAntesDeSubir({ name: "IMG_0002.heic", type: "", size: 1 }).ok, false);
});

prueba("zip / exe: no se puede, con texto claro", () => {
  const r = revisarArchivoAntesDeSubir({ name: "fotos.zip", type: "application/zip", size: 10 });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /no se puede enviar por aquí/);
});

prueba("mas de 100 MB: no sube y dice cuanto pesa", () => {
  const r = revisarArchivoAntesDeSubir({ name: "v.mp4", type: "video/mp4", size: 150 * MB });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /150 MB/);
});

prueba("video de mas de 16 MB: sube pero avisa; video chico sin aviso", () => {
  const grande = revisarArchivoAntesDeSubir({ name: "v.mp4", type: "video/mp4", size: 40 * MB });
  assert.equal(grande.ok, true);
  assert.match(grande.aviso, /40 MB/);
  assert.equal(revisarArchivoAntesDeSubir({ name: "v.mp4", type: "video/mp4", size: 5 * MB }).aviso, null);
});

prueba("el accept del selector no ofrece .zip ni .rar", () => {
  assert.doesNotMatch(ACCEPT_DOCUMENTOS_CHAT, /zip|rar/);
  assert.match(ACCEPT_DOCUMENTOS_CHAT, /\.xlsx/);
});

console.log(`\n${pruebas} pruebas ok`);
