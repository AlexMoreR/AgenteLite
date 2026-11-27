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
 * Tareas a Features (27-nov-2026, tareas-a-features.ts): las Tareas aprobadas que quedaron FUERA de Features en el tablero de
 * Features, para colgarlas de Features una vez al día. $1 = id de Features, $2 = tablero, $3 = negocio (workspaceId).
 * `f` exige que Features exista en ese tablero y negocio y no esté borrada: sin esa fila no sale nada. `baja` es el mismo
 * recorrido de SQL_POR_PREPARAR_EN_FEATURES (hasta 50 niveles, sin pasar por borradas): lo que ya cuelga de Features no sale.
 * Solo tipo Tarea (por nombre, como esTipoTarea), en APROBADO o PLAN_APROBADO, con repo, sin borrar ni archivar.
 */
export const SQL_TAREAS_FUERA_DE_FEATURES = `
WITH RECURSIVE f AS (
  SELECT a."id"
  FROM "TarjetaTablero" a
  JOIN "TableroInteligente" t ON t."id" = a."tableroId"
  WHERE a."id" = $1::text AND a."tableroId" = $2::text AND a."borradoEn" IS NULL AND t."workspaceId" = $3::text
),
baja AS (
  SELECT h."id", 1 AS "nivel"
  FROM "TarjetaTablero" h
  WHERE h."padreId" IN (SELECT "id" FROM f) AND h."borradoEn" IS NULL
  UNION ALL
  SELECT h."id", s."nivel" + 1
  FROM baja s
  JOIN "TarjetaTablero" h ON h."padreId" = s."id" AND h."borradoEn" IS NULL
  WHERE s."nivel" < 50
)
SELECT c."id", c."padreId", c."estado"::text AS "estado", c."actualizadoEn"
FROM "TarjetaTablero" c
JOIN f ON true
JOIN "TableroInteligente" b ON b."id" = c."tableroId"
JOIN "TipoTarjeta" k ON k."id" = c."tipoId"
WHERE c."tableroId" = $2::text
  AND b."workspaceId" = $3::text
  AND lower(btrim(k."nombre")) = 'tarea'
  AND c."estado" IN ('APROBADO', 'PLAN_APROBADO')
  AND c."repo" IS NOT NULL
  AND btrim(c."repo") <> ''
  AND c."borradoEn" IS NULL
  AND c."archivadaEn" IS NULL
  AND c."id" <> f."id"
  AND c."id" NOT IN (SELECT "id" FROM baja)
ORDER BY c."creadoEn" ASC, c."numero" ASC`;
