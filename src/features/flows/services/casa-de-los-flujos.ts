import { prisma } from "@/lib/prisma";

/*
  DONDE VIVEN LOS FLUJOS: un solo lugar por negocio.

  Los flujos se guardan dentro de una linea (metadata.flowBuilderState), pero se usan en TODAS:
  el boton "Enviar flujo" de cualquier chat, el agente y los seguimientos los buscan en el
  negocio entero (getCreatedFlowItems). Por eso la pantalla de Flujos no tiene selector: antes
  abria por defecto la API oficial -que no tenia ninguno- y parecia que los de Ventas 1 se
  habian borrado (Alex, 04-10-2026).

  La casa es la linea no oficial que ya tiene mas flujos; si ninguna tiene, la conectada; y
  solo si no hay lineas no oficiales, la API oficial.
*/
export type CasaDeLosFlujos = { sourceType: "evolution"; sourceId: string; href: string };

function cuantosFlujos(metadata: unknown): number {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return 0;
  const estado = (metadata as Record<string, unknown>).flowBuilderState;
  if (!estado || typeof estado !== "object" || Array.isArray(estado)) return 0;
  const escenarios = (estado as Record<string, unknown>).scenarios;
  return Array.isArray(escenarios) ? escenarios.length : 0;
}

export async function getCasaDeLosFlujos(workspaceId: string): Promise<CasaDeLosFlujos | null> {
  const lineas = await prisma.whatsAppChannel.findMany({
    where: { workspaceId, provider: "EVOLUTION" },
    orderBy: { createdAt: "asc" },
    select: { id: true, status: true, metadata: true },
  });

  if (lineas.length) {
    const ordenadas = lineas
      .map((linea) => ({
        id: linea.id,
        flujos: cuantosFlujos(linea.metadata),
        conectada: linea.status === "CONNECTED",
      }))
      .sort((a, b) => b.flujos - a.flujos || Number(b.conectada) - Number(a.conectada));
    const casa = ordenadas[0];
    return {
      sourceType: "evolution",
      sourceId: casa.id,
      href: `/cliente/flujos?sourceType=evolution&sourceId=${encodeURIComponent(casa.id)}`,
    };
  }

  return null;
}
