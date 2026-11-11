// Pruebas de src/lib/actualizacion-automatica.ts y de que la app se actualiza sin molestar
// (orden de Alexander, 11-nov-2026: sin aviso de version nueva, sin recargar con la pestaña a la vista).
// La regla de cuando recargar se prueba aparte: src/lib/recarga-silenciosa.test.ts.
// Correr: npm run test:actualizacion-automatica
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

const A = cargar("src/lib/actualizacion-automatica.ts");
const leer = (archivo) => fs.readFileSync(archivo, "utf8").replace(/\r\n/g, "\n");

function almacenFalso() {
  const datos = new Map();
  return {
    getItem: (k) => (datos.has(k) ? datos.get(k) : null),
    setItem: (k, v) => void datos.set(k, String(v)),
    removeItem: (k) => void datos.delete(k),
    key: (i) => Array.from(datos.keys())[i] ?? null,
    get length() {
      return datos.size;
    },
  };
}

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}
async function pruebaAsync(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const T0 = 1_000_000_000;
const vacio = almacenFalso();

prueba("algo escrito: grabando, adjunto elegido o menu de adjuntar abierto; nada cuando se apagan", () => {
  assert.equal(A.hayTextoEscrito(vacio), false);
  for (const motivo of ["grabando", "adjuntar"]) {
    A.marcarOcupada(motivo, true);
    assert.equal(A.hayTextoEscrito(vacio), true, motivo);
    assert.equal(A.hayEnviosEnMemoria(), false, motivo);
    A.marcarOcupada(motivo, false);
    assert.equal(A.hayTextoEscrito(vacio), false, motivo);
  }
});

prueba("envios en memoria: texto en camino, archivo subiendo o fallido sin reintentar", () => {
  for (const motivo of ["texto", "textos-fallidos", "fotos-en-envio", "archivos-sin-salir", "enviando"]) {
    A.marcarOcupada(motivo, true, "envio");
    assert.equal(A.hayEnviosEnMemoria(), true, motivo);
    assert.equal(A.hayTextoEscrito(vacio), false, motivo);
    A.marcarOcupada(motivo, false);
    assert.equal(A.hayEnviosEnMemoria(), false, motivo);
  }
});

prueba("la caja del chat se lee en el momento, y al quitar el lector deja de contar", () => {
  let texto = "";
  const quitar = A.registrarLectorDeTexto("caja-del-chat", () => texto.trim().length > 0);
  assert.equal(A.hayTextoEscrito(vacio), false);
  texto = "hola, el precio es";
  assert.equal(A.hayTextoEscrito(vacio), true);
  texto = "   ";
  assert.equal(A.hayTextoEscrito(vacio), false);
  texto = "otra vez";
  quitar();
  assert.equal(A.hayTextoEscrito(vacio), false);
});

prueba("un lector viejo no borra al nuevo con el mismo nombre (el panel se vuelve a crear al cambiar de chat)", () => {
  const quitarViejo = A.registrarLectorDeTexto("caja-del-chat", () => false);
  const quitarNuevo = A.registrarLectorDeTexto("caja-del-chat", () => true);
  quitarViejo();
  assert.equal(A.hayTextoEscrito(vacio), true);
  quitarNuevo();
  assert.equal(A.hayTextoEscrito(vacio), false);
});

prueba("un lector que revienta cuenta como escrito (ante la duda, no recargar)", () => {
  const quitar = A.registrarLectorDeTexto("roto", () => {
    throw new Error("sin caja");
  });
  assert.equal(A.hayTextoEscrito(vacio), true);
  quitar();
});

prueba("borradores: un borrador con texto de cualquier chat cuenta como escrito", () => {
  const almacen = almacenFalso();
  almacen.setItem("otra-cosa", "x");
  assert.equal(A.hayBorradoresGuardados(almacen), false);
  A.guardarBorrador("agent:c2", "otro chat", almacen);
  assert.equal(A.hayBorradoresGuardados(almacen), true);
  assert.equal(A.hayTextoEscrito(almacen), true);
  A.borrarBorrador("agent:c2", almacen);
  assert.equal(A.hayBorradoresGuardados(almacen), false);
  assert.equal(A.hayBorradoresGuardados(null), false);
  const roto = { getItem: () => null, setItem() {}, removeItem() {}, key: () => { throw new Error("bloqueado"); }, length: 1 };
  assert.equal(A.hayBorradoresGuardados(roto), true);
});

prueba("borrador: se guarda y se lee por chat, y se borra", () => {
  const almacen = almacenFalso();
  A.guardarBorrador("agent:c1", "hola, el precio es", almacen);
  A.guardarBorrador("agent:c2", "otro chat", almacen);
  assert.equal(A.leerBorrador("agent:c1", almacen), "hola, el precio es");
  assert.equal(A.leerBorrador("agent:c2", almacen), "otro chat");
  assert.equal(A.leerBorrador("agent:c3", almacen), "");
  A.borrarBorrador("agent:c1", almacen);
  assert.equal(A.leerBorrador("agent:c1", almacen), "");
  assert.equal(A.leerBorrador("agent:c2", almacen), "otro chat");
});

prueba("borrador: guardar texto vacio lo quita", () => {
  const almacen = almacenFalso();
  A.guardarBorrador("agent:c1", "algo", almacen);
  A.guardarBorrador("agent:c1", "   ", almacen);
  assert.equal(A.leerBorrador("agent:c1", almacen), "");
});

prueba("borrador: sin almacenamiento no revienta", () => {
  assert.equal(A.leerBorrador("agent:c1", null), "");
  A.guardarBorrador("agent:c1", "x", null);
  const roto = {
    getItem: () => { throw new Error("bloqueado"); },
    setItem: () => { throw new Error("bloqueado"); },
    removeItem: () => { throw new Error("bloqueado"); },
  };
  assert.equal(A.leerBorrador("agent:c1", roto), "");
  A.guardarBorrador("agent:c1", "x", roto);
});

// ---- Revision de version con espera corta (solo para no pedir la pantalla entera) ----

const sinGuardar = () => {};

await pruebaAsync("revision: usa la de hace menos de 15 s sin preguntar", async () => {
  let preguntas = 0;
  const vieja = await A.hayVersionNuevaConEspera({
    ahora: T0 + 10_000,
    ultima: { vieja: true, en: T0 },
    consultar: async () => { preguntas += 1; return false; },
    guardar: sinGuardar,
  });
  assert.equal(vieja, true);
  assert.equal(preguntas, 0);
});

await pruebaAsync("revision: con una vieja pregunta y guarda el resultado", async () => {
  let guardada = null;
  const vieja = await A.hayVersionNuevaConEspera({
    ahora: T0 + 15_000,
    ultima: { vieja: false, en: T0 },
    consultar: async () => true,
    guardar: (r) => { guardada = r; },
  });
  assert.equal(vieja, true);
  assert.deepEqual(guardada, { vieja: true, en: T0 + 15_000 });
});

await pruebaAsync("revision: si /api/version falla o tarda mas de 1,5 s, responde false", async () => {
  const falla = await A.hayVersionNuevaConEspera({
    ahora: T0, ultima: null, consultar: async () => { throw new Error("sin red"); }, guardar: sinGuardar,
  });
  assert.equal(falla, false);
  const inicio = Date.now();
  const tarda = await A.hayVersionNuevaConEspera({
    ahora: T0, ultima: null, consultar: () => new Promise(() => {}), guardar: sinGuardar,
  });
  assert.equal(tarda, false);
  assert.ok(Date.now() - inicio < 3_000);
});

// ---- Lineas [nota-de-voz]: las que salieron bien no cuentan como falla para la vigilancia ----
// Misma regla que trabajador-tablero/lib/zonas.mjs: una linea es "falla" si trae la palabra error.
const cuentaComoFalla = (linea) => /error/i.test(linea);

prueba("[nota-de-voz] subida ok no trae la palabra error; una con error si", () => {
  const rutaSrc = fs.readFileSync("src/app/api/cliente/chats/upload-audio/route.ts", "utf8");
  const accionSrc = fs.readFileSync("src/app/actions/agent-actions.ts", "utf8");
  // La clave error solo se agrega cuando hubo falla (nunca "error": null en una linea buena).
  assert.match(rutaSrc, /\.\.\.\(respuesta\.ok \? \{\} : \{ error \}\)/);
  assert.match(accionSrc, /\.\.\.\(error === null \? \{\} : \{ error \}\)/);
  const buena = JSON.stringify({ paso: "subida", resultado: "ok", status: 200, bytes: 10, mime: "audio/webm", ms: 5, userId: "u", ...({}) });
  const mala = JSON.stringify({ paso: "subida", resultado: "error", status: 400, error: "Audio vacio" });
  assert.equal(cuentaComoFalla(buena), false);
  assert.equal(cuentaComoFalla(mala), true);
});

// ---- 11-nov-2026: sin aviso de version nueva y sin recargar con la pestaña a la vista ----

const SIN_AVISO = /versi[oó]n nueva del CRM|Hay una versi[oó]n nueva|Actualizar y enviar|Actualiza cuando termines/;

prueba("ningun aviso de version nueva en la app", () => {
  for (const archivo of [
    "src/components/app-version-guard.tsx",
    "src/components/chats/shared-inbox.tsx",
    "src/components/chats/chat-conversation-panel.tsx",
    "src/components/agents/chats-auto-refresh.tsx",
    "src/app/cliente/error.tsx",
  ]) {
    assert.doesNotMatch(leer(archivo), SIN_AVISO, archivo);
  }
});

prueba("el guardia no dibuja nada y su unica recarga pasa por debeRecargarEnSilencio", () => {
  const guard = leer("src/components/app-version-guard.tsx");
  const componente = guard.slice(guard.indexOf("export function AppVersionGuard()"));
  assert.doesNotMatch(componente, /<div|<Button|toast/);
  assert.match(componente, /return null;\s*\}\s*$/);
  assert.equal((guard.match(/location\.reload/g) ?? []).length, 1);
  // La recarga esta despues de volver a mirar todo con la regla pura, y solo con la pestaña oculta.
  assert.match(
    componente,
    /if \(cancelado \|\| !debeRecargarEnSilencio\(estadoAhora\(\{ hayVersionNueva: true, enCola, version \}\)\)\) \{\s*return;\s*\}\s*anotarRecargaPor\(version\);\s*window\.location\.reload\(\);/,
  );
  assert.match(componente, /visible: document\.visibilityState !== "hidden"/);
  assert.match(guard, /from "@\/lib\/recarga-silenciosa"/);
});

prueba("los envios no miran la version: sin pendiente, sin reenvio por version, sin pedir revision", () => {
  const inbox = leer("src/components/chats/shared-inbox.tsx");
  const panel = leer("src/components/chats/chat-conversation-panel.tsx");
  for (const [archivo, texto] of [["shared-inbox", inbox], ["panel", panel]]) {
    assert.doesNotMatch(texto, /hayVersionNueva|guardarEnvioPendiente|tomarEnvioPendiente|pedirRevisionDeVersion|marcarEscritura/, archivo);
  }
  // Lo que se perderia al recargar cuenta como envio pendiente.
  assert.match(inbox, /marcarOcupada\("texto", chatsConTextoEnCurso\.length > 0, "envio"\)/);
  assert.match(inbox, /marcarOcupada\("textos-fallidos", mensajesFallidos\.length > 0, "envio"\)/);
  assert.match(panel, /registrarLectorDeTexto\("caja-del-chat"/);
  assert.match(panel, /marcarOcupada\("archivos-sin-salir", hayArchivosSinSalir, "envio"\)/);
});

prueba("la pantalla de error no recarga sola; solo con su boton, y sin hablar de version", () => {
  const error = leer("src/app/cliente/error.tsx");
  const efecto = error.slice(error.indexOf("useEffect("), error.indexOf("const reintentar"));
  assert.doesNotMatch(efecto, /location\.reload/);
  assert.doesNotMatch(error, /sessionStorage/);
  assert.match(error, /const reintentar = \(\) => \{[\s\S]*location\.reload/);
});

prueba("los refrescos automaticos de la bandeja pasan por refrescarSinRecargar (sin aviso)", () => {
  const auto = leer("src/components/agents/chats-auto-refresh.tsx");
  const refrescos = auto.match(/router\.refresh\(\)/g) ?? [];
  // P5 (T1): tres pasan por ponerseAlDiaORecargarRef, que tambien termina en refrescarSinRecargar (ver abajo).
  const envueltos =
    auto.match(/(?:refrescarSinRecargar|ponerseAlDiaORecargarRef\.current)\(\(\) =>\s*startTransition\(\(\) => \{\s*router\.refresh\(\);/g) ?? [];
  // Los comentarios del archivo nombran router.refresh() sin llamarlo: se cuentan solo las llamadas reales.
  const llamadas = auto.split("\n").filter((linea) => /^\s*router\.refresh\(\);/.test(linea)).length;
  assert.ok(refrescos.length >= llamadas);
  assert.equal(llamadas, 5, "los cinco refrescos automaticos de siempre");
  assert.equal(envueltos.length, llamadas, "ninguno se salta la revision de version");
  assert.match(auto, /function refrescarSinRecargar[\s\S]*?hayVersionNuevaReciente\(\)[\s\S]*?if \(!nueva\) \{\s*refrescar\(\);/);
  assert.doesNotMatch(auto, /pedirRevisionDeVersion/);
  assert.match(auto, /function ponerseAlDiaSinRecargar\([\s\S]*?if \(!atendido\) \{\s*refrescarSinRecargar\(recargar\);/);
  assert.match(auto, /const ponerseAlDiaORecargar = [\s\S]*?ponerseAlDiaSinRecargar\(recargar\);[\s\S]*?refrescarSinRecargar\(recargar\);/);
});

console.log(`\n${pruebas} pruebas OK`);
