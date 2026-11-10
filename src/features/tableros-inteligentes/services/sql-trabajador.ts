/*
  LAS CONSULTAS DEL TRABAJADOR (Tablero IA, fase 2), en SQL a mano: tomar una tarjeta tiene que ser
  atómico (dos /tomar al mismo tiempo no se llevan la misma tarjeta ni pasan del máximo en paralelo).

  Están acá, como texto, para que el servicio (trabajador.ts) y la prueba con PGlite
  (scripts/check-tablero-trabajador-migracion.mjs) corran EXACTAMENTE las mismas.

  Fechas: las columnas son `timestamp without time zone` en UTC (como las escribe Prisma). Se pasan
  como ISO ("...Z") y se convierten con `::timestamptz AT TIME ZONE 'UTC'`, que da la hora UTC sin
  depender de la zona de la sesión.

  Parámetros (salvo SQL_CANDIDATAS): $1 = workspaceId, $2 = ahora (ISO).
  (SQL_PASAR_VENCIDAS_A_ERROR, SQL_TARJETAS_CAIDAS, SQL_PASAR_HUERFANAS_A_ERROR y SQL_ARRANQUE también escriben filas de
  IntentoTarjeta: 20261024120000_tablero_intentos.)
*/

import {
  MINUTOS_PARA_CONSTRUIR_EN_LA_NUBE,
  MINUTOS_PARA_CONSTRUIR_EN_ORQUESTADOR,
  MINUTOS_POR_ETAPA,
  MINUTOS_SIN_SENAL_PARA_CAIDA,
  PALABRA_DE_PRIORIDAD,
  PALABRAS_DE_LA_FILA,
  REPO_DE_GESTION,
  TOPE_DE_REINTENTOS_AUTOMATICOS,
  VIAS_QUE_ARRANCAN_ZONAS_SOLAS,
  ZONAS_DE_VENTAS_Y_CHATS,
  ZONAS_QUE_ARRANCAN_POR_VOZ,
  ZONAS_QUE_ARRANCAN_SOLAS,
} from "./reglas-trabajador";

const AHORA = `($2::timestamptz AT TIME ZONE 'UTC')`;

/** El candado del negocio para /tomar: dura lo que la transacción (dos /tomar del mismo negocio van en fila). */
// (En el FROM y con una columna: Prisma no sabe leer una columna de tipo void.)
export const SQL_CANDADO_DEL_NEGOCIO = `SELECT 1 AS "ok" FROM pg_advisory_xact_lock(hashtext('tablero-trabajador:' || $1::text))`;

/**
 * A qué estado de la fila vuelve una tarjeta que el Coordinador tenía (la CTE se llama `v`, con la columna "antes").
 * Una SUBIENDO vuelve a SUBIENDO pendiente (sin candado): subir es repetible (1-nov-2026, parte 1 del "un solo sí").
 */
const estadoDeLaFila = (v: string) =>
  `CASE ${v}."antes" WHEN 'PLANEANDO' THEN 'APROBADO'::"EstadoTarjeta" WHEN 'SUBIENDO' THEN 'SUBIENDO'::"EstadoTarjeta" ELSE 'PLAN_APROBADO'::"EstadoTarjeta" END`;
const etapaDelAntes = (v: string) =>
  `CASE ${v}."antes" WHEN 'PLANEANDO' THEN 'planear' WHEN 'EN_CURSO' THEN 'construir' ELSE 'subir' END`;

/** El número del próximo intento de la tarjeta `v."id"`: las filas que tiene + 1. */
const numeroSiguiente = (v: string) => `(SELECT count(*) FROM "IntentoTarjeta" n WHERE n."tarjetaId" = ${v}."id")::int + 1`;

/**
 * El motivo que queda en resultado.error de una vencida o una huérfana (30-oct-2026): nunca vacío y siempre con el estado
 * en que estaba. Primero la frase fija y, debajo, el motivo que manda el servidor ($3) si trae algo.
 */
const motivoConEstado = (frase: string) => `(${frase} || COALESCE(E'\\n' || NULLIF(btrim($3::text), ''), ''))`;
const fraseDeVencida = (v: string) => `('venció el candado en ' || ${v}."antes" || ' sin respuesta del Coordinador')`;
const fraseDeHuerfana = (v: string) => `('huérfana: ' || ${v}."antes" || ' sin candado')`;

/** Un id para una fila de IntentoTarjeta insertada desde SQL (sin depender de extensiones). */
const idDelIntento = (v: string) => `'int' || md5(random()::text || clock_timestamp()::text || ${v}."id")`;

/* ── Tarjetas caídas (10-nov-2026): reintentarCaidas y sus piezas, las mismas reglas que decidirCaida ── */

/**
 * La última señal real de la tarjeta `c` (resultado.construccion.ultimaSenalEn), como hora UTC; NULL si no hay o no tiene
 * la forma exacta de un ISO de toISOString (así un texto raro no tumba la consulta).
 */
const ultimaSenal = (c: string) => `(CASE WHEN (${c}."resultado"->'construccion'->>'ultimaSenalEn') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,6})?Z$'
    THEN ((${c}."resultado"->'construccion'->>'ultimaSenalEn')::timestamptz AT TIME ZONE 'UTC') END)`;

/** Los reintentos automáticos que lleva la tarjeta `c` (resultado.reintentosAutomaticos.veces), 0 si no hay. */
const reintentosDe = (c: string) => `(CASE WHEN jsonb_typeof(${c}."resultado"->'reintentosAutomaticos'->'veces') = 'number'
    THEN GREATEST(0, floor((${c}."resultado"->'reintentosAutomaticos'->>'veces')::numeric))::int ELSE 0 END)`;

/** Los minutos enteros entre `desde` y ahora. */
const minutosDesde = (desde: string) => `floor(extract(epoch from (${AHORA} - ${desde})) / 60)::int`;

/** Los motivos guardados de la tarjeta `t` más el nuevo de `x` ("causa"), con el estado, los minutos y cuándo. */
const motivosCon = (x: string, cuando: string) => `(CASE WHEN jsonb_typeof(t."resultado"->'reintentosAutomaticos'->'motivos') = 'array'
    THEN t."resultado"->'reintentosAutomaticos'->'motivos' ELSE '[]'::jsonb END
    || jsonb_build_array(jsonb_build_object('motivo', ${x}."causa", 'en', ${x}."antes", 'minutos', ${x}."minutos", 'cuando', ${cuando})))`;

/** El motivo del ERROR de una tarjeta que se cayó por tercera vez (el texto que pidió el dueño). */
const fraseDeCaida = (x: string) =>
  `('se cayó la construcción ' || (${x}."veces" + 1)::text || ' veces (último: ' || ${x}."antes" || ', ' || ${x}."minutos"::text || ' min sin señal)')`;

/**
 * Las piezas (CTE) que reintentan o pasan a ERROR las filas de `x` que cumplen `donde` (una tarjeta caída). `x` trae "id",
 * "tableroId", "antes", "veces" (reintentos automáticos que lleva), "minutos" (sin señal) y "causa" (el motivo de esta caída).
 *  - Con menos de TOPE_DE_REINTENTOS_AUTOMATICOS: vuelve a la fila (estadoDeLaFila; el plan aprobado sigue aprobado), sin
 *    candado, con veces + 1 y el motivo agregado a resultado.reintentosAutomaticos.motivos.
 *  - Con el tope: ERROR con resultado.error = { motivo: fraseDeCaida, en, cuando, por: 'caida' } (el aviso urgente al dueño
 *    lo busca por `por`) y el contador vuelve a 0 (los motivos se guardan): un Reintentar del dueño tiene otros 2.
 *  - Siempre una fila de IntentoTarjeta: construccion_caida, reintentar o escalar, cuenta como intento.
 * Devuelve las CTE `reintentadas` y `caidas` (id, tableroId, antes, estado, motivo, tipo) y `intentos_de_caida`.
 */
const reintentarCaidas = (x: string, donde: string, cuando: string) => `
reintentadas AS (
  UPDATE "TarjetaTablero" t
  SET "estado" = ${estadoDeLaFila(x)},
      "trabajoVenceEn" = NULL,
      "resultado" = COALESCE(t."resultado", '{}'::jsonb)
        || jsonb_build_object('reintentosAutomaticos', jsonb_build_object('veces', ${x}."veces" + 1, 'motivos', ${motivosCon(x, cuando)})),
      "actualizadoEn" = ${AHORA}
  FROM ${x}
  WHERE t."id" = ${x}."id" AND ${donde} AND ${x}."veces" < ${TOPE_DE_REINTENTOS_AUTOMATICOS}
  RETURNING t."id", t."tableroId", ${x}."antes", t."estado"::text AS "estado", NULL::text AS "motivo", 'reintentada'::text AS "tipo"
),
caidas AS (
  UPDATE "TarjetaTablero" t
  SET "estado" = 'ERROR'::"EstadoTarjeta",
      "trabajoVenceEn" = NULL,
      "resultado" = COALESCE(t."resultado", '{}'::jsonb)
        || jsonb_build_object(
          'error', jsonb_build_object('motivo', ${fraseDeCaida(x)}, 'en', ${x}."antes", 'cuando', ${cuando}, 'por', 'caida'),
          'reintentosAutomaticos', jsonb_build_object('veces', 0, 'motivos', ${motivosCon(x, cuando)})
        ),
      "actualizadoEn" = ${AHORA}
  FROM ${x}
  WHERE t."id" = ${x}."id" AND ${donde} AND ${x}."veces" >= ${TOPE_DE_REINTENTOS_AUTOMATICOS}
  RETURNING t."id", t."tableroId", ${x}."antes", t."estado"::text AS "estado", t."resultado"->'error'->>'motivo' AS "motivo", 'caida'::text AS "tipo"
),
intentos_de_caida AS (
  INSERT INTO "IntentoTarjeta" ("id", "tarjetaId", "numero", "etapa", "categoria", "causa", "error", "accion", "cuentaComoIntento", "creadoEn")
  SELECT ${idDelIntento(x)}, ${x}."id", ${numeroSiguiente(x)}, ${etapaDelAntes(x)}, 'construccion_caida',
         CASE WHEN ${x}."veces" < ${TOPE_DE_REINTENTOS_AUTOMATICOS}
           THEN 'Se cayó (' || ${x}."causa" || '): vuelve sola a la fila, reintento ' || (${x}."veces" + 1)::text || ' de ${TOPE_DE_REINTENTOS_AUTOMATICOS}.'
           ELSE 'Se cayó otra vez (' || ${x}."causa" || '): ' || ${fraseDeCaida(x)} || '.'
         END,
         NULL,
         CASE WHEN ${x}."veces" < ${TOPE_DE_REINTENTOS_AUTOMATICOS} THEN 'reintentar' ELSE 'escalar' END,
         true,
         ${AHORA}
  FROM ${x}
  WHERE ${donde}
  RETURNING "id"
)`;

/**
 * Las que el Coordinador tenía (PLANEANDO, EN_CURSO, SUBIENDO) y se le vencieron (protocolo de reparación):
 *  - PLANEANDO, EN_CURSO o SUBIENDO que vencieron por FALTA DE LATIDO (el candado vencía antes del tope de su
 *    etapa) y con menos de $5 esperas seguidas: vuelven a la fila (APROBADO / PLAN_APROBADO / SUBIENDO pendiente,
 *    con el candado vacío), sin ERROR y sin gastar el intento, con una fila de IntentoTarjeta (coordinador_cortado,
 *    esperar, no cuenta). Una SUBIENDO se puede repetir sin miedo (1-nov-2026): si la rama ya está en main, subir no
 *    la vuelve a empujar.
 *  - Las que vencieron por el TOPE DE LA ETAPA (10-nov-2026) se cayeron: siguen la regla de las caídas (reintentarCaidas):
 *    vuelven solas a la fila hasta TOPE_DE_REINTENTOS_AUTOMATICOS veces y después pasan a ERROR con el aviso urgente.
 *  - Las que vencieron por falta de latido y ya llevan $5 esperas seguidas pasan a ERROR como siempre, con el motivo
 *    ($3) en resultado.error ($4 = ahora como texto ISO: $2 no sirve como texto porque Postgres ya lo tipó timestamptz) y
 *    una fila de IntentoTarjeta (coordinador_cortado, escalar, cuenta).
 * "Esperas seguidas" = filas de IntentoTarjeta con cuentaComoIntento = false después de la última con true.
 * Devuelve id, tableroId, el estado que tenían ("antes"), el que quedaron ("estado"), el motivo del ERROR ("motivo") y
 * "tipo": suelta (volvió por falta de latido), reintentada (se cayó y vuelve sola), caida (se cayó y pasó a ERROR) o vencida.
 */
export const SQL_PASAR_VENCIDAS_A_ERROR = `
WITH v AS (
  SELECT c."id", c."tableroId", c."estado"::text AS "antes", c."trabajoIniciadoEn" AS "ini", c."trabajoVenceEn" AS "vence",
         CASE c."estado"::text
           WHEN 'PLANEANDO' THEN ${MINUTOS_POR_ETAPA.planear}
           -- Construir en la nube tiene 180 min: el latido de la nube deja resultado.construccion.lugar = 'nube'.
           -- En el orquestador (1-nov-2026), 24 h: el latido deja lugar = 'orquestador'.
           WHEN 'EN_CURSO' THEN (CASE c."resultado"->'construccion'->>'lugar'
             WHEN 'nube' THEN ${MINUTOS_PARA_CONSTRUIR_EN_LA_NUBE}
             WHEN 'orquestador' THEN ${MINUTOS_PARA_CONSTRUIR_EN_ORQUESTADOR}
             ELSE ${MINUTOS_POR_ETAPA.construir} END)
           ELSE ${MINUTOS_POR_ETAPA.subir}
         END AS "tope",
         (
           SELECT count(*) FROM "IntentoTarjeta" e
           WHERE e."tarjetaId" = c."id" AND NOT e."cuentaComoIntento"
             AND e."numero" > COALESCE((SELECT max(u."numero") FROM "IntentoTarjeta" u WHERE u."tarjetaId" = c."id" AND u."cuentaComoIntento"), 0)
         )::int AS "esperas",
         ${ultimaSenal("c")} AS "senal",
         ${reintentosDe("c")} AS "veces"
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
         (v."ini" IS NOT NULL AND v."vence" < v."ini" + make_interval(mins => v."tope") AND v."esperas" < $5::int) AS "vuelve",
         -- Los minutos sin señal: desde la última señal real de esta vuelta o, si no hay, desde que se tomó.
         ${minutosDesde(`COALESCE(CASE WHEN v."senal" >= v."ini" THEN v."senal" END, v."ini", v."vence")`)} AS "minutos",
         (v."antes" || ': se pasó del tiempo máximo de la etapa') AS "causa"
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
  RETURNING t."id", t."tableroId", x."antes", t."estado"::text AS "estado", NULL::text AS "motivo", 'suelta'::text AS "tipo"
),
fallidas AS (
  UPDATE "TarjetaTablero" t
  SET "estado" = 'ERROR'::"EstadoTarjeta",
      "trabajoVenceEn" = NULL,
      "resultado" = COALESCE(t."resultado", '{}'::jsonb)
        || jsonb_build_object('error', jsonb_build_object('motivo', ${motivoConEstado(fraseDeVencida("x"))}, 'en', x."antes", 'cuando', $4::text)),
      "actualizadoEn" = ${AHORA}
  FROM x
  WHERE t."id" = x."id" AND NOT x."vuelve" AND NOT x."portope"
  RETURNING t."id", t."tableroId", x."antes", t."estado"::text AS "estado", t."resultado"->'error'->>'motivo' AS "motivo", 'vencida'::text AS "tipo"
),
intentos AS (
  INSERT INTO "IntentoTarjeta" ("id", "tarjetaId", "numero", "etapa", "categoria", "causa", "error", "accion", "cuentaComoIntento", "creadoEn")
  SELECT ${idDelIntento("x")}, x."id", ${numeroSiguiente("x")}, ${etapaDelAntes("x")}, 'coordinador_cortado',
         CASE
           WHEN x."vuelve" THEN 'El Coordinador dejó de dar señales (se cortó o se apagó); la tarjeta vuelve a la fila.'
           ELSE 'El Coordinador dejó de dar señales y ya había esperado varias veces seguidas: ' || ${fraseDeVencida("x")} || '.'
         END,
         NULL,
         CASE WHEN x."vuelve" THEN 'esperar' ELSE 'escalar' END,
         NOT x."vuelve",
         ${AHORA}
  FROM x
  WHERE NOT x."portope"
  RETURNING "id"
),${reintentarCaidas("x", `x."portope"`, "$4::text")}
SELECT "id", "tableroId", "antes", "estado", "motivo", "tipo" FROM sueltas
UNION ALL
SELECT "id", "tableroId", "antes", "estado", "motivo", "tipo" FROM fallidas
UNION ALL
SELECT "id", "tableroId", "antes", "estado", "motivo", "tipo" FROM reintentadas
UNION ALL
SELECT "id", "tableroId", "antes", "estado", "motivo", "tipo" FROM caidas`;

/**
 * Las TARJETAS CAÍDAS (10-nov-2026): PLANEANDO, EN_CURSO o SUBIENDO con el candado vigente (el latido lo sigue corriendo)
 * pero sin una señal real nueva (resultado.construccion.ultimaSenalEn, de esta vuelta) hace más de
 * MINUTOS_SIN_SENAL_PARA_CAIDA (90 / 90 / 45 min). Sin señal se cuenta desde trabajoIniciadoEn; una construcción en la nube o
 * en el orquestador y una SUBIENDO que todavía no mandaron ninguna señal siguen (manda el tope de la etapa). Es la misma
 * regla que decidirCaida (reglas-trabajador.ts). Cada una sigue reintentarCaidas.
 * Parámetros: $1 = workspaceId, $2 = ahora (ISO), $3 = ahora como texto ISO. Devuelve lo mismo que SQL_PASAR_VENCIDAS_A_ERROR.
 */
export const SQL_TARJETAS_CAIDAS = `
WITH v AS (
  SELECT c."id", c."tableroId", c."estado"::text AS "antes", c."trabajoIniciadoEn" AS "ini",
         c."resultado"->'construccion'->>'lugar' AS "lugar",
         ${ultimaSenal("c")} AS "senal",
         ${reintentosDe("c")} AS "veces"
  FROM "TarjetaTablero" c
  JOIN "TableroInteligente" b ON b."id" = c."tableroId"
  WHERE b."workspaceId" = $1
    AND c."borradoEn" IS NULL
    AND c."estado" IN ('PLANEANDO', 'EN_CURSO', 'SUBIENDO')
    AND c."trabajoVenceEn" > ${AHORA}
    AND c."trabajoIniciadoEn" IS NOT NULL
  FOR UPDATE OF c
),
s AS (
  SELECT v.*, CASE WHEN v."senal" >= v."ini" THEN v."senal" END AS "valida" FROM v
),
x AS (
  SELECT s."id", s."tableroId", s."antes", s."veces",
         ${minutosDesde(`COALESCE(s."valida", s."ini")`)} AS "minutos",
         (s."antes" || ': ' || ${minutosDesde(`COALESCE(s."valida", s."ini")`)}::text || ' min sin señal del Coordinador') AS "causa"
  FROM s
  WHERE NOT (s."valida" IS NULL AND (s."antes" = 'SUBIENDO' OR (s."antes" = 'EN_CURSO' AND COALESCE(s."lugar", '') IN ('nube', 'orquestador'))))
    AND COALESCE(s."valida", s."ini") < ${AHORA} - make_interval(mins => CASE s."antes"
      WHEN 'PLANEANDO' THEN ${MINUTOS_SIN_SENAL_PARA_CAIDA.planear}
      WHEN 'EN_CURSO' THEN ${MINUTOS_SIN_SENAL_PARA_CAIDA.construir}
      ELSE ${MINUTOS_SIN_SENAL_PARA_CAIDA.subir} END)
),${reintentarCaidas("x", "true", "$3::text")}
SELECT "id", "tableroId", "antes", "estado", "motivo", "tipo" FROM reintentadas
UNION ALL
SELECT "id", "tableroId", "antes", "estado", "motivo", "tipo" FROM caidas`;

/**
 * /arranque: el Coordinador acaba de arrancar, así que lo que el negocio tenía en PLANEANDO, EN_CURSO o SUBIENDO
 * con candado (trabajoVenceEn) lo tenía el proceso anterior, que murió. Vuelve a la fila (APROBADO /
 * PLAN_APROBADO / SUBIENDO pendiente, sin candado) sin ERROR y sin gastar el intento, con una fila de
 * IntentoTarjeta (coordinador_cortado, esperar, no cuenta). La SUBIENDO se vuelve a tomar enseguida: subir es
 * repetible (1-nov-2026), si la rama ya está en main no la vuelve a empujar.
 * Parámetros: $1 = workspaceId, $2 = ahora (ISO). Devuelve id, tableroId, el estado que tenían ("antes") y el que quedaron ("estado").
 */
export const SQL_ARRANQUE = `
WITH v AS (
  SELECT c."id", c."tableroId", c."estado"::text AS "antes"
  FROM "TarjetaTablero" c
  JOIN "TableroInteligente" b ON b."id" = c."tableroId"
  WHERE b."workspaceId" = $1
    AND c."borradoEn" IS NULL
    AND c."estado" IN ('PLANEANDO', 'EN_CURSO', 'SUBIENDO')
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
  RETURNING t."id", t."tableroId", v."antes", t."estado"::text AS "estado"
),
intentos AS (
  INSERT INTO "IntentoTarjeta" ("id", "tarjetaId", "numero", "etapa", "categoria", "causa", "error", "accion", "cuentaComoIntento", "creadoEn")
  SELECT ${idDelIntento("v")}, v."id", ${numeroSiguiente("v")}, ${etapaDelAntes("v")}, 'coordinador_cortado',
         'El Coordinador se reinició mientras la tenía; vuelve a la fila.', NULL, 'esperar', false, ${AHORA}
  FROM v
  RETURNING "id"
)
SELECT "id", "tableroId", "antes", "estado" FROM sueltas`;

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

/** Lista SQL de textos ('A', 'B') a partir de una lista fija del código (solo letras, números y _). */
const listaSql = (valores: readonly string[]) => valores.map((v) => `'${v.replace(/[^A-Za-z0-9_]/g, "")}'`).join(", ");

/** La vía de la última aprobación vigente de la tarjeta `c` ('' si no hay). */
const VIA_DE_LA_ULTIMA_APROBACION = `COALESCE((
        SELECT h."despues"->>'via'
        FROM "HistorialTarjeta" h
        WHERE h."tarjetaId" = c."id" AND h."accion" = 'aprobar' AND h."deshechoEn" IS NULL
        ORDER BY h."creadoEn" DESC
        LIMIT 1
      ), '')`;

/**
 * ¿La vía de la última aprobación deja tomar la tarjeta `c`? La misma regla que laAprobacionDejaArrancar
 * (reglas-trabajador.ts): sin zona, sí; en la pantalla, sí; con zonas SOLO CHATS y/o BOT_VENTAS
 * (ZONAS_QUE_ARRANCAN_SOLAS), también automática (25-oct) o por voz (28-oct); por voz también con LIBRO_V3
 * (ZONAS_QUE_ARRANCAN_POR_VOZ, 31-oct-2026); con META_ADS, solo pantalla.
 * Nunca da NULL (para poder negarla en SQL_FUERA_POR_LA_VIA).
 */
const CONDICION_DE_LA_VIA = `(
      cardinality(c."zonaProtegida") = 0
      OR ${VIA_DE_LA_ULTIMA_APROBACION} = 'pantalla'
      OR (
        c."zonaProtegida" <@ ARRAY[${listaSql(ZONAS_QUE_ARRANCAN_POR_VOZ)}]::text[]
        AND ${VIA_DE_LA_ULTIMA_APROBACION} = 'voz'
      )
      OR (
        c."zonaProtegida" <@ ARRAY[${listaSql(ZONAS_QUE_ARRANCAN_SOLAS)}]::text[]
        AND ${VIA_DE_LA_ULTIMA_APROBACION} IN (${listaSql(VIAS_QUE_ARRANCAN_ZONAS_SOLAS)})
      )
    )`;

/**
 * Lo que se pide para tomar, MENOS la vía de la aprobación: solo tipos con aprobación, con repo de la lista
 * (`repos`, el parámetro text[]), sin borrar, en APROBADO, PLAN_APROBADO (con plan) o SUBIENDO pendiente (sin
 * candado). Una APROBADO o PLAN_APROBADO con una dependencia sin terminar (flecha esDependencia cuyo origen, sin
 * borrar y de un tipo con estados, no está HECHO) espera (un Área no tiene estado y bloquearía para siempre); una
 * SUBIENDO no (ya construyó).
 */
const whereSinLaVia = (repos: string) => `
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
    )`;

/** Qué se puede tomar: whereSinLaVia y, si tiene zona protegida, que la vía de su última aprobación alcance (CONDICION_DE_LA_VIA). */
const wherePara = (repos: string) => `${whereSinLaVia(repos)}
    AND ${CONDICION_DE_LA_VIA}`;

/**
 * Las palabras enteras de `palabras` (PALABRAS_DE_LA_FILA, en minúsculas y sin tildes) como expresión de SQL sobre `columna`,
 * con o sin tilde y sin importar mayúsculas: la misma comparación que tieneAlgunaPalabra (reglas-trabajador.ts).
 */
const CON_TILDE: Record<string, string> = { a: "[aáAÁ]", e: "[eéEÉ]", i: "[iíIÍ]", o: "[oóOÓ]", u: "[uúüUÚÜ]", n: "[nñNÑ]" };
const FUERA_DE_PALABRA = "[^a-zA-Z0-9áéíóúüñÁÉÍÓÚÜÑ]";
const tienePalabraSql = (columna: string, palabras: readonly string[]) => {
  const opciones = palabras.map((palabra) => [...palabra.replace(/[^a-z]/g, "")].map((letra) => CON_TILDE[letra] ?? letra).join(""));
  return `(COALESCE(${columna}, '') ~* '(^|${FUERA_DE_PALABRA})(${opciones.join("|")})($|${FUERA_DE_PALABRA})')`;
};

/**
 * El lugar de la tarjeta `c` en la fila (31-oct-2026): la MISMA regla que prioridadDeLaFila (reglas-trabajador.ts), con las
 * mismas listas. 0 = URGENTE (campo o título que empieza con URGENTE) o PRIORIDAD en MAYÚSCULAS en el título o el detalle;
 * 1 = ventas y chats (tablero Ventas, título con chat / conversación / asesora, zona CHATS o BOT_VENTAS); 2 = dinero de
 * Gestión (repo gestion y título con venta / abono / gasto / nómina / comisión / cuenta); 3 = lo demás. Usa el JOIN `b`.
 */
const PRIORIDAD_DE_LA_FILA = `(CASE
    WHEN c."urgente" OR c."titulo" ~* '^[[:space:]]*urgente($|[^a-zA-Z0-9_])'
      OR strpos(c."titulo", '${PALABRA_DE_PRIORIDAD}') > 0 OR strpos(COALESCE(c."detalle", ''), '${PALABRA_DE_PRIORIDAD}') > 0 THEN 0
    WHEN ${tienePalabraSql('b."nombre"', PALABRAS_DE_LA_FILA.tableroDeVentas)}
      OR ${tienePalabraSql('c."titulo"', PALABRAS_DE_LA_FILA.chats)}
      OR c."zonaProtegida" && ARRAY[${listaSql(ZONAS_DE_VENTAS_Y_CHATS)}]::text[] THEN 1
    WHEN c."repo" = '${REPO_DE_GESTION}' AND ${tienePalabraSql('c."titulo"', PALABRAS_DE_LA_FILA.dineroDeGestion)} THEN 2
    ELSE 3
  END)`;

/**
 * Primero una SUBIENDO pendiente (la que sube sola no espera detrás de otras); después la prioridad (PRIORIDAD_DE_LA_FILA:
 * urgente, ventas y chats, dinero de Gestión, lo demás) y al final la que más espera. Solo cambia el ORDEN: qué se puede
 * tomar lo dice wherePara.
 */
const ORDEN_PARA_TOMAR = `ORDER BY (c."estado" = 'SUBIENDO') DESC, ${PRIORIDAD_DE_LA_FILA} ASC, c."actualizadoEn" ASC, c."creadoEn" ASC`;

/**
 * Las que podría tomar, SIN tomarlas, en el orden en que las tomaría. El trabajador las mira para no
 * juntar en paralelo dos del mismo repo que tocan la misma zona o el mismo módulo, ni dos subidas del
 * mismo repo: esas las manda en `excluir` a /tomar y esperan en fila.
 * "desbloquea" (25-oct-2026): cuántas tarjetas esperan a que esta esté HECHO (flechas esDependencia que salen de
 * ella): el Coordinador toma primero las que desbloquean a otras (trabajador-tablero/lib/reparto.mjs).
 * "prioridad" (31-oct-2026): PRIORIDAD_DE_LA_FILA (0 a 3), para que el reparto respete el mismo orden.
 * Parámetros: $1 = workspaceId, $2 = repos (text[]).
 */
export const SQL_CANDIDATAS = `
SELECT c."id", c."titulo", c."estado"::text AS "estado", c."repo", c."zonaProtegida", c."plan",
  (SELECT count(*)::int FROM "ConexionTarjeta" d WHERE d."origenId" = c."id" AND d."esDependencia") AS "desbloquea",
  ${PRIORIDAD_DE_LA_FILA}::int AS "prioridad"
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
 * Las APROBADO / PLAN_APROBADO / SUBIENDO pendientes (sin candado, 31-oct) que el Coordinador tomaría si no fuera por la
 * VÍA de su aprobación (28-oct-2026): tienen una zona que exige la pantalla (LIBRO_V3, META_ADS) y su última aprobación
 * fue por voz u otra vía. Con esto el CRM deja una alerta del Coordinador por tarjeta (avisos-al-dueno.ts), para que no
 * esperen en silencio. Qué se toma no cambia: esto solo lee.
 * Parámetros: $1 = workspaceId, $2 = repos (text[]). Devuelve id, titulo, estado, zonaProtegida y via ('' si no hay).
 */
export const SQL_FUERA_POR_LA_VIA = `
SELECT c."id", c."titulo", c."estado"::text AS "estado", c."zonaProtegida", ${VIA_DE_LA_ULTIMA_APROBACION} AS "via"
FROM "TarjetaTablero" c
JOIN "TableroInteligente" b ON b."id" = c."tableroId"
JOIN "TipoTarjeta" k ON k."id" = c."tipoId"
${whereSinLaVia("$2")}
  AND c."estado" IN ('APROBADO', 'PLAN_APROBADO', 'SUBIENDO')
  AND NOT ${CONDICION_DE_LA_VIA}
ORDER BY c."actualizadoEn" ASC, c."creadoEn" ASC
LIMIT 50`;

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
 * Red de seguridad de /tomar (26-oct-2026): las HUÉRFANAS. Huérfana = tarjeta con repo, de un tipo con aprobación y
 * estados, en PLANEANDO o EN_CURSO SIN candado (trabajoVenceEn NULL), sin cambios hace más de $4 minutos y que no es una
 * madre partida con alguna parte viva (esa espera a sus partes). Nadie la trabaja y, sin candado,
 * SQL_PASAR_VENCIDAS_A_ERROR nunca la vería. SUBIENDO sin candado NO entra: es la SUBIENDO pendiente.
 * Desde el 10-nov-2026 ya no pasa directo a ERROR: se cayó, y sigue la regla de las caídas (reintentarCaidas): vuelve sola
 * a la fila hasta TOPE_DE_REINTENTOS_AUTOMATICOS veces y después pasa a ERROR con el aviso urgente.
 * $3 = ahora como texto ISO, $4 = minutos (MINUTOS_PARA_HUERFANA). (Hasta el 10-nov-2026 $3 era el motivo del ERROR.)
 * Devuelve lo mismo que SQL_PASAR_VENCIDAS_A_ERROR (tipo reintentada o caida).
 */
export const SQL_PASAR_HUERFANAS_A_ERROR = `
WITH v AS (
  SELECT c."id", c."tableroId", c."estado"::text AS "antes", c."actualizadoEn" AS "desde", ${reintentosDe("c")} AS "veces"
  FROM "TarjetaTablero" c
  JOIN "TableroInteligente" b ON b."id" = c."tableroId"
  JOIN "TipoTarjeta" k ON k."id" = c."tipoId"
  WHERE b."workspaceId" = $1
    AND c."borradoEn" IS NULL
    AND c."repo" IS NOT NULL
    AND k."requiereAprobacion" AND k."usaEstados"
    AND c."estado" IN ('PLANEANDO', 'EN_CURSO')
    AND c."trabajoVenceEn" IS NULL
    AND c."actualizadoEn" <= ${AHORA} - make_interval(mins => $4::int)
    AND NOT EXISTS (
      SELECT 1 FROM "TarjetaTablero" h
      WHERE h."borradoEn" IS NULL
        AND jsonb_typeof(c."resultado" -> 'partida' -> 'hijas') = 'array'
        AND c."resultado" -> 'partida' -> 'hijas' @> jsonb_build_array(h."id")
    )
  FOR UPDATE OF c
),
x AS (
  SELECT v."id", v."tableroId", v."antes", v."veces", ${minutosDesde(`v."desde"`)} AS "minutos",
         (${fraseDeHuerfana("v")} || ', sin cambios hace ' || ${minutosDesde(`v."desde"`)}::text || ' min') AS "causa"
  FROM v
),${reintentarCaidas("x", "true", "$3::text")}
SELECT "id", "tableroId", "antes", "estado", "motivo", "tipo" FROM reintentadas
UNION ALL
SELECT "id", "tableroId", "antes", "estado", "motivo", "tipo" FROM caidas`;
