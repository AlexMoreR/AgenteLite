// Pruebas de las tarjetas archivadas del Tablero IA (services/archivadas.ts, 30-oct-2026) con un prisma FALSO:
// qué se archiva y qué no (días, estados, madre con hijas abiertas), la tanda de 200 y el "ya corrió hoy", el
// límite de 300 que cuenta solo las no archivadas, desarchivar, la semana de lunes a domingo y el link del commit.
// No necesita base ni red. Correr: npm run test:tablero-archivadas
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

/* ------------------------------------------------------------------ falsos */

const estado = { tarjetas: [], historial: [], ajustes: new Map(), tocados: [] };

/** ¿La fila cumple el where? Lo justo para lo que usa archivadas.ts. */
function cumple(fila, where = {}) {
  return Object.entries(where).every(([clave, valor]) => {
    if (clave === "OR") return valor.some((uno) => cumple(fila, uno));
    if (clave === "tablero") return !valor.id || fila.tableroId === valor.id;
    if (clave === "despues") return (fila.despues ?? {})[valor.path[0]] === valor.equals;
    if (valor === null) return fila[clave] == null;
    if (valor && typeof valor === "object" && !(valor instanceof Date)) {
      if ("in" in valor) return valor.in.includes(fila[clave]);
      if ("notIn" in valor) return !valor.notIn.includes(fila[clave]);
      if ("not" in valor) return fila[clave] != null;
      if ("gte" in valor) return fila[clave] != null && fila[clave] >= valor.gte && fila[clave] < valor.lt;
    }
    return fila[clave] === valor;
  });
}

const falso = {
  appSetting: {
    findUnique: async ({ where }) => (estado.ajustes.has(where.key) ? { value: estado.ajustes.get(where.key) } : null),
    upsert: async ({ where, create, update }) => estado.ajustes.set(where.key, estado.ajustes.has(where.key) ? update.value : create.value),
  },
  tarjetaTablero: {
    findMany: async ({ where }) => estado.tarjetas.filter((t) => cumple(t, where)).map((t) => ({ ...t })),
    findFirst: async ({ where }) => {
      const fila = estado.tarjetas.find((t) => cumple(t, where));
      return fila ? { ...fila } : null;
    },
    count: async ({ where }) => estado.tarjetas.filter((t) => cumple(t, where)).length,
    groupBy: async ({ where }) => {
      const cuenta = new Map();
      for (const t of estado.tarjetas.filter((t) => cumple(t, where))) cuenta.set(t.padreId, (cuenta.get(t.padreId) ?? 0) + 1);
      return [...cuenta].map(([padreId, n]) => ({ padreId, _count: { _all: n } }));
    },
    updateMany: async ({ where, data }) => {
      const filas = estado.tarjetas.filter((t) => cumple(t, where));
      for (const t of filas) Object.assign(t, data);
      return { count: filas.length };
    },
  },
  historialTarjeta: {
    groupBy: async ({ where }) => {
      const { tarjeta, ...resto } = where;
      const maximo = new Map();
      for (const h of estado.historial.filter((h) => cumple(h, resto))) {
        if (tarjeta && !cumple(estado.tarjetas.find((t) => t.id === h.tarjetaId), tarjeta)) continue;
        if (!maximo.has(h.tarjetaId) || maximo.get(h.tarjetaId) < h.creadoEn) maximo.set(h.tarjetaId, h.creadoEn);
      }
      return [...maximo].map(([tarjetaId, creadoEn]) => ({ tarjetaId, _max: { creadoEn } }));
    },
    createMany: async ({ data }) => estado.historial.push(...data.map((h) => ({ ...h, creadoEn: new Date(), deshechoEn: null }))),
    create: async ({ data }) => estado.historial.push({ ...data, creadoEn: new Date(), deshechoEn: null }),
  },
  tableroInteligente: {
    updateMany: async ({ where }) => estado.tocados.push(...where.id.in),
    update: async ({ where }) => estado.tocados.push(where.id),
  },
  $transaction: async (fn) => fn(falso),
};

const VISIBLE = { borradoEn: null, archivadaEn: null };
const archivadas = cargar("src/features/tableros-inteligentes/services/archivadas.ts", {
  "@/lib/prisma": { prisma: falso },
  "@prisma/client": { Prisma: {} },
  "./tableros": { LIMITE_TARJETAS: 300, VISIBLE },
});

let pruebas = 0;
async function prueba(nombre, fn) {
  estado.tarjetas = [];
  estado.historial = [];
  estado.ajustes.clear();
  estado.tocados = [];
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const AHORA = new Date("2026-10-30T15:00:00Z");
const haceDias = (dias) => new Date(AHORA.getTime() - dias * 86_400_000);
const tarjeta = (id, extra = {}) => ({
  id,
  tableroId: "tab1",
  numero: Number(id.replace(/\D/g, "")) || 1,
  titulo: `Tarjeta ${id}`,
  estado: "HECHO",
  padreId: null,
  borradoEn: null,
  archivadaEn: null,
  terminadaEn: null,
  repo: null,
  resultado: null,
  actualizadoEn: AHORA,
  ...extra,
});
const terminoHace = (tarjetaId, dias, estadoNuevo = "HECHO") =>
  estado.historial.push({ tarjetaId, accion: "estado", despues: { estado: estadoNuevo }, creadoEn: haceDias(dias), deshechoEn: null });
const archivada = (id) => estado.tarjetas.find((t) => t.id === id).archivadaEn !== null;

/* ------------------------------------------------------------------ reglas puras */

await prueba("sePuedeArchivar: HECHO de hace 4 días sí; de hace 2 no; IDEA y EN_CURSO nunca; con hijas abiertas no", () => {
  const { sePuedeArchivar } = archivadas;
  assert.equal(sePuedeArchivar({ estado: "HECHO", terminadaEn: haceDias(4), hijasAbiertas: 0 }, AHORA), true);
  assert.equal(sePuedeArchivar({ estado: "FALLIDO", terminadaEn: haceDias(4), hijasAbiertas: 0 }, AHORA), true);
  assert.equal(sePuedeArchivar({ estado: "HECHO", terminadaEn: haceDias(2), hijasAbiertas: 0 }, AHORA), false);
  assert.equal(sePuedeArchivar({ estado: "IDEA", terminadaEn: haceDias(40), hijasAbiertas: 0 }, AHORA), false);
  assert.equal(sePuedeArchivar({ estado: "EN_CURSO", terminadaEn: haceDias(40), hijasAbiertas: 0 }, AHORA), false);
  assert.equal(sePuedeArchivar({ estado: "HECHO", terminadaEn: haceDias(40), hijasAbiertas: 1 }, AHORA), false);
  assert.equal(sePuedeArchivar({ estado: "HECHO", terminadaEn: haceDias(4), hijasAbiertas: 0 }, AHORA, 5), false, "los días se pueden cambiar");
});

await prueba("diasDelAjuste: 3 si no hay o no sirve; el número si es un entero de 1 a 365", () => {
  assert.equal(archivadas.diasDelAjuste(null), 3);
  assert.equal(archivadas.diasDelAjuste("abc"), 3);
  assert.equal(archivadas.diasDelAjuste("0"), 3);
  assert.equal(archivadas.diasDelAjuste("2.5"), 3);
  assert.equal(archivadas.diasDelAjuste("7"), 7);
});

await prueba('semanaDe("2026-10-30") da de lunes 26 a domingo 1, en hora de Bogotá', () => {
  const semana = archivadas.semanaDe("2026-10-30");
  assert.equal(semana.lunes, "2026-10-26");
  assert.equal(semana.domingo, "2026-11-01");
  assert.equal(semana.desde.toISOString(), "2026-10-26T05:00:00.000Z");
  assert.equal(semana.hasta.toISOString(), "2026-11-02T05:00:00.000Z");
  assert.equal(archivadas.semanaDe("2026-10-26").lunes, "2026-10-26", "un lunes es su propia semana");
  assert.equal(archivadas.semanaDe("2026-11-01").lunes, "2026-10-26", "un domingo cierra la semana");
  assert.equal(archivadas.diaValido("2026-02-30"), null);
  assert.equal(archivadas.diaValido("30/10/2026"), null);
  assert.equal(archivadas.diaValido(" 2026-10-30 "), "2026-10-30");
});

await prueba("linkDelCommit: solo https; nada raro llega al enlace", () => {
  assert.deepEqual(archivadas.linkDelCommit({ subida: { commit: "abc1234", linkCommit: "https://github.com/x/y/commit/abc1234" } }), {
    commit: "abc1234",
    linkCommit: "https://github.com/x/y/commit/abc1234",
  });
  assert.equal(archivadas.linkDelCommit({ subida: { linkCommit: "javascript:alert(1)" } }).linkCommit, null);
  assert.equal(archivadas.linkDelCommit(null).linkCommit, null);
});

/* ------------------------------------------------------------------ el reloj */

await prueba("archiva la HECHO de hace 4 días y no la de hace 2, ni la IDEA, ni la EN_CURSO; deja historial TRABAJADOR", async () => {
  estado.tarjetas.push(tarjeta("t1"), tarjeta("t2"), tarjeta("t3", { estado: "IDEA", actualizadoEn: haceDias(30) }), tarjeta("t4", { estado: "EN_CURSO", actualizadoEn: haceDias(30) }));
  terminoHace("t1", 4);
  terminoHace("t2", 2);
  const r = await archivadas.archivarLasTerminadas(AHORA);
  assert.deepEqual(r, { archivadas: 1, quedan: false });
  assert.equal(archivada("t1"), true);
  assert.equal(archivada("t2"), false);
  assert.equal(archivada("t3"), false);
  assert.equal(archivada("t4"), false);
  const t1 = estado.tarjetas.find((t) => t.id === "t1");
  assert.equal(t1.estado, "HECHO", "no cambia de estado");
  assert.equal(t1.terminadaEn.toISOString(), haceDias(4).toISOString(), "guarda cuándo terminó");
  const fila = estado.historial.find((h) => h.accion === "archivar");
  assert.equal(fila.tarjetaId, "t1");
  assert.equal(fila.origen, "TRABAJADOR");
  assert.deepEqual(estado.tocados, ["tab1"], "la pantalla se refresca");
});

await prueba("sin historial usa la última edición; el último cambio a HECHO manda (no el primero)", async () => {
  estado.tarjetas.push(tarjeta("t1", { actualizadoEn: haceDias(10) }), tarjeta("t2", { actualizadoEn: haceDias(10) }));
  terminoHace("t2", 20);
  terminoHace("t2", 1); // se reabrió y se volvió a cerrar ayer
  await archivadas.archivarLasTerminadas(AHORA);
  assert.equal(archivada("t1"), true);
  assert.equal(archivada("t2"), false);
});

await prueba("una madre con una hija EN_CURSO no se archiva; con todas sus hijas cerradas (o borradas) sí", async () => {
  estado.tarjetas.push(tarjeta("m1"), tarjeta("h1", { padreId: "m1", estado: "EN_CURSO" }), tarjeta("h2", { padreId: "m1", estado: "HECHO" }));
  terminoHace("m1", 10);
  terminoHace("h2", 1);
  await archivadas.archivarLasTerminadas(AHORA);
  assert.equal(archivada("m1"), false, "la hija EN_CURSO la retiene");
  estado.ajustes.clear();
  estado.tarjetas.find((t) => t.id === "h1").estado = "FALLIDO";
  estado.tarjetas.push(tarjeta("h3", { padreId: "m1", estado: "IDEA", borradoEn: haceDias(1) }));
  await archivadas.archivarLasTerminadas(AHORA);
  assert.equal(archivada("m1"), true, "con todas cerradas sí");
});

await prueba("una vez al día; la limpieza va por tandas de 200 y el día se anota solo al terminar", async () => {
  for (let i = 1; i <= 250; i += 1) estado.tarjetas.push(tarjeta(`v${i}`, { tableroId: i % 2 ? "tab1" : "tab2", actualizadoEn: haceDias(30) }));
  const primera = await archivadas.archivarLasTerminadas(AHORA);
  assert.deepEqual(primera, { archivadas: 200, quedan: true });
  assert.equal(estado.ajustes.has(archivadas.CLAVE_ULTIMO), false, "quedan: la próxima vuelta sigue");
  const segunda = await archivadas.archivarLasTerminadas(new Date(AHORA.getTime() + 60_000));
  assert.deepEqual(segunda, { archivadas: 50, quedan: false });
  assert.equal(estado.ajustes.get(archivadas.CLAVE_ULTIMO), "2026-10-30");
  estado.tarjetas.push(tarjeta("tarde", { actualizadoEn: haceDias(30) }));
  const tercera = await archivadas.archivarLasTerminadas(new Date(AHORA.getTime() + 120_000));
  assert.deepEqual(tercera, { archivadas: 0, quedan: false }, "ya corrió hoy");
  assert.equal(archivada("tarde"), false);
});

await prueba("los días salen del ajuste guardado", async () => {
  estado.tarjetas.push(tarjeta("t1"));
  terminoHace("t1", 4);
  estado.ajustes.set(archivadas.CLAVE_DIAS, "7");
  await archivadas.archivarLasTerminadas(AHORA);
  assert.equal(archivada("t1"), false);
});

/* ------------------------------------------------------------------ el límite y desarchivar */

await prueba("el límite de 300 cuenta solo las no archivadas (y crearTarjeta usa ese filtro)", async () => {
  for (let i = 1; i <= 300; i += 1) estado.tarjetas.push(tarjeta(`a${i}`, { archivadaEn: i <= 10 ? haceDias(1) : null }));
  assert.equal(await falso.tarjetaTablero.count({ where: { tableroId: "tab1", ...VISIBLE } }), 290);
  // desarchivar usa el mismo conteo: con 290 visibles hay lugar.
  await archivadas.desarchivarTarjeta({ workspaceId: "ws1", soloDe: null, userId: "u-dueno", origen: "PANTALLA" }, "a1");
  assert.equal(archivada("a1"), false);
  const fila = estado.historial.find((h) => h.accion === "desarchivar");
  assert.equal(fila.origen, "PANTALLA");
  assert.equal(fila.quien, "u-dueno");
  // En tableros.ts, el conteo del límite, el mapa, los contadores y "Te toca a ti" filtran VISIBLE.
  const fuente = fs.readFileSync(path.join(RAIZ, "src/features/tableros-inteligentes/services/tableros.ts"), "utf8");
  assert.match(fuente, /export const VISIBLE = \{ borradoEn: null, archivadaEn: null \} as const;/);
  assert.match(fuente, /const cuantas = await prisma\.tarjetaTablero\.count\(\{ where: \{ tableroId: tablero\.id, \.\.\.VISIBLE \} \}\);/);
  assert.match(fuente, /\{ tableroId, \.\.\.VISIBLE \}/, "contenidoDelTablero");
  assert.match(fuente, /archivadaEn: null \}/, "cambiarEstadoTarjeta desarchiva al reabrir");
  // La lógica del Coordinador NO filtra las archivadas (para él siguen siendo HECHO).
  for (const archivo of ["sql-trabajador.ts", "trabajador.ts", "madre-partida.ts"]) {
    const texto = fs.readFileSync(path.join(RAIZ, "src/features/tableros-inteligentes/services", archivo), "utf8");
    assert.ok(!/archivadaEn|VISIBLE/.test(texto), `${archivo} no filtra archivadas`);
  }
});

await prueba("desarchivar: un tablero lleno no la recibe; una que no está archivada da error", async () => {
  for (let i = 1; i <= 301; i += 1) estado.tarjetas.push(tarjeta(`a${i}`, { archivadaEn: i === 1 ? haceDias(1) : null }));
  const contexto = { workspaceId: "ws1", soloDe: null, userId: "u-dueno", origen: "PANTALLA" };
  await assert.rejects(() => archivadas.desarchivarTarjeta(contexto, "a1"), /300 tarjetas/);
  await assert.rejects(() => archivadas.desarchivarTarjeta(contexto, "a2"), /ya está en el tablero/);
  await assert.rejects(() => archivadas.desarchivarTarjeta(contexto, "no-existe"), /No existe/);
});

await prueba("una desarchivada vuelve a contar los días desde que se desarchivó", async () => {
  estado.tarjetas.push(tarjeta("t1"));
  terminoHace("t1", 20);
  estado.historial.push({ tarjetaId: "t1", accion: "desarchivar", despues: { archivadaEn: null }, creadoEn: haceDias(1), deshechoEn: null });
  await archivadas.archivarLasTerminadas(AHORA);
  assert.equal(archivada("t1"), false);
});

/* ------------------------------------------------------------------ la semana (MCP listar_terminadas) */

await prueba("terminadasDeLaSemana: las HECHO y FALLIDO de esa semana, archivadas o no", async () => {
  estado.tarjetas.push(
    tarjeta("t1"),
    tarjeta("t2", { estado: "FALLIDO" }),
    tarjeta("t3", { archivadaEn: haceDias(1), terminadaEn: new Date("2026-10-27T12:00:00Z") }),
    tarjeta("t4"),
    tarjeta("t5", { estado: "EN_CURSO" }),
  );
  terminoHace("t1", 1);
  terminoHace("t2", 2, "FALLIDO");
  estado.historial.push({ tarjetaId: "t4", accion: "estado", despues: { estado: "HECHO" }, creadoEn: new Date("2026-10-20T12:00:00Z"), deshechoEn: null });
  terminoHace("t5", 1);
  falso.tarjetaTablero.findMany = (({ findMany }) => async (args) =>
    (await findMany(args)).map((t) => ({ ...t, tablero: { id: t.tableroId, nombre: "Empresa Magilus" } })))(falso.tarjetaTablero);
  const semana = await archivadas.terminadasDeLaSemana("ws1", "2026-10-30");
  assert.equal(semana.lunes, "2026-10-26");
  assert.deepEqual(semana.tarjetas.map((t) => t.id).sort(), ["t1", "t2", "t3"]);
  assert.equal(semana.tarjetas.find((t) => t.id === "t3").archivada, true);
});

console.log(`\n${pruebas} pruebas pasaron`);
