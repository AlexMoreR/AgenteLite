import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { CLAVE_COMBO } from "../dominio/combo";
import { ETAPAS_DEL_PANEL, rangoBogota, type ClaveDeEtapa, type ConteosDelEmbudo } from "../dominio/panel";

/**
 * Lo que lee el panel del embudo (/cliente/crm/embudo). Dos consultas por período, con agregados
 * en SQL (nada de una consulta por lead):
 *  1. por lead, si llegó a cada etapa (bool_or sobre sus eventos) y cuánto lleva; sumado en la base.
 *  2. las señales por tipo.
 */

export type PeriodoDelEmbudo = { desde: string; hasta: string };

export type SenalContada = { tipo: string; leads: number; veces: number };

export type LecturaDelEmbudo = {
  periodo: PeriodoDelEmbudo;
  conteos: ConteosDelEmbudo;
  senales: SenalContada[];
};

type FilaConteos = Record<string, bigint | number | null>;

const numero = (valor: bigint | number | null | undefined) => Number(valor ?? 0);

export async function leerEmbudo(input: {
  workspaceId: string;
  periodo: PeriodoDelEmbudo;
  /** Clave de producto de entrada ("combo-camilla" por defecto). "todos" = sin filtro. */
  producto: string;
  incluirMezcla: boolean;
  ahora?: Date;
}): Promise<LecturaDelEmbudo> {
  const { inicio, fin } = rangoBogota(input.periodo.desde, input.periodo.hasta);
  const ahora = input.ahora ?? new Date();
  const corte72 = new Date(ahora.getTime() - 72 * 3_600_000);
  const corte30 = new Date(ahora.getTime() - 30 * 86_400_000);
  const producto = input.producto === "todos" ? null : input.producto || CLAVE_COMBO;

  const filtroLeads = Prisma.sql`
    l."workspaceId" = ${input.workspaceId}
    AND l."entradaEn" >= ${inicio} AND l."entradaEn" < ${fin}
    ${producto ? Prisma.sql`AND l."productoEntrada" = ${producto}` : Prisma.empty}
    ${input.incluirMezcla ? Prisma.empty : Prisma.sql`AND l."mezcla" = false`}
  `;

  const conteosPorEtapa = ETAPAS_DEL_PANEL.map(
    ({ clave }) => Prisma.sql`
      count(*) FILTER (WHERE f.${Prisma.raw(`"${clave}"`)}) AS ${Prisma.raw(`"${clave}_todos"`)},
      count(*) FILTER (WHERE f.${Prisma.raw(`"${clave}"`)} AND f."entradaEn" < ${corte72}) AS ${Prisma.raw(`"${clave}_m72"`)},
      count(*) FILTER (WHERE f.${Prisma.raw(`"${clave}"`)} AND f."entradaEn" < ${corte30}) AS ${Prisma.raw(`"${clave}_m30"`)}`,
  );

  const [filas, senales] = await Promise.all([
    prisma.$queryRaw<FilaConteos[]>(Prisma.sql`
      WITH leads AS (
        SELECT l."conversationId", l."entradaEn", l."puntaje", l."transferencia",
               l."cotizacionEn", l."cotizacionRef", l."anticipoEn", l."ventaEn"
        FROM "EmbudoLead" l
        WHERE ${filtroLeads}
      ),
      ev AS (
        SELECT e."conversationId",
          bool_or(e."tipo" = 'BIENVENIDA_ENVIADA') AS bienvenida,
          bool_or(e."tipo" = 'CLIENTE_RESPONDIO' AND e."paso" = 'PRESENTACION') AS respondio,
          bool_or(e."tipo" = 'CLIENTE_RESPONDIO' AND e."paso" = 'IDENTIFICACION') AS identificacion,
          bool_or(e."tipo" = 'RECOMENDACION_ENVIADA') AS recomendacion,
          bool_or(
            e."tipo" = 'ACEPTO_INFO'
            OR (e."tipo" = 'CLIENTE_RESPONDIO' AND e."paso" IN ('PRODUCTO', 'OBJECIONES', 'CIERRE'))
            OR (e."tipo" = 'SENAL' AND COALESCE((e."datos"->>'peso')::int, 0) > 0)
          ) AS acepto,
          bool_or(e."tipo" IN ('ESCALADO', 'ASIGNADA')) AS asesora,
          bool_or(e."tipo" = 'COTIZACION') AS cotizacion,
          bool_or(e."tipo" = 'ANTICIPO') AS anticipo
        FROM "EmbudoEvento" e
        JOIN leads ON leads."conversationId" = e."conversationId"
        GROUP BY e."conversationId"
      ),
      f AS (
        SELECT leads."entradaEn",
          true AS entrada,
          COALESCE(ev.bienvenida, false) AS bienvenida,
          COALESCE(ev.respondio, false) AS respondio,
          COALESCE(ev.identificacion, false) AS identificacion,
          COALESCE(ev.recomendacion, false) AS recomendacion,
          COALESCE(ev.acepto, false) AS acepto,
          COALESCE(leads."puntaje", 0) >= 3 AS intencion,
          (COALESCE(ev.asesora, false) OR leads."transferencia" <> 'NO') AS asesora,
          (COALESCE(ev.cotizacion, false) OR leads."cotizacionEn" IS NOT NULL OR leads."cotizacionRef" IS NOT NULL) AS cotizacion,
          (COALESCE(ev.anticipo, false) OR leads."anticipoEn" IS NOT NULL OR leads."ventaEn" IS NOT NULL) AS anticipo
        FROM leads
        LEFT JOIN ev ON ev."conversationId" = leads."conversationId"
      )
      SELECT
        count(*) AS total,
        count(*) FILTER (WHERE f."entradaEn" < ${corte72}) AS maduros72,
        count(*) FILTER (WHERE f."entradaEn" < ${corte30}) AS maduros30,
        ${Prisma.join(conteosPorEtapa, ",")}
      FROM f
    `),
    prisma.$queryRaw<Array<{ tipo: string | null; leads: bigint; veces: bigint }>>(Prisma.sql`
      SELECT e."datos"->>'senal' AS tipo,
             count(DISTINCT e."conversationId") AS leads,
             count(*) AS veces
      FROM "EmbudoEvento" e
      JOIN "EmbudoLead" l ON l."conversationId" = e."conversationId"
      WHERE e."workspaceId" = ${input.workspaceId}
        AND e."tipo" = 'SENAL'
        AND ${filtroLeads}
      GROUP BY 1
      ORDER BY 2 DESC
    `),
  ]);

  const fila = filas[0] ?? {};
  const etapas = Object.fromEntries(
    ETAPAS_DEL_PANEL.map(({ clave }) => [
      clave,
      {
        todos: numero(fila[`${clave}_todos`]),
        maduros: numero(fila[`${clave}_m72`]),
        maduros30: numero(fila[`${clave}_m30`]),
      },
    ]),
  ) as ConteosDelEmbudo["etapas"];

  return {
    periodo: input.periodo,
    conteos: {
      total: numero(fila.total),
      maduros72: numero(fila.maduros72),
      maduros30: numero(fila.maduros30),
      etapas,
    },
    senales: senales
      .filter((s) => s.tipo)
      .map((s) => ({ tipo: s.tipo as string, leads: numero(s.leads), veces: numero(s.veces) })),
  };
}

/** Los productos de entrada que hay en el embudo, con su nombre si es un producto del catálogo. */
export async function productosDelEmbudo(workspaceId: string): Promise<Array<{ clave: string; nombre: string }>> {
  const filas = await prisma.$queryRaw<Array<{ clave: string; leads: bigint }>>(Prisma.sql`
    SELECT "productoEntrada" AS clave, count(*) AS leads
    FROM "EmbudoLead"
    WHERE "workspaceId" = ${workspaceId} AND "productoEntrada" IS NOT NULL
    GROUP BY 1
    ORDER BY 2 DESC
    LIMIT 30
  `);
  const ids = filas.map((fila) => fila.clave).filter((clave) => clave !== CLAVE_COMBO);
  const productos = ids.length
    ? await prisma.product.findMany({ where: { workspaceId, id: { in: ids } }, select: { id: true, name: true } })
    : [];
  const nombres = new Map(productos.map((producto) => [producto.id, producto.name]));
  const lista = filas.map((fila) => ({
    clave: fila.clave,
    nombre: fila.clave === CLAVE_COMBO ? "Combo de Camilla" : nombres.get(fila.clave) ?? fila.clave,
  }));
  if (!lista.some((item) => item.clave === CLAVE_COMBO)) {
    lista.unshift({ clave: CLAVE_COMBO, nombre: "Combo de Camilla" });
  }
  return lista;
}

export type { ClaveDeEtapa };
