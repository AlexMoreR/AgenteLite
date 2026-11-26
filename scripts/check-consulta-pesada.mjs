/**
 * Prueba, sin base, del freno a las consultas pesadas (src/lib/consulta-pesada.ts):
 *   node scripts/check-consulta-pesada.mjs
 *
 * Con un prisma falso que cuenta las consultas en curso y guarda lo que recibe $executeRawUnsafe:
 * 1. El tope: '8s' en pagina, '20s' en cron y '15s' con topeSegundos 15 (Mi Dia).
 * 2. Con 10 llamadas a la vez nunca hay mas de 3 en curso (consultaPesada y conTurnoPesado).
 * 3. Con el semaforo lleno se devuelve la copia guardada.
 * 4. Dos pedidos dentro del TTL hacen una sola consulta.
 * 5. Un error no queda guardado.
 * 6. Actividad (resumenDelEquipo, ultimaAccionPorPersona) y el Supervisor (leerChatsAbiertos) pasan
 *    por el freno, con cache de 1 minuto, y el cron del Supervisor pide modo "cron".
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ── Base falsa ── */
const ejecutados = [];
const opcionesDeTransaccion = [];
let enCurso = 0;
let maximoEnCurso = 0;
let consultas = 0;
let demoraMs = 0;

const tx = {
  $executeRawUnsafe: async (sql) => {
    ejecutados.push(sql);
    return 0;
  },
  $queryRaw: async (valor) => {
    consultas += 1;
    enCurso += 1;
    maximoEnCurso = Math.max(maximoEnCurso, enCurso);
    try {
      await esperar(demoraMs);
      if (valor instanceof Error) throw valor;
      return valor;
    } finally {
      enCurso -= 1;
    }
  },
};
const prisma = {
  $transaction: async (fn, opciones) => {
    opcionesDeTransaccion.push(opciones);
    return fn(tx);
  },
};

function reiniciar() {
  ejecutados.length = 0;
  opcionesDeTransaccion.length = 0;
  enCurso = 0;
  maximoEnCurso = 0;
  consultas = 0;
  demoraMs = 0;
}

const pesada = cargar("src/lib/consulta-pesada.ts", { "@/lib/prisma": { prisma } });
const { CacheConTtl } = cargar("src/lib/cache-en-memoria.ts");
const { consultaPesada, conTurnoPesado, LIMITE, TOPE_PAGINA_SEGUNDOS, TOPE_CRON_SEGUNDOS, turnosEnCurso } = pesada;

await prueba("constantes: pagina 8 s, cron 20 s, limite 3", () => {
  assert.equal(TOPE_PAGINA_SEGUNDOS, 8);
  assert.equal(TOPE_CRON_SEGUNDOS, 20);
  assert.equal(LIMITE, 3);
});

await prueba("tope: '8s' en pagina, '20s' en cron y '15s' con topeSegundos 15", async () => {
  reiniciar();
  assert.equal(await consultaPesada({ modo: "pagina" }, (t) => t.$queryRaw("a")), "a");
  await consultaPesada({ modo: "cron" }, (t) => t.$queryRaw("b"));
  await consultaPesada({ modo: "pagina", topeSegundos: 15 }, (t) => t.$queryRaw("c"));
  assert.deepEqual(ejecutados, [
    "SET LOCAL statement_timeout = '8s'",
    "SET LOCAL statement_timeout = '20s'",
    "SET LOCAL statement_timeout = '15s'",
  ]);
  // La transaccion dura el tope mas un margen corto, y espera poco una conexion.
  const topes = [8, 20, 15];
  opcionesDeTransaccion.forEach((opciones, i) => {
    assert.ok(opciones.timeout > topes[i] * 1000 && opciones.timeout <= topes[i] * 1000 + 2000, JSON.stringify(opciones));
    assert.ok(opciones.maxWait > 0 && opciones.maxWait <= 2000, JSON.stringify(opciones));
  });
});

await prueba("tope invalido: no llega al SQL", async () => {
  reiniciar();
  for (const tope of [0, -1, 1.5, Number.NaN]) {
    await assert.rejects(consultaPesada({ modo: "pagina", topeSegundos: tope }, (t) => t.$queryRaw("x")));
  }
  assert.deepEqual(ejecutados, []);
});

await prueba("semaforo: con 10 llamadas a la vez nunca hay mas de 3 en curso", async () => {
  reiniciar();
  demoraMs = 60;
  const llamadas = Array.from({ length: 10 }, (_, i) => consultaPesada({ modo: "cron" }, (t) => t.$queryRaw(i)));
  await esperar(10);
  assert.equal(turnosEnCurso(), 3);
  const resultados = await Promise.all(llamadas);
  assert.deepEqual(resultados, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(maximoEnCurso, 3);
  assert.equal(consultas, 10);
  assert.equal(turnosEnCurso(), 0, "al terminar se liberan todos los turnos");
});

await prueba("semaforo: en pagina, si no se libera un turno en ~2 s, lanza un error", async () => {
  reiniciar();
  demoraMs = 2600;
  const ocupadas = Array.from({ length: 3 }, () => consultaPesada({ modo: "cron" }, (t) => t.$queryRaw("lenta")));
  await esperar(10);
  const inicio = Date.now();
  await assert.rejects(consultaPesada({ modo: "pagina" }, (t) => t.$queryRaw("x")), { name: "SinTurnoParaConsultaPesada" });
  const espero = Date.now() - inicio;
  assert.ok(espero >= 1900 && espero < 2500, `espero ${espero} ms`);
  await Promise.all(ocupadas);
  assert.equal(consultas, 3, "la que no tuvo turno no consulto");
  assert.equal(turnosEnCurso(), 0);
});

await prueba("semaforo lleno: se devuelve la copia guardada (aunque este vencida)", async () => {
  reiniciar();
  let reloj = 0;
  const cache = new CacheConTtl({ ttlMs: 60_000, maxEntradas: 10, ahora: () => reloj });
  assert.deepEqual(await consultaPesada({ modo: "pagina", cache, clave: "k" }, (t) => t.$queryRaw({ v: 1 })), { v: 1 });
  reloj = 120_000; // vencida
  demoraMs = 80;
  const ocupadas = Array.from({ length: 3 }, () => consultaPesada({ modo: "cron" }, (t) => t.$queryRaw("lenta")));
  await esperar(10);
  consultas = 0;
  const inicio = Date.now();
  const copia = await consultaPesada({ modo: "pagina", cache, clave: "k" }, (t) => t.$queryRaw({ v: 2 }));
  assert.deepEqual(copia, { v: 1 });
  assert.ok(Date.now() - inicio < 50, "no espero turno");
  assert.equal(consultas, 0, "no sumo una cuarta pesada");
  await Promise.all(ocupadas);
  // Con turno libre y la cache vencida, vuelve a consultar.
  assert.deepEqual(await consultaPesada({ modo: "pagina", cache, clave: "k" }, (t) => t.$queryRaw({ v: 3 })), { v: 3 });
});

await prueba("cache: dos pedidos dentro del TTL hacen una sola consulta", async () => {
  reiniciar();
  let reloj = 0;
  const cache = new CacheConTtl({ ttlMs: 60_000, maxEntradas: 10, ahora: () => reloj });
  demoraMs = 30;
  // A la vez...
  const [a, b] = await Promise.all([
    consultaPesada({ modo: "pagina", cache, clave: "x" }, (t) => t.$queryRaw("uno")),
    consultaPesada({ modo: "pagina", cache, clave: "x" }, (t) => t.$queryRaw("dos")),
  ]);
  assert.equal(a, "uno");
  assert.equal(b, "uno");
  // ...y uno despues, todavia dentro del TTL.
  reloj = 30_000;
  assert.equal(await consultaPesada({ modo: "pagina", cache, clave: "x" }, (t) => t.$queryRaw("tres")), "uno");
  assert.equal(consultas, 1);
});

await prueba("cache: un error no queda guardado (ni como copia de reserva)", async () => {
  reiniciar();
  const cache = new CacheConTtl({ ttlMs: 60_000, maxEntradas: 10 });
  await assert.rejects(
    consultaPesada({ modo: "pagina", cache, clave: "e" }, (t) => t.$queryRaw(new Error("base caida"))),
    /base caida/,
  );
  assert.equal(cache.leer("e"), undefined);
  // Con el semaforo lleno no hay copia que devolver: espera turno y falla, no devuelve el error.
  demoraMs = 2600;
  const ocupadas = Array.from({ length: 3 }, () => consultaPesada({ modo: "cron" }, (t) => t.$queryRaw("lenta")));
  await esperar(10);
  await assert.rejects(consultaPesada({ modo: "pagina", cache, clave: "e" }, (t) => t.$queryRaw("bien")), {
    name: "SinTurnoParaConsultaPesada",
  });
  await Promise.all(ocupadas);
  // Con turno libre vuelve a intentar y ahora si guarda.
  demoraMs = 0;
  consultas = 0;
  assert.equal(await consultaPesada({ modo: "pagina", cache, clave: "e" }, (t) => t.$queryRaw("bien")), "bien");
  assert.equal(consultas, 1);
  assert.equal(cache.leer("e"), "bien");
});

await prueba("conTurnoPesado: tambien respeta el limite de 3, sin transaccion ni SET LOCAL", async () => {
  reiniciar();
  let corriendo = 0;
  let maximo = 0;
  const llamadas = Array.from({ length: 10 }, (_, i) =>
    conTurnoPesado("cron", async () => {
      corriendo += 1;
      maximo = Math.max(maximo, corriendo);
      await esperar(40);
      corriendo -= 1;
      return i;
    }),
  );
  await esperar(10);
  assert.equal(turnosEnCurso(), 3);
  assert.deepEqual(await Promise.all(llamadas), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(maximo, 3);
  assert.deepEqual(ejecutados, []);
  assert.deepEqual(opcionesDeTransaccion, []);
  // Un error dentro libera el turno igual.
  await assert.rejects(conTurnoPesado("pagina", async () => {
    throw new Error("falla");
  }));
  assert.equal(turnosEnCurso(), 0);
});

await prueba("consultaPesada y conTurnoPesado comparten el mismo semaforo", async () => {
  reiniciar();
  demoraMs = 40;
  let maximo = 0;
  const medir = setInterval(() => {
    maximo = Math.max(maximo, turnosEnCurso());
  }, 2);
  const llamadas = [];
  for (let i = 0; i < 5; i += 1) {
    llamadas.push(consultaPesada({ modo: "cron" }, (t) => t.$queryRaw(i)));
    llamadas.push(conTurnoPesado("cron", () => esperar(40)));
  }
  await Promise.all(llamadas);
  clearInterval(medir);
  assert.equal(maximo, 3);
  assert.equal(turnosEnCurso(), 0);
});

await prueba("importar el archivo no toca la base: prisma se importa recien en la primera consulta", () => {
  const fuente = fs.readFileSync(path.join(RAIZ, "src/lib/consulta-pesada.ts"), "utf8");
  assert.doesNotMatch(fuente, /^import [^\n]*from "@\/lib\/prisma"/m, "sin import fijo de prisma");
  assert.match(fuente, /await import\("@\/lib\/prisma"\)/);
});

const leerFuente = (archivo) => fs.readFileSync(path.join(RAIZ, archivo), "utf8");
const IMPORTA_CONSULTA_PESADA = /^import \{[^}]*\bconsultaPesada\b[^}]*\} from "@\/lib\/consulta-pesada";$/m;
const CACHE_DE_1_MINUTO = /new CacheConTtl<[^>]+>\(\{ ttlMs: 60_000, maxEntradas: 50 \}\)/;

/** El cuerpo de una funcion exportada, hasta la siguiente funcion o constante exportada. */
function cuerpoDe(fuente, nombre) {
  const inicio = fuente.indexOf(`export async function ${nombre}(`);
  assert.ok(inicio >= 0, `falta ${nombre}`);
  const fin = fuente.slice(inicio + 1).search(/\n(export |\/\*\*)/);
  return fin === -1 ? fuente.slice(inicio) : fuente.slice(inicio, inicio + 1 + fin);
}

await prueba("actividad.ts: resumenDelEquipo pasa por consultaPesada con cache de 1 minuto", () => {
  const fuente = leerFuente("src/features/actividad/services/actividad.ts");
  assert.match(fuente, IMPORTA_CONSULTA_PESADA);
  assert.match(fuente, CACHE_DE_1_MINUTO);
  const resumen = cuerpoDe(fuente, "resumenDelEquipo");
  assert.match(resumen, /consultaPesada\(\s*\{ modo: "pagina", cache: cacheDelResumen, clave \}/);
  assert.match(resumen, /workspaceId\}\|\$\{desde\.toISOString\(\)\}\|\$\{hasta\.toISOString\(\)\}/, "clave: negocio + rango");
  // Una tras otra en la misma transaccion: nada de Promise.all ni del prisma global.
  assert.doesNotMatch(resumen, /Promise\.all|prisma\./);
  assert.equal((resumen.match(/await tx\.\$queryRaw/g) ?? []).length, 2);
  assert.match(resumen, /await tx\.callAttempt\.groupBy/);
  const ultima = cuerpoDe(fuente, "ultimaAccionPorPersona");
  assert.match(ultima, /conTurnoPesado\("pagina", \(\) => prisma\.\$transaction\(/);
  assert.match(ultima, /SET LOCAL statement_timeout = '5s'/, "su tope de 5 s no cambia");
});

await prueba("datos.ts: leerChatsAbiertos pasa por consultaPesada con cache de 1 minuto (clave sin ahora)", () => {
  const fuente = leerFuente("src/features/supervisor/servicios/datos.ts");
  assert.match(fuente, IMPORTA_CONSULTA_PESADA);
  assert.match(fuente, CACHE_DE_1_MINUTO);
  const chats = cuerpoDe(fuente, "leerChatsAbiertos");
  assert.match(chats, /modo\?: ModoConsultaPesada;/);
  assert.match(chats, /consultaPesada\(\{ modo: input\.modo \?\? "pagina", cache: cacheDeChatsAbiertos, clave \}, \(tx\) =>\s+tx\.\$queryRaw/);
  const clave = chats.match(/const clave = (.+);/);
  assert.ok(clave, "falta la clave");
  assert.match(clave[1], /workspaceId/);
  assert.match(clave[1], /conTurno/);
  assert.doesNotMatch(clave[1], /ahora|desde/, "la clave no incluye la hora: pagina y cron comparten la lectura");
  assert.doesNotMatch(chats, /prisma\.\$queryRaw/);
});

await prueba("vueltas.ts: el cron del Supervisor pide modo \"cron\"", () => {
  const fuente = leerFuente("src/features/supervisor/servicios/vueltas.ts");
  assert.match(fuente, /leerChatsAbiertos\(\{[^}]*modo: "cron"[^}]*\}\)/);
});

await prueba("equipo/page.tsx: la ultima conexion y la ultima accion llegan aparte, en un Suspense", () => {
  const fuente = leerFuente("src/app/cliente/equipo/page.tsx");
  assert.match(fuente, /<Suspense/);
  const inicio = fuente.indexOf("await Promise.all([");
  assert.ok(inicio >= 0, "falta el await Promise.all([");
  const fin = fuente.indexOf("]);", inicio);
  assert.ok(fin > inicio, "falta el cierre ]); del Promise.all");
  const bloque = fuente.slice(inicio, fin);
  assert.doesNotMatch(bloque, /leerActividadDelEquipo\(/, "la ultima conexion no se espera en el Promise.all");
  assert.doesNotMatch(bloque, /ultimaAccionEnCache\(/, "la ultima accion no se espera en el Promise.all");
  // Las dos se arrancan en page.tsx, sin await, y las espera el componente de servidor.
  assert.match(fuente, /leerActividadDelEquipo\(access\.workspaceId\)\.catch\(/);
  assert.match(fuente, /ultimaAccionEnCache\(/);
  assert.match(fuente, /<UltimaAccionDelEquipo\b/);
  const componente = leerFuente("src/app/cliente/equipo/ultima-accion-del-equipo.tsx");
  assert.doesNotMatch(componente, /^["']use client["']/m, "es un componente de servidor");
  assert.match(componente, /export async function UltimaAccionDelEquipo\(/);
});

console.log(`\n${pruebas} pruebas pasaron.`);
