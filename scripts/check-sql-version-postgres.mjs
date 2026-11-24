// Prueba: ninguna SQL del repo usa funciones o sintaxis de una versión de Postgres más nueva que la de
// producción.
//
// La versión de producción está escrita en un solo lugar: src/lib/postgres-produccion.json ("mayor").
// Este chequeo es estático (lee el texto, sin Docker ni base): recorre src/, prisma/migrations/ y
// scripts/ (.ts, .tsx, .mjs, .js, .sql), quita los comentarios y busca cada construcción de la lista
// con la versión desde la que existe. Si alguna es de una versión mayor que la de producción, sale
// con 1 y dice archivo:línea, qué construcción y "desde Postgres N".
//
// Una línea que lleve el comentario `sql-version-ok: <motivo>` se salta (para un falso positivo).
//
// Guardia propia, corre siempre: además del barrido, se corre sobre scripts/fixtures/sql-version-postgres/
// y TIENE que encontrar pg_input_is_valid. Si no lo encuentra, el chequeo dejó de ver y falla.
//
// Correr: npm run test:sql-version-postgres
// Otra carpeta: node scripts/check-sql-version-postgres.mjs <carpeta>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const produccion = JSON.parse(fs.readFileSync(path.join(RAIZ, "src/lib/postgres-produccion.json"), "utf8"));
const MAYOR = Number(produccion.mayor);
if (!Number.isInteger(MAYOR)) {
  console.error('FALLA: src/lib/postgres-produccion.json no tiene un "mayor" entero');
  process.exit(1);
}

const CARPETAS = ["src", "prisma/migrations", "scripts"];
const EXTENSIONES = new Set([".ts", ".tsx", ".mjs", ".js", ".sql"]);
const SALTAR = [path.join(RAIZ, "scripts", "fixtures")];
const FIXTURES = path.join(RAIZ, "scripts", "fixtures", "sql-version-postgres");
const MARCA = /sql-version-ok:\s*\S/;

// Cada construcción con la versión de Postgres desde la que existe. Se buscan sin importar mayúsculas.
const CONSTRUCCIONES = [
  { nombre: "MERGE INTO", desde: 15, patron: /\bMERGE\s+INTO\b/gi },
  { nombre: "pg_input_is_valid(", desde: 16, patron: /\bpg_input_is_valid\s*\(/gi }, // sql-version-ok: es la lista de lo que se busca
  { nombre: "pg_input_error_info(", desde: 16, patron: /\bpg_input_error_info\s*\(/gi }, // sql-version-ok: es la lista de lo que se busca
  { nombre: "IS [NOT] JSON", desde: 16, patron: /\bIS\s+(?:NOT\s+)?JSON\b/gi }, // sql-version-ok: es la lista de lo que se busca
  { nombre: "JSON_OBJECT(", desde: 16, patron: /\bJSON_OBJECT\s*\(/gi }, // sql-version-ok: es la lista de lo que se busca
  { nombre: "JSON_ARRAY(", desde: 16, patron: /\bJSON_ARRAY\s*\(/gi }, // sql-version-ok: es la lista de lo que se busca
  { nombre: "JSON_OBJECTAGG(", desde: 16, patron: /\bJSON_OBJECTAGG\s*\(/gi }, // sql-version-ok: es la lista de lo que se busca
  { nombre: "JSON_ARRAYAGG(", desde: 16, patron: /\bJSON_ARRAYAGG\s*\(/gi }, // sql-version-ok: es la lista de lo que se busca
  { nombre: "any_value(", desde: 16, patron: /\bany_value\s*\(/gi }, // sql-version-ok: es la lista de lo que se busca
  { nombre: "SYSTEM_USER", desde: 16, patron: /\bSYSTEM_USER\b/gi }, // sql-version-ok: es la lista de lo que se busca
  { nombre: "merge_action(", desde: 17, patron: /\bmerge_action\s*\(/gi }, // sql-version-ok: es la lista de lo que se busca
  { nombre: "JSON_TABLE(", desde: 17, patron: /\bJSON_TABLE\s*\(/gi }, // sql-version-ok: es la lista de lo que se busca
  { nombre: "JSON_QUERY(", desde: 17, patron: /\bJSON_QUERY\s*\(/gi }, // sql-version-ok: es la lista de lo que se busca
  { nombre: "JSON_VALUE(", desde: 17, patron: /\bJSON_VALUE\s*\(/gi }, // sql-version-ok: es la lista de lo que se busca
  { nombre: "JSON_EXISTS(", desde: 17, patron: /\bJSON_EXISTS\s*\(/gi }, // sql-version-ok: es la lista de lo que se busca
  { nombre: "JSON_SCALAR(", desde: 17, patron: /\bJSON_SCALAR\s*\(/gi }, // sql-version-ok: es la lista de lo que se busca
  { nombre: "JSON_SERIALIZE(", desde: 17, patron: /\bJSON_SERIALIZE\s*\(/gi }, // sql-version-ok: es la lista de lo que se busca
  { nombre: "uuidv7(", desde: 18, patron: /\buuidv7\s*\(/gi }, // sql-version-ok: es la lista de lo que se busca
  { nombre: "uuid_extract_timestamp(", desde: 18, patron: /\buuid_extract_timestamp\s*\(/gi }, // sql-version-ok: es la lista de lo que se busca
];
// MERGE … RETURNING (desde 17): un RETURNING después de un MERGE INTO, antes del ";" que cierra la orden.
const MERGE_RETURNING = { nombre: "MERGE … RETURNING", desde: 17 };

// Quita los comentarios // y /* */ (los cambia por espacios, así las posiciones y las líneas siguen
// iguales), como scripts/check-sin-sesion-en-after.mjs. Los textos se saltan para no confundir un "//"
// de una URL con un comentario, pero su contenido se deja: la SQL vive dentro de los textos.
function sinComentariosJs(texto) {
  let salida = "";
  let i = 0;
  while (i < texto.length) {
    const c = texto[i];
    const sig = texto[i + 1];
    if (c === "/" && sig === "/") {
      while (i < texto.length && texto[i] !== "\n") {
        salida += " ";
        i += 1;
      }
      continue;
    }
    if (c === "/" && sig === "*") {
      salida += "  ";
      i += 2;
      while (i < texto.length && !(texto[i] === "*" && texto[i + 1] === "/")) {
        salida += texto[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      salida += "  ";
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      salida += c;
      i += 1;
      while (i < texto.length && texto[i] !== c) {
        // Un texto con comillas simples o dobles no pasa de la línea: si quedó abierto (por ejemplo, un
        // apóstrofo dentro de una expresión regular), se corta ahí y no se come el resto del archivo.
        if (c !== "`" && texto[i] === "\n") break;
        if (texto[i] === "\\") {
          salida += texto.slice(i, i + 2);
          i += 2;
          continue;
        }
        salida += texto[i];
        i += 1;
      }
      if (texto[i] === c) {
        salida += c;
        i += 1;
      }
      continue;
    }
    salida += c;
    i += 1;
  }
  return salida;
}

// Quita los comentarios de SQL (-- hasta el fin de la línea y /* */), saltando los textos entre ''.
function sinComentariosSql(texto) {
  let salida = "";
  let i = 0;
  while (i < texto.length) {
    const c = texto[i];
    const sig = texto[i + 1];
    if (c === "-" && sig === "-") {
      while (i < texto.length && texto[i] !== "\n") {
        salida += " ";
        i += 1;
      }
      continue;
    }
    if (c === "/" && sig === "*") {
      salida += "  ";
      i += 2;
      while (i < texto.length && !(texto[i] === "*" && texto[i + 1] === "/")) {
        salida += texto[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      salida += "  ";
      i += 2;
      continue;
    }
    if (c === "'") {
      const fin = texto.indexOf("'", i + 1);
      const hasta = fin === -1 ? texto.length : fin + 1;
      salida += texto.slice(i, hasta);
      i = hasta;
      continue;
    }
    salida += c;
    i += 1;
  }
  return salida;
}

function lineaDe(texto, posicion) {
  return texto.slice(0, posicion).split("\n").length;
}

function archivosDe(carpeta, saltar) {
  const encontrados = [];
  if (!fs.existsSync(carpeta)) return encontrados;
  for (const entrada of fs.readdirSync(carpeta, { withFileTypes: true })) {
    const ruta = path.join(carpeta, entrada.name);
    if (entrada.name === "node_modules" || saltar.includes(ruta)) continue;
    if (entrada.isDirectory()) encontrados.push(...archivosDe(ruta, saltar));
    else if (entrada.isFile() && EXTENSIONES.has(path.extname(entrada.name))) encontrados.push(ruta);
  }
  return encontrados;
}

/** Todas las construcciones de la lista que aparecen en el archivo, con su línea. */
function hallazgosDe(ruta) {
  const original = fs.readFileSync(ruta, "utf8");
  const codigo = path.extname(ruta) === ".sql" ? sinComentariosSql(original) : sinComentariosJs(original);
  const lineasOriginales = original.split("\n");
  const hallazgos = [];
  const agregar = (construccion, posicion) => {
    const linea = lineaDe(codigo, posicion);
    if (MARCA.test(lineasOriginales[linea - 1] ?? "")) return;
    hallazgos.push({ archivo: path.relative(RAIZ, ruta), linea, nombre: construccion.nombre, desde: construccion.desde });
  };
  for (const construccion of CONSTRUCCIONES) {
    for (const encontrado of codigo.matchAll(construccion.patron)) agregar(construccion, encontrado.index);
  }
  for (const merge of codigo.matchAll(/\bMERGE\s+INTO\b/gi)) {
    const resto = codigo.slice(merge.index);
    const fin = resto.indexOf(";");
    const orden = fin === -1 ? resto : resto.slice(0, fin);
    const returning = /\bRETURNING\b/i.exec(orden);
    if (returning) agregar(MERGE_RETURNING, merge.index + returning.index);
  }
  return hallazgos;
}

function barrer(carpetas, saltar) {
  return carpetas.flatMap((carpeta) => archivosDe(carpeta, saltar)).flatMap(hallazgosDe);
}

let falla = false;

// 1) La guardia: sobre el fixture tiene que encontrar pg_input_is_valid.
const deLaGuardia = barrer([FIXTURES], []);
if (!deLaGuardia.some((hallazgo) => hallazgo.nombre === "pg_input_is_valid(")) { // sql-version-ok: el nombre que la guardia tiene que encontrar
  console.error(
    `FALLA: la guardia no encontró pg_input_is_valid en ${path.relative(RAIZ, FIXTURES)}; el chequeo ya no ve la SQL de versiones nuevas`,
  );
  falla = true;
}

// 2) El barrido: el repo (o la carpeta que se pasó) contra la versión de producción.
const pedida = process.argv[2];
const carpetas = pedida ? [path.resolve(pedida)] : CARPETAS.map((carpeta) => path.join(RAIZ, carpeta));
const revisados = carpetas.flatMap((carpeta) => archivosDe(carpeta, pedida ? [] : SALTAR));
const demasiadoNuevas = revisados.flatMap(hallazgosDe).filter((hallazgo) => hallazgo.desde > MAYOR);

if (demasiadoNuevas.length > 0) {
  console.error(
    `FALLA: ${demasiadoNuevas.length} construcciones de SQL de una versión de Postgres más nueva que la de producción (${MAYOR}${produccion.provisional ? ", provisional" : ""}):`,
  );
  for (const hallazgo of demasiadoNuevas) {
    console.error(`- ${hallazgo.archivo}:${hallazgo.linea}: ${hallazgo.nombre} desde Postgres ${hallazgo.desde}`);
  }
  console.error(
    "Si es un falso positivo, ponle a esa línea el comentario `sql-version-ok: <motivo>`. Si producción ya es más nueva, actualiza src/lib/postgres-produccion.json.",
  );
  falla = true;
}

if (falla) process.exit(1);
console.log(
  `ok - ${revisados.length} archivos sin SQL más nueva que Postgres ${MAYOR}${produccion.provisional ? " (provisional)" : ""}; la guardia encontró pg_input_is_valid en el fixture`,
);
