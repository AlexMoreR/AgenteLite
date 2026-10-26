import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { anuncioDeLaFicha } from "../dominio/reporte";
import { buscarAnuncio, metaAdsConfigurado } from "./meta-ads-lectura";

/**
 * ORIGEN DEL CHAT: crea, por cliente, el "origen de pauta" (anuncio, conjunto, campaña, red, fecha de
 * llegada y chat) leyendo lo que los webhooks YA guardaron en la ficha. No toca los webhooks ni el bot.
 * La campaña y el conjunto se piden a Meta (solo lectura) una vez por anuncio y se guardan.
 * Corre una vez al día (cron/pauta) y rellena también a los clientes que ya existían.
 */

const REINTENTO_DE_CAMPANA_MS = 24 * 3_600_000;
const LOTE = 500;

export type ResumenDeOrigenes = { creados: number; campanasResueltas: number; sinMeta: boolean };

export async function sincronizarOrigenesDelChat(workspaceId: string, ahora = new Date()): Promise<ResumenDeOrigenes> {
  const resumen: ResumenDeOrigenes = { creados: 0, campanasResueltas: 0, sinMeta: !metaAdsConfigurado() };

  // 1. Fichas con anuncio guardado que todavía no tienen origen.
  const fichas = await prisma.$queryRaw<Array<{ id: string; metadata: unknown; createdAt: Date }>>(Prisma.sql`
    SELECT c."id", c."metadata", c."createdAt"
    FROM "Contact" c
    WHERE c."workspaceId" = ${workspaceId}
      AND c."metadata"->>'adSourceId' IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "OrigenDePauta" o WHERE o."workspaceId" = c."workspaceId" AND o."contactId" = c."id")
    ORDER BY c."createdAt" ASC
    LIMIT ${LOTE}
  `);

  // Lo que Meta ya contestó por anuncio (en esta corrida y en las anteriores): no se vuelve a preguntar.
  const conocidos = new Map<string, Awaited<ReturnType<typeof buscarAnuncio>>>();
  const yaGuardados = await prisma.origenDePauta.findMany({
    where: { workspaceId, campanaId: { not: null } },
    distinct: ["anuncioId"],
    select: { anuncioId: true, anuncioNombre: true, conjuntoId: true, conjuntoNombre: true, campanaId: true, campanaNombre: true },
  });
  for (const g of yaGuardados) conocidos.set(g.anuncioId, g);

  async function datosDeMeta(anuncioId: string) {
    if (conocidos.has(anuncioId)) return conocidos.get(anuncioId) ?? null;
    const datos = await buscarAnuncio(anuncioId);
    if (datos?.campanaId) conocidos.set(anuncioId, datos);
    return datos;
  }

  for (const ficha of fichas) {
    const anuncio = anuncioDeLaFicha(ficha.metadata, ficha.createdAt);
    if (!anuncio) continue;
    const chat = await prisma.conversation.findFirst({
      where: { workspaceId, contactId: ficha.id },
      orderBy: { startedAt: "asc" },
      select: { id: true },
    });
    const meta = await datosDeMeta(anuncio.anuncioId);
    const datos = {
      conversationId: chat?.id ?? null,
      anuncioNombre: meta?.anuncioNombre ?? anuncio.anuncioNombre,
      conjuntoId: meta?.conjuntoId ?? null,
      conjuntoNombre: meta?.conjuntoNombre ?? null,
      campanaId: meta?.campanaId ?? null,
      campanaNombre: meta?.campanaNombre ?? null,
      campanaConsultadaEn: metaAdsConfigurado() ? ahora : null,
    };
    await prisma.origenDePauta.upsert({
      where: { workspaceId_contactId: { workspaceId, contactId: ficha.id } },
      create: {
        workspaceId,
        contactId: ficha.id,
        anuncioId: anuncio.anuncioId,
        red: anuncio.red,
        ctwaClid: anuncio.ctwaClid,
        llegoEn: anuncio.llegoEn,
        ...datos,
      },
      update: {},
    });
    resumen.creados += 1;
  }

  // 2. Orígenes que quedaron sin campaña (Meta no contestó o aún no había llave): reintento diario.
  if (metaAdsConfigurado()) {
    const pendientes = await prisma.origenDePauta.findMany({
      where: {
        workspaceId,
        campanaId: null,
        OR: [{ campanaConsultadaEn: null }, { campanaConsultadaEn: { lt: new Date(ahora.getTime() - REINTENTO_DE_CAMPANA_MS) } }],
      },
      select: { anuncioId: true },
      distinct: ["anuncioId"],
      take: 100,
    });
    for (const { anuncioId } of pendientes) {
      const meta = await datosDeMeta(anuncioId);
      await prisma.origenDePauta.updateMany({
        where: { workspaceId, anuncioId, campanaId: null },
        data: meta?.campanaId
          ? {
              anuncioNombre: meta.anuncioNombre ?? undefined,
              conjuntoId: meta.conjuntoId,
              conjuntoNombre: meta.conjuntoNombre,
              campanaId: meta.campanaId,
              campanaNombre: meta.campanaNombre,
              campanaConsultadaEn: ahora,
            }
          : { campanaConsultadaEn: ahora },
      });
      if (meta?.campanaId) resumen.campanasResueltas += 1;
    }
  }
  return resumen;
}
