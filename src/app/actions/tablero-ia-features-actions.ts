"use server";

import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { personaPuedeAprobar } from "@/features/tableros-inteligentes/services/reglas";
import { tableroDeFeatures, type TableroDeFeatures } from "@/features/tableros-inteligentes/services/tablero-de-features";

/*
  Tablero IA, vista tipo tablero de Features (27-nov-2026, parte 1): solo LEE lo que cuelga del Área Features en sus
  10 columnas. No cambia ninguna tarjeta. El permiso es el de "Trabajos terminados": solo el dueño del negocio o el ADMIN.
*/

/** Las tarjetas de Features del negocio de la sesión, en columnas por estado. Solo el dueño o el ADMIN. */
export async function tableroDeFeaturesAction(): Promise<{ ok: true; tablero: TableroDeFeatures } | { ok: false; error: string }> {
  const access = await requireClientWorkspaceAccess("tableros_inteligentes");
  if (!personaPuedeAprobar(access)) return { ok: false, error: "El tablero de Features lo ve solo el dueño del negocio." };
  try {
    return { ok: true, tablero: await tableroDeFeatures(access.workspaceId) };
  } catch {
    return { ok: false, error: "No se pudo leer el tablero de Features" };
  }
}
