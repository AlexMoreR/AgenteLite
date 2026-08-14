"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canAccessClientModule, getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

/**
 * BIBLIOTECA DE ARCHIVOS: los catalogos de siempre, subidos una vez.
 *
 * Cuelga del permiso de CHATS y no de uno propio: quien puede mandarle un archivo a un cliente ya
 * puede usar la biblioteca, que es la misma accion con el archivo ya subido.
 */
async function getAccess() {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }
  const access = await getClientWorkspaceAccessForUser(session.user.id);
  if (!access || !canAccessClientModule(access, "chats")) {
    return null;
  }
  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  return membership?.workspace.id ?? null;
}

export type MediaLibraryItemDto = {
  id: string;
  title: string;
  url: string;
  fileName: string;
  mimeType: string;
  mediaType: "IMAGE" | "VIDEO" | "DOCUMENT";
  sizeBytes: number;
  sentCount: number;
};

/**
 * Los mas usados primero.
 *
 * Por fecha, el catalogo que se manda veinte veces por dia se hunde debajo de cualquier archivo
 * suelto que alguien subio una vez. Ordenar por uso hace que lo que la asesora necesita este
 * siempre arriba, sin que nadie tenga que ordenar nada a mano.
 */
export async function listarBibliotecaAction(): Promise<{
  items?: MediaLibraryItemDto[];
  error?: string;
}> {
  const workspaceId = await getAccess();
  if (!workspaceId) {
    return { error: "No autorizado" };
  }

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
      sizeBytes: true,
      sentCount: true,
    },
  });

  return {
    items: items.map((item) => ({
      ...item,
      mediaType: item.mediaType as MediaLibraryItemDto["mediaType"],
    })),
  };
}

export async function agregarABibliotecaAction(input: {
  title: string;
  url: string;
  fileName: string;
  mimeType: string;
  mediaType: string;
  sizeBytes?: number;
}): Promise<{ ok?: true; error?: string }> {
  const workspaceId = await getAccess();
  if (!workspaceId) {
    return { error: "No autorizado" };
  }

  const title = input.title?.trim() || input.fileName?.trim();
  const url = input.url?.trim();
  if (!title || !url) {
    return { error: "Falta el nombre o el archivo" };
  }

  // Solo rutas propias: la biblioteca guarda archivos que subimos nosotros, no enlaces a
  // cualquier lado. Un enlace externo se cae el dia que lo borran del otro lado y la asesora se
  // entera recien cuando el cliente no recibe nada.
  if (!url.includes("/uploads/")) {
    return { error: "El archivo no es válido" };
  }

  await prisma.mediaLibraryItem.create({
    data: {
      workspaceId,
      title,
      url,
      fileName: input.fileName?.trim() || title,
      mimeType: input.mimeType?.trim() || "application/octet-stream",
      mediaType: input.mediaType === "IMAGE" || input.mediaType === "VIDEO" ? input.mediaType : "DOCUMENT",
      sizeBytes: Number.isFinite(input.sizeBytes) ? Math.max(0, Math.round(input.sizeBytes ?? 0)) : 0,
    },
  });

  return { ok: true };
}

/** Suma uno al contador. Best-effort: que falle no tiene que romper un envio que ya salio. */
export async function marcarEnvioDeBibliotecaAction(input: { id: string }): Promise<void> {
  const workspaceId = await getAccess();
  if (!workspaceId) {
    return;
  }
  await prisma.mediaLibraryItem
    .updateMany({
      where: { id: input.id, workspaceId },
      data: { sentCount: { increment: 1 } },
    })
    .catch(() => {});
}

export async function borrarDeBibliotecaAction(input: { id: string }): Promise<{ ok?: true; error?: string }> {
  const workspaceId = await getAccess();
  if (!workspaceId) {
    return { error: "No autorizado" };
  }

  // Se saca de la lista pero el archivo NO se borra del disco: puede estar referenciado por
  // mensajes ya enviados, y borrarlo dejaria catalogos rotos en conversaciones viejas.
  await prisma.mediaLibraryItem.deleteMany({ where: { id: input.id, workspaceId } });
  return { ok: true };
}
