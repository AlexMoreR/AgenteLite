/*
  LAS CONSULTAS DEL TRABAJADOR (Tablero IA, fase 2), en SQL a mano: tomar una tarjeta tiene que ser
  atómico (dos /tomar al mismo tiempo no se llevan la misma tarjeta ni pasan del máximo en paralelo).

  Están acá, como texto, para que el servicio (trabajador.ts) y la prueba con PGlite
  (scripts/check-tablero-trabajador-migracion.mjs) corran EXACTAMENTE las mismas.

  Fechas: las columnas son `timestamp without time zone` en UTC (como las escribe Prisma). Se pasan
  como ISO ("...Z") y se convierten con `::timestamptz AT TIME ZONE 'UTC'`, que da la hora UTC sin
  depender de la zona de la sesión.

  Parámetros (salvo SQL_CANDIDATAS): $1 = workspaceId, $2 = ahora (ISO).
*/

const AHORA = `($2::timestamptz AT TIME ZONE 'UTC')`;

/** El candado del negocio para /tomar: dura lo que la transacción (dos /tomar del mismo negocio van en fila). */
// (En el FROM y con una columna: Prisma no sabe leer una columna de tipo void.)
export const SQL_CANDADO_DEL_NEGOCIO = `SELECT 1 AS "ok" FROM pg_advisory_xact_lock(hashtext('tablero-trabajador:' || $1::text))`;

/**
 * Las que el trabajador tenía (PLANEANDO, EN_CURSO, SUBIENDO) y se le vencieron sin latido: pasan a
 * ERROR con el motivo ($3) en resultado.error ($4 = ahora como texto ISO: $2 no sirve como texto porque
 * Postgres ya lo tipó timestamptz). Devuelve id, tableroId y el estado que tenían.
 */
export const SQL_PASAR_VENCIDAS_A_ERROR = `
WITH vencidas AS (
  SELECT c."id", c."estado"::text AS "antes"
  FROM "TarjetaTablero" c
  JOIN "TableroInteligente" b ON b."id" = c."tableroId"
  WHERE b."workspaceId" = $1
    AND c."borradoEn" IS NULL
    AND c."estado" IN ('PLANEANDO', 'EN_CURSO', 'SUBIENDO')
    AND c."trabajoVenceEn" IS NOT NULL
    AND c."trabajoVenceEn" <= ${AHORA}
  FOR UPDATE OF c
)
UPDATE "TarjetaTablero" t
SET "estado" = 'ERROR'::"EstadoTarjeta",
    "trabajoVenceEn" = NULL,
    "resultado" = COALESCE(t."resultado", '{}'::jsonb)
      || jsonb_build_object('error', jsonb_build_object('motivo', $3::text, 'en', vencidas."antes", 'cuando', $4::text)),
    "actualizadoEn" = ${AHORA}
FROM vencidas
WHERE t."id" = vencidas."id"
RETURNING t."id", t."tableroId", vencidas."antes"`;

/** ¿El trabajador ya tiene una tarjeta de este negocio (con el candado vigente)? */
export const SQL_HAY_UNA_TRABAJANDO = `
SELECT c."id"
FROM "TarjetaTablero" c
JOIN "TableroInteligente" b ON b."id" = c."tableroId"
WHERE b."workspaceId" = $1
  AND c."borradoEn" IS NULL
  AND c."estado" IN ('PLANEANDO', 'EN_CURSO', 'SUBIENDO')
  AND c."trabajoVenceEn" > ${AHORA}
LIMIT 1`;

/** Las que el trabajador tiene en las manos en este negocio (con el candado vigente). */
export const SQL_TRABAJANDO = `
SELECT c."id"
FROM "TarjetaTablero" c
JOIN "TableroInteligente" b ON b."id" = c."tableroId"
WHERE b."workspaceId" = $1
  AND c."borradoEn" IS NULL
  AND c."estado" IN ('PLANEANDO', 'EN_CURSO', 'SUBIENDO')
  AND c."trabajoVenceEn" > ${AHORA}
ORDER BY c."trabajoIniciadoEn" ASC`;

/**
 * Qué se puede tomar: solo tipos con aprobación, con repo de la lista (`repos`, el parámetro text[]),
 * sin borrar, en APROBADO, PLAN_APROBADO (con plan) o SUBIENDO pendiente (sin candado). Una con zona
 * protegida solo si su última aprobación fue en la pantalla.
 */
const wherePara = (repos: string) => `
  WHERE b."workspaceId" = $1
    AND c."borradoEn" IS NULL
    AND k."requiereAprobacion" AND k."usaEstados"
    AND c."repo" = ANY(${repos}::text[])
    AND (
      c."estado" = 'APROBADO'
      OR (c."estado" = 'PLAN_APROBADO' AND c."plan" IS NOT NULL)
      OR (c."estado" = 'SUBIENDO' AND c."trabajoVenceEn" IS NULL)
    )
    AND (
      cardinality(c."zonaProtegida") = 0
      OR (
        SELECT h."despues"->>'via'
        FROM "HistorialTarjeta" h
        WHERE h."tarjetaId" = c."id" AND h."accion" = 'aprobar' AND h."deshechoEn" IS NULL
        ORDER BY h."creadoEn" DESC
        LIMIT 1
      ) = 'pantalla'
    )`;

/** Primero una SUBIENDO pendiente (la que sube sola no espera detrás de otras); después la que más espera. */
const ORDEN_PARA_TOMAR = `ORDER BY (c."estado" = 'SUBIENDO') DESC, c."actualizadoEn" ASC, c."creadoEn" ASC`;

/**
 * Las que podría tomar, SIN tomarlas, en el orden en que las tomaría. El trabajador las mira para no
 * juntar en paralelo dos del mismo repo que tocan la misma zona o el mismo módulo, ni dos subidas del
 * mismo repo: esas las manda en `excluir` a /tomar y esperan en fila.
 * Parámetros: $1 = workspaceId, $2 = repos (text[]).
 */
export const SQL_CANDIDATAS = `
SELECT c."id", c."titulo", c."estado"::text AS "estado", c."repo", c."zonaProtegida", c."plan"
FROM "TarjetaTablero" c
JOIN "TableroInteligente" b ON b."id" = c."tableroId"
JOIN "TipoTarjeta" k ON k."id" = c."tipoId"
${wherePara("$2")}
${ORDEN_PARA_TOMAR}
LIMIT 50`;

/**
 * Toma UNA tarjeta (la primera de SQL_CANDIDATAS que no esté en $5): APROBADO -> PLANEANDO,
 * PLAN_APROBADO -> EN_CURSO, SUBIENDO pendiente (sin candado) -> SUBIENDO con candado.
 * $3 = repos (text[]), $4 = vencimiento del candado (ISO), $5 = ids que NO se toman (text[]).
 */
export const SQL_TOMAR_UNA = `
WITH elegida AS (
  SELECT c."id", c."estado"::text AS "antes"
  FROM "TarjetaTablero" c
  JOIN "TableroInteligente" b ON b."id" = c."tableroId"
  JOIN "TipoTarjeta" k ON k."id" = c."tipoId"
  ${wherePara("$3")}
    AND NOT (c."id" = ANY($5::text[]))
  ${ORDEN_PARA_TOMAR}
  LIMIT 1
  FOR UPDATE OF c SKIP LOCKED
)
UPDATE "TarjetaTablero" t
SET "estado" = CASE elegida."antes"
      WHEN 'APROBADO' THEN 'PLANEANDO'::"EstadoTarjeta"
      WHEN 'PLAN_APROBADO' THEN 'EN_CURSO'::"EstadoTarjeta"
      ELSE 'SUBIENDO'::"EstadoTarjeta"
    END,
    "trabajoIniciadoEn" = ${AHORA},
    "trabajoVenceEn" = ($4::timestamptz AT TIME ZONE 'UTC'),
    "intentos" = t."intentos" + 1,
    "actualizadoEn" = ${AHORA}
FROM elegida
WHERE t."id" = elegida."id"
RETURNING t."id", t."tableroId", elegida."antes", t."estado"::text AS "estado"`;
