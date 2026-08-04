import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canAccessClientModule, getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { lookupEvolutionPhoneForLid } from "@/lib/evolution";
import { mergeLidContactIntoPhoneContact } from "@/lib/lid-contact-merge";
import { prisma } from "@/lib/prisma";
import { buildLinkedLidMetadata, looksLikeLidNumber } from "@/lib/whatsapp-lid";
import type { Prisma } from "@prisma/client";

/**
 * Recuperar el telefono de los leads que quedaron guardados con un LID.
 *
 * Son los que entraron antes de que el gateway supiera resolverlo: en la ficha tienen 14 o 15
 * digitos en el lugar del numero, asi que no se les puede llamar y algunos estan duplicados con
 * su propia ficha "buena". Ahora que evogo responde quien esta detras de cada LID, se pueden
 * arreglar uno por uno.
 *
 * Va POR TANDAS y no de una: cada contacto es una consulta al gateway, y evogo es UN contenedor
 * que atiende a todos los canales. Ya paso una vez que lo saturamos pidiendole fotos de perfil y
 * dejo de enviar mensajes; no se repite. Se llama varias veces hasta que "restantes" llegue a 0.
 */

export const dynamic = "force-dynamic";

const PAUSA_ENTRE_CONSULTAS_MS = 250;

function esperar(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const access = await getClientWorkspaceAccessForUser(session.user.id);
  if (!access || !canAccessClientModule(access, "connection")) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limite = Math.max(1, Math.min(25, Number.parseInt(url.searchParams.get("limit") || "10", 10) || 10));

  const canal = await prisma.whatsAppChannel.findFirst({
    where: { workspaceId: access.workspaceId, provider: "EVOLUTION", status: "CONNECTED" },
    select: { evolutionInstanceName: true },
  });
  if (!canal?.evolutionInstanceName) {
    return NextResponse.json({ ok: false, error: "No hay un canal de WhatsApp conectado." }, { status: 404 });
  }
  const instanceName = canal.evolutionInstanceName;

  // Los candidatos: telefono de 14 digitos o mas. Uno real no pasa de 13 con indicativo.
  const candidatos = await prisma.$queryRaw<Array<{ id: string; phoneNumber: string }>>`
    SELECT "id", "phoneNumber" FROM "Contact"
    WHERE "workspaceId" = ${access.workspaceId}
      AND length(regexp_replace("phoneNumber", '\\D', '', 'g')) >= 14
      AND ("metadata"->>'lidBackfillDone') IS NULL
    ORDER BY "createdAt" DESC
    LIMIT ${limite}
  `;

  const restantesRow = await prisma.$queryRaw<Array<{ total: bigint }>>`
    SELECT COUNT(*) AS total FROM "Contact"
    WHERE "workspaceId" = ${access.workspaceId}
      AND length(regexp_replace("phoneNumber", '\\D', '', 'g')) >= 14
      AND ("metadata"->>'lidBackfillDone') IS NULL
  `;

  let resueltos = 0;
  let unidos = 0;
  let actualizados = 0;
  let sinResolver = 0;

  for (const [indice, candidato] of candidatos.entries()) {
    if (indice > 0) {
      await esperar(PAUSA_ENTRE_CONSULTAS_MS);
    }

    try {
      const lid = candidato.phoneNumber.replace(/\D/g, "");
      const telefono = await lookupEvolutionPhoneForLid({ instanceName, lid });

      // Se marca SIEMPRE como revisado, resuelva o no: si no, la proxima tanda vuelve a traer
      // los mismos y el barrido nunca avanza.
      const marcarRevisado = async (extra: Record<string, unknown> = {}) => {
        const ficha = await prisma.contact.findUnique({
          where: { id: candidato.id },
          select: { metadata: true },
        });
        const base =
          ficha?.metadata && typeof ficha.metadata === "object" && !Array.isArray(ficha.metadata)
            ? (ficha.metadata as Record<string, unknown>)
            : {};
        await prisma.contact.update({
          where: { id: candidato.id },
          data: { metadata: { ...base, ...extra, lidBackfillDone: true } as Prisma.InputJsonValue },
        });
      };

      if (!telefono || looksLikeLidNumber(telefono)) {
        sinResolver += 1;
        await marcarRevisado();
        continue;
      }

      resueltos += 1;

      // ¿Esa persona ya tiene su ficha buena? Entonces esta es la fantasma y se funden.
      const fichaBuena = await prisma.contact.findFirst({
        where: { workspaceId: access.workspaceId, phoneNumber: telefono },
        select: { id: true },
      });

      if (fichaBuena && fichaBuena.id !== candidato.id) {
        const resultado = await mergeLidContactIntoPhoneContact({
          workspaceId: access.workspaceId,
          lid,
          phoneContactId: fichaBuena.id,
        });
        if (resultado.merged) {
          unidos += 1;
          continue; // la fantasma se borro en la union: no hay a quien marcar
        }
        await marcarRevisado();
        continue;
      }

      // No hay ficha buena: esta misma pasa a tener el telefono real.
      const ficha = await prisma.contact.findUnique({
        where: { id: candidato.id },
        select: { metadata: true },
      });
      await prisma.contact.update({
        where: { id: candidato.id },
        data: {
          phoneNumber: telefono,
          metadata: {
            ...(buildLinkedLidMetadata(ficha?.metadata, lid) as Record<string, unknown>),
            lidBackfillDone: true,
          } as Prisma.InputJsonValue,
        },
      });
      actualizados += 1;
    } catch (error) {
      sinResolver += 1;
      console.warn("[lid-backfill] no se pudo recuperar el telefono", {
        contactId: candidato.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    revisados: candidatos.length,
    resueltos,
    unidos,
    actualizados,
    sinResolver,
    restantes: Math.max(0, Number(restantesRow[0]?.total ?? 0) - candidatos.length),
  });
}
