// Pruebas del Cerebro (src/features/cerebro, src/lib/mcp/cerebro.ts): la regla "gana el Drive", el candado de
// cerebro_escribir (palabras del dueño, cuenta dueña y versión sin cambios), "Pasar al cerebro" (solo la
// conclusión, con fecha y link), quién ve la pestaña, el cifrado del permiso de Google y que NO exista ninguna
// llamada de borrar en el Drive. Con un Drive y una base falsos: no necesita red ni base.
// Correr: npm run test:cerebro
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

const reglas = cargar("src/features/cerebro/services/reglas.ts");
const cifrado = cargar("src/features/cerebro/services/cifrado.ts");
const { sincronizarConAlmacen } = cargar("src/features/cerebro/services/sincronizar.ts");
const { crearClienteDeDrive } = cargar("src/features/cerebro/services/drive.ts");
const trabajo = cargar("src/features/tableros-inteligentes/services/reglas-trabajador.ts");
const { textoDelPaso } = cargar("src/features/cerebro/services/textos.ts");
const nada = {};
const { escribirConDependencias, problemaDeAutorizacion } = cargar("src/features/cerebro/services/escribir.ts", {
  "@/lib/prisma": nada,
  "@/features/tableros-inteligentes/services/tableros": nada,
  "./conexion": nada,
  "./permisos": nada,
});

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const archivo = (id, nombre, extra = {}) => ({
  driveId: id,
  padreId: "raiz",
  nombre,
  ruta: nombre,
  tipo: "text/markdown",
  esCarpeta: false,
  modificadoEnDrive: "2026-10-20T10:00:00.000Z",
  versionDrive: "1",
  linkDrive: `https://drive.google.com/${id}`,
  ...extra,
});
const copia = (a, extra = {}) => ({
  driveId: a.driveId,
  nombre: a.nombre,
  ruta: a.ruta,
  padreId: a.padreId,
  versionDrive: a.versionDrive,
  modificadoEnDrive: a.modificadoEnDrive,
  enDrive: true,
  tieneTexto: true,
  ...extra,
});

/* ── Qué se lee y quién ve ── */

await prueba("se leen Google Docs, .md y .txt; PDF e imágenes solo por nombre; solo .md/.txt se escriben", () => {
  assert.equal(reglas.tipoDeLectura("Precios", "application/vnd.google-apps.document"), "documento");
  assert.equal(reglas.tipoDeLectura("reglas.md", "application/octet-stream"), "texto");
  assert.equal(reglas.tipoDeLectura("nota", "text/plain"), "texto");
  assert.equal(reglas.tipoDeLectura("catalogo.pdf", "application/pdf"), "otro");
  assert.equal(reglas.tipoDeLectura("foto.png", "image/png"), "otro");
  assert.equal(reglas.sePuedeEscribir("Precios", "application/vnd.google-apps.document"), false);
  assert.equal(reglas.sePuedeEscribir("reglas.md", "text/markdown"), true);
  assert.equal(reglas.recortarTexto("a".repeat(10), 4).truncado, true);
});

await prueba("la pestaña la ve el dueño y quien él autorizó; administrar es solo del dueño", () => {
  const dueno = { userId: "u1", isOwner: true, membershipRole: "OWNER" };
  const asesora = { userId: "u2", isOwner: false, membershipRole: "AGENT" };
  const admin = { userId: "u3", isOwner: false, membershipRole: "ADMIN" };
  assert.equal(reglas.puedeVerElCerebro(dueno, []), true);
  assert.equal(reglas.puedeVerElCerebro(asesora, []), false);
  assert.equal(reglas.puedeVerElCerebro(asesora, ["u2"]), true);
  assert.equal(reglas.puedeVerElCerebro(admin, []), false, "un administrador no la ve si el dueño no lo autorizó");
  assert.equal(reglas.puedeAdministrarElCerebro(asesora), false);
  assert.equal(reglas.puedeAdministrarElCerebro(dueno), true);
  assert.deepEqual(reglas.autorizadosDeEntrada('["u2","u2","u5"]'), ["u2", "u5"]);
  assert.deepEqual(reglas.autorizadosDeEntrada("no es json"), []);
});

/* ── Gana el Drive ── */

await prueba("el plan: nuevo, cambiado, movido, ausente y sin cambio", () => {
  const a = archivo("a", "a.md");
  const b = archivo("b", "b.md");
  const c = archivo("c", "c.md");
  const d = archivo("d", "d.md");
  const plan = reglas.planificarSincronizacion(
    [archivo("a", "a.md"), archivo("b", "b.md", { versionDrive: "2" }), archivo("d", "d-nuevo.md", { ruta: "d-nuevo.md" }), archivo("e", "e.md")],
    [copia(a), copia(b), copia(c), copia(d)],
  );
  assert.deepEqual(plan.nuevos.map((x) => x.driveId), ["e"]);
  assert.deepEqual(plan.cambiados.map((x) => x.driveId), ["b"]);
  assert.deepEqual(plan.movidos.map((x) => x.driveId), ["d"]);
  assert.deepEqual(plan.ausentes, ["c"]);
  assert.equal(plan.igualesSinCambio, 1);
  // Lo que había desaparecido y vuelve, se reemplaza con lo del Drive.
  const vuelve = reglas.planificarSincronizacion([archivo("c", "c.md")], [copia(c, { enDrive: false })]);
  assert.deepEqual(vuelve.cambiados.map((x) => x.driveId), ["c"]);
});

function almacenFalso(filasIniciales = []) {
  const filas = new Map(filasIniciales.map((f) => [f.driveId, { ...f }]));
  const anotaciones = [];
  return {
    filas,
    anotaciones,
    async copia() {
      return [...filas.values()].map((f) => ({
        driveId: f.driveId,
        nombre: f.nombre,
        ruta: f.ruta,
        padreId: f.padreId,
        versionDrive: f.versionDrive,
        modificadoEnDrive: f.modificadoEnDrive,
        enDrive: f.enDrive,
        tieneTexto: f.texto !== null && f.texto !== undefined,
      }));
    },
    async guardar(_ws, a, texto) {
      const previo = filas.get(a.driveId) ?? {};
      filas.set(a.driveId, { ...previo, ...a, enDrive: true, ...(texto ? { texto: texto.texto } : {}) });
    },
    async marcarAusentes(_ws, ids) {
      for (const id of ids) filas.get(id).enDrive = false;
    },
    async anotarSincronizacion(_ws, resultado) {
      anotaciones.push(resultado);
    },
  };
}

function driveFalso({ archivos, textos = {}, truncado = false, fallaLaCarpeta = false, fallanLosTextos = [] }) {
  const llamadas = [];
  return {
    llamadas,
    async metadatos(id) {
      llamadas.push(["metadatos", id]);
      if (fallaLaCarpeta) throw new Error("Drive respondió 404");
      return { driveId: id, nombre: "Empresa Magilus" };
    },
    async recorrer() {
      return { archivos, truncado };
    },
    async leerTexto(id) {
      llamadas.push(["leerTexto", id]);
      if (fallanLosTextos.includes(id)) throw new Error("Drive respondió 500");
      return textos[id] ?? "";
    },
  };
}

await prueba("gana el Drive: lo cambiado se reemplaza, lo borrado allá se marca y nunca se borra de la copia", async () => {
  const almacen = almacenFalso([
    { ...archivo("a", "a.md"), texto: "viejo A", enDrive: true },
    { ...archivo("b", "b.md"), texto: "texto B", enDrive: true },
  ]);
  // En el Drive: a cambió de contenido (versión 2), b ya no está, c es nuevo.
  const drive = driveFalso({
    archivos: [archivo("a", "a.md", { versionDrive: "2" }), archivo("c", "c.md")],
    textos: { a: "NUEVO A del Drive", c: "texto C" },
  });
  const resultado = await sincronizarConAlmacen({ workspaceId: "ws", carpetaId: "raiz", drive, almacen });
  assert.equal(resultado.ok, true);
  assert.equal(almacen.filas.get("a").texto, "NUEVO A del Drive");
  assert.equal(almacen.filas.get("c").texto, "texto C");
  assert.equal(almacen.filas.get("b").enDrive, false, "b se marca 'ya no está en Drive'");
  assert.equal(almacen.filas.get("b").texto, "texto B", "pero su última copia se conserva");
  assert.equal(almacen.filas.has("b"), true, "la fila no se borra");
  assert.equal(almacen.anotaciones.at(-1).ok, true);
  assert.deepEqual([resultado.nuevos, resultado.cambiados, resultado.ausentes], [1, 1, 1]);
  // La sincronización solo lee del Drive.
  assert.ok(drive.llamadas.every(([que]) => que === "metadatos" || que === "leerTexto"));
});

await prueba("si el Drive falla (carpeta perdida o permiso), la copia queda como estaba y se anota el error", async () => {
  const almacen = almacenFalso([{ ...archivo("a", "a.md"), texto: "A", enDrive: true }]);
  const resultado = await sincronizarConAlmacen({ workspaceId: "ws", carpetaId: "raiz", drive: driveFalso({ archivos: [], fallaLaCarpeta: true }), almacen });
  assert.equal(resultado.ok, false);
  assert.equal(almacen.filas.get("a").enDrive, true);
  assert.equal(almacen.anotaciones.at(-1).ok, false);
});

await prueba("un recorrido cortado por el tope no marca nada como ausente; un documento que no se baja no tumba el resto", async () => {
  const almacen = almacenFalso([{ ...archivo("z", "z.md"), texto: "Z", enDrive: true }]);
  const drive = driveFalso({ archivos: [archivo("x", "x.md"), archivo("y", "y.md")], textos: { y: "Y" }, truncado: true, fallanLosTextos: ["x"] });
  const resultado = await sincronizarConAlmacen({ workspaceId: "ws", carpetaId: "raiz", drive, almacen });
  assert.equal(resultado.ok, true);
  assert.equal(almacen.filas.get("z").enDrive, true, "recorrido incompleto: no se declara ausente");
  assert.equal(resultado.noSePudoLeer.length, 1);
  assert.equal(almacen.filas.get("y").texto, "Y");
  assert.equal(almacen.filas.has("x"), false, "x se reintenta en la próxima");
});

/* ── Candado de cerebro_escribir ── */

await prueba("el texto de confirmación: pide 'sí' y escribir; 'no', preguntas y textos cortos no valen", () => {
  const v = trabajo.textoDeConfirmacionParaCerebro;
  assert.equal(v("sí, escríbelo en el cerebro"), null);
  assert.equal(v("Si, guardalo en el cerebro por favor"), null);
  assert.notEqual(v("no lo escribas en el cerebro"), null);
  assert.notEqual(v("sí no lo escribas"), null);
  assert.notEqual(v("¿sí lo escribo en el cerebro?"), null);
  assert.notEqual(v("sí"), null);
  assert.notEqual(v("escríbelo en el cerebro"), null, "sin la palabra sí no vale");
  assert.notEqual(v(undefined), null);
});

await prueba("por el MCP: crear y agregar no piden frase; reemplazar sí; una clave que no es del dueño NO escribe", () => {
  const base = { origen: "MCP", motivoCuentaNoDueno: null, autorizadaParaElCerebro: false };
  for (const modo of ["crear", "agregar"]) {
    assert.equal(problemaDeAutorizacion({ ...base, modo, textoConfirmacion: undefined }), null, `${modo} sin frase con la cuenta dueña escribe`);
    assert.match(
      problemaDeAutorizacion({ ...base, modo, motivoCuentaNoDueno: "La conexión llegó con la cuenta Ana: es CLIENTE" }),
      /Ana/,
    );
  }
  assert.ok(problemaDeAutorizacion({ ...base, modo: "reemplazar", textoConfirmacion: undefined }));
  assert.ok(problemaDeAutorizacion({ ...base, modo: "reemplazar", textoConfirmacion: "no lo escribas en el cerebro" }));
  assert.equal(problemaDeAutorizacion({ ...base, modo: "reemplazar", textoConfirmacion: "sí, escríbelo en el cerebro" }), null);
  assert.match(
    problemaDeAutorizacion({ ...base, modo: "reemplazar", textoConfirmacion: "sí, escríbelo en el cerebro", motivoCuentaNoDueno: "La conexión llegó con la cuenta Ana: es CLIENTE" }),
    /Ana/,
  );
  // Desde la pantalla o el tablero: el dueño o quien él autorizó, sin texto.
  assert.equal(problemaDeAutorizacion({ origen: "TABLERO", modo: "agregar", motivoCuentaNoDueno: "x", autorizadaParaElCerebro: true }), null);
  assert.ok(problemaDeAutorizacion({ origen: "PANTALLA", modo: "agregar", motivoCuentaNoDueno: null, autorizadaParaElCerebro: false }));
});

await prueba("Decisiones de Magilus: el servidor pone la fecha si falta, no la repite y no toca otros documentos", () => {
  const ahora = new Date("2026-10-26T20:00:00-05:00");
  assert.equal(reglas.NOMBRE_DECISIONES, "Decisiones de Magilus");
  assert.equal(reglas.conFechaDeDecision("Decisiones de Magilus.md", "Se quita la frase.", ahora), "### 2026-10-26\nSe quita la frase.");
  assert.equal(reglas.conFechaDeDecision("decisiones de magilus", "Se quita la frase.", ahora), "### 2026-10-26\nSe quita la frase.");
  assert.equal(reglas.conFechaDeDecision("Decisiones de Magilus.md", "### 2026-10-20\nOtra", ahora), "### 2026-10-20\nOtra");
  assert.equal(reglas.conFechaDeDecision("Decisiones de Magilus.md", "2026-10-20: otra", ahora), "2026-10-20: otra");
  assert.equal(reglas.conFechaDeDecision("politica.md", "Texto", ahora), "Texto");
});

function depsFalsas({ enDrive, copiaDe, carpetas = {}, hermanos = [] }) {
  const llamadas = { reemplazos: [], creados: [], registros: [], copias: [] };
  const deps = {
    carpetaRaizId: "raiz",
    drive: {
      async metadatos() {
        return enDrive;
      },
      async leerTexto() {
        return "# Política\nTexto actual";
      },
      async reemplazarTexto(id, contenido, tipo) {
        llamadas.reemplazos.push({ id, contenido, tipo });
        return { driveId: id, nombre: "politica.md", tipo, versionDrive: "8", modificadoEnDrive: "2026-10-26T00:00:00Z", linkDrive: "https://d/x", padreId: "raiz" };
      },
      async crearTexto(carpetaId, nombre, contenido) {
        llamadas.creados.push({ carpetaId, nombre, contenido });
        return { driveId: "nuevo1", nombre, tipo: "text/markdown", versionDrive: "1", modificadoEnDrive: "2026-10-26T00:00:00Z", linkDrive: "https://d/n", padreId: carpetaId };
      },
    },
    async copiaDe() {
      return copiaDe;
    },
    async hermanoConNombre(_carpeta, nombre) {
      return hermanos.includes(nombre);
    },
    async carpetaDelCerebro(id) {
      return carpetas[id] ?? null;
    },
    async guardarCopia(d) {
      llamadas.copias.push(d);
    },
    async registrar(c) {
      llamadas.registros.push(c);
    },
  };
  return { deps, llamadas };
}
const docPolitica = { driveId: "doc1", nombre: "politica.md", ruta: "Reglas/politica.md", tipo: "text/markdown", esCarpeta: false, enDrive: true, versionDrive: "7" };
const pedidoBase = { workspaceId: "ws", userId: "u1", origen: "MCP", modo: "agregar", driveId: "doc1", contenido: "## Decisión\nSe suspende la contraentrega." };

await prueba("si el documento cambió en el Drive desde que se leyó, NO se escribe", async () => {
  const { deps, llamadas } = depsFalsas({ enDrive: { versionDrive: "9", padreId: "raiz" }, copiaDe: docPolitica });
  await assert.rejects(() => escribirConDependencias({ ...pedidoBase, versionLeida: "7" }, deps), /cambió en el Drive/);
  assert.equal(llamadas.reemplazos.length, 0);
  assert.equal(llamadas.registros.length, 0);
  // Y sin saber qué versión se leyó, tampoco.
  const sinVersion = depsFalsas({ enDrive: { versionDrive: "7", padreId: "raiz" }, copiaDe: { ...docPolitica, versionDrive: null } });
  await assert.rejects(() => escribirConDependencias({ ...pedidoBase }, sinVersion.deps), /qué versión/);
});

await prueba("agregar: escribe al final, deja el registro con el antes y el después y actualiza la copia", async () => {
  const { deps, llamadas } = depsFalsas({ enDrive: { versionDrive: "7", padreId: "raiz" }, copiaDe: docPolitica });
  const resultado = await escribirConDependencias({ ...pedidoBase, versionLeida: "7" }, deps);
  assert.equal(resultado.accion, "agregar");
  assert.equal(llamadas.reemplazos.length, 1);
  assert.ok(llamadas.reemplazos[0].contenido.startsWith("# Política\nTexto actual"), "lo anterior se conserva");
  assert.ok(llamadas.reemplazos[0].contenido.includes("Se suspende la contraentrega."));
  assert.equal(llamadas.registros.length, 1);
  assert.equal(llamadas.registros[0].antes, "# Política\nTexto actual");
  assert.ok(llamadas.registros[0].despues.includes("Se suspende la contraentrega."));
  assert.equal(llamadas.copias[0].versionDrive, "8");
});

await prueba("agregar a Decisiones de Magilus.md y crearlo dejan la decisión fechada", async () => {
  const doc = { ...docPolitica, nombre: "Decisiones de Magilus.md", ruta: "Decisiones de Magilus.md" };
  const { deps, llamadas } = depsFalsas({ enDrive: { versionDrive: "7", padreId: "raiz" }, copiaDe: doc });
  await escribirConDependencias({ ...pedidoBase, versionLeida: "7" }, deps);
  assert.match(llamadas.reemplazos[0].contenido, /### \d{4}-\d{2}-\d{2}\n## Decisión\nSe suspende la contraentrega\./);
  const nuevo = depsFalsas({ enDrive: {}, copiaDe: null });
  await escribirConDependencias({ ...pedidoBase, modo: "crear", driveId: undefined, nombre: "Decisiones de Magilus", contenido: "Primera decisión" }, nuevo.deps);
  assert.match(nuevo.llamadas.creados[0].contenido, /^### \d{4}-\d{2}-\d{2}\nPrimera decisión\n$/);
});

await prueba("un Google Doc, una carpeta o algo que ya no está en el Drive no se modifican", async () => {
  for (const doc of [
    { ...docPolitica, tipo: "application/vnd.google-apps.document", nombre: "Precios" },
    { ...docPolitica, esCarpeta: true },
    { ...docPolitica, enDrive: false },
    null,
  ]) {
    const { deps, llamadas } = depsFalsas({ enDrive: { versionDrive: "7" }, copiaDe: doc });
    await assert.rejects(() => escribirConDependencias({ ...pedidoBase, versionLeida: "7" }, deps));
    assert.equal(llamadas.reemplazos.length, 0);
  }
});

await prueba("crear: documento .md nuevo; no pisa uno existente ni crea fuera del cerebro", async () => {
  const { deps, llamadas } = depsFalsas({ enDrive: {}, copiaDe: null, carpetas: { f1: { ruta: "Decisiones" } }, hermanos: ["Ya existe.md"] });
  const resultado = await escribirConDependencias({ workspaceId: "ws", userId: "u1", origen: "MCP", modo: "crear", nombre: "Política de envíos", carpetaId: "f1", contenido: "Gratis sobre $200.000" }, deps);
  assert.equal(llamadas.creados[0].nombre, "Política de envíos.md");
  assert.equal(llamadas.creados[0].carpetaId, "f1");
  assert.equal(resultado.ruta, "Decisiones/Política de envíos.md");
  assert.equal(llamadas.registros[0].antes, null);
  await assert.rejects(() => escribirConDependencias({ workspaceId: "ws", userId: "u1", origen: "MCP", modo: "crear", nombre: "Ya existe", contenido: "x" }, deps), /Ya existe/);
  await assert.rejects(() => escribirConDependencias({ workspaceId: "ws", userId: "u1", origen: "MCP", modo: "crear", nombre: "Otro", carpetaId: "ajena", contenido: "x" }, deps), /no está dentro del cerebro/);
  await assert.rejects(() => escribirConDependencias({ workspaceId: "ws", userId: "u1", origen: "MCP", modo: "crear", nombre: "Otro", contenido: "  " }, deps), /Falta el texto/);
});

/* ── Notas nuevas que crea aizen1 (Google da 403 storageQuotaExceeded al crear con la cuenta de servicio) ── */

const notas = cargar("src/features/cerebro/services/notas-por-crear.ts", { "@/lib/prisma": nada });
const sinEspacioDeGoogle = async () =>
  new Response(JSON.stringify({ error: { code: 403, errors: [{ reason: "storageQuotaExceeded", message: "Service Accounts do not have storage quota." }] } }), { status: 403 });

await prueba("crear con un Google que da 403 storageQuotaExceeded NO falla: queda PENDIENTE para aizen1 y en el registro", async () => {
  const { deps, llamadas } = depsFalsas({ enDrive: {}, copiaDe: null, carpetas: { f1: { ruta: "Ventas" } } });
  deps.drive = { ...deps.drive, crearTexto: crearClienteDeDrive("t", sinEspacioDeGoogle).crearTexto };
  const encoladas = [];
  deps.encolarNotaNueva = async (nota) => {
    encoladas.push(nota);
    return { id: "nota1" };
  };
  const resultado = await escribirConDependencias(
    { workspaceId: "ws", userId: "u1", origen: "MCP", modo: "crear", nombre: "2026-10-26-guion", carpetaId: "f1", contenido: "Guion nuevo" },
    deps,
  );
  assert.equal(resultado.ruta, "Ventas/2026-10-26-guion.md");
  assert.deepEqual(resultado.pendiente, { id: "nota1", estado: "PENDIENTE", aviso: reglas.AVISO_NOTA_EN_AIZEN1 });
  assert.match(reglas.AVISO_NOTA_EN_AIZEN1, /aizen1 en ~1 minuto/);
  assert.deepEqual(encoladas, [{ ruta: "Ventas/2026-10-26-guion.md", contenido: "Guion nuevo\n" }]);
  assert.equal(llamadas.copias.length, 0, "no hay copia: el archivo todavía no está en el Drive");
  assert.equal(llamadas.registros.length, 1);
  assert.deepEqual(llamadas.registros[0], { driveId: "aizen1:nota1", nombreDocumento: "Ventas/2026-10-26-guion.md", accion: "crear", antes: null, despues: "Guion nuevo\n" });

  // Decisiones de Magilus en la carpeta principal: con su fecha, igual que si lo creara el Drive.
  const raiz = depsFalsas({ enDrive: {}, copiaDe: null });
  raiz.deps.drive = { ...raiz.deps.drive, crearTexto: crearClienteDeDrive("t", sinEspacioDeGoogle).crearTexto };
  let encolada = null;
  raiz.deps.encolarNotaNueva = async (nota) => ((encolada = nota), { id: "nota2" });
  await escribirConDependencias({ ...pedidoBase, modo: "crear", driveId: undefined, nombre: "Decisiones de Magilus", contenido: "Primera decisión" }, raiz.deps);
  assert.equal(encolada.ruta, "Decisiones de Magilus.md");
  assert.match(encolada.contenido, /^### \d{4}-\d{2}-\d{2}\nPrimera decisión\n$/);
});

await prueba("otros errores de Drive al crear siguen siendo error; sin dónde encolar, el 403 también", async () => {
  const otro = depsFalsas({ enDrive: {}, copiaDe: null });
  otro.deps.drive = { ...otro.deps.drive, crearTexto: crearClienteDeDrive("t", async () => new Response("nope", { status: 500 })).crearTexto };
  otro.deps.encolarNotaNueva = async () => assert.fail("no debía encolar");
  await assert.rejects(() => escribirConDependencias({ ...pedidoBase, modo: "crear", driveId: undefined, nombre: "Otra nota", contenido: "x" }, otro.deps), /Drive respondió 500/);
  const sinCola = depsFalsas({ enDrive: {}, copiaDe: null });
  sinCola.deps.drive = { ...sinCola.deps.drive, crearTexto: crearClienteDeDrive("t", sinEspacioDeGoogle).crearTexto };
  await assert.rejects(() => escribirConDependencias({ ...pedidoBase, modo: "crear", driveId: undefined, nombre: "Otra nota", contenido: "x" }, sinCola.deps), /cuenta de servicio/);
});

await prueba("ruta de la nota: solo dentro de la carpeta del cerebro y solo .md/.txt", () => {
  assert.equal(reglas.problemaDeRutaDeNota("Decisiones de Magilus.md"), null);
  assert.equal(reglas.problemaDeRutaDeNota("Ventas/2026-10-26-x.md"), null);
  for (const mala of ["../x.md", "Ventas/../../x.md", "/x.md", "C:/x.md", "a//b.md", "x.exe", "x", "a|b.md", ""]) {
    assert.ok(reglas.problemaDeRutaDeNota(mala), `debía rechazar ${JSON.stringify(mala)}`);
  }
  assert.equal(reglas.rutaDeNota("", "a.md"), "a.md");
  assert.equal(reglas.rutaDeNota("Ventas/", "a.md"), "Ventas/a.md");
});

await prueba("API del trabajador: marcar CREADA o ERROR (con motivo); repetir no falla; cambiar de final sí (409)", () => {
  assert.deepEqual(notas.marcaDeEntrada({ id: "n1", estado: "CREADA" }), { id: "n1", estado: "CREADA", motivo: null });
  assert.deepEqual(notas.marcaDeEntrada({ id: "n1", estado: "ERROR", motivo: " ruta mala " }), { id: "n1", estado: "ERROR", motivo: "ruta mala" });
  assert.throws(() => notas.marcaDeEntrada({ id: "n1", estado: "ERROR" }), /motivo/);
  assert.throws(() => notas.marcaDeEntrada({ id: "n1", estado: "PENDIENTE" }), /CREADA/);
  assert.throws(() => notas.marcaDeEntrada(null), /id/);
  assert.equal(notas.decidirMarca("PENDIENTE", "CREADA"), "cambiar");
  assert.equal(notas.decidirMarca("CREADA", "CREADA"), "igual");
  assert.throws(() => notas.decidirMarca("CREADA", "ERROR"), (e) => e.status === 409);
});

await prueba("la ruta GET/POST /api/trabajador/cerebro/notas-por-crear usa la clave del Coordinador; MCP y pantalla muestran el estado", () => {
  const ruta = fs.readFileSync(path.join(RAIZ, "src/app/api/trabajador/cerebro/notas-por-crear/route.ts"), "utf8");
  assert.match(ruta, /export async function GET/);
  assert.match(ruta, /export async function POST/);
  assert.equal((ruta.match(/if \(!contexto\) return sinClave\(\);/g) ?? []).length, 2, "las dos piden la clave");
  assert.match(ruta, /contexto\.workspaceId/);
  const mcp = fs.readFileSync(path.join(RAIZ, "src/lib/mcp/cerebro.ts"), "utf8");
  assert.match(mcp, /resultado\.pendiente/);
  assert.match(mcp, /notas_nuevas/);
  assert.equal(reglas.TEXTO_DEL_ESTADO_DE_NOTA.PENDIENTE, "pendiente de crear en aizen1");
  assert.equal(reglas.TEXTO_DEL_ESTADO_DE_NOTA.CREADA, "creada");
  const pantalla = fs.readFileSync(path.join(RAIZ, "src/features/cerebro/components/CerebroPantalla.tsx"), "utf8");
  assert.match(pantalla, /TEXTO_DEL_ESTADO_DE_NOTA/);
  const pagina = fs.readFileSync(path.join(RAIZ, "src/app/cliente/negocio/cerebro/page.tsx"), "utf8");
  assert.match(pagina, /notasRecientes/);
  const paso = fs.readFileSync(path.join(RAIZ, "src/features/tableros-inteligentes/components/PasarAlCerebro.tsx"), "utf8");
  assert.match(paso, /pendienteEnAizen1/);
});

/* ── Pasar al cerebro ── */

await prueba("Pasar al cerebro escribe SOLO la conclusión, con la fecha y el link de la tarjeta", () => {
  const link = "https://app.aizenbot.com/cliente/tablero-ia?tarjeta=t1";
  const bloque = textoDelPaso({ conclusion: "Se suspende la contraentrega.", titulo: "Decidir contraentrega", link, ahora: new Date("2026-10-26T15:00:00Z") });
  assert.match(bloque, /^## 2026-10-26 — Decidir contraentrega/);
  assert.ok(bloque.includes("Se suspende la contraentrega."));
  assert.ok(bloque.includes(link));
  const tarjeta = { estado: "HECHO", detalle: "DETALLE LARGO DE LA TARJETA que no se copia", resultado: { resumen: "Se suspende la contraentrega." } };
  assert.equal(reglas.conclusionSugerida(tarjeta), "Se suspende la contraentrega.", "la conclusión sale del resultado, no del detalle");
  assert.ok(!bloque.includes("DETALLE LARGO"));
  assert.equal(reglas.conclusionSugerida({ detalle: "Solo detalle", resultado: null }), "Solo detalle");
  assert.equal(reglas.agregarAlFinal("# Doc", "## Nuevo"), "# Doc\n\n## Nuevo\n");
});

await prueba("Pasar al cerebro se ofrece en tarjetas HECHAS o de tipo 'Decisión'", () => {
  assert.equal(reglas.sePuedePasarAlCerebro({ estado: "HECHO" }, "Tarea"), true);
  assert.equal(reglas.sePuedePasarAlCerebro({ estado: "APROBADO" }, "Tarea"), false);
  assert.equal(reglas.sePuedePasarAlCerebro({ estado: "BORRADOR" }, "Decisión"), true);
  assert.equal(reglas.sePuedePasarAlCerebro({ estado: "BORRADOR" }, "decision"), true);
  const sugerido = reglas.documentoSugerido(
    [
      { driveId: "1", nombre: "envios.md", ruta: "Reglas/envios.md", legibleParaEscribir: true },
      { driveId: "2", nombre: "precios.md", ruta: "Reglas/precios.md", legibleParaEscribir: true },
    ],
    "Cambiar precios de camillas",
  );
  assert.equal(sugerido.driveId, "2");
});

/* ── Buscar y dar contexto ── */

await prueba("la búsqueda ordena por relevancia, ignora tildes y da un fragmento", () => {
  const docs = [
    { driveId: "1", nombre: "envios.md", ruta: "Reglas/envios.md", texto: "El envío es gratis con pago 50/50." },
    { driveId: "2", nombre: "contraentrega.md", ruta: "Decisiones/contraentrega.md", texto: "Se suspendió la contraentrega desde octubre." },
    { driveId: "3", nombre: "otro.md", ruta: "otro.md", texto: "Nada que ver" },
  ];
  const r = reglas.ordenarPorRelevancia(docs, "contraentrega suspendida");
  assert.equal(r[0].driveId, "2");
  assert.ok(r[0].fragmento.includes("contraentrega"));
  assert.equal(reglas.ordenarPorRelevancia(docs, "envio gratis")[0].driveId, "1");
  assert.deepEqual(reglas.ordenarPorRelevancia(docs, "zz"), []);
  assert.equal(reglas.bloqueDelCerebroParaLaTarjeta([]), "");
  assert.match(reglas.bloqueDelCerebroParaLaTarjeta(r), /Decisiones\/contraentrega\.md/);
});

await prueba("el árbol pone las carpetas primero y cuelga cada cosa de su madre", () => {
  const filas = [
    { driveId: "d1", padreId: "raiz", nombre: "b.md", esCarpeta: false },
    { driveId: "f1", padreId: "raiz", nombre: "Reglas", esCarpeta: true },
    { driveId: "d2", padreId: "f1", nombre: "envios.md", esCarpeta: false },
  ];
  const arbol = reglas.armarArbol(filas, "raiz");
  assert.deepEqual(arbol.map((n) => n.nombre), ["Reglas", "b.md"]);
  assert.deepEqual(arbol[0].hijos.map((n) => n.nombre), ["envios.md"]);
});

/* ── Cifrado ── */

await prueba("el permiso de Google se cifra y descifra; el state firmado vence y no se puede falsificar", () => {
  const clave = cifrado.claveDeCifrado("una-clave-de-prueba-larga");
  const guardado = cifrado.cifrar("1//refresh-token-secreto", clave);
  assert.ok(!guardado.includes("refresh-token-secreto"));
  assert.equal(cifrado.descifrar(guardado, clave), "1//refresh-token-secreto");
  assert.throws(() => cifrado.descifrar(guardado, cifrado.claveDeCifrado("otra-clave-distinta-larga")));
  assert.throws(() => cifrado.claveDeCifrado(""), /CEREBRO_CLAVE_CIFRADO/);
  const estado = cifrado.firmarEstado({ workspaceId: "ws", userId: "u1" }, 1_000, clave);
  assert.deepEqual(cifrado.verificarEstado(estado, 2_000, clave), { workspaceId: "ws", userId: "u1", vence: 1_000 + 15 * 60_000 });
  assert.equal(cifrado.verificarEstado(estado, 1_000 + 16 * 60_000, clave), null, "vencido");
  assert.equal(cifrado.verificarEstado(`${estado}x`, 2_000, clave), null, "alterado");
  assert.equal(cifrado.verificarEstado(null, 2_000, clave), null);
});

/* ── El cliente de Drive: solo lee, crea y reemplaza texto ── */

await prueba("el cliente de Drive crea (POST) y reemplaza (PATCH) textos; no tiene ninguna función de borrar", async () => {
  const pedidos = [];
  const fetchFalso = async (url, init = {}) => {
    pedidos.push({ url: String(url), metodo: init.method ?? "GET" });
    return new Response(JSON.stringify({ id: "x1", name: "n.md", mimeType: "text/markdown", version: "3", parents: ["raiz"] }), { status: 200 });
  };
  const drive = crearClienteDeDrive("token", fetchFalso);
  await drive.crearTexto("raiz", "n.md", "hola");
  await drive.reemplazarTexto("x1", "chao", "text/markdown");
  assert.deepEqual(pedidos.map((p) => p.metodo), ["POST", "PATCH"]);
  await assert.rejects(() => drive.reemplazarTexto("x2", "x", "application/vnd.google-apps.document"));
  assert.deepEqual(Object.keys(drive).sort(), ["crearTexto", "leerTexto", "listarCarpetas", "metadatos", "recorrer", "reemplazarTexto"]);
});

await prueba("en el código del cerebro no existe ninguna llamada que borre, vacíe o mande a la papelera en el Drive", () => {
  const archivos = [];
  const recorrer = (carpeta) => {
    for (const entrada of fs.readdirSync(carpeta, { withFileTypes: true })) {
      const ruta = path.join(carpeta, entrada.name);
      if (entrada.isDirectory()) recorrer(ruta);
      else if (/\.(ts|tsx)$/.test(entrada.name)) archivos.push(ruta);
    }
  };
  recorrer(path.join(RAIZ, "src/features/cerebro"));
  archivos.push(path.join(RAIZ, "src/lib/mcp/cerebro.ts"), path.join(RAIZ, "src/app/actions/cerebro-actions.ts"));
  for (const carpeta of ["src/app/api/cerebro"]) recorrer(path.join(RAIZ, carpeta));
  const prohibidos = [
    /method:\s*["'`]DELETE/i,
    /files\.delete/i,
    /emptyTrash/i,
    /trashed\s*[:=]\s*true/i,
    /\/trash\b/i,
    /["'`]DELETE["'`]/,
    /\bdelete\s+from\b/i,
    /permissions\//i,
  ];
  for (const ruta of archivos) {
    const texto = fs.readFileSync(ruta, "utf8");
    for (const patron of prohibidos) assert.ok(!patron.test(texto), `${path.relative(RAIZ, ruta)} tiene algo que borra o comparte en el Drive: ${patron}`);
  }
  // Además, el almacén de la copia nunca borra filas: el Drive manda, pero lo ausente solo se marca.
  const almacen = fs.readFileSync(path.join(RAIZ, "src/features/cerebro/services/almacen.ts"), "utf8");
  assert.ok(!/\.delete(Many)?\(/.test(almacen));
});

/* ── Está enchufado donde debe ── */

await prueba("el MCP registra las 4 herramientas y cerebro_escribir ya no exige la frase para crear y agregar", () => {
  const herramientas = fs.readFileSync(path.join(RAIZ, "src/lib/mcp/herramientas.ts"), "utf8");
  assert.match(herramientas, /\.\.\.HERRAMIENTAS_MCP_CEREBRO/);
  assert.match(herramientas, /esHerramientaDelCerebro\(nombre\)/);
  const cerebro = cargar("src/lib/mcp/cerebro.ts", { "@/lib/prisma": nada, "@/features/cerebro/services/consultas": nada, "@/features/cerebro/services/escribir": nada });
  assert.deepEqual(cerebro.HERRAMIENTAS_MCP_CEREBRO.map((h) => h.name), ["cerebro_listar", "cerebro_leer", "cerebro_buscar", "cerebro_escribir"]);
  const escribir = cerebro.HERRAMIENTAS_MCP_CEREBRO.find((h) => h.name === "cerebro_escribir");
  assert.ok(!escribir.inputSchema.required.includes("texto_confirmacion"));
  assert.deepEqual(escribir.inputSchema.required, ["modo", "contenido"]);
  for (const solo of cerebro.HERRAMIENTAS_MCP_CEREBRO.filter((h) => h.name !== "cerebro_escribir")) assert.equal(solo.annotations.readOnlyHint, true);
  assert.equal(escribir.annotations.destructiveHint, false);
  const origen = fs.readFileSync(path.join(RAIZ, "src/lib/mcp/cerebro.ts"), "utf8");
  assert.match(origen, /origen: "MCP"/);
});

await prueba("la sincronización cada hora, el estado de la automatización, la pestaña y el botón están enchufados", () => {
  const cron = fs.readFileSync(path.join(RAIZ, "src/app/api/cron/follows/route.ts"), "utf8");
  assert.match(cron, /if \(minuto === 41\) \{\s+after\(async \(\) => \{\s+try \{\s+await sincronizarCerebroDeTodos\(\);/);
  const queEs = fs.readFileSync(path.join(RAIZ, "src/lib/mcp/que-es-esta-aplicacion.ts"), "utf8");
  assert.match(queEs, /cerebro_sincronizacion: await estadoDelCerebro/);
  const pestanas = fs.readFileSync(path.join(RAIZ, "src/components/negocio-equipo-tabs-lista.tsx"), "utf8");
  assert.match(pestanas, /value: "cerebro"/);
  assert.match(pestanas, /item\.value !== "cerebro" \|\| verCerebro/);
  const ficha = fs.readFileSync(path.join(RAIZ, "src/features/tableros-inteligentes/components/FichaTarjeta.tsx"), "utf8");
  assert.match(ficha, /puedeCerebro && sePuedePasarAlCerebro\(tarjeta, tipo\?\.nombre\)/);
  const tomar = fs.readFileSync(path.join(RAIZ, "src/app/api/trabajador/tablero/tomar/route.ts"), "utf8");
  assert.match(tomar, /cerebroParaLaTarjeta/);
});

await prueba("el coach suma las reglas del cerebro al prompt; sin cerebro el prompt es el de siempre", () => {
  const coach = cargar("src/features/coach/reglas.ts");
  const fichas = [];
  const sin = coach.armarPromptDelLote({ asesora: "Ana", dia: "2026-10-26", fichas });
  const con = coach.armarPromptDelLote({ asesora: "Ana", dia: "2026-10-26", fichas, reglasDelCerebro: ["Del cerebro (Reglas/precios.md): Camilla $1.200.000"] });
  assert.ok(!sin.sistema.includes("cerebro del negocio"));
  assert.ok(con.sistema.includes("Camilla $1.200.000"));
  const vacio = coach.armarPromptDelLote({ asesora: "Ana", dia: "2026-10-26", fichas, reglasDelCerebro: [] });
  assert.equal(vacio.sistema, sin.sistema);
});

/* ── Cuenta de servicio (sin "Conectar Google") ── */

const { generateKeyPairSync, createVerify } = await import("node:crypto");
const { privateKey: clavePrivada, publicKey: clavePublica } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = clavePrivada.export({ type: "pkcs8", format: "pem" });
const CORREO_SA = "finanzas@proyecto-falso.iam.gserviceaccount.com";
const ENTORNO_SA = { GOOGLE_SERVICE_ACCOUNT_EMAIL: CORREO_SA, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: PEM.replace(/\n/g, "\\n") };
const servicio = cargar("src/features/cerebro/services/cuenta-servicio.ts");

await prueba("cuenta de servicio: lee las variables (con \\n del .env), firma un JWT válido con el permiso drive", () => {
  assert.equal(servicio.datosDeCuentaDeServicio({}), null);
  assert.equal(servicio.datosDeCuentaDeServicio({ GOOGLE_SERVICE_ACCOUNT_EMAIL: CORREO_SA }), null);
  const datos = servicio.datosDeCuentaDeServicio(ENTORNO_SA);
  assert.equal(datos.correo, CORREO_SA);
  assert.ok(datos.clave.includes("\n-----END PRIVATE KEY-----"));
  const jwt = servicio.firmarJwt(datos, 1_000);
  const [cabecera, reclamos, firma] = jwt.split(".");
  const leidos = JSON.parse(Buffer.from(reclamos, "base64url").toString());
  assert.deepEqual(leidos, { iss: CORREO_SA, scope: "https://www.googleapis.com/auth/drive", aud: "https://oauth2.googleapis.com/token", iat: 1_000, exp: 4_600 });
  const verificador = createVerify("RSA-SHA256");
  verificador.update(`${cabecera}.${reclamos}`);
  assert.ok(verificador.verify(clavePublica, Buffer.from(firma, "base64url")), "la firma es de la clave");
});

await prueba("cuenta de servicio: pide el permiso a Google (jwt-bearer), lo reutiliza 55 min y avisa claro si Google lo niega", async () => {
  servicio.olvidarTokenDeCuentaDeServicio();
  const pedidos = [];
  const googleFalso = async (url, init) => {
    pedidos.push({ url, cuerpo: new URLSearchParams(init.body) });
    return new Response(JSON.stringify({ access_token: `tok-${pedidos.length}`, expires_in: 3600 }), { status: 200 });
  };
  assert.equal(await servicio.tokenDeCuentaDeServicio({ entorno: ENTORNO_SA, fetchFn: googleFalso, ahora: 0 }), "tok-1");
  assert.equal(pedidos[0].url, "https://oauth2.googleapis.com/token");
  assert.equal(pedidos[0].cuerpo.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
  assert.equal(await servicio.tokenDeCuentaDeServicio({ entorno: ENTORNO_SA, fetchFn: googleFalso, ahora: 54 * 60_000 }), "tok-1", "en memoria");
  assert.equal(await servicio.tokenDeCuentaDeServicio({ entorno: ENTORNO_SA, fetchFn: googleFalso, ahora: 56 * 60_000 }), "tok-2", "se renueva");
  servicio.olvidarTokenDeCuentaDeServicio();
  const niega = async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
  await assert.rejects(() => servicio.tokenDeCuentaDeServicio({ entorno: ENTORNO_SA, fetchFn: niega, ahora: 0 }), /no aceptó la cuenta de servicio \(invalid_grant\)/);
  await assert.rejects(() => servicio.tokenDeCuentaDeServicio({ entorno: {}, fetchFn: niega }), /Falta configurar la cuenta de servicio/);
  servicio.olvidarTokenDeCuentaDeServicio();
});

await prueba("con la cuenta de servicio las carpetas que se listan son solo las compartidas (también las de Ordenadores) y se preselecciona Magilus", async () => {
  const urls = [];
  const fetchFalso = async (url) => {
    urls.push(String(url));
    return new Response(JSON.stringify({ files: [{ id: "c1", name: "Magilus", mimeType: reglas.MIME_CARPETA }] }), { status: 200 });
  };
  const drive = crearClienteDeDrive("token", fetchFalso);
  await drive.listarCarpetas("", { soloCompartidas: true });
  const q = new URL(urls[0]).searchParams;
  assert.equal(q.get("q"), `mimeType='${reglas.MIME_CARPETA}' and trashed=false and sharedWithMe`);
  assert.equal(q.get("supportsAllDrives"), "true");
  assert.equal(q.get("includeItemsFromAllDrives"), "true");
  await drive.listarCarpetas("Mag");
  assert.equal(new URL(urls[1]).searchParams.get("q"), `mimeType='${reglas.MIME_CARPETA}' and trashed=false and name contains 'Mag'`, "OAuth: como antes");
  assert.equal(reglas.carpetaPreferida([{ id: "a", nombre: "Fotos" }, { id: "b", nombre: " magilus " }]), "b");
  assert.equal(reglas.carpetaPreferida([{ id: "a", nombre: "Fotos" }, { id: "e", nombre: "Empresa Magilus" }]), "e");
  assert.equal(reglas.carpetaPreferida([{ id: "a", nombre: "Fotos" }]), "a", "si hay una sola, esa");
  assert.equal(reglas.carpetaPreferida([{ id: "a", nombre: "Fotos" }, { id: "b", nombre: "Otra" }]), "");
  assert.equal(reglas.carpetaPreferida([]), "");
});

await prueba("Drive: si Google no deja crear con la cuenta de servicio (sin espacio propio) el error lo explica", async () => {
  const sinEspacio = async () => new Response(JSON.stringify({ error: { errors: [{ reason: "storageQuotaExceeded" }] } }), { status: 403 });
  await assert.rejects(() => crearClienteDeDrive("t", sinEspacio).crearTexto("raiz", "n.md", "x"), /no deja que la cuenta de servicio cree archivos nuevos/);
});

await prueba("conexión: con la cuenta de servicio no hacen falta OAuth ni CEREBRO_CLAVE_CIFRADO; lee, lista y escribe con su permiso", async () => {
  const VARIABLES = ["GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "CEREBRO_CLAVE_CIFRADO"];
  const antes = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]));
  const fetchOriginal = globalThis.fetch;
  const filas = new Map();
  const prismaFalso = {
    cerebroConexion: {
      findUnique: async ({ where }) => filas.get(where.workspaceId) ?? null,
      upsert: async ({ where, create }) => {
        const fila = filas.get(where.workspaceId) ?? { tokenCifrado: null, carpetaId: null, carpetaNombre: null, ultimoError: null, ...create };
        filas.set(where.workspaceId, fila);
        return fila;
      },
      update: async ({ where, data }) => Object.assign(filas.get(where.workspaceId), data),
    },
  };
  // conexion.ts ya quedó en caché con "@/lib/prisma" = nada (al cargar el MCP): se le pone la base falsa ahí.
  const conexion = cargar("src/features/cerebro/services/conexion.ts", { "@/lib/prisma": nada });
  nada.prisma = prismaFalso;
  try {
    for (const v of VARIABLES) delete process.env[v];
    assert.equal(conexion.modoDelCerebro(), null);
    assert.equal(conexion.googleConfigurado(), false);
    process.env.GOOGLE_OAUTH_CLIENT_ID = "id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secreto";
    process.env.CEREBRO_CLAVE_CIFRADO = "una-clave-de-prueba-larga";
    assert.equal(conexion.modoDelCerebro(), "oauth", "sin cuenta de servicio sigue el camino OAuth");
    assert.equal(conexion.tieneAccesoAlDrive({ tokenCifrado: null }), false);
    assert.equal(conexion.tieneAccesoAlDrive({ tokenCifrado: "x" }), true);
    await assert.rejects(() => conexion.driveDelNegocio("ws1"), /no está conectado/);

    for (const v of VARIABLES) delete process.env[v];
    Object.assign(process.env, ENTORNO_SA);
    assert.equal(conexion.modoDelCerebro(), "cuenta-servicio");
    assert.equal(conexion.googleConfigurado(), true);
    assert.equal(conexion.oauthConfigurado(), false);
    assert.equal(conexion.correoDeCuentaDeServicio(), CORREO_SA);
    assert.equal(conexion.tieneAccesoAlDrive(null), true, "no hace falta token guardado");

    servicio.olvidarTokenDeCuentaDeServicio();
    const pedidos = [];
    globalThis.fetch = async (url, init = {}) => {
      pedidos.push({ url: String(url), metodo: init.method ?? "GET", auth: init.headers?.Authorization });
      if (String(url).startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "tok-sa", expires_in: 3600 }), { status: 200 });
      if (String(url).includes("/files?q=")) return new Response(JSON.stringify({ files: [{ id: "c1", name: "Magilus", mimeType: reglas.MIME_CARPETA }] }), { status: 200 });
      if (String(url).includes("alt=media")) return new Response("hola desde Drive", { status: 200 });
      return new Response(JSON.stringify({ id: "d1", name: "nota.md", mimeType: "text/markdown", version: "2", parents: ["c1"] }), { status: 200 });
    };
    const { drive, conexion: fila, modo } = await conexion.driveDelNegocio("ws1");
    assert.equal(modo, "cuenta-servicio");
    assert.equal(fila.cuentaGoogle, CORREO_SA, "la fila se crea sola con el correo de la cuenta");
    assert.equal(fila.tokenCifrado, null, "no se guarda ningún permiso");
    assert.equal((await drive.listarCarpetas("", { soloCompartidas: true }))[0].nombre, "Magilus");
    assert.equal(await drive.leerTexto("d1", "nota.md", "text/markdown"), "hola desde Drive");
    await drive.crearTexto("c1", "nota.md", "nuevo");
    await drive.reemplazarTexto("d1", "cambiado", "text/markdown");
    const aDrive = pedidos.filter((p) => p.url.includes("googleapis.com/") && !p.url.startsWith("https://oauth2."));
    assert.ok(aDrive.length === 4 && aDrive.every((p) => p.auth === "Bearer tok-sa"), "todo con el permiso de la cuenta de servicio");
    assert.deepEqual(aDrive.map((p) => p.metodo), ["GET", "GET", "POST", "PATCH"]);
    assert.equal(pedidos.filter((p) => p.url.startsWith("https://oauth2.")).length, 1, "un solo permiso para todo");
  } finally {
    globalThis.fetch = fetchOriginal;
    for (const v of VARIABLES) {
      if (antes[v] === undefined) delete process.env[v];
      else process.env[v] = antes[v];
    }
    servicio.olvidarTokenDeCuentaDeServicio();
  }
});

await prueba("pantalla, reloj y MCP usan la cuenta de servicio (no exigen token guardado) y escribir no está bloqueado", () => {
  const leer = (ruta) => fs.readFileSync(path.join(RAIZ, ruta), "utf8");
  assert.match(leer("src/features/cerebro/services/sincronizar-negocio.ts"), /modoDelCerebro\(\) === "cuenta-servicio" \? \{ carpetaId: \{ not: null \} \}/);
  assert.match(leer("src/lib/mcp/cerebro.ts"), /tieneAccesoAlDrive\(conexion\)/);
  assert.match(leer("src/lib/mcp/que-es-esta-aplicacion.ts"), /tieneAccesoAlDrive\(conexion\)/);
  assert.match(leer("src/app/cliente/negocio/cerebro/page.tsx"), /tienePermiso=\{tieneAccesoAlDrive\(conexion\)\}/);
  assert.match(leer("src/app/actions/cerebro-actions.ts"), /soloCompartidas: modo === "cuenta-servicio"/);
  const pantalla = leer("src/features/cerebro/components/ConexionCerebro.tsx");
  assert.match(pantalla, /Conectado con la cuenta de servicio/);
  assert.match(pantalla, /carpetaPreferida\(respuesta\.carpetas\)/);
  assert.ok(!/cuenta-servicio/.test(leer("src/features/cerebro/services/escribir.ts")), "escribir no se bloquea con la cuenta de servicio");
});

await prueba("alerta CEREBRO:desconectado: IMPORTANTE, una sola, se cierra al sincronizar y no avisa por WhatsApp ni push", async () => {
  let llamoAAvisos = false;
  const alerta = cargar("src/features/cerebro/services/alerta-de-conexion.ts", {
    "@/lib/prisma": nada,
    "@/features/supervisor/servicios/almacen-alertas": nada,
  });
  const ahora = new Date("2026-10-26T15:41:00Z");
  const base = { workspaceId: "ws", carpetaId: "raiz", ultimoError: null, ultimaSincronizacion: new Date("2026-10-26T15:00:00Z"), creadoEn: new Date("2026-10-01T00:00:00Z") };
  const filas = new Map();
  let conexion = { ...base, ultimoError: "invalid_grant" };
  const deps = {
    conexiones: async () => [conexion],
    abiertos: async (ws) => [...filas.values()].filter((i) => i.estado === "ABIERTA" && ws === "ws"),
    guardar: async (_ws, incidentes) => {
      for (const i of incidentes) filas.set(i.clave, i);
      return incidentes.length;
    },
    avisarAlDueno: () => {
      llamoAAvisos = true;
    },
  };
  await alerta.revisarAlertaDeConexionConDependencias(deps, ahora);
  assert.equal(filas.size, 1);
  const abierta = filas.get("CEREBRO:desconectado");
  assert.equal(abierta.severidad, "IMPORTANTE");
  assert.equal(abierta.familia, "CEREBRO");
  assert.equal(abierta.estado, "ABIERTA");
  assert.match(abierta.hallazgos[0].que, /invalid_grant/);
  assert.equal(abierta.notificadaEn, null, "no se avisa por push");
  // Segunda vuelta: la misma alerta, sin crear otra.
  await alerta.revisarAlertaDeConexionConDependencias(deps, new Date(ahora.getTime() + 3_600_000));
  assert.equal(filas.size, 1);
  assert.equal(filas.get("CEREBRO:desconectado").vecesVista, 2);
  // Sincronizó bien: se cierra.
  conexion = { ...base, ultimaSincronizacion: new Date(ahora.getTime() + 2 * 3_600_000) };
  await alerta.revisarAlertaDeConexionConDependencias(deps, new Date(ahora.getTime() + 2 * 3_600_000 + 60_000));
  assert.equal(filas.get("CEREBRO:desconectado").estado, "RESUELTA");
  // Más de 3 horas sin sincronizar (sin error) también abre; sin carpeta no se alerta.
  assert.ok(alerta.motivoDeDesconexion({ ...base, ultimaSincronizacion: new Date("2026-10-26T10:00:00Z") }, ahora));
  assert.equal(alerta.motivoDeDesconexion({ ...base, carpetaId: null, ultimoError: "x" }, ahora), null);
  assert.equal(alerta.motivoDeDesconexion(base, ahora), null);
  assert.equal(llamoAAvisos, false);
  const fuente = fs.readFileSync(path.join(RAIZ, "src/features/cerebro/services/alerta-de-conexion.ts"), "utf8");
  assert.ok(!/avisarAlDueno|whatsapp|push/i.test(fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")), "no llama a WhatsApp ni push");
  const cron = fs.readFileSync(path.join(RAIZ, "src/app/api/cron/follows/route.ts"), "utf8");
  assert.match(cron, /sincronizarCerebroDeTodos\(\);\s*await revisarAlertaDeConexion\(\);/);
});

console.log(`\n${pruebas} pruebas del cerebro: OK`);
