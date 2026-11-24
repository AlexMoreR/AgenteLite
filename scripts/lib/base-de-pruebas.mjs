// Base de pruebas para las pruebas de SQL: un Postgres real de la versión de producción cuando hay uno,
// o PGlite (Postgres embebido) cuando no.
//
//   import { abrirBaseDePruebas } from "./lib/base-de-pruebas.mjs";
//   const db = await abrirBaseDePruebas();
//   await db.exec(sqlConVariasSentencias);
//   const { rows, fields } = await db.query(sql, params);
//   await db.close();
//
// - Con PRUEBAS_POSTGRES_URL (la pone scripts/correr-pruebas-ci.mjs al levantar el contenedor de
//   scripts/levantar-postgres-de-pruebas.mjs): se conecta con `pg`, crea una base nueva con nombre al
//   azar (prueba_<azar>), trabaja en ella y la borra en close(). Los tipos se devuelven igual que en
//   PGlite (ver tiposComoPglite), así las pruebas no cambian según la base.
// - Sin PRUEBAS_POSTGRES_URL: devuelve new PGlite(), como antes.
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

/*
  Tipos como los devuelve PGlite (revisados uno por uno contra @electric-sql/pglite 0.3):
  - int8/bigint (20) y int8[] (1016): número si cabe en un entero seguro de JS, BigInt si no.
    `pg` los da como texto.
  - numeric (1700): texto en los dos. No se toca. numeric[] (1231): PGlite da una lista de textos y
    `pg` una de números.
  - timestamp sin zona (1114) y timestamp[] (1115): PGlite lo toma como UTC. `pg` lo toma como hora
    local de la máquina, así que se le agrega la Z.
  - timestamptz (1184) y timestamptz[] (1185): Date en los dos. No se toca.
  - date (1082) y date[] (1182): PGlite da un Date a la medianoche UTC. `pg` da la medianoche local.
  - json (114), jsonb (3802), json[] (199) y jsonb[] (3807): objeto ya leído en los dos. No se toca.
  Los valores especiales (infinity, -infinity) quedan como los deja `pg`.
*/
const ENTERO_MAX = BigInt(Number.MAX_SAFE_INTEGER);
const ENTERO_MIN = BigInt(Number.MIN_SAFE_INTEGER);
const leerTimestamptz = pg.types.getTypeParser(1184);
const esEspecial = (texto) => /^-?infinity$/i.test(texto);

function leerInt8(texto) {
  const valor = BigInt(texto);
  return valor > ENTERO_MAX || valor < ENTERO_MIN ? valor : Number(valor);
}
function leerTimestampComoUtc(texto) {
  if (esEspecial(texto)) return leerTimestamptz(texto);
  // Los años antes de Cristo traen " BC" al final: la zona va antes.
  return leerTimestamptz(texto.endsWith(" BC") ? `${texto.slice(0, -3)}Z BC` : `${texto}Z`);
}
function leerFechaComoUtc(texto) {
  if (esEspecial(texto)) return leerTimestamptz(texto);
  return leerTimestampComoUtc(texto.endsWith(" BC") ? `${texto.slice(0, -3)} 00:00:00 BC` : `${texto} 00:00:00`);
}
const lista = (leer) => (texto) => pg.types.arrayParser.create(texto, leer).parse();

// Solo para las conexiones de este ayudante: no cambia los tipos globales de `pg` (otras pruebas
// usan pg con sus propios valores falsos).
function tiposComoPglite() {
  const tipos = new pg.TypeOverrides();
  tipos.setTypeParser(20, leerInt8);
  tipos.setTypeParser(1016, lista(leerInt8));
  tipos.setTypeParser(1231, lista((texto) => texto));
  tipos.setTypeParser(1114, leerTimestampComoUtc);
  tipos.setTypeParser(1115, lista(leerTimestampComoUtc));
  tipos.setTypeParser(1082, leerFechaComoUtc);
  tipos.setTypeParser(1182, lista(leerFechaComoUtc));
  return tipos;
}

function urlDeLaBase(urlBase, nombre) {
  const url = new URL(urlBase);
  url.pathname = `/${nombre}`;
  return url.toString();
}

// SQL para borrar la base de prueba: corta las conexiones que queden y la borra. Sirve desde Postgres 12
// (DROP DATABASE ... WITH (FORCE) es de 13).
const SQL_CORTAR = "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()";
const sqlBorrar = (nombre) => `DROP DATABASE IF EXISTS "${nombre}"`;

/*
  Si una prueba termina con process.exit() sin llamar a close(), la base quedaría. Al salir se borra
  con un proceso aparte y sincrónico (en el evento "exit" no se puede esperar una promesa). La URL va
  por el entorno, no por los argumentos.
*/
const BORRAR_AL_SALIR = `
const pg = require("pg");
(async () => {
  const c = new pg.Client({ connectionString: process.env.PRUEBAS_POSTGRES_URL });
  await c.connect();
  try {
    await c.query(${JSON.stringify(SQL_CORTAR)}, [process.env.BASE_A_BORRAR]);
    await c.query('DROP DATABASE IF EXISTS "' + process.env.BASE_A_BORRAR + '"');
  } finally {
    await c.end();
  }
})().catch((e) => { console.error("no se pudo borrar la base de prueba:", e.message); process.exit(1); });
`;

async function abrirPostgres(urlBase) {
  const nombre = `prueba_${crypto.randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: urlBase });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${nombre}"`);
  } finally {
    await admin.end();
  }

  const types = tiposComoPglite();
  const cliente = new pg.Client({ connectionString: urlDeLaBase(urlBase, nombre), types });
  let cerrada = false;
  const borrarAlSalir = () => {
    if (cerrada) return;
    cerrada = true;
    spawnSync(process.execPath, ["-e", BORRAR_AL_SALIR], {
      env: { ...process.env, BASE_A_BORRAR: nombre },
      stdio: "inherit",
      timeout: 15_000,
    });
  };
  process.once("exit", borrarAlSalir);

  try {
    await cliente.connect();
  } catch (error) {
    process.removeListener("exit", borrarAlSalir);
    cerrada = true;
    await borrar(urlBase, nombre);
    throw error;
  }

  const comoPglite = (resultado) => ({
    rows: resultado.rows,
    fields: (resultado.fields ?? []).map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
    affectedRows: resultado.rowCount ?? 0,
  });

  return {
    nombre,
    // Sin parámetros, `pg` manda el texto entero y acepta varias sentencias (como PGlite.exec).
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
      process.removeListener("exit", borrarAlSalir);
      await cliente.end().catch(() => {});
      await borrar(urlBase, nombre);
    },
  };
}

async function borrar(urlBase, nombre) {
  const admin = new pg.Client({ connectionString: urlBase });
  await admin.connect();
  try {
    await admin.query(SQL_CORTAR, [nombre]);
    await admin.query(sqlBorrar(nombre));
  } finally {
    await admin.end();
  }
}

export async function abrirBaseDePruebas() {
  const url = process.env.PRUEBAS_POSTGRES_URL;
  if (!url) return new PGlite();
  return abrirPostgres(url);
}
