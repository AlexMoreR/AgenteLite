// Arreglo de subida (24-nov-2026, parte 2 de «Coordinador: si una subida falla, diagnosticar, arreglar y reintentar solo»).
// Prueba la parte pura (reglas-trabajador.ts: tipo "subida", intentosDeSubida, el tope y el detalle), el servicio
// /causa-externa con tipo "subida" (trabajador.ts) con un prisma FALSO en memoria, y la alerta solo página de
// avisos-al-dueno.ts. No necesita base ni red.
// Correr: npm run test:arreglo-de-subida
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

/* ------------------------------------------------------------------ prisma falso */

const db = { tarjetas: [], historial: [], intentos: [], conexiones: [], tablerosTocados: 0 };
let siguiente = 0;
const nuevoId = (prefijo) => `${prefijo}${(siguiente += 1)}`;

/** Compara un `where` sencillo de Prisma (igual, not, in, notIn); lo anidado (tablero, tipo) se acepta siempre. */
function coincide(fila, where = {}) {
  return Object.entries(where).every(([campo, condicion]) => {
    if (campo === "tablero" || campo === "tipo") return true;
    const valor = fila[campo] ?? null;
    if (condicion && typeof condicion === "object" && !(condicion instanceof Date)) {
      if ("not" in condicion && valor === condicion.not) return false;
      if ("in" in condicion && !condicion.in.includes(valor)) return false;
      if ("notIn" in condicion && condicion.notIn.includes(valor)) return false;
      return true;
    }
    return valor === condicion;
  });
}

const tarjetaTablero = {
  findFirst: async ({ where }) => db.tarjetas.find((t) => coincide(t, where)) ?? null,
  findMany: async ({ where }) => db.tarjetas.filter((t) => coincide(t, where)),
  create: async ({ data }) => {
    const fila = { id: nuevoId("arr"), borradoEn: null, padreId: null, creadoEn: new Date(), intentos: 0, reparaciones: 0, ...data };
    db.tarjetas.push(fila);
    return fila;
  },
  update: async ({ where, data }) => {
    const fila = db.tarjetas.find((t) => t.id === where.id);
    Object.assign(fila, data);
    return fila;
  },
  updateMany: async ({ where, data }) => {
    const filas = db.tarjetas.filter((t) => coincide(t, where));
    for (const fila of filas) Object.assign(fila, data);
    return { count: filas.length };
  },
};
const falso = {
  tarjetaTablero,
  historialTarjeta: {
    create: async ({ data }) => db.historial.push(data),
    findFirst: async ({ where }) => db.historial.filter((h) => h.tarjetaId === where.tarjetaId && h.accion === where.accion).at(-1) ?? null,
  },
  intentoTarjeta: {
    findMany: async ({ where }) => db.intentos.filter((i) => i.tarjetaId === where.tarjetaId),
    count: async ({ where }) => db.intentos.filter((i) => i.tarjetaId === where.tarjetaId).length,
    create: async ({ data }) => db.intentos.push(data),
  },
  conexionTarjeta: {
    findMany: async ({ where }) => db.conexiones.filter((c) => c.tableroId === where.tableroId && c.esDependencia === where.esDependencia),
    create: async ({ data }) => db.conexiones.push(data),
  },
  tableroInteligente: { updateMany: async () => ((db.tablerosTocados += 1), { count: 1 }) },
  $transaction: async (fn) => fn(falso),
};

const reglas = cargar("src/features/tableros-inteligentes/services/reglas-trabajador.ts");
const features = cargar("src/features/tableros-inteligentes/services/reglas-features.ts");
const trabajador = cargar("src/features/tableros-inteligentes/services/trabajador.ts", { "@/lib/prisma": { prisma: falso } });
const avisos = cargar("src/features/tableros-inteligentes/services/avisos-al-dueno.ts", { "@/lib/prisma": { prisma: falso } });

const contexto = { workspaceId: "ws1", claveId: "clave1" };
const REPO = reglas.REPOS_DEL_TRABAJADOR[0];

function reiniciar({ tableroId = features.TABLERO_DE_FEATURES_ID, estado = "SUBIENDO", subidasPrevias = 0 } = {}) {
  Object.assign(db, { tarjetas: [], historial: [], intentos: [], conexiones: [], tablerosTocados: 0 });
  db.tarjetas.push({
    id: "orig",
    tableroId,
    titulo: "Bandeja más rápida",
    detalle: "La tarea original.",
    estado,
    repo: REPO,
    plan: "el plan",
    resultado: null,
    zonaProtegida: [],
    riesgo: "MEDIO",
    intentos: 2,
    reparaciones: 0,
    trabajoVenceEn: new Date(),
    trabajoIniciadoEn: new Date(),
    area: "Tecnología",
    creadoPor: "u1",
    orden: 5,
    tipoId: "tipo-tarea",
    padreId: "otra-madre",
    borradoEn: null,
    creadoEn: new Date(),
  });
  db.historial.push({ tarjetaId: "orig", accion: "aprobar", despues: { estado: "APROBADO", via: "pantalla" } });
  for (let i = 0; i < subidasPrevias; i += 1) db.intentos.push({ tarjetaId: "orig", categoria: "subida_revertida", cuentaComoIntento: true });
}

const pedido = (extra = {}) => ({
  tipo: "subida",
  titulo: "Arreglo de subida: la app no arranca tras subir «Bandeja más rápida»",
  detalle: "La app no arrancó: falta una variable en el arranque.",
  lineas: ["Error: Cannot find module './bandeja'", "    at arranque (server.js:10)"],
  reversion: { commit: "abc1234", revert: "def5678", ok: true },
  causa: "la app no arrancó tras subir",
  error: "log completo",
  ...extra,
});
const original = () => db.tarjetas.find((t) => t.id === "orig");
const arreglos = () => db.tarjetas.filter((t) => t.id !== "orig");

/* ------------------------------------------------------------------ reglas puras */

await prueba("causaExternaDeEntrada: tipo subida con el prefijo bueno devuelve tipo subida, las líneas y la reversión", () => {
  const causa = reglas.causaExternaDeEntrada(pedido());
  assert.equal(typeof causa, "object");
  assert.equal(causa.tipo, "subida");
  assert.ok(causa.titulo.startsWith("Arreglo de subida:"));
  assert.deepEqual(causa.lineas, ["Error: Cannot find module './bandeja'", "    at arranque (server.js:10)"]);
  assert.deepEqual(causa.reversion, { commit: "abc1234", revert: "def5678", ok: true });
  // Las líneas también pueden llegar como un solo texto.
  assert.deepEqual(reglas.causaExternaDeEntrada(pedido({ lineas: "uno\n\ndos" })).lineas, ["uno", "dos"]);
  assert.deepEqual(reglas.causaExternaDeEntrada(pedido({ lineas: undefined })).lineas, []);
});

await prueba("causaExternaDeEntrada: tipo subida con prefijo malo, sin texto tras el prefijo, largo o sin detalle devuelve el problema", () => {
  assert.match(reglas.causaExternaDeEntrada(pedido({ titulo: "Vigilancia: otra cosa" })), /Arreglo de subida:/);
  assert.match(reglas.causaExternaDeEntrada(pedido({ titulo: "Arreglo de subida:" })), /Arreglo de subida:/);
  assert.match(reglas.causaExternaDeEntrada(pedido({ titulo: `Arreglo de subida: ${"x".repeat(200)}` })), /máximo 200/);
  assert.equal(reglas.causaExternaDeEntrada(pedido({ detalle: "  " })), "Falta el detalle de la causa.");
  assert.match(reglas.causaExternaDeEntrada({ tipo: "otro", titulo: "x", detalle: "y" }), /no existe/);
});

await prueba("los otros tipos de causa externa no cambian y la lista del Coordinador sigue igual", () => {
  assert.deepEqual({ ...reglas.PREFIJOS_DE_CAUSA_EXTERNA }, { vigilancia: "Vigilancia:", main_roto: "Main roto:", servidor: "Servidor:" });
  assert.equal(reglas.PREFIJO_DE_ARREGLO_DE_SUBIDA, "Arreglo de subida:");
  const vigilancia = reglas.causaExternaDeEntrada({ tipo: "vigilancia", titulo: "Vigilancia: revirtió", detalle: "d" });
  assert.deepEqual(vigilancia, { tipo: "vigilancia", titulo: "Vigilancia: revirtió", detalle: "d", referencia: null });
  // Un título "Arreglo de subida:" no vale para otro tipo.
  assert.match(reglas.causaExternaDeEntrada({ tipo: "vigilancia", titulo: "Arreglo de subida: x", detalle: "d" }), /Vigilancia:/);
  assert.equal(reglas.causaExternaDeEntrada({ tipo: "choque", referencia: "T-1" }).referencia, "T-1");
  assert.ok(reglas.CATEGORIAS_DE_INTENTO.includes("subida_revertida"));
  assert.equal(reglas.categoriaDeEntrada("subida_revertida"), "subida_revertida");
});

await prueba("intentosDeSubida cuenta solo subida_revertida y el tope es 3 (con la 3.ª se agota)", () => {
  assert.equal(reglas.TOPE_INTENTOS_DE_SUBIDA, 3);
  assert.equal(reglas.intentosDeSubida([]), 0);
  assert.equal(reglas.intentosDeSubida([{ categoria: "subida_revertida" }, { categoria: "no_compila" }, { categoria: "subida_revertida" }]), 2);
  assert.equal(reglas.seAgotoElTopeDeSubida(0), false);
  assert.equal(reglas.seAgotoElTopeDeSubida(1), false);
  assert.equal(reglas.seAgotoElTopeDeSubida(2), true);
  assert.equal(reglas.seAgotoElTopeDeSubida(5), true);
});

await prueba("detalleDeArregloDeSubida: causa, líneas del log, commit y revert, y 'Al terminar' una sola vez al final", () => {
  const texto = reglas.detalleDeArregloDeSubida({
    detalle: "La app no arrancó.\nAl terminar: sube solo a producción",
    lineas: ["Error: x", "  at y"],
    reversion: { commit: "abc", revert: "def", ok: true },
  });
  const causa = texto.indexOf("La app no arrancó.");
  const log = texto.indexOf("Error: x");
  const commit = texto.indexOf("Commit deshecho: abc · Revert: def");
  assert.ok(causa === 0 && log > causa && commit > log, texto);
  assert.ok(texto.endsWith("\n\nAl terminar: sube solo a producción"));
  assert.equal(texto.split("Al terminar: sube solo a producción").length, 2);
  // Sin log ni reversión: solo la causa y la línea final.
  assert.equal(reglas.detalleDeArregloDeSubida({ detalle: "Causa" }), "Causa\n\nAl terminar: sube solo a producción");
  // Un detalle enorme no pasa de 20.000 letras y no pierde la línea final.
  const enorme = reglas.detalleDeArregloDeSubida({ detalle: "x".repeat(30_000) });
  assert.ok(enorme.length <= 20_000 && enorme.endsWith("Al terminar: sube solo a producción"));
});

/* ------------------------------------------------------------------ el servicio */

await prueba("servicio, tablero de Features: crea el arreglo APROBADO colgado de Área Features, con flecha, y la original vuelve a PLAN_APROBADO", async () => {
  reiniciar();
  const respuesta = await trabajador.accionDelTrabajador(contexto, "orig", "causa-externa", pedido());
  assert.equal(respuesta.agotado, false);
  assert.equal(respuesta.creada, true);
  assert.equal(respuesta.soltada, true);
  assert.equal(respuesta.estado, "PLAN_APROBADO");
  assert.equal(respuesta.intentosDeSubida, 1);
  const [arreglo] = arreglos();
  assert.equal(arreglos().length, 1);
  assert.equal(arreglo.estado, "APROBADO");
  assert.equal(arreglo.tableroId, features.TABLERO_DE_FEATURES_ID);
  assert.equal(arreglo.padreId, features.TARJETA_AREA_FEATURES_ID);
  assert.equal(arreglo.repo, REPO);
  assert.match(arreglo.detalle, /Commit deshecho: abc1234 · Revert: def5678/);
  assert.match(arreglo.detalle, /Cannot find module/);
  assert.ok(arreglo.detalle.endsWith("Al terminar: sube solo a producción"));
  // Aprobación heredada (con la vía de la original).
  const aprobacion = db.historial.find((h) => h.tarjetaId === arreglo.id && h.accion === "aprobar");
  assert.equal(aprobacion.despues.como, "heredada");
  assert.equal(aprobacion.despues.heredadaDe, "orig");
  // Flecha arreglo -> original.
  assert.deepEqual(db.conexiones, [{ tableroId: features.TABLERO_DE_FEATURES_ID, origenId: arreglo.id, destinoId: "orig", esDependencia: true }]);
  // La original: a la fila de construir, nunca a SUBIENDO; el intento cuenta y no se descuenta.
  assert.equal(original().estado, "PLAN_APROBADO");
  assert.equal(original().intentos, 2);
  assert.equal(original().trabajoVenceEn, null);
  assert.deepEqual(
    db.intentos.map((i) => [i.categoria, i.accion, i.cuentaComoIntento]),
    [["subida_revertida", "reparar", true]],
  );
});

await prueba("servicio, otro tablero: el arreglo queda en ese tablero, sin colgar de Features", async () => {
  reiniciar({ tableroId: "otro-tablero" });
  const respuesta = await trabajador.accionDelTrabajador(contexto, "orig", "causa-externa", pedido());
  const [arreglo] = arreglos();
  assert.equal(respuesta.soltada, true);
  assert.equal(arreglo.tableroId, "otro-tablero");
  assert.equal(arreglo.padreId, null);
  assert.equal(arreglo.estado, "APROBADO");
  assert.equal(original().estado, "PLAN_APROBADO");
});

await prueba("servicio: desde EN_CURSO vuelve a PLAN_APROBADO y desde PLANEANDO a APROBADO (igual que /reparar)", async () => {
  reiniciar({ estado: "EN_CURSO" });
  assert.equal((await trabajador.accionDelTrabajador(contexto, "orig", "causa-externa", pedido())).estado, "PLAN_APROBADO");
  reiniciar({ estado: "PLANEANDO" });
  assert.equal((await trabajador.accionDelTrabajador(contexto, "orig", "causa-externa", pedido())).estado, "APROBADO");
});

await prueba("servicio: un arreglo abierto con el mismo título se reusa (no se duplica) y la línea final queda una vez", async () => {
  reiniciar({ subidasPrevias: 1 });
  db.tarjetas.push({ id: "abierto", tableroId: features.TABLERO_DE_FEATURES_ID, titulo: pedido().titulo, detalle: "Otra causa vieja.\n\nAl terminar: sube solo a producción", estado: "EN_CURSO", borradoEn: null, creadoEn: new Date() });
  const respuesta = await trabajador.accionDelTrabajador(contexto, "orig", "causa-externa", pedido());
  assert.equal(respuesta.creada, false);
  assert.equal(respuesta.tarjetaId, "abierto");
  assert.equal(respuesta.intentosDeSubida, 2);
  assert.equal(arreglos().length, 1);
  const abierto = db.tarjetas.find((t) => t.id === "abierto");
  assert.match(abierto.detalle, /^Otra causa vieja\.[\s\S]*La app no arrancó/);
  assert.equal(abierto.detalle.split("Al terminar: sube solo a producción").length, 2);
  assert.equal(db.conexiones[0].origenId, "abierto");
});

await prueba("servicio, tope: con la 3.ª subida deshecha no crea nada, responde agotado y la original sigue en SUBIENDO", async () => {
  reiniciar({ subidasPrevias: 2 });
  const respuesta = await trabajador.accionDelTrabajador(contexto, "orig", "causa-externa", pedido());
  assert.equal(respuesta.agotado, true);
  assert.equal(respuesta.soltada, false);
  assert.equal(respuesta.creada, false);
  assert.equal(respuesta.tarjetaId, null);
  assert.equal(respuesta.intentosDeSubida, 3);
  assert.equal(arreglos().length, 0);
  assert.equal(db.conexiones.length, 0);
  assert.equal(original().estado, "SUBIENDO");
  const ultimo = db.intentos.at(-1);
  assert.deepEqual([ultimo.categoria, ultimo.accion, ultimo.cuentaComoIntento], ["subida_revertida", "escalar", true]);
});

await prueba("servicio: un pedido de subida con título malo es 400 y no toca nada", async () => {
  reiniciar();
  await assert.rejects(trabajador.accionDelTrabajador(contexto, "orig", "causa-externa", pedido({ titulo: "Vigilancia: x" })), (error) => error.status === 400 || error.estado === 400 || /Arreglo de subida/.test(error.message));
  assert.equal(arreglos().length, 0);
  assert.equal(original().estado, "SUBIENDO");
});

/* ------------------------------------------------------------------ la alerta */

const DIA = new Date("2026-11-24T15:00:00Z");
const enError = (extra = {}) => ({ id: "orig", titulo: "Bandeja más rápida", detalle: "", estado: "ERROR", plan: null, zonaProtegida: [], error: null, ...extra });

await prueba("alerta: una tarjeta en ERROR por subida_revertida sale solo en la página, con la causa y la decisión", () => {
  const subida = avisos.subidaRevertidaDelResultado({ error: { motivo: "resumen", categoria: "subida_revertida", causa: "la app no arranca: falta el módulo" } });
  assert.deepEqual(subida, { causa: "la app no arranca: falta el módulo" });
  assert.equal(avisos.subidaRevertidaDelResultado({ error: { categoria: "no_compila", causa: "x" } }), null);
  assert.equal(avisos.subidaRevertidaDelResultado(null), null);
  const calculados = avisos.calcularAvisos({ latidoEn: DIA.toISOString(), enCurso: [], enFila: 1, esperando: [enError({ subidaRevertida: subida, error: "HTTP 401 al arrancar" })] }, DIA);
  assert.equal(calculados.length, 1);
  const [aviso] = calculados;
  assert.equal(aviso.clave, "auto:trabado:orig:ERROR");
  assert.equal(aviso.soloPagina, true);
  assert.equal(aviso.titulo, '"Bandeja más rápida" no se pudo subir tras 3 intentos');
  assert.match(aviso.lineas.join("\n"), /Causa: la app no arranca: falta el módulo/);
  assert.match(aviso.lineas.join("\n"), /Decide: arreglarla a mano, cambiar la tarea o dejarla en Fallido/);
  // Aunque el log diga 401, no se toma como "falta una clave".
  assert.equal(avisos.porQueNecesitaAlDueno(enError({ subidaRevertida: subida, error: "HTTP 401" })), null);
  // Un ERROR de siempre sigue igual (sin soloPagina).
  const comun = avisos.calcularAvisos({ latidoEn: DIA.toISOString(), enCurso: [], enFila: 1, esperando: [enError({ error: "falló el build" })] }, DIA);
  assert.equal(comun[0].soloPagina, undefined);
  assert.match(comun[0].titulo, /quedó en error/);
});

console.log(`\n${pruebas} pruebas, todas bien`);
