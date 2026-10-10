// RELLENO HISTÓRICO DEL EMBUDO (F1) — versión de línea de comandos.
//
// La lógica vive en la app: src/features/embudo/servicios/relleno-motor.ts (motor, sin Next ni
// Prisma) y src/features/embudo/dominio/relleno.ts (reconstrucción pura de cada chat). En
// producción se usa desde /cliente/crm/embudo, sección "Historia" (solo el dueño). Este script
// carga el mismo motor para correrlo a mano en desarrollo o en pruebas.
//
// Por defecto SIMULA: solo cuenta y muestra un resumen. Para escribir hay que pasar --escribir.
// Solo escribe en EmbudoEvento/EmbudoLead; idempotente por claveUnica.
//
// Uso:
//   node scripts/embudo-backfill.mjs --workspace <id> --linea <id o nombre> --desde 2026-10-01 --hasta 2026-10-09
//   node scripts/embudo-backfill.mjs ... --escribir         (inserta los eventos y recalcula los leads)
//   node scripts/embudo-backfill.mjs ... --limite 50        (solo los primeros 50 chats)
// Lee DATABASE_URL del entorno (o de .env). Necesita las dependencias de desarrollo (typescript).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const requireNativo = createRequire(import.meta.url);
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ------------------------------------------------------------------ cargar el motor en TS */

const cache = new Map();
function cargar(archivo) {
  const ts = requireNativo("typescript");
  const absoluto = path.resolve(RAIZ, archivo);
  if (cache.has(absoluto)) return cache.get(absoluto).exports;
  const salida = ts.transpileModule(fs.readFileSync(absoluto, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: absoluto,
  });
  const mod = { exports: {} };
  cache.set(absoluto, mod);
  const requerir = (pedido) => {
    if (pedido.startsWith(".")) {
      const base = path.resolve(path.dirname(absoluto), pedido);
      for (const candidato of [base, `${base}.ts`, path.join(base, "index.ts")]) {
        if (fs.existsSync(candidato) && fs.statSync(candidato).isFile()) return cargar(candidato);
      }
    }
    return requireNativo(pedido);
  };
  new Function("exports", "require", "module", "__filename", "__dirname", salida.outputText)(
    mod.exports, requerir, mod, absoluto, path.dirname(absoluto),
  );
  return mod.exports;
}

const motor = () => cargar("src/features/embudo/servicios/relleno-motor.ts");
const dominio = () => cargar("src/features/embudo/dominio/relleno.ts");

/** Lo puro, por si alguna prueba lo usa directo. */
export const armarLineaDeLibros = (...args) => dominio().armarLineaDeLibros(...args);
export const reconstruirChat = (...args) => dominio().reconstruirChat(...args);

function argumentos(argv) {
  const salida = { escribir: false, limite: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const clave = argv[i];
    const valor = argv[i + 1];
    if (clave === "--escribir") salida.escribir = true;
    else if (clave === "--simular") salida.escribir = false;
    else if (clave === "--workspace") { salida.workspace = valor; i += 1; }
    else if (clave === "--linea") { salida.linea = valor; i += 1; }
    else if (clave === "--desde") { salida.desde = valor; i += 1; }
    else if (clave === "--hasta") { salida.hasta = valor; i += 1; }
    else if (clave === "--limite") { salida.limite = Number(valor) || 0; i += 1; }
  }
  return salida;
}

/** Adapta cualquier cosa con `query(texto, valores)` -> `{ rows, rowCount }` (Pool de pg, PGlite). */
export function baseDesdeQuery(db) {
  return {
    leer: async (sql, valores) => (await db.query(sql, valores)).rows,
    escribir: async (sql, valores) => {
      const r = await db.query(sql, valores);
      return r.rowCount ?? r.affectedRows ?? 0;
    },
  };
}

/**
 * El relleno. `db` es cualquier cosa con `query(texto, valores)` que devuelva `{ rows, rowCount }`.
 * Opciones como en la línea de comandos: { workspace, linea, desde, hasta, escribir, limite }.
 */
export async function ejecutarBackfill(db, opciones, log = console.log) {
  if (!opciones.workspace || !opciones.linea) throw new Error("Faltan --workspace y --linea");
  const resultado = await motor().ejecutarRelleno(
    baseDesdeQuery(db),
    {
      workspaceId: opciones.workspace,
      linea: opciones.linea,
      desde: opciones.desde,
      hasta: opciones.hasta,
      escribir: Boolean(opciones.escribir),
      limite: opciones.limite ?? 0,
      pausaEntreLotesMs: opciones.pausaEntreLotesMs ?? 0,
    },
    (p) => {
      if (p.procesados === 0) {
        log(`Línea "${p.lineaNombre}" · ${opciones.desde} a ${opciones.hasta} · ${p.total} chats · ${opciones.escribir ? "ESCRIBIENDO" : "simulación (no escribe)"}`);
      } else {
        log(`  ${p.procesados}/${p.total} chats`);
      }
    },
  );
  log("Eventos por tipo:");
  for (const [tipo, cuantos] of Object.entries(resultado.porTipo).sort((a, b) => b[1] - a[1])) log(`  ${tipo.padEnd(22)} ${cuantos}`);
  log("Embudo (todos los chats de la línea, cuenta si llegó alguna vez):");
  for (const [paso, cuantos] of Object.entries(resultado.resumen)) log(`  ${paso.padEnd(22)} ${cuantos}`);
  if (opciones.escribir) log(`Eventos nuevos insertados: ${resultado.insertados} (los repetidos se ignoraron por claveUnica).`);
  return { chats: resultado.total, porTipo: resultado.porTipo, embudo: resultado.resumen, insertados: resultado.insertados };
}

/* ------------------------------------------------------------------ línea de comandos */

const esPrincipal = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (esPrincipal) {
  const opciones = argumentos(process.argv.slice(2));
  try {
    requireNativo("dotenv/config");
  } catch {
    // sin dotenv: se usa el entorno tal cual
  }
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL");
    process.exit(1);
  }
  const { Pool } = requireNativo("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  ejecutarBackfill(pool, { ...opciones, pausaEntreLotesMs: 250 })
    .then(() => pool.end())
    .catch(async (error) => {
      console.error(error instanceof Error ? error.message : error);
      await pool.end().catch(() => {});
      process.exit(1);
    });
}
