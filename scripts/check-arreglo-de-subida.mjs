// Pruebas del arreglo de subida (24-nov-2026, parte 2 de «Coordinador: si una subida falla, diagnosticar, arreglar y reintentar
// solo»): la validación de /causa-externa con tipo "subida", el conteo y el tope de subidas deshechas, el detalle de la tarjeta
// "Arreglo de subida: …", el flujo de pedirCausaExterna con un prisma FALSO (crea, reusa, flecha, la original vuelve a construir y
// el tope agotado no crea nada) y la alerta solo de página de avisos-al-dueno.ts. No necesita base ni red.
// Correr: npm run test:arreglo-de-subida
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

const reglas = cargar("src/features/tableros-inteligentes/services/reglas-trabajador.ts");
const { TABLERO_DE_FEATURES_ID, TARJETA_AREA_FEATURES_ID } = cargar("src/features/tableros-inteligentes/services/reglas-features.ts");

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

/* ------------------------------------------------------------------ reglas puras */

await prueba("causaExternaDeEntrada: tipo subida con el prefijo bueno devuelve tipo, título, detalle, reversión y líneas", () => {
  const r = reglas.causaExternaDeEntrada({
    tipo: "subida",
    titulo: "  Arreglo de subida:   el contenedor no arranca ",
    detalle: "La app no arrancó: falta una variable.",
    reversion: { commit: "abc1234", revert: "def5678", ok: true },
    lineas: "error: x\n\n  at y\n",
  });
  assert.equal(typeof r, "object");
  assert.equal(r.tipo, "subida");
  assert.equal(r.titulo, "Arreglo de subida: el contenedor no arranca");
  assert.equal(r.detalle, "La app no arrancó: falta una variable.");
  assert.equal(r.referencia, null);
  assert.deepEqual(r.reversion, { commit: "abc1234", revert: "def5678", ok: true });
  assert.deepEqual(r.lineas, ["error: x", "  at y"]);
  assert.deepEqual(reglas.causaExternaDeEntrada({ tipo: "subida", titulo: "Arreglo de subida: x", detalle: "d", lineas: ["a", 3, "", "b"] }).lineas, ["a", "b"]);
  const largo = reglas.causaExternaDeEntrada({ tipo: "subida", titulo: "Arreglo de subida: x", detalle: "d", lineas: Array.from({ length: 100 }, (_, i) => `linea ${i}`) });
  assert.equal(largo.lineas.length, 40, "máximo 40 líneas del log");
  assert.equal(reglas.causaExternaDeEntrada({ tipo: "subida", titulo: "Arreglo de subida: x", detalle: "d" }).reversion, null, "sin reversión: null");
});

await prueba("causaExternaDeEntrada: tipo subida con prefijo malo, sin texto tras el prefijo, largo o sin detalle devuelve el problema", () => {
  for (const titulo of ["Vigilancia: x", "arreglo de subida: x", "Arreglo de subida:", "Arreglo de subida:   ", `Arreglo de subida: ${"x".repeat(200)}`, 7]) {
    const r = reglas.causaExternaDeEntrada({ tipo: "subida", titulo, detalle: "d" });
    assert.equal(typeof r, "string", String(titulo));
  }
  assert.match(reglas.causaExternaDeEntrada({ tipo: "subida", titulo: "Vigilancia: x", detalle: "d" }), /Arreglo de subida:/);
  assert.equal(reglas.causaExternaDeEntrada({ tipo: "subida", titulo: "Arreglo de subida: x", detalle: "  " }), "Falta el detalle de la causa.");
  assert.match(reglas.causaExternaDeEntrada({ tipo: "otro", titulo: "Arreglo de subida: x", detalle: "d" }), /subida/);
});

await prueba("los otros tipos de causa externa no cambian, y PREFIJOS_DE_CAUSA_EXTERNA sigue igual al del Coordinador", () => {
  assert.deepEqual({ ...reglas.PREFIJOS_DE_CAUSA_EXTERNA }, { vigilancia: "Vigilancia:", main_roto: "Main roto:", servidor: "Servidor:" });
  assert.equal(reglas.PREFIJO_DE_ARREGLO_DE_SUBIDA, "Arreglo de subida:");
  assert.deepEqual(reglas.causaExternaDeEntrada({ tipo: "servidor", titulo: " Servidor:  caído ", detalle: "d" }), { tipo: "servidor", titulo: "Servidor: caído", detalle: "d", referencia: null });
  assert.deepEqual(reglas.causaExternaDeEntrada({ tipo: "choque", referencia: "T-1" }), { tipo: "choque", titulo: "T-1", detalle: "", referencia: "T-1" });
  assert.equal(typeof reglas.causaExternaDeEntrada({ tipo: "vigilancia", titulo: "Arreglo de subida: x", detalle: "d" }), "string");
});

await prueba("intentosDeSubida cuenta solo subida_revertida; TOPE_INTENTOS_DE_SUBIDA = 3 y subidaAgotada con la 3ª", () => {
  assert.equal(reglas.TOPE_INTENTOS_DE_SUBIDA, 3);
  assert.ok(reglas.CATEGORIAS_DE_INTENTO.includes("subida_revertida"));
  assert.equal(reglas.categoriaDeEntrada("subida_revertida"), "subida_revertida");
  assert.equal(reglas.intentosDeSubida([]), 0);
  const intentos = [{ categoria: "no_compila" }, { categoria: "subida_revertida" }, { categoria: "otra" }, { categoria: "subida_revertida" }];
  assert.equal(reglas.intentosDeSubida(intentos), 2);
  assert.equal(reglas.subidaAgotada(0), false, "1ª subida deshecha: crea el arreglo");
  assert.equal(reglas.subidaAgotada(1), false, "2ª: crea el arreglo");
  assert.equal(reglas.subidaAgotada(2), true, "3ª: agotado");
  assert.equal(reglas.subidaAgotada(5), true);
});

await prueba("detalleDeArregloDeSubida: causa, log, commit y revert, y 'Al terminar: sube solo a producción' una sola vez al final", () => {
  const d = reglas.detalleDeArregloDeSubida({
    detalle: "La app no arrancó.\nAl terminar: sube solo a producción",
    lineas: ["error: x", "at y"],
    reversion: { commit: "abc1234", revert: "def5678", ok: true },
  });
  const causa = d.indexOf("La app no arrancó.");
  const log = d.indexOf("error: x\nat y");
  const commit = d.indexOf("Commit deshecho: abc1234 · Revert: def5678");
  const final = d.indexOf("Al terminar: sube solo a producción");
  assert.ok(causa === 0 && causa < log && log < commit && commit < final, d);
  assert.equal(d.match(/Al terminar: sube solo a producción/g).length, 1);
  assert.ok(d.endsWith("\n\nAl terminar: sube solo a producción"));
  // Reusar la abierta: lo nuevo va después y la línea final no se repite; si ya lo decía, no cambia.
  const otra = reglas.detalleDeArregloDeSubida({ detalle: "Otra vez no arrancó.", lineas: [], reversion: null }, d);
  assert.ok(otra.startsWith("La app no arrancó."));
  assert.ok(otra.indexOf("Otra vez no arrancó.") > otra.indexOf("Commit deshecho"));
  assert.equal(otra.match(/Al terminar: sube solo a producción/g).length, 1);
  assert.equal(reglas.detalleDeArregloDeSubida({ detalle: "La app no arrancó.", lineas: ["error: x", "at y"], reversion: { commit: "abc1234", revert: "def5678", ok: true } }, d), d);
  // Sin log ni reversión: solo la causa y la línea final.
  assert.equal(reglas.detalleDeArregloDeSubida({ detalle: "x" }), "x\n\nAl terminar: sube solo a producción");
});

await prueba("padreDeTarjetaDelCoordinador: en Features el arreglo cuelga del Área Features; en otro tablero, del padre de la original", () => {
  const datos = { caso: "causa-externa", idDeLaOriginal: "t1", padreDeLaOriginal: "p1", ancestrosDeLaOriginal: [] };
  assert.equal(reglas.padreDeTarjetaDelCoordinador({ ...datos, tableroId: TABLERO_DE_FEATURES_ID }), TARJETA_AREA_FEATURES_ID);
  assert.equal(reglas.padreDeTarjetaDelCoordinador({ ...datos, tableroId: "otro" }), "p1");
});

/* ------------------------------------------------------------------ pedirCausaExterna con prisma falso */

const DbNull = Symbol("DbNull");
const estado = { tarjetas: new Map(), historial: [], intentos: [], conexiones: [], tableros: [], creadas: 0 };

const cumple = (valor, esperado) => {
  if (esperado && typeof esperado === "object" && !(esperado instanceof Date) && !Array.isArray(esperado)) {
    if ("in" in esperado) return esperado.in.includes(valor);
    if ("notIn" in esperado) return !esperado.notIn.includes(valor);
    if ("not" in esperado) return valor !== esperado.not;
    if ("equals" in esperado) return JSON.stringify(valor ?? []) === JSON.stringify(esperado.equals);
  }
  return valor === esperado;
};
const coincide = (fila, where = {}) =>
  Object.entries(where).every(([campo, esperado]) => {
    if (campo === "tablero") return !esperado.workspaceId || fila.workspaceId === esperado.workspaceId;
    if (campo === "tipo") return true;
    return cumple(fila[campo], esperado);
  });

const falso = {
  tarjetaTablero: {
    findFirst: async ({ where, orderBy }) => {
      const filas = [...estado.tarjetas.values()].filter((t) => coincide(t, where));
      if (orderBy?.creadoEn === "asc") filas.sort((a, b) => a.creadoEn - b.creadoEn);
      return filas[0] ?? null;
    },
    findUniqueOrThrow: async ({ where }) => estado.tarjetas.get(where.id),
    findMany: async ({ where }) => [...estado.tarjetas.values()].filter((t) => coincide(t, where)),
    create: async ({ data }) => {
      estado.creadas += 1;
      const t = { id: `nueva${estado.creadas}`, workspaceId: "ws1", borradoEn: null, intentos: 0, creadoEn: new Date(Date.now() + estado.creadas), ...data };
      estado.tarjetas.set(t.id, t);
      return t;
    },
    update: async ({ where, data }) => Object.assign(estado.tarjetas.get(where.id), data),
    updateMany: async ({ where, data }) => {
      const dentro = [...estado.tarjetas.values()].filter((t) => coincide(t, where));
      for (const t of dentro) for (const [campo, valor] of Object.entries(data)) t[campo] = valor === DbNull ? null : valor;
      return { count: dentro.length };
    },
  },
  historialTarjeta: {
    create: async ({ data }) => (estado.historial.push(data), data),
    findFirst: async () => null,
    findMany: async () => [],
  },
  intentoTarjeta: {
    findMany: async ({ where }) => estado.intentos.filter((i) => i.tarjetaId === where.tarjetaId),
    count: async ({ where }) => estado.intentos.filter((i) => i.tarjetaId === where.tarjetaId).length,
    create: async ({ data }) => (estado.intentos.push(data), data),
  },
  conexionTarjeta: {
    findMany: async ({ where }) => estado.conexiones.filter((c) => c.tableroId === where.tableroId && c.esDependencia === where.esDependencia),
    create: async ({ data }) => (estado.conexiones.push(data), data),
  },
  tableroInteligente: { updateMany: async ({ where }) => (estado.tableros.push(...where.id.in), { count: 1 }) },
  $transaction: async (fn) => fn(falso),
};
const mocks = {
  "@/lib/prisma": { prisma: falso },
  "@prisma/client": { Prisma: { DbNull } },
  "./tableros": { QUIEN_TRABAJADOR: "trabajador:", linkDeLaTarjeta: (id) => `https://crm.test/tablero/${id}` },
};
const trabajador = cargar("src/features/tableros-inteligentes/services/trabajador.ts", mocks);
const contexto = { claveId: "k1", workspaceId: "ws1", nombre: "Coordinador" };
const AHORA = new Date("2026-11-24T15:00:00Z");

function reiniciar() {
  estado.tarjetas.clear();
  estado.historial.length = 0;
  estado.intentos.length = 0;
  estado.conexiones.length = 0;
  estado.tableros.length = 0;
}
function original(extra = {}) {
  const t = {
    id: "t1",
    workspaceId: "ws1",
    tableroId: TABLERO_DE_FEATURES_ID,
    titulo: "Reporte de ventas",
    detalle: "Agregar el reporte",
    estado: "SUBIENDO",
    repo: "aizencrm",
    plan: "el plan",
    resultado: null,
    zonaProtegida: [],
    riesgo: "MEDIO",
    intentos: 2,
    reparaciones: 0,
    trabajoVenceEn: AHORA,
    trabajoIniciadoEn: AHORA,
    borradoEn: null,
    tipoId: "tipo-tarea",
    area: "Sistemas",
    creadoPor: "dueno",
    orden: 5,
    padreId: "otra-madre",
    creadoEn: new Date("2026-11-20T00:00:00Z"),
    ...extra,
  };
  estado.tarjetas.set(t.id, t);
  return t;
}
const pedido = (extra = {}) => ({
  tipo: "subida",
  titulo: "Arreglo de subida: la app no arranca tras «Reporte de ventas»",
  detalle: "La app no arrancó después de subir: falta la variable X.",
  reversion: { commit: "abc1234", revert: "def5678", ok: true },
  lineas: ["Error: X is not defined", "    at main.js:1"],
  etapa: "subir",
  categoria: "subida_revertida",
  causa: "La app no arrancó: falta la variable X",
  ...extra,
});
const deSubida = (tarjetaId = "t1") => estado.intentos.filter((i) => i.tarjetaId === tarjetaId && i.categoria === "subida_revertida");

await prueba("subida en Features: crea el arreglo APROBADO colgado de Features, con flecha, y la original vuelve a PLAN_APROBADO; el intento cuenta", async () => {
  reiniciar();
  original();
  const r = await trabajador.accionDelTrabajador(contexto, "t1", "causa-externa", pedido(), AHORA);
  assert.equal(r.ok, true);
  assert.equal(r.agotado, false);
  assert.equal(r.intentosDeSubida, 1);
  assert.equal(r.creada, true);
  assert.equal(r.soltada, true);
  assert.equal(r.estado, "PLAN_APROBADO");
  const arreglo = estado.tarjetas.get(r.tarjetaId);
  assert.equal(arreglo.titulo, "Arreglo de subida: la app no arranca tras «Reporte de ventas»");
  assert.equal(arreglo.estado, "APROBADO");
  assert.equal(arreglo.padreId, TARJETA_AREA_FEATURES_ID, "cuelga del Área Features: la regla Features la aprueba y la sube");
  assert.equal(arreglo.repo, "aizencrm");
  assert.match(arreglo.detalle, /^La app no arrancó después de subir[\s\S]*Error: X is not defined[\s\S]*Commit deshecho: abc1234 · Revert: def5678\n\nAl terminar: sube solo a producción$/);
  const aprobacion = estado.historial.find((h) => h.tarjetaId === arreglo.id && h.accion === "aprobar");
  assert.equal(aprobacion.despues.como, "heredada");
  assert.equal(aprobacion.despues.heredadaDe, "t1");
  assert.deepEqual(estado.conexiones, [{ tableroId: TABLERO_DE_FEATURES_ID, origenId: arreglo.id, destinoId: "t1", esDependencia: true }]);
  const t1 = estado.tarjetas.get("t1");
  assert.equal(t1.estado, "PLAN_APROBADO", "nunca vuelve a SUBIENDO");
  assert.equal(t1.intentos, 2, "la subida deshecha SÍ gasta el intento");
  assert.equal(t1.trabajoVenceEn, null);
  const [intento] = deSubida();
  assert.equal(intento.cuentaComoIntento, true);
  assert.equal(intento.accion, "reparar");
  assert.equal(intento.causa, "La app no arrancó: falta la variable X");
});

await prueba("subida en otro tablero: el arreglo queda en ese tablero, con el padre de la original y aprobación heredada", async () => {
  reiniciar();
  original({ tableroId: "tb-otro" });
  const r = await trabajador.accionDelTrabajador(contexto, "t1", "causa-externa", pedido(), AHORA);
  const arreglo = estado.tarjetas.get(r.tarjetaId);
  assert.equal(arreglo.tableroId, "tb-otro");
  assert.equal(arreglo.padreId, "otra-madre");
  assert.equal(arreglo.estado, "APROBADO");
  assert.equal(estado.tarjetas.get("t1").estado, "PLAN_APROBADO");
});

await prueba("2ª subida deshecha: reusa el arreglo abierto (sin repetir 'Al terminar') y sigue; la 3ª se agota: no crea nada y la original queda en SUBIENDO", async () => {
  reiniciar();
  original();
  const primera = await trabajador.accionDelTrabajador(contexto, "t1", "causa-externa", pedido(), AHORA);
  // El arreglo sigue abierto (EN_CURSO) y la original volvió a subir y se deshizo otra vez.
  estado.tarjetas.get(primera.tarjetaId).estado = "EN_CURSO";
  estado.tarjetas.get("t1").estado = "SUBIENDO";
  const segunda = await trabajador.accionDelTrabajador(contexto, "t1", "causa-externa", pedido({ detalle: "Otra vez no arrancó: falta la variable Y." }), AHORA);
  assert.equal(segunda.agotado, false);
  assert.equal(segunda.creada, false);
  assert.equal(segunda.tarjetaId, primera.tarjetaId);
  assert.equal(segunda.intentosDeSubida, 2);
  const detalle = estado.tarjetas.get(primera.tarjetaId).detalle;
  assert.match(detalle, /falta la variable X[\s\S]*falta la variable Y/);
  assert.equal(detalle.match(/Al terminar: sube solo a producción/g).length, 1);
  assert.equal(estado.conexiones.length, 1, "la flecha no se repite");
  assert.equal(estado.tarjetas.get("t1").estado, "PLAN_APROBADO");

  estado.tarjetas.get("t1").estado = "SUBIENDO";
  const creadasAntes = estado.tarjetas.size;
  const tercera = await trabajador.accionDelTrabajador(contexto, "t1", "causa-externa", pedido({ titulo: "Arreglo de subida: otra causa" }), AHORA);
  assert.equal(tercera.ok, true);
  assert.equal(tercera.agotado, true);
  assert.equal(tercera.intentosDeSubida, 3);
  assert.equal(tercera.soltada, false);
  assert.equal(tercera.tarjetaId, null);
  assert.equal(estado.tarjetas.size, creadasAntes, "no crea tarjeta");
  assert.equal(estado.conexiones.length, 1, "no pone flecha");
  assert.equal(estado.tarjetas.get("t1").estado, "SUBIENDO", "la original no se suelta: el Coordinador manda /error");
  const ultimo = deSubida().at(-1);
  assert.equal(ultimo.accion, "escalar");
  assert.equal(ultimo.cuentaComoIntento, true);
  assert.equal(deSubida().length, 3);
});

await prueba("los otros tipos siguen sin gastar intento ni contar como subida", async () => {
  reiniciar();
  original({ estado: "EN_CURSO" });
  const r = await trabajador.accionDelTrabajador(contexto, "t1", "causa-externa", { tipo: "main_roto", titulo: "Main roto: lint", detalle: "d", categoria: "lint" }, AHORA);
  assert.equal(r.soltada, true);
  assert.equal("agotado" in r, false);
  assert.equal(estado.tarjetas.get("t1").intentos, 1, "intentos - 1, como antes");
  assert.equal(estado.intentos.at(-1).cuentaComoIntento, false);
  assert.equal(deSubida().length, 0);
});

/* ------------------------------------------------------------------ la alerta solo de página */

const avisos = cargar("src/features/tableros-inteligentes/services/avisos-al-dueno.ts", {
  "@/lib/prisma": { prisma: {} },
  "@/lib/evolution": { sendEvolutionTextMessageWithReconnect: async () => ({}) },
  "./aprobacion-automatica": { tareaAprobadaPorElDueno: async () => false },
  "./coordinador-en-vivo": { ultimoLatido: async () => null },
  "./tableros": { linkDeHoy: () => "https://crm.test/hoy", linkDeLaTarjeta: (id) => `https://crm.test/tablero/${id}`, linkDelCoordinador: () => "x", pendientesDelDueno: async () => [], todoElNegocio: () => ({}) },
});

await prueba("avisos: ERROR con categoría subida_revertida da «no se pudo subir tras 3 intentos», solo página, misma clave, sin 'falta una clave'", () => {
  const resultado = { error: { motivo: "No se pudo subir.\nSe deshizo 3 veces", categoria: "subida_revertida", causa: "La app no arrancó: 401 al leer la base" } };
  assert.equal(avisos.causaDeSubidaRevertida(resultado), "La app no arrancó: 401 al leer la base");
  assert.equal(avisos.causaDeSubidaRevertida({ error: { motivo: "No se pudo subir.", categoria: "subida_revertida" } }), "No se pudo subir.");
  assert.equal(avisos.causaDeSubidaRevertida({ error: { motivo: "x", categoria: "no_compila" } }), null);
  assert.equal(avisos.causaDeSubidaRevertida({ error: "texto" }), null);
  assert.equal(avisos.causaDeSubidaRevertida(null), null);
  const tarjeta = { id: "e1", titulo: "Reporte de ventas", detalle: "", estado: "ERROR", plan: null, zonaProtegida: [], error: "403 sin permiso", subidaRevertida: avisos.causaDeSubidaRevertida(resultado) };
  assert.equal(avisos.porQueNecesitaAlDueno(tarjeta), null, "no es 'falta una clave'");
  const lista = avisos.calcularAvisos({ latidoEn: new Date().toISOString(), enCurso: [], enFila: 1, esperando: [tarjeta] }, new Date());
  assert.equal(lista.length, 1);
  const [aviso] = lista;
  assert.equal(aviso.clave, "auto:trabado:e1:ERROR");
  assert.equal(aviso.soloPagina, true);
  assert.equal(aviso.titulo, '"Reporte de ventas" no se pudo subir tras 3 intentos');
  assert.match(aviso.lineas.join("\n"), /Causa: La app no arrancó: 401 al leer la base/);
  assert.match(aviso.lineas.join("\n"), /Decide: arreglarla a mano, cambiar la tarea o dejarla en Fallido/);
  // Un ERROR de otra categoría sigue como antes.
  const otro = avisos.calcularAvisos({ latidoEn: new Date().toISOString(), enCurso: [], enFila: 1, esperando: [{ ...tarjeta, error: "falló una prueba", subidaRevertida: null }] }, new Date());
  assert.equal(otro[0].soloPagina, undefined);
  assert.match(otro[0].titulo, /quedó en error/);
});

console.log(`\n${pruebas} pruebas, todas bien`);
