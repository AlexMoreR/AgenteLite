// Consultas de Features solas (preparar-features.ts). Van aparte de sql-trabajador.ts: estas sí saltan las archivadas,
// y las del Coordinador no las filtran a propósito (una parte archivada sigue contando como HECHO; archivadas.ts).

/**
 * Features solas (24-nov-2026, preparar-features.ts): las tarjetas que cuelgan del Área Features (a cualquier profundidad, sin
 * pasar por borradas; hasta 50 niveles) de ESTE negocio, en IDEA o POR_APROBAR, que nadie empezó (`intentos` = 0), sin
 * archivar y de un tipo con estados (las Áreas, carpetas, no). La más vieja primero. $1 = id del Área Features, $2 = workspaceId.
 */
export const SQL_POR_PREPARAR_EN_FEATURES = `
WITH RECURSIVE baja AS (
  SELECT h."id", 1 AS "nivel"
  FROM "TarjetaTablero" h
  WHERE h."padreId" = $1::text AND h."borradoEn" IS NULL
  UNION ALL
  SELECT h."id", s."nivel" + 1
  FROM baja s
  JOIN "TarjetaTablero" h ON h."padreId" = s."id" AND h."borradoEn" IS NULL
  WHERE s."nivel" < 50
)
SELECT c."id"
FROM "TarjetaTablero" c
JOIN "TableroInteligente" b ON b."id" = c."tableroId"
JOIN "TipoTarjeta" k ON k."id" = c."tipoId"
WHERE c."id" IN (SELECT "id" FROM baja)
  AND b."workspaceId" = $2
  AND c."borradoEn" IS NULL
  AND c."archivadaEn" IS NULL
  AND c."estado" IN ('IDEA', 'POR_APROBAR')
  AND c."intentos" = 0
  AND k."usaEstados" = true
ORDER BY c."creadoEn" ASC, c."numero" ASC
LIMIT 100`;

/**
 * Tareas fuera de Features (27-nov-2026, tareas-a-features.ts): las tarjetas tipo Tarea del tablero de Features, en APROBADO o
 * PLAN_APROBADO, con repo de desarrollo (gestion o aizencrm, sin importar mayúsculas ni espacios; otro repo se queda donde se
 * pidió), sin borrar ni archivar, que NO cuelgan de Features a ninguna profundidad (mismo recorrido `baja` que
 * SQL_POR_PREPARAR_EN_FEATURES: sin pasar por borradas, hasta 50 niveles) y no son Features misma. Ideas, Áreas y lo que está
 * en otro estado no salen. Devuelve también el área de la Tarea y los datos de su madre (área, título y nombre del tipo; la madre
 * borrada no cuenta) para que la Tarea conserve su área al moverse. Si Features está borrada, no es de ese tablero o no es de este negocio (`f` vacía), no sale nada.
 * Solo lee. $1 = id del Área Features, $2 = tableroId, $3 = workspaceId.
 */
export const SQL_TAREAS_FUERA_DE_FEATURES = `
WITH RECURSIVE f AS (
  SELECT a."id"
  FROM "TarjetaTablero" a
  JOIN "TableroInteligente" b ON b."id" = a."tableroId"
  WHERE a."id" = $1::text AND a."tableroId" = $2::text AND a."borradoEn" IS NULL AND b."workspaceId" = $3::text
),
baja AS (
  SELECT h."id", 1 AS "nivel"
  FROM "TarjetaTablero" h
  WHERE h."padreId" = $1::text AND h."borradoEn" IS NULL
  UNION ALL
  SELECT h."id", s."nivel" + 1
  FROM baja s
  JOIN "TarjetaTablero" h ON h."padreId" = s."id" AND h."borradoEn" IS NULL
  WHERE s."nivel" < 50
)
SELECT c."id", c."padreId", c."estado"::text AS "estado", c."actualizadoEn", c."area",
  m."area" AS "madreArea", m."titulo" AS "madreTitulo", km."nombre" AS "madreTipo"
FROM "TarjetaTablero" c
JOIN "TableroInteligente" b ON b."id" = c."tableroId"
JOIN "TipoTarjeta" k ON k."id" = c."tipoId"
LEFT JOIN "TarjetaTablero" m ON m."id" = c."padreId" AND m."borradoEn" IS NULL
LEFT JOIN "TipoTarjeta" km ON km."id" = m."tipoId"
CROSS JOIN f
WHERE c."tableroId" = $2::text
  AND b."workspaceId" = $3::text
  AND lower(btrim(k."nombre")) = 'tarea'
  AND c."estado" IN ('APROBADO', 'PLAN_APROBADO')
  AND lower(btrim(c."repo")) IN ('gestion', 'aizencrm')
  AND c."borradoEn" IS NULL
  AND c."archivadaEn" IS NULL
  AND c."id" <> f."id"
  AND c."id" NOT IN (SELECT "id" FROM baja)
ORDER BY c."creadoEn" ASC, c."numero" ASC
LIMIT 200`;
