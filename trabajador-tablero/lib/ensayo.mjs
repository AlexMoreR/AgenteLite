// El ensayo de una migración nueva antes de entregar o subir:
// 1. En PGlite (si el repo tiene el script, p. ej. npm run test:migraciones-pglite).
// 2. En PRODUCCIÓN por ssh, dentro de BEGIN ... ROLLBACK: se localiza la base que tiene la tabla guía,
//    se le quitan al archivo sus BEGIN; / COMMIT;, se corre con ON_ERROR_STOP y lock_timeout de 5 s, y
//    se deshace SIEMPRE (ROLLBACK). Nada queda escrito. Todo el SQL viaja por stdin (sin comillas en ssh).
import fs from "node:fs";
import path from "node:path";

import { comoTexto, correr, ultimasLineas } from "./procesos.mjs";

export class ErrorDeEnsayo extends Error {}

/** Las migraciones NUEVAS (archivos agregados) entre los cambios. */
export function migracionesNuevas(cambios, carpetaMigraciones) {
  if (!carpetaMigraciones) return [];
  const prefijo = `${carpetaMigraciones.replace(/\/+$/, "")}/`;
  return cambios
    .filter((cambio) => cambio.letra.startsWith("A"))
    .map((cambio) => cambio.archivo.replace(/\\/g, "/"))
    .filter((archivo) => archivo.startsWith(prefijo) && archivo.endsWith("/migration.sql"))
    .sort();
}

/** Le quita al archivo sus líneas BEGIN; y COMMIT; (las pone el ensayo). Lanza si queda un COMMIT o ROLLBACK suelto. */
export function sqlParaEnsayo(sql) {
  const sinTransaccion = sql
    .split(/\r?\n/)
    .filter((linea) => !/^\s*(BEGIN|COMMIT)\s*;\s*(--.*)?$/i.test(linea))
    .join("\n");
  const sinComentarios = sinTransaccion.replace(/--[^\n]*/g, "");
  if (/\b(COMMIT|ROLLBACK)\b/i.test(sinComentarios)) {
    throw new ErrorDeEnsayo("La migración tiene un COMMIT/ROLLBACK en el medio: no se puede ensayar dentro de una transacción.");
  }
  if (/\bCONCURRENTLY\b/i.test(sinComentarios)) {
    throw new ErrorDeEnsayo("La migración usa CONCURRENTLY: no corre dentro de una transacción (ni la de Prisma).");
  }
  return sinTransaccion;
}

export function guionDeEnsayo(sql) {
  return ["\\set ON_ERROR_STOP on", "SET lock_timeout = '5s';", "BEGIN;", sqlParaEnsayo(sql), "ROLLBACK;", ""].join("\n");
}

async function psqlPorSsh(ssh, argumentosPsql, entrada, timeoutMs) {
  const remoto = `${ssh.psql} ${argumentosPsql}`.trim();
  const resultado = await correr([...ssh.comando, ssh.destino, remoto], { entrada, timeoutMs });
  if (resultado.codigo !== 0) {
    throw new ErrorDeEnsayo(
      `Falló ${comoTexto([...ssh.comando, ssh.destino, remoto])}${resultado.vencido ? " (se pasó del tiempo)" : ""}: ${ultimasLineas(
        `${resultado.errores}\n${resultado.salida}`,
        20,
      )}`,
    );
  }
  return resultado.salida;
}

/** La base (de las del servidor) que tiene la tabla guía. Una sola; si hay cero o varias, error. */
export async function localizarBase(ssh, tablaGuia, timeoutMs = 60_000) {
  if (!/^[A-Za-z0-9_]+$/.test(tablaGuia)) throw new ErrorDeEnsayo(`La tabla guía "${tablaGuia}" no es un nombre válido.`);
  const bases = (await psqlPorSsh(ssh, "-At", "SELECT datname FROM pg_database WHERE NOT datistemplate;\n", timeoutMs))
    .split(/\r?\n/)
    .map((linea) => linea.trim())
    .filter((nombre) => /^[A-Za-z0-9_-]+$/.test(nombre));
  const conLaTabla = [];
  for (const base of bases) {
    const tiene = await psqlPorSsh(ssh, `-At -d ${base}`, `SELECT to_regclass('public."${tablaGuia}"') IS NOT NULL;\n`, timeoutMs);
    if (tiene.trim() === "t") conLaTabla.push(base);
  }
  if (conLaTabla.length !== 1) {
    throw new ErrorDeEnsayo(
      conLaTabla.length
        ? `Hay ${conLaTabla.length} bases con la tabla "${tablaGuia}" (${conLaTabla.join(", ")}): no sé en cuál ensayar.`
        : `Ninguna base del servidor tiene la tabla "${tablaGuia}".`,
    );
  }
  return conLaTabla[0];
}

/**
 * Ensaya las migraciones nuevas. Devuelve un texto con lo que se hizo (para el resultado). Lanza
 * ErrorDeEnsayo si algo falla. `repo` es la config del repo; `cwd` el worktree.
 */
export async function ensayarMigraciones({ migraciones, repo, ssh, cwd, env, senal, timeoutMs }) {
  if (!migraciones.length) return null;
  const hechos = [];
  if (repo.ensayoPglite) {
    const resultado = await correr(repo.ensayoPglite, { cwd, env, senal, timeoutMs });
    if (resultado.codigo !== 0) {
      throw new ErrorDeEnsayo(`El ensayo en PGlite falló (${comoTexto(repo.ensayoPglite)}): ${ultimasLineas(`${resultado.errores}\n${resultado.salida}`, 25)}`);
    }
    hechos.push("PGlite: ok");
  }
  if (!repo.ensayoProduccion) {
    hechos.push("producción: no configurado para este repo");
    return `${migraciones.join(", ")} (${hechos.join("; ")})`;
  }
  if (!ssh) {
    throw new ErrorDeEnsayo("Hay una migración nueva y no está configurado el ssh para ensayarla en producción (config: ssh). No se entrega sin ese ensayo.");
  }
  const base = await localizarBase(ssh, repo.ensayoProduccion.tablaGuia);
  for (const migracion of migraciones) {
    const sql = fs.readFileSync(path.join(cwd, migracion), "utf8");
    await psqlPorSsh(ssh, `-v ON_ERROR_STOP=1 -q -d ${base}`, guionDeEnsayo(sql), timeoutMs);
  }
  hechos.push(`producción (${base}) dentro de BEGIN…ROLLBACK: ok`);
  return `${migraciones.join(", ")} (${hechos.join("; ")})`;
}
