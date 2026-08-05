import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { canAccessClientModule, getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";
import {
  buildProductConversationCondition,
  getProductMatchRule,
} from "@/features/productos-v2/services/productConversationFilter";
import {
  analyzeConversation,
  buildInsightTranscript,
  estaMuerta,
  saveConversationInsight,
} from "@/lib/conversation-insight";

/**
 * Leer las conversaciones de un producto y dejar escrito que paso en cada una.
 *
 * Va POR TANDAS: cada conversacion es una llamada a la IA, y mandar 900 de golpe es plata y es
 * riesgo de que se caiga a la mitad sin saber donde quedo. Se llama varias veces hasta que
 * "restantes" llegue a 0, igual que el barrido de LID.
 *
 * Solo relee lo que cambio: si una conversacion ya se leyo y no tiene mensajes nuevos, se saltea.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PAUSA_MS = 200;
const MODELO = "gpt-4.1-mini";

function esperar(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const access = await getClientWorkspaceAccessForUser(session.user.id);
  if (!access || !canAccessClientModule(access, "products_v2")) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const url = new URL(request.url);
  const productId = url.searchParams.get("productId")?.trim() || "";
  const limite = Math.max(1, Math.min(25, Number.parseInt(url.searchParams.get("limit") || "10", 10) || 10));
  // Releer lo ya leido: hace falta cuando se corrige como clasifica, si no quedan para siempre
  // las lecturas viejas y no hay forma de saber si el arreglo sirvio.
  const forzar = url.searchParams.get("force") === "1";
  if (!productId) {
    return NextResponse.json({ ok: false, error: "Falta el producto" }, { status: 400 });
  }

  // Que conversaciones son de este producto lo dice la regla del propio producto: lo marco el
  // agente, el cliente uso una de sus palabras, o llego por uno de sus anuncios.
  const regla = await getProductMatchRule({ workspaceId: access.workspaceId, productId });
  const condicion = buildProductConversationCondition(regla);

  const candidatas = await prisma.$queryRaw<Array<{ id: string; total: bigint }>>(Prisma.sql`
    SELECT c.id, COUNT(m.id) AS total
    FROM "Conversation" c
    JOIN "Message" m ON m."conversationId" = c.id
    LEFT JOIN "ConversationInsight" i ON i."conversationId" = c.id
    WHERE c."workspaceId" = ${access.workspaceId}
      AND c."lastMessageAt" > now() - interval '30 days'
      AND ${condicion}
    GROUP BY c.id, i."messageCount"
    HAVING ${forzar} OR i."messageCount" IS NULL OR i."messageCount" < COUNT(m.id)
    ORDER BY MAX(m."createdAt") DESC
    LIMIT ${limite}
  `);

  const restantesRow = await prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
    SELECT COUNT(*) AS total FROM (
      SELECT c.id
      FROM "Conversation" c
      JOIN "Message" m ON m."conversationId" = c.id
      LEFT JOIN "ConversationInsight" i ON i."conversationId" = c.id
      WHERE c."workspaceId" = ${access.workspaceId}
        AND c."lastMessageAt" > now() - interval '30 days'
        AND ${condicion}
      GROUP BY c.id, i."messageCount"
      HAVING i."messageCount" IS NULL OR i."messageCount" < COUNT(m.id)
    ) AS pendientes
  `);

  let leidas = 0;
  let fallidas = 0;

  for (const [indice, candidata] of candidatas.entries()) {
    if (indice > 0) {
      await esperar(PAUSA_MS);
    }

    try {
      const mensajes = await prisma.message.findMany({
        where: { conversationId: candidata.id, deletedAt: null },
        orderBy: { createdAt: "asc" },
        select: { direction: true, content: true, type: true, createdAt: true },
      });

      const base = buildInsightTranscript(mensajes);
      if (!base) {
        continue;
      }

      // Los dias que pasaron, explicitos. Sin esto la IA no tiene como saber que "le mandamos el
      // precio" fue hace doce dias y el cliente nunca volvio: en el texto parece que sigue viva.
      const ultimo = mensajes[mensajes.length - 1];
      const dias = ultimo
        ? Math.floor((Date.now() - ultimo.createdAt.getTime()) / 86_400_000)
        : 0;
      const ultimoHabloElCliente = ultimo?.direction === "INBOUND";
      const transcript = `${base}\n\n[Ultimo mensaje: hace ${dias} dias. Hablo ultimo: ${
        ultimoHabloElCliente ? "EL CLIENTE" : "NOSOTROS"
      }.]`;

      const resultado = await analyzeConversation({ transcript, model: MODELO });
      if (!resultado) {
        fallidas += 1;
        continue;
      }

      const ultimoNuestro = [...mensajes]
        .reverse()
        .find((mensaje) => mensaje.direction === "OUTBOUND" && (mensaje.content ?? "").trim());

      // El estado lo decide la regla de los dias, salvo que la IA haya visto una compra
      // confirmada: eso si esta en el texto y la regla no puede saberlo.
      const muerta = estaMuerta({ diasDesdeElUltimo: dias, ultimoHabloElCliente });
      const estadoFinal =
        resultado.status === "GANADO" ? "GANADO" : muerta ? "MUERTO" : "VIVO";

      await saveConversationInsight({
        workspaceId: access.workspaceId,
        conversationId: candidata.id,
        productId,
        messageCount: Number(candidata.total),
        lastOutbound: ultimoNuestro?.content ?? null,
        model: MODELO,
        resultado: {
          ...resultado,
          status: estadoFinal,
          // El motivo solo tiene sentido en las muertas.
          lostReason: estadoFinal === "MUERTO" ? resultado.lostReason : null,
        },
      });
      leidas += 1;
    } catch (error) {
      fallidas += 1;
      console.warn("[insights] no se pudo leer la conversacion", {
        conversationId: candidata.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    leidas,
    fallidas,
    restantes: Math.max(0, Number(restantesRow[0]?.total ?? 0) - candidatas.length),
  });
}
