/*
  LAS CONSULTAS DEL TRABAJADOR (Tablero IA, fase 2), en SQL a mano: tomar una tarjeta tiene que ser
  atómico (dos /tomar al mismo tiempo no se llevan la misma tarjeta ni pasan del máximo en paralelo).

  Están acá, como texto, para que el servicio (trabajador.ts) y la prueba con PGlite
  (scripts/check-tablero-trabajador-migracion.mjs) corran EXACTAMENTE las mismas.

  Fechas: las columnas son `timestamp without time zone` en UTC (como las escribe Prisma). Se pasan
  como ISO ("...Z") y se convierten con `::timestamptz AT TIME ZONE 'UTC'`, que da la hora UTC sin
  depender de la zona de la sesión.

  Parámetros (salvo SQL_CANDIDATAS): $1 = workspaceId, $2 = ahora (ISO).
  (SQL_PASAR_VENCIDAS_A_ERROR y SQL_ARRANQUE también escriben filas de IntentoTarjeta: 20261024120000_tablero_intentos.)
*/

import { MINUTOS_PARA_CONSTRUIR_EN_LA_NUBE, MINUTOS_POR_ETAPA } from "./reglas-trabajador";

const AHORA = `($2::timestamptz AT TIME ZONE 'UTC')`;

/** El candado del negocio para /tomar: dura lo que la transacción (dos /tomar del mismo negocio van en fila). */
// (En el FROM y con una columna: Prisma no sabe leer una columna de tipo void.)
export const SQL_CANDADO_DEL_NEGOCIO = `SELECT 1 AS "ok" FROM pg_advisory_xact_lock(hashtext('tablero-trabajador:' || $1::text))`;

/** A qué estado de la fila vuelve una tarjeta que el Coordinador tenía (la CTE se llama `v`, con la columna "antes"). */
const estadoDeLaFila = (v: string) =>
  `CASE ${v}."antes" WHEN 'PLANEANDO' THEN 'APROBADO'::"EstadoTarjeta" ELSE 'PLAN_APROBADO'::"EstadoTarjeta" END`;
const etapaDelAntes = (v: string) =>
  `CASE ${v}."antes" WHEN 'PLANEANDO' THEN 'planear' WHEN 'EN_CURSO' THEN 'construir' ELSE 'subir' END`;

/** El número del próximo intento de la tarjeta `v."id"`: las filas que tiene + 1. */
const numeroSiguiente = (v: string) => `(SELECT count(*) FROM "IntentoTarjeta" n WHERE n."tarjetaId" = ${v}."id")::int + 1`;

/**
 * El motivo de una tarjeta que pasa a ERROR desde SQL: SIEMPRE empieza con una frase fija que dice en qué estado
 * estaba ("venció el candado en EN_CURSO sin respuesta del Coordinador", "huérfana: PLANEANDO sin candado") y, si el
 * parámetro `texto` trae algo, sigue con ese texto. Nunca queda vacío. Para el historial de intentos va la frase sola.
 */
const fraseConEstado = (v: string, antes: string, despues: string) => `'${antes} ' || ${v}."antes" || ' ${despues}'`;
const motivoConEstado = (v: string, antes: string, despues: string, texto: string) =>
  `(${fraseConEstado(v, antes, despues)} || CASE WHEN btrim(COALESCE(${texto}::text, '')) = '' THEN '' ELSE E'\\n' || btrim(${texto}::text) END)`;

/** Un id para una fila de IntentoTarjeta insertada desde SQL (sin depender de extensiones). */
const idDelIntento = (v: string) => `'int' || md5(random()::text || clock_timestamp()::text || ${v}."id")`;

/**
 * Las que el Coordinador tenía (PLANEANDO, EN_CURSO, SUBIENDO) y se le vencieron (protocolo de reparación):
 *  - PLANEANDO o EN_CURSO que vencieron por FALTA DE LATIDO (el candado vencía antes del tope de su etapa:
 *    20 / 90 min) y con menos de $5 esperas seguidas: vuelven a la fila (APROBADO / PLAN_APROBADO), sin
 *    ERROR y sin gastar el intento, con una fila de IntentoTarjeta (coordinador_cortado, esperar, no cuenta).
 *  - El resto (vencieron por el tope de la etapa, ya llevan $5 esperas seguidas o estaban SUBIENDO, que pudo
 *    haber empujado a main) pasan a ERROR con el motivo ($3) en resultado.error ($4 = ahora como texto
 *    ISO: $2 no sirve como texto porque Postgres ya lo tipó timestamptz) y una fila de IntentoTarjeta
 *    (escalar, cuenta; categoria tiempo_agotado si fue por el tope, coordinador_cortado si no).
 * "Esperas seguidas" = filas de IntentoTarjeta con cuentaComoIntento = false después de la última con true.
 * Devuelve id, tableroId, el estado que tenían ("antes") y el que quedaron ("estado").
 */
export const SQL_PASAR_VENCIDAS_A_ERROR = `
WITH v AS (
  SELECT c."id", c."tableroId", c."estado"::text AS "antes", c."trabajoIniciadoEn" AS "ini", c."trabajoVenceEn" AS "vence",
         CASE c."estado"::text
           WHEN 'PLANEANDO' THEN ${MINUTOS_POR_ETAPA.planear}
           -- Construir en la nube tiene 180 min: el latido de la nube deja resultado.construccion.lugar = 'nube'.
           WHEN 'EN_CURSO' THEN (CASE WHEN c."resultado"->'construccion'->>'lugar' = 'nube' THEN ${MINUTOS_PARA_CONSTRUIR_EN_LA_NUBE} ELSE ${MINUTOS_POR_ETAPA.construir} END)
           ELSE ${MINUTOS_POR_ETAPA.subir}
         END AS "tope",
         (
           SELECT count(*) FROM "IntentoTarjeta" e
           WHERE e."tarjetaId" = c."id" AND NOT e."cuentaComoIntento"
             AND e."numero" > COALESCE((SELECT max(u."numero") FROM "IntentoTarjeta" u WHERE u."tarjetaId" = c."id" AND u."cuentaComoIntento"), 0)
         )::int AS "esperas"
  FROM "TarjetaTablero" c
  JOIN "TableroInteligente" b ON b."id" = c."tableroId"
  WHERE b."workspaceId" = $1
    AND c."borradoEn" IS NULL
    AND c."estado" IN ('PLANEANDO', 'EN_CURSO', 'SUBIENDO')
    AND c."trabajoVenceEn" IS NOT NULL
    AND c."trabajoVenceEn" <= ${AHORA}
  FOR UPDATE OF c
),
x AS (
  SELECT v.*,
         (v."ini" IS NULL OR v."vence" >= v."ini" + make_interval(mins => v."tope")) AS "portope",
         (v."antes" <> 'SUBIENDO' AND v."ini" IS NOT NULL AND v."vence" < v."ini" + make_interval(mins => v."tope") AND v."esperas" < $5::int) AS "vuelve"
  FROM v
),
sueltas AS (
  UPDATE "TarjetaTablero" t
  SET "estado" = ${estadoDeLaFila("x")},
      "trabajoVenceEn" = NULL,
      "intentos" = GREATEST(0, t."intentos" - 1),
      "actualizadoEn" = ${AHORA}
  FROM x
  WHERE t."id" = x."id" AND x."vuelve"
  RETURNING t."id", t."tableroId", x."antes", t."estado"::text AS "estado"
),
fallidas AS (
  UPDATE "TarjetaTablero" t
  SET "estado" = 'ERROR'::"EstadoTarjeta",
      "trabajoVenceEn" = NULL,
      "resultado" = COALESCE(t."resultado", '{}'::jsonb)
        || jsonb_build_object('error', jsonb_build_object('motivo', ${motivoConEstado("x", "venció el candado en", "sin respuesta del Coordinador", "$3")}, 'en', x."antes", 'cuando', $4::text)),
      "actualizadoEn" = ${AHORA}
  FROM x
  WHERE t."id" = x."id" AND NOT x."vuelve"
  RETURNING t."id", t."tableroId", x."antes", t."estado"::text AS "estado"
),
intentos AS (
  INSERT INTO "IntentoTarjeta" ("id", "tarjetaId", "numero", "etapa", "categoria", "causa", "error", "accion", "cuentaComoIntento", "creadoEn")
  SELECT ${idDelIntento("x")}, x."id", ${numeroSiguiente("x")}, ${etapaDelAntes("x")},
         CASE WHEN x."portope" AND NOT x."vuelve" THEN 'tiempo_agotado' ELSE 'coordinador_cortado' END,
         CASE
           WHEN x."vuelve" THEN 'El Coordinador dejó de dar señales (se cortó o se apagó); la tarjeta vuelve a la fila.'
           WHEN x."portope" THEN ${fraseConEstado("x", "Venció el candado en", "sin respuesta del Coordinador")} || ': la etapa se pasó de su tiempo máximo.'
           ELSE ${fraseConEstado("x", "Venció el candado en", "sin respuesta del Coordinador")} || ': ya había esperado varias veces seguidas.'
         END,
         NULL,
         CASE WHEN x."vuelve" THEN 'esperar' ELSE 'escalar' END,
         NOT x."vuelve",
         ${AHORA}
  FROM x
  RETURNING "id"
)
SELECT "id", "tableroId", "antes", "estado" FROM sueltas
UNION ALL
SELECT "id", "tableroId", "antes", "estado" FROM fallidas`;

/**
 * /arranque: el Coordinador acaba de arrancar, así que lo que el negocio tenía en PLANEANDO o EN_CURSO con
 * candado (trabajoVenceEn) lo tenía el proceso anterior, que murió. Vuelve a la fila (APROBADO /
 * PLAN_APROBADO) sin ERROR y sin gastar el intento, con una fila de IntentoTarjeta (coordinador_cortado,
 * esperar, no cuenta). SUBIENDO no se toca: pudo haber empujado a main (sigue como hoy y vence).
 * Parámetros: $1 = workspaceId, $2 = ahora (ISO). Devuelve id, tableroId y el estado que tenían ("antes").
 */
export const SQL_ARRANQUE = `
WITH v AS (
  SELECT c."id", c."tableroId", c."estado"::text AS "antes"
  FROM "TarjetaTablero" c
  JOIN "TableroInteligente" b ON b."id" = c."tableroId"
  WHERE b."workspaceId" = $1
    AND c."borradoEn" IS NULL
    AND c."estado" IN ('PLANEANDO', 'EN_CURSO')
    AND c."trabajoVenceEn" IS NOT NULL
  FOR UPDATE OF c
),
sueltas AS (
  UPDATE "TarjetaTablero" t
  SET "estado" = ${estadoDeLaFila("v")},
      "trabajoVenceEn" = NULL,
      "intentos" = GREATEST(0, t."intentos" - 1),
      "actualizadoEn" = ${AHORA}
  FROM v
  WHERE t."id" = v."id"
  RETURNING t."id", t."tableroId", v."antes"
),
intentos AS (
  INSERT INTO "IntentoTarjeta" ("id", "tarjetaId", "numero", "etapa", "categoria", "causa", "error", "accion", "cuentaComoIntento", "creadoEn")
  SELECT ${idDelIntento("v")}, v."id", ${numeroSiguiente("v")}, ${etapaDelAntes("v")}, 'coordinador_cortado',
         'El Coordinador se reinició mientras la tenía; vuelve a la fila.', NULL, 'esperar', false, ${AHORA}
  FROM v
  RETURNING "id"
)
SELECT "id", "tableroId", "antes" FROM sueltas`;

/** ¿Esta tarjeta es una parte (hija creada por /partir)? $1 = tableroId, $2 = id de la tarjeta. Devuelve una fila si sí. */
export const SQL_ES_PARTE = `
SELECT m."id"
FROM "TarjetaTablero" m
WHERE m."tableroId" = $1
  AND m."resultado" -> 'partida' -> 'hijas' @> jsonb_build_array($2::text)
LIMIT 1`;

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
 * protegida solo si su última aprobación fue en la pantalla, o automática si son solo CHATS / BOT_VENTAS (25-oct). Una APROBADO o PLAN_APROBADO con una
 * dependencia sin terminar (flecha esDependencia cuyo origen, sin borrar y de un tipo con estados, no está HECHO) espera (un Área no tiene estado y bloquearía para siempre); una
 * SUBIENDO no (ya construyó).
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
      c."estado" = 'SUBIENDO'
      OR NOT EXISTS (
        SELECT 1
        FROM "ConexionTarjeta" x
        JOIN "TarjetaTablero" o ON o."id" = x."origenId"
        JOIN "TipoTarjeta" ot ON ot."id" = o."tipoId"
        WHERE x."destinoId" = c."id" AND x."esDependencia" AND o."borradoEn" IS NULL AND o."estado" <> 'HECHO'
          AND ot."usaEstados"
      )
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
      -- Regla del dueño (25-oct): CHATS y BOT_VENTAS arrancan con la aprobación automática, sin pasar por la pantalla.
      OR (
        c."zonaProtegida" <@ ARRAY['CHATS', 'BOT_VENTAS']::text[]
        AND (
          SELECT h."despues"->>'via'
          FROM "HistorialTarjeta" h
          WHERE h."tarjetaId" = c."id" AND h."accion" = 'aprobar' AND h."deshechoEn" IS NULL
          ORDER BY h."creadoEn" DESC
          LIMIT 1
        ) = 'automatica'
      )
    )`;

/** Primero una SUBIENDO pendiente (la que sube sola no espera detrás de otras); después la que más espera. */
const ORDEN_PARA_TOMAR = `ORDER BY (c."estado" = 'SUBIENDO') DESC, c."actualizadoEn" ASC, c."creadoEn" ASC`;

/**
 * Las que podría tomar, SIN tomarlas, en el orden en que las tomaría. El trabajador las mira para no
 * juntar en paralelo dos del mismo repo que tocan la misma zona o el mismo módulo, ni dos subidas del
 * mismo repo: esas las manda en `excluir` a /tomar y esperan en fila.
 * "desbloquea" (25-oct-2026): cuántas tarjetas esperan a que esta esté HECHO (flechas esDependencia que salen de
 * ella): el Coordinador toma primero las que desbloquean a otras (trabajador-tablero/lib/reparto.mjs).
 * Parámetros: $1 = workspaceId, $2 = repos (text[]).
 */
export const SQL_CANDIDATAS = `
SELECT c."id", c."titulo", c."estado"::text AS "estado", c."repo", c."zonaProtegida", c."plan",
  (SELECT count(*)::int FROM "ConexionTarjeta" d WHERE d."origenId" = c."id" AND d."esDependencia") AS "desbloquea"
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

/**
 * Las madres partidas del negocio que todavía están en su etapa (PLANEANDO o EN_CURSO, sin candado): /tomar
 * revisa en cada vuelta si sus partes ya terminaron para cerrarlas (cierreDeLaMadre en reglas-trabajador.ts).
 * $1 = workspaceId. Devuelve id.
 */
export const SQL_MADRES_PARTIDAS = `
SELECT c."id"
FROM "TarjetaTablero" c
JOIN "TableroInteligente" b ON b."id" = c."tableroId"
WHERE b."workspaceId" = $1
  AND c."borradoEn" IS NULL
  AND c."estado" IN ('PLANEANDO', 'EN_CURSO')
  AND c."trabajoVenceEn" IS NULL
  AND jsonb_typeof(c."resultado" -> 'partida' -> 'hijas') = 'array'
ORDER BY c."actualizadoEn" ASC
LIMIT 50`;

/**
 * Red de seguridad de /tomar (26-oct-2026): las HUÉRFANAS pasan a ERROR. Huérfana = tarjeta con repo, de un tipo
 * con aprobación y estados, en PLANEANDO o EN_CURSO SIN candado (trabajoVenceEn NULL), sin cambios hace más de
 * $5 minutos y que no es una madre partida con alguna parte viva (esa espera a sus partes). Nadie la trabaja y,
 * sin candado, SQL_PASAR_VENCIDAS_A_ERROR nunca la vería. SUBIENDO sin candado NO entra: es la SUBIENDO pendiente.
 * $3 = motivo, $4 = ahora como texto ISO, $5 = minutos. Deja su fila en IntentoTarjeta (escalar, no cuenta: nadie
 * la intentó). Devuelve id, tableroId y el estado que tenían ("antes").
 */
export const SQL_PASAR_HUERFANAS_A_ERROR = `
WITH v AS (
  SELECT c."id", c."tableroId", c."estado"::text AS "antes"
  FROM "TarjetaTablero" c
  JOIN "TableroInteligente" b ON b."id" = c."tableroId"
  JOIN "TipoTarjeta" k ON k."id" = c."tipoId"
  WHERE b."workspaceId" = $1
    AND c."borradoEn" IS NULL
    AND c."repo" IS NOT NULL
    AND k."requiereAprobacion" AND k."usaEstados"
    AND c."estado" IN ('PLANEANDO', 'EN_CURSO')
    AND c."trabajoVenceEn" IS NULL
    AND c."actualizadoEn" <= ${AHORA} - make_interval(mins => $5::int)
    AND NOT EXISTS (
      SELECT 1 FROM "TarjetaTablero" h
      WHERE h."borradoEn" IS NULL
        AND jsonb_typeof(c."resultado" -> 'partida' -> 'hijas') = 'array'
        AND c."resultado" -> 'partida' -> 'hijas' @> jsonb_build_array(h."id")
    )
  FOR UPDATE OF c
),
fallidas AS (
  UPDATE "TarjetaTablero" t
  SET "estado" = 'ERROR'::"EstadoTarjeta",
      "resultado" = COALESCE(t."resultado", '{}'::jsonb)
        || jsonb_build_object('error', jsonb_build_object('motivo', ${motivoConEstado("v", "huérfana:", "sin candado", "$3")}, 'en', v."antes", 'cuando', $4::text)),
      "actualizadoEn" = ${AHORA}
  FROM v
  WHERE t."id" = v."id"
  RETURNING t."id", t."tableroId", v."antes"
),
intentos AS (
  INSERT INTO "IntentoTarjeta" ("id", "tarjetaId", "numero", "etapa", "categoria", "causa", "error", "accion", "cuentaComoIntento", "creadoEn")
  SELECT ${idDelIntento("v")}, v."id", ${numeroSiguiente("v")}, ${etapaDelAntes("v")}, 'coordinador_cortado',
         'Quedó huérfana: estaba en ' || v."antes" || ' sin el candado del Coordinador y nadie la trabajaba.', NULL, 'escalar', false, ${AHORA}
  FROM v
  RETURNING "id"
)
SELECT "id", "tableroId", "antes" FROM fallidas`;
