import { prisma } from "@/lib/prisma";

/**
 * La lista de la biblioteca de un negocio: la misma para la accion (agregar, borrar) y para la ruta
 * GET /api/cliente/chats/biblioteca, que es por donde la abre la pantalla (11-11-2026: la accion
 * del servidor se encolaba detras de las otras y la biblioteca se quedaba en "Abriendo..." hasta 5 s).
 *
 * Los mas usados primero: por fecha, el catalogo que se manda veinte veces por dia se hunde debajo
 * de cualquier archivo suelto que alguien subio una vez.
 */
export type MediaLibraryItemDto = {
  id: string;
  title: string;
  url: string;
  fileName: string;
  mimeType: string;
  mediaType: "IMAGE" | "VIDEO" | "DOCUMENT";
  /** La tapa. Null = se muestra un icono. */
  thumbnailUrl: string | null;
  sizeBytes: number;
  sentCount: number;
};

export async function listarBiblioteca(workspaceId: string): Promise<MediaLibraryItemDto[]> {
  const items = await prisma.mediaLibraryItem.findMany({
    where: { workspaceId },
    orderBy: [{ sentCount: "desc" }, { createdAt: "desc" }],
    take: 100,
    select: {
      id: true,
      title: true,
      url: true,
      fileName: true,
      mimeType: true,
      mediaType: true,
      thumbnailUrl: true,
      sizeBytes: true,
      sentCount: true,
    },
  });
  return items.map((item) => ({ ...item, mediaType: item.mediaType as MediaLibraryItemDto["mediaType"] }));
}
