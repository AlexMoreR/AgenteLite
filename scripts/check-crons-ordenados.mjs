/**
 * Prueba, sin base, de los crons ordenados (src/lib/candado-de-cron.ts y el reloj):
 *   node scripts/check-crons-ordenados.mjs
 *
 * Parte A (con una conexión de candados de mentira que imita pg_try_advisory_lock / pg_advisory_unlock):
 * 1. Si se lanza dos veces seguidas el mismo trabajo lento, el segundo se salta.
 * 2. Si el candado de Postgres lo tiene otro proceso, el trabajo se salta.
 * 3. El candado se suelta aunque el trabajo dé error (y el error sale igual).
 * 4. Si la conexión de candados falla, el trabajo corre igual y la próxima vez se pide otra conexión.
 * 5. Las líneas [cron] <trabajo> ms=<n> y [cron] saltado: <trabajo> sigue corriendo.
 * 6. route.ts tiene 25 o más conCandado; el compose tiene 4 "max-time 55"; nada de Postgres 16.
 *
 * Parte B: el caso de la bienvenida del rescate corre en los minutos % 5 == 4, mira 150 chats y sus 3 groupBy
 * llevan el filtro createdAt.
 *
 * Parte C: leerFichasRecientes mira como mucho 1.500 chats y 300 mensajes por chat, dentro de consultaPesada
 * de cron; el lateral "hum" de leerChatsAbiertos mira solo 30 días.
 *
 * La parte D le agrega casos a esta misma prueba.
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
const leer = (archivo) => fs.readFileSync(path.join(RAIZ, archivo), "utf8");

/* ── Postgres de mentira: los candados de cada sesión, como los advisory locks ── */
const tomadosPorOtro = new Set(); // candados que tiene "otro proceso"
const sentencias = [];
let conexionesAbiertas = 0;
let conexionesCerradas = 0;
let fallarProxima = false;

function nuevaConexion() {
  conexionesAbiertas += 1;
  const mios = new Set();
  return {
    query: async (sql, [nombre]) => {
      sentencias.push(`${sql.includes("unlock") ? "soltar" : "tomar"}:${nombre}`);
      if (fallarProxima) {
        fallarProxima = false;
        throw new Error("Connection terminated unexpectedly");
      }
      assert.match(sql, /hashtext\('cron:' \|\| \$1::text\)/);
      if (sql.includes("pg_try_advisory_lock")) {
        if (tomadosPorOtro.has(nombre)) return { rows: [{ tomado: false }] };
        mios.add(nombre);
        return { rows: [{ tomado: true }] };
      }
      assert.match(sql, /pg_advisory_unlock/);
      const estaba = mios.delete(nombre);
      return { rows: [{ soltado: estaba }] };
    },
    end: async () => {
      conexionesCerradas += 1;
      mios.clear();
    },
    mios,
  };
}

let ultimaConexion = null;
const candado = cargar("src/lib/candado-de-cron.ts");
const { conCandado, usarConexionDeCandados, trabajosEnCurso } = candado;

async function reiniciar() {
  usarConexionDeCandados(async () => {
    ultimaConexion = nuevaConexion();
    return ultimaConexion;
  });
  await esperar(0); // deja cerrar la conexión de la prueba anterior antes de poner los contadores en cero
  tomadosPorOtro.clear();
  sentencias.length = 0;
  conexionesAbiertas = 0;
  conexionesCerradas = 0;
  fallarProxima = false;
}

/* ── Captura de los registros ── */
const registros = [];
const originales = { info: console.info, warn: console.warn };
console.info = (...args) => registros.push(args.join(" "));
console.warn = (...args) => registros.push(args.join(" "));
function restaurarConsola() {
  console.info = originales.info;
  console.warn = originales.warn;
}

try {
  await prueba("dos veces seguidas el mismo trabajo lento: el segundo se salta", async () => {
    await reiniciar();
    registros.length = 0;
    let corridas = 0;
    const lento = async () => {
      corridas += 1;
      await esperar(60);
      return "listo";
    };
    const primera = conCandado("lento", lento);
    const segunda = conCandado("lento", lento);
    assert.deepEqual(trabajosEnCurso(), ["lento"]);
    assert.equal(await segunda, undefined, "el segundo no corre");
    assert.equal(await primera, "listo");
    assert.equal(corridas, 1);
    assert.ok(registros.includes("[cron] saltado: lento sigue corriendo"), registros.join("\n"));
    assert.ok(registros.some((r) => /^\[cron\] lento ms=\d+$/.test(r)), registros.join("\n"));
    assert.deepEqual(trabajosEnCurso(), []);
    assert.deepEqual(sentencias, ["tomar:lento", "soltar:lento"]);
    assert.equal(ultimaConexion.mios.size, 0, "el candado de Postgres quedó suelto");
    // Al terminar, la vuelta siguiente sí corre.
    assert.equal(await conCandado("lento", lento), "listo");
    assert.equal(corridas, 2);
  });

  await prueba("trabajos distintos no se frenan entre sí y comparten UNA conexión", async () => {
    await reiniciar();
    const resultados = await Promise.all([
      conCandado("a", async () => {
        await esperar(20);
        return 1;
      }),
      conCandado("b", async () => 2),
    ]);
    assert.deepEqual(resultados, [1, 2]);
    assert.equal(conexionesAbiertas, 1);
  });

  await prueba("si otro proceso tiene el candado de Postgres, el trabajo se salta", async () => {
    await reiniciar();
    registros.length = 0;
    tomadosPorOtro.add("ocupado");
    let corrio = false;
    assert.equal(
      await conCandado("ocupado", async () => {
        corrio = true;
      }),
      undefined,
    );
    assert.equal(corrio, false);
    assert.ok(registros.includes("[cron] saltado: ocupado sigue corriendo"));
    assert.deepEqual(trabajosEnCurso(), [], "sale de la lista aunque se salte");
    assert.deepEqual(sentencias, ["tomar:ocupado"], "no suelta lo que no tomó");
  });

  await prueba("el candado se suelta aunque el trabajo dé error, y el error sale igual", async () => {
    await reiniciar();
    registros.length = 0;
    await assert.rejects(
      conCandado("con-error", async () => {
        await esperar(5);
        throw new Error("se rompió");
      }),
      /se rompió/,
    );
    assert.deepEqual(sentencias, ["tomar:con-error", "soltar:con-error"]);
    assert.equal(ultimaConexion.mios.size, 0);
    assert.deepEqual(trabajosEnCurso(), []);
    assert.ok(registros.some((r) => /^\[cron\] con-error ms=\d+$/.test(r)));
    // Y la vuelta siguiente vuelve a correr.
    assert.equal(await conCandado("con-error", async () => "otra vez"), "otra vez");
  });

  await prueba("si la conexión de candados falla, el trabajo corre igual y se pide otra conexión", async () => {
    await reiniciar();
    registros.length = 0;
    await conCandado("calentar", async () => null);
    assert.equal(conexionesAbiertas, 1);
    fallarProxima = true;
    let corrio = false;
    assert.equal(
      await conCandado("sin-base", async () => {
        corrio = true;
        return "corrió";
      }),
      "corrió",
    );
    assert.equal(corrio, true);
    assert.ok(registros.some((r) => r.startsWith("[cron] sin candado de Postgres para sin-base")), registros.join("\n"));
    await esperar(0);
    assert.equal(conexionesCerradas, 1, "cerró la conexión rota");
    assert.deepEqual(trabajosEnCurso(), []);
    await conCandado("sin-base", async () => null);
    assert.equal(conexionesAbiertas, 2, "la próxima vez pidió una nueva");
  });

  await prueba("si no se puede abrir la conexión, el trabajo corre igual y se reintenta abrirla", async () => {
    let intentos = 0;
    usarConexionDeCandados(async () => {
      intentos += 1;
      throw new Error("ECONNREFUSED");
    });
    assert.equal(await conCandado("sin-conexion", async () => 7), 7);
    assert.equal(await conCandado("sin-conexion", async () => 8), 8);
    assert.equal(intentos, 2);
    assert.deepEqual(trabajosEnCurso(), []);
  });

  await prueba("si soltar el candado falla, se cierra la conexión (Postgres lo suelta solo) y sigue", async () => {
    await reiniciar();
    registros.length = 0;
    const resultado = await conCandado("soltar-falla", async () => {
      fallarProxima = true; // la siguiente sentencia es el unlock
      return "hecho";
    });
    assert.equal(resultado, "hecho");
    assert.ok(registros.some((r) => r.startsWith("[cron] no se pudo soltar el candado de soltar-falla")));
    await esperar(0);
    assert.equal(conexionesCerradas, 1);
    assert.deepEqual(trabajosEnCurso(), []);
  });

  await prueba("sin DATABASE_URL corre solo con la lista en memoria", async () => {
    usarConexionDeCandados(async () => null);
    const primera = conCandado("solo-memoria", () => esperar(20).then(() => "a"));
    assert.equal(await conCandado("solo-memoria", async () => "b"), undefined);
    assert.equal(await primera, "a");
  });
} finally {
  restaurarConsola();
  usarConexionDeCandados(null);
}

await prueba("el módulo usa un pg.Client propio, perezoso y con listener de error; nada de Postgres 16", () => {
  const fuente = leer("src/lib/candado-de-cron.ts");
  assert.match(fuente, /import \{ Client \} from "pg";/);
  assert.doesNotMatch(fuente, /@\/lib\/prisma/, "fuera del pool de Prisma");
  assert.match(fuente, /SELECT pg_try_advisory_lock\(hashtext\('cron:' \|\| \$1::text\)\)/);
  assert.match(fuente, /pg_advisory_unlock\(hashtext\('cron:' \|\| \$1::text\)\)/);
  assert.match(fuente, /cliente\.on\("error"/);
  assert.match(fuente, /finally \{/);
  assert.doesNotMatch(fuente, /pg_input_is_valid|pg_input_error_info|any_value\(|json_scalar|json_serialize/);
});

await prueba("route.ts envuelve 25 o más trabajos en conCandado, con nombres únicos", () => {
  const reloj = leer("src/app/api/cron/follows/route.ts");
  assert.match(reloj, /import \{ conCandado \} from "@\/lib\/candado-de-cron";/);
  const usos = reloj.match(/conCandado/g)?.length ?? 0;
  assert.ok(usos >= 25, `conCandado aparece ${usos} veces`);
  const nombres = [...reloj.matchAll(/conCandado\("([^"]+)"/g)].map((m) => m[1]);
  assert.ok(nombres.length >= 25, `${nombres.length} trabajos envueltos`);
  assert.equal(new Set(nombres).size, nombres.length, "cada trabajo tiene su propio nombre");
  // Ningún trabajo quedó sin envolver: cada servicio importado se llama solo dentro de conCandado.
  const importados = [...reloj.matchAll(/^import \{ ([^}]+) \} from "@\/(?:features|lib)\/(?!candado-de-cron)/gm)].flatMap((m) =>
    m[1].split(",").map((s) => s.trim()),
  );
  assert.ok(importados.length >= 35, `${importados.length} servicios importados`);
  // El del cerebro son dos llamadas dentro de un mismo candado: se sacan antes de mirar.
  const sinCerebro = reloj.replace(/conCandado\("cerebro", async \(\) => \{[\s\S]*?\}\);/, "");
  assert.notEqual(sinCerebro, reloj, "el cerebro va dentro de su candado");
  for (const servicio of importados) {
    assert.doesNotMatch(sinCerebro, new RegExp(`await ${servicio}\\(`), `${servicio} se llama sin candado`);
  }
});

await prueba("docker-compose.portainer.yml: las 4 llamadas curl cortan a los 55 s", () => {
  const compose = leer("docker-compose.portainer.yml");
  assert.equal(compose.match(/max-time 55/g)?.length, 4);
  assert.equal(compose.match(/curl -sS -X POST --max-time 55 \\/g)?.length, 4);
  assert.equal(compose.match(/curl -sS -X POST/g)?.length, 4, "no quedó ningún curl sin tope");
});

/* ── Parte B: el rescate de chats huérfanos más liviano ── */
await prueba("parte B: el caso de la bienvenida corre solo en los minutos % 5 == 4", () => {
  const { tocaElCasoDeLaBienvenida } = cargar("src/lib/rescate-de-chats-huerfanos.ts", {
    "@/lib/prisma": { prisma: {} },
    "@/lib/reparto-de-leads": { autoAssignConversationToCollaborator: async () => null },
  });
  for (let minuto = 0; minuto < 60; minuto += 1) {
    const hora = new Date(2026, 10, 26, 10, minuto, 30);
    assert.equal(tocaElCasoDeLaBienvenida(hora), minuto % 5 === 4, `minuto ${minuto}`);
  }
});

await prueba("parte B: mira 150 chats, y las 3 groupBy llevan el filtro createdAt", () => {
  const fuente = leer("src/lib/rescate-de-chats-huerfanos.ts");
  assert.match(fuente, /^const CUANTOS_MIRAR_BIENVENIDA = 150;$/m);
  assert.match(fuente, /^const CUANTOS_POR_VUELTA = 15;$/m, "el caso normal no cambia");
  assert.match(fuente, /take: CUANTOS_POR_VUELTA \* 3,/, "el caso normal sigue mirando 45");
  assert.match(fuente, /if \(tocaElCasoDeLaBienvenida\(ahora\)\) \{/);
  // El filtro de la historia: ahora - (48 h + 7 días).
  assert.match(fuente, /HISTORIA_BIENVENIDA_MS = VENTANA_BIENVENIDA_HORAS \* 3_600_000 \+ 7 \* 24 \* 3_600_000;/);
  assert.match(fuente, /const desde = \{ createdAt: \{ gte: new Date\(ahora\.getTime\(\) - HISTORIA_BIENVENIDA_MS\) \} \};/);
  assert.match(fuente, /const vigentes = \{.*\.\.\.desde \};/);
  const consultas = fuente.split("prisma.message.groupBy(").slice(1).map((resto) => resto.slice(0, resto.indexOf("}),")));
  assert.equal(consultas.length, 3, "quedan exactamente 3 groupBy");
  for (const consulta of consultas) {
    assert.match(consulta, /\.\.\.vigentes|\.\.\.desde/, `groupBy sin filtro createdAt:\n${consulta}`);
  }
  // Cuántos escribió la clienta y cuándo fue el último salen de la misma consulta.
  assert.ok(consultas.some((c) => c.includes("_count: { _all: true }") && c.includes("_max: { createdAt: true }")));
});

/* ── Parte C: el supervisor lee menos ── */

/** El cuerpo de una función exportada de `fuente`, hasta la próxima declaración de primer nivel. */
function cuerpoDe(fuente, nombre) {
  const inicio = fuente.indexOf(`export async function ${nombre}(`);
  assert.ok(inicio >= 0, `falta la función ${nombre}`);
  const resto = fuente.slice(inicio + 1);
  const fin = resto.search(/\n(?:export |const |type |function |async function |\/\*\*)/);
  return fin >= 0 ? resto.slice(0, fin) : resto;
}

await prueba("parte C: leerFichasRecientes mira 1.500 chats, 300 mensajes por chat y va en consultaPesada de cron", () => {
  const fuente = leer("src/features/supervisor/servicios/datos.ts");
  assert.match(fuente, /^export const MAX_CHATS_DEL_SUPERVISOR = 1500;$/m);
  assert.match(fuente, /^export const MAX_MENSAJES_POR_CHAT = 300;$/m);
  const fichas = cuerpoDe(fuente, "leerFichasRecientes");
  assert.match(fichas, /consultaPesada\(\{ modo: "cron" \}, async \(tx\) =>/);
  assert.doesNotMatch(fichas, /topeSegundos/, "usa el tope de cron (20 s)");
  assert.doesNotMatch(fichas, /prisma\./, "todo va dentro de la transacción con tope");
  assert.match(fichas, /tx\.conversation\.findMany\(\{[\s\S]*orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\],\s*take: MAX_CHATS_DEL_SUPERVISOR,/);
  assert.match(fichas, /tx\.\$queryRaw/);
  assert.match(fichas, /CROSS JOIN LATERAL \(/);
  assert.match(fichas, /ORDER BY m\."createdAt" DESC\s+LIMIT \$\{MAX_MENSAJES_POR_CHAT\}\) u/, "tope de mensajes por chat");
  assert.match(fichas, /AND m\."createdAt" >= \$\{desde\}/, "sigue la ventana de días");
  assert.match(fichas, /ORDER BY c\."id", u\."createdAt"`/, "la ficha recibe los mensajes de viejo a nuevo");
  assert.doesNotMatch(fichas, /pg_input_is_valid|any_value\(|json_scalar|json_serialize/);
});

await prueba("parte C: leerFichasRecientes, con una base de mentira, pide lo que dice el plan", async () => {
  const llamadas = { consultaPesada: [], findMany: [], sql: [] };
  const conversaciones = [
    { id: "c2", assignedToUserId: null, contact: { metadata: {}, crmStage: "NUEVO" } },
    { id: "c1", assignedToUserId: "u1", contact: { metadata: {}, crmStage: null } },
  ];
  const tx = {
    conversation: {
      findMany: async (args) => {
        llamadas.findMany.push(args);
        return conversaciones;
      },
    },
    $queryRaw: async (sql) => {
      llamadas.sql.push(sql);
      return [];
    },
  };
  const { leerFichasRecientes } = cargar("src/features/supervisor/servicios/datos.ts", {
    "@/lib/prisma": { prisma: { whatsAppChannel: { findMany: async () => [{ id: "linea1" }] } } },
    "@/lib/consulta-pesada": {
      consultaPesada: async (opciones, fn) => {
        llamadas.consultaPesada.push(opciones);
        return fn(tx);
      },
    },
    "@/features/embudo/servicios/config": { leerConfigEmbudo: async () => ({}) },
  });
  const ahora = new Date("2026-11-26T15:00:00Z");
  await leerFichasRecientes({ workspaceId: "w1", ahora, dias: 30 });
  assert.deepEqual(llamadas.consultaPesada, [{ modo: "cron" }]);
  assert.equal(llamadas.findMany.length, 1);
  assert.equal(llamadas.findMany[0].take, 1500);
  assert.deepEqual(llamadas.findMany[0].orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
  assert.deepEqual(llamadas.findMany[0].where.channelId, { in: ["linea1"] });
  assert.equal(llamadas.findMany[0].where.createdAt.gte.toISOString(), "2026-10-27T15:00:00.000Z");
  assert.equal(llamadas.sql.length, 1);
  const { strings, values } = llamadas.sql[0];
  assert.ok(values.includes(300), `el tope de 300 va como parámetro: ${JSON.stringify(values)}`);
  assert.ok(values.includes("c1") && values.includes("c2"));
  assert.match(strings.join("?"), /LIMIT \?\) u/);
});

await prueba("parte C: el lateral \"hum\" de leerChatsAbiertos mira solo 30 días", () => {
  const fuente = leer("src/features/supervisor/servicios/datos.ts");
  const chats = cuerpoDe(fuente, "leerChatsAbiertos");
  const hum = chats.slice(chats.lastIndexOf("LEFT JOIN LATERAL", chats.indexOf(") hum ON true")), chats.indexOf(") hum ON true"));
  assert.match(hum, /AND m\."createdAt" >= NOW\(\) - INTERVAL '30 days'/, hum);
  assert.match(hum, /'manual', 'instance'/, "es el lateral de la respuesta de una persona");
  // Las otras copias de "hum" no cambian (chats excluidos, alertas, MCP).
  const excluidos = cuerpoDe(fuente, "chatsExcluidosDeAtencion");
  assert.doesNotMatch(excluidos, /INTERVAL '30 days'/);
  assert.doesNotMatch(leer("src/features/supervisor/servicios/chats-de-alertas.ts"), /INTERVAL '30 days'/);
});

console.log(`\n${pruebas} pruebas de los crons ordenados: todas pasaron.`);
