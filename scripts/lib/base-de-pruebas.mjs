// La base de las pruebas de SQL: un Postgres real de la misma versión mayor que producción, si hay uno,
// o PGlite (Postgres embebido) si no.
//
//   import { abrirBaseDePruebas } from "./lib/base-de-pruebas.mjs";
//   const db = await abrirBaseDePruebas();
//   await db.exec(sqlConVariasSentencias);
//   const { rows, fields } = await db.query("SELECT $1::int AS n", [1]);
//   await db.close();
//
// - Con PRUEBAS_POSTGRES_URL (la pone scripts/correr-pruebas-ci.mjs cuando levanta el contenedor de
//   scripts/levantar-postgres-de-pruebas.mjs): se conecta con `pg`, crea una base vacía con nombre al
//   azar (prueba_<azar>), trabaja en ella y la borra en close(). Cada prueba tiene la suya.
// - Sin PRUEBAS_POSTGRES_URL: devuelve new PGlite(), como antes.
//
// La interfaz es la de PGlite que usan las pruebas: exec(sql), query(sql, params, { rowMode }) →
// { rows, fields }, transaction(fn) y close(). Los valores salen con los mismos tipos que PGlite
// (medidos con @electric-sql/pglite 0.3.15), así un assert no cambia según la base:
//   int8/bigint          → Number (BigInt si no cabe en un Number), pg lo da como texto
//   numeric              → texto, igual en los dos (PGlite no lo convierte)
//   timestamp, timestamptz, date → new Date(texto), como PGlite (pg da date en la hora local)
//   json, jsonb          → objeto (JSON.parse), igual en los dos
// Los tipos se fijan solo en esta conexión (pg.TypeOverrides), no en todo `pg`.
import crypto from "node:crypto";
import pg from "pg";
import { PGlite } from "@electric-sql/pglite";

const OID = { INT8: 20, JSON: 114, DATE: 1082, TIMESTAMP: 1114, TIMESTAMPTZ: 1184, NUMERIC: 1700, JSONB: 3802 };

function tiposComoPglite() {
  const tipos = new pg.TypeOverrides();
  tipos.setTypeParser(OID.INT8, (texto) => {
    const entero = BigInt(texto);
    return entero < Number.MIN_SAFE_INTEGER || entero > Number.MAX_SAFE_INTEGER ? entero : Number(entero);
  });
  tipos.setTypeParser(OID.NUMERIC, (texto) => texto);
  for (const oid of [OID.DATE, OID.TIMESTAMP, OID.TIMESTAMPTZ]) tipos.setTypeParser(oid, (texto) => new Date(texto));
  for (const oid of [OID.JSON, OID.JSONB]) tipos.setTypeParser(oid, (texto) => JSON.parse(texto));
  return tipos;
}

// La URL apuntando a otra base del mismo servidor.
function urlConBase(url, base) {
  const otra = new URL(url);
  otra.pathname = `/${base}`;
  return otra.toString();
}

function resultado(r) {
  return { rows: r.rows, fields: r.fields.map((campo) => ({ name: campo.name, dataTypeID: campo.dataTypeID })), affectedRows: r.rowCount ?? 0 };
}

function envolver(client) {
  return {
    // Sin parámetros, pg manda el texto entero (protocolo simple) y acepta varias sentencias.
    async exec(sql) {
      const r = await client.query(sql);
      return (Array.isArray(r) ? r : [r]).map(resultado);
    },
    async query(sql, params = [], opciones = {}) {
      const r = await client.query({ text: sql, values: params, rowMode: opciones.rowMode === "array" ? "array" : undefined });
      return resultado(r);
    },
  };
}

async function abrirPostgresReal(url) {
  // Solo letras minúsculas y números: el nombre va sin comillas en CREATE/DROP DATABASE.
  const base = `prueba_${crypto.randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${base}`);
  } finally {
    await admin.end();
  }

  const client = new pg.Client({ connectionString: urlConBase(url, base), types: tiposComoPglite() });
  try {
    await client.connect();
  } catch (error) {
    await borrarBase(url, base).catch(() => {});
    throw error;
  }

  const db = envolver(client);
  let cerrada = false;
  return {
    ...db,
    async transaction(fn) {
      await client.query("BEGIN");
      try {
        const valor = await fn(db);
        await client.query("COMMIT");
        return valor;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      }
    },
    async close() {
      if (cerrada) return;
      cerrada = true;
      await client.end().catch(() => {});
      await borrarBase(url, base);
    },
  };
}

async function borrarBase(url, base) {
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${base}`);
  } finally {
    await admin.end();
  }
}

export async function abrirBaseDePruebas() {
  const url = process.env.PRUEBAS_POSTGRES_URL;
  if (url) return abrirPostgresReal(url);
  return new PGlite();
}
