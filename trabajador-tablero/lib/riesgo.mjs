// Riesgo del cambio (24-oct-2026), del lado del trabajador. Funciones puras, sin dependencias.
// Espeja la revisión de la migración de src/features/tableros-inteligentes/services/reglas-riesgo.ts del
// CRM (destructivoDelSql): el trabajador la corre sobre las migraciones NUEVAS del cambio y manda el
// resultado en `migracionDestructiva`, junto con la lista de `archivos`, para la última revisión del CRM.
// Si cambia una regla allá, cambiarla acá igual.

/** Las instrucciones de SQL que borran o cambian lo que ya existe (ADD COLUMN / CREATE TABLE / CREATE INDEX no calzan). */
const SQL_DESTRUCTIVO = [
  { que: "DROP", patron: /\bdrop\b/i },
  { que: "TRUNCATE", patron: /\btruncate\b/i },
  { que: "DELETE", patron: /\bdelete\b/i },
  { que: "UPDATE", patron: /\bupdate\b/i },
  { que: "RENAME", patron: /\brename\b/i },
  // Cambiar una columna que ya existe (tipo, NOT NULL, default). ALTER TYPE ... ADD VALUE y ADD COLUMN son aditivos.
  { que: "ALTER destructivo", patron: /\balter\s+table\b[^;]*\balter\s+column\b/i },
];

/**
 * Le quita los comentarios (-- y bloque), los textos entre comillas simples y las acciones de las llaves
 * foráneas (ON DELETE CASCADE / ON UPDATE CASCADE: Prisma las escribe en cada tabla nueva y no tocan datos).
 */
function sqlSinComentarios(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/\bon\s+(?:delete|update)\s+(?:cascade|restrict|set\s+null|set\s+default|no\s+action)\b/gi, " ");
}

/** Qué tiene de destructivo un SQL de migración, sin repetir ([] si es solo aditiva o está vacía). */
export function destructivoDelSql(sql) {
  if (!sql) return [];
  const limpio = sqlSinComentarios(String(sql));
  return [...new Set(SQL_DESTRUCTIVO.filter((regla) => regla.patron.test(limpio)).map((regla) => regla.que))];
}

/**
 * Lo destructivo de las migraciones NUEVAS del cambio. `migraciones` son las rutas que da
 * migracionesNuevas (ensayo.mjs); `leerArchivo(ruta)` devuelve el texto de cada migration.sql (en el
 * worktree). Si un archivo no se puede leer se ignora: el ensayo de la migración ya avisa de eso.
 * Devuelve la lista sin repetir de lo destructivo ([] si no hay migración o es aditiva).
 */
export function migracionDestructiva(migraciones, leerArchivo) {
  const encontrado = new Set();
  for (const ruta of migraciones ?? []) {
    let sql = "";
    try {
      sql = leerArchivo(ruta) ?? "";
    } catch {
      continue;
    }
    for (const que of destructivoDelSql(sql)) encontrado.add(que);
  }
  return [...encontrado];
}
