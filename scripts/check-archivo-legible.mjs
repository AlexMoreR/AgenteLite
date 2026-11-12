// Pruebas de la comprobacion de archivo legible (src/components/chats/archivo-legible.ts) y candados
// sobre la cola de envios (notas de voz desde el iPhone, 11-nov-2026).
//
// Alex no podia mandar notas de voz desde el iPhone: "No se pudo subir el audio. No se recibió ningún
// archivo." y Reintentar fallaba igual. Se prueba que un archivo que no se puede leer se detecte, que
// el guardado en el navegador sean bytes (no el Blob que Safari pierde), que la nota suba como File con
// nombre y tipo, y que el microfono ocupado avise en vez de encolar.
// Sin red, sin base y sin navegador: las reglas son puras y lo demas se lee del codigo fuente.
// Correr: node scripts/check-archivo-legible.mjs
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

const leer = (relativo) => fs.readFileSync(path.resolve(relativo), "utf8").replace(/\r\n/g, "\n");
/** El cuerpo de una funcion: desde su firma hasta la siguiente funcion de primer nivel. */
function cuerpoDe(texto, firma) {
  const inicio = texto.indexOf(firma);
  assert.notEqual(inicio, -1, `no se encontro ${firma}`);
  const resto = texto.slice(inicio + firma.length);
  const fin = resto.search(/\n(export )?(async )?function |\nconst [A-Za-z_]+ = /);
  return fin === -1 ? resto : resto.slice(0, fin);
}

const A = cargar("src/components/chats/archivo-legible.ts");

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

await prueba("un archivo con bytes se lee entero", async () => {
  const lectura = await A.leerArchivoEntero(new File([new Uint8Array(3000)], "nota.m4a", { type: "audio/mp4" }));
  assert.equal(lectura.ok, true);
  assert.equal(lectura.bytes.byteLength, 3000);
  const blobSinNombre = await A.leerArchivoEntero(new Blob([new Uint8Array(10)]));
  assert.equal(blobSinNombre.ok, true);
});

await prueba("no legible: nada, texto, vacio, o uno que dice pesar y no se deja leer (Safari)", async () => {
  assert.deepStrictEqual(await A.leerArchivoEntero(null), { ok: false, motivo: "no-es-archivo" });
  assert.deepStrictEqual(await A.leerArchivoEntero(undefined), { ok: false, motivo: "no-es-archivo" });
  assert.deepStrictEqual(await A.leerArchivoEntero("audio"), { ok: false, motivo: "no-es-archivo" });
  assert.deepStrictEqual(await A.leerArchivoEntero({}), { ok: false, motivo: "no-es-archivo" });
  assert.deepStrictEqual(await A.leerArchivoEntero(new Blob([])), { ok: false, motivo: "vacio" });
  // Lo que hace Safari tras recargar: size > 0 y arrayBuffer() falla.
  const roto = { size: 320_000, type: "audio/mp4", arrayBuffer: () => Promise.reject(new DOMException("x", "NotReadableError")) };
  assert.deepStrictEqual(await A.leerArchivoEntero(roto), { ok: false, motivo: "no-se-pudo-leer" });
  // O devuelve menos (o nada) de lo que dice pesar.
  const corto = { size: 320_000, type: "audio/mp4", arrayBuffer: async () => new ArrayBuffer(0) };
  assert.deepStrictEqual(await A.leerArchivoEntero(corto), { ok: false, motivo: "no-se-pudo-leer" });
  const aMedias = { size: 320_000, type: "audio/mp4", arrayBuffer: async () => new ArrayBuffer(1000) };
  assert.deepStrictEqual(await A.leerArchivoEntero(aMedias), { ok: false, motivo: "no-se-pudo-leer" });
});

await prueba("los motivos: nota -> grábala de nuevo; foto/archivo -> vuelve a elegirlo", () => {
  assert.equal(A.motivoDeArchivoPerdido("AUDIO", true), "Esta nota se perdió al recargar la app; grábala de nuevo.");
  for (const tipo of ["IMAGE", "VIDEO", "DOCUMENT"]) {
    assert.match(A.motivoDeArchivoPerdido(tipo, true), /se perdió al recargar la app; vuelve a elegirlo/);
    assert.match(A.motivoDeArchivoPerdido(tipo, false), /vuelve a elegirlo/);
  }
  assert.match(A.motivoDeArchivoPerdido("AUDIO", false), /grábala de nuevo/);
});

await prueba("guardado en el navegador: bytes + tipo + nombre, y vuelve el mismo File", async () => {
  const original = new File([new Uint8Array([1, 2, 3, 4])], "nota-de-voz-1.m4a", { type: "audio/mp4", lastModified: 1234 });
  const lectura = await A.leerArchivoEntero(original);
  const guardado = A.comoArchivoGuardado(lectura.bytes, { tipo: original.type, nombre: original.name, modificadoEn: original.lastModified });
  assert.equal(A.esArchivoGuardado(guardado), true);
  // Lo que se guarda es clonable y no es un Blob.
  const clon = structuredClone(guardado);
  assert.equal(clon instanceof Blob, false);
  assert.equal(A.esArchivoGuardado(clon), true);
  const devuelta = A.archivoDesdeGuardado(clon, "archivo");
  assert.equal(devuelta.name, "nota-de-voz-1.m4a");
  assert.equal(devuelta.type, "audio/mp4");
  assert.equal(devuelta.lastModified, 1234);
  assert.deepStrictEqual([...new Uint8Array(await devuelta.arrayBuffer())], [1, 2, 3, 4]);
  // Sin nombre: va el de respaldo.
  assert.equal(A.archivoDesdeGuardado(A.comoArchivoGuardado(lectura.bytes, { tipo: "", nombre: "" }), "foto.jpg").name, "foto.jpg");
  // Un Blob viejo o cualquier otra cosa no se toma por guardado nuevo.
  assert.equal(A.esArchivoGuardado(new Blob([new Uint8Array(4)])), false);
  assert.equal(A.esArchivoGuardado(null), false);
  assert.equal(A.esArchivoGuardado({ formato: 2, bytes: new ArrayBuffer(1), tipo: "", nombre: "" }), false);
});

await prueba("la nota de voz va con nombre y tipo que acepta la subida (m4a / audio/mp4 en iOS)", () => {
  assert.deepStrictEqual(A.tipoDeNotaDeVoz("audio/mp4", true), { tipo: "audio/mp4", extension: "m4a" });
  assert.deepStrictEqual(A.tipoDeNotaDeVoz("audio/mp4;codecs=mp4a.40.2", true), { tipo: "audio/mp4", extension: "m4a" });
  assert.deepStrictEqual(A.tipoDeNotaDeVoz("video/mp4", true), { tipo: "audio/mp4", extension: "m4a" });
  assert.deepStrictEqual(A.tipoDeNotaDeVoz("", true), { tipo: "audio/mp4", extension: "m4a" });
  assert.deepStrictEqual(A.tipoDeNotaDeVoz("", false), { tipo: "audio/webm", extension: "webm" });
  assert.deepStrictEqual(A.tipoDeNotaDeVoz("audio/webm;codecs=opus", false), { tipo: "audio/webm", extension: "webm" });
  assert.deepStrictEqual(A.tipoDeNotaDeVoz("audio/ogg;codecs=opus", false), { tipo: "audio/ogg", extension: "ogg" });
  // Todos los tipos que salen estan en la lista que acepta upload-audio/route.ts.
  const ruta = leer("src/app/api/cliente/chats/upload-audio/route.ts");
  const permitidos = ruta.slice(ruta.indexOf("ALLOWED_AUDIO_MIME_TYPES"), ruta.indexOf("]);"));
  for (const mime of ["audio/mp4", "video/mp4", "", "audio/webm", "audio/ogg", "audio/opus", "audio/mpeg", "audio/wav", "audio/x-raro"]) {
    for (const apple of [true, false]) {
      const { tipo } = A.tipoDeNotaDeVoz(mime, apple);
      assert.ok(permitidos.includes(`"${tipo}"`) || tipo === "audio/x-raro", `${mime} -> ${tipo} no lo acepta la subida`);
    }
  }
});

await prueba("el error del servidor sin archivo se reconoce con o sin tildes", () => {
  assert.equal(A.esFaltaDeArchivo("No se recibio ningun archivo."), true);
  assert.equal(A.esFaltaDeArchivo("No se recibió ningún archivo."), true);
  assert.equal(A.esFaltaDeArchivo("Formato de audio no permitido"), false);
  assert.equal(A.esFaltaDeArchivo(undefined), false);
  assert.match(leer("src/app/api/cliente/chats/upload-audio/route.ts"), /No se recibio ningun archivo\./);
});

await prueba("microfono: sin permiso es otro aviso; ocupado o cualquier otra falla, el de la llamada", () => {
  assert.equal(A.mensajeDeFallaDelMicrofono({ name: "NotAllowedError" }), A.MENSAJE_MICROFONO_SIN_PERMISO);
  assert.equal(A.mensajeDeFallaDelMicrofono({ name: "NotReadableError" }), A.MENSAJE_MICROFONO_OCUPADO);
  assert.equal(A.mensajeDeFallaDelMicrofono({ name: "AbortError" }), A.MENSAJE_MICROFONO_OCUPADO);
  assert.equal(A.mensajeDeFallaDelMicrofono(null), A.MENSAJE_MICROFONO_OCUPADO);
  assert.equal(A.MENSAJE_MICROFONO_OCUPADO, "El micrófono está en uso (¿llamada en curso?). Corta la llamada o vuelve a intentar.");
});

await prueba("archivo-legible.ts no importa nada (se prueba con Node solo)", () => {
  assert.doesNotMatch(leer("src/components/chats/archivo-legible.ts"), /^\s*import\b/m);
});

// --- Candados sobre el guardado, la cola y el panel ---

await prueba("el navegador guarda bytes, los relee y no borra en silencio un envio sin archivo", () => {
  const guardados = leer("src/components/chats/envios-guardados.ts");
  const guardar = cuerpoDe(guardados, "export async function guardarArchivo(");
  assert.match(guardar, /leerArchivoEntero\(archivo\)/);
  assert.match(guardar, /comoArchivoGuardado\(lectura\.bytes/);
  assert.match(guardar, /put\(guardado, id\)/);
  assert.doesNotMatch(guardar, /put\(archivo, id\)/, "volvio a guardar el Blob");
  assert.match(guardar, /leerUno\(base, id\)/, "ya no lee de vuelta lo guardado");
  const leerTodos = cuerpoDe(guardados, "export async function leerEnviosGuardados(");
  assert.match(leerTodos, /archivoDesdeGuardado\(/);
  assert.match(leerTodos, /valor instanceof Blob/, "los guardados viejos (Blob) ya no se leen");
  assert.doesNotMatch(leerTodos, /borrarEnvio\(/, "un envio sin archivo vuelve a borrarse callado");
});

await prueba("al retomar: sin subir y sin archivo legible, en rojo con 'se perdió' y sin retomarse", () => {
  const cola = leer("src/components/chats/fotos-en-envio.ts");
  const reanudar = cuerpoDe(cola, "export async function reanudarEnviosGuardados(");
  assert.match(reanudar, /if \(!guardado\.subida\) \{\n\s*const lectura = await leerArchivoEntero\(guardado\.archivo\)/);
  assert.match(reanudar, /!archivoPerdido && puedeRetomarseSolo\(/);
  assert.match(reanudar, /motivoDeArchivoPerdido\(guardado\.tipo, true\)/);
  assert.match(reanudar, /retomada: true,\n\s*archivoPerdido,/);
  const decidir = cuerpoDe(cola, "export function decidirReintento(");
  assert.match(decidir, /foto\.archivoPerdido \? "nada" : "subir-y-enviar"/);
});

await prueba("el panel lee el archivo antes de subir, sube un File con nombre y quita Reintentar al perdido", () => {
  const panel = leer("src/components/chats/chat-conversation-panel.tsx");
  const enviar = panel.slice(panel.indexOf("const enviarFoto = useCallback("), panel.indexOf("const enviarFotoRef = useRef("));
  const lectura = enviar.indexOf("await leerArchivoEntero(inicial.archivo)");
  assert.notEqual(lectura, -1, "enviarFoto ya no comprueba el archivo");
  assert.ok(lectura < enviar.indexOf("subirArchivoEnEnvio("), "la comprobacion tiene que ir antes de subir");
  assert.match(enviar, /actualizarFoto\(id, \{ archivoPerdido: true \}\)/);
  assert.match(enviar, /motivoDeArchivoPerdido\(inicial\.tipo, Boolean\(inicial\.retomada\)\)/);
  assert.match(enviar, /new File\(\[lectura\.bytes\], `nota-de-voz-/);

  const subir = cuerpoDe(panel, "async function subirArchivoEnEnvio(");
  assert.match(subir, /if \(!\(archivo\.size > 0\)\)/);
  assert.match(subir, /formData\.append\("file", archivo, archivo\.name \|\| "nota\.m4a"\)/);
  assert.doesNotMatch(subir, /formData\.append\("file", archivo\);/, "volvio el Blob sin nombre");
  assert.match(subir, /esFaltaDeArchivo\(data\?\.error\)/);

  assert.match(panel, /onReintentarFoto=\{fotosPorId\.get\(message\.id\)\?\.archivoPerdido \? undefined : reintentarFoto\}/);
  assert.match(panel, /tipoDeNotaDeVoz\(mimeType, esEquipoApple\(\)\)/);
});

await prueba("microfono ocupado: falla al empezar, 0 bytes o la pista se corta -> aviso, no se encola", () => {
  const panel = leer("src/components/chats/chat-conversation-panel.tsx");
  const grabar = panel.slice(panel.indexOf("const startAudioRecording = useCallback("), panel.indexOf("const stopAndSendAudio = useCallback("));
  assert.match(grabar, /toast\.error\(mensajeDeFallaDelMicrofono\(error\)/);
  const vacio = grabar.indexOf("if (chunks.length === 0 || grabado.size === 0) {");
  assert.notEqual(vacio, -1);
  assert.ok(grabar.indexOf("MENSAJE_MICROFONO_OCUPADO", vacio) > vacio);
  assert.ok(vacio < grabar.indexOf("void uploadAndSendAudio("), "el aviso tiene que ir antes de encolar");
  assert.match(grabar, /pista\.addEventListener\("ended", cortarPorMicrofono\)/);
  assert.match(grabar, /recorder\.onerror = cortarPorMicrofono/);
});

await prueba("el servidor deja una linea con content-type, bytes y navegador cuando no llega el archivo", () => {
  const ruta = leer("src/app/api/cliente/chats/upload-audio/route.ts");
  const subir = cuerpoDe(ruta, "async function subirAudio(");
  const sinArchivo = subir.slice(subir.indexOf("if (!(file instanceof File)) {"));
  assert.match(sinArchivo, /console\.error\(/);
  for (const campo of ["contentType", "bytesDelCuerpo", "navegador", "fallaDelFormulario"]) {
    assert.ok(sinArchivo.includes(campo), `falta ${campo} en la linea del servidor`);
  }
  assert.ok(sinArchivo.indexOf("console.error(") < sinArchivo.indexOf("No se recibio ningun archivo"));
});

await prueba("que no se manda nada: esta prueba no importa Prisma, gateways ni acciones", () => {
  const yo = leer("scripts/check-archivo-legible.mjs");
  for (const [, modulo] of yo.matchAll(/^\s*import[\s\S]*?from\s+"([^"]+)"/gm)) {
    assert.doesNotMatch(modulo, /prisma|evolution|waha|official-api|gateway|actions|^@\//i, modulo);
  }
});

console.log(`\n${pruebas} pruebas ok`);
