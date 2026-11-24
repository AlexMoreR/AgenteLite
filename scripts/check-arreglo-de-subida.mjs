// Arreglo de subida (24-nov-2026, parte 2 de «Coordinador: si una subida falla, diagnosticar, arreglar y reintentar solo»):
// cuando una subida se revirtió por un error de código o de arranque, el Coordinador pide por /causa-externa (tipo "subida") la
// tarjeta "Arreglo de subida: …". Prueba las reglas puras (reglas-trabajador.ts), el servicio real (trabajador.ts) con un prisma
// FALSO en memoria y el aviso de la subida agotada (avisos-al-dueno.ts: solo página, sin WhatsApp). No necesita base ni red.
// Correr: npm run test:arreglo-de-subida
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

const reglas = cargar("src/features/tableros-inteligentes/services/reglas-trabajador.ts");
const features = cargar("src/features/tableros-inteligentes/services/reglas-features.ts");

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

/* ------------------------------------------------------------------ reglas puras */

await prueba("causaExternaDeEntrada con tipo subida: prefijo bueno devuelve el objeto; prefijo malo, solo el prefijo o sin detalle, un texto", () => {
  const bueno = reglas.causaExternaDeEntrada({
    tipo: "subida",
    titulo: "  Arreglo de subida:   no arranca el contenedor ",
    detalle: "El contenedor no arrancó: falta una variable.",
    lineas: "Error: Cannot find module x\n  at y",
    reversion: { commit: "abc1234", revert: "def5678", ok: true },
  });
  assert.equal(typeof bueno, "object");
  assert.equal(bueno.tipo, "subida");
  assert.equal(bueno.titulo, "Arreglo de subida: no arranca el contenedor");
  assert.equal(bueno.detalle, "El contenedor no arrancó: falta una variable.");
  assert.equal(bueno.referencia, null);
  assert.deepEqual(bueno.reversion, { commit: "abc1234", revert: "def5678", ok: true });
  assert.equal(bueno.lineas, "Error: Cannot find module x\n  at y");
  assert.equal(typeof reglas.causaExternaDeEntrada({ tipo: "subida", titulo: "Vigilancia: x", detalle: "d" }), "string", "prefijo de otra causa");
  assert.equal(typeof reglas.causaExternaDeEntrada({ tipo: "subida", titulo: "Arreglo de subida:", detalle: "d" }), "string", "solo el prefijo");
  assert.equal(typeof reglas.causaExternaDeEntrada({ tipo: "subida", titulo: `Arreglo de subida: ${"x".repeat(200)}`, detalle: "d" }), "string", "más de 200 letras");
  assert.equal(typeof reglas.causaExternaDeEntrada({ tipo: "subida", titulo: "Arreglo de subida: x", detalle: "  " }), "string", "sin detalle");
  assert.equal(typeof reglas.causaExternaDeEntrada({ tipo: "vigilancia", titulo: "Arreglo de subida: x", detalle: "d" }), "string", "el prefijo de subida no vale para vigilancia");
  const sinLog = reglas.causaExternaDeEntrada({ tipo: "subida", titulo: "Arreglo de subida: x", detalle: "d" });
  assert.equal(sinLog.lineas, null);
  assert.equal(sinLog.reversion, null);
});

await prueba("el prefijo de subida va aparte: PREFIJOS_DE_CAUSA_EXTERNA no cambia (igual a diagnostico.mjs); los otros tipos siguen igual", () => {
  assert.equal(reglas.PREFIJO_DE_ARREGLO_DE_SUBIDA, "Arreglo de subida:");
  assert.deepEqual({ ...reglas.PREFIJOS_DE_CAUSA_EXTERNA }, { vigilancia: "Vigilancia:", main_roto: "Main roto:", servidor: "Servidor:" });
  assert.deepEqual(reglas.causaExternaDeEntrada({ tipo: "servidor", titulo: " Servidor:  caído ", detalle: "d" }), { tipo: "servidor", titulo: "Servidor: caído", detalle: "d", referencia: null });
  assert.equal(reglas.causaExternaDeEntrada({ tipo: "choque", referencia: "T-1" }).tipo, "choque");
  assert.ok(reglas.CATEGORIAS_DE_INTENTO.includes("subida_revertida"));
  assert.equal(reglas.categoriaDeEntrada("subida_revertida"), "subida_revertida");
});

await prueba("intentosDeSubida cuenta solo subida_revertida; el tope es 3", () => {
  assert.equal(reglas.TOPE_INTENTOS_DE_SUBIDA, 3);
  assert.equal(reglas.intentosDeSubida([]), 0);
  assert.equal(reglas.intentosDeSubida([{ categoria: "subida_revertida" }, { categoria: "no_compila" }, { categoria: "subida_revertida" }, { categoria: "otra" }]), 2);
  assert.equal(reglas.intentosDeSubida([{ categoria: "choca_con_main" }]), 0);
});

await prueba("detalleDeArregloDeSubida: causa, log, commit deshecho y revert, y 'Al terminar: sube solo a producción' al final una sola vez", () => {
  const texto = reglas.detalleDeArregloDeSubida({
    detalle: "No arrancó por un import roto.\nAl terminar: sube solo a producción",
    lineas: "Error: Cannot find module './x'",
    reversion: { commit: "abc1234", revert: "def5678", ok: true },
  });
  const causa = texto.indexOf("No arrancó por un import roto.");
  const log = texto.indexOf("Cannot find module");
  const commits = texto.indexOf("Commit deshecho: abc1234 · Revert: def5678");
  assert.ok(causa === 0 && log > causa && commits > log, texto);
  assert.ok(texto.endsWith("\n\nAl terminar: sube solo a producción"), texto);
  assert.equal(texto.split("Al terminar: sube solo a producción").length - 1, 1, "una sola vez");
  const corto = reglas.detalleDeArregloDeSubida({ detalle: "Causa", lineas: null, reversion: null });
  assert.equal(corto, "Causa\n\nAl terminar: sube solo a producción");
  const largo = reglas.detalleDeArregloDeSubida({ detalle: "x".repeat(30_000) });
  assert.ok(largo.length <= 20_000 && largo.endsWith("Al terminar: sube solo a producción"));
});

/* ------------------------------------------------------------------ el servicio, con un prisma falso */

const TABLERO_FEATURES = features.TABLERO_DE_FEATURES_ID;
const AREA_FEATURES = features.TARJETA_AREA_FEATURES_ID;
const AHORA = new Date("2026-11-24T15:00:00Z");

// cargar() guarda el módulo en caché: se carga una vez con un prisma que apunta al falso de cada prueba.
let prismaDeLaPrueba = null;
const prismaQueCambia = new Proxy({}, { get: (_, campo) => prismaDeLaPrueba[campo] });
const servicio = cargar("src/features/tableros-inteligentes/services/trabajador.ts", {
  "@/lib/prisma": { prisma: prismaQueCambia },
  "@prisma/client": { Prisma: { DbNull: Symbol("DbNull") } },
  "./tableros": { QUIEN_TRABAJADOR: "trabajador:", linkDeLaTarjeta: (id) => `https://crm.test/tablero/${id}` },
});

function armarServicio() {
  const filas = new Map();
  const historial = [];
  const intentos = [];
  const conexiones = [];
  let creadas = 0;
  const coincide = (fila, where = {}) =>
    Object.entries(where).every(([campo, esperado]) => {
      if (campo === "tablero") return fila.tablero?.workspaceId === esperado.workspaceId;
      if (campo === "tipo") return true;
      if (esperado && typeof esperado === "object" && !Array.isArray(esperado)) {
        if ("in" in esperado) return esperado.in.includes(fila[campo]);
        if ("notIn" in esperado) return !esperado.notIn.includes(fila[campo]);
        if ("not" in esperado) return fila[campo] !== esperado.not;
      }
      return fila[campo] === esperado;
    });
  const falso = {
    tarjetaTablero: {
      findFirst: async ({ where }) => [...filas.values()].find((t) => coincide(t, where)) ?? null,
      findMany: async ({ where }) => [...filas.values()].filter((t) => coincide(t, where)),
      create: async ({ data }) => {
        creadas += 1;
        const fila = { id: `nueva${creadas}`, borradoEn: null, intentos: 0, reparaciones: 0, creadoEn: AHORA, tablero: { workspaceId: "ws1" }, ...data };
        filas.set(fila.id, fila);
        return { id: fila.id, titulo: fila.titulo, estado: fila.estado };
      },
      update: async ({ where, data }) => Object.assign(filas.get(where.id), data),
      updateMany: async ({ where, data }) => {
        const dentro = [...filas.values()].filter((t) => coincide(t, where));
        for (const t of dentro) Object.assign(t, data);
        return { count: dentro.length };
      },
    },
    historialTarjeta: {
      create: async ({ data }) => void historial.push(data),
      findFirst: async () => null,
      findMany: async ({ where }) => historial.filter((fila) => fila.tarjetaId === where.tarjetaId),
    },
    intentoTarjeta: {
      findMany: async ({ where }) => intentos.filter((fila) => fila.tarjetaId === where.tarjetaId),
      count: async ({ where }) => intentos.filter((fila) => fila.tarjetaId === where.tarjetaId).length,
      create: async ({ data }) => void intentos.push(data),
    },
    conexionTarjeta: {
      findMany: async ({ where }) => conexiones.filter((c) => c.tableroId === where.tableroId && c.esDependencia === where.esDependencia),
      create: async ({ data }) => void conexiones.push(data),
    },
    tableroInteligente: { update: async () => undefined, updateMany: async () => ({ count: 1 }) },
    appSetting: { findUnique: async () => null },
    $queryRawUnsafe: async () => [],
    $transaction: async (fn) => fn(falso),
  };
  prismaDeLaPrueba = falso;
  const original = (id, extra = {}) =>
    filas.set(id, {
      id,
      tableroId: TABLERO_FEATURES,
      titulo: `Tarjeta ${id}`,
      detalle: "Una tarea",
      estado: "SUBIENDO",
      repo: "aizencrm",
      zonaProtegida: [],
      riesgo: "MEDIO",
      riesgoMotivo: null,
      plan: "RIESGO: MEDIO\nUn plan.",
      resultado: { paso: true, commit: "a".repeat(40) },
      intentos: 1,
      reparaciones: 0,
      trabajoIniciadoEn: null,
      trabajoVenceEn: null,
      actualizadoEn: AHORA,
      creadoEn: AHORA,
      borradoEn: null,
      tipoId: "tipo1",
      area: null,
      creadoPor: "u1",
      orden: 5,
      padreId: AREA_FEATURES,
      tablero: { workspaceId: "ws1", nombre: "Empresa Magilus" },
      ...extra,
    });
  return { filas, historial, intentos, conexiones, original };
}

const contexto = { claveId: "k1", workspaceId: "ws1", nombre: "Coordinador" };
const pedido = (extra = {}) => ({
  tipo: "subida",
  titulo: "Arreglo de subida: no arranca por un import roto",
  detalle: "El contenedor no arrancó: un import apunta a un archivo que no existe.",
  lineas: "Error: Cannot find module './x'",
  reversion: { commit: "abc1234", revert: "def5678", ok: true },
  causa: "No arrancó tras subir: import roto",
  etapa: "subir",
  ...extra,
});

await prueba("servicio: en Features crea el arreglo APROBADO colgando de Features, con la flecha hacia la original y la aprobación heredada", async () => {
  const { filas, historial, intentos, conexiones, original } = armarServicio();
  original("t1");
  const respuesta = await servicio.accionDelTrabajador(contexto, "t1", "causa-externa", pedido(), AHORA);
  assert.equal(respuesta.creada, true);
  assert.equal(respuesta.soltada, true);
  assert.ok(!respuesta.agotado);
  const arreglo = filas.get(respuesta.tarjetaId);
  assert.equal(arreglo.titulo, "Arreglo de subida: no arranca por un import roto");
  assert.equal(arreglo.estado, "APROBADO");
  assert.equal(arreglo.padreId, AREA_FEATURES, "cuelga de la tarjeta Área Features");
  assert.equal(arreglo.tableroId, TABLERO_FEATURES);
  assert.equal(arreglo.repo, "aizencrm", "el mismo repo de la original");
  assert.match(arreglo.detalle, /^El contenedor no arrancó[\s\S]*Cannot find module[\s\S]*Commit deshecho: abc1234 · Revert: def5678\n\nAl terminar: sube solo a producción$/);
  assert.deepEqual(conexiones, [{ tableroId: TABLERO_FEATURES, origenId: arreglo.id, destinoId: "t1", esDependencia: true }], "la flecha va del arreglo a la original");
  const aprobar = historial.find((h) => h.tarjetaId === arreglo.id && h.accion === "aprobar");
  assert.equal(aprobar.despues.como, "heredada");
  assert.equal(aprobar.despues.heredadaDe, "t1");
  // La original vuelve a construir (PLAN_APROBADO), nunca a SUBIENDO, y el intento cuenta.
  assert.equal(respuesta.estado, "PLAN_APROBADO");
  assert.equal(filas.get("t1").estado, "PLAN_APROBADO");
  assert.equal(filas.get("t1").intentos, 1, "sí gasta el intento (no se descuenta)");
  assert.equal(intentos.length, 1);
  assert.equal(intentos[0].categoria, "subida_revertida");
  assert.equal(intentos[0].cuentaComoIntento, true);
});

await prueba("servicio: fuera de Features queda en el mismo tablero, con el padre de la original, APROBADO y heredada", async () => {
  const { filas, conexiones, original } = armarServicio();
  original("t2", { tableroId: "otroTablero", padreId: "areaX" });
  const respuesta = await servicio.accionDelTrabajador(contexto, "t2", "causa-externa", pedido(), AHORA);
  const arreglo = filas.get(respuesta.tarjetaId);
  assert.equal(arreglo.tableroId, "otroTablero");
  assert.equal(arreglo.padreId, "areaX");
  assert.notEqual(arreglo.padreId, AREA_FEATURES);
  assert.equal(arreglo.estado, "APROBADO");
  assert.equal(conexiones[0].origenId, arreglo.id);
  assert.equal(filas.get("t2").estado, "PLAN_APROBADO");
});

await prueba("servicio: la segunda subida revertida reusa el arreglo abierto con el mismo título; la tercera se agota y no crea nada", async () => {
  const { filas, intentos, conexiones, original } = armarServicio();
  original("t3");
  const primera = await servicio.accionDelTrabajador(contexto, "t3", "causa-externa", pedido(), AHORA);
  filas.get("t3").estado = "SUBIENDO";
  const segunda = await servicio.accionDelTrabajador(contexto, "t3", "causa-externa", pedido({ detalle: "Otra vez no arrancó: falta otra variable." }), AHORA);
  assert.equal(segunda.creada, false);
  assert.equal(segunda.tarjetaId, primera.tarjetaId, "reusa la abierta");
  assert.match(filas.get(primera.tarjetaId).detalle, /falta otra variable/);
  assert.equal(filas.get(primera.tarjetaId).detalle.split("Al terminar: sube solo a producción").length - 1, 1, "la línea final sigue una sola vez");
  assert.equal(conexiones.length, 1, "no repite la flecha");
  filas.get("t3").estado = "SUBIENDO";
  const antesDeLaTercera = filas.size;
  const tercera = await servicio.accionDelTrabajador(contexto, "t3", "causa-externa", pedido({ titulo: "Arreglo de subida: otra causa distinta" }), AHORA);
  assert.equal(tercera.agotado, true);
  assert.equal(tercera.creada, false);
  assert.equal(tercera.soltada, false);
  assert.equal(filas.size, antesDeLaTercera, "no crea tarjeta");
  assert.equal(conexiones.length, 1, "no crea flecha");
  assert.equal(filas.get("t3").estado, "SUBIENDO", "la original no se suelta: el Coordinador manda /error");
  assert.deepEqual(intentos.map((i) => [i.categoria, i.accion, i.cuentaComoIntento]), [
    ["subida_revertida", "reparar", true],
    ["subida_revertida", "reparar", true],
    ["subida_revertida", "escalar", true],
  ]);
  // El /error con categoria subida_revertida deja la tarjeta en ERROR con esa categoría (la lee la página de Alertas).
  const error = await servicio.accionDelTrabajador(contexto, "t3", "error", { categoria: "subida_revertida", motivo: "Se deshizo 3 veces: import roto", causa: "import roto" }, AHORA);
  assert.equal(error.estado, "ERROR");
  assert.equal(filas.get("t3").resultado.error.categoria, "subida_revertida");
});

await prueba("servicio: los otros tipos no cambian (vigilancia no gasta intento y no lleva la línea de subir solo)", async () => {
  const { filas, intentos, original } = armarServicio();
  original("t4");
  const respuesta = await servicio.accionDelTrabajador(contexto, "t4", "causa-externa", { tipo: "vigilancia", titulo: "Vigilancia: algo raro", detalle: "d", categoria: "otra" }, AHORA);
  assert.equal(respuesta.soltada, true);
  assert.equal(filas.get(respuesta.tarjetaId).detalle, "d");
  assert.equal(filas.get("t4").intentos, 0, "vigilancia no gasta el intento");
  assert.equal(intentos[0].cuentaComoIntento, false);
  assert.equal(intentos[0].accion, "esperar");
});

/* ------------------------------------------------------------------ el aviso de la subida agotada */

const avisos = cargar("src/features/tableros-inteligentes/services/avisos-al-dueno.ts", {
  "@/lib/prisma": { prisma: {} },
  "@prisma/client": { Prisma: {} },
  "@/lib/evolution": { sendEvolutionTextMessageWithReconnect: async () => assert.fail("no debe mandar WhatsApp") },
  "./aprobacion-automatica": { tareaAprobadaPorElDueno: async () => false },
  "./coordinador-en-vivo": { ultimoLatido: async () => null },
  "./tableros": {
    pendientesDelDueno: async () => [],
    todoElNegocio: (workspaceId) => ({ workspaceId, soloDe: null }),
    linkDeHoy: () => "https://crm.test/hoy",
    linkDelCoordinador: () => "https://crm.test/coordinador",
    linkDeLaTarjeta: (id) => `https://crm.test/tablero/${id}`,
  },
});

await prueba("aviso: ERROR con subida_revertida = «no se pudo subir tras 3 intentos», causa y decisión, clave de siempre, solo página; un 403 no es 'falta una clave'", () => {
  const tarjeta = { id: "s1", titulo: "Mejorar la bandeja", detalle: "", estado: "ERROR", plan: null, zonaProtegida: [], error: "La vigilancia vio 403 al arrancar", categoriaDelError: "subida_revertida" };
  assert.equal(avisos.porQueNecesitaAlDueno(tarjeta), null, "no se toma como falta una clave");
  const calculados = avisos.calcularAvisos({ latidoEn: null, enCurso: [], enFila: 0, esperando: [tarjeta] }, AHORA);
  assert.equal(calculados.length, 1);
  const [aviso] = calculados;
  assert.equal(aviso.clave, "auto:trabado:s1:ERROR");
  assert.equal(aviso.titulo, '"Mejorar la bandeja" no se pudo subir tras 3 intentos');
  assert.equal(aviso.soloPagina, true);
  assert.match(aviso.lineas.join("\n"), /Causa: La vigilancia vio 403 al arrancar/);
  assert.match(aviso.lineas.join("\n"), /Decide: arreglarla a mano, cambiar la tarea o dejarla en Fallido/);
  // Sin la categoría sigue el aviso de siempre.
  const deSiempre = avisos.calcularAvisos({ latidoEn: null, enCurso: [], enFila: 0, esperando: [{ ...tarjeta, error: "falló una prueba", categoriaDelError: null }] }, AHORA);
  assert.equal(deSiempre[0].titulo, '"Mejorar la bandeja" quedó en error');
  assert.ok(!deSiempre[0].soloPagina);
  assert.equal(avisos.categoriaDelError({ error: { categoria: "subida_revertida" } }), "subida_revertida");
  assert.equal(avisos.categoriaDelError({ error: "texto" }), null);
  assert.equal(avisos.categoriaDelError(null), null);
});

console.log(`\n${pruebas} pruebas, todas bien`);
