import { prisma } from "@/lib/prisma";

import { sincronizarOrigenesDelChat } from "./origen-del-chat";
import { sincronizarVentasDePauta } from "./ventas-de-gestion";

const DIAS_ATRAS = 60;

/** Todos los negocios con anuncios guardados. Un negocio que falla no frena a los demás. */
export async function correrPautaDeTodos(ahora = new Date()) {
  const bogota = new Date(ahora.getTime() - 5 * 3_600_000);
  const hasta = bogota.toISOString().slice(0, 10);
  const desde = new Date(bogota.getTime() - DIAS_ATRAS * 86_400_000).toISOString().slice(0, 10);
  const negocios = await prisma.$queryRaw<Array<{ workspaceId: string }>>`
    SELECT DISTINCT "workspaceId" FROM "Contact" WHERE "metadata"->>'adSourceId' IS NOT NULL
  `;
  const resultados: Record<string, unknown> = {};
  for (const { workspaceId } of negocios) {
    try {
      const origenes = await sincronizarOrigenesDelChat(workspaceId, ahora);
      const ventas = await sincronizarVentasDePauta(workspaceId, desde, hasta);
      resultados[workspaceId] = { origenes, ventas };
    } catch (error) {
      console.error("[cron/pauta] error", { workspaceId, error: error instanceof Error ? error.message : String(error) });
      resultados[workspaceId] = { error: error instanceof Error ? error.message : String(error) };
    }
  }
  return resultados;
}
