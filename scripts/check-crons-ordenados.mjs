/**
 * Prueba, sin base, de los crons ordenados (parte A: src/lib/candado-de-cron.ts y /api/cron/follows):
 *   node scripts/check-crons-ordenados.mjs
 *
 * Con una conexión de candados de mentira (guarda los candados tomados como lo haría Postgres):
 * 1. Si se lanza dos veces seguidas el mismo trabajo lento, el segundo se salta.
 * 2. El candado se suelta aunque el trabajo dé error (y el error sale igual).
 * 3. Si otro proceso tiene el candado (pg_try_advisory_lock da false), se salta.
 * 4. Si la conexión de candados falla, el trabajo corre igual y la próxima vez se pide otra.
 * 5. Solo usa funciones de Postgres que existen antes de la 16.
 * 6. route.ts tiene 25 o más conCandado y el compose tiene 4 `--max-time 55`.
 *
 * Las partes B, C y D de «Crons ordenados» le agregan casos a esta misma prueba.
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

/* ── Conexión de candados de mentira ── */
const tomadosEnLaBase = new Set(); // candados que la "base" tiene tomados por cualquier sesión
const consultas = [];
let conexionesAbiertas = 0;
let conexionesCerradas = 0;
let fallarAlConectar = false;
let fallarLaConsulta = false;

function fabricaDeMentira() {
  conexionesAbiertas += 1;
  if (fallarAlConectar) return Promise.reject(new Error("ECONNREFUSED de mentira"));
  return Promise.resolve({
    async query(sql, [nombre]) {
      consultas.push({ sql, nombre });
      if (fallarLaConsulta) throw new Error("Connection terminated unexpectedly (de mentira)");
      if (sql.includes("pg_try_advisory_lock")) {
        if (tomadosEnLaBase.has(nombre)) return { rows: [{ tomado: false }] };
        tomadosEnLaBase.add(nombre);
        return { rows: [{ tomado: true }] };
      }
      if (sql.includes("pg_advisory_unlock")) return { rows: [{ soltado: tomadosEnLaBase.delete(nombre) }] };
      throw new Error(`consulta inesperada: ${sql}`);
    },
    async end() {
      conexionesCerradas += 1;
    },
  });
}

const { conCandado, reemplazarConexionDeCandados, trabajosEnCurso } = cargar("src/lib/candado-de-cron.ts", {
  pg: {
    Client: function ClienteProhibido() {
      throw new Error("la prueba no debe abrir una conexión real");
    },
  },
});

function reiniciar() {
  tomadosEnLaBase.clear();
  consultas.length = 0;
  conexionesAbiertas = 0;
  conexionesCerradas = 0;
  fallarAlConectar = false;
  fallarLaConsulta = false;
  reemplazarConexionDeCandados(fabricaDeMentira);
}

/* Captura lo que se escribe en el registro sin ensuciar la salida de la prueba. */
async function conRegistro(fn) {
  const lineas = [];
  const original = { log: console.log, warn: console.warn };
  console.log = (...a) => lineas.push(a.map(String).join(" "));
  console.warn = (...a) => lineas.push(`AVISO ${a.map(String).join(" ")}`);
  try {
    await fn(lineas);
  } finally {
    console.log = original.log;
    console.warn = original.warn;
  }
  return lineas;
}

await prueba("dos veces seguidas el mismo trabajo lento: el segundo se salta", async () => {
  reiniciar();
  let corridas = 0;
  const lento = async () => {
    corridas += 1;
    await esperar(60);
    return "listo";
  };
  const lineas = await conRegistro(async () => {
    const primera = conCandado("trabajo-lento", lento);
    const segunda = conCandado("trabajo-lento", lento);
    assert.equal(await segunda, null, "la segunda se salta y devuelve null");
    assert.equal(await primera, "listo");
  });
  assert.equal(corridas, 1, "el trabajo corrió una sola vez");
  assert.ok(lineas.includes("[cron] saltado: trabajo-lento sigue corriendo"), lineas.join("\n"));
  assert.ok(lineas.some((l) => /^\[cron\] trabajo-lento ms=\d+$/.test(l)), lineas.join("\n"));
  assert.deepEqual(trabajosEnCurso(), []);
  assert.equal(tomadosEnLaBase.size, 0, "el candado quedó suelto");
  assert.equal(conexionesAbiertas, 1, "una sola conexión para todos los candados");

  // Ya terminado, la vuelta siguiente sí corre.
  await conRegistro(() => conCandado("trabajo-lento", lento));
  assert.equal(corridas, 2);
});

await prueba("trabajos distintos corren a la vez, sobre la misma conexión", async () => {
  reiniciar();
  const enParalelo = [];
  await conRegistro(() =>
    Promise.all(
      ["a", "b", "c"].map((n) =>
        conCandado(n, async () => {
          enParalelo.push(n);
          await esperar(20);
        }),
      ),
    ),
  );
  assert.deepEqual(enParalelo.sort(), ["a", "b", "c"]);
  assert.equal(conexionesAbiertas, 1);
  assert.equal(tomadosEnLaBase.size, 0);
});

await prueba("el candado se suelta aunque el trabajo dé error", async () => {
  reiniciar();
  await conRegistro(async () => {
    await assert.rejects(
      conCandado("trabajo-que-falla", async () => {
        throw new Error("falla del trabajo");
      }),
      /falla del trabajo/,
    );
  });
  assert.equal(tomadosEnLaBase.size, 0, "el candado de la base quedó suelto");
  assert.deepEqual(trabajosEnCurso(), [], "y la lista en memoria también");
  assert.deepEqual(
    consultas.map((c) => c.sql.includes("unlock")),
    [false, true],
    "tomó y soltó el candado",
  );
  let corrio = false;
  await conRegistro(() =>
    conCandado("trabajo-que-falla", () => {
      corrio = true;
    }),
  );
  assert.ok(corrio, "la vuelta siguiente corre");
});

await prueba("si otro proceso tiene el candado, se salta la vuelta", async () => {
  reiniciar();
  tomadosEnLaBase.add("en-otro-proceso");
  let corrio = false;
  const lineas = await conRegistro(async () => {
    const resultado = await conCandado("en-otro-proceso", () => {
      corrio = true;
    });
    assert.equal(resultado, null);
  });
  assert.equal(corrio, false);
  assert.ok(lineas.includes("[cron] saltado: en-otro-proceso sigue corriendo"), lineas.join("\n"));
  assert.ok(!lineas.some((l) => l.includes("ms=")), "uno saltado no deja la línea ms=");
  assert.ok(!consultas.some((c) => c.sql.includes("unlock")), "no suelta un candado que no tomó");
  assert.deepEqual(trabajosEnCurso(), []);
});

await prueba("si la conexión no abre, el trabajo corre igual (sin candado) y la próxima vez se pide otra", async () => {
  reiniciar();
  fallarAlConectar = true;
  let corridas = 0;
  const lineas = await conRegistro(async () => {
    assert.equal(await conCandado("sin-base", () => (corridas += 1)), 1);
    // Dentro de la misma vuelta no se insiste: no se demora cada trabajo esperando a la base.
    assert.equal(await conCandado("otro-sin-base", () => (corridas += 1)), 2);
  });
  assert.equal(corridas, 2);
  assert.equal(conexionesAbiertas, 1, "no reintenta en cada trabajo");
  assert.ok(lineas.some((l) => l.startsWith("AVISO [cron] no se pudo abrir la conexión de candados")), lineas.join("\n"));
  assert.deepEqual(trabajosEnCurso(), []);

  // La lista en memoria sigue frenando la copia doble aunque no haya base.
  let lentas = 0;
  await conRegistro(async () => {
    const p1 = conCandado("lento-sin-base", async () => {
      lentas += 1;
      await esperar(30);
    });
    assert.equal(await conCandado("lento-sin-base", async () => (lentas += 1)), null);
    await p1;
  });
  assert.equal(lentas, 1);
});

await prueba("si la consulta del candado falla, el trabajo corre igual y se cierra esa conexión", async () => {
  reiniciar();
  fallarLaConsulta = true;
  let corrio = false;
  const lineas = await conRegistro(() =>
    conCandado("consulta-rota", () => {
      corrio = true;
    }),
  );
  await esperar(0);
  assert.ok(corrio);
  assert.equal(conexionesCerradas, 1, "cerró la conexión rota");
  assert.ok(lineas.some((l) => l.startsWith("AVISO [cron] falló el candado de consulta-rota")), lineas.join("\n"));

  // Pasada la espera, se pide una conexión nueva y vuelve a usar candados.
  reemplazarConexionDeCandados(fabricaDeMentira);
  fallarLaConsulta = false;
  consultas.length = 0;
  await conRegistro(() => conCandado("consulta-rota", () => {}));
  assert.equal(consultas.length, 2, "tomó y soltó con la conexión nueva");
});

await prueba("si soltar falla, se cierra la conexión (Postgres suelta solo sus candados)", async () => {
  reiniciar();
  await conRegistro(() =>
    conCandado("soltar-falla", () => {
      fallarLaConsulta = true;
    }),
  );
  await esperar(0);
  assert.equal(conexionesCerradas, 1);
  assert.deepEqual(trabajosEnCurso(), []);
});

const fuente = fs.readFileSync(path.join(RAIZ, "src/lib/candado-de-cron.ts"), "utf8");

await prueba("solo funciones de Postgres anteriores a la 16", () => {
  assert.match(fuente, /SELECT pg_try_advisory_lock\(hashtext\('cron:' \|\| \$1\)\)/);
  assert.match(fuente, /pg_advisory_unlock\(hashtext\('cron:' \|\| \$1\)\)/);
  for (const prohibida of ["pg_input_is_valid", "pg_input_error_info", "any_value", "json_object(", "json_array(", "IS JSON"]) { // sql-version-ok: lo que el candado NO debe usar
    assert.ok(!fuente.includes(prohibida), `usa ${prohibida} (Postgres 16)`);
  }
  assert.match(fuente, /cliente\.on\("error"/, "la conexión escucha 'error' para no tumbar el proceso");
});

await prueba("route.ts envuelve los trabajos en conCandado (25 o más)", () => {
  const ruta = fs.readFileSync(path.join(RAIZ, "src/app/api/cron/follows/route.ts"), "utf8");
  const veces = (ruta.match(/conCandado/g) ?? []).length;
  assert.ok(veces >= 25, `route.ts tiene ${veces} conCandado`);
  assert.match(ruta, /import \{ conCandado \} from "@\/lib\/candado-de-cron";/);
  // Ningún trabajo quedó sin envolver: cada `await <trabajo>()` del reloj va dentro de conCandado.
  // (lo que va dentro de un `conCandado("x", async () => { ... })` de varias líneas ya está envuelto).
  const sinBloques = ruta.replace(/conCandado\("[^"]+", async \(\) => \{[\s\S]*?\n\s*\}\)/g, "conCandado()");
  const sueltos = sinBloques.split("\n").filter((l) => /^\s*(?:[\w.]+\s*=\s*)?await (?!conCandado)\w+\(/.test(l));
  assert.deepEqual(sueltos, [], `trabajos sin candado:\n${sueltos.join("\n")}`);
});

await prueba("docker-compose.portainer.yml: los 4 curl cortan a los 55 s", () => {
  const compose = fs.readFileSync(path.join(RAIZ, "docker-compose.portainer.yml"), "utf8");
  assert.equal((compose.match(/max-time 55/g) ?? []).length, 4);
  assert.equal((compose.match(/curl -sS -X POST(?! --max-time 55)/g) ?? []).length, 0, "un curl quedó sin tope");
});

reemplazarConexionDeCandados(null);
console.log(`\n${pruebas} pruebas pasaron`);
