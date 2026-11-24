// La base de las pruebas de SQL: un Postgres real (de la misma versión mayor que producción) cuando
// hay PRUEBAS_POSTGRES_URL, y si no, PGlite como siempre.
//   import { abrirBaseDePruebas } from "./lib/base-de-pruebas.mjs";
//   const db = await abrirBaseDePruebas();
//
// Con Postgres real crea una base nueva con nombre al azar (prueba_<azar>), trabaja en ella y la borra
// en close(). Si la prueba termina con process.exit() sin llamar a close(), la base se borra igual al
// salir. Devuelve la misma interfaz que se usa de PGlite: exec(sql), query(sql, params, { rowMode }) →
// { rows, fields, affectedRows }, transaction(fn) y close(). La URL la pone
// scripts/correr-pruebas-ci.mjs (con scripts/levantar-postgres-de-pruebas.mjs) o quien corre la prueba.
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { PGlite } from "@electric-sql/pglite";

/*
  Los tipos, para que una prueba vea lo mismo con pg que con PGlite (revisados uno por uno contra el
  código de PGlite 0.3):
  - int8/bigint (20): PGlite da number si cabe sin perder precisión y BigInt si no; pg daría texto.
  - numeric (1700): los dos dan texto. No se toca.
  - timestamp / timestamptz / date (1114 / 1184 / 1082): PGlite hace new Date(texto). Con eso un date
    queda a medianoche UTC y un timestamp sin zona en la hora local de la máquina; pg leería el date a
    medianoche local. Se usa lo mismo que PGlite para los tres.
  - json/jsonb (114/3802): los dos dan el objeto ya leído (JSON.parse). No se toca.
  Los arreglos de int8, timestamp, timestamptz y date siguen la misma regla.
*/
const OID = {
  INT8: 20,
  DATE: 1082,
  TIMESTAMP: 1114,
  TIMESTAMPTZ: 1184,
  INT8_ARREGLO: 1016,
  DATE_ARREGLO: 1182,
  TIMESTAMP_ARREGLO: 1115,
  TIMESTAMPTZ_ARREGLO: 1185,
};

function entero8(texto) {
  const numero = BigInt(texto);
  return numero < Number.MIN_SAFE_INTEGER || numero > Number.MAX_SAFE_INTEGER ? numero : Number(numero);
}

const fecha = (texto) => new Date(texto);
const parsearArreglo = (texto, leer) => pg.types.arrayParser.create(texto, leer).parse();

function tiposComoPglite() {
  const tipos = new pg.TypeOverrides();
  tipos.setTypeParser(OID.INT8, entero8);
  tipos.setTypeParser(OID.INT8_ARREGLO, (texto) => parsearArreglo(texto, entero8));
  for (const oid of [OID.DATE, OID.TIMESTAMP, OID.TIMESTAMPTZ]) tipos.setTypeParser(oid, fecha);
  for (const oid of [OID.DATE_ARREGLO, OID.TIMESTAMP_ARREGLO, OID.TIMESTAMPTZ_ARREGLO]) {
    tipos.setTypeParser(oid, (texto) => parsearArreglo(texto, fecha));
  }
  return tipos;
}

// Como PGlite: cada resultado con rows, fields ({ name, dataTypeID }) y affectedRows.
function comoPglite(resultado) {
  return {
    rows: resultado.rows ?? [],
    fields: (resultado.fields ?? []).map((campo) => ({ name: campo.name, dataTypeID: campo.dataTypeID })),
    affectedRows: resultado.rowCount ?? 0,
  };
}

function conBase(url, nombre) {
  const otra = new URL(url);
  otra.pathname = `/${nombre}`;
  return otra.toString();
}

// Borra la base en otro proceso y esperando: sirve también dentro de process.on("exit"), donde no hay await.
function borrarBaseYa(urlAdmin, nombre) {
  const codigo = `
    const pg = require("pg");
    const nombre = process.argv[1];
    // La URL lleva la clave: llega por el entorno, no por la línea de comandos (que se ve en ps).
    const cliente = new pg.Client({ connectionString: process.env.URL_ADMIN_PRUEBAS });
    cliente.connect()
      .then(() => cliente.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [nombre]))
      .then(() => cliente.query('DROP DATABASE IF EXISTS "' + nombre + '"'))
      .catch((error) => { console.error("No se pudo borrar la base de pruebas " + nombre + ": " + error.message); process.exitCode = 1; })
      .finally(() => cliente.end());
  `;
  spawnSync(process.execPath, ["-e", codigo, nombre], {
    stdio: ["ignore", "ignore", "inherit"],
    timeout: 30_000,
    env: { ...process.env, URL_ADMIN_PRUEBAS: urlAdmin },
  });
}

async function abrirPostgresReal(urlAdmin) {
  // Solo minúsculas y números: el nombre va entre comillas en CREATE/DROP DATABASE y no admite parámetros.
  const nombre = `prueba_${crypto.randomBytes(8).toString("hex")}`;
  const admin = new pg.Client({ connectionString: urlAdmin });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${nombre}"`);
  } finally {
    await admin.end();
  }

  const alSalir = () => borrarBaseYa(urlAdmin, nombre);
  process.on("exit", alSalir);

  const cliente = new pg.Client({ connectionString: conBase(urlAdmin, nombre), types: tiposComoPglite() });
  // Si el servidor corta la conexión, que la prueba falle en su consulta y no por un evento sin atender.
  cliente.on("error", (error) => console.error(`Base de pruebas: ${error.message}`));
  try {
    await cliente.connect();
  } catch (error) {
    process.off("exit", alSalir);
    alSalir();
    throw error;
  }

  const query = async (sql, params, opciones) =>
    comoPglite(await cliente.query({ text: sql, values: params ?? [], rowMode: opciones?.rowMode === "array" ? "array" : undefined }));
  // Sin parámetros, pg manda el texto tal cual (protocolo simple) y acepta varias sentencias.
  const exec = async (sql) => {
    const resultado = await cliente.query(sql);
    return (Array.isArray(resultado) ? resultado : [resultado]).map(comoPglite);
  };

  let cerrada = false;
  return {
    postgresReal: true,
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
      process.off("exit", alSalir);
      alSalir();
    },
  };
}

export async function abrirBaseDePruebas() {
  const url = process.env.PRUEBAS_POSTGRES_URL?.trim();
  if (url) return abrirPostgresReal(url);
  return new PGlite();
}
