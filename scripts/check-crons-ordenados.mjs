/**
 * Prueba, sin base, de los crons ordenados (src/lib/candado-de-cron.ts y /api/cron/follows):
 *   node scripts/check-crons-ordenados.mjs
 *
 * Parte A (con una conexión de candados de mentira que imita pg_try_advisory_lock / pg_advisory_unlock):
 * 1. Si se lanza dos veces seguidas el mismo trabajo lento, el segundo se salta.
 * 2. Si otro proceso tiene el candado (la base dice false), el trabajo se salta.
 * 3. El candado se suelta aunque el trabajo dé error, y el error llega igual a quien llamó.
 * 4. Si la conexión de candados falla, el trabajo corre igual, se cierra la conexión y se pide otra.
 * 5. El SQL usa hashtext('cron:'||$1) y nada de Postgres 16.
 * 6. route.ts tiene 25 o más `conCandado` y el compose tiene 4 `--max-time 55`.
 *
 * Las partes B, C y D le agregan casos a este mismo archivo.
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

/* ── Registro de lo que se escribe en la consola ── */
const lineas = [];
const original = { log: console.log, warn: console.warn };
function capturar() {
  lineas.length = 0;
  console.log = (...args) => lineas.push(args.join(" "));
  console.warn = (...args) => lineas.push(args.join(" "));
}
function soltarConsola() {
  console.log = original.log;
  console.warn = original.warn;
}

/* ── Postgres de mentira: los candados son por sesión, como en Postgres ── */
const candadosTomados = new Map(); // nombre -> sesión que lo tiene
let sesiones = 0;
let conexionesCerradas = 0;
const sqls = [];

function crearConexion({ fallaAlConectar = false, fallaAlTomar = false } = {}) {
  return async () => {
    if (fallaAlConectar) throw new Error("connect ECONNREFUSED");
    const sesion = ++sesiones;
    let cerrada = false;
    return {
      async query(sql, valores) {
        sqls.push(sql);
        if (cerrada) throw new Error("Client was closed and is not queryable");
        if (fallaAlTomar) throw new Error("Connection terminated unexpectedly");
        const [nombre] = valores;
        if (sql.includes("pg_try_advisory_lock")) {
          const duenia = candadosTomados.get(nombre);
          if (duenia !== undefined && duenia !== sesion) return { rows: [{ tomado: false }] };
          candadosTomados.set(nombre, sesion);
          return { rows: [{ tomado: true }] };
        }
        if (sql.includes("pg_advisory_unlock")) {
          const soltado = candadosTomados.get(nombre) === sesion;
          if (soltado) candadosTomados.delete(nombre);
          return { rows: [{ soltado }] };
        }
        throw new Error(`SQL inesperado: ${sql}`);
      },
      async end() {
        cerrada = true;
        conexionesCerradas += 1;
        // Al cerrarse la sesión, Postgres suelta solo sus candados.
        for (const [nombre, duenia] of candadosTomados) if (duenia === sesion) candadosTomados.delete(nombre);
      },
    };
  };
}

function reiniciar() {
  candadosTomados.clear();
  sesiones = 0;
  conexionesCerradas = 0;
  sqls.length = 0;
}

const pgFalso = {
  Client: class {
    constructor() {
      throw new Error("la prueba no debe abrir una conexión real");
    }
  },
};
const { conCandado, reemplazarConexionDeCandados, trabajosEnCurso, PAUSA_TRAS_FALLA_MS } = cargar("src/lib/candado-de-cron.ts", {
  pg: pgFalso,
});

try {
  await prueba("dos veces seguidas el mismo trabajo lento: el segundo se salta", async () => {
    reiniciar();
    reemplazarConexionDeCandados(crearConexion());
    capturar();
    let corridas = 0;
    const lento = async () => {
      corridas += 1;
      await esperar(80);
      return "listo";
    };
    const primera = conCandado("lento", lento);
    await esperar(5);
    const segunda = await conCandado("lento", lento);
    assert.equal(segunda, null, "la segunda se salta y devuelve null");
    assert.deepEqual(trabajosEnCurso(), ["lento"]);
    assert.equal(await primera, "listo");
    soltarConsola();
    assert.equal(corridas, 1);
    assert.ok(lineas.includes("[cron] saltado: lento sigue corriendo"), lineas.join("\n"));
    assert.ok(lineas.some((l) => /^\[cron\] lento ms=\d+$/.test(l)), lineas.join("\n"));
    assert.deepEqual(trabajosEnCurso(), []);
    assert.equal(candadosTomados.size, 0, "al terminar el candado queda suelto");
    // Terminado el primero, una vuelta nueva lo vuelve a correr.
    assert.equal(await conCandado("lento", lento), "listo");
    assert.equal(corridas, 2);
    assert.equal(sesiones, 1, "una sola conexión para todos los candados");
  });

  await prueba("trabajos distintos no se frenan entre sí", async () => {
    reiniciar();
    reemplazarConexionDeCandados(crearConexion());
    capturar();
    const [a, b] = await Promise.all([
      conCandado("a", async () => {
        await esperar(30);
        return 1;
      }),
      conCandado("b", async () => 2),
    ]);
    soltarConsola();
    assert.deepEqual([a, b], [1, 2]);
    assert.equal(candadosTomados.size, 0);
  });

  await prueba("otro proceso tiene el candado: se salta", async () => {
    reiniciar();
    reemplazarConexionDeCandados(crearConexion());
    candadosTomados.set("ocupado", 999); // lo tiene otra sesión
    capturar();
    let corrio = false;
    const resultado = await conCandado("ocupado", async () => {
      corrio = true;
    });
    soltarConsola();
    assert.equal(resultado, null);
    assert.equal(corrio, false);
    assert.ok(lineas.includes("[cron] saltado: ocupado sigue corriendo"), lineas.join("\n"));
    assert.equal(candadosTomados.get("ocupado"), 999, "no suelta un candado ajeno");
    assert.deepEqual(trabajosEnCurso(), []);
  });

  await prueba("el candado se suelta aunque el trabajo dé error", async () => {
    reiniciar();
    reemplazarConexionDeCandados(crearConexion());
    capturar();
    await assert.rejects(
      conCandado("con-error", async () => {
        throw new Error("falló el trabajo");
      }),
      /falló el trabajo/,
    );
    soltarConsola();
    assert.equal(candadosTomados.size, 0, "candado suelto");
    assert.deepEqual(trabajosEnCurso(), [], "fuera de la lista");
    assert.ok(sqls.some((s) => s.includes("pg_advisory_unlock")));
    assert.ok(lineas.some((l) => /^\[cron\] con-error ms=\d+$/.test(l)), lineas.join("\n"));
    // Y la vuelta siguiente lo puede volver a correr.
    capturar();
    assert.equal(await conCandado("con-error", async () => "otra vez"), "otra vez");
    soltarConsola();
  });

  await prueba("falla la conexión de candados: el trabajo corre igual y se pide otra la próxima vez", async () => {
    reiniciar();
    let reloj = 1_000_000;
    let falla = true;
    const fabricaQueFalla = crearConexion({ fallaAlConectar: true });
    const fabricaBuena = crearConexion();
    reemplazarConexionDeCandados(() => (falla ? fabricaQueFalla() : fabricaBuena()), () => reloj);
    capturar();
    assert.equal(await conCandado("sin-base", async () => "corrió"), "corrió");
    soltarConsola();
    assert.ok(lineas.some((l) => l.startsWith("[cron] sin candado para sin-base (corre igual)")), lineas.join("\n"));
    assert.ok(lineas.some((l) => /^\[cron\] sin-base ms=\d+$/.test(l)));
    // Durante la pausa corre sin pedir conexión.
    falla = false;
    capturar();
    assert.equal(await conCandado("sin-base", async () => "corrió"), "corrió");
    soltarConsola();
    assert.equal(sesiones, 0, "en la pausa no pide conexión");
    // Pasada la pausa, pide una nueva y vuelve a usar candado.
    reloj += PAUSA_TRAS_FALLA_MS + 1;
    capturar();
    assert.equal(await conCandado("sin-base", async () => "corrió"), "corrió");
    soltarConsola();
    assert.equal(sesiones, 1);
    assert.ok(sqls.some((s) => s.includes("pg_try_advisory_lock")));
  });

  await prueba("la conexión se corta al pedir el candado: corre igual y la conexión se cierra", async () => {
    reiniciar();
    reemplazarConexionDeCandados(crearConexion({ fallaAlTomar: true }));
    capturar();
    assert.equal(await conCandado("cortada", async () => 7), 7);
    await esperar(0);
    soltarConsola();
    assert.equal(conexionesCerradas, 1, "se cerró la conexión que falló");
    assert.ok(lineas.some((l) => l.startsWith("[cron] sin candado para cortada (corre igual)")));
    assert.deepEqual(trabajosEnCurso(), []);
  });

  await prueba("SQL: hashtext('cron:'||$1), sin funciones de Postgres 16", () => {
    const fuente = fs.readFileSync(path.join(RAIZ, "src/lib/candado-de-cron.ts"), "utf8");
    assert.match(fuente, /pg_try_advisory_lock\(hashtext\('cron:' \|\| \$1\)\)/);
    assert.match(fuente, /pg_advisory_unlock\(hashtext\('cron:' \|\| \$1\)\)/);
    assert.match(fuente, /cliente\.on\("error"/, "la conexión escucha 'error' para no tumbar el proceso");
    // Que no use nada de Postgres 16 lo revisa test:sql-version-postgres, que mira todo src/.
  });

  await prueba("route.ts tiene 25 o más conCandado", () => {
    const ruta = fs.readFileSync(path.join(RAIZ, "src/app/api/cron/follows/route.ts"), "utf8");
    const lineasConCandado = ruta.split("\n").filter((l) => l.includes("conCandado")).length;
    assert.ok(lineasConCandado >= 25, `solo ${lineasConCandado}`);
    // Ningún trabajo se llama directo sin candado (el import y el llamado dentro de conCandado no cuentan).
    for (const trabajo of ["executePendingFollows", "ejecutarSeguimientosV3", "procesarTandasDeCampanas", "transcribirAudiosPendientes", "vueltaDeCadaHora"]) {
      const directo = new RegExp(`await ${trabajo}\\(`);
      assert.ok(!directo.test(ruta), `${trabajo} se llama sin conCandado`);
    }
    const nombres = [...ruta.matchAll(/conCandado\("([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(nombres).size, nombres.length, "cada trabajo tiene su propio nombre");
  });

  await prueba("el compose tiene 4 --max-time 55", () => {
    const compose = fs.readFileSync(path.join(RAIZ, "docker-compose.portainer.yml"), "utf8");
    assert.equal((compose.match(/max-time 55/g) ?? []).length, 4);
    assert.equal((compose.match(/curl -sS -X POST(?! --max-time 55)/g) ?? []).length, 0, "algún curl quedó sin tope");
  });
} finally {
  soltarConsola();
  reemplazarConexionDeCandados(null);
}

console.log(`\n${pruebas} pruebas de crons ordenados pasaron.`);
