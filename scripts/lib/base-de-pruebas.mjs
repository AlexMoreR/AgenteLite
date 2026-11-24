// Base para las pruebas de SQL: Postgres real si hay uno, PGlite si no.
//   import { abrirBaseDePruebas } from "./lib/base-de-pruebas.mjs";
//   const db = await abrirBaseDePruebas();
//
// - Con PRUEBAS_POSTGRES_URL (la pone scripts/correr-pruebas-ci.mjs cuando levanta el contenedor de
//   scripts/levantar-postgres-de-pruebas.mjs, de la misma versión mayor que producción): crea una base
//   con nombre al azar (prueba_<azar>), trabaja en ella y la borra en close().
// - Sin PRUEBAS_POSTGRES_URL: devuelve new PGlite(), como antes.
//
// Las dos devuelven la misma interfaz que usan las pruebas: exec(sql), query(sql, params, opciones)
// → { rows, fields, affectedRows } y close(). transaction() no está porque ninguna prueba migrada la usa.
import crypto from "node:crypto";
import pg from "pg";
import { PGlite } from "@electric-sql/pglite";

// Tipos con los OID de Postgres. Se iguala lo que pg devuelve distinto de PGlite; lo demás queda como
// lo deja pg, que ya coincide:
// - int2/int4/oid/float4/float8 → número, numeric → texto, json/jsonb → objeto, bool → boolean (igual).
// - int8: PGlite da número si cabe sin perder precisión y BigInt si no; pg da texto.
// - timestamp (sin zona): PGlite lo lee como UTC; pg como hora local.
// - date: PGlite da la medianoche UTC; pg la medianoche local.
// - timestamptz: igual en los dos, salvo infinity (PGlite: fecha inválida; pg: el número Infinity).
// - Los arreglos de esos tipos: PGlite convierte cada elemento; pg deja texto en int8[] y fechas locales.
// - numeric[]: PGlite deja cada elemento en texto, como numeric; pg los pasa a número.
const INT8 = 20;
const TIMESTAMP = 1114;
const TIMESTAMPTZ = 1184;
const DATE = 1082;
const INT8_ARREGLO = 1016;
const TIMESTAMP_ARREGLO = 1115;
const TIMESTAMPTZ_ARREGLO = 1185;
const DATE_ARREGLO = 1182;
const NUMERIC_ARREGLO = 1231;

const MAXIMO_SEGURO = BigInt(Number.MAX_SAFE_INTEGER);
const MINIMO_SEGURO = BigInt(Number.MIN_SAFE_INTEGER);

function leerInt8(texto) {
  const n = BigInt(texto);
  return n > MAXIMO_SEGURO || n < MINIMO_SEGURO ? n : Number(n);
}

// "2024-01-02 03:04:05.123456" → fecha en UTC. "infinity" da fecha inválida, como en PGlite.
function leerTimestamp(texto) {
  return new Date(`${texto.replace(" ", "T")}Z`);
}

function leerDate(texto) {
  return new Date(`${texto}T00:00:00Z`);
}

const leerTimestamptzDePg = pg.types.getTypeParser(TIMESTAMPTZ, "text");
function leerTimestamptz(texto) {
  return texto.endsWith("infinity") ? new Date(NaN) : leerTimestamptzDePg(texto);
}

const deArreglo = (leer) => (texto) => pg.types.arrayParser.create(texto, leer).parse();

// Solo para los clientes de este ayudante: no cambia los tipos de ningún otro pg del proceso.
const tipos = new pg.TypeOverrides();
tipos.setTypeParser(INT8, leerInt8);
tipos.setTypeParser(TIMESTAMP, leerTimestamp);
tipos.setTypeParser(TIMESTAMPTZ, leerTimestamptz);
tipos.setTypeParser(DATE, leerDate);
tipos.setTypeParser(INT8_ARREGLO, deArreglo(leerInt8));
tipos.setTypeParser(TIMESTAMP_ARREGLO, deArreglo(leerTimestamp));
tipos.setTypeParser(TIMESTAMPTZ_ARREGLO, deArreglo(leerTimestamptz));
tipos.setTypeParser(DATE_ARREGLO, deArreglo(leerDate));
tipos.setTypeParser(NUMERIC_ARREGLO, deArreglo((texto) => texto));

// El resultado de pg con la forma del de PGlite.
function comoPglite(resultado) {
  return {
    rows: resultado.rows,
    fields: (resultado.fields ?? []).map((campo) => ({ name: campo.name, dataTypeID: campo.dataTypeID })),
    affectedRows: resultado.rowCount ?? 0,
  };
}

async function conCliente(url, trabajo) {
  const cliente = new pg.Client({ connectionString: url });
  await cliente.connect();
  try {
    return await trabajo(cliente);
  } finally {
    await cliente.end();
  }
}

export async function abrirBaseDePruebas() {
  const url = process.env.PRUEBAS_POSTGRES_URL;
  if (!url) return new PGlite();

  // El nombre sale de bytes al azar en hexadecimal: no hay nada que escapar.
  const nombre = `prueba_${crypto.randomBytes(8).toString("hex")}`;
  await conCliente(url, (cliente) => cliente.query(`CREATE DATABASE "${nombre}"`));

  const urlDeLaBase = new URL(url);
  urlDeLaBase.pathname = `/${nombre}`;
  const cliente = new pg.Client({ connectionString: urlDeLaBase.toString(), types: tipos });
  try {
    await cliente.connect();
  } catch (error) {
    await conCliente(url, (admin) => admin.query(`DROP DATABASE IF EXISTS "${nombre}"`));
    throw error;
  }

  let cerrada = false;
  return {
    // Sin parámetros, pg usa el protocolo simple y acepta varias sentencias, como PGlite.
    async exec(sql) {
      const resultado = await cliente.query(sql);
      return (Array.isArray(resultado) ? resultado : [resultado]).map(comoPglite);
    },
    async query(sql, params, opciones) {
      const resultado = await cliente.query({ text: sql, values: params, rowMode: opciones?.rowMode });
      return comoPglite(resultado);
    },
    async close() {
      if (cerrada) return;
      cerrada = true;
      await cliente.end();
      await conCliente(url, (admin) => admin.query(`DROP DATABASE IF EXISTS "${nombre}"`));
    },
  };
}
