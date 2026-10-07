import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type { AnuncioDelLead } from "@/lib/origen-de-venta";

/**
 * Guarda de qué anuncio de Meta vino el lead, con los MISMOS campos que la captura de Evolution/WAHA
 * (src/app/api/webhooks/evolution/route.ts, "F0 — Origen del lead"): así el informe y el aviso de
 * origen a Gestión leen un solo formato, entre por la línea que entre.
 *
 * Solo el primer toque: si ya hay `adCapturedAt` no se re-escribe. Best-effort, nunca lanza: se
 * llama desde un after() del webhook.
 */
export async function registrarOrigenAnuncio(input: { contactId: string; anuncio: AnuncioDelLead; fuente: string }) {
  try {
    const existente = await prisma.contact.findUnique({ where: { id: input.contactId }, select: { metadata: true } });
    if (!existente) return;
    const meta =
      existente.metadata && typeof existente.metadata === "object" && !Array.isArray(existente.metadata)
        ? (existente.metadata as Record<string, unknown>)
        : {};
    if (meta.adCapturedAt) return;

    await prisma.contact.update({
      where: { id: input.contactId },
      data: {
        metadata: {
          ...meta,
          source: "meta ads",
          sourceType: "ad",
          campaign: input.anuncio.title,
          adTitle: input.anuncio.title,
          adSourceApp: input.anuncio.sourceApp,
          adCtwaClid: input.anuncio.ctwaClid,
          adSourceId: input.anuncio.sourceId,
          adSourceUrl: input.anuncio.sourceUrl,
          adCapturedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });
    console.log(`[${input.fuente}] ad_origin_captured`, {
      contactId: input.contactId,
      adTitle: input.anuncio.title,
      sourceApp: input.anuncio.sourceApp,
    });
  } catch (error) {
    console.warn(`[${input.fuente}] ad_origin_capture_failed`, {
      contactId: input.contactId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
