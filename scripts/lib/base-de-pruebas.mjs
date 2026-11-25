// Base para las pruebas de SQL: un Postgres real si hay uno, si no PGlite (Postgres embebido).
//   import { abrirBaseDePruebas } from "./lib/base-de-pruebas.mjs";
//   const db = await abrirBaseDePruebas();
//
// Con PRUEBAS_POSTGRES_URL (la pone scripts/correr-pruebas-ci.mjs cuando levanta postgres:<mayor>-alpine
// con Docker, o se pasa a mano) se conecta con `pg`, crea una base con nombre al azar (prueba_<azar>),
// trabaja en ella y la borra en close(). Sin PRUEBAS_POSTGRES_URL devuelve new PGlite() como siempre.
//
// La interfaz es la de PGlite que usan las pruebas: exec(sql), query(sql, params, { rowMode }) →
// { rows, fields }, transaction(fn) y close(). Los tipos se igualan a como los devuelve PGlite (comparado
// tipo por tipo con una consulta) y SOLO en esta conexión, no en todo `pg`:
//   int8      → number (bigint si no cabe en un number); pg lo daría como string
//   numeric   → string (igual en los dos); numeric[] → arreglo de string (pg lo daría con number)
//   date      → Date a medianoche UTC (pg la leería a medianoche de la hora local)
//   timestamp, timestamptz, json y jsonb → igual en los dos (Date en hora local, Date y objeto); no se tocan
// y los arreglos int8[] y date[] con la misma regla.
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { PGlite } from "@electric-sql/pglite";

const OID = { int8: 20, int8Arreglo: 1016, numericArreglo: 1231, date: 1082, dateArreglo: 1182, timestamptz: 1184, textoArreglo: 1009 };

function entero8(texto) {
  const valor = BigInt(texto);
  return valor >= BigInt(Number.MIN_SAFE_INTEGER) && valor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(valor) : valor;
}

// Los infinitos y las fechas antes de Cristo quedan como los dejaría el lector de timestamptz de pg.
const leerConZona = pg.types.getTypeParser(OID.timestamptz);
const diaUtc = (texto) => (/^-?infinity$/.test(texto) ? leerConZona(texto) : leerConZona(texto.replace(/( BC)?$/, " 00:00:00+00$1")));

const enCadaUno = (convertir) => {
  const recorrer = (valor) => (Array.isArray(valor) ? valor.map(recorrer) : valor === null ? null : convertir(valor));
  // El lector de arreglos de texto de pg deja cada elemento como string (o null) y respeta los anidados.
  const leerArreglo = pg.types.getTypeParser(OID.textoArreglo);
  return (texto) => recorrer(leerArreglo(texto));
};

function tiposComoPglite() {
  const tipos = new pg.TypeOverrides();
  tipos.setTypeParser(OID.int8, entero8);
  tipos.setTypeParser(OID.int8Arreglo, enCadaUno(entero8));
  tipos.setTypeParser(OID.numericArreglo, pg.types.getTypeParser(OID.textoArreglo));
  tipos.setTypeParser(OID.date, diaUtc);
  tipos.setTypeParser(OID.dateArreglo, enCadaUno(diaUtc));
  return tipos;
}

// Quita la clave de una URL para poder mostrarla en un error sin filtrarla.
const sinClave = (texto) => String(texto).replace(/(postgres(?:ql)?:\/\/[^:/@\s]+):[^@\s]*@/gi, "$1:***@");

async function abrirPostgresReal(url) {
  const nombre = `prueba_${crypto.randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: url });
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE ${nombre}`);
  } catch (error) {
    await admin.end().catch(() => {});
    throw new Error(`No se pudo crear la base de pruebas en PRUEBAS_POSTGRES_URL: ${sinClave(error.message)}`);
  }
  await admin.end();

  const direccion = new URL(url);
  direccion.pathname = `/${nombre}`;
  const cliente = new pg.Client({ connectionString: direccion.toString(), types: tiposComoPglite() });
  let cerrada = false;

  const borrar = async () => {
    const otro = new pg.Client({ connectionString: url });
    await otro.connect();
    try {
      await otro.query(`DROP DATABASE IF EXISTS ${nombre}`);
    } finally {
      await otro.end();
    }
  };
  // Si la prueba termina con process.exit() sin llamar a close(), la base se borra igual al salir.
  const alSalir = () => {
    if (cerrada) return;
    spawnSync(
      process.execPath,
      [
        "-e",
        `const pg=require("pg");const c=new pg.Client({connectionString:process.env.URL_ADMIN});` +
          `c.connect().then(()=>c.query("DROP DATABASE IF EXISTS "+process.argv[1]+" WITH (FORCE)")).catch(()=>{}).finally(()=>c.end().catch(()=>{}));`,
        nombre,
      ],
      { cwd: process.cwd(), env: { ...process.env, URL_ADMIN: url }, stdio: "ignore", timeout: 15000 },
    );
  };
  process.once("exit", alSalir);

  try {
    await cliente.connect();
  } catch (error) {
    await borrar().catch(() => {});
    process.removeListener("exit", alSalir);
    throw new Error(`No se pudo abrir la base de pruebas: ${sinClave(error.message)}`);
  }

  const resultado = (r) => ({ rows: r.rows, fields: r.fields ?? [], affectedRows: r.rowCount ?? 0 });
  const consultar = (conexion) => async (sql, params, opciones) => {
    const pedido = { text: sql, rowMode: opciones?.rowMode === "array" ? "array" : undefined };
    if (params && params.length > 0) pedido.values = params;
    return resultado(await conexion.query(pedido));
  };
  // Sin parámetros pg usa el protocolo simple, que acepta varias sentencias en un solo texto.
  const ejecutar = (conexion) => async (sql) => {
    const r = await conexion.query(sql);
    return (Array.isArray(r) ? r : [r]).map(resultado);
  };

  const query = consultar(cliente);
  const exec = ejecutar(cliente);

  return {
    query,
    exec,
    async transaction(fn) {
      await cliente.query("BEGIN");
      let deshecha = false;
      const tx = {
        query,
        exec,
        async rollback() {
          deshecha = true;
          await cliente.query("ROLLBACK");
        },
      };
      try {
        const valor = await fn(tx);
        if (!deshecha) await cliente.query("COMMIT");
        return valor;
      } catch (error) {
        if (!deshecha) await cliente.query("ROLLBACK").catch(() => {});
        throw error;
      }
    },
    async close() {
      if (cerrada) return;
      cerrada = true;
      process.removeListener("exit", alSalir);
      await cliente.end().catch(() => {});
      await borrar();
    },
  };
}

export async function abrirBaseDePruebas() {
  const url = process.env.PRUEBAS_POSTGRES_URL;
  if (url) return abrirPostgresReal(url);
  return new PGlite();
}
