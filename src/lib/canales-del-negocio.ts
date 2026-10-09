import type { ChannelProvider } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { leerColaboradores, leerMonitores } from "@/lib/channel-collaborators";
import { cacheDeCanales } from "@/lib/cache-de-permisos";

/**
 * Las lineas de WhatsApp de un negocio, con quien las trabaja y quien solo las mira.
 *
 * Antes la bandeja leia la tabla de canales hasta CUATRO veces por pedido (lineas visibles, lineas
 * que monitorea, validar la conexion elegida y la lista misma). Ahora sale una vez y queda en la
 * cache de permisos (ver cache-de-permisos.ts: se vacia sola con cualquier escritura de canales).
 *
 * En el orden de siempre: por fecha de creacion.
 */
export type CanalDelNegocio = {
  id: string;
  name: string;
  provider: ChannelProvider;
  evolutionInstanceName: string | null;
  agentId: string | null;
  colaboradores: string[];
  monitores: string[];
};

export function canalesDelNegocio(workspaceId: string): Promise<CanalDelNegocio[]> {
  return cacheDeCanales.obtener(workspaceId, async () => {
    const canales = await prisma.whatsAppChannel.findMany({
      where: { workspaceId },
      select: {
        id: true,
        name: true,
        provider: true,
        evolutionInstanceName: true,
        metadata: true,
        // El id directo y no la relacion: es la misma clave foranea y se ahorra una consulta.
        agentId: true,
      },
      orderBy: { createdAt: "asc" },
    });
    return canales.map((canal) => ({
      id: canal.id,
      name: canal.name,
      provider: canal.provider,
      evolutionInstanceName: canal.evolutionInstanceName,
      agentId: canal.agentId ?? null,
      colaboradores: leerColaboradores(canal.metadata),
      monitores: leerMonitores(canal.metadata),
    }));
  });
}
