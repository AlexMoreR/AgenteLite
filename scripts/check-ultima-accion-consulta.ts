import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  claveDeUltimaAccion,
  crearUltimaAccionEnCache,
  type EntradaDeUltimaAccion,
} from "../src/features/actividad/services/ultima-accion-en-cache";
import type { UltimaAccion } from "../src/features/actividad/services/ultima-accion";

// La consulta de la última acción por persona (pantalla Equipo) no puede volver a recorrer todos los
// mensajes de 30 días: va por persona, por el índice parcial, con LIMIT 1 y con tope de 5 s.
const raiz = path.resolve(__dirname, "..");
const actividad = fs.readFileSync(path.join(raiz, "src/features/actividad/services/actividad.ts"), "utf8");

const inicio = actividad.indexOf("export async function ultimaAccionPorPersona");
assert.ok(inicio >= 0, "actividad.ts debe tener ultimaAccionPorPersona");
const fin = actividad.indexOf("\nexport async function", inicio + 1);
const funcion = actividad.slice(inicio, fin === -1 ? undefined : fin);

assert.ok(!actividad.includes('DISTINCT ON (m."rawPayload"'), 'actividad.ts no debe usar DISTINCT ON (m."rawPayload"...)');
for (const pedazo of ["LATERAL", "LIMIT 1", '"workspaceId" =', '"createdAt" >=', "statement_timeout"]) {
  assert.ok(funcion.includes(pedazo), `ultimaAccionPorPersona debe tener ${pedazo}`);
}
assert.ok(funcion.includes("userIds: string[]"), "ultimaAccionPorPersona debe recibir userIds");
assert.match(funcion, /userIds\.length === 0\) return new Map\(\)/, "sin personas no se consulta");
assert.match(funcion, /SET LOCAL statement_timeout = '5s'/, "el tope es de 5 s");
assert.match(funcion, /console\.warn/, "si falla o se pasa de tiempo, avisa y devuelve un Map vacío");

// La migración: solo BEGIN, dos CREATE INDEX IF NOT EXISTS y COMMIT (los comentarios no cuentan).
const migracion = fs.readFileSync(
  path.join(raiz, "prisma/migrations/20261125000000_indices_ultima_accion/migration.sql"),
  "utf8",
);
const sentencias = migracion
  .split("\n")
  .filter((linea) => !linea.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((sentencia) => sentencia.replace(/\s+/g, " ").trim())
  .filter(Boolean);
assert.equal(sentencias.length, 4, "la migración tiene 4 sentencias");
assert.equal(sentencias[0], "BEGIN");
assert.equal(sentencias[3], "COMMIT");
assert.ok(sentencias[1].startsWith('CREATE INDEX IF NOT EXISTS "Message_ultima_accion_enviado_idx" ON "Message"'));
assert.ok(sentencias[2].startsWith('CREATE INDEX IF NOT EXISTS "Message_ultima_accion_actor_idx" ON "Message"'));
assert.doesNotMatch(migracion, /drop|delete|update|truncate|rename/i, "la migración solo agrega");

// --- La cache de 2 minutos (ultima-accion-en-cache.ts), con un consultor y un reloj falsos. ---
async function pruebasDeLaCache() {
  let reloj = 1_000_000;
  const ahora = () => reloj;
  const pedidos: EntradaDeUltimaAccion[] = [];
  const accion: UltimaAccion = { tipo: "mensaje", texto: "Envió un mensaje", cliente: "Ana", cuando: new Date(0) };
  let soltar: () => void = () => {};
  const consultar = async (entrada: EntradaDeUltimaAccion) => {
    pedidos.push(entrada);
    // La consulta "tarda" 250 ms de reloj y espera a que la prueba la suelte.
    await new Promise<void>((resolver) => (soltar = resolver));
    reloj += 250;
    return new Map([[entrada.userIds[0], accion]]);
  };
  const registros: string[] = [];
  const infoOriginal = console.info;
  const warnOriginal = console.warn;
  console.info = (mensaje: string) => registros.push(mensaje);
  console.warn = () => {};
  try {
    const ultimaAccionEnCache = crearUltimaAccionEnCache({ consultar, ahora });

    // La clave: el negocio más los userIds ordenados y sin repetir.
    assert.equal(claveDeUltimaAccion({ workspaceId: "w1", userIds: ["b", "a", "b"] }), "w1|a,b");
    assert.equal(
      claveDeUltimaAccion({ workspaceId: "w1", userIds: ["a", "b"] }),
      claveDeUltimaAccion({ workspaceId: "w1", userIds: ["b", "a"] }),
    );

    // Diez aperturas a la vez: una sola consulta (se guarda la promesa en curso).
    const diez = Array.from({ length: 10 }, (_, i) =>
      ultimaAccionEnCache({ workspaceId: "w1", userIds: i % 2 ? ["b", "a"] : ["a", "b"] }),
    );
    await new Promise((resolver) => setImmediate(resolver));
    assert.equal(pedidos.length, 1, "diez aperturas a la vez hacen una sola consulta");
    soltar();
    const resultados = await Promise.all(diez);
    const guardadaEn = reloj;
    assert.ok(resultados.every((r) => r.get("a") === accion));
    assert.deepEqual(pedidos[0], { workspaceId: "w1", userIds: ["a", "b"] });
    assert.deepEqual(registros, ["[equipo] ultima-accion ms=250 personas=2"], "registra el tiempo real de la consulta");

    // La misma clave dentro de los 2 minutos: sale de la cache, sin consultar ni registrar.
    reloj = guardadaEn + 119_000;
    const deCache = await ultimaAccionEnCache({ workspaceId: "w1", userIds: ["b", "a"] });
    assert.equal(deCache.get("a"), accion);
    assert.equal(pedidos.length, 1, "la misma clave en 2 minutos hace una sola consulta");
    assert.equal(registros.length, 1, "lo que sale de la cache no se registra");

    // Otro negocio es otra clave.
    const otro = ultimaAccionEnCache({ workspaceId: "w2", userIds: ["a", "b"] });
    await new Promise((resolver) => setImmediate(resolver));
    soltar();
    await otro;
    assert.equal(pedidos.length, 2, "otro negocio consulta aparte");

    // A los 2 min y 1 s de guardada vuelve a consultar.
    reloj = guardadaEn + 121_000;
    const vencida = ultimaAccionEnCache({ workspaceId: "w1", userIds: ["a", "b"] });
    await new Promise((resolver) => setImmediate(resolver));
    assert.equal(pedidos.length, 3, "a los 2 min y 1 s vuelve a consultar");
    soltar();
    await vencida;

    // Sin personas no se consulta.
    assert.equal((await ultimaAccionEnCache({ workspaceId: "w1", userIds: [] })).size, 0);
    assert.equal(pedidos.length, 3);

    // Si el consultor lanza un error: Map vacío, y no se guarda (la siguiente vuelve a consultar).
    let fallas = 0;
    const conError = crearUltimaAccionEnCache({
      ahora,
      consultar: async () => {
        fallas += 1;
        throw new Error("canceling statement due to statement timeout");
      },
    });
    const vacio = await conError({ workspaceId: "w1", userIds: ["a"] });
    assert.ok(vacio instanceof Map && vacio.size === 0, "si el consultor falla sale un Map vacío");
    await conError({ workspaceId: "w1", userIds: ["a"] });
    assert.equal(fallas, 2, "el error no se guarda en la cache");

    // Si el consultor se pasa de tiempo (no contesta): Map vacío al llegar al tope, y no se guarda.
    let colgadas = 0;
    const colgado = crearUltimaAccionEnCache({
      ahora,
      topeMs: 20,
      consultar: () => {
        colgadas += 1;
        return new Promise(() => {});
      },
    });
    const tarde = await colgado({ workspaceId: "w1", userIds: ["a"] });
    assert.ok(tarde instanceof Map && tarde.size === 0, "si se pasa de tiempo sale un Map vacío");
    await colgado({ workspaceId: "w1", userIds: ["a"] });
    assert.equal(colgadas, 2, "el tiempo agotado no se guarda en la cache");
    assert.equal(registros.length, 3, "las fallas no registran ms como si hubieran consultado");
  } finally {
    console.info = infoOriginal;
    console.warn = warnOriginal;
  }
}

// La pantalla Equipo usa la cache, no la consulta directa.
const pagina = fs.readFileSync(path.join(raiz, "src/app/cliente/equipo/page.tsx"), "utf8");
assert.match(pagina, /ultimaAccionEnCache\(/, "Equipo llama a ultimaAccionEnCache");
assert.doesNotMatch(pagina, /ultimaAccionPorPersona/, "Equipo ya no llama a ultimaAccionPorPersona directo");

pruebasDeLaCache()
  .then(() => console.log("pruebas de la consulta de la última acción: OK"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
