// Base de datos para las pruebas de SQL, con la misma interfaz que se usa de PGlite:
//   const db = await abrirBaseDePruebas();
//   await db.exec(sql);                       // una o varias sentencias, sin parámetros
//   const { rows, fields } = await db.query(sql, params, { rowMode: "array" });
//   await db.transaction(async (tx) => { await tx.query(...); });
//   await db.close();
//
// - Con PRUEBAS_POSTGRES_URL (un Postgres real de la versión de producción, ver
//   scripts/levantar-postgres-de-pruebas.mjs) crea una base con nombre al azar, trabaja en ella y la
//   borra en close(). Si la prueba termina con process.exit() sin close(), la base queda en ese
//   Postgres; el contenedor de pruebas se crea con --rm y se lleva todo al apagarse.
// - Sin PRUEBAS_POSTGRES_URL devuelve new PGlite(), como hasta ahora.
//
// Los tipos se igualan a como los devuelve PGlite (0.3), para que la misma prueba pase en las dos:
//   int8/bigint        PGlite: número (BigInt si no cabe en un número seguro). pg: texto.
//   int8[]             PGlite: lista de números.                               pg: lista de textos.
//   numeric            los dos: texto (no se toca).
//   date, timestamp,   PGlite: new Date(texto).  pg: date y timestamp a medianoche/hora LOCAL, armados
//   timestamptz          a mano. Se usa new Date(texto), igual que PGlite. La base va en UTC como PGlite.
//   json/jsonb         los dos: JSON.parse (no se toca).
// Los parsers van en un TypeOverrides propio de cada conexión: no cambian los tipos globales de pg
// (algunas pruebas usan pg con un pool falso en el mismo proceso).
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const OID = { INT8: 20, DATE: 1082, TIMESTAMP: 1114, TIMESTAMPTZ: 1184, INT8_LISTA: 1016 };

function int8ComoPGlite(texto) {
  const numero = BigInt(texto);
  return numero < BigInt(Number.MIN_SAFE_INTEGER) || numero > BigInt(Number.MAX_SAFE_INTEGER) ? numero : Number(numero);
}

function tiposComoPGlite(pg) {
  const tipos = new pg.TypeOverrides();
  const listaDeTexto = pg.types.getTypeParser(1009); // text[]: parte la lista y deja cada valor en texto
  tipos.setTypeParser(OID.INT8, int8ComoPGlite);
  tipos.setTypeParser(OID.INT8_LISTA, (texto) => listaDeTexto(texto).map((v) => (v === null ? null : int8ComoPGlite(v))));
  for (const oid of [OID.DATE, OID.TIMESTAMP, OID.TIMESTAMPTZ]) tipos.setTypeParser(oid, (texto) => new Date(texto));
  return tipos;
}

/** Convierte el resultado de pg (uno o varios) al de PGlite: { rows, fields, affectedRows }. */
function comoPGlite(resultado) {
  return {
    rows: resultado.rows,
    fields: (resultado.fields ?? []).map((campo) => ({ name: campo.name, dataTypeID: campo.dataTypeID })),
    affectedRows: resultado.rowCount ?? 0,
  };
}

function consultar(cliente) {
  return async (sql, params = [], opciones = {}) => {
    const resultado = await cliente.query({ text: sql, values: params, rowMode: opciones.rowMode === "array" ? "array" : undefined });
    return comoPGlite(resultado);
  };
}

function ejecutar(cliente) {
  // Sin parámetros, pg manda la consulta "simple", que acepta varias sentencias seguidas.
  return async (sql) => {
    const resultado = await cliente.query(sql);
    return (Array.isArray(resultado) ? resultado : [resultado]).map(comoPGlite);
  };
}

async function abrirPostgresReal(url) {
  const pg = require("pg");
  const nombre = `prueba_${crypto.randomBytes(6).toString("hex")}`; // solo [a-z0-9_]: va sin comillas
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${nombre}`);
    await admin.query(`ALTER DATABASE ${nombre} SET timezone TO 'UTC'`);
  } catch (error) {
    await admin.end().catch(() => {});
    throw error;
  }

  const direccion = new URL(url);
  direccion.pathname = `/${nombre}`;
  const cliente = new pg.Client({ connectionString: direccion.toString(), types: tiposComoPGlite(pg) });
  try {
    await cliente.connect();
  } catch (error) {
    await admin.query(`DROP DATABASE IF EXISTS ${nombre}`).catch(() => {});
    await admin.end().catch(() => {});
    throw error;
  }

  const query = consultar(cliente);
  const exec = ejecutar(cliente);
  let cerrada = false;
  return {
    nombre,
    query,
    exec,
    async transaction(fn) {
      await cliente.query("BEGIN");
      try {
        const resultado = await fn({ query, exec, rollback: () => cliente.query("ROLLBACK") });
        await cliente.query("COMMIT");
        return resultado;
      } catch (error) {
        await cliente.query("ROLLBACK").catch(() => {});
        throw error;
      }
    },
    async close() {
      if (cerrada) return;
      cerrada = true;
      await cliente.end().catch(() => {});
      try {
        await admin.query(`DROP DATABASE IF EXISTS ${nombre}`);
      } finally {
        await admin.end().catch(() => {});
      }
    },
  };
}

/** Abre la base de pruebas: Postgres real si hay PRUEBAS_POSTGRES_URL; si no, PGlite. */
export async function abrirBaseDePruebas() {
  const url = process.env.PRUEBAS_POSTGRES_URL?.trim();
  if (url) return abrirPostgresReal(url);
  const { PGlite } = await import("@electric-sql/pglite");
  return new PGlite();
}
