import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { canAccessClientModule, getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";
import {
  buildProductConversationCondition,
  getProductMatchRule,
} from "@/features/productos-v2/services/productConversationFilter";

/**
 * Los leads que se quedaron en una etapa del embudo, uno por uno.
 *
 * El numero de la etapa ("318 · 35%") sale de contar cuantos mensajes mando el cliente. Un
 * porcentaje que no se puede abrir es un acto de fe: esto lo abre, y de paso muestra CUANTOS
 * mensajes mando cada uno, que es el criterio con el que se lo agrupo. Asi se audita el numero
 * en vez de creerle.
 */

export const dynamic = "force-dynamic";

/** Mismos cortes que getProductLeadProgress: si cambian alla, cambian aca. */
const CORTES: Record<string, { having: Prisma.Sql; etiqueta: string }> = {
  primero: { having: Prisma.sql`<= 1`, etiqueta: "1 mensaje o ninguno" },
  dos: { having: Prisma.sql`= 2`, etiqueta: "2 mensajes" },
  converso: { having: Prisma.sql`BETWEEN 3 AND 5`, etiqueta: "3 a 5 mensajes" },
  larga: { having: Prisma.sql`>= 6`, etiqueta: "6 mensajes o más" },
};

export async function GET(request: Request) {
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
  const grupo = url.searchParams.get("grupo")?.trim() || "";
  const corte = CORTES[grupo];
  if (!productId || !corte) {
    return NextResponse.json({ ok: false, error: "Datos invalidos" }, { status: 400 });
  }

  const regla = await getProductMatchRule({ workspaceId: access.workspaceId, productId });
  const condicion = buildProductConversationCondition(regla);

  const filas = await prisma.$queryRaw<
    Array<{ id: string; mensajes: bigint; ultimo: Date; nombre: string | null; telefono: string }>
  >(Prisma.sql`
    SELECT c.id,
           COUNT(*) FILTER (WHERE m.direction = 'INBOUND') AS mensajes,
           MAX(m."createdAt") AS ultimo,
           ct."name" AS nombre,
           ct."phoneNumber" AS telefono
    FROM "Conversation" c
    JOIN "Message" m ON m."conversationId" = c.id
    JOIN "Contact" ct ON ct.id = c."contactId"
    WHERE c."workspaceId" = ${access.workspaceId}
      AND c."lastMessageAt" > now() - interval '30 days'
      AND ${condicion}
    GROUP BY c.id, ct."name", ct."phoneNumber"
    HAVING COUNT(*) FILTER (WHERE m.direction = 'INBOUND') ${corte.having}
    ORDER BY MAX(m."createdAt") DESC
    LIMIT 100
  `);

  return NextResponse.json({
    ok: true,
    criterio: corte.etiqueta,
    leads: filas.map((fila) => ({
      conversationId: fila.id,
      nombre: fila.nombre?.trim() || fila.telefono,
      telefono: fila.telefono,
      mensajes: Number(fila.mensajes),
      ultimo: fila.ultimo?.toISOString() ?? null,
      href: `/cliente/chats?chatKey=${encodeURIComponent(`agent:${fila.id}`)}`,
    })),
  });
}
